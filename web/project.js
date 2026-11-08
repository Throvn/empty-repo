// project.js -- the user's project (files, main file) persisted in IndexedDB.
const TEXT_EXT = /\.(tex|sty|cls|clo|def|fd|cfg|bib|bst|bbl|aux|txt|md|ltx|dtx|ins|lbx|cbx|csv|dat|json|xml|html?|css|js|py|c|h|cpp|java|sh)$/i;
export const isText = name => TEXT_EXT.test(name) || !/\.[A-Za-z0-9]+$/.test(name);
const enc = new TextEncoder(), dec = new TextDecoder();

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pdftex-wasm', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kv(mode, fn) {
  try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction('kv', mode), s = t.objectStore('kv'), rq = fn(s); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); }); }
  catch { return undefined; }            // private mode etc: just don't persist
}

export class Project {
  constructor() { this.files = new Map(); this.main = 'main.tex'; this.active = 'main.tex'; }
  /** files: name -> {text:string} | {bytes:Uint8Array} */
  get(name) { return this.files.get(name); }
  setText(name, text) { this.files.set(name, { text }); }
  setBytes(name, bytes) { this.files.set(name, isText(name) ? { text: dec.decode(bytes) } : { bytes }); }
  remove(name) { this.files.delete(name); if (this.active === name) this.active = this.main; }
  rename(a, b) { const f = this.files.get(a); if (!f || this.files.has(b)) return false; this.files.delete(a); this.files.set(b, f); if (this.main === a) this.main = b; if (this.active === a) this.active = b; return true; }
  names() { return [...this.files.keys()].sort((x, y) => (x === this.main ? -1 : y === this.main ? 1 : x.localeCompare(y))); }
  /** what the worker needs */
  payload(name) { const f = this.files.get(name); return f.text !== undefined ? f.text : f.bytes; }
  async save() {
    const o = { main: this.main, active: this.active, files: {} };
    for (const [n, f] of this.files) o.files[n] = f.text !== undefined ? { t: f.text } : { b: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) };
    await kv('readwrite', s => s.put(o, 'project'));
  }
  static async load() {
    const o = await kv('readonly', s => s.get('project')), p = new Project();
    if (!o) return null;
    p.main = o.main; p.active = o.active;
    for (const [n, f] of Object.entries(o.files)) p.files.set(n, f.t !== undefined ? { text: f.t } : { bytes: new Uint8Array(f.b) });
    return p;
  }
}
