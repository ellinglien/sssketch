#!/usr/bin/env bash
# scripts/build-x64-test.sh
#
# One-off, LOCAL-ONLY, UNSIGNED x86_64 test build -- not part of the
# release pipeline (release.yml still only builds/publishes arm64; this
# script never touches electron-builder.yml or release.yml). See
# docs/superpowers/specs/2026-08-11-intel-mac-test-build-design.md for
# full rationale.
#
# Cross-compiles native-engine to x86_64 -- the one genuinely untested
# part of this exercise. native-engine-bridge already always builds
# x86_64 regardless of host (see its own CMakeLists.txt), so it's built
# normally here only if missing, never cross-compiled specially.
#
# Deliberately does NOT vendor rubberband -- rubberband.ts's
# findRubberband() already falls back to a Homebrew-on-PATH rubberband
# when no bundled copy exists (its own doc comment: "a local unsigned
# build that skipped the vendor step"). Bundling the wrong-arch (arm64)
# copy would be worse than bundling none. On the Intel Mac, run
# `brew install rubberband` there directly if tempo-stretch needs testing.
#
# Output: an unsigned, unnotarized .app under dist/mac-x64/ (electron-
# builder's own naming for a --x64 --dir build). Zip it, transfer it to
# the Intel Mac (AirDrop/USB/cloud), then there:
#   unzip, drag sssketch.app to Applications, then:
#   xattr -cr /Applications/sssketch.app
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> [1/7] Cross-compiling native-engine for x86_64"
echo "    (first run: ~10-15 min, same JUCE fetch+build cost CI pays for a fresh build dir)"
cmake -B native-engine/build-x64 -DCMAKE_OSX_ARCHITECTURES=x86_64 native-engine
cmake --build native-engine/build-x64 --config Release

ENGINE_BIN="native-engine/build-x64/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine"
echo "==> [2/7] Verifying native-engine architecture"
file "$ENGINE_BIN"
if ! file "$ENGINE_BIN" | grep -q x86_64; then
  echo "ERROR: $ENGINE_BIN is not x86_64 -- cross-compile did not take effect" >&2
  exit 1
fi

BRIDGE_APP="native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app"
if [ ! -d "$BRIDGE_APP" ]; then
  echo "==> [3/7] Building native-engine-bridge (missing locally; always x86_64, one-time)"
  cmake -B native-engine-bridge/build native-engine-bridge
  cmake --build native-engine-bridge/build --config Release
else
  echo "==> [3/7] native-engine-bridge already built, skipping"
fi

echo "==> [4/7] Building renderer/main bundle"
npx electron-vite build

echo "==> [5/7] Generating the x64-test electron-builder config"
node scripts/generate-x64-test-config.js

echo "==> [6/7] Packaging unsigned x64 .app"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 --dir -c electron-builder.x64-test.generated.yml

APP_PATH="dist/mac-x64/sssketch.app"
echo "==> [7/7] Sanity-checking the packaged app"
echo "-- engine binary architecture:"
file "$APP_PATH/Contents/Resources/native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine"
echo "-- signing status (expect: unsigned / adhoc, not a real Developer ID):"
codesign -dvvv "$APP_PATH" 2>&1 | head -5
echo "-- bundled resources (expect: native-engine, native-engine-bridge, demo-rifff -- NOT rubberband):"
ls "$APP_PATH/Contents/Resources"

echo ""
echo "Done. $APP_PATH is ready to zip and copy to the Intel Mac."
echo "There: unzip, drag to Applications, then run:"
echo "  xattr -cr /Applications/sssketch.app"
