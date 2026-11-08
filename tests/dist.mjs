#!/usr/bin/env node
// The TeX distribution is pluggable: layers can be left out, added and removed at run time; packages can be installed from
// archives (TDS, flat, docstrip sources) and loose files, fonts included.  Every case compiles real documents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HostFS, TexEngine } from '../web/engine.js';
import { installPackage, removePackage, readArchive, layerProvides } from '../web/dist.js';
import { readManifest, mountPackedLayer, WEB, ROOT } from '../scripts/node-common.mjs';

let bad = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) bad++; };
const wasm = fs.readFileSync(path.join(WEB, 'pdftex.wasm'));
const fmt = new Uint8Array(fs.readFileSync(path.join(WEB, 'pdflatex.fmt')));
const mk = (layers) => {
  const h = new HostFS();
  for (const l of readManifest().layers) if (layers.includes(l.name)) mountPackedLayer(h, WEB, l);
  h.addSystemFile('fmt/pdflatex.fmt', fmt);
  return h;
};
const engineFor = h => TexEngine.create({ wasm, fs: h, env: { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' } });
const doc = body => ({ 'main.tex': `\\documentclass{article}\n${body}\n` });
const err = r => (r.log.match(/^!.*$/m) || [''])[0];

// ---- 1. a minimal distribution: core only; the extra layer is plugged in at run time
{
  const h = mk(['core']); const e = await engineFor(h);
  let r = e.compile(doc('\\usepackage{amsmath}\\begin{document}$x^2$\\end{document}'), { maxPasses: 1 });
  check('core only: article + amsmath compiles', r.exit === 0 && r.pdf && r.pdf.length > 1000);
  r = e.compile(doc('\\usepackage{tikz}\\begin{document}x\\end{document}'), { maxPasses: 1 });
  check('core only: tikz is reported missing, no crash', r.exit !== 0 && /tikz\.sty.*not found/.test(r.log), err(r));
  const t0 = performance.now();
  const l = readManifest().layers.find(x => x.name === 'extra');
  mountPackedLayer(h, WEB, l);
  r = e.compile(doc('\\usepackage{tikz}\\begin{document}\\tikz\\draw(0,0)--(1,1);\\end{document}'), { maxPasses: 1 });
  check('plugging in the extra layer makes tikz work (same engine, restarts cold)', r.exit === 0 && r.passes[0].mode === 'cold' && r.pdf, `${(performance.now() - t0).toFixed(0)} ms`);
  check('layers listed', [...h.layerInfo.keys()].join() === 'core,extra', [...h.layerInfo.keys()].join());
}

// ---- 2. installing packages from archives
const full = mk(['core', 'extra']);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
const zip = (name, files) => {            // real deflate zip via python
  const dir = path.join(work, name + '.d'); fs.mkdirSync(dir, { recursive: true });
  for (const [p, d] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), d); }
  const out = path.join(work, name);
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nfor dp,_,fs in os.walk(sys.argv[2]):\n  for f in fs:\n    p=os.path.join(dp,f); z.write(p, os.path.relpath(p, sys.argv[2]))\nz.close()', out, dir]);
  return new Uint8Array(fs.readFileSync(out));
};
const tar = (name, files) => {
  const dir = path.join(work, name + '.d'); fs.mkdirSync(dir, { recursive: true });
  for (const [p, d] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), d); }
  const out = path.join(work, name); execFileSync('tar', ['czf', out, '-C', dir, '.']); return new Uint8Array(fs.readFileSync(out));
};
const createEngine = f => TexEngine.create({ wasm, fs: f, env: { SOURCE_DATE_EPOCH: '1700000000' } });

