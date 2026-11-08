#!/usr/bin/env node
// Worker for tests/fuzz.mjs: random edit sequence on one corpus case; after every edit the incremental result
// must equal a from-scratch compile.   usage: fuzz-one.mjs <case> <seed> <edits>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wasmEngine, loadAssets, IMAGES } from './lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [target, seedStr, nStr] = process.argv.slice(2);
let seed = +seedStr || 1;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];

const files = { ...loadAssets(IMAGES), ...loadAssets(path.join(here, 'corpus/assets')) };
const walk = (dir, pre = '') => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const rel = pre + e.name; if (e.isDirectory()) walk(path.join(dir, e.name), rel + '/'); else files[rel] = new Uint8Array(fs.readFileSync(path.join(dir, e.name))); } };
if (fs.statSync(target).isDirectory()) walk(target); else files['main.tex'] = new Uint8Array(fs.readFileSync(target));
const dec = b => Buffer.from(b).toString('latin1'), enc = s => new Uint8Array(Buffer.from(s, 'latin1'));
const texNames = Object.keys(files).filter(f => f.endsWith('.tex') || f.endsWith('.sty'));

const SNIPPETS = ['\\textbf{x}', '$x^2$', '\\section{R}', '\\footnote{f}', '\\label{r}', '\\ref{r}', '\\newpage', '}', '{', '\\begin{itemize}', '\\end{itemize}', '\\par', '\\\\', '%', '\\def\\a{b}', '\\emph{', '$$', '\\input{main}', '\\cite{q}', '\\hspace{1cm}', '\\undefinedmacro', '\\clearpage', '\\tableofcontents', '\\verb|x|', '&', '#', '^', '\\end{document}', '\\begin{figure}\\end{figure}', '\\pagebreak', '\\vspace{3cm}', 'lorem ipsum ', '\\item x', '\\bibitem{q}', '\\index{z}'];
function mutate(text) {
  const lines = text.split('\n');
  const op = Math.floor(rnd() * 9), i = Math.floor(rnd() * lines.length);
  switch (op) {
    case 0: { const w = lines[i].split(' '); if (w.length) w[Math.floor(rnd() * w.length)] = pick(['foo', 'bar', 'baz', '\\LaTeX', '$y$', '']); lines[i] = w.join(' '); break; }
    case 1: lines.splice(i, 1); break;
    case 2: lines.splice(i, 0, lines[i]); break;
    case 3: lines.splice(i, 0, pick(SNIPPETS)); break;
    case 4: { const j = Math.floor(rnd() * lines.length); [lines[i], lines[j]] = [lines[j], lines[i]]; break; }
    case 5: { const l = lines[i]; if (l.length) { const k = Math.floor(rnd() * l.length); lines[i] = l.slice(0, k) + pick(['', 'x', '\\', '{', '}', '$', '%', ' ']) + l.slice(k + 1); } break; }
    case 6: lines[i] = lines[i] + pick(SNIPPETS); break;
    case 7: return text.slice(0, Math.floor(rnd() * text.length));                // truncate
    case 8: lines.splice(i, 0, pick(SNIPPETS), pick(SNIPPETS)); break;
  }
  return lines.join('\n');
}

const res = { name: path.basename(target), status: 'ok', detail: '', edits: 0, resumed: 0, cached: 0, cold: 0 };
const eq = (a, b) => (!a && !b) || (a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
try {
  const eng = await wasmEngine();
  const cur = { ...files };
  let r = eng.compile(cur, { maxPasses: 5 });
  for (let k = 0; k < +nStr; k++) {
    const f = pick(texNames);
    const before = dec(cur[f]);
    const after = mutate(before);
    cur[f] = enc(after);
    r = eng.compile(cur, { maxPasses: 5 });
    res.edits++;
    for (const p of r.passes) res[p.mode === 'resume' ? 'resumed' : p.mode === 'cached' ? 'cached' : 'cold']++;
    const ref = (await wasmEngine()).compile(cur, { maxPasses: 5, incremental: false });
    // not converged within the pass budget => the fixpoint iteration may legitimately differ (stale aux); skip
    const refConv = ref.passes.length < 5 || ref.converged, myConv = r.converged;
    if (!(refConv && myConv)) { res.skipped = (res.skipped || 0) + 1; continue; }
    const same = eq(r.pdf, ref.pdf) && r.exit === ref.exit;
    if (!same) {
      res.status = 'FAIL';
      res.detail = `edit ${k + 1} in ${f}: pdf ${r.pdf ? r.pdf.length : 'none'} vs cold ${ref.pdf ? ref.pdf.length : 'none'}, exit ${r.exit} vs ${ref.exit}; passes ${JSON.stringify(r.passes.map(p => p.mode + '@' + (p.resumedAtEvent ?? '')))}`;
      fs.mkdirSync(path.join(here, '..', 'build', 'fuzz-fail'), { recursive: true });
      fs.writeFileSync(path.join(here, '..', 'build', 'fuzz-fail', `${res.name}-${seedStr}-edit${k + 1}.json`), JSON.stringify({ before, after, file: f, seed: seedStr, k }));
      break;
    }
  }
} catch (e) { res.status = 'ERR'; res.detail = String(e.stack || e).slice(0, 600); }
process.stdout.write(JSON.stringify(res) + '\n');
