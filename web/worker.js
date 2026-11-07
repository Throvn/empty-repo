// worker.js -- runs pdftex.wasm off the main thread.
//   main -> worker: {type:'init'} | {type:'compile', files, main, maxPasses, incremental}
//   worker -> main: {type:'progress', text} | {type:'ready', ...} | {type:'result', ...}
import { HostFS, TexEngine } from './engine.js';

const say = text => postMessage({ type: 'progress', text });

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

let engine = null;

async function init() {
  const t0 = performance.now();
  const [wasm, data, meta, fmt, diff] = await Promise.all([
    fetchBytes('pdftex.wasm', 'pdfTeX engine'),
    fetchBytes('texlive.data', 'TeX Live support files'),
    fetch('texlive.json').then(r => r.json()),
    fetchBytes('pdflatex.fmt', 'LaTeX format'),
    fetchBytes('diff.wasm', 'snapshot helper').catch(() => null),
  ]);
  const fs = new HostFS();
  fs.addPack(data, meta);
  fs.addSystemFile('fmt/pdflatex.fmt', fmt);
  engine = await TexEngine.create({ wasm, fs, diffWasm: diff, env: { SOURCE_DATE_EPOCH: undefined } });
  postMessage({ type: 'ready', ms: performance.now() - t0, simd: !!engine.snapper.diff,
                wasmKB: wasm.length >> 10, packMB: +(data.length / 1048576).toFixed(1) });
}

onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'init') await init();
    else if (m.type === 'compile') {
      const r = engine.compile(m.files, { main: m.main || 'main.tex', maxPasses: m.maxPasses ?? 3, incremental: m.incremental });
      const pdf = r.pdf ? r.pdf.slice() : null;   // transfer a copy: the engine keeps its cached result
      r.pdf = null;
      postMessage({ type: 'result', id: m.id, ...r, pdf }, pdf ? [pdf.buffer] : []);
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.id, message: String(e && e.stack || e) });
  }
};
