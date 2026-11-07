#!/usr/bin/env bash
# Download + verify + unpack the pinned upstream sources (all from archive.ubuntu.com).
set -euo pipefail
. "$(dirname "$0")/env.sh"
UB=http://archive.ubuntu.com/ubuntu/pool/main
mkdir -p "$WORK/dl" "$WORK/src"
fetch() { # url sha512
  local f="$WORK/dl/$(basename "$1")"
  [ -f "$f" ] || curl -fsSL "$1" -o "$f"
  echo "$2  $f" | sha512sum -c - >/dev/null || { echo "checksum mismatch: $f" >&2; exit 1; }
}
unpack() { # file dest
  [ -d "$2" ] || { mkdir -p "$2.tmp" && tar -C "$2.tmp" --strip-components=1 -xf "$WORK/dl/$1" && mv "$2.tmp" "$2"; }
}
# TeX Live 2023 source tree (pdfTeX 1.40.25, web2c, kpathsea, xpdf ...)
fetch $UB/t/texlive-bin/texlive-bin_2023.20230311.66589.orig.tar.xz \
  "$(cat "$ROOT/scripts/checksums/texlive-bin.sha512")"
unpack texlive-bin_2023.20230311.66589.orig.tar.xz "$WORK/src/texlive"
# zlib + libpng: tiny C libraries, compiled straight into the wasm binary
fetch $UB/z/zlib/zlib_1.3.dfsg.orig.tar.xz \
  be6f020c691c61fe4ddcb27d3f8b2515435f544177e0b97286b5e85afc3862c1de6cd74a14ff6b065d620d046d35bf029fabfd1cf473f43a2cad60bf9ad55afe
unpack zlib_1.3.dfsg.orig.tar.xz "$WORK/src/zlib"
fetch $UB/libp/libpng1.6/libpng1.6_1.6.43.orig.tar.gz \
  3bb2a7b73113be42b09c2116e6c6f5a7ddb4e2ab06e0b13e10b7314acdccc4bb624ff602e16140c0484f6cde80efa190296226be3da195c6926819f07c723c12
unpack libpng1.6_1.6.43.orig.tar.gz "$WORK/src/libpng"
echo "sources ready in $WORK/src"
