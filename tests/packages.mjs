#!/usr/bin/env node
// Package coverage: \usepackage{X} for every .sty of the TeX tree, compiled by native pdftex and by pdftex.wasm (tests/diff.mjs
// compares PDF/log/outputs byte for byte).  Prints how many load, and why the others do not (they fail natively too: they need
// another engine, a shell escape, a class, options ...).
//   node tests/packages.mjs [generate|run|report] [filter] [-j N]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const dir = path.join(root, 'build/pkgcorpus');
const mode = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'all';
const rest = process.argv.slice(mode === 'all' ? 2 : 3);

if (mode === 'generate' || mode === 'all') {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const names = new Set();
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.sty')) names.add(e.name.slice(0, -4)); } };
  walk(path.join(root, 'build/texmf/tex'));
  for (const n of [...names].sort()) {
    if (/[^\w.+-]/.test(n)) continue;
    fs.writeFileSync(path.join(dir, `pkg-${n}.tex`), `%!opts:passes=1\n\\documentclass{article}\n\\usepackage{${n}}\n\\begin{document}\nHello $x^2$.\n\\end{document}\n`);
  }
  console.log(`${names.size} packages -> ${dir}`);
}
if (mode === 'run' || mode === 'all') spawnSync('node', [path.join(here, 'diff.mjs'), '--dir', dir, ...rest], { stdio: 'inherit' });
if (mode === 'report' || mode === 'run' || mode === 'all') {
  const res = JSON.parse(fs.readFileSync(path.join(root, 'build/pkgcorpus-results.json'), 'utf8'));
  const ok = res.filter(r => r.status === 'ok' && r.exit === 0), bad = res.filter(r => r.status !== 'ok'), fails = res.filter(r => r.status === 'ok' && r.exit !== 0);
  console.log(`\n${res.length} packages: ${ok.length} load and compile (identical to native), ${fails.length} fail identically to native, ${bad.length} DIFFER from native`);
  for (const r of bad) console.log('  DIFF', r.name, (r.detail || '').split('\n')[0]);
  const groups = new Map();
  for (const r of fails) {
    let k = (r.err || '(no message)').replace(/^\S+:\d+: /, '').replace(/`[^']*'/g, '`…\'').replace(/\d+/g, 'N').slice(0, 90);
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.name.replace(/^pkg-|\.tex$/g, ''));
  }
  console.log('\nwhy the others fail (same on native pdftex):');
  for (const [k, v] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(`  ${String(v.length).padStart(4)}  ${k}   e.g. ${v.slice(0, 4).join(', ')}`);
  fs.writeFileSync(path.join(root, 'build/pkgcorpus-summary.json'), JSON.stringify({ total: res.length, ok: ok.length, sameFail: fails.map(r => [r.name, r.err]), differ: bad.map(r => r.name) }, null, 1));
}
