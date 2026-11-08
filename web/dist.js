// dist.js -- the TeX *distribution* is pluggable.
//
//   dist.json   {"name", "format": "pdflatex.fmt", "layers": [{"name", "index": "core.json", "data": "core.data", "overlay"?}, ...]}
//               (the same shape works for a single layer: NAME.layer.json written by scripts/pack-layer.sh)
//   layer       a set of read-only TeX-tree files (texmf/tex/latex/..., texmf/fonts/...).  Layers are packed blobs that are
//               fetched with HTTP Range requests (nothing is downloaded up front), or in-memory file sets installed at run time.
//
// A deployment can ship only the `core` layer, add its own (company templates, a newer TikZ, local fonts ...) with
// `?layer=https://host/x.layer.json`, or let users install packages from CTAN archives (.zip / .tar[.gz]: TDS archives,
// flat package archives, docstrip .ins/.dtx sources) or loose files (.sty .cls .bst .tfm .pfb .map ...) in the browser.
//
// Everything here is plain ES-module JavaScript for browsers, workers and node >= 20.

const dec = new TextDecoder();
const enc = new TextEncoder();

// ---------------------------------------------------------------------------------------------- manifests
/** fetch(url) as JSON, relative URLs resolved against `base` */
export async function fetchJson(url, base) {
  const r = await fetch(base ? new URL(url, base).href : url);
  if (!r.ok) throw new Error(`cannot load ${url}: HTTP ${r.status}`);
  return r.json();
}

/**
 * Read a manifest (a dist.json with `layers`, or a single layer description) and mount its layers.
 * `io` = { json(url) -> object, bytes(url, label) -> Uint8Array, range(url) -> read(start, end), resolve(manifestUrl, rel) -> url }
 * Returns { name, format, layers: [...info], hot: [{index, data}] }
 */
export async function mountManifest(fs, manifestUrl, io, { overlay = false } = {}) {
  const m = await io.json(manifestUrl);
  const list = m.layers || [m];
  const base = u => io.resolve(manifestUrl, u);
  const out = { name: m.name || list[0].name, format: m.format || null, layers: [], hot: [] };
  for (const l of list) {
    const meta = await io.bytes(base(l.index), `${l.name} index`).then(b => JSON.parse(dec.decode(b)));
    out.layers.push(fs.mountLayer(l.name, { read: io.range(base(l.data)), meta }, { overlay: overlay || !!l.overlay, maps: !!l.maps }));
    if (l.hot) out.hot.push({ index: base(l.hot.index), data: base(l.hot.data) });
  }
  if (out.layers.some(l => l.maps)) refreshMaps(fs);
  return out;
}

// ---------------------------------------------------------------------------------------------- font maps
const MAP_PATH = 'texmf/fonts/map/pdftex.map';
/**
 * pdftex.map is a single generated file (what updmap would write).  Layers mounted with `maps` (installed packages, or a manifest layer with "maps": true) bring raw
 * dvips/pdftex *.map files; they are merged into one virtual pdftex.map (entries of overlay maps win over the base ones with the same TFM name).
 */
export function refreshMaps(fs) {
  if (fs.layerInfo.has('$maps')) fs.unmountLayer('$maps');
  const overlays = new Set([...fs.layerInfo.values()].filter(l => l.maps).map(l => l.name));
  const frag = [];
  for (const e of fs.byId) if (!e.user && !e.gone && overlays.has(e.layer) && /^texmf\/fonts\/map\/(pdftex|dvips)\/.*\.map$/.test(e.path)) frag.push(e);
  const baseEntry = fs.lookup(MAP_PATH);
  if (!frag.length || !baseEntry) return 0;
  const lines = [], names = new Set();
  const take = text => { for (const l of text.split(/\r?\n/)) { const t = l.trim(); if (!t || t[0] === '%') continue; lines.push(t); } };
  const over = new Map();
  for (const e of frag) {
    for (const l of dec.decode(e.data).split(/\r?\n/)) {
      const t = l.trim(); if (!t || /^[%=+\-"]/.test(t)) continue;
      const k = t.split(/\s+/)[0]; if (!over.has(k)) over.set(k, t);
    }
  }
  for (const l of dec.decode(baseEntry.data).split(/\r?\n/)) {
    const t = l.trim(); if (!t || t[0] === '%') continue;
    if (!over.has(t.split(/\s+/)[0])) lines.push(t);
  }
  lines.push(...over.values());
  fs.mountLayer('$maps', new Map([[MAP_PATH, enc.encode(lines.join('\n') + '\n')]]), { overlay: true });
  return over.size;
}

// ---------------------------------------------------------------------------------------------- archives
async function inflate(bytes, format) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** .zip -> Map(path -> bytes)  (stored and deflated entries, which is everything CTAN and Overleaf produce) */
export async function readZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true),
      xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const lh = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = b.subarray(lh, lh + csize);
    out.set(name, method === 0 ? raw.slice() : method === 8 ? await inflate(raw, 'deflate-raw') : (() => { throw new Error(`zip method ${method} unsupported`); })());
  }
  return out;
}

