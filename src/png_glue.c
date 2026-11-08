/* libpng error handling without longjmp: every libpng error is fatal in pdfTeX anyway. */
#include <png.h>
#include <stdarg.h>
#include <stdio.h>

extern void pdftex_fail(const char *fmt, ...);
extern void pdftex_warn(const char *fmt, ...);

/* same wording as upstream's setjmp branch in writepng.c; libpng's own detail goes to the console */
static void png_err(png_structp p, png_const_charp msg) { (void)p; fprintf(stderr, "libpng error: %s\n", msg); pdftex_fail("libpng: internal error"); }
static void png_wrn(png_structp p, png_const_charp msg) { (void)p; pdftex_warn("libpng warning: %s", msg); }

/* linker --wrap=png_create_read_struct: writepng.c passes NULL handlers */
png_structp __real_png_create_read_struct(png_const_charp, png_voidp, png_error_ptr, png_error_ptr);
png_structp __wrap_png_create_read_struct(png_const_charp ver, png_voidp ep, png_error_ptr ef, png_error_ptr wf) {
  (void)ef; (void)wf;
  return __real_png_create_read_struct(ver, ep, png_err, png_wrn);
}
