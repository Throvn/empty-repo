// viewer.js -- tiny PDF viewer on top of pdf.js: lazy canvas rendering, keeps the scroll position
// when the PDF is replaced after every (live) compile.
import * as pdfjs from './pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

export class PdfView {
  constructor(el) {
    this.el = el; this.gen = 0;
    this.io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && this._render(e.target)), { root: el, rootMargin: '600px 0px' });
    new ResizeObserver(() => { if (this.doc && Math.abs(el.clientWidth - this._w) > 8) this.show(null, true); }).observe(el);
  }
  async show(bytes, relayout = false) {
    const gen = ++this.gen, top = this.el.scrollTop;
    if (bytes) { this.doc?.destroy(); this.doc = await pdfjs.getDocument({ data: bytes.slice() }).promise; }
    if (gen !== this.gen) return;
    const doc = this.doc, w = this._w = this.el.clientWidth;
    const frag = document.createDocumentFragment(), nodes = [];
    const first = await doc.getPage(1);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = n === 1 ? first : await doc.getPage(n);
      const base = page.getViewport({ scale: 1 }), scale = Math.min(2, (w - 24) / base.width);
      const ph = document.createElement('div');
      ph.className = 'ph'; ph.dataset.n = n; ph.dataset.scale = scale;
      ph.style.width = Math.floor(base.width * scale) + 'px'; ph.style.height = Math.floor(base.height * scale) + 'px';
      ph._page = page; frag.appendChild(ph); nodes.push(ph);
    }
    if (gen !== this.gen) return;
    this.io.disconnect();
    this.el.replaceChildren(frag);
    this.el.scrollTop = top;
    nodes.forEach(n => this.io.observe(n));
  }
  async _render(ph) {
    if (ph._done) return; ph._done = true;
    const page = ph._page, dpr = window.devicePixelRatio || 1, scale = +ph.dataset.scale;
    const vp = page.getViewport({ scale: scale * dpr });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = ph.style.width; c.style.height = ph.style.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (ph.isConnected) ph.replaceWith(c);
  }
}
