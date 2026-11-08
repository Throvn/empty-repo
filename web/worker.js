// worker.js -- runs pdftex.wasm off the main thread and owns the project's files.
//   main -> worker: {type:'init'} | {type:'files', set:{name: string|Uint8Array}, remove:[name]}
//                   | {type:'compile', id, main, maxPasses, incremental}
//   worker -> main: {type:'progress', text} | {type:'ready', ...} | {type:'result', ...} | {type:'error', ...}
import { HostFS, TexEngine } from './engine.js';

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

async function init() {
  const t0 = performance.now();
  const [wasm, meta, fmt, hotMeta, hot] = await Promise.all([
    fetchBytes('pdftex.wasm', 'pdfTeX engine'),
    fetchBytes('texlive.json', 'file index').then(b => JSON.parse(new TextDecoder().decode(b))),
    fetchBytes('pdflatex.fmt', 'LaTeX format'),
    fetch('hot.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetchBytes('hot.data', 'common TeX files').catch(() => null),
  ]);
  const fs = new HostFS();
  fs.addLazyPack(rangeReader('texlive.data'), meta);          // everything, on demand
  if (hot && hotMeta) fs.seedFromPack(hot, hotMeta);          // what a typical document needs, already in memory
  fs.addSystemFile('fmt/pdflatex.fmt', fmt);
  engine = await TexEngine.create({ wasm, fs, env: {} });
  postMessage({ type: 'ready', ms: performance.now() - t0, simd: engine.snapper.useShadow,
                wasmKB: wasm.length >> 10, packMB: +((meta.files.at(-1)?.end || 0) / 1048576).toFixed(0), files: meta.files.length });
}

onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'init') await init();
    else if (m.type === 'files') {
      for (const [n, d] of Object.entries(m.set || {})) project[n] = typeof d === 'string' ? enc.encode(d) : d;
      for (const n of m.remove || []) delete project[n];
    } else if (m.type === 'compile') {
      // One LaTeX pass at a time: show the first result immediately, then keep refining cross-references
      // (each further pass resumes from the snapshot before the first changed .aux read).
      const t0 = performance.now(), passes = m.maxPasses ?? 3;
      for (let pass = 0; pass < passes; pass++) {
        const r = engine.compile(project, { main: m.main || 'main.tex', maxPasses: 1, incremental: m.incremental });
        const final = r.converged || pass === passes - 1;
        const pdf = r.pdf ? r.pdf.slice() : null;      // transfer a copy: the engine keeps its cached result
        r.pdf = null;
        postMessage({ type: 'result', id: m.id, ...r, pdf, final, pass, ms: performance.now() - t0 }, pdf ? [pdf.buffer] : []);
        if (final) break;
      }
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.id, message: String(e && e.stack || e) });
  }
};
