#!/usr/bin/env node
// Worker for tests/diff.mjs: one corpus case -> one JSON line on stdout.   usage: diff-one.mjs <file.tex | dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCompile, wasmEngine, wasmCompile, loadAssets, IMAGES, firstDiff, ctx, norm } from './lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const assets = { ...loadAssets(IMAGES), ...loadAssets(path.join(here, 'corpus/assets')) };
const files = { ...assets };
const walk = (dir, pre = '') => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const rel = pre + e.name; if (e.isDirectory()) walk(path.join(dir, e.name), rel + '/'); else files[rel] = new Uint8Array(fs.readFileSync(path.join(dir, e.name))); } };
if (fs.statSync(target).isDirectory()) walk(target); else files['main.tex'] = new Uint8Array(fs.readFileSync(target));
const src = Buffer.from(files['main.tex']).toString('latin1');
const m = /^%!opts:(.*)$/m.exec(src);
const o = Object.fromEntries((m ? m[1].trim().split(/\s+/).filter(Boolean) : []).map(kv => kv.split('=')));
const passes = +(o.passes ?? 3), ini = !!o.nofmt;

const res = { name: path.basename(target), status: 'ok', detail: '' };
try {
  const nat = nativeCompile(files, { passes, ini });
  const eng = await wasmEngine();
  const was = wasmCompile(eng, files, { passes, ini });
  Object.assign(res, { exit: was.exit, pdf: was.pdf ? was.pdf.length : 0, ms: Math.round(was.ms), nms: Math.round(nat.ms) });
  const fail = d => { res.status = 'FAIL'; res.detail += d + '\n'; };
  if (!nat.pdf !== !was.pdf) fail(`pdf native=${!!nat.pdf} wasm=${!!was.pdf}`);
  else if (nat.pdf) { const d = firstDiff(nat.pdf, was.pdf); if (d >= 0) fail(`pdf differs at byte ${d} (native ${nat.pdf.length}, wasm ${was.pdf.length})\n  native ${ctx(nat.pdf, d)}\n  wasm   ${ctx(was.pdf, d)}`); }
  for (const k of new Set([...Object.keys(nat.outputs), ...Object.keys(was.outputs)])) {
    if (k.endsWith('.log') || k.endsWith('.pdf')) continue;
    const a = nat.outputs[k], b = was.outputs[k];
    if (!a || !b) fail(`file ${k}: native=${!!a} wasm=${!!b}`);
    else if (firstDiff(a, b) >= 0) fail(`file ${k} differs at ${firstDiff(a, b)}\n  native ${ctx(a, firstDiff(a, b))}\n  wasm   ${ctx(b, firstDiff(a, b))}`);
  }
  if (nat.exit !== was.exit) fail(`exit native=${nat.exit} wasm=${was.exit}`);
  // tree gaps: files/fonts the document needed that the TeX tree lacks (an identical failure on both sides would hide them)
  const gaps = new Set();
  for (const m of (was.log || '').replace(/\n/g, '').matchAll(/File `([^']+)' not found|I can't find file `([^']+)'|Font ([^\s=]+)=?(\S*) at [\d.]+pt not loadable: Metric \(TFM\) file not found|Font (\S+) at \d+ not found/g)) gaps.add(m[1] || m[2] || m[4] || m[3] || m[5]);
  res.gaps = [...gaps];
  const a = norm(nat.log), b = norm(was.log);
  if (!o.nolog && a !== b) { let i = 0; while (a[i] === b[i]) i++; fail(`log differs\n  native: ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 80))}\n  wasm:   ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 80))}`); }
} catch (e) { res.status = 'ERR'; res.detail = String(e.stack || e).slice(0, 800); }
process.stdout.write(JSON.stringify(res) + '\n');
