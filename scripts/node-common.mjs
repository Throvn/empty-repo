// Shared helpers for node-side scripts (format builder, tests, benchmarks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostFS, TexEngine } from '../web/engine.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB = path.join(ROOT, 'build/web');

let packFd = null;
/** TeX tree: lazily read from texlive.data with pread (the pack can be hundreds of MB; a compile touches a few) */
export function loadSystemFS({ withFmt = true } = {}) {
  const hfs = new HostFS();
  const meta = JSON.parse(fs.readFileSync(path.join(WEB, 'texlive.json'), 'utf8'));
  packFd ??= fs.openSync(path.join(WEB, 'texlive.data'), 'r');
  hfs.addLazyPack((s, e) => { const b = Buffer.allocUnsafe(e - s); fs.readSync(packFd, b, 0, e - s, s); return new Uint8Array(b.buffer, b.byteOffset, b.length); }, meta);
  const fmt = path.join(WEB, 'pdflatex.fmt');
  if (withFmt && fs.existsSync(fmt)) hfs.addSystemFile('fmt/pdflatex.fmt', new Uint8Array(fs.readFileSync(fmt)));
  return hfs;
}

export async function newEngine(hfs, opts = {}) {
  const wasm = fs.readFileSync(path.join(WEB, 'pdftex.wasm'));
  return TexEngine.create({ wasm, fs: hfs, jsDiffOnly: !!process.env.NO_SIMD_DIFF, ...opts });
}
