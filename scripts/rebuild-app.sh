#!/bin/bash
# Rebuilds the native engine + bridge, packages sssketch as a real .app (no
# DMG, no notarization -- just an unpacked local build via `electron-builder
# --dir`, the fast path for iterating), and opens it. Run this any time after
# a code change instead of `npm run dev`, when you want a real double-
# clickable app rather than the dev server + separate Electron window.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Rebuilding native engine..."
cmake --build native-engine/build

echo "==> Rebuilding native bridge..."
cmake --build native-engine-bridge/build

echo "==> Building + packaging sssketch..."
npm run build:unpack

APP_PATH=$(find dist -maxdepth 3 -name "sssketch.app" -print -quit)
if [ -z "$APP_PATH" ]; then
  echo "Could not find sssketch.app under dist/ after build." >&2
  exit 1
fi

echo "==> Launching $APP_PATH"
open "$APP_PATH"
