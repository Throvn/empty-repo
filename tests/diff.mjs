#!/usr/bin/env node
// Differential corpus test.  Every case in tests/corpus (hand-written) and build/corpus (tests/gen-corpus.py) is
// compiled by native pdftex (the oracle) and by pdftex.wasm in its own process; the PDF and every other output
// file must be byte-identical, exit codes equal and logs equal modulo line wrapping and paths.
//   node tests/diff.mjs [substring] [-v] [-j N]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const filt = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a)) || '';
const jobs = +(args[args.indexOf('-j') + 1] || 4) || 4;
const gen = path.join(here, '..', 'build', 'corpus');
if (!fs.existsSync(gen)) execFileSync('python3', [path.join(here, 'gen-corpus.py'), gen], { stdio: 'inherit' });
const cases = [];
for (const dir of [path.join(here, 'corpus'), gen]) for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  if (e.name === 'assets') continue;
  if ((e.isDirectory() || e.name.endsWith('.tex')) && e.name.includes(filt)) cases.push(path.join(dir, e.name));
}
cases.sort();
let next = 0, fail = 0, done = 0; const results = [];
const TIMEOUT = 180000;
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    const r = await new Promise(res => {
      const p = spawn('node', [path.join(here, 'diff-one.mjs'), c], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const t = setTimeout(() => { p.kill('SIGKILL'); res({ name: path.basename(c), status: 'ERR', detail: 'timeout' }); }, TIMEOUT);
      p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
      p.on('close', () => { clearTimeout(t); try { res(JSON.parse(out.trim().split('\n').pop())); } catch { res({ name: path.basename(c), status: 'ERR', detail: (err || out).slice(0, 600) }); } });
    });
    results.push(r); done++;
    if (r.status !== 'ok') fail++;
    if (r.status !== 'ok' || args.includes('-v')) console.log(`${r.status.padEnd(4)} ${r.name.padEnd(36)} exit ${r.exit} pdf ${r.pdf} ${r.ms}ms (native ${r.nms}ms)\n${(r.detail || '').split('\n').filter(Boolean).map(l => '   ' + l).join('\n')}`);
    else process.stdout.write(`\r${done}/${cases.length} ok   `);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`\n${fail ? fail + ' FAILED of ' : 'all '}${cases.length} cases${fail ? '' : ' identical to native pdftex'}`);
fs.writeFileSync(path.join(here, '..', 'build', 'diff-results.json'), JSON.stringify(results, null, 1));
process.exit(fail ? 1 : 0);
