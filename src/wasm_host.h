/* Host (JavaScript) imports of pdftex.wasm.  Module name: "env". */
#ifndef WASM_HOST_H
#define WASM_HOST_H
#define HOST_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

/* exact path -> host file id (>=0) or -1.  Paths are cwd-relative or absolute. */
HOST_IMPORT(host_lookup)  int host_lookup(const char *path);
HOST_IMPORT(host_isdir)   int host_isdir(const char *path);
HOST_IMPORT(host_size)    int host_size(int id);
/* modification time (seconds since the epoch) of a host file */
HOST_IMPORT(host_mtime)   unsigned host_mtime(int id);
/* 1 if the file belongs to the user project (inputs that may change between runs) */
HOST_IMPORT(host_is_user) int host_is_user(int id);
/* pread(): returns number of bytes copied into dst (0 at EOF).  For user files the
   host returns at most one text line per call so the "bytes consumed" fence is tight. */
HOST_IMPORT(host_read)    int host_read(int id, unsigned off, void *dst, int len);
/* basename search restricted to a file-format tree ("tex","tfm",...);
   writes the path to out and returns the file id, or -1. */
HOST_IMPORT(host_search)  int host_search(const char *name, const char *fmt, char *out, int cap);
/* cheap, synchronous: should the engine take a snapshot now? */
HOST_IMPORT(host_want_snapshot) int host_want_snapshot(int hid_plus_1);
/* ASYNCIFY import: unwinds the wasm stack so the host can snapshot linear memory. */
HOST_IMPORT(host_snapshot) int host_snapshot(void);
#endif
