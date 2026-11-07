#!/usr/bin/env node
// Error handling + recovery: every incremental result must equal a from-scratch compile of the same text,
// including after fatal errors (missing package, runaway argument, no \end{document}).
import fs from 'node:fs';
import { loadSystemFS, newEngine } from '../scripts/node-common.mjs';
const ENV = { SOURCE_DATE_EPOCH: '1700000000', FORCE_SOURCE_DATE: '1' };
const good = fs.readFileSync(new URL('./long.tex', import.meta.url), 'utf8');
const eq = (a, b) => (!a && !b) || (a && b && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
const sameLog = (a, b) => a.replace(/\d\d? \w{3} \d{4} \d\d:\d\d/g, '') === b.replace(/\d\d? \w{3} \d{4} \d\d:\d\d/g, '');
const eng = await newEngine(loadSystemFS(), { env: ENV });
const cases = [
  ['good', t => t],
  ['undefined control sequence (late)', t => t.replace('Section number 50}', 'Section \\undefinedmacro number 50}')],
  ['fixed again', t => t],
  ['missing package (fatal)', t => t.replace('\\usepackage{amsmath}', '\\usepackage{amsmath}\n\\usepackage{doesnotexist}')],
  ['fixed again', t => t],
  ['missing \\end{document}', t => t.replace('\\end{document}', '')],
  ['runaway argument', t => t.replace('Section number 20}', 'Section number 20')],
  ['back to good', t => t],
];
let ok = true, cur = good;
for (const [name, f] of cases) {
  cur = f(good);
  const r = eng.compile({ 'main.tex': cur }, { maxPasses: 3 });
  const ref = await (await newEngine(loadSystemFS(), { env: ENV })).compile({ 'main.tex': cur }, { maxPasses: 3, incremental: false });
  const same = eq(r.pdf, ref.pdf) && r.exit === ref.exit && sameLog(r.log, ref.log);
  ok &&= same;
  console.log(name.padEnd(36), `exit ${r.exit}`.padEnd(8), (r.pdf ? 'pdf ' + r.pdf.length : 'no pdf').padEnd(11), `${r.ms.toFixed(0).padStart(5)} ms`,
              r.passes.map(p => p.mode).join('+').padEnd(26), same ? 'matches cold' : '*** MISMATCH ***');
}
console.log(ok ? 'ALL OK' : 'FAILURES'); process.exit(ok ? 0 : 1);
