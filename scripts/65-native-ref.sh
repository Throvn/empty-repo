#!/usr/bin/env bash
# Reference setup for differential tests: the *native* pdftex built by 20-native-gen.sh, configured with
# exactly the same parameters (extracted from src/mini_kpse.c) and the same TeX tree as pdftex.wasm.
set -euo pipefail
. "$(dirname "$0")/env.sh"
R="$WORK/native-ref"; T="$WORK/texmf"; mkdir -p "$R" /work
{
  echo "TEXMFROOT = $T"
  echo "TEXINPUTS = .:$T/tex//"
  echo "TFMFONTS = $T/fonts/tfm//"
  echo "VFFONTS = $T/fonts/vf//"
  echo "T1FONTS = $T/fonts/type1//"
  echo "ENCFONTS = $T/fonts/enc//"
  echo "TEXFONTMAPS = $T/fonts/map//"
  echo "TCXPATH = $T/web2c"
  echo "TEXFORMATS = $R"
  echo "TEXMFCNF = $R"
  echo "shell_escape = f"
  echo "openout_any = p"
  python3 - "$ROOT/src/mini_kpse.c" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
tab = src[src.index("params[]"):src.index("{0, 0}")]
for k, v in re.findall(r'\{"(\w+)",\s*"(\w+)"\}', tab):
    if k not in ("shell_escape", "openout_any", "openin_any"):
        print(f"{k} = {v}")
PY
} > "$R/texmf.cnf"
ln -sf "$WORK/gen/pdftex.native" "$R/pdflatex"   # invoked as `pdflatex`, like the real thing
cd "$R"
export TEXMFCNF="$R" SOURCE_DATE_EPOCH=1700000000 FORCE_SOURCE_DATE=1
"$WORK/gen/pdftex.native" -ini -interaction=nonstopmode -jobname=pdflatex -translate-file=cp227.tcx '*pdflatex.ini' > fmt.log 2>&1 || true
ls -la pdflatex.fmt
