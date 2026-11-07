// Shared helpers for node-side scripts (format builder, tests, benchmarks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostFS, TexEngine } from '../web/engine.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB = path.join(ROOT, 'build/web');

export function loadSystemFS({ withFmt = true } = {}) {
  const hfs = new HostFS();
  const data = new Uint8Array(fs.readFileSync(path.join(WEB, 'texlive.data')));
  const meta = JSON.parse(fs.readFileSync(path.join(WEB, 'texlive.json'), 'utf8'));
  hfs.addPack(data, meta);
  const fmt = path.join(WEB, 'pdflatex.fmt');
  if (withFmt && fs.existsSync(fmt)) hfs.addSystemFile('fmt/pdflatex.fmt', new Uint8Array(fs.readFileSync(fmt)));
  return hfs;
}

export async function newEngine(hfs, opts = {}) {
  const wasm = fs.readFileSync(path.join(WEB, 'pdftex.wasm'));
  return TexEngine.create({ wasm, fs: hfs, jsDiffOnly: !!process.env.NO_SIMD_DIFF, ...opts });
}