{ // flat zip, wrapped in a directory, .sty only
  const z = zip('hello.zip', { 'hellopkg/hellopkg.sty': '\\ProvidesPackage{hellopkg}\\newcommand{\\hello}{HELLO-FROM-PLUGIN}\n' });
  const e = await engineFor(full);
  const info = await installPackage(full, 'hellopkg', await readArchive(z, 'hello.zip'), { createEngine });
  const r = e.compile(doc('\\usepackage{hellopkg}\\begin{document}\\hello\\end{document}'), { maxPasses: 1 });
  check('flat zip package installs and works', r.exit === 0 && r.pdf && info.note === 'flat package', JSON.stringify({ files: info.files, note: info.note }));
  check('package provides list', layerProvides(full, 'hellopkg').join() === 'hellopkg.sty');
  removePackage(full, 'hellopkg');
  const r2 = e.compile(doc('\\usepackage{hellopkg}\\begin{document}\\hello\\end{document}'), { maxPasses: 1 });
  check('removing it makes it missing again', r2.exit !== 0 && /hellopkg\.sty.*not found/.test(r2.log));
}
{ // TDS tar.gz overriding a distribution package: overlay wins, removal restores
  const t = tar('over.tgz', { 'tex/latex/xcolor/xcolor.sty': '\\ProvidesPackage{xcolor}\\def\\marker{OVERLAY-XCOLOR}\n', 'bibtex/bst/mine/mine.bst': 'ENTRY{}{}{}\nREAD\nFUNCTION{x}{}\nITERATE{x}\n' });
  const e = await engineFor(full);
  const info = await installPackage(full, 'over', await readArchive(t, 'over.tgz'));
  check('TDS tar.gz recognised', info.note === 'TDS layout' && info.files === 2, JSON.stringify(info));
  let r = e.compile(doc('\\usepackage{xcolor}\\begin{document}\\show\\marker\\end{document}'), { maxPasses: 1 });
  check('overlay layer shadows the distribution file', /OVERLAY-XCOLOR/.test(r.log), (r.log.match(/> \\marker=.*/) || [''])[0]);
  removePackage(full, 'over');
  r = e.compile(doc('\\usepackage{xcolor}\\begin{document}\\textcolor{red}{x}\\end{document}'), { maxPasses: 1 });
  check('removal restores the original', r.exit === 0 && !/OVERLAY/.test(r.log));
}
{ // docstrip sources: .ins + .dtx, no generated files -> latex runs inside the engine
  const dtx = '% \\iffalse\n%<*package>\n%</package>\n% \\fi\n% \\begin{macrocode}\n%<*package>\n\\ProvidesPackage{dsdemo}[2024/01/01 demo]\n\\newcommand{\\dsdemo}{DOCSTRIP-OK}\n%</package>\n% \\end{macrocode}\n\\endinput\n';
  const ins = '\\input docstrip.tex\n\\keepsilent\n\\askforoverwritefalse\n\\generate{\\file{dsdemo.sty}{\\from{dsdemo.dtx}{package}}}\n\\endbatchfile\n';
  const z = zip('dsdemo.zip', { 'dsdemo/dsdemo.ins': ins, 'dsdemo/dsdemo.dtx': dtx });
  const e = await engineFor(full);
  const info = await installPackage(full, 'dsdemo', await readArchive(z, 'dsdemo.zip'), { createEngine });
  check('docstrip ran and generated the .sty', info.generated.includes('dsdemo.sty'), JSON.stringify(info.generated));
  const r = e.compile(doc('\\usepackage{dsdemo}\\begin{document}\\dsdemo\\end{document}'), { maxPasses: 1 });
  check('docstrip-generated package works', r.exit === 0 && r.pdf);
}
{ // fonts: TFM + Type 1 + map file installed as loose files; pdftex.map is merged
  const src = n => new Uint8Array(fs.readFileSync(path.join(ROOT, 'build/texmf', n)));
  const files = {
    'myf10.tfm': src('fonts/tfm/public/cm/cmr10.tfm'),
    'myfont.pfb': src('fonts/type1/public/amsfonts/cm/cmr10.pfb'),
    'myf.map': new TextEncoder().encode('myf10 CMR10 <myfont.pfb\n'),
    'myfontpkg.sty': new TextEncoder().encode('\\ProvidesPackage{myfontpkg}\\font\\myfnt=myf10 at 12pt\\newcommand{\\usemyfnt}{\\myfnt Custom font text}\n'),
  };
  const e = await engineFor(full);
  const info = await installPackage(full, 'myfonts', new Map(Object.entries(files)));
  const r = e.compile(doc('\\usepackage{myfontpkg}\\begin{document}\\usemyfnt\\end{document}'), { maxPasses: 1 });
  check('user font (tfm+pfb+map) embeds through the merged pdftex.map', r.exit === 0 && /fonts\/type1\/myfonts\/myfont\.pfb>/.test(r.log) && info.maps === 1, `maps merged: ${info.maps}`);
}
{ // the package is also found when it ships only in the *project* (no install): a sanity check of the existing path
  const e = await engineFor(full);
  const r = e.compile({ 'main.tex': '\\documentclass{article}\\usepackage{local}\\begin{document}\\loc\\end{document}', 'local.sty': '\\ProvidesPackage{local}\\newcommand{\\loc}{LOCAL}' }, { maxPasses: 1 });
  check('project-local .sty', r.exit === 0 && r.pdf);
}
fs.rmSync(work, { recursive: true, force: true });
console.log(bad ? `${bad} FAILED` : 'all distribution tests passed');
process.exit(bad ? 1 : 0);
