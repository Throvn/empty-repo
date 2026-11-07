// engine.js -- host side of pdftex.wasm (runs unchanged in browsers, workers and node >= 20).
//
//  * HostFS     : the files the engine can *read* (TeX tree pack + the user's project files)
//  * TexEngine  : instantiates pdftex.wasm, implements its few imports, runs the engine and
//                 implements TeXpresso-style incremental compilation by snapshotting wasm
//                 linear memory through asyncify (see Snapshots below).
//
// The wasm module owns every other piece of process state (virtual files the engine writes,
// stdio buffers, heap, C stack...) inside its linear memory, so a snapshot is simply
// "copy linear memory + asyncify stack + stack pointer".

const enc = new TextEncoder();
const dec = new TextDecoder();

// Where each kpathsea "format" may find files in the packed tree.
const FMT_DIRS = {
  tex: ['texmf/tex/'], tfm: ['texmf/fonts/tfm/'], ofm: ['texmf/fonts/ofm/'], vf: ['texmf/fonts/vf/'],
  type1: ['texmf/fonts/type1/'], truetype: ['texmf/fonts/truetype/'], opentype: ['texmf/fonts/opentype/'],
  enc: ['texmf/fonts/enc/'], map: ['texmf/fonts/map/'], fmt: ['fmt/', 'texmf/web2c/'],
  pool: ['texmf/web2c/'], web2c: ['texmf/web2c/'], pdftex: ['texmf/web2c/', 'texmf/tex/'],
  header: ['texmf/'], misc: ['texmf/fonts/'], sfd: ['texmf/fonts/sfd/'], cmap: ['texmf/fonts/cmap/'],
  pk: [], afm: ['texmf/fonts/afm/'], lig: ['texmf/fonts/lig/'],
};

export class ExitError extends Error { constructor(code) { super('exit ' + code); this.code = code; } }

// ---------------------------------------------------------------------------------------------
export class HostFS {
  constructor() {
    this.byId = [];            // id -> entry
    this.byPath = new Map();   // path -> entry
    this.byBase = new Map();   // basename -> [entry]
    this.dirs = new Set(['', '.', 'texmf']);
    this.userPaths = new Set();
  }
  _add(path, data, user) {
    const old = this.byPath.get(path);
    if (old) { old.data = data; old.gone = false; return old; }   // ids are stable per path
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
    const e = this._add(path, data, true); this.userPaths.add(path); return e;
  }
  removeUserFile(path) { const e = this.byPath.get(path); if (e) { e.gone = true; e.data = new Uint8Array(0); } this.userPaths.delete(path); }
  lookup(path) { const e = this.byPath.get(path); return e && !e.gone ? e : null; }
  search(name, fmt) {
    const l = this.byBase.get(name); if (!l) return null;
    const dirs = FMT_DIRS[fmt] || [''];
    for (const e of l) if (!e.gone && dirs.some(d => e.path.startsWith(d))) return e;
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
const PAGE = 65536;

export class TexEngine {
  /**
   * @param {object} o
   * @param {BufferSource} o.wasm   pdftex.wasm bytes (or a WebAssembly.Module)
   * @param {HostFS} o.fs
   * @param {object} [o.env]        environment variables visible to the engine
   */
  static async create(o) {
    const e = new TexEngine(o);
    await e._instantiate(o.wasm);
    return e;
  }

  constructor({ fs, env = {} }) {
    this.fs = fs;
    this.env = { SOURCE_DATE_EPOCH: undefined, ...env };
    this.stdout = [];           // text chunks written to fd 1/2
    this.snapshots = [];
    this.trace = [];            // read/lookup events (for fences)
    this.stats = {};
    this.snapIntervalMs = 40;   // see host_want_snapshot
    this.incremental = true;
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
          const ns = BigInt(Math.round((id === 0 ? Date.now() : performance.now()) * 1e6));
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
            new Uint8Array(self.mem.buffer, bp, b.length + 1).set([...b, 0]); bp += b.length + 1;
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
  }

  _envList() { return Object.entries(this.env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`); }
  get u8() { return new Uint8Array(this.mem.buffer); }
  _cstr(p) {
    const u = this.u8; let e = p; while (u[e]) e++;
    return dec.decode(u.subarray(p, e));
  }

  // --------------------------------------------------------------- host file access (+ trace)
  _lookup(path) {
    path = path.replace(/^(\.\/)+/, '');
    const e = this.fs.lookup(path);
    if (!e || e.user || !this.fs.byPath.has(path) || path.indexOf('/') < 0)
      this.trace.push({ k: 'find', path, id: e ? e.id : -1 });     // may depend on user files
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
  /** Run pdftex with argv. Returns the exit status. Output files live in the instance (see getFile). */
  run(argv) {
    const b = enc.encode(argv.join('\0') + '\0');
    this.u8.set(b, this.argsPtr);
    this.argc = argv.length;
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

  _wantSnapshot() { return 0; }
  _hostSnapshot() {
    if (this.x.asyncify_get_state() === 2) { this.x.asyncify_stop_rewind(); return 0; }
    this.x.asyncify_data_reset();
    this.x.asyncify_start_unwind(this.dataPtr);
    return 0;
  }
  _takeSnapshot() {}

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
}

export async function loadPack(dataBytes, metaJson) {
  return { data: dataBytes, files: (typeof metaJson === 'string' ? JSON.parse(metaJson) : metaJson).files };
}
