// Differential-test helpers: compile the same project with native pdftex (oracle) and with pdftex.wasm.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSystemFS, newEngine, ROOT } from '../../scripts/node-common.mjs';

export const ENV = { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' };
const REF = path.join(ROOT, 'build/native-ref');
const NATIVE = path.join(ROOT, 'build/native-ref/pdflatex');
const NO_CARRY = /\.(pdf|log|dvi|xdv|fmt|synctex(\.gz)?)$/;   // everything else a run writes is an input of the next one
const here = path.dirname(fileURLToPath(import.meta.url));
export const IMAGES = path.join(here, '..', 'images');

export function loadAssets(dir) {
  const files = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) files[f] = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  return files;
}
export const toBytes = v => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

/** native pdftex in /work (the wasm engine's cwd is also /work, so the PDF /ID matches) */
export function nativeCompile(files, { main = 'main.tex', passes = 3, extraArgs = [], ini = false } = {}) {
  const W = `/tmp/ntv-${process.pid}`;
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W);
  for (const [n, d] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(W, n)), { recursive: true }); fs.writeFileSync(path.join(W, n), toBytes(d)); }
  const job = main.replace(/\.tex$/, '');
  const args = ini ? ['-ini', '-interaction=nonstopmode', '-file-line-error', main] : ['-interaction=nonstopmode', '-file-line-error', '-fmt=pdflatex', ...extraArgs, main];
  let exit = 0, t0 = performance.now();
  const snap = () => Object.fromEntries(fs.readdirSync(W).filter(f => fs.statSync(W + '/' + f).isFile() && !NO_CARRY.test(f) && !(f in files)).map(f => [f, fs.readFileSync(W + '/' + f).toString('latin1')]));
  for (let p = 0; p < passes; p++) {
    const before = snap();
    const r = spawnSync(ini ? NATIVE.replace(/pdflatex$/, 'pdftex') : NATIVE, args, { maxBuffer: 1 << 28, cwd: W, env: { ...process.env, ...ENV, TEXMFCNF: REF }, timeout: 120000 });
    exit = r.status ?? -1;
    if (JSON.stringify(snap()) === JSON.stringify(before)) break;
  }
  const rd = f => (fs.existsSync(W + '/' + f) ? new Uint8Array(fs.readFileSync(W + '/' + f)) : null);
  const outputs = {};     // every file the run produced (not an input)
  const walk = d => { for (const e of fs.readdirSync(path.join(W, d), { withFileTypes: true })) { const rel = path.join(d, e.name); if (e.isDirectory()) walk(rel); else if (!(rel in files)) outputs[rel] = new Uint8Array(fs.readFileSync(path.join(W, rel))); } };
  walk('');
  const res = { exit, pdf: rd(job + '.pdf'), log: rd(job + '.log') && Buffer.from(rd(job + '.log')).toString('latin1'), outputs, ms: performance.now() - t0 };
  fs.rmSync(W, { recursive: true, force: true });
  return res;
}

let sysFS = null;
export async function wasmEngine() { sysFS ??= loadSystemFS(); return newEngine(sysFS.fork(), { env: ENV }); }
export function wasmCompile(engine, files, { main = 'main.tex', passes = 3, ini = false, ...o } = {}) {
  const r = engine.compile(files, { main, maxPasses: passes, ...(ini ? { argv: ['pdftex', '-ini', '-interaction=nonstopmode', '-file-line-error', main] } : {}), ...o });
  const outputs = {};
  for (const f of engine.listFiles()) outputs[f.name] = engine.getFile(f.name);
  const rawLog = outputs[main.replace(/\.tex$/, '') + '.log'];
  return { exit: r.exit, pdf: r.pdf, log: rawLog ? Buffer.from(rawLog).toString('latin1') : r.log, outputs, ms: r.ms, raw: r };
}

export function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
export function ctx(buf, i) { return JSON.stringify(Buffer.from(buf.subarray(Math.max(0, i - 40), i + 40)).toString('latin1')); }
// logs wrap at max_print_line, so path-length differences move the breaks: compare with newlines removed
export const norm = log => (log || '').split(/Hereishowmuch|Here is how much/)[0].replace(/\s+/g, '').split(ROOT.replace(/\s+/g, '') + '/build/').join('').split('native-ref/').join('')
  .replace(/\d\d?\w{3}\d{4}\d\d:\d\d/g, '').replace(/Memoryusagebefore:\d+&\d+;after:\d+&\d+;stilluntouched:\d+/g, 'MEMUSAGE').replace(/\(preloadedformat=pdflatex[^)]*\)/, '');
