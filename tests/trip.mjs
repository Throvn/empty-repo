#!/usr/bin/env node
// Knuth's TRIP test for tex.wasm -- the same procedure as TeX Live's triptest.test:
//   pltotf/tftopl (native) -> tex --ini <trip1.in (wasm) -> tex <trip2.in (wasm) -> dvitype (native)
// and the results are compared with Knuth's reference files through TeX Live's own `sed` filter, which
// removes exactly the differences the trip manual allows (dates, memory constants, glue rounding...).
// `--native` runs the identical procedure with the native `tex` instead (sanity check of the harness).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HostFS, TexEngine } from '../web/engine.js';
import { ROOT } from '../scripts/node-common.mjs';

const SRC = path.join(ROOT, 'build/src/texlive/texk/web2c');
const TT = path.join(SRC, 'triptrap');
const TOOLS = path.join(ROOT, 'build/native-tools');
const D = path.join(ROOT, 'build/trip');
const native = process.argv.includes('--native');
fs.rmSync(D, { recursive: true, force: true }); fs.mkdirSync(path.join(D, 'a'), { recursive: true }); fs.mkdirSync(path.join(D, 'b'));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: D, env: { ...process.env, TEXMFCNF: TT, LC_ALL: 'C' }, ...opts });
const rd = f => new Uint8Array(fs.readFileSync(path.join(D, f)));
let ok = true;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) ok = false; };

// --- parameters from triptrap/texmf.cnf (everything else: TeX's compile-time defaults)
const PARAMS = { error_line: 64, half_error_line: 32, max_print_line: 72, mem_bot: 1, main_memory: 3000, max_strings: 3000,
  string_vacancies: 8000, pool_size: 40000, font_mem_size: 20000, font_max: 75, stack_size: 200, nest_size: 40,
  buf_size: 500, save_size: 600, dvi_buf_size: 800 };

// --- trip.tfm from trip.pl, and the round trip
check('pltotf trip.pl', sh(path.join(TOOLS, 'pltotf'), [path.join(TT, 'trip.pl'), 'trip.tfm']).status === 0);
check('tftopl trip.tfm', sh(path.join(TOOLS, 'tftopl'), ['./trip.tfm', 'trip.pl']).status === 0);
check('trip.pl round trip', sh('diff', [path.join(TT, 'trip.pl'), 'trip.pl']).status === 0);
fs.copyFileSync(path.join(TT, 'trip.tex'), path.join(D, 'trip.tex'));

// --- run tex (wasm or native)
const wasm = fs.readFileSync(path.join(ROOT, 'build/web/tex.wasm'));
async function runTex(args, stdinFile, files) {
  const input = new Uint8Array(fs.readFileSync(path.join(TT, stdinFile)));
  if (native) {
    const r = sh(path.join(TOOLS, 'tex'), args.slice(1), { input: Buffer.from(input) });
    return { fot: new Uint8Array(r.stdout), file: f => (fs.existsSync(path.join(D, f)) ? rd(f) : null), files: fs.readdirSync(D) };
  }
  const hfs = new HostFS();
  for (const [n, d] of Object.entries(files)) hfs.setUserFile(n, d);
  const eng = await TexEngine.create({ wasm, fs: hfs, env: { MINIKPSE_STRICT: '1', ...PARAMS } });
  eng.stdin = input; eng.rawOut = [];
  eng._resetTo(eng.initSnap); eng.incremental = false;
  const code = eng._start(args);
  const fot = Buffer.concat(eng.rawOut);
  return { fot: new Uint8Array(fot), code, file: f => eng.getFile(f), files: eng.listFiles().map(x => x.name) };
}
const base = { 'trip.tex': rd('trip.tex'), 'trip.tfm': rd('trip.tfm') };

const r1 = await runTex(['tex', '--progname=initex', '--ini'], 'trip1.in', base);
fs.writeFileSync(path.join(D, 'tripin.fot'), r1.fot);
const fmt = r1.file('trip.fmt'); if (!fmt) console.log(Buffer.from(r1.fot).toString().slice(-600));
check('trip.fmt created by trip1.in', fmt && fmt.length > 0, fmt ? `${fmt.length} bytes` : '');
if (!fmt) process.exit(1);
fs.writeFileSync(path.join(D, 'tripin.log'), r1.file('trip.log'));
fs.writeFileSync(path.join(D, 'trip.fmt'), fmt);

const r2 = await runTex(['tex', '--progname=tex'], 'trip2.in', { ...base, 'trip.fmt': fmt });
fs.writeFileSync(path.join(D, 'trip.fot'), r2.fot);
fs.writeFileSync(path.join(D, 'trip.log'), r2.file('trip.log'));
for (const f of ['tripos.tex', 'trip.dvi', '8terminal.tex']) { const b = r2.file(f); if (b) fs.writeFileSync(path.join(D, f), b); }
check('trip.dvi produced', fs.existsSync(path.join(D, 'trip.dvi')));
check('tripos.tex identical to reference', sh('diff', [path.join(TT, 'tripos.tex'), 'tripos.tex']).status === 0);

// --- dvitype
const typ = sh(path.join(TOOLS, 'dvitype'), ['-output-level=2', '-dpi=72.27', '-page-start=*.*.*.*.*.*.*.*.*.*', 'trip.dvi']);
fs.writeFileSync(path.join(D, 'trip.typ'), typ.stdout);

// --- TeX Live's own filter (extracted from triptest.test), applied to reference and to our output
const script = fs.readFileSync(path.join(SRC, 'triptest.test'), 'utf8');
const filter = [...script.matchAll(/cat >>?filter <<-\\_EOF\n([\s\S]*?)\n\t_EOF/g)].map(m => m[1].split('\n').map(l => l.replace(/^\t/, '')).join('\n')).join('\n') + '\n';
fs.writeFileSync(path.join(D, 'filter'), filter);
for (const f of ['tripin.log', 'trip.fot', 'trip.log', 'trip.typ']) {
  fs.writeFileSync(path.join(D, 'a', f), sh('sed', ['-f', 'filter', path.join(TT, f)]).stdout);
  fs.writeFileSync(path.join(D, 'b', f), sh('sed', ['-f', 'filter', f]).stdout);
  const d = sh('diff', [path.join('a', f), path.join('b', f)]);
  const nlines = d.stdout.toString().split('\n').length - 1;
  check(`${f} matches Knuth's reference (after TeX Live's filter)`, d.status === 0, d.status === 0 ? '' : `\n${d.stdout.toString().slice(0, 1500)}`);
}
console.log(ok ? `TRIP TEST PASSED (${native ? 'native tex' : 'tex.wasm'})` : `TRIP TEST FAILED (${native ? 'native tex' : 'tex.wasm'})`);
process.exit(ok ? 0 : 1);
