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

# `open` on an app that's already running just refocuses the EXISTING
# process instead of launching a new one -- so a rebuild while the app is
# still open would silently keep showing the old code with no visible sign
# anything went wrong. Force-quitting first (not a graceful quit -- this is
# a dev-iteration tool, not asking the running instance to save anything)
# guarantees `open` always starts a genuinely fresh process on the new build.
pkill -9 -f "$APP_PATH/Contents/MacOS/sssketch" 2>/dev/null || true
sleep 1

echo "==> Launching $APP_PATH"
open "$APP_PATH"
