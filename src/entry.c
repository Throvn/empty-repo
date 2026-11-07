/*
 * entry.c -- reactor-style entry points for pdftex.wasm and the asyncify hook.
 *
 * JS calls   tex_args_ptr()  -> writes NUL-separated argv there,  tex_run(argc)
 * The engine runs main() -> mainbody() -> ... exactly as the native binary does.
 *
 * Incremental compilation (see web/engine.js): while TeX reads a line of a *user*
 * file, __wrap_input_line() may call host_snapshot().  That import is an asyncify
 * import: the whole wasm call stack is unwound into asyncify_stack[] (linear
 * memory!), JS copies linear memory, then immediately rewinds and execution
 * continues.  Restoring such a copy later and "rewinding" resumes the process at
 * exactly that point.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "wasm_host.h"

#define EXPORT __attribute__((used, visibility("default")))

extern int main(int, char **);
extern int vfs_file_is_user(FILE *);

static char args_buf[16384];
static char *argv_[256];

EXPORT char *tex_args_ptr(void) { return args_buf; }

EXPORT int tex_run(int argc) {
  char *p = args_buf;
  for (int i = 0; i < argc && i < 255; i++) { argv_[i] = p; p += strlen(p) + 1; }
  argv_[argc] = NULL;
  return main(argc, argv_);
}

/* ---- asyncify bookkeeping: {cur,end} header followed by the saved-stack area ---- */
#define ASYNCIFY_STACK_BYTES (1 << 20)
static struct { char *cur, *end; char area[ASYNCIFY_STACK_BYTES]; } adata;
EXPORT void *asyncify_data_ptr(void) { return &adata; }
EXPORT void asyncify_data_reset(void) { adata.cur = adata.area; adata.end = adata.area + ASYNCIFY_STACK_BYTES; }

/* Raw access to the C stack pointer global, needed to restore a snapshot. */
extern void *emscripten_stack_get_current(void);
extern void _emscripten_stack_restore(void *);
EXPORT void *sp_get(void) { return emscripten_stack_get_current(); }
EXPORT void sp_set(void *p) { _emscripten_stack_restore(p); }

/* Top of the heap: everything the process can have touched lives in [0, heap_top()). */
EXPORT unsigned heap_top(void) { return (unsigned)(size_t)sbrk(0); }

/* ---- snapshot hook: wraps texmfmp.c:input_line (linker --wrap=input_line) ---- */
extern int __real_input_line(FILE *f);
int __wrap_input_line(FILE *f) {
  int u = vfs_file_is_user(f);
  if (u && host_want_snapshot(u)) host_snapshot();
  return __real_input_line(f);
}
