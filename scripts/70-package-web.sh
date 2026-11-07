#!/usr/bin/env bash
# Assemble the deployable static site in build/web (serve it with any static file server).
set -euo pipefail
. "$(dirname "$0")/env.sh"
W="$WORK/web"; mkdir -p "$W"
PDFJS_VERSION=4.10.38
cp "$ROOT"/web/{index.html,engine.js,worker.js,viewer.js} "$W/"
if [ ! -f "$W/pdf.min.mjs" ]; then      # pdf.js for the preview pane
  mkdir -p "$WORK/pdfjs" && (cd "$WORK/pdfjs" && npm init -y >/dev/null && npm install --silent "pdfjs-dist@$PDFJS_VERSION")
  cp "$WORK/pdfjs/node_modules/pdfjs-dist/build/pdf.min.mjs" "$WORK/pdfjs/node_modules/pdfjs-dist/build/pdf.worker.min.mjs" "$W/"
fi
# pre-compressed copies; worker.js fetches NAME.gz first and inflates with DecompressionStream
for f in pdftex.wasm texlive.data pdflatex.fmt; do gzip -9 -f -k "$W/$f"; done
du -sh "$W"/*.gz
