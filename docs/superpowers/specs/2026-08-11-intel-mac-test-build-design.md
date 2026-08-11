# Local Unsigned x86_64 Test Build — Design

**Status:** Drafted through the brainstorming skill with Elling. Scope was narrowed live during
the conversation: the original ask ("make it compatible with Intel Macs") started out framed
around two CI-pipeline approaches (cross-compile x64 in `release.yml`, or add a real Intel CI
runner), but Elling's actual immediate goal is narrower — get something testable on a real Intel
Mac he has at the office, as fast as possible, to find out whether the native audio engine even
cross-compiles and runs correctly on Intel hardware *before* investing in a permanent CI change.
Both original CI approaches are explicitly deferred pending this test's result.

## Background

sssketch currently ships one architecture: arm64. `electron-builder.yml`'s `mac.target.arch` is
`[arm64]` only, and `native-engine`'s CMake build doesn't set `CMAKE_OSX_ARCHITECTURES`, so it
just builds whatever the CI runner's (or a dev machine's) native architecture is.

One piece of x86_64 infrastructure already exists and already works: `native-engine-bridge`
(`native-engine-bridge/CMakeLists.txt` hardcodes `CMAKE_OSX_ARCHITECTURES "x86_64"`) — but it's
a narrow, JUCE-plugin-identification-only build with no audio I/O, no real-time playback, no
CoreAudio device handling. It proves the *toolchain* can cross-compile x86_64 from an Apple
Silicon host; it says nothing about whether the *full* engine (real-time audio, plugin hosting,
IPC) does the same. That's the genuinely untested part, and the entire reason this test exists.

## Goal

Produce a one-off, unsigned, fully x86_64 `.app` (Electron shell + native engine + bridge, all
native Intel — not arm64-under-Rosetta) built entirely on Elling's own Apple Silicon dev machine,
with no CI involvement, no DMG, no signing/notarization. Transfer it to the Intel Mac at the
office, clear the quarantine flag, and find out whether it launches and actually plays audio.

## Non-goals

- **Not a permanent CI/release change.** `release.yml` and `electron-builder.yml` are untouched.
  A real Intel release (either by extending CI to cross-compile, or adding a real Intel runner)
  is a separate, later decision that depends on this test succeeding.
- **Not signed or notarized.** Explicitly skipped — `CSC_IDENTITY_AUTO_DISCOVERY=false` forces
  an unsigned build even though Elling's login keychain has a real Developer ID identity
  electron-builder would otherwise auto-discover. `xattr -cr` on the Intel Mac after transfer,
  same workaround already documented in the README for unsigned installs.
- **Not a DMG.** `electron-builder --dir` output only — zip the `.app` and transfer it directly.
- **Not vendoring rubberband for x64.** See below.

## Design

### What has to change vs. what doesn't

`native-engine-bridge` needs **no changes** — it already always builds x86_64 regardless of
host architecture. It just needs to exist locally (build it once, normally, if it hasn't been
built on this machine before).

`native-engine` (the real engine) is the one new piece of work: cross-compile it to x86_64 via
`-DCMAKE_OSX_ARCHITECTURES=x86_64`, into a fresh build directory (`native-engine/build-x64/`) so
the normal arm64 dev build in `native-engine/build/` (used by `npm run dev`) is untouched.

### Rubberband: skip vendoring entirely, don't fake it

`scripts/vendor-rubberband.sh` is CI-only and copies whatever `rubberband` binary is on PATH —
on Elling's arm64 machine, that's an arm64 binary. Bundling an arm64 rubberband into an x64 app
would be *worse* than bundling none: `rubberband.ts`'s `findRubberband()` checks the bundled
path first when `app.isPackaged`, so a wrong-arch bundled copy would be found and fail to
execute, rather than falling through to a working alternative. `findRubberband()` already has an
existing fallback for exactly this situation — "a local unsigned build that skipped the vendor
step" (its own doc comment) — checking Homebrew-style `CANDIDATE_PATHS` on PATH. So: omit the
rubberband `extraResources` entry entirely for this build. If Elling wants tempo-stretch to work
during testing, `brew install rubberband` directly on the Intel Mac — a completely native x86_64
Homebrew install there, zero cross-compilation involved.

### Packaging: a dynamically generated config override, not a static file

`electron-builder.yml`'s `extraResources` hardcodes `native-engine/build/...` (the arm64 path).
The initial design called for a small static override file passed via electron-builder's `-c`
flag containing just the changed `extraResources` entries — **this was wrong and was corrected
during implementation** after tracing electron-builder's actual config-loading code
(`app-builder-lib/out/packager.js` and `util/config/load.js`): when `-c` is given a file path,
electron-builder reads *only* that file as the entire config. It does **not** merge it with the
auto-detected `electron-builder.yml` at all — a small override containing just `extraResources`
would silently produce a config missing `appId`, `directories`, `afterPack`, `mac.category`, and
everything else the real config defines.

The corrected approach: `scripts/generate-x64-test-config.js` reads the real
`electron-builder.yml` at build time, parses it, and produces a **complete** config — everything
unchanged except `extraResources`, where the native-engine entry is repointed at
`native-engine/build-x64/...` and the rubberband entry is dropped (derived from the real
config's existing entries via filter/map, not hand-retyped, so it can't silently drift out of
sync if `electron-builder.yml` changes later) — written to a gitignored temp file
(`electron-builder.x64-test.generated.yml`) that the build script passes via `-c`.

