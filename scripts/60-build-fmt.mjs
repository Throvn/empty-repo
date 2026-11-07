#!/usr/bin/env node
// Build pdflatex.fmt by running pdftex.wasm itself in -ini mode (a format dumped by one
// binary only loads in that same binary: same word size, same memory parameters).
import fs from 'node:fs';
import path from 'node:path';
import { WEB, loadSystemFS, newEngine } from './node-common.mjs';

const hfs = loadSystemFS({ withFmt: false });
const eng = await newEngine(hfs);
const t0 = performance.now();
const code = eng.run(['pdflatex', '-ini', '-interaction=nonstopmode', '-jobname=pdflatex',
  '-translate-file=cp227.tcx', '*pdflatex.ini']);
const dt = performance.now() - t0;
const fmt = eng.getFile('pdflatex.fmt');
const log = eng.getFile('pdflatex.log');
if (process.env.VERBOSE) { console.log(eng.consoleOutput.slice(-3000)); }
if (!fmt) {
  console.error('format build FAILED, exit', code);
  console.error(eng.consoleOutput.slice(-4000));
  if (log) console.error(Buffer.from(log).toString().slice(-3000));
  process.exit(1);
}
fs.writeFileSync(path.join(WEB, 'pdflatex.fmt'), fmt);
console.log(`pdflatex.fmt: ${fmt.length} bytes, exit ${code}, ${dt.toFixed(0)} ms`);
