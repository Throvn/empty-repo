# pdfTeX in WebAssembly — with TeXpresso-style incremental compilation

A reproducible pipeline that turns **pdfTeX 1.40.25 (TeX Live 2023)** into **one `pdftex.wasm` file**
(1.2 MB, 390 KB gzipped), plus a browser front end: a text area, a *Compile* button, a PDF preview —
and an incremental mode in which editing a long document recompiles only what changed, by swapping the
engine's **linear memory** back to a snapshot (the [TeXpresso](https://github.com/let-def/texpresso)
idea, done with `asyncify` instead of `fork()`).

```
make          # toolchain → sources → native codegen → wasm → TeX tree → format → build/web
make serve    # http://localhost:8000   (any static file server works)
make test     # incremental == from-scratch, byte for byte; error recovery
```

**Prerequisites** (Debian/Ubuntu): `build-essential g++ curl python3 zlib1g-dev libpng-dev` (host libs for the throw-away native web2c build) and outbound HTTPS to
`archive.ubuntu.com`, `conda.anaconda.org` and `registry.npmjs.org`. Everything else (Emscripten, node, Binaryen) is installed into `build/`.
A full from-scratch build takes ≈ 6 minutes (3½ of them the native TeX Live configure/make).

`build/web/index.html` is the whole application (`index.html`, `worker.js`, `engine.js`, `viewer.js`,
`pdftex.wasm`, `texlive.data`, `pdflatex.fmt`, pdf.js for the preview).

## Numbers (4-core x86 VM, node 22; in headless Chromium the 43-page document cold-compiles in ≈ 0.6 s and an edit near the end takes 50–85 ms)

| document | cold compile (1 pass) | edit near the end | edit in the middle |
|---|---|---|---|
| 43 pages, 970 lines | 0.4 s | **40–65 ms** | 110 ms |
| 277 pages, 6400 lines | 0.75 s | **77 ms** | 250–450 ms |

* An edit that does not change cross-references costs one resumed pass; an edit that changes `.aux`
  (a heading, a label) triggers the usual LaTeX second pass, which re-reads `.aux` at `\begin{document}`
  and therefore re-typesets everything — the UI shows the first pass immediately and then refines in the background.
* Engine speed: plain wasm build ≈ native `pdftex` (542 ms vs 531 ms on the 277-page document);
  asyncify instrumentation costs ≈ +30 % run time and +22 % binary size (703 ms), taking snapshots
  ≈ 6 ms each (every ≥ 40 ms of work, at most ~1/5 of the run time).

## Repository layout

| path | what |
|---|---|
| `scripts/00-toolchain.sh` | Emscripten 4.0.9 (conda-forge, bootstrapped via micromamba) + Binaryen 123 (npm) |
| `scripts/10-fetch-sources.sh` | pinned, SHA-checked tarballs from archive.ubuntu.com: `texlive-bin` 2023.20230311, zlib, libpng |
| `scripts/20-native-gen.sh` | builds pdfTeX natively **only** to run web2c (`tangle → web2c → C`) and harvest the generated C |
| `scripts/30-build-wasm.sh` | `emcc`: generated C + `src/*.c` → `build/web/pdftex.wasm` |
| `scripts/40-texlive-files.sh` | assembles the runtime TeX tree from pinned Ubuntu `.deb`s, generates `pdftex.map`/`language.dat`, packs it with **emscripten's `file_packager`** |
| `scripts/60-build-fmt.mjs` | runs `pdftex.wasm` itself in `-ini` mode to dump `pdflatex.fmt` |
| `scripts/70-package-web.sh` | assembles the static site (+ pdf.js, `.gz` copies) |
| `src/` | the C that replaces libraries and glues the engine to the host (below) |
| `web/` | `engine.js` (host + incremental logic), `worker.js`, `index.html`, `viewer.js` |
| `tests/` | `incremental.mjs`, `errors.mjs`, `bench.mjs`, sample documents |

Everything lands in `build/`; the only inputs are the pinned URLs/checksums in `scripts/`. A from-scratch `make` in a fresh clone
was verified to work (5½ min), to produce a byte-identical `texlive.data`, and (with `-ffile-prefix-map`) a byte-identical `pdftex.wasm`
in two different checkout directories.

## How the port works

### One binary, almost no imports