### Orchestration script

`scripts/build-x64-test.sh` runs the whole sequence and fails fast with clear errors rather than
producing something broken that only fails later on the Intel Mac:

1. `cmake -B native-engine/build-x64 -DCMAKE_OSX_ARCHITECTURES=x86_64 native-engine`, then build
   it. First run costs the same ~10-15 min JUCE fetch+compile CI pays for a fresh build directory.
2. Verify the output binary is actually x86_64 (`file` + grep) — fail immediately, not after
   transfer, if the cross-compile silently didn't take.
3. Build `native-engine-bridge` if its output doesn't already exist (normal one-time step, no
   changes to how it's built).
4. `npx electron-vite build` (renderer/main bundle — plain JS/TS, arch-agnostic, no change).
5. `node scripts/generate-x64-test-config.js` to produce the temp config (see above).
6. `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 --dir -c
   electron-builder.x64-test.generated.yml`.
7. Sanity-check the packaged `.app`: confirm the bundled engine binary is x86_64, confirm the
   app is unsigned (`codesign -dvvv`), list `Contents/Resources` to confirm rubberband was *not*
   included and the other three resources were.

`native-engine/.gitignore` gains `build-x64/` (currently only ignores `build/`); the root
`.gitignore` gains `electron-builder.x64-test.generated.yml` (a build artifact, regenerated
every run, never committed).

### What `--x64` actually controls

Worth stating explicitly since it's easy to misread: `--x64` doesn't just affect what gets
copied into the bundle. `extraResources` are copied as-is regardless of arch — electron-builder
has no idea our custom native binaries even have an architecture. What `--x64` actually controls
is which Electron distribution (shell/Chromium/Node runtime) gets bundled — giving a genuinely
all-x86_64 app (Electron shell, native engine, and bridge all native Intel, not an arm64 shell
running a translated x64 subprocess).

**Correction, found during final review:** an earlier version of this doc claimed `--x64` also
triggers `@electron/rebuild` to recompile native Node addons (`better-sqlite3`) for the new
arch. That's not what happens in this repo: `electron-builder.yml` sets `npmRebuild: false`
(confirmed live in a real build's log: `skipped dependencies rebuild reason=npmRebuild is set to
false`), so no native-module rebuild step runs at all. `better-sqlite3` instead ships prebuilt
binaries for every platform/arch it supports (`darwin-x64.node`, `darwin-arm64.node`, etc., all
present under `app.asar.unpacked` in the packaged app) — the correct one is picked at runtime,
nothing is compiled at packaging time. Corrected here so a future debugging session doesn't
chase a rebuild-toolchain failure mode that isn't actually in play.

## Known risks — the actual point of this exercise

In rough order of how likely each was expected to be the thing that breaks:

1. **Does the full JUCE-based engine cross-compile correctly to x86_64?** The bridge only proves
   the toolchain handles a minimal, audio-I/O-free build. Real-time audio, CoreAudio device
   binding, and plugin hosting in the full engine were unverified going in. **Resolved:** it
   does. A real end-to-end run produced a packaged `.app` whose engine binary, bridge binary, and
   Electron shell are all confirmed `Mach-O 64-bit executable x86_64` — the packaging-level part
   of this risk is fully retired. Whether the engine actually *runs* correctly (real-time audio,
   CoreAudio device I/O) is still only verifiable on real Intel hardware — that's the one thing
   left for Elling's own walkthrough.
2. **Does `better-sqlite3` (a native C++ Node addon) need to cross-compile for x64?** Turned out
   to be a non-issue, not because cross-compilation succeeded but because it never happens:
   `electron-builder.yml` sets `npmRebuild: false`, so electron-builder never attempts a rebuild
   step at all (confirmed in a real build's log: `skipped dependencies rebuild reason=npmRebuild
   is set to false`). `better-sqlite3` instead ships prebuilt binaries for every platform/arch it
   supports, and the correct one is picked at runtime — see the correction under "What `--x64`
   actually controls" above. This was originally framed as a real risk; it wasn't one.
3. Everything else — unsigned launch via `xattr -cr`, rubberband's existing PATH fallback,
   Electron-to-engine IPC over a local socket — was either already-proven behavior (unsigned test
   builds already worked earlier this release, same mechanism) or architecture-agnostic, and
   nothing here surfaced any issue during the real run.

## Validating success

On the Intel Mac: does the app launch without a "damaged" Gatekeeper dialog (after `xattr -cr`);
does the native engine subprocess actually spawn and connect (timeline loads, transport
responds); does pressing play on the bundled demo rifff produce real audio output. That last
part is the one thing genuinely impossible to verify without hands on that hardware — which is
exactly why this test exists.

## Testing

No automated test coverage — this is a manual build script producing a manual-testing artifact,
not application logic. Verification is the script's own inline sanity checks (architecture,
signing status, resource contents) plus the real-hardware walkthrough above. `git diff` cleanly
shows the change is additive-only (two new files, one `.gitignore` line) — nothing in the real
build/release/signing pipeline is touched.

## Follow-up (not part of this work)

If the Intel Mac test succeeds, the natural next step is deciding between the two originally
discussed permanent-release approaches (cross-compile x64 in `release.yml`, vs. a real Intel CI
runner) — a separate brainstorming/design pass once there's a real result to design around.
