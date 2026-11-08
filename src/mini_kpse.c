/*
 * mini_kpse.c -- a tiny replacement for the parts of libkpathsea that pdfTeX uses.
 *
 * Real kpathsea parses texmf.cnf, walks ls-R databases, expands //-paths and may
 * spawn mktex* scripts.  None of that makes sense inside a wasm sandbox with a
 * flat, host-provided file index, so file lookup is delegated to the host
 * (host_search: basename within a per-format tree) and runtime parameters
 * (memory sizes...) come from a static table that mirrors texmf.cnf.
 */
#define KPSE_COMPAT_API 1
#include <w2c/config.h>
#include <kpathsea/kpathsea.h>
#include <kpathsea/types.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <errno.h>
#include "wasm_host.h"

kpathsea_instance kpse_def_inst;
kpathsea kpse_def = &kpse_def_inst;
const char *kpathsea_version_string = "kpathsea version 6.3.5";

int vfs_exists(const char *);
int vfs_is_dir(const char *);
int vfs_host_lookup(const char *);

/* ------------------------------------------------------------------ strings */
void *xmalloc(size_t n) { void *p = malloc(n ? n : 1); if (!p) { fprintf(stderr, "out of memory (%zu bytes)\n", n); abort(); } return p; }
void *xrealloc(void *o, size_t n) { void *p = realloc(o, n ? n : 1); if (!p) { fprintf(stderr, "out of memory (%zu bytes)\n", n); abort(); } return p; }
string xstrdup(const_string s) { string p = xmalloc(strlen(s) + 1); strcpy(p, s); return p; }
string concat(const_string a, const_string b) { size_t la = strlen(a); string p = xmalloc(la + strlen(b) + 1); strcpy(p, a); strcpy(p + la, b); return p; }
string concat3(const_string a, const_string b, const_string c) { string t = concat(a, b); string r = concat(t, c); free(t); return r; }

const_string xbasename(const_string name) { const_string p = strrchr(name, '/'); return p ? p + 1 : name; }
string xdirname(const_string name) {
  const_string p = strrchr(name, '/');
  if (!p) return xstrdup(".");
  if (p == name) return xstrdup("/");
  string d = xmalloc(p - name + 1); memcpy(d, name, p - name); d[p - name] = 0; return d;
}
const_string find_suffix(const_string name) {
  const_string b = xbasename(name), dot = strrchr(b, '.');
  return dot && dot != b ? dot + 1 : NULL;
}
boolean kpse_absolute_p(const_string f, boolean relative_ok) {
  return f[0] == '/' || (relative_ok && f[0] == '.' && (f[1] == '/' || (f[1] == '.' && f[2] == '/')));
}
string xgetcwd(void) { return xstrdup("/work"); }
boolean dir_p(string fn) { return vfs_is_dir(fn); }
void xputenv(const_string var, const_string value) { setenv(var, value, 1); }

string read_line(FILE *f) {
  size_t cap = 80, n = 0; string l = xmalloc(cap); int c;
  while ((c = getc(f)) != EOF && c != '\n' && c != '\r') { if (n + 2 >= cap) l = xrealloc(l, cap *= 2); l[n++] = c; }
  if (c == EOF && n == 0) { free(l); return NULL; }
  if (c == '\r') { int d = getc(f); if (d != '\n') ungetc(d, f); }
  l[n] = 0; return l;
}

/* ---------------------------------------------------------------- file ops */
FILE *xfopen(const_string name, const_string mode) {
  FILE *f = fopen(name, mode);
  if (!f) { fprintf(stderr, "fopen(%s, %s): %s\n", name, mode, strerror(errno)); exit(1); }
  return f;
}
void xfclose(FILE *f, const_string name) { if (fclose(f)) { fprintf(stderr, "fclose(%s) failed\n", name); exit(1); } }
void xfseek(FILE *f, long o, int w, const_string name) { if (fseek(f, o, w)) { fprintf(stderr, "fseek(%s) failed\n", name); exit(1); } }
void xfseeko(FILE *f, off_t o, int w, const_string name) { if (fseeko(f, o, w)) { fprintf(stderr, "fseeko(%s) failed\n", name); exit(1); } }
long xftell(FILE *f, const_string name) { long r = ftell(f); if (r < 0) { fprintf(stderr, "ftell(%s) failed\n", name); exit(1); } return r; }
off_t xftello(FILE *f, const_string name) { off_t r = ftello(f); if (r < 0) { fprintf(stderr, "ftello(%s) failed\n", name); exit(1); } return r; }

