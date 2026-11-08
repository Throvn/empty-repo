#!/usr/bin/env node
// e-TRIP test (TeX Live's etriptest.test procedure: compatibility mode, extended mode, e-TeX specific part).
// Every step is run with the native `etex` and with etex.wasm; all terminal outputs, logs, dvitype dumps,
// \openout files and dumped formats' effects must be identical (dates normalised).  The compatibility-mode
// run is additionally compared with Knuth's trip reference through TeX Live's filter.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HostFS, TexEngine } from '../web/engine.js';
import { ROOT } from '../scripts/node-common.mjs';

const SRC = path.join(ROOT, 'build/src/texlive/texk/web2c');
const TT = path.join(SRC, 'triptrap'), ET = path.join(SRC, 'etexdir/etrip');
const TOOLS = path.join(ROOT, 'build/native-tools');
const ENGINE = process.env.ENGINE || 'etex';          // etex | pdftex  (pdfTeX is also an e-TeX implementation)
const wasm = fs.readFileSync(path.join(ROOT, `build/web/${ENGINE}.wasm`));
const NATIVE = ENGINE === 'etex' ? path.join(TOOLS, 'etex') : path.join(ROOT, 'build/gen/pdftex.native');
const PARAMS = { error_line: 64, half_error_line: 32, max_print_line: 72, main_memory: 3999, max_strings: 3300, pool_size: 34000,
  string_vacancies: 8000, font_mem_size: 20000, font_max: 75, stack_size: 200, nest_size: 40, buf_size: 500, save_size: 600, dvi_buf_size: 800 };
if (ENGINE === 'pdftex') Object.assign(PARAMS, { pool_size: 400000, max_strings: 30000, main_memory: 20000, font_mem_size: 40000, font_max: 150, string_vacancies: 20000 });   // pdfTeX's pool/arrays are bigger
const rdf = f => new Uint8Array(fs.readFileSync(f));

/** a tiny "directory" that either lives on disk (native etex) or in memory (etex.wasm) */
class Sandbox {
  constructor(kind) { this.kind = kind; this.dir = path.join(ROOT, 'build/etrip-' + kind); fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true }); }
  put(name, bytes) { fs.writeFileSync(path.join(this.dir, name), bytes); }
  get(name) { const p = path.join(this.dir, name); return fs.existsSync(p) ? rdf(p) : null; }
  mv(a, b) { fs.renameSync(path.join(this.dir, a), path.join(this.dir, b)); }
  tool(t, args, o = {}) { return spawnSync(path.join(TOOLS, t), args, { cwd: this.dir, env: { ...process.env, TEXMFCNF: ET }, ...o }); }
  async etex(argv0Prog, stdinFile) {
    const input = rdf(stdinFile);
    if (this.kind === 'native') return spawnSync(NATIVE, ['--progname=' + argv0Prog, ...(argv0Prog === 'einitex' ? ['--ini'] : [])], { cwd: this.dir, env: { ...process.env, ...PARAMS, TEXMFCNF: ET }, input: Buffer.from(input) }).stdout;
    const hfs = new HostFS();
    for (const f of fs.readdirSync(this.dir)) if (fs.statSync(path.join(this.dir, f)).isFile()) hfs.setUserFile(f, rdf(path.join(this.dir, f)));
    const eng = await TexEngine.create({ wasm, fs: hfs, env: { MINIKPSE_STRICT: '1', ...PARAMS } });
    eng.stdin = input; eng.rawOut = [];
    eng._resetTo(eng.initSnap); eng.incremental = false;
    eng._start(['etex', '--progname=' + argv0Prog, ...(argv0Prog === 'einitex' ? ['--ini'] : [])]);
    for (const f of eng.listFiles()) this.put(f.name, eng.getFile(f.name));    // process exit == files hit the "disk"
    return Buffer.concat(eng.rawOut);
  }
}

