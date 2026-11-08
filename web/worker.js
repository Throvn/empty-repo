// worker.js -- runs pdftex.wasm off the main thread and owns the project's files.
//   main -> worker: {type:'init', dist?, layers?} | {type:'install', name, bytes|files} | {type:'remove', name} | {type:'mount', url} | {type:'files', set:{name: string|Uint8Array}, remove:[name]}
//                   | {type:'compile', id, main, maxPasses, incremental}
//   worker -> main: {type:'progress', text} | {type:'ready', ...} | {type:'result', ...} | {type:'error', ...}
import { HostFS, TexEngine } from './engine.js';
import { mountManifest, installPackage, removePackage, readArchive, layerProvides } from './dist.js';

const say = text => postMessage({ type: 'progress', text });
const enc = new TextEncoder();

/** fetch `url` (preferring url.gz, decompressed with DecompressionStream) as a Uint8Array */
async function fetchBytes(url, label) {
  for (const u of [url + '.gz', url]) {
    let res;
    try { res = await fetch(u); } catch { continue; }
    if (!res.ok) continue;
    say(`loading ${label}…`);
    const gz = u.endsWith('.gz') && !/gzip/.test(res.headers.get('content-encoding') || '');
    const body = gz ? res.body.pipeThrough(new DecompressionStream('gzip')) : res.body;
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  throw new Error('cannot load ' + url);
}

/** synchronous HTTP range request (allowed in workers): the TeX tree is fetched file by file, on demand */
function rangeReader(url) {
  const whole = {};                                   // server without Range support: remember the whole body
  return (start, end) => {
    if (whole.b) return whole.b.subarray(start, end);
    const x = new XMLHttpRequest();
    x.open('GET', url, false); x.responseType = 'arraybuffer';
    x.setRequestHeader('Range', `bytes=${start}-${end - 1}`);
    x.send();
    if (x.status === 206) return new Uint8Array(x.response);
    if (x.status === 200) { whole.b = new Uint8Array(x.response); return whole.b.subarray(start, end); }
    throw new Error(`range request for ${url} failed: HTTP ${x.status}`);
  };
}

let engine = null;
const project = {};          // name -> Uint8Array: the user's files (text files are UTF-8 bytes)

const io = {
  json: async url => { const r = await fetch(url); if (!r.ok) throw new Error(`cannot load ${url}: HTTP ${r.status}`); return r.json(); },
  bytes: (url, label) => fetchBytes(url, label),
  range: url => rangeReader(url),
  resolve: (manifest, rel) => new URL(rel, new URL(manifest, self.location.href)).href,
};
const layerList = fs => [...fs.layerInfo.values()].filter(l => l.name[0] !== '$').map(l => ({ name: l.name, files: l.files, bytes: l.bytes, overlay: l.overlay, provides: l.overlay ? layerProvides(fs, l.name).slice(0, 200) : undefined }));
let hostFS = null, wasmBytes = null;
const createEngine = f => TexEngine.create({ wasm: wasmBytes, fs: f, env: {} });

/** init: {dist: URL of the distribution manifest (default dist.json), layers: [URL of extra layer manifests]} */
async function init(m) {
  const t0 = performance.now();
  const distUrl = m.dist || 'dist.json';
  const [wasm, bibtexWasm, makeindexWasm, hotMeta, hot] = await Promise.all([
    fetchBytes('pdftex.wasm', 'pdfTeX engine'),
    fetchBytes('bibtex.wasm', 'BibTeX').catch(() => null),
    fetchBytes('makeindex.wasm', 'makeindex').catch(() => null),
    fetch('hot.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetchBytes('hot.data', 'common TeX files').catch(() => null),
  ]);
  wasmBytes = wasm;
  const fs = hostFS = new HostFS();
  say('loading TeX distribution…');
  const dist = await mountManifest(fs, distUrl, io);                                   // every layer: on demand (HTTP Range)
  for (const u of m.layers || []) { say(`loading layer ${u}…`); await mountManifest(fs, u, io, { overlay: true }); }
  if (hot && hotMeta) fs.seedFromPack(hot, hotMeta);                                  // what a typical document needs, already in memory
  const fmt = await fetchBytes(dist.format || 'pdflatex.fmt', 'LaTeX format');
  fs.addSystemFile('fmt/pdflatex.fmt', fmt);
  engine = await TexEngine.create({ wasm, bibtexWasm, makeindexWasm, fs, env: {} });
  const layers = layerList(fs);
  postMessage({ type: 'ready', ms: performance.now() - t0, simd: engine.snapper.useShadow, wasmKB: wasm.length >> 10, dist: dist.name,
                packMB: +(layers.reduce((a, l) => a + l.bytes, 0) / 1048576).toFixed(0), files: layers.reduce((a, l) => a + l.files, 0), layers });
}

/** install a package from {name, bytes: archive | files: {path: bytes}} */
async function install(m) {
  const input = m.files ? new Map(Object.entries(m.files)) : await readArchive(m.bytes, m.filename || m.name);
  const info = await installPackage(hostFS, m.name, input, { createEngine });
  postMessage({ type: 'installed', name: m.name, info, layers: layerList(hostFS) });
}

onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'init') await init(m);
    else if (m.type === 'install') await install(m);
    else if (m.type === 'remove') { removePackage(hostFS, m.name); postMessage({ type: 'removed', name: m.name, layers: layerList(hostFS) }); }
    else if (m.type === 'mount') { await mountManifest(hostFS, m.url, io, { overlay: true }); postMessage({ type: 'mounted', url: m.url, layers: layerList(hostFS) }); }
    else if (m.type === 'files') {
      for (const [n, d] of Object.entries(m.set || {})) project[n] = typeof d === 'string' ? enc.encode(d) : d;
      for (const n of m.remove || []) delete project[n];
    } else if (m.type === 'compile') {
      // One LaTeX pass at a time: show the first result immediately, then keep refining cross-references
      // (each further pass resumes from the snapshot before the first changed .aux read).
      const t0 = performance.now(), passes = m.maxPasses ?? 3;
      for (let pass = 0; pass < passes; pass++) {
        const r = engine.compile(project, { main: m.main || 'main.tex', maxPasses: 1, incremental: m.incremental, synctex: m.synctex });
        const final = r.converged || pass === passes - 1;
        const pdf = r.pdf ? r.pdf.slice() : null;      // transfer a copy: the engine keeps its cached result
        const sx = final && r.synctex ? r.synctex.slice() : null;
        r.pdf = null; r.synctex = null;
        postMessage({ type: 'result', id: m.id, ...r, pdf, synctex: sx, final, pass, ms: performance.now() - t0 }, [pdf && pdf.buffer, sx && sx.buffer].filter(Boolean));
        if (final) break;
      }
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.id, message: String(e && e.stack || e) });
  }
};
