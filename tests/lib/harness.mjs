// Differential-test helpers: compile the same project with native pdftex (oracle) and with pdftex.wasm.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSystemFS, newEngine, ROOT } from '../../scripts/node-common.mjs';

export const ENV = { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' };
const REF = path.join(ROOT, 'build/native-ref');
const NATIVE = path.join(ROOT, 'build/native-ref/pdflatex');
const CARRY = /\.(aux|toc|lof|lot|out|nav|snm|bbl|idx|ind|glo|gls|brf)$/;
const here = path.dirname(fileURLToPath(import.meta.url));
export const IMAGES = path.join(here, '..', 'images');

export function loadAssets(dir) {
  const files = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) files[f] = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  return files;
}
export const toBytes = v => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

/** native pdftex in /work (the wasm engine's cwd is also /work, so the PDF /ID matches) */
export function nativeCompile(files, { main = 'main.tex', passes = 3, extraArgs = [] } = {}) {
  fs.rmSync('/work', { recursive: true, force: true }); fs.mkdirSync('/work');
  for (const [n, d] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join('/work', n)), { recursive: true }); fs.writeFileSync(path.join('/work', n), toBytes(d)); }
  const job = main.replace(/\.tex$/, '');
  const args = ['-interaction=nonstopmode', '-file-line-error', '-fmt=pdflatex', ...extraArgs, main];
  let exit = 0, t0 = performance.now();
  const snap = () => Object.fromEntries(fs.readdirSync('/work').filter(f => CARRY.test(f)).map(f => [f, fs.readFileSync('/work/' + f).toString('latin1')]));
  for (let p = 0; p < passes; p++) {
    const before = snap();
    const r = spawnSync(NATIVE, args, { cwd: '/work', env: { ...process.env, ...ENV, TEXMFCNF: REF }, timeout: 120000 });
    exit = r.status ?? -1;
    if (JSON.stringify(snap()) === JSON.stringify(before)) break;
  }
  const rd = f => (fs.existsSync('/work/' + f) ? new Uint8Array(fs.readFileSync('/work/' + f)) : null);
  const outputs = {};     // every file the run produced (not an input)
  const walk = d => { for (const e of fs.readdirSync(path.join('/work', d), { withFileTypes: true })) { const rel = path.join(d, e.name); if (e.isDirectory()) walk(rel); else if (!(rel in files)) outputs[rel] = new Uint8Array(fs.readFileSync(path.join('/work', rel))); } };
  walk('');
  return { exit, pdf: rd(job + '.pdf'), log: rd(job + '.log') && Buffer.from(rd(job + '.log')).toString('latin1'), outputs, ms: performance.now() - t0 };
}

let sysFS = null;
export async function wasmEngine() { sysFS ??= loadSystemFS(); return newEngine(sysFS.fork(), { env: ENV }); }
export function wasmCompile(engine, files, { main = 'main.tex', passes = 3, ...o } = {}) {
  const r = engine.compile(files, { main, maxPasses: passes, ...o });
  const outputs = {};
  for (const f of engine.listFiles()) outputs[f.name] = engine.getFile(f.name);
  return { exit: r.exit, pdf: r.pdf, log: r.log, outputs, ms: r.ms, raw: r };
}

export function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
export function ctx(buf, i) { return JSON.stringify(Buffer.from(buf.subarray(Math.max(0, i - 40), i + 40)).toString('latin1')); }
// logs wrap at max_print_line, so path-length differences move the breaks: compare with newlines removed
export const norm = log => (log || '').split(/Hereishowmuch|Here is how much/)[0].replace(/\s+/g, '').split(ROOT.replace(/\s+/g, '') + '/build/').join('').split('native-ref/').join('')
  .replace(/\d\d?\w{3}\d{4}\d\d:\d\d/g, '').replace(/\(preloadedformat=pdflatex[^)]*\)/, '');