async function procedure(kind) {
  const S = new Sandbox(kind), out = {};
  const save = (name, bytes) => { out[name] = Buffer.from(bytes); S.put(name, bytes); };
  S.tool('pltotf', [path.join(TT, 'trip.pl'), 'trip.tfm']); S.tool('tftopl', ['./trip.tfm', 'trip.pl']);
  S.put('trip.tex', rdf(path.join(TT, 'trip.tex')));
  const typ = n => { const r = S.tool('dvitype', ['-output-level=2', '-dpi=72.27', '-page-start=*.*.*.*.*.*.*.*.*.*', n]); return r.stdout; };
  for (const [pre, in1, in2, ini] of [['c', path.join(TT, 'trip1.in'), path.join(TT, 'trip2.in')], ['x', path.join(ET, 'etrip1.in'), path.join(ET, 'trip2.in')]]) {
    save(pre + 'tripin.fot', await S.etex('einitex', in1)); S.mv('trip.log', pre + 'tripin.log'); out[pre + 'tripin.log'] = S.get(pre + 'tripin.log');
    save(pre + 'trip.fot', await S.etex('etex', in2)); S.mv('trip.log', pre + 'trip.log'); out[pre + 'trip.log'] = S.get(pre + 'trip.log');
    S.mv('tripos.tex', pre + 'tripos.tex'); out[pre + 'tripos.tex'] = S.get(pre + 'tripos.tex');
    out[pre + 'trip.typ'] = typ('trip.dvi'); S.mv('trip.fmt', pre + 'trip.fmt');
  }
  S.tool('pltotf', [path.join(ET, 'etrip.pl'), 'etrip.tfm']); S.put('etrip.tex', rdf(path.join(ET, 'etrip.tex')));
  save('etripin.fot', await S.etex('einitex', path.join(ET, 'etrip2.in'))); S.mv('etrip.log', 'etripin.log'); out['etripin.log'] = S.get('etripin.log');
  save('etrip.fot', await S.etex('etex', path.join(ET, 'etrip3.in'))); out['etrip.log'] = S.get('etrip.log'); out['etrip.out'] = S.get('etrip.out');
  out['etrip.typ'] = typ('etrip.dvi');
  return out;
}

// dates in banners / DVI comments are the only intended differences
const norm = b => Buffer.from(b).toString('latin1').replace(/\)  [0-9A-Z: ]*$/gm, ')').replace(/TeX output \d{4}\.\d\d\.\d\d:\d{4}/g, 'TeX output D').replace(/format=\w+ \d{4}\.\d+\.\d+/g, 'format=X');
const nat = await procedure('native'), was = await procedure('wasm');
let ok = true;
for (const k of Object.keys(nat).sort()) {
  const same = was[k] && norm(nat[k]) === norm(was[k]);
  if (!same) ok = false;
  console.log(`${same ? 'ok  ' : 'FAIL'} ${k.padEnd(14)} ${nat[k].length} bytes`);
  if (!same && was[k]) { const a = norm(nat[k]), b = norm(was[k]); let i = 0; while (a[i] === b[i]) i++; console.log('     native:', JSON.stringify(a.slice(Math.max(0, i - 60), i + 60)), '\n     wasm:  ', JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))); }
}
// compatibility mode vs Knuth's reference, with the trip filter
const filter = [...fs.readFileSync(path.join(SRC, 'triptest.test'), 'utf8').matchAll(/cat >>?filter <<-\\_EOF\n([\s\S]*?)\n\t_EOF/g)].map(m => m[1].split('\n').map(l => l.replace(/^\t/, '')).join('\n')).join('\n') + '\n';
fs.writeFileSync('/tmp/etrip.filter', filter);
const sed = (b) => spawnSync('sed', ['-f', '/tmp/etrip.filter'], { input: b }).stdout.toString();
for (const [mine, ref] of [['ctripin.log', 'tripin.log'], ['ctrip.fot', 'trip.fot'], ['ctrip.log', 'trip.log'], ['ctrip.typ', 'trip.typ']]) {
  const same = sed(was[mine]) === sed(fs.readFileSync(path.join(TT, ref)));
  console.log(`${same ? 'ok  ' : 'note'} ${mine} vs Knuth's ${ref} (compat mode, filtered)`);
}
console.log(ok ? `E-TRIP: ${ENGINE}.wasm == native ${ENGINE} on every output` : 'E-TRIP FAILED');
process.exit(ok ? 0 : 1);
