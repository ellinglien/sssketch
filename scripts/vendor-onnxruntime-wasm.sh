#!/usr/bin/env bash
# scripts/vendor-onnxruntime-wasm.sh
#
# Copies onnxruntime-web's own WASM runtime files (node_modules/
# onnxruntime-web/dist/*.{wasm,mjs}) into src/renderer/public/onnxruntime/,
# Vite's static-asset convention (files under a renderer's own public/ are
# copied verbatim to the build output root and served at /) -- these are
# NOT bundled by Vite's normal JS/CSS pipeline (they're loaded at runtime by
# onnxruntime-web itself via fetch/instantiateStreaming, not imported), so
# they need to exist as plain static files instead.
#
# Run once after `npm install` (or whenever onnxruntime-web is upgraded) --
# not part of `npm run dev` itself, since these files rarely change and
# don't need to be regenerated on every dev-server boot. Gitignored (see
# .gitignore) since they're a direct, un-transformed copy of a node_modules
# package's own files -- regenerating from the installed dependency is
# simpler and less error-prone than keeping a second committed copy in sync.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/node_modules/onnxruntime-web/dist"
OUT_DIR="$REPO_ROOT/src/renderer/public/onnxruntime"

if [ ! -d "$SRC_DIR" ]; then
  echo "vendor-onnxruntime-wasm: $SRC_DIR not found -- run 'npm install' first" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
shopt -s nullglob
files=("$SRC_DIR"/*.wasm "$SRC_DIR"/*.mjs)
if [ ${#files[@]} -eq 0 ]; then
  echo "vendor-onnxruntime-wasm: no .wasm/.mjs files found in $SRC_DIR -- onnxruntime-web's own dist/ layout may have changed; inspect it manually" >&2
  exit 1
fi
cp "${files[@]}" "$OUT_DIR/"
echo "vendor-onnxruntime-wasm: copied ${#files[@]} file(s) to $OUT_DIR"
ls -la "$OUT_DIR"
