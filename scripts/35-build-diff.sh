#!/usr/bin/env bash
# Assemble the tiny SIMD memory-diff helper (web/diff.wat -> build/web/diff.wasm) with binaryen's wasm-as.
set -euo pipefail
. "$(dirname "$0")/env.sh"
mkdir -p "$WORK/web"
wasm-as --enable-simd --enable-multimemory --enable-bulk-memory "$ROOT/web/diff.wat" -o "$WORK/web/diff.wasm"
ls -la "$WORK/web/diff.wasm"
