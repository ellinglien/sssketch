#!/usr/bin/env bash
# scripts/vendor-rubberband.sh
#
# Produces a self-contained, relocatable copy of the Homebrew-installed
# rubberband CLI (binary + every non-system dylib it transitively depends
# on) under resources/rubberband/, so electron-builder can ship it as an
# extraResource (see electron-builder.yml) and rubberband.ts's
# findRubberband() can use it with zero setup on the tester's machine --
# rubberband otherwise only ever looked for a Homebrew install (see git
# history), which meant every beta tester needed Homebrew plus a manual
# `brew install rubberband` before tempo stretching worked at all.
#
# Not run as part of `npm run dev`/`npm test` -- only in CI's release
# workflow (release.yml, after `brew install rubberband`) and optionally by
# hand for a local packaged-build dry run. Mirrors native-engine/build/'s
# own "gitignored, rebuilt fresh per release" convention (see
# native-engine/.gitignore) rather than committing binaries to a now-public
# repo.
#
# rubberband-cli is GPLv2+ -- shipping it as a separate subprocess binary
# invoked over argv (not linked into sssketch's own code) is the same "mere
# aggregation" pattern used by countless apps that bundle ffmpeg/similar
# GPL command-line tools; nothing in sssketch's own source links against
# rubberband's library.
set -euo pipefail

# $1, if given, is an explicit path to a rubberband binary to vendor (used by
# the x64 CI leg, which fetches and relocates an x86_64 binary that's never
# on PATH -- see scripts/fetch-x64-rubberband.py). Falls back to PATH
# resolution otherwise, unchanged from before.
RUBBERBAND_BIN="${1:-$(command -v rubberband || true)}"
if [ -z "$RUBBERBAND_BIN" ]; then
  echo "vendor-rubberband: no rubberband binary given and none found on PATH -- either pass a path as \$1 (e.g. the output of scripts/fetch-x64-rubberband.py) or run 'brew install rubberband' first" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/resources/rubberband"
BIN_DIR="$OUT_DIR/bin"
LIB_DIR="$OUT_DIR/lib"

rm -rf "$OUT_DIR"
mkdir -p "$BIN_DIR" "$LIB_DIR"

echo "vendor-rubberband: vendoring $RUBBERBAND_BIN"
cp "$RUBBERBAND_BIN" "$BIN_DIR/rubberband"
chmod +w "$BIN_DIR/rubberband"

# Breadth-first collection of every non-system dylib dependency, starting
# from the binary itself -- "non-system" means anything NOT under /usr/lib
# or /System (those are guaranteed present on every Mac and must NOT be
# touched by install_name_tool). Homebrew paths (/opt/homebrew/...,
# /usr/local/...) are exactly what needs vendoring, but this deliberately
# doesn't hardcode a Homebrew prefix -- otool -L is the source of truth for
# what to walk, so this keeps working if the dependency tree changes.
deps_of() {
  otool -L "$1" | tail -n +2 | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/)'
}

# Plain-array queue + newline-delimited "seen" string rather than an
# associative array -- macOS's default /bin/bash is 3.2 (no declare -A).
to_visit=("$RUBBERBAND_BIN")
visited=$'\n'

while [ ${#to_visit[@]} -gt 0 ]; do
  current="${to_visit[0]}"
  to_visit=("${to_visit[@]:1}")
  case "$visited" in
    *$'\n'"$current"$'\n'*) continue ;;
  esac
  visited="$visited$current"$'\n'

  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    name="$(basename "$dep")"
    if [ ! -f "$LIB_DIR/$name" ]; then
      echo "vendor-rubberband: vendoring dependency $dep"
      cp "$dep" "$LIB_DIR/$name"
      chmod +w "$LIB_DIR/$name"
    fi
    to_visit+=("$dep")
  done < <(deps_of "$current")
done

# Rewrite every vendored file's load commands to reference siblings via
# @rpath instead of the original absolute Homebrew path, and add the rpath
# entry that makes @rpath resolve relative to the file's own location --
# @executable_path/../lib for the binary (bin/ and lib/ are siblings under
# rubberband/), @loader_path for each dylib (dylibs all live together in
# lib/, so "next to me" is correct for dylib-to-dylib references too).
install_name_tool -add_rpath "@executable_path/../lib" "$BIN_DIR/rubberband" 2>/dev/null || true
while IFS= read -r dep; do
  [ -z "$dep" ] && continue
  install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$BIN_DIR/rubberband"
done < <(deps_of "$RUBBERBAND_BIN")

for dylib in "$LIB_DIR"/*.dylib; do
  install_name_tool -id "@rpath/$(basename "$dylib")" "$dylib"
  install_name_tool -add_rpath "@loader_path" "$dylib" 2>/dev/null || true
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$dylib"
  done < <(deps_of "$dylib")
done

# install_name_tool invalidates any existing signature -- ad-hoc sign so a
# local unsigned/--dir build still launches; electron-builder's real
# signing pass (build/afterSign.js) re-signs everything under Resources
# with the real Developer ID identity for an actual release build.
codesign --force --sign - "$BIN_DIR/rubberband"
for dylib in "$LIB_DIR"/*.dylib; do
  codesign --force --sign - "$dylib"
done

echo "vendor-rubberband: done -- $(ls "$LIB_DIR" | wc -l | tr -d ' ') dylibs vendored to $OUT_DIR"
