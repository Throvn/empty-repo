#!/usr/bin/env node
// SyncTeX round trip: every word of a document whose source lines contain unique tokens is mapped back to its source
// line with inverse search (ground truth from the PDF's own word boxes); forward search must land on the right page.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { wasmEngine } from './lib/harness.mjs';
import { parseSynctex, inverse, forward } from '../web/synctex.js';

const lines = ['\\documentclass{article}', '\\usepackage{amsmath}', '\\begin{document}'];
const want = new Map();
let ln = 4;
for (let p = 0; p < 12; p++) {
  const h = 'Heading' + String.fromCharCode(97 + p) + 'zz';
  lines.push('\\section{' + h + '}'); want.set(h, ln++);
  for (let k = 0; k < 4; k++) { const ws = []; for (let w = 0; w < 9; w++) { const t = 'q' + ln + 'x' + w; ws.push(t); want.set(t, ln); } lines.push(ws.join(' ')); ln++; }
  lines.push('Inline $m' + ln + '+y^2$ math \\textbf{b' + ln + '} \\emph{e' + ln + '} end' + ln + '.');
  want.set('b' + ln, ln); want.set('e' + ln, ln); want.set('end' + ln, ln); ln++;
  lines.push(''); ln++;
}
lines.push('\\end{document}');
const eng = await wasmEngine();
const r = eng.compile({ 'main.tex': lines.join('\n') + '\n' }, { maxPasses: 1, synctex: true });
const sx = parseSynctex(Buffer.from(r.synctex).toString());
const tmp = '/tmp/synctex-test.pdf'; fs.writeFileSync(tmp, r.pdf);
const py = ['import pymupdf, json', `d = pymupdf.open('${tmp}'); out = []`, 'for pn, p in enumerate(d, 1):', "    for w in p.get_text('words'): out.append([pn, w[4], w[0], w[1], w[2], w[3]])", 'print(json.dumps(out))'].join('\n');
const words = JSON.parse(execFileSync('python3', ['-c', py], { maxBuffer: 1 << 26 }).toString());
let ok = 0, off1 = 0, tot = 0, fwdOk = 0, fwdTot = 0;
for (const [pn, word, x0, y0, x1, y1] of words) {
  const key = [...want.keys()].find(k => word.startsWith(k)); if (!key) continue;
  tot++; const got = inverse(sx, pn, (x0 + x1) / 2, (y0 + y1) / 2), w = want.get(key);
  if (got && got.line === w) ok++; else if (got && Math.abs(got.line - w) <= 1) off1++;
  const f = forward(sx, 'main.tex', w); fwdTot++; if (f && f.page === pn) fwdOk++;
}
console.log(`inverse: ${ok}/${tot} exact, ${off1} off by one line;  forward: ${fwdOk}/${fwdTot} on the right page`);
const pass = ok / tot >= 0.95 && ok + off1 === tot && fwdOk / fwdTot >= 0.95;
console.log(pass ? 'SYNCTEX OK' : 'SYNCTEX FAILED'); process.exit(pass ? 0 : 1);
