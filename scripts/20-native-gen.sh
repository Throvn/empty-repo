#!/usr/bin/env bash
# Build pdfTeX *natively* only to run web2c (tangle -> web2c -> C) and harvest the
# generated, platform-independent C sources into build/gen. These are what we cross-compile.
set -euo pipefail
. "$(dirname "$0")/env.sh"
SRC="$WORK/src/texlive"; N="$WORK/native"; GEN="$WORK/gen"
mkdir -p "$N" && cd "$N"
if [ ! -f Makefile ]; then
  "$SRC/configure" --disable-all-pkgs --enable-pdftex --disable-synctex \
     --with-system-zlib --with-system-libpng --without-x --disable-shared \
     --disable-multiplatform CFLAGS=-O1 CXXFLAGS=-O1 >configure.log 2>&1
fi
make -j"$(nproc)" >toplevel.log 2>&1                     # runs the sub-configures, builds libs/xpdf
make -C texk/kpathsea -j"$(nproc)" >kpse.log 2>&1
make -C texk/web2c -j"$(nproc)" pdftex >pdftex.log 2>&1
mkdir -p "$GEN"
W="$N/texk/web2c"
cp "$W"/pdftexini.c "$W"/pdftex0.c "$W"/pdftex-pool.c "$W"/pdftexd.h "$W"/pdftexcoerce.h "$GEN/"
cp "$W"/w2c/c-auto.h "$GEN/web2c-c-auto.h"
cp "$N"/texk/kpathsea/c-auto.h "$GEN/kpathsea-c-auto.h"
cp "$N"/texk/kpathsea/paths.h "$GEN/kpathsea-paths.h"
cp "$N"/texk/kpathsea/kpathsea.h "$GEN/kpathsea-kpathsea.h"
# native pdftex stays available as a reference implementation for tests
cp "$W"/pdftex "$GEN/pdftex.native"
ls -la "$GEN"