/** .tar / .tar.gz -> Map(path -> bytes) */
export async function readTar(b) {
  if (b[0] === 0x1f && b[1] === 0x8b) b = await inflate(b, 'gzip');
  const out = new Map(); let p = 0, longName = null;
  const str = (o, l) => dec.decode(b.subarray(o, o + l)).replace(/\0.*$/, '');
  while (p + 512 <= b.length && b[p] !== 0) {
    let name = str(p, 100); const size = parseInt(str(p + 124, 12).trim() || '0', 8), type = String.fromCharCode(b[p + 156] || 48), prefix = str(p + 345, 155);
    if (prefix) name = prefix + '/' + name;
    const data = b.subarray(p + 512, p + 512 + size);
    if (type === 'L') longName = dec.decode(data).replace(/\0.*$/, '');
    else { if (longName) { name = longName; longName = null; } if (type === '0' || type === '\0') out.set(name, data.slice()); }
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function readArchive(bytes, filename = '') {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readZip(bytes);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return readTar(bytes);
  if (/\.tar$/i.test(filename)) return readTar(bytes);
  throw new Error('unknown archive format (expected .zip, .tar or .tar.gz)');
}

// ---------------------------------------------------------------------------------------------- mapping files into the tree
const TEX_EXT = /\.(sty|cls|clo|def|cfg|fd|ldf|lco|lbx|bbx|cbx|dbx|bcf|tex|ltx|code\.tex|sty\.in|mst|ist|ins|dtx|cmap|enc|tcx)$/i;
/** where a loose file of a flat package goes, below texmf/ */
function flatDir(fn, pkg) {
  const lc = fn.toLowerCase();
  if (/\.(ins|dtx)$/.test(lc)) return null;
  if (/\.bst$/.test(lc)) return `bibtex/bst/${pkg}/`;
  if (/\.bib$/.test(lc)) return `bibtex/bib/${pkg}/`;
  if (/\.tfm$/.test(lc)) return `fonts/tfm/${pkg}/`;
  if (/\.vf$/.test(lc)) return `fonts/vf/${pkg}/`;
  if (/\.(pfb|pfa)$/.test(lc)) return `fonts/type1/${pkg}/`;
  if (/\.enc$/.test(lc)) return `fonts/enc/dvips/${pkg}/`;
  if (/\.map$/.test(lc)) return `fonts/map/dvips/${pkg}/`;
  if (/\.(ttf|ttc)$/.test(lc)) return `fonts/truetype/${pkg}/`;
  if (/\.otf$/.test(lc)) return `fonts/opentype/${pkg}/`;
  if (/\.afm$/.test(lc)) return `fonts/afm/${pkg}/`;
  if (/\.(tex|sty|cls|clo|def|cfg|fd|ldf|lco|lbx|bbx|cbx|dbx|ltx|mst|ist|tcx|cmap)$/.test(lc)) return `tex/latex/${pkg}/`;
  if (/\.(pdf|png|jpe?g|eps|mps)$/.test(lc)) return `tex/latex/${pkg}/`;     // figures a package \includes
  return null;
}

/**
 * Decide where the files of an archive (or loose upload) go.  Returns
 *   { tree: Map('texmf/…' -> bytes), docstrip: [{ins, files: Map}], skipped: [names], note }
 * * TDS archives (top level tex/ fonts/ bibtex/ ..., possibly below one directory or texmf/): taken as they are
 * * flat packages: .sty/.cls/... -> tex/latex/<name>/, .bst -> bibtex/bst/<name>/, fonts by type ...
 * * .ins/.dtx sources whose generated files are missing are listed in `docstrip` (run them with runDocstrip)
 */
export function toTexmf(files, name) {
  const pkg = (name || 'user').replace(/\.(zip|tar|tgz|tar\.gz)$/i, '').replace(/[^\w.+-]+/g, '-');
  let all = new Map();
  for (const [p, d] of files) { const q = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''); if (!/(^|\/)(__MACOSX|\.git|\.DS_Store)(\/|$)/.test(q) && !q.endsWith('/.DS_Store')) all.set(q, d); }
  // peel wrapper directories: pkg/…, pkg/texmf/…
  const TDS = /^(tex|fonts|bibtex|web2c)\//;
  const hasTds = m => [...m.keys()].some(k => TDS.test(k));
  for (let guard = 0; guard < 4 && !hasTds(all); guard++) {
    const tops = new Set([...all.keys()].map(k => (k.includes('/') ? k.slice(0, k.indexOf('/')) : null)));
    if (tops.size === 1 && !tops.has(null)) { const t = [...tops][0] + '/'; all = new Map([...all].map(([k, v]) => [k.slice(t.length), v])); }
    else if ([...all.keys()].some(k => /^(texmf|texmf-dist)\//.test(k))) all = new Map([...all].filter(([k]) => /^(texmf|texmf-dist)\//.test(k)).map(([k, v]) => [k.replace(/^[^/]+\//, ''), v]));
    else break;
  }
  const tree = new Map(), skipped = []; const docstrip = [];
  if (hasTds(all)) {
    for (const [k, v] of all) { if (TDS.test(k)) tree.set('texmf/' + k, v); else skipped.push(k); }
    return { tree, docstrip, skipped, note: 'TDS layout' };
  }
  for (const [k, v] of all) {
    const fn = k.slice(k.lastIndexOf('/') + 1), dir = flatDir(fn, pkg);
    if (dir === null) { skipped.push(k); continue; }
    const sub = k.includes('/') && /^tex\//.test(dir) ? k.slice(0, k.lastIndexOf('/') + 1) : '';     // keep sub-directories of TeX inputs (tikz libraries ...)
    tree.set('texmf/' + dir + sub + fn, v);
  }
  // docstrip: an .ins whose \file{...} outputs are not in the archive
  const have = new Set([...all.keys()].map(k => k.slice(k.lastIndexOf('/') + 1)));
  for (const [k, v] of all) if (/\.ins$/i.test(k)) {
    const text = dec.decode(v), outs = [...text.matchAll(/\\file\{([^}]+)\}/g)].map(m => m[1]);
    if (outs.some(o => !have.has(o))) {
      const dir = k.includes('/') ? k.slice(0, k.lastIndexOf('/') + 1) : '';
      docstrip.push({ ins: k, files: new Map([...all].filter(([f]) => f.startsWith(dir) && /\.(ins|dtx|tex|sty|cls|def|cfg|bib|png|pdf|jpe?g)$/i.test(f)).map(([f, d]) => [f.slice(dir.length), d])) });
    }
  }
  return { tree, docstrip, skipped, note: 'flat package' };
}

/**
 * Run `latex x.ins` on a throw-away engine (the project's own incremental state is untouched) and return the files it generated.
 * `createEngine(fs)` -> Promise<TexEngine>;  `fs` the current HostFS (forked).
 */
export async function runDocstrip(fs, createEngine, { ins, files }) {
  const eng = await createEngine(fs.fork());
  const project = Object.fromEntries(files);
  const r = eng.compile(project, { main: ins, maxPasses: 1, incremental: false });
  const made = new Map();
  for (const f of eng.listFiles()) {
    if (/\.(log|pdf|aux|dvi)$/.test(f.name) || f.name in project) continue;
    made.set(f.name, eng.getFile(f.name));
  }
  return { files: made, log: r.log };
}

/**
 * Install a package: mount its files as an overlay layer named `name` (replacing a previous one of that name).
 *   input: { files: Map|object name -> bytes }   loose files or archive contents
 * returns { name, files, texmfFiles, generated: [...], skipped, note, maps }
 */
export async function installPackage(fs, name, input, { createEngine = null } = {}) {
  const files = input instanceof Map ? input : new Map(Object.entries(input));
  const plan = toTexmf(files, name);
  const generated = [];
  for (const job of plan.docstrip) {
    if (!createEngine) break;
    const g = await runDocstrip(fs, createEngine, job);
    for (const [fn, d] of g.files) {
      const dir = flatDir(fn, plan.tree.size ? name : name) || `tex/latex/${name}/`;
      plan.tree.set('texmf/' + dir + fn, d); generated.push(fn);
    }
  }
  const info = fs.mountLayer(name, plan.tree, { overlay: true, maps: true });
  const maps = refreshMaps(fs);
  return { name, files: info.files, bytes: info.bytes, generated, skipped: plan.skipped, note: plan.note, maps };
}

export function removePackage(fs, name) { const ok = fs.unmountLayer(name); refreshMaps(fs); return ok; }

/** the sty/cls/... names a layer provides (for the package list in the UI) */
export function layerProvides(fs, name) {
  const out = [];
  for (const e of fs.byId) if (!e.user && !e.gone && e.layer === name && /\.(sty|cls|bst|tfm|pfb)$/.test(e.path)) out.push(e.path.slice(e.path.lastIndexOf('/') + 1));
  return out.sort();
}
