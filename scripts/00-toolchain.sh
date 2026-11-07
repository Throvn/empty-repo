#!/usr/bin/env bash
# Install emscripten 4.0.9 (+nodejs, make) from conda-forge into build/emenv using micromamba.
# micromamba itself is fetched from the conda-forge channel as a plain .tar.bz2 package.
set -euo pipefail
. "$(dirname "$0")/env.sh"
mkdir -p "$WORK/mm"
if [ ! -x "$WORK/mm/bin/micromamba" ]; then
  curl -fsSL "https://conda.anaconda.org/conda-forge/linux-64/$MICROMAMBA_FILE" -o "$WORK/mm/mm.tar.bz2"
  tar -C "$WORK/mm" -xjf "$WORK/mm/mm.tar.bz2" bin/micromamba
fi
if [ ! -x "$EMENV/bin/emcc" ]; then
  "$WORK/mm/bin/micromamba" create -y -q -p "$EMENV" -c conda-forge --override-channels \
      "emscripten=$EMSCRIPTEN_VERSION" nodejs make python=3.12
fi
# conda-forge only ships binaryen <= 121 but emscripten 4.0.9 wants >= 123: take it from npm.
if [ ! -x "$BINARYEN_NPM/bin/wasm-opt" ]; then
  mkdir -p "$WORK/binaryen" && (cd "$WORK/binaryen" && npm init -y >/dev/null && npm install --silent "binaryen@$BINARYEN_VERSION")
fi
# merged tool dir: wasm-opt & friends 123 (npm) + wasm-emscripten-finalize 117 (conda; dropped upstream in 123)
mkdir -p "$WORK/binaryen-root/bin"
for t in "$BINARYEN_NPM"/bin/*; do ln -sf "$t" "$WORK/binaryen-root/bin/$(basename "$t")"; done
ln -sf "$EMENV/bin/wasm-emscripten-finalize" "$WORK/binaryen-root/bin/wasm-emscripten-finalize"
emcc --version | head -1
wasm-opt --version
