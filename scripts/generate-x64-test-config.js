#!/usr/bin/env node
// scripts/generate-x64-test-config.js
//
// Generates electron-builder.x64-test.generated.yml (gitignored, regenerated
// every run of scripts/build-x64-test.sh) from the REAL electron-builder.yml,
// rather than hand-maintaining a static duplicate.
//
// Why generated, not a static override file: electron-builder's -c flag,
// when given a file path, does NOT merge with the auto-detected
// electron-builder.yml -- it replaces it entirely (confirmed by reading
// app-builder-lib's own util/config/load.js's getConfig: a non-null
// configPath skips the auto-detect path completely). A small static
// override containing just extraResources would silently produce a config
// missing appId, directories, afterPack, mac.category, and everything
// else. See docs/superpowers/specs/2026-08-11-intel-mac-test-build-design.md
// for the full story (this was the wrong approach on the first attempt).
//
// Takes the real config's own extraResources array and:
//   - repoints the native-engine entry at the x86_64 cross-compile output
//     (native-engine/build-x64/...) instead of the normal arm64 path
//   - drops the rubberband entry entirely -- there's no x86_64 vendored
//     rubberband, and bundling the wrong-arch (arm64) one would be found
//     by rubberband.ts's findRubberband() before it ever reaches that
//     function's existing Homebrew-on-PATH fallback, so it would fail
//     outright instead of falling back gracefully
//   - leaves everything else (native-engine-bridge, demo-rifff, and every
//     other top-level config key) untouched, derived from the real file
//     rather than retyped, so this can't silently drift out of sync if
//     electron-builder.yml changes later
const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const SOURCE = path.join(REPO_ROOT, 'electron-builder.yml')
const OUTPUT = path.join(REPO_ROOT, 'electron-builder.x64-test.generated.yml')

const config = yaml.load(fs.readFileSync(SOURCE, 'utf8'))

const ARM64_ENGINE_FROM = 'native-engine/build/sssketch_engine_artefacts/sssketch-engine.app'
const X64_ENGINE_FROM = 'native-engine/build-x64/sssketch_engine_artefacts/sssketch-engine.app'
const RUBBERBAND_FROM = 'resources/rubberband'

const original = config.extraResources
if (!Array.isArray(original)) {
  throw new Error(`expected electron-builder.yml's extraResources to be an array, got: ${JSON.stringify(original)}`)
}
if (!original.some((r) => r.from === ARM64_ENGINE_FROM)) {
  throw new Error(
    `electron-builder.yml's extraResources no longer contains the expected native-engine entry (${ARM64_ENGINE_FROM}) -- update ARM64_ENGINE_FROM/X64_ENGINE_FROM in this script to match`
  )
}

config.extraResources = original
  .filter((r) => r.from !== RUBBERBAND_FROM)
  .map((r) => (r.from === ARM64_ENGINE_FROM ? { ...r, from: X64_ENGINE_FROM } : r))

fs.writeFileSync(OUTPUT, yaml.dump(config))
console.log(`generate-x64-test-config: wrote ${OUTPUT}`)
