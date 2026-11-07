// Generates the synthetic long test document (build/long.tex) with tests/gen-long.py on demand.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export function longDoc(sections = 60) {
  const out = path.join(here, '..', 'build', `long${sections}.tex`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, execFileSync('python3', [path.join(here, 'gen-long.py'), String(sections)], { maxBuffer: 1 << 28 }));
  }
  return out;
}
