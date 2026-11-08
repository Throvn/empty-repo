# pdfTeX in WebAssembly — with TeXpresso-style incremental compilation

A reproducible pipeline that turns **pdfTeX 1.40.25 (TeX Live 2023)** into **one `pdftex.wasm` file**
(1.8 MB, 0.6 MB gzipped, asyncify included), plus a browser front end: a multi-file project editor, a *Compile*
button, a PDF preview with SyncTeX click-to-source, and an incremental mode in which editing a long document
recompiles only what changed, by swapping the engine's **linear memory** back to a snapshot
(the [TeXpresso](https://github.com/let-def/texpresso) idea, done with `asyncify` instead of `fork()`).

```
make          # toolchain → sources → native codegen → wasm (pdftex, bibtex) → TeX tree → format → hot set → build/web
make serve    # http://localhost:8000   (needs HTTP Range support: scripts/serve.py has it)
make test     # incremental == from-scratch, byte for byte; error recovery; SyncTeX
make trip     # Knuth's TRIP test (tex.wasm), e-TRIP (etex.wasm and pdftex.wasm)
make diff     # ~500 edge-case documents: wasm output byte-identical to native pdftex
make fuzz     # random edits: incremental result == from-scratch result
```

**Prerequisites** (Debian/Ubuntu): `build-essential g++ curl python3 zlib1g-dev libpng-dev` (host libs for the throw-away native
web2c build) and outbound HTTPS to `archive.ubuntu.com`, `conda.anaconda.org` and `registry.npmjs.org`. Everything else
(Emscripten, node, Binaryen) is installed into `build/`.

## What it supports

* **pdfTeX/LaTeX** with the format `pdflatex.fmt`, any package of the (Ubuntu-packaged) TeX Live 2023 tree: ≈ 48 000 files, 640 MB, *lazily*
  fetched with HTTP Range requests (sync XHR inside the worker) — a page load transfers only the ≈ 8 MB "hot set"
  (`hot.data`: what a typical article/beamer/thesis touches) and the format; everything else is pulled on first use and cached.
* **PNG** (all colour types and bit depths, interlaced, tRNS, gAMA/pHYs, 16-bit, truncated/broken files → same errors as native),
  **JPEG**, **PDF inclusion** (xpdf's parser, compiled parser-only; beamer/TikZ externalisation/`\includegraphics{x.pdf}` work),
  user-uploaded binary files, `\input`/`\include`/subdirectories, `.bib` files.
* **BibTeX** (`bibtex.wasm`, 160 KB, run automatically when `\bibliography` is present: pdflatex → bibtex → pdflatex → … until
  the aux/bbl/toc files stop changing; natbib, biblatex-with-bibtex, IEEEtran, plainnat).
* **SyncTeX**: click in the PDF → source line; Ctrl+J (or the button) → highlight in the PDF.
* **Problems panel** with jump-to-line; Stop button for runaway documents; project persistence in `localStorage`.
* **No** shell escape / `minted`, no `makeindex`/`biber`, no XeTeX/LuaTeX (different engines), no Metafont fallback (missing fonts are reported).

## Verification

All numbers are from the committed test suite (`tests/`), against native `pdftex` built from the same web2c output.

| test | what | result |
|---|---|---|
| `tests/trip.mjs` | Knuth's TRIP test on `tex.wasm`, same procedure and sed filter as TeX Live's `triptest.test` | pass |
| `tests/etrip.mjs` | e-TRIP on `etex.wasm` and on `pdftex.wasm` (`ENGINE=pdftex`) | pass |
| `tests/diff.mjs` | corpus of ≈ 500 documents (`gen-corpus.py`: TeX primitives, error paths, memory-limit overflows, every PNG variety, fonts, tikz, beamer, bibtex, ... plus `gen-corpus-real.py`: thesis, IEEE paper, beamer talk, KOMA report, CV, math notes, longtable) — PDF and every other output byte-identical, exit codes equal, logs equal modulo line wrapping/paths | see `build/diff-results.json` |
| `tests/fuzz.mjs` | thousands of random edits (line insert/delete/swap, token mutation, `.bib`/`.sty`/`.bst` edits) over the corpus: incremental result vs. cold compile in a fresh instance | identical |
| `tests/synctex.mjs` | forward/inverse SyncTeX over the corpus vs. native `synctex` data | 468/480 exact |
| `tests/incremental.mjs`, `errors.mjs` | targeted incremental cases and error recovery | pass |
| Playwright (not committed) | compile, upload, multi-file, bibtex+tikz+natbib, errors/Problems, Stop, persistence, synctex click | pass |

Bugs this found (all fixed): openout policy and parent-directory checks, `./name` presentation, subdirectory tree search, `mtime`,
carrying every written file between passes, `latex-dev` shadowing `latex.ltx`, per-program `TEXINPUTS` tiers (`tex@pdflatex`), duplicated
`pdftex.map` entries, cm-super (`t1c2pfb` expansion), missing font families, `.bib`-only edits returning a cached PDF, a user-supplied
unchanged `.bbl` clobbering the regenerated one, memory parameters (now TeX Live's defaults: `main_memory 5000000`, `pool_size 6250000`,…).

## Numbers (4-core x86 VM, node 22; in headless Chromium about 1.5× slower)

| document | cold compile (1 pass) | edit near the end | edit in the middle |
|---|---|---|---|
| 43 pages, 970 lines | 0.4 s | **40–85 ms** | 110 ms |
| 277 pages, 6400 lines | 0.75 s | **77 ms** | 250–450 ms |

* An edit that does not change cross-references costs one resumed pass; an edit that changes `.aux`
  (a heading, a label) triggers the usual LaTeX second pass, which re-reads `.aux` at `\begin{document}`
  and therefore re-typesets everything — the UI shows the first pass immediately and refines in the background.
* Engine speed: plain wasm build ≈ native `pdftex`; asyncify instrumentation costs ≈ +30 % run time and +22 % binary size;
  a snapshot costs ≈ 6 ms (every ≥ 40 ms of work).

## Repository layout

| path | what |
|---|---|
| `scripts/00-toolchain.sh` | Emscripten 4.0.9 (conda-forge via micromamba) + Binaryen 123 (npm) |
| `scripts/10-fetch-sources.sh` | pinned, SHA-checked tarballs: `texlive-bin` 2023.20230311, zlib, libpng |
| `scripts/20-native-gen.sh` | builds pdfTeX/TeX/e-TeX/BibTeX natively **only** to run web2c (`tangle → web2c → C`), harvests the C, and the native reference tools |
| `scripts/30-build-wasm.sh` | `emcc`: generated C + xpdf + libpng + `src/*.c` → `pdftex.wasm` (`ENGINE=bibtex|tex|etex` for the others) |
| `scripts/40-texlive-files.sh` | assembles the TeX tree from pinned `.deb`s (`checksums/debs.sha256`), `tools/mktree.py` filters it and generates `pdftex.map`/`language.dat`, `tools/mkindex.py` writes the compact index; packed with emscripten's `file_packager` |
| `scripts/60-build-fmt.mjs` | runs `pdftex.wasm` itself in `-ini` mode to dump `pdflatex.fmt` |
| `scripts/65-native-ref.sh` | native format for the differential tests |
| `scripts/66-hotset.mjs` | records the files typical documents touch → `hot.data` |
| `scripts/70-package-web.sh` | assembles the static site (+ pdf.js, `.gz` copies) |
| `src/` | the C that replaces libraries and glues the engine to the host |
| `web/` | `engine.js` (host + incremental logic), `worker.js`, `index.html`, `project.js`, `problems.js`, `viewer.js`, `synctex.js` |
| `tests/` | see Verification; `lib/harness.mjs` shared helpers, `images/` PNG fixtures, `corpus/` hand-written cases |

Everything lands in `build/`; the only inputs are the pinned URLs/checksums in `scripts/`.

## How the port works

### One binary, almost no imports

`pdftex.wasm` is a `STANDALONE_WASM` reactor (no Emscripten JS runtime, no `FILESYSTEM`, no side modules). Its imports are
the nine `host_*` functions in `src/wasm_host.h` (lookup, isdir, size, read, is_user, search, mtime, want_snapshot, snapshot),
a few WASI calls, one memory-growth notification and two dead socket stubs.

### Libraries that were replaced instead of ported

| upstream | here | why |
|---|---|---|
| **kpathsea** | `src/mini_kpse.c` | pdfTeX uses ~35 entry points. A flat host index + per-format/per-program tree tiers does the same job in a sandbox, including the `openout_any`/`openin_any` policies. Compiled-in `texmf.cnf` parameter table. |
| **Emscripten FS / WASI path_open** | `src/vfs.c` | all file state must live in linear memory. `fopen` & co. are redirected with `--wrap` to `fopencookie()` streams over in-memory "memfiles" or host files read through `host_read`. |
| **libpng** `setjmp` error handling | `src/png_glue.c` | libpng's error callbacks are made to unwind without `setjmp`, so PNG works with asyncify and without JS glue. |
| `gzdopen` on the format file | `gz*` shims in `vfs.c` | the format lives in RAM. |
| BibTeX's `setjmp` | wasm-native SjLj | `bibtex.wasm` has no asyncify, so ordinary setjmp is fine. |

Small and self-contained, kept as is: pdfTeX's writers (Type 1/TrueType/JBIG2/JPEG), libmd5, SyncTeX, zlib, and xpdf's parser (C++, parser only, no rendering).

## Incremental compilation: TeXpresso on wasm

TeXpresso keeps a forked, suspended TeX process at interesting points and records which *bytes of which files* each process has read.
When you edit, it resumes the newest process that had not yet read the first changed byte. The same ingredients, wasm style:

| TeXpresso | here |
|---|---|
| `fork()` a suspended process | **snapshot = copy of linear memory + saved wasm call stack** |
| process state | *all* of it is in linear memory: heap, C stack, stdio buffers, **and the virtual filesystem**; the only external state is the immutable-per-run input files |
| trace of file reads | every `host_read` of a user file and every lookup that may resolve to one is logged; text files are handed out **one line at a time** so "bytes consumed" is exact |
| roll back to before the first changed byte | `_plan()`: diff old/new user files → first differing offset → earliest trace event that observed it → newest snapshot taken before that event |

**Taking a snapshot (asyncify).** `__wrap_input_line` asks `host_want_snapshot()` before reading a line of a *user* file. If yes it calls
`host_snapshot()`, an asyncify import: Binaryen's pass unwinds the whole wasm call stack into a static buffer (linear memory). JS then
copies linear memory, records the stack pointer global, `asyncify_start_rewind()`s and re-enters; the engine carries on as if nothing happened.

**Resuming.** Copy the snapshot's memory back, set the stack-pointer global, `asyncify_start_rewind()`, call `tex_run()` again: every
instrumented function restores its locals and TeX continues inside `host_snapshot()` of the original run — typically in the middle of a
paragraph of the changed file — which now returns and reads the *new* bytes.

**Cheap snapshots.** Memory `[0, sbrk)` is cut in 4 KiB chunks; a snapshot is a table of shared, immutable chunks. Changed chunks are found
inside the module (`src/snap.c`: SIMD compare against a shadow image of the previous snapshot kept in a reserved region of the same memory).

**Rules that make rollbacks exact**
* `find` events (`\input` probing `foo.tex`, `main.aux`…) invalidate when a file appears/disappears.
* Every file a run writes (except pdf/log/dvi/synctex/fmt) is *carried* into the next pass as an ordinary tracked input, so LaTeX's multi-pass
  convergence works; the loop stops when the files stop changing. BibTeX is run between passes on the same mechanism (before planning, so `.bib`-only edits are noticed).
* No byte of any tracked file changed ⇒ no run at all (cached PDF).
* JS-side bookkeeping is truncated to the snapshot's values on resume; memory grown after the snapshot is zero-filled again.
* A cold run is "restore the pristine post-`_initialize` image" in the same instance.

The fuzzer (`tests/fuzz.mjs`) and `tests/incremental.mjs` assert that after every edit the incrementally produced PDF, exit code and log are
**identical** to compiling the same text from scratch in a fresh instance.

## Limitations / future work

* No `makeindex`, `biber`, shell escape, XeTeX/LuaTeX; only the bundled TeX Live packages. Fonts missing from the tree are reported, not generated.
* Snapshot spacing is time-based on user-file line reads; an `\input`-heavy preamble before the first user line is not skippable.
* Edits that change `.aux` content re-typeset from `\begin{document}`.
* A runaway document cannot be interrupted from inside the worker: the UI offers *Stop* (terminates and restarts the worker).
* SyncTeX inverse search is 468/480 exact on the corpus (the rest land on a neighbouring box).
* `ASYNCIFY_ONLY` lists could trim the +30 % instrumentation cost.

## Licenses

The glue in `src/`, `web/`, `scripts/` and `tests/` is MIT. The produced `pdftex.wasm` is a derivative of pdfTeX
and web2c (GPL-2.0-or-later); the pipeline above is its corresponding source. TeX Live macros/fonts keep their own licenses.
