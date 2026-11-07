#!/usr/bin/env node
// Correctness + speed test of snapshot-based incremental compilation.
//  1. cold compile of a long document
//  2. edit text near the end            -> must resume from a late snapshot
//  3. edit text near the start          -> resumes early
//  4. edit that changes cross references -> aux fixpoint passes
//  5. every result must be byte-identical to a from-scratch compile of the same sources
import fs from 'node:fs';
import { loadSystemFS, newEngine } from '../scripts/node-common.mjs';

const ENV = { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' };
const hfsShared = loadSystemFS();               // read-only pack, shared by all engines
const base = fs.readFileSync(new URL('./long.tex', import.meta.url), 'utf8');

async function fresh() { return newEngine(hfsShared.clone ? hfsShared.clone() : loadSystemFS(), { env: ENV }); }
const eq = (a, b) => a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const fmt = r => `${r.ms.toFixed(0).padStart(5)} ms  passes=[${r.passes.map(p => p.mode + (p.mode === 'resume' ? '@' + p.resumedAtEvent + '/' + p.events : '') + ':' + p.ms.toFixed(0)).join(', ')}]  snaps=${r.stats.snapshotsHeld}`;

async function cold(text) {
  const e = await fresh();
  return e.compile({ 'main.tex': text }, { incremental: false });
}

const eng = await newEngine(loadSystemFS(), { env: ENV });
let text = base;
let r = eng.compile({ 'main.tex': text });
console.log('cold            ', fmt(r), 'pdf', r.pdf?.length);
console.log('  snapshots:', eng.stats.snapshots, 'capture ms total', eng.stats.snapshotMs.toFixed(0), 'restore ms', eng.stats.restoreMs.toFixed(0));

const edits = [
  ['same text (no change)', t => t],
  ['edit near END   ', t => t.replace('Section number 58', 'Section number FIFTY-EIGHT')],
  ['edit mid-document', t => t.replace('Section number 30', 'Section number THIRTY')],
  ['edit near START ', t => t.replace('Section number 3}', 'Section number THREE}')],
  ['append a sentence at end', t => t.replace('\\end{document}', 'The very last sentence.\n\\end{document}')],
  ['edit preamble (title)', t => t.replace('Long document', 'A longer title for this document')],
];
let ok = true;
for (const [name, f] of edits) {
  text = f(text);
  const t0 = performance.now();
  r = eng.compile({ 'main.tex': text });
  const ref = await cold(text);
  const same = eq(r.pdf, ref.pdf);
  ok &&= same;
  console.log(name.padEnd(26), fmt(r), same ? 'IDENTICAL to cold' : '*** DIFFERS ***', `(cold: ${ref.ms.toFixed(0)} ms)`);
}
console.log(ok ? 'ALL OK' : 'FAILURES');
process.exit(ok ? 0 : 1);
