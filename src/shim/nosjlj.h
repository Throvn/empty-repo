/* Force-included when compiling pdfTeX's writepng.c: libpng is built WITHOUT setjmp/longjmp support
   (longjmp needs JS glue or wasm exception handling, which does not combine with asyncify).
   Instead png_glue.c installs libpng error callbacks that call pdftex_fail(), which never returns, so
   the `if (setjmp(png_jmpbuf(...))) ...` error branches in writepng.c are simply dead code. */
#include <setjmp.h>
#undef setjmp
#define setjmp(env) 0
#define png_jmpbuf(png_ptr) 0
