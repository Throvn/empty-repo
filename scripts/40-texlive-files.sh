#!/usr/bin/env bash
# Assemble the TeX Live *runtime* tree for pdfTeX (macros, TFMs, Type 1 fonts, hyphenation, .bst styles ...) from pinned
# Ubuntu packages and split it into layers (core, extra) and pack each with scripts/pack-layer.sh.
# The data blob is NOT downloaded as a whole by the browser: files are fetched on demand with HTTP range requests.
set -euo pipefail
. "$(dirname "$0")/env.sh"
DEBVER=2023.20240207-1
TLPKGS="texlive-base texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-pictures texlive-science \
texlive-publishers texlive-plain-generic texlive-bibtex-extra texlive-formats-extra texlive-fonts-recommended texlive-fonts-extra \
texlive-lang-german texlive-lang-french texlive-lang-spanish texlive-lang-italian texlive-lang-portuguese texlive-lang-european \
texlive-lang-polish texlive-lang-cyrillic texlive-lang-czechslovak texlive-lang-greek texlive-lang-other \
texlive-humanities texlive-games texlive-pstricks"
DL="$WORK/dl/debs"; XD="$WORK/debs-x"; TREE="$WORK/texmf"; OUT="$WORK/web"
mkdir -p "$DL" "$XD" "$OUT"
cd "$DL"
for p in $TLPKGS; do [ -f "${p}_${DEBVER}_all.deb" ] || apt-get download "$p=$DEBVER" >/dev/null; done
[ -f "lmodern_2.005-1_all.deb" ] || apt-get download "lmodern=2.005-1" >/dev/null     # Latin Modern (T1/EC fonts)
[ -f "cm-super_0.3.4-17_all.deb" ] || apt-get download "cm-super=0.3.4-17" >/dev/null # CM in T1 (default of \usepackage[T1]{fontenc})
[ -f "cm-super-minimal_0.3.4-17_all.deb" ] || apt-get download "cm-super-minimal=0.3.4-17" >/dev/null   # its .enc files
PFB2T1C=$(apt-cache policy pfb2t1c2pfb | awk '/Candidate/{print $2}'); ls pfb2t1c2pfb_*_amd64.deb >/dev/null 2>&1 || apt-get download "pfb2t1c2pfb=$PFB2T1C" >/dev/null   # t1c2pfb
sha256sum -c "$ROOT/scripts/checksums/debs.sha256" >/dev/null || { echo "deb checksum mismatch" >&2; exit 1; }
for f in *.deb; do
  n="${f%%_*}"
  [ -d "$XD/$n" ] || { mkdir -p "$XD/$n.tmp"; dpkg-deb --fsys-tarfile "$f" | tar -x -C "$XD/$n.tmp" --exclude=./usr/share/doc --exclude=./usr/share/man 2>/dev/null; mv "$XD/$n.tmp" "$XD/$n"; }
done
# Debian ships cm-super's Type1 fonts as zero-length stubs + one compressed archive (cm-super.t1c); its postinst expands them with
# t1c2pfb.  Do the same here, otherwise \usepackage[T1]{fontenc} without lmodern has no outline fonts.
CMS="$XD/cm-super/usr/share/texmf/fonts/type1/public/cm-super"
if [ ! -s "$CMS/sftt1095.pfb" ]; then
  ( cd "$CMS" && "$XD/pfb2t1c2pfb/usr/bin/t1c2pfb" < "$XD/cm-super/usr/share/cm-super/cm-super.t1c" >/dev/null )
fi
du -sh "$CMS"
# web2c .tcx tables live in texlive-base; the tree only needs cp227.tcx
rm -rf "$TREE"; mkdir -p "$TREE"
python3 "$ROOT/scripts/tools/mktree.py" "$XD" "$TREE"
du -sh "$TREE"; find "$TREE" -type f | wc -l

# ---- one directory per layer, each packed by pack-layer.sh (data blob + compact index; the browser range-reads the blob) ----
LAYERS=$(python3 "$ROOT/scripts/tools/splitlayers.py" "$TREE" "$TREE.layers.json" "$WORK/layers")
rm -f "$OUT"/texlive.data "$OUT"/texlive.json
for l in $LAYERS; do "$ROOT/scripts/pack-layer.sh" "$WORK/layers/$l" "$l" "$OUT"; done
echo "$LAYERS" > "$WORK/layers.list"
python3 "$ROOT/scripts/tools/mkdist.py" "$OUT" $LAYERS      # full manifest (70-package-web.sh rewrites it for DIST_LAYERS=...)
