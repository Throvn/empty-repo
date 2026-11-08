#!/usr/bin/env node
// Incremental-compilation fuzzer.  node tests/fuzz.mjs [filter] [-n edits] [-s seeds] [-j jobs]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2), opt = (k, d) => (a.includes(k) ? +a[a.indexOf(k) + 1] : d);
const filt = a.find(x => !x.startsWith('-') && !/^\d+$/.test(x)) || '';
const N = opt('-n', 12), SEEDS = opt('-s', 1), J = opt('-j', 4);
const gen = path.join(here, '..', 'build', 'corpus');
if (!fs.existsSync(gen)) execFileSync('python3', [path.join(here, 'gen-corpus.py'), gen], { stdio: 'inherit' });
// documents that compile to something non-trivial and exercise state: skip the deliberately pathological/huge ones
const SKIP = /^(tex-(deep|infinite|mem|box-expl|save|input|nest|group-limit-over|long-line|line-breaking-huge|many-macros|token|math-huge)|latex-input-loop|png-|plain-|pdf-)/;
const cases = [path.join(here, '..', 'build', 'long60.tex')];
if (!fs.existsSync(cases[0])) execFileSync('python3', [path.join(here, 'gen-long.py'), '60'], { stdio: ['ignore', fs.openSync(cases[0], 'w'), 'inherit'] });
for (const e of fs.readdirSync(gen, { withFileTypes: true })) if (!SKIP.test(e.name) && e.name.includes(filt)) cases.push(path.join(gen, e.name));
const jobs = []; for (const c of cases) for (let s = 1; s <= SEEDS; s++) jobs.push([c, s]);
let next = 0, fail = 0, done = 0, tot = { edits: 0, resumed: 0, cached: 0, cold: 0, skipped: 0 };
async function worker() {
  while (next < jobs.length) {
    const [c, s] = jobs[next++];
    const r = await new Promise(res => {
      const p = spawn('node', [path.join(here, 'fuzz-one.mjs'), c, String(s * 7919), String(N)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; const t = setTimeout(() => { p.kill('SIGKILL'); res({ name: path.basename(c), status: 'ERR', detail: 'timeout' }); }, 600000);
      p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
      p.on('close', () => { clearTimeout(t); try { res(JSON.parse(out.trim().split('\n').pop())); } catch { res({ name: path.basename(c), status: 'ERR', detail: (err || out).slice(0, 500) }); } });
    });
    done++; for (const k of Object.keys(tot)) tot[k] += r[k] || 0;
    if (r.status !== 'ok') { fail++; console.log(`\n${r.status} ${r.name} (seed ${s * 7919}): ${r.detail}`); }
    else process.stdout.write(`\r${done}/${jobs.length} ok  `);
  }
}
await Promise.all(Array.from({ length: J }, worker));
console.log(`\n${fail ? fail + ' FAILED of ' : 'all '}${jobs.length} edit sequences x ${N} edits: ${tot.edits} edits, passes: ${tot.resumed} resumed / ${tot.cached} cached / ${tot.cold} cold, ${tot.skipped} unconverged skipped`);
process.exit(fail ? 1 : 0);