/* ----------------------------------------------------------------- program */
void kpse_set_program_name(const_string argv0, const_string progname) {
  const_string base = xbasename(argv0);
  kpse_def_inst.invocation_name = xstrdup(argv0);
  kpse_def_inst.invocation_short_name = xstrdup(base);
  kpse_def_inst.program_name = xstrdup(progname ? progname : base);
}
void kpse_reset_program_name(const_string progname) { kpse_def_inst.program_name = xstrdup(progname); }
void kpse_set_program_enabled(kpse_file_format_type f, boolean v, kpse_src_type l) { (void)f; (void)v; (void)l; }
void kpse_init_prog(const_string p, unsigned d, const_string m, const_string f) { (void)p; (void)d; (void)m; (void)f; }
void kpse_maketex_option(const_string f, boolean v) { (void)f; (void)v; }
void kpathsea_cnf_line_env_progname(kpathsea k, string l) { (void)k; (void)l; }
unsigned kpse_magstep_fix(unsigned dpi, unsigned bdpi, int *m) { (void)bdpi; if (m) *m = 0; return dpi; }
boolean kpse_bitmap_tolerance(double a, double b) { return a == b; }
string kpse_find_glyph(const_string n, unsigned d, kpse_file_format_type f, kpse_glyph_file_type *g) { (void)n; (void)d; (void)f; (void)g; return NULL; }
/* Port of kpathsea_name_ok(): openin_any / openout_any policy ('a'ny, 'r'estricted, 'p'aranoid). */
static boolean name_ok(const_string fname, const_string var, const_string dflt, const_string verb) {
  string v = kpse_var_value(var);
  const_string choice = v ? v : dflt;
  if (*choice == 'a' || *choice == 'y' || *choice == '1') return true;
  const_string q, qq = fname;
  while ((q = strchr(qq, '.'))) {                 /* .rhosts, .ssh/, ..x : dot files, but allow /./, /../ and .tex */
    if ((q == fname || q[-1] == '/') && q[1] != '/' && !(q[1] == '.' && q[2] == '/') && strcmp(q, ".tex")) goto not_ok;
    qq = q + 1;
  }
  if (*choice == 'r' || *choice == 'n' || *choice == '0') return true;
  if (kpse_absolute_p(fname, false)) {            /* absolute: only below $TEXMFOUTPUT */
    string t = kpse_var_value("TEXMFOUTPUT");
    if (!t || !*t || fname != strstr(fname, t) || fname[strlen(t)] != '/') goto not_ok;
  }
  if (fname[0] == '.' && fname[1] == '.' && fname[2] == '/') goto not_ok;
  for (const_string dp = strstr(fname, ".."); dp; dp = strstr(dp + 2, ".."))
    if (dp[2] == '/' && dp[-1] == '/') goto not_ok;
  return true;
not_ok:
  fprintf(stderr, "\n%s: Not %s %s (%s = %s).\n", kpse_def_inst.invocation_name, verb, fname, var, choice);
  return false;
}
boolean kpse_in_name_ok(const_string f) { return name_ok(f, "openin_any", "a", "reading from"); }
boolean kpse_out_name_ok(const_string f) { return name_ok(f, "openout_any", "p", "writing to"); }
string kpse_readable_file(string f) { return (vfs_exists(f) && !vfs_is_dir(f)) ? f : NULL; }

/* --------------------------------------------------------------- variables */
static const struct { const char *name, *value; } params[] = {
  /* mirrors texmf.cnf, trimmed so that a snapshot of linear memory stays small */
  {"main_memory", "2000000"}, {"extra_mem_top", "0"}, {"extra_mem_bot", "0"},
  {"font_mem_size", "800000"}, {"font_max", "2000"}, {"hash_extra", "100000"},
  {"pool_size", "3200000"}, {"string_vacancies", "90000"}, {"max_strings", "200000"},
  {"pool_free", "47500"}, {"strings_free", "100"}, {"buf_size", "200000"},
  {"trie_size", "1000000"}, {"hyph_size", "8191"}, {"nest_size", "500"},
  {"max_in_open", "15"}, {"param_size", "10000"}, {"save_size", "100000"},
  {"stack_size", "10000"}, {"dvi_buf_size", "16384"}, {"error_line", "79"},
  {"half_error_line", "50"}, {"max_print_line", "79"}, {"expand_depth", "10000"},
  {"pdf_mem_size", "10000"}, {"obj_tab_size", "256000"}, {"dest_names_size", "131072"},
  {"shell_escape", "f"}, {"parse_first_line", "f"}, {"file_line_error_style", "f"},
  {"openout_any", "p"}, {"openin_any", "a"},
  {0, 0}};

string kpse_var_value(const_string var) {
  const char *e = getenv(var);
  if (e && *e) return xstrdup(e);
  if (getenv("MINIKPSE_STRICT")) return NULL;      /* only the environment: compile-time defaults (trip test) */
  for (int i = 0; params[i].name; i++) if (!strcmp(params[i].name, var)) return xstrdup(params[i].value);
  return NULL;
}

