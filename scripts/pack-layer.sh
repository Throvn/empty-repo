#!/usr/bin/env bash
# Pack a TDS-style directory (tex/latex/<pkg>/*.sty, fonts/tfm/..., bibtex/bst/...) into a distribution *layer*:
#   NAME.data   all file bytes, concatenated (read with HTTP Range requests, never downloaded as a whole)
#   NAME.json   compact index {"d": [dirs], "f": [[dir, name, start, end], ...]}, paths below texmf/
#   NAME.layer.json  {"name", "index", "data"}  -- the entry to list in dist.json (or to load alone with ?layer=URL)
# usage: scripts/pack-layer.sh <dir> <name> [outdir=build/web]
set -euo pipefail
. "$(dirname "$0")/env.sh"
DIR=$(realpath "$1"); NAME=$2; OUT=${3:-$WORK/web}; mkdir -p "$OUT"
python3 "$EMENV/lib/emscripten-4.0.9/tools/file_packager.py" "$OUT/$NAME.data" --preload "$DIR@/texmf" \
  --separate-metadata --js-output="$OUT/$NAME.pack.js" --no-node >/dev/null
python3 "$ROOT/scripts/tools/mkindex.py" "$OUT/$NAME.pack.js.metadata" "$OUT/$NAME.json"
rm -f "$OUT/$NAME.pack.js" "$OUT/$NAME.pack.js.metadata"
printf '{"name":"%s","index":"%s.json","data":"%s.data"}\n' "$NAME" "$NAME" "$NAME" > "$OUT/$NAME.layer.json"
echo "layer $NAME: $(python3 -c "import json,sys;print(len(json.load(open('$OUT/$NAME.json'))['f']))") files, $(du -h "$OUT/$NAME.data" | cut -f1)" >&2
