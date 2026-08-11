# Local Unsigned x86_64 Test Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a one-off, local-only, unsigned, fully x86_64 build of sssketch (Electron shell
+ native engine + bridge, all native Intel) so Elling can test it on a real Intel Mac at the
office — with zero changes to the real release/CI pipeline.

**Architecture:** A new orchestration script (`scripts/build-x64-test.sh`) cross-compiles
`native-engine` to x86_64 into a fresh build directory, builds `native-engine-bridge` if it
doesn't already exist (it's already always x86_64 regardless of host), then packages an unsigned
`.app` via `electron-builder --dir` using a config generated at build time by
`scripts/generate-x64-test-config.js` — NOT a hand-written static file. (An earlier version of
this plan used a static override; that was wrong and was corrected mid-implementation after
tracing electron-builder's actual config-loading code, which showed `-c <file>` replaces
`electron-builder.yml` entirely rather than merging with it. See the design doc's "Packaging"
section for the full story.) The generated config takes the real `electron-builder.yml`,
repoints the native-engine `extraResources` entry at the x86_64 build, and drops rubberband
(whose existing PATH-fallback in `rubberband.ts` already covers this case) — everything else
carried over unchanged from the real config. No test framework applies here — this is a build
script, not application logic — so "testing" means literally running the script end-to-end and
inspecting its own sanity-check output, exactly as the design spec's own Testing section
describes.

**Tech Stack:** Bash, CMake (JUCE-based `native-engine`), electron-builder, `electron-vite`.

**Design doc:** `docs/superpowers/specs/2026-08-11-intel-mac-test-build-design.md` — read this
first for the full rationale (especially "Known risks" and "What `--x64` actually controls").

---

### Task 1: `native-engine/.gitignore` — ignore the new build directory

**Files:**
- Modify: `native-engine/.gitignore`

Current contents:
```
build/
_deps/
```

- [ ] **Step 1: Add the new build directory to the ignore list**

Edit `native-engine/.gitignore` to:
```
build/
build-x64/
_deps/
```

- [ ] **Step 2: Verify**

Run: `git -C /Users/nickel/Claudecode/sssketch check-ignore -v native-engine/build-x64/anything`
Expected: prints a match against the new `build-x64/` line (confirms git will actually ignore
the directory the script is about to create — catching a typo here now is cheaper than
discovering it after `git status` shows a huge untracked build tree later).

- [ ] **Step 3: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/.gitignore
git commit -m "Ignore native-engine/build-x64/ (new local x64 test build dir)"
```

---

### Task 2: `scripts/generate-x64-test-config.js` — dynamically generate the packaging config

**Files:**
- Create: `scripts/generate-x64-test-config.js`
- Modify: `.gitignore` (root)

**Why generated, not a static file** (this corrects an earlier version of this plan — read this
before writing any code): electron-builder's `-c <file>` flag, when given a file path, does
**not** merge with the auto-detected `electron-builder.yml`. It replaces it entirely. Confirmed
by reading `app-builder-lib`'s own source: `node_modules/app-builder-lib/out/packager.js` around
line 249-254 shows a string `-c` value becomes `configPath`; `node_modules/app-builder-lib/out/
util/config/load.js`'s `getConfig` (line 82-89) reads *only* that file when `configPath` is
non-null — the auto-detection of `electron-builder.yml` never runs. A small override file
containing just `extraResources` would silently produce a config missing `appId`, `directories`,
`afterPack`, `mac.category`, and everything else the real config defines — not a "merge failure
that includes too much," a config that's missing almost everything.

The fix: read the real `electron-builder.yml` at build time and produce a complete config,
changing only what needs to change — so the generated file can never define a different `appId`
or forget `afterPack` just because `electron-builder.yml` gains a new field someday.

- [ ] **Step 1: Create the script**

```js
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
// app-builder-lib's util/config/load.js's own getConfig: a non-null
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
```

- [ ] **Step 2: Run it and verify the output**

```bash
cd /Users/nickel/Claudecode/sssketch
node scripts/generate-x64-test-config.js
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const generated = yaml.load(fs.readFileSync('electron-builder.x64-test.generated.yml', 'utf8'));
const real = yaml.load(fs.readFileSync('electron-builder.yml', 'utf8'));
console.log('appId matches real config:', generated.appId === real.appId);
console.log('extraResources:', JSON.stringify(generated.extraResources, null, 2));
"
```
Expected: `appId matches real config: true` (proves the full config carried over, not just
`extraResources`), and the printed `extraResources` array has exactly 3 entries — native-engine
pointing at `native-engine/build-x64/...`, native-engine-bridge and demo-rifff unchanged from the
real config, no rubberband entry.

- [ ] **Step 3: Add the generated file to `.gitignore`**

It's a build artifact regenerated on every run, not something to commit. Add this line to the
root `.gitignore` (check the file first — add near `dist/`/`dist-electron/` if there's a logical
grouping, otherwise at the end):

```
electron-builder.x64-test.generated.yml
```

Verify: `git check-ignore -v electron-builder.x64-test.generated.yml` should print a match.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-x64-test-config.js .gitignore
git commit -m "Add script to generate the x64-test electron-builder config"
```

