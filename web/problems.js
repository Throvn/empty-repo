// problems.js -- turn a TeX log into a list of {kind, file, line, message} the editor can jump to.

/** TeX wraps log lines at max_print_line (79 columns): glue the pieces back together */
export function unwrap(log) {
  const out = []; let cur = '';
  for (const l of log.split('\n')) {
    cur += l;
    if (l.length === 79) continue;        // continued on the next physical line
    out.push(cur); cur = '';
  }
  if (cur) out.push(cur);
  return out;
}

const FILE_OPEN = /^\((\.{0,2}\/?[\w\-.\/ ]+?\.(?:tex|sty|cls|def|clo|cfg|fd|aux|bbl|ldf|lbx|cbx|bib|toc|out|lof|lot|ltx|dtx|code\.tex))(?=[\s)(]|$)/;

export function parseProblems(log, main = 'main.tex') {
  const lines = unwrap(log), problems = [], stack = [];
  const norm = f => (f || main).replace(/^\.\//, '');
  const top = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return norm(stack[i]); return main; };
  const userFile = f => !/^texmf\//.test(f) && !f.startsWith('/');
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let m;
    // "-file-line-error" style errors:  ./main.tex:12: Undefined control sequence.
    if ((m = /^((?:\.\/)?[^\s:()]+):(\d+): (.*)$/.exec(L))) {
      let msg = m[3];
      const ctx = lines[i + 1] && /^l\.\d+/.test(lines[i + 1]) ? lines[i + 1].replace(/^l\.\d+ /, '') : '';
      problems.push({ kind: 'error', file: norm(m[1]), line: +m[2], message: msg, context: ctx });
    } else if ((m = /^! (.*)$/.exec(L))) {                       // errors without a file (fatal, emergency stop)
      const lm = lines.slice(i, i + 12).map(x => /^l\.(\d+)/.exec(x)).find(Boolean);
      problems.push({ kind: 'error', file: top(), line: lm ? +lm[1] : 0, message: m[1], context: '' });
    } else if ((m = /^(LaTeX|Package \S+|Class \S+) (Warning|Info): (.*?)(?: on input line (\d+)\.)?$/.exec(L)) && m[2] === 'Warning') {
      let msg = m[3], ln = m[4] ? +m[4] : 0;
      for (let j = i + 1; j < lines.length && /^\(\S+\)\s+/.test(lines[j]); j++) msg += ' ' + lines[j].replace(/^\(\S+\)\s+/, '');
      const im = /on input line (\d+)/.exec(msg); if (!ln && im) ln = +im[1];
      problems.push({ kind: 'warning', file: top(), line: ln, message: `${m[1]}: ${msg.replace(/ on input line \d+\.?$/, '')}` });
    } else if ((m = /^(Overfull|Underfull) \\([hv])box (.*) in (?:paragraph|alignment) at lines (\d+)--(\d+)/.exec(L)) || (m = /^(Overfull|Underfull) \\([hv])box (.*) (?:detected|has occurred) at line (\d+)/.exec(L))) {
      problems.push({ kind: 'box', file: top(), line: +m[4], message: `${m[1]} \\${m[2]}box ${m[3]}` });
    } else if (/^pdfTeX warning/.test(L) || /^\S.*Missing character/.test(L)) {
      problems.push({ kind: 'warning', file: top(), line: 0, message: L });
    }
    // maintain TeX's file stack from the parentheses on this line (message lines are skipped when they look like prose)
    if (!/^(!|l\.\d|<|\s)/.test(L)) {
      for (let k = 0; k < L.length; k++) {
        if (L[k] === '(') { const fm = FILE_OPEN.exec(L.slice(k)); stack.push(fm ? fm[1] : null); }
        else if (L[k] === ')') stack.pop();
      }
    }
  }
  // identical (kind, file, line, message) repeats - e.g. an undefined macro in a heading is hit by the title, the running head and the toc
  const seen = new Map(), uniq = [];
  for (const p of problems) {
    const k = `${p.kind}|${p.file}|${p.line}|${p.message}`;
    if (seen.has(k)) { seen.get(k).count++; continue; }
    p.count = 1; p.system = !userFile(p.file); seen.set(k, p); uniq.push(p);
  }
  return uniq;
}
