#!/usr/bin/env node
// Which TeX-tree files does a *typical* document read?  Compile representative documents, record every system file
// they touch and stage them in build/hot-tree (packed into hot.data by 70-package-web.sh).  The browser seeds these into
// memory at start-up, so the first compile needs (almost) no range requests.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WEB, loadSystemFS, newEngine } from './node-common.mjs';

const used = new Set();
const sys = loadSystemFS({ onRead: p => p && used.add(p) });
const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const sample = /const SAMPLE = String\.raw`([\s\S]*?)`;/.exec(html)[1];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const bib = '@book{k, author={A. Author}, title={T}, year=2000, publisher={P}}\n';
const docs = [
  { 'main.tex': sample, 'x.png': new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/images/rgb8.png'))) },
  { 'main.tex': read('tests/hello.tex') },
  { 'main.tex': read('tests/packages.tex') },
  { 'main.tex': '\\documentclass{article}\\usepackage[utf8]{inputenc}\\usepackage[T1]{fontenc}\\usepackage{lmodern,amsmath,amssymb,amsthm,graphicx,xcolor,booktabs,hyperref,geometry,natbib}\\begin{document}\\section{A}\\cite{k} $x^2$\\begin{tabular}{ll}\\toprule a&b\\\\\\bottomrule\\end{tabular}\\bibliographystyle{plainnat}\\bibliography{r}\\end{document}', 'r.bib': bib },
  { 'main.tex': '\\documentclass{article}\\usepackage{tikz}\\begin{document}\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\\end{document}' },
  { 'main.tex': '\\documentclass{beamer}\\begin{document}\\begin{frame}{T}x\\end{frame}\\end{document}' },
  { 'main.tex': '\\documentclass{report}\\usepackage{enumitem,multirow,listings,siunitx,subcaption,fancyhdr,titlesec,caption,float,mathtools,microtype}\\begin{document}\\chapter{A}x\\end{document}' },
  { 'main.tex': '\\documentclass{scrartcl}\\usepackage[ngerman]{babel}\\begin{document}Hallo\\end{document}' },
];
for (const files of docs) { const e = await newEngine(sys.fork()); e.compile(files, { maxPasses: 3 }); }
const TREE = path.join(ROOT, 'build/hot-tree');
fs.rmSync(TREE, { recursive: true, force: true });
let bytes = 0;
for (const p of used) {
  const rel = p.replace(/^texmf\//, '');
  const src = path.join(ROOT, 'build/texmf', rel);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(path.join(TREE, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(TREE, rel)); bytes += fs.statSync(src).size;
}
console.log(`hot set: ${used.size} files, ${(bytes / 1048576).toFixed(1)} MB`);
