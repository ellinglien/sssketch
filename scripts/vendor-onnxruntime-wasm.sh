#!/usr/bin/env bash
# scripts/vendor-onnxruntime-wasm.sh
#
# Copies onnxruntime-web's own low-level WASM runtime binary + its glue JS
# (node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{wasm,mjs})
# into src/renderer/public/onnxruntime/, Vite's static-asset convention
# (files under a renderer's own public/ are copied verbatim to the build
# output root and served at /) -- these are NOT bundled by Vite's normal
# JS/CSS pipeline (they're loaded at runtime by onnxruntime-web itself via
# fetch/instantiateStreaming, not imported), so they need to exist as plain
# static files instead.
#
# Deliberately does NOT copy the whole dist/ directory (2026-09-14, code
# quality review of the first version of this script, which did -- verified
# directly with a real `electron-vite build`: everything under public/ ships
# in the packaged app unpruned, not just in dev). dist/ also contains the
# top-level `ort.*` API entry points (ort.mjs, ort.all.mjs, ort.webgpu.mjs,
# ...) -- those are NOT fetched as static files at all; they're what gets
# pulled in by Vite's own normal JS bundling when yamnetWorker.ts imports
# onnxruntime-web, so copying them here serves no purpose. Narrowed further
# to the `-simd-threaded` variant specifically (excluding its own .jsep/
# .jspi/.asyncify siblings, ~67MB) since this app only ever creates an
# InferenceSession with `executionProviders: ['wasm']` (the plain CPU
# backend, see yamnetWorker.ts) -- the jsep/jspi/asyncify variants exist
# specifically for WebGPU/WebNN's need to call back into JS from inside
# WASM, which a pure CPU backend never does. This narrowing is believed
# correct (traced from onnxruntime-web's own naming/purpose) but NOT yet
# confirmed against a real dev-server run watching which file
# yamnetWorker.ts's own InferenceSession.create() actually requests -- if
# WASM loading fails after this script runs, re-check this filter FIRST
# before assuming the bug is elsewhere.
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
# Clears any files from a PRIOR run before copying -- without this, a future
# onnxruntime-web upgrade that renames/drops a file would leave the old one
# behind forever (this directory's contents ship in the packaged app, so a
# stale leftover isn't just cosmetic).
rm -f "$OUT_DIR"/*.wasm "$OUT_DIR"/*.mjs

shopt -s nullglob
files=("$SRC_DIR"/ort-wasm-simd-threaded.wasm "$SRC_DIR"/ort-wasm-simd-threaded.mjs)
if [ ${#files[@]} -eq 0 ]; then
  echo "vendor-onnxruntime-wasm: ort-wasm-simd-threaded.{wasm,mjs} not found in $SRC_DIR -- onnxruntime-web's own dist/ layout may have changed; inspect it manually and update this script's file list" >&2
  exit 1
fi
cp "${files[@]}" "$OUT_DIR/"
echo "vendor-onnxruntime-wasm: copied ${#files[@]} file(s) to $OUT_DIR"
ls -la "$OUT_DIR"
