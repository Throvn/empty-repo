// Shared helpers for node-side scripts (format builder, tests, benchmarks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostFS, TexEngine } from '../web/engine.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB = path.join(ROOT, 'build/web');

const packFds = new Map();
/** read manifest (dist.json) -> layer list; DIST_LAYERS=core restricts it (e.g. to test a minimal distribution) */
export function readManifest(dir = WEB) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'dist.json'), 'utf8'));
  const only = process.env.DIST_LAYERS && process.env.DIST_LAYERS.split(/[ ,]+/);
  if (only) m.layers = m.layers.filter(l => only.includes(l.name));
  return m;
}
/** mount one packed layer from disk, lazily (pread: the packs are hundreds of MB, a compile touches a few files) */
export function mountPackedLayer(hfs, dir, l, { onRead = null, overlay = false } = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, l.index), 'utf8'));
  const file = path.join(dir, l.data);
  if (!packFds.has(file)) packFds.set(file, fs.openSync(file, 'r'));
  const fd = packFds.get(file);
  let byStart = null;
  if (onRead) { byStart = new Map(); for (const [d, n, st] of meta.f) byStart.set(st, (meta.d[d] ? meta.d[d] + '/' : '') + n); }
  return hfs.mountLayer(l.name, { meta, read: (s, e) => { if (onRead) onRead(byStart.get(s)); const b = Buffer.allocUnsafe(e - s); fs.readSync(fd, b, 0, e - s, s); return new Uint8Array(b.buffer, b.byteOffset, b.length); } }, { overlay });
}
/** TeX distribution (every layer of dist.json) + the pre-built LaTeX format */
export function loadSystemFS({ withFmt = true, onRead = null } = {}) {
  const hfs = new HostFS();
  const m = readManifest();
  for (const l of m.layers) mountPackedLayer(hfs, WEB, l, { onRead });
  const fmt = path.join(WEB, m.format || 'pdflatex.fmt');
  if (withFmt && fs.existsSync(fmt)) hfs.addSystemFile('fmt/pdflatex.fmt', new Uint8Array(fs.readFileSync(fmt)));
  return hfs;
}

export async function newEngine(hfs, opts = {}) {
  const wasm = fs.readFileSync(path.join(WEB, 'pdftex.wasm'));
  const bp = path.join(WEB, 'bibtex.wasm');
  const bibtexWasm = fs.existsSync(bp) ? fs.readFileSync(bp) : null;
  const mp = path.join(WEB, 'makeindex.wasm');
  const makeindexWasm = fs.existsSync(mp) ? fs.readFileSync(mp) : null;
  return TexEngine.create({ wasm, bibtexWasm, makeindexWasm, fs: hfs, jsDiffOnly: !!process.env.NO_SIMD_DIFF, ...opts });
}
