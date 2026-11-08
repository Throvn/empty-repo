#!/usr/bin/env bash
# Cross-compile pdfTeX (generated C + hand-written support code) into ONE wasm file.
set -euo pipefail
. "$(dirname "$0")/env.sh"
SRC="$WORK/src/texlive/texk/web2c"; KP="$WORK/src/texlive/texk"
ENGINE="${ENGINE:-pdftex}"            # pdftex (the product) | tex, etex (for the trip / e-trip tests)
GEN="$WORK/gen"; OBJ="$WORK/wasm/obj-$ENGINE"; OUT="$WORK/wasm"
OPT="${OPT:--O2}"
mkdir -p "$OBJ" "$WORK/wasm/inc/w2c" "$WORK/wasm/inc/kpathsea"

# ---- wasm32 config headers: derive from the native ones, fix type sizes ------
sed -e 's/^#define SIZEOF_LONG 8/#define SIZEOF_LONG 4/' \
    -e 's/^#define SIZEOF_VOID_P 8/#define SIZEOF_VOID_P 4/' \
    -e 's/^#define SIZEOF_OFF_T 0/#define SIZEOF_OFF_T 8/' "$GEN/web2c-c-auto.h" > "$WORK/wasm/inc/w2c/c-auto.h"
sed -e 's/^#define SIZEOF_LONG 8/#define SIZEOF_LONG 4/' "$GEN/kpathsea-c-auto.h" > "$WORK/wasm/inc/kpathsea/c-auto.h"
cp "$GEN/kpathsea-paths.h" "$WORK/wasm/inc/kpathsea/paths.h"
cp "$GEN/kpathsea-kpathsea.h" "$WORK/wasm/inc/kpathsea/kpathsea.h"
# libpng config: the stock prebuilt config minus setjmp support (see src/shim/nosjlj.h, src/png_glue.c)
grep -v -e 'PNG_SETJMP_SUPPORTED' -e 'PNG_SIMPLIFIED_' "$WORK/src/libpng/scripts/pnglibconf.h.prebuilt" > "$WORK/wasm/inc/pnglibconf.h"

CF=($OPT -w -ffile-prefix-map="$WORK=/build" -ffile-prefix-map="$ROOT=/src" -DHAVE_CONFIG_H -DNO_DEBUG
  -I"$ROOT/src" -I"$ROOT/src/shim" -I"$GEN" -I"$WORK/wasm/inc" -I"$SRC" -I"$KP"
  -I"$SRC/libmd5" -I"$SRC/pdftexdir" -I"$SRC/synctexdir" -I"$WORK/src/zlib" -I"$WORK/src/libpng")

case "$ENGINE" in
  pdftex) CF+=(-D__SyncTeX__ '-DSYNCTEX_ENGINE_H="synctex-pdftex.h"' -DPDF_PARSER_ONLY) ;;
  etex)   CF+=(-D__SyncTeX__ '-DSYNCTEX_ENGINE_H="synctex-etex.h"') ;;
esac

JOBS="$OBJ/jobs.txt"; : > "$JOBS"
declare -a objs=()
add() { # name src [extra cflags...]   (queue a compile job)
  local name="$1" src="$2"; shift 2
  local o="$OBJ/$name.o"; objs+=("$o")
  if [ -n "${FORCE:-}" ] || [ ! -f "$o" ] || [ "$src" -nt "$o" ] || [ -n "$(find "$ROOT/src" -newer "$o" -name '*.h' 2>/dev/null)" ]; then
    printf '%q ' emcc "${CF[@]}" "$@" -c "$src" -o "$o" >> "$JOBS"; echo >> "$JOBS"
  fi
}

if [ "$ENGINE" = tex ]; then
  for f in texini tex0 tex-pool; do add $f "$GEN/$f.c"; done
  add texextra "$SRC/texextra.c"
elif [ "$ENGINE" = etex ]; then
  for f in etexini etex0 etex-pool; do add $f "$GEN/$f.c"; done
  add etexextra "$SRC/etexdir/etexextra.c"
  add synctex "$SRC/synctexdir/synctex.c"
else
  # generated TeX engine
  for f in pdftexini pdftex0 pdftex-pool; do add $f "$GEN/$f.c"; done
  add pdftexextra "$SRC/pdftexdir/pdftexextra.c"
  for f in avl avlstuff epdf mapfile pkin subfont tounicode utils vfpacket writeenc writefont \
           writeimg writejbig2 writejpg writet1 writet3 writettf writezip; do
    add pdftexdir_$f "$SRC/pdftexdir/$f.c"
  done
  add pdftexdir_writepng "$SRC/pdftexdir/writepng.c" -include "$ROOT/src/shim/nosjlj.h"
  # libpng (+ zlib above): PNG inclusion
  for f in png pngerror pngget pngmem pngread pngrio pngrtran pngrutil pngset pngtrans pngwio pngwrite pngwtran pngwutil; do
    add libpng_$f "$WORK/src/libpng/$f.c" -UHAVE_CONFIG_H -DPNG_ARM_NEON_OPT=0 -DPNG_INTEL_SSE_OPT=0 -DPNG_MIPS_MSA_OPT=0 -DPNG_POWERPC_VSX_OPT=0 -DPNG_LOONGARCH_LSX_OPT=0
  done
  add synctex "$SRC/synctexdir/synctex.c"
  add md5 "$SRC/libmd5/md5.c"
  # zlib (straight from the Ubuntu orig tarball)
  for f in adler32 crc32 deflate infback inffast inflate inftrees trees zutil compress uncompr; do
    add zlib_$f "$WORK/src/zlib/$f.c" -DHAVE_UNISTD_H -DZ_HAVE_STDARG_H=1
  done
  for f in epdf_stub png_glue; do add $f "$ROOT/src/$f.c"; done
fi
for f in basechsuffix chartostring coredump eofeoln fprintreal input2int inputint openclose \
         printversion setupvar uexit usage version zround; do
  add lib_$f "$SRC/lib/$f.c"
done
# our own replacements: kpathsea, vfs, entry glue
for f in vfs mini_kpse entry; do add $f "$ROOT/src/$f.c"; done
add snap "$ROOT/src/snap.c" -msimd128      # SIMD chunk diff for snapshots

xargs -d '\n' -P "$(nproc)" -I{} bash -c '{}' < "$JOBS"

WRAPS=""
for s in png_create_read_struct fileno fopen fopen64 stat lstat stat64 lstat64 access remove unlink rename getcwd mkdir popen pclose system input_line; do
  WRAPS="$WRAPS -Wl,--wrap=$s"
done

emcc $OPT "${objs[@]}" -o "$OUT/$ENGINE.wasm" $WRAPS \
  --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=4194304 \
  -sEXPORTED_FUNCTIONS=_tex_run,_tex_args_ptr,_asyncify_data_ptr,_asyncify_data_reset,_sp_get,_sp_set,_heap_top,_snap_shadow_lo,_snap_shadow_hi,_snap_list_ptr,_snap_capacity,_snap_copy,_snap_diff,_vfs_count,_vfs_name,_vfs_data,_vfs_len,_vfs_find_index,_malloc,_free \
  -sASYNCIFY=1 -sASYNCIFY_IMPORTS=host_snapshot -sASYNCIFY_IGNORE_INDIRECT=1 \
  -sERROR_ON_UNDEFINED_SYMBOLS=1
mkdir -p "$WORK/web" && cp "$OUT/$ENGINE.wasm" "$WORK/web/$ENGINE.wasm"
ls -la "$WORK/web/$ENGINE.wasm"
