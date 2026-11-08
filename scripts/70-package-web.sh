#!/usr/bin/env bash
# Assemble the deployable static site in build/web (serve it with any static file server).
set -euo pipefail
. "$(dirname "$0")/env.sh"
W="$WORK/web"; mkdir -p "$W"
PDFJS_VERSION=4.10.38
cp "$ROOT"/web/{index.html,engine.js,worker.js,viewer.js,project.js,problems.js,synctex.js} "$W/"
if [ ! -f "$W/pdf.min.mjs" ]; then      # pdf.js for the preview pane
  mkdir -p "$WORK/pdfjs" && (cd "$WORK/pdfjs" && npm init -y >/dev/null && npm install --silent "pdfjs-dist@$PDFJS_VERSION")
  cp "$WORK/pdfjs/node_modules/pdfjs-dist/build/pdf.min.mjs" "$WORK/pdfjs/node_modules/pdfjs-dist/build/pdf.worker.min.mjs" "$W/"
fi
# hot.data / hot.json: the files a typical document reads (see 66-hotset.mjs), loaded eagerly
python3 "$EMENV/lib/emscripten-4.0.9/tools/file_packager.py" "$W/hot.data" --preload "$WORK/hot-tree@/texmf" \
  --separate-metadata --js-output="$W/hot.pack.js" --no-node >/dev/null && mv -f "$W/hot.pack.js.metadata" "$W/hot.json" && rm -f "$W/hot.pack.js"
# pre-compressed copies; worker.js fetches NAME.gz first and inflates with DecompressionStream
# (texlive.data is NOT compressed: it is read with HTTP range requests)
for f in pdftex.wasm bibtex.wasm pdflatex.fmt hot.data texlive.json; do gzip -9 -f -k "$W/$f"; done
rm -f "$W/texlive.data.gz"
du -sh "$W"/*.gz
