/*
 * vfs.c -- an in-memory virtual file system for the pdfTeX wasm build.
 *
 * Design goals
 * ------------
 *  1. EVERYTHING the engine can observe lives in wasm linear memory.  The only
 *     state outside linear memory is the (immutable-per-run) *input* file
 *     contents, which are fetched through host imports with pread()-like
 *     semantics.  Hence "swap the linear memory" == "snapshot the process"
 *     (this is what makes TeXpresso-style incremental compilation possible).
 *  2. No emscripten FS, no WASI path_open: fopen() & friends are redirected
 *     (via the linker's --wrap) to FILE* objects built with fopencookie(); the
 *     musl FILE buffers/positions therefore also live in linear memory.
 *
 * Files the engine WRITES (log, aux, pdf, fmt ...) are growable malloc'd
 * buffers ("memfiles").  Files the engine READS are looked up first among the
 * memfiles (so aux/toc round trips work) and then on the host.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <stdint.h>

#include <zlib.h>
#include <stdarg.h>
#include "wasm_host.h"

/* ------------------------------------------------------------------ memfiles */
typedef struct memfile {
  char *name;
  unsigned char *data;
  size_t len, cap;
  struct memfile *next;
} memfile;

static memfile *memfiles;

static const char *norm(const char *p) {
  while (p[0] == '.' && p[1] == '/') { p += 2; while (*p == '/') p++; }
  return p;
}

static memfile *mf_find(const char *name) {
  name = norm(name);
  for (memfile *m = memfiles; m; m = m->next)
    if (!strcmp(m->name, name)) return m;
  return NULL;
}

static memfile *mf_create(const char *name, int truncate) {
  memfile *m = mf_find(name);
  if (m) { if (truncate) m->len = 0; return m; }
  m = calloc(1, sizeof *m);
  m->name = strdup(norm(name));
  m->next = memfiles;
  memfiles = m;
  return m;
}

static int mf_reserve(memfile *m, size_t need) {
  if (need <= m->cap) return 0;
  size_t cap = m->cap ? m->cap : 4096;
  while (cap < need) cap *= 2;
  unsigned char *d = realloc(m->data, cap);
  if (!d) return -1;
  m->data = d; m->cap = cap;
  return 0;
}

/* ------------------------------------------------------------------- handles */
typedef struct vh {
  memfile *mf;        /* non-NULL: memfile backed */
  int hid;            /* host file id when mf == NULL */
  int user;           /* host file belongs to the user project (incrementality fence) */
  size_t pos;
  int canwrite;
  int fd;             /* pseudo descriptor handed out by fileno() */
  FILE *fp;
  struct vh *next;
} vh;

static vh *handles;

static ssize_t c_read(void *ck, char *buf, size_t n) {
  vh *h = ck;
  if (h->mf) {
    if (h->pos >= h->mf->len) return 0;
    size_t k = h->mf->len - h->pos; if (k > n) k = n;
    memcpy(buf, h->mf->data + h->pos, k);
    h->pos += k;
    return k;
  }
  int k = host_read(h->hid, (unsigned)h->pos, buf, (int)n);
  if (k < 0) return -1;
  h->pos += k;
  return k;
}

static ssize_t c_write(void *ck, const char *buf, size_t n) {
  vh *h = ck;
  if (!h->mf) { errno = EBADF; return -1; }
  if (mf_reserve(h->mf, h->pos + n)) { errno = ENOMEM; return -1; }
  if (h->pos > h->mf->len) memset(h->mf->data + h->mf->len, 0, h->pos - h->mf->len);
  memcpy(h->mf->data + h->pos, buf, n);
  h->pos += n;
  if (h->pos > h->mf->len) h->mf->len = h->pos;
  return n;
}

static int c_seek(void *ck, off_t *off, int whence) {
  vh *h = ck;
  long long base = 0, size = h->mf ? (long long)h->mf->len : (long long)host_size(h->hid);
  if (whence == SEEK_CUR) base = h->pos; else if (whence == SEEK_END) base = size;
  long long np = base + *off;
  if (np < 0) { errno = EINVAL; return -1; }
  h->pos = (size_t)np; *off = np;
  return 0;
}