/* -------------------------------------------------------------- file search */
static const struct fmt { kpse_file_format_type f; const char *tag; const char *suf; } fmts[] = {
  {kpse_tex_format, "tex", ".tex:.sty:.cls:.fd:.aux:.bbl:.def:.clo:.ldf:.cfg:.ltx:.code.tex:.pdf_tex"},
  {kpse_tfm_format, "tfm", ".tfm"}, {kpse_ofm_format, "ofm", ".ofm"}, {kpse_vf_format, "vf", ".vf"},
  {kpse_type1_format, "type1", ".pfb"}, {kpse_truetype_format, "truetype", ".ttf:.ttc"},
  {kpse_opentype_format, "opentype", ".otf"}, {kpse_enc_format, "enc", ".enc"},
  {kpse_fontmap_format, "map", ".map"}, {kpse_fmt_format, "fmt", ".fmt"},
  {kpse_texpool_format, "pool", ".pool"}, {kpse_web2c_format, "web2c", ""},
  {kpse_pdftex_config_format, "pdftex", ""}, {kpse_tex_ps_header_format, "header", ".pro"},
  {kpse_miscfonts_format, "misc", ""}, {kpse_program_text_format, "tex", ""},
  {kpse_sfd_format, "sfd", ".sfd"}, {kpse_cmap_format, "cmap", ""},
  {kpse_mlbib_format, "tex", ""}, {kpse_pict_format, "tex", ".eps:.pdf:.png:.jpg:.jpeg"},
  {kpse_pk_format, "pk", ".pk"}, {kpse_afm_format, "afm", ".afm"}, {kpse_lig_format, "lig", ".lig"},
  {kpse_last_format, 0, 0}};

static const struct fmt *fmt_of(kpse_file_format_type f) {
  for (int i = 0; fmts[i].tag; i++) if (fmts[i].f == f) return &fmts[i];
  return NULL;
}

static int has_suffix(const char *name, const char *sufs) {
  size_t n = strlen(name);
  while (*sufs) {
    const char *e = strchr(sufs, ':'); size_t l = e ? (size_t)(e - sufs) : strlen(sufs);
    if (l && n > l && !strncmp(name + n - l, sufs, l)) return 1;
    if (!e) break; sufs = e + 1;
  }
  return 0;
}

static string try_one(const char *name, const char *tag) {
  char out[1024];
  /* absolute or explicitly relative (./x, ../x): kpathsea never searches, it only checks */
  if (name[0] == '/' || (name[0] == '.' && (name[1] == '/' || (name[1] == '.' && name[2] == '/'))))
    return vfs_exists(name) && !vfs_is_dir(name) ? xstrdup(name) : NULL;
  /* the current directory comes first in TEXINPUTS and kpathsea reports such hits as ./name */
  if (vfs_exists(name) && !vfs_is_dir(name)) return concat("./", name);
  /* then the TeX tree; names with directory parts (latex/base/article.cls) match by path suffix, like // paths */
  int id = host_search(name, tag, out, sizeof out);
  return id >= 0 ? xstrdup(out) : NULL;
}

string kpse_find_file(const_string name, kpse_file_format_type format, boolean must_exist) {
  (void)must_exist;
  const struct fmt *fm = fmt_of(format);
  const char *tag = fm ? fm->tag : "misc";
  char tagbuf[96];
  if (format == kpse_tex_format) {            /* TEXINPUTS.<program> differs per program: tex@pdflatex, tex@pdftex ... */
    snprintf(tagbuf, sizeof tagbuf, "tex@%s", kpse_def_inst.program_name ? kpse_def_inst.program_name : "");
    tag = tagbuf;
  }
  const char *suf = fm ? fm->suf : "";
  string r = NULL;
  while (name[0] == '.' && name[1] == '/') name += 2;
  if (!*suf || has_suffix(name, suf)) return try_one(name, tag);
  /* kpathsea tries NAME + first suffix before plain NAME */
  const char *e = strchr(suf, ':'); size_t l = e ? (size_t)(e - suf) : strlen(suf);
  char *cand = xmalloc(strlen(name) + l + 1);
  strcpy(cand, name); memcpy(cand + strlen(name), suf, l); cand[strlen(name) + l] = 0;
  r = try_one(cand, tag); free(cand);
  return r ? r : try_one(name, tag);
}

string *kpse_find_file_generic(const_string name, kpse_file_format_type format, boolean must_exist, boolean all) {
  (void)all;
  string r = kpse_find_file(name, format, must_exist);
  if (!r) return NULL;
  string *l = xmalloc(2 * sizeof *l); l[0] = r; l[1] = NULL; return l;
}
