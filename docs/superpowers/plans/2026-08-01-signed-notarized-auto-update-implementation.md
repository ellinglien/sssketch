# Signed, Notarized Builds + Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Tasks 8-11 are manual/gated — see their own headers — and must NOT be executed unsupervised by a coding agent.**

**Goal:** Get ssstitch's macOS build properly code-signed, notarized, and auto-updating via GitHub Releases, with a CI pipeline that produces these builds from a tagged release.

**Architecture:** Fix the native engine's packaged-path resolution (currently dev-only, would fail for any real installed user), sign both the outer Electron app and the nested JUCE engine bundle (each needs its own entitlements, engine specifically needs `disable-library-validation` to load third-party VST3s), wire `electron-updater` against GitHub Releases, and automate the whole build/sign/notarize/publish sequence in a GitHub Actions workflow triggered on tag push.

**Tech Stack:** Electron, electron-builder, electron-updater, `@electron/notarize` (already a transitive dependency), GitHub Actions, JUCE/CMake (native engine).

---

**Full spec:** `docs/superpowers/specs/2026-08-01-signed-notarized-auto-update-design.md` — read it before starting; this plan implements it task by task.

**Sequencing (from the spec — do not skip ahead):** Tasks 1-7 are ordinary implementation work, buildable and verifiable today with no Apple credentials. Tasks 8-11 are manual/external-blocker-gated: Elling must complete Apple Developer Program enrollment before Task 9 can run, and Task 11 (the real first automated release) is explicitly gated on Tasks 8-10 all being done. **Do not write or modify any code in Task 11's target files (`electron-builder.yml`'s `notarize` field) until Tasks 8-10 are confirmed complete by Elling.**

**Renderer/shared/main verification commands:**
```bash
npm run typecheck
npm run lint
npx vitest run
```

**Native build command:** `cd native-engine && cmake -B build && cmake --build build`

---

### Task 1: Native engine packaged-path resolution

**Files:**
- Modify: `src/main/engineProcess.ts`

The native engine binary's path is currently resolved only for dev mode (relative to the source tree via `app.getAppPath()`). In a packaged app there is no `native-engine/build/` directory at all — this must branch on `app.isPackaged` and, when packaged, resolve via `process.resourcesPath` instead (where Task 6's `electron-builder.yml` change will have copied the engine bundle).

**No new unit test for this specific branch** — `src/main/engineProcess.test.ts` already has an explicit, commented precedent for *not* testing `defaultBinaryPath()`'s internals (it always injects `binaryPathOverride` instead, specifically to avoid needing a running or mocked Electron `app`). Forcing a test onto the new `app.isPackaged`/`process.resourcesPath` branch would fight that existing convention rather than follow it. The real verification for this branch is Task 7's manual packaged-build check below.

- [ ] **Step 1: Update `defaultBinaryPath()`**

```ts
function defaultBinaryPath(): string {
  // Packaged mode: the engine bundle ships as an extraResources copy (see
  // electron-builder.yml) under the app's own Resources directory, at a path
  // matching what that config copies it to.
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'native-engine/ssstitch-engine.app/Contents/MacOS/ssstitch-engine'
    )
  }

  // Dev-mode only — see this plan's scope note on packaging. app.getAppPath()
  // is the Electron app's root directory; native-engine/ lives alongside src/
  // at the repo root in dev mode.
  //
  // Path changed when native-engine's CMake target switched from
  // juce_add_console_app to juce_add_gui_app (needed for real plugin editor
  // windows, see PluginChain::openEditorWindow) — a GUI app target builds a
  // real .app bundle on macOS instead of a bare Mach-O binary, and (for this
  // JUCE version/generator combo, at least) drops the per-config "Debug/"
  // subdirectory the console-app target used to have. spawn() still just
  // execs the inner Mach-O binary directly; nothing about how the process is
  // launched or communicated with over IPC changes.
  return join(
    app.getAppPath(),
    'native-engine/build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine'
  )
}
```

- [ ] **Step 2: Run the full renderer/shared/main test suite to confirm nothing broke**

