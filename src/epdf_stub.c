/* PDF inclusion (xpdf) is deliberately not part of this build: the C++ xpdf library is
   by far the largest/most complicated dependency of pdfTeX.  These stubs make
   \includegraphics{x.pdf} fail with a clear pdfTeX error instead. */
#include <stdio.h>
#include <stdlib.h>
/* (the epdf_* state variables are defined by writeimg.c; only pdftoepdf.cc's functions are stubbed) */
void epdf_check_mem(void) {}
void epdf_delete(void) {}
int read_pdf_info(char *image_name, char *page_name, int page_num, int pagebox, int minor_pdf_version_wanted, int pdf_inclusion_errorlevel, int pdf_suppress_page_group_warning) {
  (void)page_name; (void)page_num; (void)pagebox; (void)minor_pdf_version_wanted; (void)pdf_inclusion_errorlevel; (void)pdf_suppress_page_group_warning;
  fprintf(stderr, "\nerror: PDF inclusion (%s) is not supported in the wasm build\n", image_name);
  exit(1);
}
void write_epdf(void) {}