static int c_close(void *ck) {
  vh *h = ck;
  for (vh **pp = &handles; *pp; pp = &(*pp)->next)
    if (*pp == h) { *pp = h->next; break; }
  free(h);
  return 0;
}

static const cookie_io_functions_t cio = { c_read, c_write, c_seek, c_close };

FILE *__real_fopen(const char *, const char *);

FILE *__wrap_fopen(const char *path, const char *mode) {
  int wr = (mode[0] == 'w' || mode[0] == 'a' || strchr(mode, '+'));
  vh *h = calloc(1, sizeof *h);
  if (!h) return NULL;
  if (mode[0] == 'w') {
    h->mf = mf_create(path, 1);
    h->canwrite = 1;
  } else if (mode[0] == 'a' || (mode[0] == 'r' && wr)) {
    memfile *m = mf_find(path);
    if (!m && mode[0] == 'a') m = mf_create(path, 0);
    if (!m && mode[0] == 'r') {            /* r+ on a host file: copy it into a memfile */
      int id = host_lookup(norm(path));
      if (id >= 0) {
        m = mf_create(path, 1);
        int sz = host_size(id);
        if (mf_reserve(m, sz)) { free(h); errno = ENOMEM; return NULL; }
        m->len = host_read(id, 0, m->data, sz);
      }
    }
    if (!m) { free(h); errno = ENOENT; return NULL; }
    h->mf = m; h->canwrite = 1;
    if (mode[0] == 'a') h->pos = m->len;
  } else {
    memfile *m = mf_find(path);
    if (m) h->mf = m;
    else {
      int id = host_lookup(norm(path));
      if (id < 0) { free(h); errno = ENOENT; return NULL; }
      h->hid = id;
      h->user = host_is_user(id);
    }
  }
  h->fp = fopencookie(h, mode, cio);
  if (!h->fp) { free(h); return NULL; }
  static int next_fd = 100;
  h->fd = next_fd++;
  h->next = handles; handles = h;
  return h->fp;
}

FILE *__wrap_fopen64(const char *p, const char *m) { return __wrap_fopen(p, m); }

/* ------------------------------------------------------------ stat & friends */
static int fill_stat(struct stat *st, int isdir, size_t size) {
  memset(st, 0, sizeof *st);
  st->st_mode = isdir ? (S_IFDIR | 0755) : (S_IFREG | 0644);
  st->st_size = size;
  st->st_nlink = 1;
  st->st_blksize = 4096;
  return 0;
}

int vfs_is_dir(const char *path) {
  path = norm(path);
  if (!*path || !strcmp(path, ".") || !strcmp(path, "/")) return 1;
  size_t n = strlen(path);
  if (path[n - 1] == '/') return 1;
  return host_isdir(path);
}

int vfs_exists(const char *path) {
  return mf_find(path) != NULL || host_lookup(norm(path)) >= 0;
}

int __wrap_stat(const char *path, struct stat *st) {
  memfile *m = mf_find(path);
  if (m) return fill_stat(st, 0, m->len);
  int id = host_lookup(norm(path));
  if (id >= 0) return fill_stat(st, 0, host_size(id));
  if (vfs_is_dir(path)) return fill_stat(st, 1, 0);
  errno = ENOENT; return -1;
}
int __wrap_lstat(const char *p, struct stat *st) { return __wrap_stat(p, st); }
int __wrap_stat64(const char *p, struct stat *st) { return __wrap_stat(p, st); }
int __wrap_lstat64(const char *p, struct stat *st) { return __wrap_stat(p, st); }

int __wrap_access(const char *path, int mode) {
  (void)mode;
  if (vfs_exists(path) || vfs_is_dir(path)) return 0;
  errno = ENOENT; return -1;
}

int __wrap_remove(const char *path) {
  memfile **pp = &memfiles;
  path = norm(path);
  for (; *pp; pp = &(*pp)->next)
    if (!strcmp((*pp)->name, path)) {
      memfile *m = *pp; *pp = m->next;
      /* NB: an open handle may still reference m; leak it rather than dangle */
      m->name[0] = 0; m->len = 0;
      m->next = NULL;
      return 0;
    }
  errno = ENOENT; return -1;
}
int __wrap_unlink(const char *p) { return __wrap_remove(p); }