```bash
npx vitest run
```
Expected: same pass count as before this change (`engineProcess.test.ts`'s existing 3 tests still pass unchanged — they never exercise `defaultBinaryPath()`).

- [ ] **Step 3: Commit**

```bash
git add src/main/engineProcess.ts
git commit -m "Resolve the native engine binary path correctly in a packaged app"
```

---

### Task 2: Engine entitlements file

**Files:**
- Create: `build/entitlements.engine.plist`

The nested `ssstitch-engine.app` runs as its own OS process with its own code signature — it does not inherit the outer app's entitlements. It needs everything the outer app's `build/entitlements.mac.plist` already has, plus `com.apple.security.cs.disable-library-validation`: the engine loads third-party VST3 plugins at runtime (arbitrary vendor code, unsigned by Elling), which hardened runtime blocks by default without this entitlement.

- [ ] **Step 1: Create the file**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <!-- Required for loading third-party VST3 plugins (unsigned by us,
         arbitrary vendor code) at runtime -- hardened runtime blocks
         loading unsigned/differently-signed code without this. Not present
         on the OUTER app's own entitlements.mac.plist because the outer
         Electron process never loads plugin code itself; only this nested
         engine process does. -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
```

- [ ] **Step 2: Commit**

```bash
git add build/entitlements.engine.plist
git commit -m "Add entitlements file for the nested native engine bundle"
```

---

### Task 3: `afterSign` hook — sign the nested engine bundle

**Files:**
- Create: `build/afterSign.js`
- Modify: `electron-builder.yml`

Gatekeeper/notarization require every nested executable/bundle inside a signed `.app` to carry its own valid Developer ID signature — signing order matters (inside-out: nested bundle first, then the outer app). electron-builder supports an `afterSign` hook (runs after electron-builder's own outer-app signing) for exactly this kind of extra step, but since signing ORDER matters here and we need the nested bundle signed with its own distinct entitlements *before* the outer app's signature is finalized, this hook does the nested signing itself explicitly rather than relying on electron-builder's own signing pass to reach into `extraResources` correctly on its own.

- [ ] **Step 1: Create the hook script**

```js
// build/afterSign.js
const { execFileSync } = require('node:child_process')
const path = require('node:path')

// Signs the nested ssstitch-engine.app bundle (the native JUCE audio engine,
// copied into the outer Electron app's Resources/ dir -- see
// electron-builder.yml's extraResources) with its own entitlements. Gatekeeper
// and notarization both require every nested executable/bundle to carry a
// valid Developer ID signature of its own -- see
// docs/superpowers/specs/2026-08-01-signed-notarized-auto-update-design.md's
// "Code signing + entitlements" section for the full rationale, including why
// the engine needs com.apple.security.cs.disable-library-validation (loading
// third-party VST3 plugins at runtime) that the outer app's own entitlements
// don't have.
//
// Runs as electron-builder's afterSign hook. CSC_NAME must be the exact
// Developer ID Application identity string (e.g. "Developer ID Application:
// Elling Lien (TEAMID)") -- set as an env var alongside electron-builder's
// own CSC_LINK/CSC_KEY_PASSWORD signing vars.
//
// Skips gracefully (not an error) when CSC_NAME isn't set, so an unsigned
// local `--dir` build (see Task 7) doesn't require signing credentials that
// don't exist yet.
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const identity = process.env.CSC_NAME
  if (!identity) {
    console.log('afterSign: CSC_NAME not set, skipping engine signing (unsigned/local build)')
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const enginePath = path.join(appPath, 'Contents/Resources/native-engine/ssstitch-engine.app')
  const entitlementsPath = path.join(__dirname, 'entitlements.engine.plist')

  console.log(`afterSign: signing nested engine bundle at ${enginePath}`)
  execFileSync(
    'codesign',
    [
      '--deep',
      '--force',
      '--options',
      'runtime',
      '--entitlements',
      entitlementsPath,
      '--sign',
      identity,
      enginePath
    ],
    { stdio: 'inherit' }
  )
}
```

- [ ] **Step 2: Wire the hook into `electron-builder.yml`**

Add `afterSign: build/afterSign.js` at the top level (alongside `directories`, `files`, etc.):

```yaml
appId: com.ellinglien.ssstitch
productName: ssstitch
directories:
  buildResources: build
afterSign: build/afterSign.js
files:
```
(Insert the `afterSign:` line right after `directories:`'s block, before `files:` — exact placement among top-level keys doesn't matter to electron-builder, but keep it near the top for visibility.)

- [ ] **Step 3: Commit**

```bash
git add build/afterSign.js electron-builder.yml
git commit -m "Add afterSign hook to codesign the nested native engine bundle"
```

---

### Task 4: Bundle the native engine into the packaged app

**Files:**
- Modify: `electron-builder.yml`

The engine bundle needs to actually ship inside the packaged app for Task 1's packaged-path resolution (and Task 3's `afterSign` hook) to find anything at all.

- [ ] **Step 1: Add an `extraResources` entry**

```yaml
extraResources:
  - from: native-engine/build/ssstitch_engine_artefacts/ssstitch-engine.app
    to: native-engine/ssstitch-engine.app
```

Add this as a new top-level key (alongside the existing `asarUnpack: - resources/**`).

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "Bundle the native engine app into the packaged app's resources"
```

---

### Task 5: `electron-updater` — dependency + wiring

**Files:**
- Modify: `package.json`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the dependency**

```bash
npm install electron-updater
```
Confirm it lands under `"dependencies"` (not `"devDependencies"`) in `package.json` — it needs to run in the packaged app, not just during development.

- [ ] **Step 2: Wire the update check into `src/main/index.ts`**

Add the import alongside the existing top-of-file imports:

```ts
import { autoUpdater } from 'electron-updater'
```

Add the check right after `createWindow()` is called (currently the line right before the `playbackEngine.client` position-update-relay comment block):

```ts
  createWindow()

  // Only in a packaged (production) build -- never in dev, where there's no
  // meaningful "newer published release" to check against, and running it
  // unconditionally would just spam electron-updater's own network calls +
  // logging on every dev-server restart for no benefit. Failure here (no
  // network, no releases published yet, etc.) must never be fatal to the
  // rest of the app -- it's a background convenience check, not a
  // load-bearing startup step.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.error('index: auto-update check failed', err)
    })
  }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors (electron-updater ships its own TypeScript types).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/main/index.ts
git commit -m "Add electron-updater and check for updates on launch in packaged builds"
```

---

### Task 6: Publish config + CI workflow

**Files:**
- Modify: `electron-builder.yml`
- Create: `.github/workflows/release.yml`

**Note:** this task writes and commits the CI workflow file, but per this plan's own sequencing note at the top, its first real (tag-triggered, secrets-populated) run must wait for Task 11. Committing it now is safe — with no `v*` tag pushed, and no secrets configured yet, it simply never runs.

- [ ] **Step 1: Update the `publish` block in `electron-builder.yml`**

Replace the existing placeholder:
```yaml
publish:
  provider: generic
  url: https://example.com/auto-updates
```
with:
```yaml
publish:
  provider: github
  owner: ellinglien
  repo: ssstitch
```

- [ ] **Step 2: Create the workflow file**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

# Needed for electron-builder's github publish provider to create a Release
# and upload artifacts using the automatically-provided GITHUB_TOKEN, with no
# separate PAT secret required.
permissions:
  contents: write

jobs:
  release:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      # JUCE (fetched via CMake's FetchContent, pinned to git tag 8.0.4 in
      # native-engine/CMakeLists.txt) takes 10-15 minutes to fetch+build from
      # scratch -- this cache keeps that a one-time cost per JUCE version /
      # native-engine source change, not a per-release cost.
      - name: Cache native engine build
        uses: actions/cache@v4
        with:
          path: native-engine/build
          key: native-engine-${{ runner.os }}-juce-8.0.4-${{ hashFiles('native-engine/CMakeLists.txt', 'native-engine/Source/**') }}

      - name: Build native engine
        working-directory: native-engine
        run: |
          cmake -B build
          cmake --build build --config Release

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npx vitest run

      # electron-builder handles CSC_LINK (base64-encoded .p12)/CSC_KEY_PASSWORD
      # itself -- imports into a temporary keychain internally, no manual
      # `security import`/keychain scripting needed here. CSC_NAME selects
      # which identity to use (also read directly by build/afterSign.js for
      # signing the nested engine bundle -- see Task 3). notarize: true in
      # electron-builder.yml (set in Task 11, NOT this task) is what actually
      # triggers notarization using the APPLE_* vars below.
      - name: Build, sign, notarize, and publish
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          CSC_NAME: ${{ secrets.CSC_NAME }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx electron-vite build
          npx electron-builder --mac --publish always
```

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml .github/workflows/release.yml
git commit -m "Add GitHub Actions release workflow and switch publish config to GitHub Releases"
```

---

### Task 7: Local verification — packaged app spawns the engine correctly

**Files:** none (verification only)

This is the real test for Task 1's packaged-path branch and Task 4's bundling — an unsigned, unpublished local build (`electron-builder --mac --dir` skips signing/notarization/publishing entirely, just produces a runnable packaged `.app`).

- [ ] **Step 1: Build the native engine**

```bash
cd native-engine && cmake -B build && cmake --build build
```

- [ ] **Step 2: Build and package (unsigned, local only)**

```bash
cd /Users/nickel/Claudecode/ssstitch
npx electron-vite build
npx electron-builder --mac --dir
```
Expected: succeeds, producing `dist/mac-arm64/ssstitch.app` (exact path may vary slightly by electron-builder version — check the command's own output for where it wrote the app).

- [ ] **Step 3: Confirm the engine bundle actually landed inside the packaged app**

```bash
ls "dist/mac-arm64/ssstitch.app/Contents/Resources/native-engine/ssstitch-engine.app/Contents/MacOS/ssstitch-engine"
```
Expected: the file exists (confirms Task 4's `extraResources` config worked).

- [ ] **Step 4: Launch the packaged app and confirm live playback works**

```bash
open "dist/mac-arm64/ssstitch.app"
```
Manually: import a rifff, place it on the timeline, hit play, confirm audio plays. This proves Task 1's `app.isPackaged` branch correctly resolves the bundled engine's path (not the dev-mode path, which wouldn't exist inside this packaged app at all).

- [ ] **Step 5: Confirm a real VST3 plugin still loads inside the packaged build**

Using the master chain panel (from this session's earlier plugin-chain work), load a real installed plugin into a slot and confirm its status dot goes green (loaded) rather than red (error). This is the packaged-build equivalent of this session's earlier dev-mode plugin verification — same feature, now proven to work from inside a `.app` bundle rather than a bare dev-mode binary.

- [ ] **Step 6: Report results**

No commit for this task (verification only) — report what passed/failed. If Step 3, 4, or 5 fails, stop and diagnose before proceeding to any later task — those depend on this packaging actually working.

---

### Task 8: MANUAL — Apple Developer Program enrollment + certificate generation

**This task is not for a coding agent to execute.** It requires Elling's own Apple ID, payment, and Apple's own identity-verification process (which can take anywhere from minutes to a few days). Claude's role here is to walk through this interactively with Elling when he's ready to start — this plan entry exists as the checklist to work from together, not as something to run unsupervised.

**Checklist (work through with Elling, in order):**

1. Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/enroll/) ($99/yr) using Elling's own Apple ID. Apple's review can take a few hours to a few days.
2. Once approved, generate a **Developer ID Application** certificate — either via Xcode (Preferences → Accounts → Manage Certificates → `+` → Developer ID Application) or manually via the developer portal's Certificates page (requires generating a Certificate Signing Request in Keychain Access first).
3. In Keychain Access, locate the new certificate + its private key, select both, right-click → Export 2 items, save as a `.p12` file with a password Elling chooses (this becomes `CSC_KEY_PASSWORD`).
4. Base64-encode the `.p12` for use as a GitHub Actions secret:
   ```bash
   base64 -i /path/to/certificate.p12 | pbcopy
   ```
   This clipboard content becomes the `CSC_LINK` secret value.
5. Note the exact certificate identity string (visible in Keychain Access under the certificate's name, format `Developer ID Application: <Name> (<TEAMID>)`) — this becomes `CSC_NAME`.
6. Note the Apple Team ID (visible on the developer portal's Membership page) — this becomes `APPLE_TEAM_ID`.
7. Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com) (Sign-In and Security → App-Specific Passwords) — **not** Elling's real Apple ID password. This becomes `APPLE_APP_SPECIFIC_PASSWORD`. `APPLE_ID` is just Elling's Apple ID email itself.

**Do not add these as GitHub Actions secrets yet** — that happens in Task 11, after Tasks 9 and 10 confirm the whole chain actually works. For now, keep them somewhere safe locally (a password manager, not committed anywhere).

---

### Task 9: MANUAL — one local sign + notarize dry run

**This task is not for a coding agent to execute unsupervised.** It requires the real Apple credentials from Task 8, run locally on Elling's own Mac. Claude can run the commands *with* Elling present to interpret output/errors, but this must not run automatically or unattended, and must not run before Task 8 is confirmed done.

Purpose: prove the certificate, the nested-engine-bundle signing order (Task 3's `afterSign` hook), and Apple's actual notarization response all work — once, locally, where failures are far easier to debug than inside a CI log.

- [ ] **Step 1: Set the signing/notarization environment variables** (from Task 8's checklist)

```bash
export CSC_LINK=/path/to/certificate.p12   # a local file path works here too, not just base64
export CSC_KEY_PASSWORD='<the password chosen when exporting the .p12>'
export CSC_NAME='Developer ID Application: <Name> (<TEAMID>)'
export APPLE_ID='<elling's apple id email>'
export APPLE_APP_SPECIFIC_PASSWORD='<app-specific password>'
export APPLE_TEAM_ID='<team id>'
```

- [ ] **Step 2: Temporarily enable notarization for this local run**

`electron-builder.yml` still has `notarize: false` at this point (Task 11 hasn't run yet). For this one dry run only, edit it locally to `notarize: true` — **do not commit this change**; it gets reverted (or Task 11 makes the same change permanently, superseding this temporary edit).

- [ ] **Step 3: Build, sign, and notarize (no publish)**

```bash
cd native-engine && cmake -B build && cmake --build build && cd ..
npx electron-vite build
npx electron-builder --mac
```
This can take several minutes longer than usual — the notarization submission itself waits on Apple's response. Watch the output for electron-builder's own notarization log lines.

- [ ] **Step 4: Verify the result**

```bash
xcrun stapler validate dist/ssstitch-*.dmg
spctl -a -vv --type install dist/ssstitch-*.dmg
```
Expected: both report success/accepted, with no "rejected"/"a sealed resource is missing or invalid" type errors. `spctl`'s output should mention the Developer ID identity, not "no usable signature."

- [ ] **Step 5: Confirm the packaged, signed app still works**

Mount the `.dmg`, drag to Applications (or run in place), launch it. Confirm: no Gatekeeper "unidentified developer" warning, live playback works, a real VST3 plugin still loads (same checks as Task 7, now against the signed build).

- [ ] **Step 6: If notarization is rejected**

```bash
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"
```
(electron-builder prints the submission ID in its own output.) The most likely failure given this app's own architecture is something in the nested engine bundle's signature — re-check Task 3's `afterSign.js` actually ran (its `console.log` line should appear in the build output) and that the entitlements path/identity resolved correctly.

- [ ] **Step 7: Revert the local `notarize: true` edit from Step 2**

```bash
git diff electron-builder.yml
git checkout electron-builder.yml
```
Confirms the repo goes back to `notarize: false` — Task 11 makes this change for real, permanently, later.

- [ ] **Step 8: Report results to confirm before proceeding**

Report whether the dry run succeeded, and if it didn't, what Step 6's log showed — do not proceed to Task 10 or 11 until this dry run is genuinely clean.

---

### Task 10: MANUAL — flip the repo from private to public

**This task is not for a coding agent to execute unsupervised.** Making a repo public is effectively one-way (anyone who cloned it during the brief public window keeps their copy even if flipped back) and exposes the full commit history — this needs Elling's explicit, informed go-ahead at the moment it happens, not a step a script runs silently.

- [ ] **Step 1: Scan history for anything that shouldn't become public**

```bash
git log --all -p | grep -inE "api[_-]?key|secret|password|token|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|-----BEGIN"
```
Also specifically check for anything related to the LORE warehouse credentials/paths (`src/main/loreWarehouse.ts` and related config) and any `.env`-style values that might have been committed at some point despite `.gitignore`:
```bash
git log --all --diff-filter=A --name-only | grep -iE "\.env|credential|secret" | sort -u
```
Review any hits by hand (`git log --all -p -- <path>` for that specific file) before proceeding. If anything sensitive is found, it needs to be scrubbed from history (a separate, careful task of its own — do not proceed with making the repo public until this is resolved) rather than just deleted in a new commit (which leaves it in history).

- [ ] **Step 2: Flip visibility**

Via GitHub's UI (Settings → General → Danger Zone → Change visibility → Make public) or:
```bash
gh repo edit ellinglien/ssstitch --visibility public --accept-visibility-change-consequences
```

- [ ] **Step 3: Confirm**

```bash
gh repo view ellinglien/ssstitch --json isPrivate,visibility
```
Expected: `"isPrivate": false, "visibility": "PUBLIC"`.

- [ ] **Step 4: Report completion**

No code changes, no commit — just confirm this is done before Task 11 proceeds.

---

### Task 11: MANUAL/GATED — real notarization config + first automated release

**This task is not for a coding agent to execute unsupervised, and must not start until Tasks 8, 9, and 10 are all confirmed complete.** This is the point where the pipeline goes live for real — get explicit confirmation from Elling immediately before pushing the tag in Step 4.

- [ ] **Step 1: Flip `electron-builder.yml`'s notarize config for real**

```yaml
mac:
  category: public.app-category.music
  target:
    - target: dmg
      arch:
        - arm64
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    - NSCameraUsageDescription: Application requests access to the device's camera.
    - NSMicrophoneUsageDescription: Application requests access to the device's microphone.
    - NSDocumentsFolderUsageDescription: Application requests access to the user's Documents folder.
    - NSDownloadsFolderUsageDescription: Application requests access to the user's Downloads folder.
  notarize: true
```
(Only the `notarize:` line changes, from `false` to `true` — everything else in this block stays as-is.)

- [ ] **Step 2: Add the 6 signing/notarization secrets to the GitHub repo**

Via GitHub's UI (Settings → Secrets and variables → Actions → New repository secret) or `gh secret set <NAME>` for each of: `CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_NAME`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — using the values gathered in Task 8's checklist. (`GH_TOKEN`/`GITHUB_TOKEN` needs no manual setup — GitHub Actions provides it automatically, per Task 6's workflow already using `secrets.GITHUB_TOKEN`.)

- [ ] **Step 3: Commit the `notarize: true` change**

```bash
git add electron-builder.yml
git commit -m "Enable real notarization now that signing credentials are configured"
git push
```

- [ ] **Step 4: Confirm with Elling, then push the first real release tag**

```bash
git tag v1.1.0
git push origin v1.1.0
```
(Bump the version number to whatever's actually next for the project — check `package.json`'s current `"version"` first and confirm with Elling.)

- [ ] **Step 5: Watch the GitHub Actions run**

`gh run watch` or the Actions tab in the GitHub UI. Expect ~15-20 minutes total (JUCE build if the cache misses, full test suite, sign, notarize, publish).

- [ ] **Step 6: Verify the published release**

1. Confirm a new GitHub Release exists at `github.com/ellinglien/ssstitch/releases` with the `.dmg` and `latest-mac.yml` attached.
2. Download the `.dmg` fresh (simulating a real user), confirm Gatekeeper shows no warning on a clean install.
3. If a previous version is already installed on a test machine, confirm `electron-updater` detects this new version on next launch and offers to update.

- [ ] **Step 7: Report completion**

This is the last task in the plan — report the final state (release URL, verification results) once done.
