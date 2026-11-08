// synctex.js -- parse pdfTeX's (uncompressed) .synctex and answer "which source line is at this PDF position?" (inverse) and
// "where is this source line in the PDF?" (forward).  Coordinates are returned in PDF points, origin top-left, as the viewer uses.
//
// Format (SyncTeX v1): Input:tag:path ... Content: then per page  {n ... }n  with nested boxes
//   [tag,line:x,y:w,h,d  vbox      (tag,line:x,y:w,h,d  hbox      v/h tag,line:x,y:w,h,d  void boxes
//   k tag,line:x,y:w  kern         g tag,line:x,y  glue          x tag,line:x,y  current point     $ math
// all in scaled points; y is the baseline (measured from the top), a box covers y-h .. y+d.

const SP_PER_BP = 65781.76;

export function parseSynctex(text) {
  const lines = text.split('\n');
  const inputs = new Map(), sheets = [];
  let unit = 1, mag = 1000, xoff = 0, yoff = 0, sheet = null, stack = [];
  for (const l of lines) {
    let m;
    if ((m = /^Input:(\d+):(.*)$/.exec(l))) { inputs.set(+m[1], m[2].replace(/^\/work\//, '').replace(/^(\.\/)+/, '')); continue; }
    if ((m = /^Magnification:(\d+)/.exec(l))) { mag = +m[1]; continue; }
    if ((m = /^Unit:(\d+)/.exec(l))) { unit = +m[1]; continue; }
    if ((m = /^X Offset:(-?\d+)/.exec(l))) { xoff = +m[1]; continue; }
    if ((m = /^Y Offset:(-?\d+)/.exec(l))) { yoff = +m[1]; continue; }
    if (l === 'Postamble:') break;
    const k = unit * mag / 1000 / SP_PER_BP;
    const bp = (v, off = 0) => (v + off) * k;
    if ((m = /^\{(\d+)/.exec(l))) { sheet = { page: +m[1], root: [], all: [] }; sheets[+m[1]] = sheet; stack = []; continue; }
    if (/^\}\d+/.test(l)) { sheet = null; stack = []; continue; }
    if (!sheet) continue;
    const ch = l[0];
    if (ch === '[' || ch === '(') {                                     // box start
      m = /^.(\d+),(\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/.exec(l); if (!m) continue;
      const n = { t: ch, tag: +m[1], line: +m[2], x: bp(+m[3], xoff), y: bp(+m[4], yoff), w: bp(+m[5]), h: bp(+m[6]), d: bp(+m[7]), kids: [] };
      n.parent = stack.length ? stack[stack.length - 1] : null;
      (stack.length ? stack[stack.length - 1].kids : sheet.root).push(n); sheet.all.push(n); stack.push(n);
    } else if (ch === ']' || ch === ')') stack.pop();
    else if ('vh'.includes(ch)) {                                       // void boxes
      m = /^.(\d+),(\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/.exec(l); if (!m) continue;
      const n = { t: ch, tag: +m[1], line: +m[2], x: bp(+m[3], xoff), y: bp(+m[4], yoff), w: bp(+m[5]), h: bp(+m[6]), d: bp(+m[7]), kids: [] };
      (stack.length ? stack[stack.length - 1].kids : sheet.root).push(n); sheet.all.push(n);
    } else if ('kgx$'.includes(ch)) {                                   // leaves: kern (has width), glue, current, math
      m = /^.(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+))?/.exec(l); if (!m) continue;
      const n = { t: ch, tag: +m[1], line: +m[2], x: bp(+m[3], xoff), y: bp(+m[4], yoff), w: m[5] ? bp(+m[5]) : 0, h: 0, d: 0, kids: null };
      if (stack.length) stack[stack.length - 1].kids.push(n);
      sheet.all.push(n);
    }
  }
  return { inputs, sheets };
}

/** inverse search: PDF point (bp, origin top-left) on `page` -> {file, line} or null */
export function inverse(sx, page, px, py) {
  const sh = sx.sheets[page]; if (!sh) return null;
  let best = null, area = Infinity;
  for (const n of sh.all) {                                             // innermost hbox containing the point
    if (n.t !== '(' && n.t !== 'h') continue;
    if (px < n.x - 1 || px > n.x + n.w + 1 || py < n.y - n.h - 1 || py > n.y + n.d + 1) continue;
    const a = Math.max(n.w, 1) * Math.max(n.h + n.d, 1);
    if (a < area) { area = a; best = n; }
  }
  if (!best) {                                                          // nearest hbox vertically
    let dist = Infinity;
    for (const n of sh.all) if (n.t === '(') { const dy = py < n.y - n.h ? n.y - n.h - py : py > n.y + n.d ? py - n.y - n.d : 0, dx = px < n.x ? n.x - px : px > n.x + n.w ? px - n.x - n.w : 0; const d = dy * dy * 4 + dx * dx; if (d < dist) { dist = d; best = n; } }
    if (!best) return null;
  }
  // Measured against ground truth (unique tokens on every source line, multi-line paragraphs): the line recorded by the
  // kern/glue immediately to the RIGHT of the clicked word is the line the word was typed on (97% exact, the rest off by
  // one line); the glue to its left belongs to the previous word, and x/box records carry other lines.  The last word of a
  // paragraph has no glue to its right: use the one on its left.
  const kg = (best.kids || []).filter(c => (c.t === 'k' || c.t === 'g') && c.line).sort((a, b) => a.x - b.x);
  let leaf = kg.find(c => c.x > px);
  if (!leaf) leaf = kg.filter(c => c.x <= px).pop();
  if (!leaf) leaf = (best.kids || []).find(c => c.line) || best;
  const n = leaf.line ? leaf : best;
  const file = sx.inputs.get(n.tag);
  return file ? { file, line: n.line } : null;
}

/** forward search: source (file, line) -> {page, x, y, w, h} in bp, or null.  Uses the nearest line >= `line` that produced output. */
export function forward(sx, file, line) {
  const tags = [...sx.inputs].filter(([, f]) => f === file || f.endsWith('/' + file)).map(([t]) => t);
  if (!tags.length) return null;
  let best = null, bestLine = Infinity, bestPage = Infinity;
  for (const sh of sx.sheets) {
    if (!sh) continue;
    for (const n of sh.all) {
      if (!tags.includes(n.tag) || n.line < line) continue;
      if (n.line < bestLine || (n.line === bestLine && sh.page < bestPage)) { best = n; bestLine = n.line; bestPage = sh.page; }
    }
  }
  if (!best) return null;
  const rects = [];                                                     // all nodes of that line on that page: bounding box
  for (const n of sx.sheets[bestPage].all) if (tags.includes(n.tag) && n.line === bestLine) rects.push(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of rects) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x + Math.max(n.w, 0)); const top = n.t === '(' || n.t === 'h' || n.t === '[' ? n.y - n.h : n.y - 8; y0 = Math.min(y0, top); y1 = Math.max(y1, n.y + n.d + 2); }
  return { page: bestPage, x: x0, y: y0, w: x1 - x0, h: y1 - y0, line: bestLine };
}
