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
    if (bytes) { const old = this.doc; this.doc = await pdfjs.getDocument({ data: bytes.slice() }).promise; old?.destroy(); }
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
    this.el.replaceChildren(frag);                  // (a highlight added after this point is dropped with the old content: fine)
    this.el.scrollTop = top;
    nodes.forEach(n => this.io.observe(n));
  }
  /** element (placeholder or canvas) of page n (1-based) */
  pageEl(n) { return [...this.el.children].find(c => c.dataset && +c.dataset.n === n && !c.classList.contains('hl')); }
  /** click event -> {page, x, y} in PDF points, origin top-left (what SyncTeX uses), or null */
  pointAt(ev) {
    const t = ev.target.closest && ev.target.closest('[data-n]'); if (!t) return null;
    const r = t.getBoundingClientRect(), sc = +t.dataset.scale;
    return { page: +t.dataset.n, x: (ev.clientX - r.left) / sc, y: (ev.clientY - r.top) / sc };
  }
  /** scroll so that PDF rectangle (points, top-left origin) of `page` is visible and flash a highlight on it */
  reveal(page, x, y, w, h) {
    const el = this.pageEl(page); if (!el) return;
    const sc = +el.dataset.scale, top = el.offsetTop + y * sc;
    this.el.scrollTo({ top: Math.max(0, top - this.el.clientHeight * 0.35), behavior: 'smooth' });
    const hl = document.createElement('div'); hl.className = 'hl';
    Object.assign(hl.style, { position: 'absolute', left: (el.offsetLeft + x * sc - 3) + 'px', top: (top - 2) + 'px', width: (Math.max(w, 20) * sc + 6) + 'px', height: (Math.max(h, 10) * sc + 4) + 'px',
      background: 'rgba(255,200,0,.35)', outline: '2px solid rgba(255,160,0,.9)', borderRadius: '3px', pointerEvents: 'none', transition: 'opacity .8s' });
    this.el.appendChild(hl); setTimeout(() => { hl.style.opacity = '0'; }, 1200); setTimeout(() => hl.remove(), 2200);
  }
  async _render(ph) {
    if (ph._done) return; ph._done = true;
    const page = ph._page, dpr = window.devicePixelRatio || 1, scale = +ph.dataset.scale;
    const vp = page.getViewport({ scale: scale * dpr });
    const c = document.createElement('canvas');
    c.dataset.n = ph.dataset.n; c.dataset.scale = ph.dataset.scale;
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = ph.style.width; c.style.height = ph.style.height;
    try { await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; }
    catch (e) { return; }                       // cancelled because a newer PDF replaced this document
    if (ph.isConnected) ph.replaceWith(c);
  }
}
