#!/usr/bin/env bash
# Build the freestanding particle-engine WASM with the locally extracted
# clang-12 / wasm-ld toolchain. No Emscripten, no libc.
set -e

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)/.wasm-toolchain/root"
CLANG="$ROOT/usr/lib/llvm-12/bin/clang-12"
export LD_LIBRARY_PATH="$ROOT/usr/lib/llvm-12/lib:$ROOT/usr/lib/x86_64-linux-gnu:$ROOT/usr/lib"

# --export-all (with -msimd128 the `--export=memory` symbol form is unavailable,
# so we export-all; the bridge only calls the ck_* symbols among them).
# Intended ABI: ck_init/ck_reset/ck_step/ck_active, ck_build_atlas/ck_build_vertices,
#   ck_atlas_{rsx,tex,colors}_ptr, ck_vert_{pos,tex,colors_f}_ptr,
#   ck_max_capacity/ck_capacity/ck_img_size.

"$CLANG" -target wasm32-unknown-unknown \
  -msimd128 -O3 -flto -fno-exceptions -fno-rtti -fno-threadsafe-statics \
  -nostdlib -nostdlibinc -ffreestanding \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-all \
  -o particle-engine.wasm exports.cpp

echo "built: $(ls -la particle-engine.wasm | awk '{print $5" bytes"}')"
