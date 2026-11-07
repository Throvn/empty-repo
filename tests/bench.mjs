#!/usr/bin/env node
// Benchmark: cold vs. incremental recompilation on a large synthetic document.
//   node tests/bench.mjs [file.tex]
import fs from 'node:fs';
import { loadSystemFS, newEngine } from '../scripts/node-common.mjs';
const file = process.argv[2] || new URL('./long.tex', import.meta.url);
const base = fs.readFileSync(file, 'utf8');
const lines = base.split('\n');
const eng = await newEngine(loadSystemFS(), { env: { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' } });
const fmt = r => `${r.ms.toFixed(0).padStart(6)} ms  [${r.passes.map(p => p.mode + (p.mode === 'resume' ? '@' + p.resumedAtEvent + '/' + p.events : '')).join(' + ')}]`;
const rss = () => (process.memoryUsage().rss / 1048576).toFixed(0) + ' MB rss';

let r = eng.compile({ 'main.tex': base }, { maxPasses: 3 });
const pages = (Buffer.from(r.pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`document: ${lines.length} lines, ${pages} pages`);
console.log('cold (3 passes) ', fmt(r), rss(), ` snapshots held ${eng.snapshots.length}`);
r = eng.compile({ 'main.tex': base }, { maxPasses: 1, incremental: true });
console.log('no change       ', fmt(r));
// edit a word at various relative positions (text only: aux stays identical)
for (const frac of [0.02, 0.25, 0.5, 0.75, 0.98]) {
  const ls = lines.slice(); let i = Math.floor(frac * ls.length);
  while (!/^[a-z]/.test(ls[i])) i++;
  ls[i] = 'EDITED ' + ls[i];
  const t = ls.join('\n');
  r = eng.compile({ 'main.tex': t }, { maxPasses: 1 });
  const cold = newEngine(loadSystemFS(), { env: { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' } });
  // single-pass cold reference with the same aux state is not comparable; report plain cold single pass
  const c = (await cold).compile({ 'main.tex': t }, { maxPasses: 1, incremental: false });
  console.log(`edit at ${(frac * 100).toFixed(0).padStart(3)}%    `, fmt(r), `  (cold single pass: ${c.ms.toFixed(0)} ms)`, rss());
  eng.compile({ 'main.tex': base }, { maxPasses: 1 });   // go back to base
}
console.log('stats', JSON.stringify(eng.stats));