`pdftex.wasm` is a `STANDALONE_WASM` reactor (no Emscripten JS runtime, no `FILESYSTEM`, no
side modules). Its imports are the eight `host_*` functions in `src/wasm_host.h`, eight WASI calls
(`fd_write`, `fd_read`, `fd_seek`, `fd_close`, `clock_time_get`, `environ_*`, `proc_exit`), one memory-growth
notification and two dead socket stubs (pdfTeX's IPC code, never reached).
Memory sizes (`main_memory` …) are a compiled-in table in `mini_kpse.c`, mirrored from `texmf.cnf`
and trimmed so that a memory snapshot stays small; the format is dumped with the same table.

### Libraries that were replaced instead of ported

| upstream | here | why |
|---|---|---|
| **kpathsea** (cnf parsing, ls-R, `//` expansion, `mktex*`) | `src/mini_kpse.c`, 175 lines | pdfTeX uses ~35 kpathsea entry points. A flat host index + per-format tree filter does the same job in a sandbox. Real kpathsea's headers are still used so the generated code links unchanged. |
| **Emscripten FS / WASI path_open** | `src/vfs.c` | all file state must live in linear memory (see below). `fopen` & co. are redirected with `--wrap` to `fopencookie()` streams over in-memory "memfiles" (files TeX writes) or host files (files TeX reads). |
| **xpdf** (C++, `\includegraphics{x.pdf}`) | `src/epdf_stub.c` | biggest and most awkward dependency; PDF inclusion reports a clear pdfTeX error instead. |
| **libpng** (`setjmp` error handling) | `src/png_stub.c` | `setjmp`/`longjmp` needs JS glue (or wasm EH, which does not combine with asyncify). JPEG inclusion works (pdfTeX copies the DCT stream, no decoder). |
| `gzdopen` on the format file | `gz*` shims in `vfs.c` | the format lives in RAM; compression only costs time. |
| zlib | compiled from the Ubuntu tarball | tiny, no port download needed |

Not replaced because they are small and self-contained: pdfTeX's own writers (Type 1/TrueType/JBIG2/JPEG),
libmd5, SyncTeX (compiled in, unused unless asked).

### Supporting files

TeX macros, TFMs, Type 1 fonts and maps (CM/AMS, Latin Modern, URW35 Times/Helvetica/Courier/Palatino…, 5 500 files, 45 MB →
20 MB gzipped) come from pinned Ubuntu packages and are packed with `file_packager`
(`texlive.data` + a JSON index). Things Debian generates in maintainer scripts are generated by
`scripts/40-…` / `tools/mkmap.py` (e.g. `pdftex.map` with the Adobe-name → URW-Nimbus aliases so Times
gets *embedded*). The JS host serves slices of that blob through `host_read`; nothing is copied into
an emulated FS.

## Incremental compilation: TeXpresso on wasm

TeXpresso keeps a forked, suspended TeX process at interesting points and records which *bytes of which files*
each process has read. When you edit, it resumes the newest process that had not yet read the first changed byte.
The same four ingredients, wasm style:

| TeXpresso | here |
|---|---|
| `fork()` a suspended process | **snapshot = copy of linear memory + saved wasm call stack** |
| process state | *all* of it is in linear memory: heap, C stack, stdio buffers, **and the virtual filesystem** (`vfs.c`); the only external state is the immutable-per-run input files |
| trace of file reads | every `host_read` of a user file and every lookup that may resolve to one is logged (`trace[]`); reads are handed out **one line at a time** so "bytes consumed" is exact |
| roll back to before the first changed byte | `_plan()`: diff old/new user files → first differing offset → earliest trace event that observed it → newest snapshot taken before that event |

**Taking a snapshot (asyncify).** `__wrap_input_line` (the linker wraps `input_line`) asks
`host_want_snapshot()` before reading a line of a *user* file. If yes it calls `host_snapshot()`, an
asyncify import: Binaryen's pass unwinds the whole wasm call stack — `main → mainbody → main_control →
expand → … → input_line` — into `asyncify_data` (a static buffer, i.e. *linear memory*). JS then
copies linear memory, records the stack pointer global, `asyncify_start_rewind()`s and re-enters; the engine
carries on as if nothing happened.

**Resuming.** Copy the snapshot's memory back, set the stack-pointer global, `asyncify_start_rewind()`,
call `tex_run()` again: every instrumented function restores its locals from the saved stack and TeX
continues *inside `host_snapshot()` of the original run* — typically in the middle of a paragraph of the
changed file — which now returns and reads the *new* bytes.

**Cheap snapshots.** Memory `[0, sbrk)` (≈ 33 MB, mostly the 17 MB format) is cut in 4 KiB chunks; a
snapshot is a table of shared, immutable chunks. Which chunks changed is found inside the module
(`src/snap.c`, SIMD compare against a shadow image of the previous snapshot kept in a reserved region
of the same memory — a few ms per snapshot in total; a JS scan is the fallback). Typical delta: 250–500 chunks ≈ 1–2 MB.

**Other rules that make rollbacks exact**
* `find` events (`\input` probing `foo.tex`, `main.aux`…) invalidate when the file appears/disappears.
* Cross-reference files the engine writes (`.aux .toc .out …`) are *carried* into the next run as ordinary
  tracked inputs, so LaTeX's multi-pass convergence works: pass 1 writes `.aux`; pass 2 resumes at the
  snapshot before the first `.aux` read; the loop stops when the files stop changing (≤ 3 passes).
* No byte of any tracked file changed ⇒ no run at all (cached PDF, 2 ms).
* JS-side bookkeeping (trace length, captured console output) is truncated to the snapshot's values on resume.
* Memory the engine had grown into after the snapshot is zero-filled again (malloc assumes it).
* A cold run is "restore the pristine post-`_initialize` image" in the same instance.

`tests/incremental.mjs` and `tests/errors.mjs` assert that after every edit — text, preamble, title,
appended text, undefined macros, a missing package (fatal), missing `\end{document}`, runaway arguments
— the incrementally produced PDF (with `SOURCE_DATE_EPOCH` pinned), exit code and log are **identical** to
compiling the same text from scratch in a fresh instance.

## Limitations / future work

* No PDF/PNG *inclusion* (JPEG works), no shell escape, no Metafont fallback (missing fonts are reported).
  Only English hyphenation patterns; `lmodern` is needed for `T1` fonts (cm-super is not shipped).
* Snapshot spacing is time-based on user-file line reads; an `\input`-heavy preamble before the first
  user line cannot be skipped by a rollback beyond the first snapshot.
* Edits that change `.aux` content re-typeset from `\begin{document}` (LaTeX re-reads `.aux` there). The worker
  therefore posts the result of each pass as it finishes (stale references first, converged result a moment later).
* A runaway document (`\def\a{\a}\a`) cannot be interrupted from inside the worker: the UI offers *Stop*
  (terminates and restarts the worker).
* `ASYNCIFY_ONLY` lists could trim the +30 % instrumentation cost.

## Licenses

The glue in `src/`, `web/`, `scripts/` and `tests/` is MIT. The produced `pdftex.wasm` is a derivative of pdfTeX
and web2c (GPL-2.0-or-later); the pipeline above is its corresponding source. TeX Live macros/fonts keep their own licenses.