int __wrap_rename(const char *from, const char *to) {
  memfile *m = mf_find(from);
  if (!m) { errno = ENOENT; return -1; }
  memfile *old = mf_find(to);
  if (old && old != m) __wrap_remove(to);
  free(m->name); m->name = strdup(norm(to));
  return 0;
}

char *__wrap_getcwd(char *buf, size_t size) {
  if (!buf) buf = malloc(8);
  if (size && size < 6) { errno = ERANGE; return NULL; }
  strcpy(buf, "/work");
  return buf;
}

int __wrap_mkdir(const char *p, mode_t m) { (void)p; (void)m; return 0; }

/* No processes. */
FILE *__wrap_popen(const char *c, const char *m) { (void)c; (void)m; errno = ENOSYS; return NULL; }
int __wrap_pclose(FILE *f) { (void)f; return -1; }
int __wrap_system(const char *c) { (void)c; errno = ENOSYS; return -1; }

/* -------------------------------------------------------------- host access */
/* Used by mini_kpse. */
int vfs_host_lookup(const char *path) { return host_lookup(norm(path)); }

/* ----------------------------------------------------- exports for the host */
#define EXPORT __attribute__((used, visibility("default")))

EXPORT int vfs_count(void) { int n = 0; for (memfile *m = memfiles; m; m = m->next) n++; return n; }
static memfile *nth(int i) { memfile *m = memfiles; while (m && i--) m = m->next; return m; }
EXPORT const char *vfs_name(int i) { memfile *m = nth(i); return m ? m->name : NULL; }
EXPORT const void *vfs_data(int i) { memfile *m = nth(i); return m ? m->data : NULL; }
EXPORT size_t vfs_len(int i) { memfile *m = nth(i); return m ? m->len : 0; }
EXPORT int vfs_find_index(const char *name) {
  int i = 0; name = norm(name);
  for (memfile *m = memfiles; m; m = m->next, i++) if (!strcmp(m->name, name)) return i;
  return -1;
}

/* Called by __wrap_input_line: is FILE* a user-project file? */
int vfs_file_is_user(FILE *f) {
  for (vh *h = handles; h; h = h->next)
    if (h->fp == f) return h->mf == NULL && h->user ? h->hid + 1 : 0;
  return 0;
}

/* ---------------------------------------------------------------------------
 * fileno() / gz* shims.  pdfTeX opens its format file with gzdopen(fileno(f)).
 * Inside wasm the format lives in RAM, so compression is pointless (and slower);
 * gz* simply forward to the underlying virtual FILE.  .synctex.gz is unsupported.
 */
int __real_fileno(FILE *);
int __wrap_fileno(FILE *f) {
  for (vh *h = handles; h; h = h->next) if (h->fp == f) return h->fd;
  return __real_fileno(f);
}
struct vgz { FILE *f; };
#define VGZ(g) ((struct vgz *)(g))
gzFile gzdopen(int fd, const char *mode) {
  (void)mode;
  for (vh *h = handles; h; h = h->next)
    if (h->fd == fd) { struct vgz *g = malloc(sizeof *g); g->f = h->fp; return (gzFile)g; }
  return NULL;
}
gzFile gzopen(const char *path, const char *mode) { (void)path; (void)mode; return NULL; }
int gzread(gzFile g, voidp buf, unsigned len) { return (int)fread(buf, 1, len, VGZ(g)->f); }
int gzwrite(gzFile g, voidpc buf, unsigned len) { return (int)fwrite(buf, 1, len, VGZ(g)->f); }
int gzsetparams(gzFile g, int level, int strategy) { (void)g; (void)level; (void)strategy; return Z_OK; }
int gzprintf(gzFile g, const char *fmt, ...) { (void)g; (void)fmt; return 0; }
int gzclose(gzFile g) { int r = fclose(VGZ(g)->f); free(g); return r ? Z_ERRNO : Z_OK; }