Do NOT commit `electron-builder.x64-test.generated.yml` itself — it's gitignored precisely so
`git status` won't show it as untracked after Step 2 generates it locally.

---

### Task 3: `scripts/build-x64-test.sh` — the orchestration script

**Files:**
- Create: `scripts/build-x64-test.sh`

Follows the same conventions as the existing `scripts/vendor-rubberband.sh` (`set -euo pipefail`,
doc comment at the top explaining *why*, `REPO_ROOT` computed from the script's own location so
it works regardless of the caller's cwd).

- [ ] **Step 1: Create the script**

```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/build-x64-test.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build-x64-test.sh
git commit -m "Add local x86_64 test-build orchestration script"
```

---

### Task 4: Run the script end-to-end (this is the actual "test" for this plan)

There is no automated test suite for a build script — the design doc's own Testing section says
so explicitly. Verification is running it for real and checking every one of its own inline
checks passes, then (separately, by Elling, off this session) the real-hardware walkthrough.

- [ ] **Step 1: Confirm no port/state gotchas before running**

Not applicable here — unlike `npm run dev`, this script doesn't spawn any long-running process
that could collide with an existing one. No pre-flight cleanup needed.

- [ ] **Step 2: Run the script**

```bash
cd /Users/nickel/Claudecode/sssketch
./scripts/build-x64-test.sh
```

Expected: all six numbered steps print, no `ERROR:` line, and the script's own final three
checks show:
- engine binary: `Mach-O 64-bit executable x86_64` (not `arm64`)
- `codesign -dvvv` output: does NOT show `Authority=Developer ID Application: Elling Lien...` —
  either "code object is not signed at all" or an ad-hoc signature (`Signature=adhoc`), matching
  the explicit unsigned intent (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- `Contents/Resources` listing: `native-engine`, `native-engine-bridge`, `demo-rifff` present;
  `rubberband` absent

**If Step 2 fails at the "Cross-compiling native-engine" stage:** this is the design doc's #1
known risk (JUCE's CMake build not cross-compiling cleanly to x86_64 for the full engine, unlike
the audio-I/O-free bridge). Read the actual CMake/compiler error — do not retry blindly. This is
new, genuinely uncharted territory for this codebase; if it fails, report the exact error back
rather than guessing at a fix.

**If Step 2 fails at the "Packaging unsigned x64 .app" stage** with an error related to
`better-sqlite3` or native module rebuilding: this is the design doc's #2 known risk
(`@electron/rebuild` cross-compiling a native Node addon for x64 from an arm64 host). Same
guidance — report the exact error rather than guessing.

- [ ] **Step 3: Confirm the build artifacts are actually ignored by git**

```bash
git status --short
```

Expected: clean (or only showing unrelated in-progress work from elsewhere in the repo) — no
`dist/`, `native-engine/build-x64/`, or similar untracked build output listed. (`dist/` is
already covered by the root `.gitignore`; `native-engine/build-x64/` by Task 1's change.)

- [ ] **Step 4: Zip the app for transfer**

```bash
cd dist/mac-x64
zip -r -y sssketch-x64-test.zip sssketch.app
cd /Users/nickel/Claudecode/sssketch
```

Report the resulting path (`dist/mac-x64/sssketch-x64-test.zip`) back — this file is git-ignored
(`dist/`), so it's Elling's own job to move it to the Intel Mac (AirDrop, USB, shared drive,
whatever's convenient), not something this plan automates.

---

### Task 5: Full verification + report back

- [ ] **Step 1: Confirm nothing outside this plan's scope changed**

```bash
git log --oneline -5
git diff origin/master --stat
```

Expected: exactly the commits from Tasks 1-3 (gitignore line, new override config, new script) —
no changes to `electron-builder.yml`, `release.yml`, or anything else in the real release
pipeline, matching the design doc's explicit non-goal.

- [ ] **Step 2: Report the walkthrough gap explicitly**

This plan cannot verify the actual point of the exercise — whether the app launches and plays
audio on real Intel hardware — from inside this session. State that clearly rather than implying
success: the script running cleanly through all six steps means the *build* succeeded; it says
nothing yet about whether the *engine* actually works on Intel silicon. That's Elling's own next
step, off-session, on the real Intel Mac at the office.
