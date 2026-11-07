/* PNG inclusion needs libpng (setjmp-based error handling); left out of the wasm build.
   Plain JPEG inclusion works (pdfTeX copies the DCT stream verbatim, no decoder needed). */
extern void pdftex_fail(const char *fmt, ...);
void read_png_info(int img) { (void)img; pdftex_fail("PNG inclusion is not supported in the wasm build"); }
void write_png(int img) { (void)img; pdftex_fail("PNG inclusion is not supported in the wasm build"); }
