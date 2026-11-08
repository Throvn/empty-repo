# Reproducible pdfTeX -> WebAssembly pipeline.   `make`  builds everything into build/web
# (each step is an idempotent script in scripts/; build/ is the only place anything is written)
SHELL := /bin/bash
STAMP := build/.stamps

all: web
$(STAMP):
	@mkdir -p $@

toolchain: $(STAMP)/toolchain
$(STAMP)/toolchain: scripts/00-toolchain.sh scripts/env.sh | $(STAMP)
	scripts/00-toolchain.sh && touch $@

sources: $(STAMP)/sources
$(STAMP)/sources: scripts/10-fetch-sources.sh | $(STAMP)
	scripts/10-fetch-sources.sh && touch $@

native: $(STAMP)/native                       # web2c on the host: WEB -> C
$(STAMP)/native: $(STAMP)/sources scripts/20-native-gen.sh
	scripts/20-native-gen.sh && touch $@

wasm: $(STAMP)/wasm                           # build/web/pdftex.wasm
$(STAMP)/wasm: $(STAMP)/toolchain $(STAMP)/native scripts/30-build-wasm.sh $(wildcard src/*.c src/*.h src/shim/*.h)
	scripts/30-build-wasm.sh && ENGINE=bibtex scripts/30-build-wasm.sh && touch $@

texlive: $(STAMP)/texlive                     # build/web/texlive.data (+ texlive.json)
$(STAMP)/texlive: $(STAMP)/toolchain scripts/40-texlive-files.sh scripts/tools/mktree.py scripts/tools/mkindex.py | $(STAMP)
	scripts/40-texlive-files.sh && touch $@

fmt: $(STAMP)/fmt                             # build/web/pdflatex.fmt, dumped by the wasm engine itself
$(STAMP)/fmt: $(STAMP)/wasm $(STAMP)/texlive scripts/60-build-fmt.mjs
	node scripts/60-build-fmt.mjs && touch $@

web: $(STAMP)/web
$(STAMP)/web: $(STAMP)/fmt $(wildcard web/*.js web/*.html) scripts/66-hotset.mjs scripts/70-package-web.sh
	node scripts/66-hotset.mjs && scripts/70-package-web.sh && touch $@

engines: $(STAMP)/engines                      # tex.wasm, etex.wasm: only for the trip tests
$(STAMP)/engines: $(STAMP)/native scripts/30-build-wasm.sh $(wildcard src/*.c src/*.h)
	ENGINE=tex scripts/30-build-wasm.sh && ENGINE=etex scripts/30-build-wasm.sh && touch $@

trip: engines                                   # Knuth's TRIP test on tex.wasm, e-TRIP on etex.wasm and pdftex.wasm
	node tests/trip.mjs && node tests/etrip.mjs && ENGINE=pdftex node tests/etrip.mjs

diff: web                                       # differential corpus: byte-identical to native pdftex
	scripts/65-native-ref.sh >/dev/null && node tests/diff.mjs

fuzz: web                                       # random edits: incremental == from-scratch
	node tests/fuzz.mjs

test: web
	node tests/incremental.mjs && node tests/errors.mjs && node tests/synctex.mjs

bench: web
	node tests/bench.mjs

serve: web
	python3 scripts/serve.py 8000 build/web

clean:
	rm -rf build/wasm build/web build/.stamps
distclean:
	rm -rf build

.PHONY: engines trip diff fuzz all toolchain sources native wasm texlive fmt web test bench serve clean distclean
