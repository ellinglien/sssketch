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

### Packaging: local config override, not a change to electron-builder.yml

`electron-builder.yml`'s `extraResources` hardcodes `native-engine/build/...` (the arm64 path).
Rather than edit that file (it's the real release config), a new local-only override file,
`electron-builder.x64-test.yml`, is passed via electron-builder's `-c` flag. It fully restates
`mac.extraResources` (not a partial patch — array-valued config keys in electron-builder are not
guaranteed to deep-merge across multiple `-c` files, so this file lists all resource entries
explicitly rather than relying on merge semantics): the native-engine entry points at
`native-engine/build-x64/...` instead of the arm64 path; the native-engine-bridge and
`demo-rifff` entries are carried over unchanged; the rubberband entry is dropped per above.

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
5. `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 --dir -c
   electron-builder.x64-test.yml`.
6. Sanity-check the packaged `.app`: confirm the bundled engine binary is x86_64, confirm the
   app is unsigned (`codesign -dvvv`), list `Contents/Resources` to confirm rubberband was *not*
   included and the other three resources were.

`native-engine/.gitignore` gains `build-x64/` (currently only ignores `build/`).

### What `--x64` actually controls

Worth stating explicitly since it's easy to misread: `--x64` doesn't just affect what gets
copied into the bundle. `extraResources` are copied as-is regardless of arch — electron-builder
has no idea our custom native binaries even have an architecture. What `--x64` actually controls
is which Electron distribution (shell/Chromium/Node runtime) gets bundled, and it triggers
`@electron/rebuild` to rebuild native Node addons (`better-sqlite3`) against that Electron
build's ABI/arch. So the result is a genuinely all-x86_64 app — Electron shell, native engine,
and bridge all native Intel — not an arm64 shell running a translated x64 subprocess.

## Known risks — the actual point of this exercise

In rough order of how likely each is to be the thing that breaks:

1. **Does the full JUCE-based engine cross-compile correctly to x86_64?** The bridge only proves
   the toolchain handles a minimal, audio-I/O-free build. Real-time audio, CoreAudio device
   binding, and plugin hosting in the full engine are unverified. The script's `file` check
   catches "cross-compile silently no-opped and produced arm64 anyway"; it cannot catch deeper
   runtime issues that only surface on real Intel hardware.
2. **Does `better-sqlite3` (a native C++ Node addon) cross-compile for x64 via
   `@electron/rebuild`, invoked by electron-builder on an arm64 host?** Unverified. If this
   fails, it fails loudly during packaging on Elling's own machine — visible immediately, not
   discovered later on the Intel Mac.
3. Everything else — unsigned launch via `xattr -cr`, rubberband's existing PATH fallback,
   Electron-to-engine IPC over a local socket — is either already-proven behavior (unsigned test
   builds already worked earlier this release, same mechanism) or architecture-agnostic.

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
