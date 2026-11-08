#!/usr/bin/env bash
# Assemble the TeX Live *runtime* tree for pdfTeX (macros, TFMs, Type 1 fonts, hyphenation, .bst styles ...) from pinned
# Ubuntu packages and pack it with emscripten's file_packager into texlive.data (+ texlive.json index).
# The data blob is NOT downloaded as a whole by the browser: files are fetched on demand with HTTP range requests.
set -euo pipefail
. "$(dirname "$0")/env.sh"
DEBVER=2023.20240207-1
TLPKGS="texlive-base texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-pictures texlive-science \
texlive-publishers texlive-plain-generic texlive-bibtex-extra texlive-formats-extra texlive-fonts-recommended texlive-fonts-extra \
texlive-lang-german texlive-lang-french texlive-lang-spanish texlive-lang-italian texlive-lang-portuguese texlive-lang-european \
texlive-lang-polish texlive-lang-cyrillic texlive-lang-czechslovak"
DL="$WORK/dl/debs"; XD="$WORK/debs-x"; TREE="$WORK/texmf"; OUT="$WORK/web"
mkdir -p "$DL" "$XD" "$OUT"
cd "$DL"
for p in $TLPKGS; do [ -f "${p}_${DEBVER}_all.deb" ] || apt-get download "$p=$DEBVER" >/dev/null; done
[ -f "lmodern_2.005-1_all.deb" ] || apt-get download "lmodern=2.005-1" >/dev/null     # Latin Modern (T1/EC fonts)
[ -f "cm-super_0.3.4-17_all.deb" ] || apt-get download "cm-super=0.3.4-17" >/dev/null # CM in T1 (default of \usepackage[T1]{fontenc})
sha256sum -c "$ROOT/scripts/checksums/debs.sha256" >/dev/null || { echo "deb checksum mismatch" >&2; exit 1; }
for f in *.deb; do
  n="${f%%_*}"
  [ -d "$XD/$n" ] || { mkdir -p "$XD/$n.tmp"; dpkg-deb --fsys-tarfile "$f" | tar -x -C "$XD/$n.tmp" --exclude=./usr/share/doc --exclude=./usr/share/man 2>/dev/null; mv "$XD/$n.tmp" "$XD/$n"; }
done
# web2c .tcx tables live in texlive-base; the tree only needs cp227.tcx
rm -rf "$TREE"; mkdir -p "$TREE"
python3 "$ROOT/scripts/tools/mktree.py" "$XD" "$TREE"
du -sh "$TREE"; find "$TREE" -type f | wc -l

# ---- pack with emscripten's file_packager (data blob + json index; no JS loader needed) ----
python3 "$EMENV/lib/emscripten-4.0.9/tools/file_packager.py" "$OUT/texlive.data" \
  --preload "$TREE@/texmf" --separate-metadata --js-output="$OUT/texlive.pack.js" --no-node >/dev/null
python3 "$ROOT/scripts/tools/mkindex.py" "$OUT/texlive.pack.js.metadata" "$OUT/texlive.json"
rm -f "$OUT/texlive.pack.js" "$OUT/texlive.pack.js.metadata"      # only the data blob + compact index are used
ls -la "$OUT/texlive.data" "$OUT/texlive.json"
