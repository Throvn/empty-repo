#!/usr/bin/env node
// Differential corpus test: every tests/corpus/*.tex is compiled by native pdftex and by pdftex.wasm and the
// PDFs must be byte-identical (dates pinned).  usage: node tests/diff.mjs [substring-filter] [-v]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCompile, wasmEngine, wasmCompile, loadAssets, IMAGES, firstDiff, ctx, norm } from './lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const filt = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '';
const verbose = process.argv.includes('-v');
const assets = { ...loadAssets(IMAGES), ...loadAssets(path.join(here, 'corpus/assets')) };
const docs = fs.readdirSync(path.join(here, 'corpus')).filter(f => f.endsWith('.tex') && f.includes(filt)).sort();
let fail = 0;
for (const f of docs) {
  const src = fs.readFileSync(path.join(here, 'corpus', f), 'utf8');
  const opts = /^%!opts:(.*)$/m.exec(src);              // e.g. %!opts: passes=1
  const o = Object.fromEntries((opts ? opts[1].trim().split(/\s+/) : []).map(kv => kv.split('=')));
  const files = { ...assets, 'main.tex': src };
  let nat, was;
  try {
    nat = nativeCompile(files, { passes: +(o.passes ?? 3) });
    const eng = await wasmEngine();
    was = wasmCompile(eng, files, { passes: +(o.passes ?? 3) });
  } catch (e) { console.log(`ERR  ${f}: ${e.stack || e}`); fail++; continue; }
  let status = 'ok', detail = '';
  if (!nat.pdf !== !was.pdf) { status = 'FAIL'; detail = `pdf native=${!!nat.pdf} wasm=${!!was.pdf}`; }
  else if (nat.pdf) {
    const d = firstDiff(nat.pdf, was.pdf);
    if (d >= 0) { status = 'FAIL'; detail = `pdf differs at byte ${d} (native ${nat.pdf.length}, wasm ${was.pdf.length})\n   native ${ctx(nat.pdf, d)}\n   wasm   ${ctx(was.pdf, d)}`; }
  }
  // every other output file (dvi, aux, toc, \openout files ...) must match too; the .log is compared separately
  for (const k of new Set([...Object.keys(nat.outputs), ...Object.keys(was.outputs)])) {
    if (k.endsWith('.log') || k.endsWith('.pdf')) continue;
    const a = nat.outputs[k], b = was.outputs[k];
    if (!a || !b) { status = 'FAIL'; detail += `\n   file ${k}: native=${!!a} wasm=${!!b}`; }
    else if (firstDiff(a, b) >= 0) { status = 'FAIL'; detail += `\n   file ${k} differs at ${firstDiff(a, b)}: native ${ctx(a, firstDiff(a, b))} wasm ${ctx(b, firstDiff(a, b))}`; }
  }
  if (nat.exit !== was.exit) { status = 'FAIL'; detail += ` exit native=${nat.exit} wasm=${was.exit}`; }
  if (norm(nat.log) !== norm(was.log)) { if (status === 'ok') status = 'FAIL'; detail += ' log differs'; if (verbose) { const a = norm(nat.log), b = norm(was.log); let i = 0; while (a[i] === b[i]) i++; detail += `\n   native: ${JSON.stringify(a.slice(Math.max(0,i-50), i+60))}\n   wasm:   ${JSON.stringify(b.slice(Math.max(0,i-50), i+60))}`; } }
  if (status !== 'ok') fail++;
  console.log(`${status.padEnd(4)} ${f.padEnd(34)} exit ${was.exit} ${was.pdf ? 'pdf ' + was.pdf.length : 'no pdf'} ${was.ms.toFixed(0)}ms (native ${nat.ms.toFixed(0)}ms) ${detail}`);
}
console.log(fail ? `${fail} FAILED of ${docs.length}` : `all ${docs.length} identical to native pdftex`);
process.exit(fail ? 1 : 0);
