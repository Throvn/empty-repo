# Shared environment for the pipeline. Source me:  . scripts/env.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT
export WORK="${WORK:-$ROOT/build}"          # all build products live here
export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-$WORK/mamba}"
export EMENV="${EMENV:-$WORK/emenv}"        # emscripten 4.0.9 + node (conda-forge)
export PATH="$EMENV/bin:$PATH"
# Pinned inputs -------------------------------------------------------------
export TL_SRC_PKG=texlive-bin               # Ubuntu 24.04 source package
export TL_SRC_VER=2023.20230311.66589-9build3
export EMSCRIPTEN_VERSION=4.0.9
export MICROMAMBA_FILE=micromamba-2.10.0-0.tar.bz2
export BINARYEN_VERSION=123.0.0
export BINARYEN_NPM="$WORK/binaryen/node_modules/binaryen"
export BINARYEN_ROOT="$WORK/binaryen-root"
export EM_BINARYEN_ROOT="$BINARYEN_ROOT"
export PATH="$BINARYEN_ROOT/bin:$PATH"
