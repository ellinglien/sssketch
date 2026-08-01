# Signed, Notarized Builds + Auto-Update — Design

**Goal:** Get ssstitch ready for real external distribution: a properly code-signed and notarized macOS build (so Gatekeeper doesn't block it for people who aren't Elling), automatic update checks so users stay current without manually re-downloading, and a repeatable CI pipeline that produces these builds from a tagged release.

**Motivation:** ssstitch is moving from "Elling's own tool" to something real Endlesss users might install. That means the app needs to look and behave like production software — no "unidentified developer" warning on first launch, no manual update-checking, no hand-built releases.

**Scope:** macOS only for this pass (matches the dev environment and the only platform currently exercised). Windows/Linux code signing is explicitly out of scope — `electron-builder.yml` already configures those targets but they ship unsigned, unchanged from today.

---

## Prerequisite: Apple Developer Program enrollment

Notarization requires an active Apple Developer Program membership ($99/yr) — Elling is not currently enrolled. This blocks the *last* real step of this work (an actual signed/notarized build hitting Apple's notary service), but not the surrounding infrastructure: the native-engine packaging fix, entitlements, `electron-updater` wiring, and the CI workflow can all be built and verified (in unsigned/dry-run form) before enrollment clears. Once it does, Elling and Claude will walk through cert generation together (Apple's developer portal + Keychain Access on Elling's Mac — not something automatable remotely).

---

## Architecture

### 1. Native engine packaging + path resolution (prerequisite to everything else)

`src/main/engineProcess.ts` currently resolves the JUCE binary via a path hardcoded relative to the source tree:
```
native-engine/build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine
```
This folder doesn't exist inside a packaged app at all — today, a real installed build would fail to spawn the engine entirely, independent of signing. This is a pre-existing gap, not something introduced by this work, but it must be fixed for any of the rest of this design to matter.

**Fix:**
- `electron-builder.yml` gets an `extraResources` entry copying the built `ssstitch-engine.app` bundle into the packaged app (e.g. under `Contents/Resources/native-engine/`).
- `engineProcess.ts`'s binary path resolution branches on `app.isPackaged`: packaged mode resolves via `process.resourcesPath` + the same relative bundle path; dev mode keeps today's behavior (relative to the source tree) completely unchanged.
- Both the local build scripts (`build:mac`/`dist:mac`) and the new CI workflow must build the native engine (`cmake --build`) *before* running `electron-builder`, so the bundle exists to copy at packaging time.

### 2. Code signing + entitlements

Two independent signing targets — the engine runs as its own separate OS process (not inside Electron's own process), so it has its own code signature and its own entitlements, not inherited from the outer app.

**Outer Electron app:** signed with Elling's Developer ID Application certificate, hardened runtime on, using the existing `build/entitlements.mac.plist` (`allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables` — needed by Electron's own renderer/GPU process). No changes needed to this file.

**Nested `ssstitch-engine.app`:** gets a new `build/entitlements.engine.plist`, containing the same base entitlements plus `com.apple.security.cs.disable-library-validation`. This is the critical, ssstitch-specific gotcha: the engine loads third-party VST3 plugins at runtime (this session's whole plugin-chain feature) — those are unsigned-by-Elling, arbitrary vendor binaries. Hardened runtime blocks loading unsigned/differently-signed code by default; without this entitlement, a notarized build would silently break every plugin the app can host.

**Signing order:** an `afterSign` hook in `electron-builder.yml` explicitly `codesign`s the nested `ssstitch-engine.app` (with its own entitlements, hardened runtime) *before* electron-builder signs the outer app — inside-out, matching how nested code signatures must be constructed. Done as an explicit script rather than relying on electron-builder's implicit nested-binary scanning, since a silent gap here only surfaces later as an opaque Gatekeeper/notarization rejection.

Signing credentials (Developer ID Application cert + private key, as a base64-encoded `.p12`) live as GitHub Actions secrets for CI, and in Elling's local keychain for the one manual dry-run described below.

### 3. Notarization

`electron-builder.yml`'s `mac.notarize: false` becomes a real config once Elling's enrollment clears. electron-builder's built-in notarization support (via `@electron/notarize`, already a transitive dependency — no new package needed) reads three environment variables: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (generated at appleid.apple.com, not the real Apple ID password), and `APPLE_TEAM_ID`. Same three values whether run locally (dry run) or from CI.

Notarization submits the signed `.dmg` to Apple's notary service, waits for approval, then staples the resulting ticket to the app so Gatekeeper can verify it offline afterward. If the nested-binary signing from step 2 is wrong, this is the step where it surfaces — as a specific rejection reason in Apple's notary log (e.g. "the signature does not include a secure timestamp" or "not signed with a valid Developer ID" for the nested binary specifically).

### 4. Auto-update

Add `electron-updater` as a dependency. In `src/main/index.ts`, once the window is created and only when `app.isPackaged` (never in dev), call `autoUpdater.checkForUpdatesAndNotify()` — checks the configured provider, downloads silently in the background if a newer version exists, and uses electron-updater's own default dialog to prompt the user to restart and install once the download finishes. No custom update UI for this pass.

`electron-builder.yml`'s `publish` block changes from today's placeholder (`provider: generic`, `url: https://example.com/auto-updates`) to:
```yaml
publish:
  provider: github
  owner: ellinglien
  repo: ssstitch
```
This same config is what `electron-builder --publish always` (invoked from CI) uses to create/attach artifacts to a GitHub Release from a pushed tag.

Auto-update itself only becomes meaningfully testable once notarization is live — a real signed build is what installed users are actually running, and what `electron-updater` checks against.

### 5. Repo visibility

`ellinglien/ssstitch` is currently a private GitHub repo. `electron-updater` against GitHub Releases needs a public repo (or an embedded access token, which isn't appropriate for something distributed to strangers — a token baked into a shipped binary is extractable). Elling has chosen to make the repo public.

This is a real, one-way-feeling action (full commit history becomes visible) — executed as its own explicit, confirmed step during implementation, with a last look through history first for anything that shouldn't be public (credentials, personal file paths, etc.), not silently bundled into an automated script.

### 6. CI/CD (GitHub Actions)

New `.github/workflows/release.yml`, triggered on pushing a tag matching `v*` (e.g. `v1.1.0`), running on `macos-latest`:

1. Checkout, `npm ci`
2. Build the native engine (`cmake --build` inside `native-engine/`) — first run fetches JUCE via CMake's `FetchContent`, so this step is slow (10-15 minutes) the first time; the workflow caches the CMake build directory keyed on JUCE's pinned git tag to keep subsequent runs fast
3. `npm run typecheck && npm run lint && npx vitest run` — the pipeline refuses to publish a build that fails the existing test suite
4. Import the signing certificate into a temporary keychain (from the base64-encoded secret)
5. `electron-builder --mac --publish always`, with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` / `GH_TOKEN` supplied as env — builds, signs (including the `afterSign` nested-binary step), notarizes, and publishes to the GitHub Release in one command

This workflow is written and committed as part of this work, but its first real (non-dry-run) trigger waits until the manual dry-run below has proven the signing/notarization chain actually works end to end — see "Sequencing" below.

---

## Error handling

- **CI build/test/sign/notarize failure at any step:** the workflow stops before publishing — no half-signed, unnotarized, or test-failing build ever reaches a GitHub Release.
- **Notarization rejected by Apple:** surfaces in the Actions log with Apple's specific reason. Exactly the failure class the manual dry-run (below) is meant to catch first, in an environment with better debugging access than CI logs alone.
- **Auto-update download/install failure** (flaky network, etc.): `electron-updater` fails silently in the background by default — the app keeps running on its current version, no crash, no blocking dialog. A user always has the fallback of downloading the latest `.dmg` from the GitHub Releases page directly.

## Sequencing

1. Native engine packaging + path fix, entitlements files, `afterSign` hook, `electron-updater` wiring, CI workflow file — all written and committed now. Verifiable today via `electron-builder --mac --dir` (unsigned, unpublished local build) to confirm the packaged app actually spawns the native engine correctly.
2. Elling completes Apple Developer Program enrollment (external, Claude assists with the walkthrough once started).
3. **One manual local sign + notarize dry run** (`dist:mac` extended with signing/notarization env vars, run by hand, not via CI) — proves the cert, the nested-binary signing order, and Apple's actual notarization response before ever trusting an unattended CI pipeline with it.
4. Repo flips public (explicit, confirmed step, with a history sanity check first).
5. `electron-builder.yml`'s `notarize: false` → real config; CI workflow's first real tag-triggered run.

## Testing

- **Now, without Apple credentials:** packaged-app native-engine spawn (via `--dir` local build, unsigned), CI workflow syntax/steps up through the point real signing would begin, `electron-updater` wiring compiles and the dev-mode skip works correctly (no update check attempted outside a packaged build).
- **Once enrollment clears:** the manual dry-run is the real end-to-end test — signed, notarized, stapled `.dmg` that Gatekeeper accepts with no warning on a clean Mac, engine spawns and loads a real VST3 plugin correctly inside the signed/notarized bundle.
- **After the repo goes public and CI runs for real:** a second machine (or a clean user account) installing the published `.dmg` and confirming `electron-updater` detects a subsequent version bump.
