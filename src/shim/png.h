/* Shim: libpng is not linked into the wasm build.  pdfTeX's image.h / writeimg.c /
   utils.c only need the type names, a version string and a few calls that can never
   be reached (read_png_info() in png_stub.c aborts first). */
#ifndef SHIM_PNG_H
#define SHIM_PNG_H
typedef void *png_structp, *png_infop;
#define PNG_LIBPNG_VER_STRING "none"
static const char png_libpng_ver[] = "none";
static inline int png_get_bit_depth(png_structp p, png_infop i) { (void)p; (void)i; return 0; }
static inline void *png_get_io_ptr(png_structp p) { (void)p; return 0; }
static inline void png_destroy_read_struct(png_structp *p, png_infop *i, png_infop *e) { (void)p; (void)i; (void)e; }
#endif
