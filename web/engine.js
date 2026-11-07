// engine.js -- host side of pdftex.wasm (runs unchanged in browsers, workers and node >= 20).
//
//  * HostFS     : the files the engine can *read* (TeX tree pack + the user's project files)
//  * TexEngine  : instantiates pdftex.wasm, implements its few imports, runs the engine and
//                 implements TeXpresso-style incremental compilation:
//
//    TeXpresso forks the TeX process at interesting points and, when the user edits a file,
//    rolls back to the latest fork that has not yet *read* any changed byte.  Here the "fork" is
//    a snapshot of the wasm linear memory taken through ASYNCIFY:
//
//      engine reads a line of a user file -> host_want_snapshot() says yes ->
//      host_snapshot() (asyncify import) unwinds the wasm call stack into a buffer that lives in
//      linear memory -> JS copies linear memory (delta-compressed in 4 KiB chunks) ->
//      asyncify_start_rewind() + re-enter: the program continues as if nothing happened.
//
//    To resume a snapshot: copy its memory back, restore the C stack pointer global,
//    asyncify_start_rewind() and call the entry point again: the saved call stack is rebuilt
//    and execution continues *inside host_snapshot()* of the original run.
//
//  The wasm module keeps ALL other state (virtual files it writes, stdio, heap...) in linear
//  memory, so the only external state we have to roll back is our own bookkeeping:
//  the read trace and the captured console output.

const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Where each kpathsea "format" may find files in the packed tree.
const FMT_DIRS = {
  tex: ['texmf/tex/'], tfm: ['texmf/fonts/tfm/'], ofm: ['texmf/fonts/ofm/'], vf: ['texmf/fonts/vf/'],
  type1: ['texmf/fonts/type1/'], truetype: ['texmf/fonts/truetype/'], opentype: ['texmf/fonts/opentype/'],
  enc: ['texmf/fonts/enc/'], map: ['texmf/fonts/map/'], fmt: ['fmt/', 'texmf/web2c/'],
  pool: ['texmf/web2c/'], web2c: ['texmf/web2c/'], pdftex: ['texmf/web2c/', 'texmf/tex/'],
  header: ['texmf/'], misc: ['texmf/fonts/'], sfd: ['texmf/fonts/sfd/'], cmap: ['texmf/fonts/cmap/'],
  pk: [], afm: ['texmf/fonts/afm/'], lig: ['texmf/fonts/lig/'],
};
// files written by LaTeX that the *next* run reads back: carried across runs like TeXpresso does
const CARRY = /\.(aux|toc|lof|lot|out|nav|snm|bbl|idx|ind|glo|gls|brf)$/;

export class ExitError extends Error { constructor(code) { super('exit ' + code); this.code = code; } }

