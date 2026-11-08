#!/usr/bin/env node
// usage: node scripts/node-compile.mjs file.tex [out.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { loadSystemFS, newEngine } from './node-common.mjs';
const src = process.argv[2], out = process.argv[3] || src.replace(/\.tex$/, '.pdf');
const hfs = loadSystemFS();
const name = path.basename(src);
hfs.setUserFile(name, new Uint8Array(fs.readFileSync(src)));
const eng = await newEngine(hfs);
const t0 = performance.now();
const code = eng.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', '-fmt=pdflatex', name]);
const dt = performance.now() - t0;
const job = name.replace(/\.tex$/, '');
const pdf = eng.getFile(job + '.pdf');
console.log(`exit ${code}, ${dt.toFixed(0)} ms, pdf ${pdf ? pdf.length : 'none'} bytes`);
if (pdf) fs.writeFileSync(out, pdf); else console.log(Buffer.from(eng.getFile(job + '.log') || []).toString().slice(-2000) || eng.consoleOutput);