// ---------------------------------------------------------------------------------------------
export class HostFS {
  constructor() {
    this.byId = [];            // id -> entry
    this.byPath = new Map();   // path -> entry
    this.byBase = new Map();   // basename -> [entry]
    this.dirs = new Set(['', '.', 'texmf']);
  }
  _add(path, data, user) {
    const old = this.byPath.get(path);
    if (old) { old.data = data; old.gone = false; old.user = user; return old; }   // ids are stable per path
    const e = { id: this.byId.length, path, data, user, gone: false };
    this.byId.push(e); this.byPath.set(path, e);
    const base = path.slice(path.lastIndexOf('/') + 1);
    let l = this.byBase.get(base); if (!l) this.byBase.set(base, l = []); l.push(e);
    for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) this.dirs.add(path.slice(0, i));
    return e;
  }
  /** system file (read-only, shared; e.g. out of the emscripten file_packager blob) */
  addSystemFile(path, data) { return this._add(path, data, false); }
  /** pack = {data: Uint8Array, files: [{filename,start,end}]} as written by emscripten's file_packager */
  addPack(data, meta) {
    for (const f of meta.files) this._add(f.filename.replace(/^\/+/, ''), data.subarray(f.start, f.end), false);
  }
  /** user project file: this is what changes between incremental compiles */
  setUserFile(path, data) {
    if (typeof data === 'string') data = enc.encode(data);
    return this._add(path, data, true);
  }
  removeUserFile(path) { const e = this.byPath.get(path); if (e) { e.gone = true; e.data = new Uint8Array(0); } }
  lookup(path) { const e = this.byPath.get(path); return e && !e.gone ? e : null; }
  userEntries() { return this.byId.filter(e => e.user && !e.gone); }
  search(name, fmt) {
    const l = this.byBase.get(name); if (!l) return null;
    const dirs = FMT_DIRS[fmt] || [''];
    for (const e of l) if (!e.gone && !e.user && dirs.some(d => e.path.startsWith(d))) return e;
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Memory snapshots: linear memory [0, heap_top) cut into 4 KiB chunks; a snapshot is a table of
// (immutable, shared) chunks, so consecutive snapshots only pay for the chunks that changed.
// Finding the changed chunks is the hot spot, so it is done by diff.wasm (SIMD, multi-memory)
// against a shadow copy of the previous snapshot; a plain JS scan is the fallback.
const CH = 1024;                      // chunk size in 32-bit words (= 4 KiB)

class Snapper {
  constructor(liveMem, diffModule) {
    this.live = liveMem;
    this.diff = null;
    if (diffModule) {
      try {
        this.shadow = new WebAssembly.Memory({ initial: 1 });
        this.diff = new WebAssembly.Instance(diffModule, { env: { live: liveMem, shadow: this.shadow } }).exports.diff;
      } catch (e) { this.diff = null; }          // no multi-memory/SIMD: JS fallback
    }
  }
  _ensureShadow(chunks) {
    const need = Math.ceil((chunks * 4096 + chunks * 4 + 64) / 65536);
    const have = this.shadow.buffer.byteLength / 65536;
    if (need > have) this.shadow.grow(need - have);
  }
  /** table of chunk Uint32Arrays describing live memory words [0, words) */
  capture(words, prev) {
    const live32 = new Uint32Array(this.live.buffer);
    const n = Math.ceil(words / CH), table = new Array(n);
    let fresh = 0;
    if (this.diff) {
      this._ensureShadow(n);
      const pl = prev ? prev.length : 0;
      if (!prev) new Uint8Array(this.shadow.buffer).set(new Uint8Array(this.live.buffer, 0, n * 4096));
      const listOff = n * 4096;
      const k = prev ? this.diff(0, Math.min(pl, n), listOff) : 0;
      const changed = new Uint32Array(this.shadow.buffer, listOff, k);
      for (let c = 0; c < pl && c < n; c++) table[c] = prev[c];
      for (let i = 0; i < k; i++) { const c = changed[i]; table[c] = live32.slice(c * CH, (c + 1) * CH); fresh++; }
      for (let c = pl; c < n; c++) {                                    // chunks the previous image did not cover
        table[c] = live32.slice(c * CH, Math.min((c + 1) * CH, live32.length)); fresh++;
      }
      if (n > pl && prev) new Uint8Array(this.shadow.buffer).set(new Uint8Array(this.live.buffer, pl * 4096, (n - pl) * 4096), pl * 4096);
      return { table, fresh };
    }
    for (let c = 0; c < n; c++) {
      const lo = c * CH, hi = Math.min(lo + CH, live32.length);
      const p = prev && c < prev.length ? prev[c] : null;
      if (p && p.length === hi - lo) {
        let same = true;
        for (let i = 0, j = lo; i < p.length; i++, j++) if (p[i] !== live32[j]) { same = false; break; }
        if (same) { table[c] = p; continue; }
      }
      table[c] = live32.slice(lo, hi); fresh++;
    }
    return { table, fresh };
  }
  /** make live memory (and the shadow image) equal to `table`; zero [table end, zeroTo) */
  restore(table, zeroToWords) {
    const live32 = new Uint32Array(this.live.buffer);
    for (let c = 0; c < table.length; c++) live32.set(table[c], c * CH);
    const from = table.length * CH;
    if (zeroToWords > from) live32.fill(0, from, Math.min(zeroToWords, live32.length));
    if (this.diff) {
      this._ensureShadow(table.length);
      const sh32 = new Uint32Array(this.shadow.buffer);
      for (let c = 0; c < table.length; c++) sh32.set(table[c], c * CH);
    }
  }
}

// ---------------------------------------------------------------------------------------------
export class TexEngine {
  /**
   * @param {object} o
   * @param {BufferSource|WebAssembly.Module} o.wasm   pdftex.wasm
   * @param {HostFS} o.fs
   * @param {object} [o.env]        environment variables visible to the engine
   */
  static async create(o) {
    const e = new TexEngine(o);
    await e._instantiate(o.wasm);
    return e;
  }

  constructor({ fs, env = {}, diffWasm = null, snapshotIntervalMs = 20, maxSnapshots = 600 }) {
    this.diffWasm = diffWasm;
    this.fs = fs;
    this.env = { ...env };
    this.stdout = [];           // text chunks written to fd 1/2
    this.snapshots = [];        // chronological, each valid for the trace prefix [0, traceLen)
    this.trace = [];            // events that depend on user files: {k:'find'|'read', ...}
    this.incremental = true;
    this.snapIntervalMs = snapshotIntervalMs;
    this.maxSnapshots = maxSnapshots;
    this._lastSnapAt = -Infinity; this._interval = snapshotIntervalMs;
    this._lastTable = null;
    this.initSnap = null;
    this.lastFiles = null;      // path -> bytes the last run consumed
    this.result = null;
    this.lastArgs = null;
    this.stats = { runs: 0, snapshots: 0, snapshotMs: 0, restoreMs: 0 };
  }

  async _instantiate(wasm) {
    const self = this;
    const imports = {
      env: {
        host_lookup: p => self._lookup(self._cstr(p)),
        host_isdir: p => (self.fs.dirs.has(self._cstr(p).replace(/\/+$/, '')) ? 1 : 0),
        host_size: id => self.fs.byId[id].data.length,
        host_is_user: id => (self.fs.byId[id].user ? 1 : 0),
        host_read: (id, off, dst, len) => self._read(id, off, dst, len),
        host_search: (n, f, out, cap) => self._search(n, f, out, cap),
        host_want_snapshot: u => self._wantSnapshot(u),
        host_snapshot: () => self._hostSnapshot(),
        emscripten_notify_memory_growth: () => {},
        __syscall_connect: () => -38, __syscall_socket: () => -38,
      },
      wasi_snapshot_preview1: {
        proc_exit: code => { throw new ExitError(code); },
        clock_time_get: (id, prec, out) => {
          const ns = BigInt(Math.round((id === 0 ? Date.now() : now()) * 1e6));
          new DataView(self.mem.buffer).setBigUint64(out, ns, true); return 0;
        },
        fd_close: () => 0,
        fd_read: (fd, iov, n, out) => { new DataView(self.mem.buffer).setUint32(out, 0, true); return 0; },
        fd_seek: () => 70,
        fd_write: (fd, iov, n, out) => {
          const dv = new DataView(self.mem.buffer); let total = 0, s = '';
          for (let i = 0; i < n; i++) {
            const p = dv.getUint32(iov + 8 * i, true), l = dv.getUint32(iov + 8 * i + 4, true);
            s += dec.decode(new Uint8Array(self.mem.buffer, p, l), { stream: true }); total += l;
          }
          self.stdout.push(s); dv.setUint32(out, total, true); return 0;
        },
        environ_sizes_get: (cnt, sz) => {
          const l = self._envList(); const dv = new DataView(self.mem.buffer);
          dv.setUint32(cnt, l.length, true); dv.setUint32(sz, l.reduce((a, s) => a + enc.encode(s).length + 1, 0), true); return 0;
        },
        environ_get: (ep, bp) => {
          const dv = new DataView(self.mem.buffer);
          for (const s of self._envList()) {
            const b = enc.encode(s); dv.setUint32(ep, bp, true); ep += 4;
            const u = new Uint8Array(self.mem.buffer, bp, b.length + 1); u.set(b); u[b.length] = 0; bp += b.length + 1;
          }
          return 0;
        },
      },
    };
    const m = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
    this.instance = await WebAssembly.instantiate(m, imports);
    this.x = this.instance.exports;
    this.mem = this.x.memory;
    this.x._initialize();
    this.dataPtr = this.x.asyncify_data_ptr();
    this.argsPtr = this.x.tex_args_ptr();
    this.snapper = new Snapper(this.mem, this.diffWasm instanceof WebAssembly.Module ? this.diffWasm
                               : this.diffWasm ? await WebAssembly.compile(this.diffWasm) : null);
    this.initSnap = this._capture('init');        // pristine process image: a "cold start" is a restore of this
  }

  _envList() { return Object.entries(this.env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`); }
  get u8() { if (this._b !== this.mem.buffer) { this._b = this.mem.buffer; this._u8 = new Uint8Array(this._b); } return this._u8; }
  _cstr(p) {
    const u = this.u8; let e = p; while (u[e]) e++;
    return dec.decode(u.subarray(p, e));
  }

  // --------------------------------------------------------------- host file access (+ trace)
  _lookup(path) {
    path = path.replace(/^(\.\/)+/, '');
    const e = this.fs.lookup(path);
    if (!e || e.user) this.trace.push({ k: 'find', path, id: e ? e.id : -1 });   // result may depend on user files
    return e ? e.id : -1;
  }
  _search(namePtr, fmtPtr, outPtr, cap) {
    const e = this.fs.search(this._cstr(namePtr), this._cstr(fmtPtr));
    if (!e) return -1;
    const b = enc.encode(e.path);
    if (b.length + 1 > cap) return -1;
    const u = this.u8; u.set(b, outPtr); u[outPtr + b.length] = 0;
    return e.id;
  }
  _read(id, off, dst, len) {
    const e = this.fs.byId[id], d = e.data;
    if (off >= d.length) { if (e.user) this.trace.push({ k: 'read', id, off, len: 0 }); return 0; }
    let n = Math.min(len, d.length - off);
    if (e.user) {                     // tight fence: hand out at most one line
      const nl = d.indexOf(10, off);
      if (nl >= 0 && nl - off + 1 < n) n = nl - off + 1;
      this.trace.push({ k: 'read', id, off, len: n });
    }
    this.u8.set(d.subarray(off, off + n), dst);
    return n;
  }

  // ---------------------------------------------------------------- running the engine
  /** Run pdftex from a pristine process image. Returns the exit status. */
  run(argv) { this._resetTo(this.initSnap); this.trace = []; this.stdout = []; this.snapshots = []; this._lastTable = this.initSnap.table; this._lastSnapAt = -Infinity; return this._start(argv); }

  _start(argv) {
    const b = enc.encode(argv.join('\0') + '\0');
    this.u8.set(b, this.argsPtr);
    this.argc = argv.length;
    this.stats.runs++;
    return this._drive(() => this.x.tex_run(this.argc));
  }

  _drive(first) {
    let ret, started = first;
    for (;;) {
      try { ret = started(); }
      catch (e) { if (e instanceof ExitError) return e.code; throw e; }
      if (this.x.asyncify_get_state() !== 1) return ret;   // not unwinding: finished normally
      this.x.asyncify_stop_unwind();
      this._takeSnapshot();
      this.x.asyncify_start_rewind(this.dataPtr);
      started = () => this.x.tex_run(this.argc);
    }
  }

  _wantSnapshot() { return this.incremental && now() - this._lastSnapAt >= this._interval ? 1 : 0; }
  _hostSnapshot() {
    if (this.x.asyncify_get_state() === 2) { this.x.asyncify_stop_rewind(); return 0; }   // resumed
    this.x.asyncify_data_reset();
    this.x.asyncify_start_unwind(this.dataPtr);
    return 0;
  }

  // ------------------------------------------------------------------ snapshots
  _capture(kind) {
    const t0 = now();
    const brk = this.x.heap_top();
    const words = (brk + 3) >>> 2;
    const { table, fresh } = this.snapper.capture(words, this._lastTable);
    this._lastTable = table;
    return { kind, table, brk, sp: this.x.sp_get(), traceLen: this.trace.length, outLen: this.stdout.length, fresh, ms: now() - t0 };
  }
  _takeSnapshot() {
    const s = this._capture('async');
    this.snapshots.push(s);
    this.stats.snapshots++; this.stats.snapshotMs += s.ms;
    // adaptive spacing: never spend more than ~1/4 of the compile time on snapshots
    this._lastSnapAt = now(); this._interval = Math.max(this.snapIntervalMs, 3 * s.ms);
    if (this.snapshots.length > this.maxSnapshots) {          // thin out: drop every other snapshot of the older half
      const keep = [], half = this.snapshots.length >> 1;
      this.snapshots.forEach((x, i) => { if (i >= half || i % 2 === 0) keep.push(x); });
      this.snapshots = keep;
    }
  }
  _resetTo(s) {
    const t0 = now();
    const curBrk = this.x.heap_top();
    this.snapper.restore(s.table, (curBrk + 3) >>> 2);     // + zero memory the snapshot never saw
    this.x.sp_set(s.sp);
    this._lastTable = s.table;
    this.stdout.length = s.outLen; this.trace.length = s.traceLen;
    this.stats.restoreMs += now() - t0;
  }
  /** Resume a snapshot taken by _takeSnapshot(): rebuild the wasm call stack by rewinding. */
  _resume(s) {
    this._resetTo(s);
    this.snapshots = this.snapshots.slice(0, this.snapshots.indexOf(s) + 1);
    this._lastSnapAt = now(); this._interval = this.snapIntervalMs;
    this.stats.runs++;
    this.x.asyncify_start_rewind(this.dataPtr);
    return this._drive(() => this.x.tex_run(this.argc));
  }

  // ------------------------------------------------------------------ output files
  /** Read a file the engine wrote (log, pdf, fmt...). Returns a copy or null. */
  getFile(name) {
    const i = this.x.vfs_find_index(this._putCstr(name));
    if (i < 0) return null;
    const p = this.x.vfs_data(i), l = this.x.vfs_len(i);
    return this.u8.slice(p, p + l);
  }
  listFiles() {
    const n = this.x.vfs_count(), out = [];
    for (let i = 0; i < n; i++) out.push({ name: this._cstr(this.x.vfs_name(i)), size: this.x.vfs_len(i) });
    return out;
  }
  _putCstr(s) { const b = enc.encode(s); const p = this.argsPtr + 8192; this.u8.set(b, p); this.u8[p + b.length] = 0; return p; }
  get consoleOutput() { return this.stdout.join(''); }

  // ------------------------------------------------------------------ incremental compile
  /**
   * Compile a project.  `files` maps path -> string|Uint8Array.  The first call is a cold run; later
   * calls roll the engine back to the newest snapshot that precedes the first byte that changed
   * (TeXpresso's "rollback") and re-run only from there.  Cross-reference files (.aux ...) written
   * by one run are fed to the next, and the engine re-runs until they stop changing.
   */
  compile(files, { main = 'main.tex', maxPasses = 3, extraArgs = [], incremental = this.incremental } = {}) {
    const t0 = now();
    this.incremental = incremental;
    const job = main.replace(/\.tex$/, '');
    const argv = ['pdflatex', '-interaction=nonstopmode', '-file-line-error', '-fmt=pdflatex',
                  '-translate-file=cp227.tcx', ...extraArgs, main];
    // sync user files into the host FS (carried aux files stay)
    const seen = new Set();
    for (const [p, d] of Object.entries(files)) { this.fs.setUserFile(p, d); seen.add(p); }
    for (const e of this.fs.userEntries()) if (!seen.has(e.path) && !e.carried) this.fs.removeUserFile(e.path);
    if (this.lastArgs && this.lastArgs.join('\0') !== argv.join('\0')) { this.lastFiles = null; }   // different command: start over
    this.lastArgs = argv;

    const passes = [];
    for (let pass = 0; pass < maxPasses; pass++) {
      const plan = this._plan();
      const p0 = now();
      if (plan.mode === 'cached') { passes.push({ mode: 'cached', ms: now() - p0 }); break; }
      // remember which version of every user file this run consumes (before aux files get carried over)
      this.lastFiles = new Map(this.fs.userEntries().map(e => [e.path, e.data]));
      const exit = plan.mode === 'cold' ? this.run(argv) : this._resume(plan.snap);
      const changed = this._carryAuxFiles();
      this.result = { exit, pdf: this.getFile(job + '.pdf'), log: this.getFile(job + '.log') };
      passes.push({ mode: plan.mode, firstBad: plan.firstBad, resumedAtEvent: plan.snap ? plan.snap.traceLen : 0,
                    events: this.trace.length, snapshotsHeld: this.snapshots.length, ms: now() - p0 });
      if (!changed) break;                         // cross-references converged
    }
    const r = this.result || { exit: -1, pdf: null, log: null };
    return { exit: r.exit, pdf: r.pdf, log: r.log ? dec.decode(r.log) : '', console: this.consoleOutput,
             ms: now() - t0, passes, stats: { ...this.stats, snapshotsHeld: this.snapshots.length } };
  }

  /** Decide how to produce the output after the user files (possibly) changed. */
  _plan() {
    if (!this.lastFiles || !this.result) return { mode: 'cold', firstBad: 0 };
    // 1. which user files changed, and at which byte?
    const changes = new Map();          // path -> first differing offset | -1 (added/removed)
    const cur = new Map(this.fs.userEntries().map(e => [e.path, e.data]));
    for (const [p, d] of cur) {
      const o = this.lastFiles.get(p);
      if (!o) changes.set(p, -1);
      else if (o !== d) { const k = firstDiff(o, d); if (k >= 0) changes.set(p, k); }
    }
    for (const p of this.lastFiles.keys()) if (!cur.has(p)) changes.set(p, -1);
    if (changes.size === 0) return { mode: 'cached', firstBad: Infinity };
    // 2. earliest trace event that observed something that is now different
    let firstBad = this.trace.length;
    for (let i = 0; i < this.trace.length; i++) {
      const ev = this.trace[i];
      if (ev.k === 'find') {
        if (changes.has(ev.path) && (ev.id >= 0) !== cur.has(ev.path)) { firstBad = i; break; }
      } else {
        const p = this.fs.byId[ev.id].path, d = changes.get(p);
        if (d !== undefined && (d < 0 || ev.off + Math.max(ev.len, 1) > d)) { firstBad = i; break; }
      }
    }
    if (firstBad >= this.trace.length) return { mode: 'cached', firstBad: Infinity };   // nothing observed the change
    // 3. newest snapshot taken before that event
    let snap = null;
    if (this.incremental) for (let i = this.snapshots.length - 1; i >= 0; i--) if (this.snapshots[i].traceLen <= firstBad) { snap = this.snapshots[i]; break; }
    return snap ? { mode: 'resume', snap, firstBad } : { mode: 'cold', firstBad };
  }

  /** Copy cross-reference files the engine wrote into the host FS for the next run. Returns true if any changed. */
  _carryAuxFiles() {
    let changed = false;
    for (const f of this.listFiles()) {
      if (!CARRY.test(f.name)) continue;
      const bytes = this.getFile(f.name), old = this.fs.lookup(f.name);
      if (old && bytesEqual(old.data, bytes)) continue;
      this.fs.setUserFile(f.name, bytes).carried = true;
      changed = true;
    }
    return changed;
  }
}

function bytesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -2 : n;     // -2: identical
}
