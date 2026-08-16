# Auto-Update — Design

**Status:** Approved by Elling, ready for implementation planning.

## Goal

sssketch checks for new releases on its own, and when one's found, asks the user to confirm before downloading and installing it — for every install (Elling plus all beta testers), not just Elling's own dev machine.

## Background

`electron-updater` is already a dependency, and `src/main/index.ts` already calls `autoUpdater.checkForUpdatesAndNotify()` once at startup, in a packaged build only:

```typescript
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.error('index: auto-update check failed', err)
    })
  }
```

This is currently **non-functional and the wrong behavior**, for two independent reasons:

1. `electron-builder.yml`'s mac `target` list is `[dmg]` only. macOS auto-update (Squirrel.Mac, which `electron-updater` wraps) applies updates from a **zip** of the app bundle, not a DMG — without one, there's nothing for `autoUpdater` to actually download and apply, regardless of whether it finds a newer version.
2. `checkForUpdatesAndNotify()` is electron-updater's "auto-download in the background, then show a native OS notification when ready to restart" convenience method. Elling explicitly wants the opposite: check silently, but never download or install anything without an explicit confirm.

`electron-builder.yml`'s `publish` block is already correctly configured (`provider: github`, `owner: ellinglien`, `repo: sssketch`), and the release CI (`.github/workflows/release.yml`) already runs `electron-builder --mac --publish always`, which uploads build artifacts directly to the GitHub release for the tag during the build step — this is why release assets already appear without any separate manual upload step (confirmed this session while verifying v1.1.15/v1.1.16 assets). Adding `zip` to the mac target list means a zip artifact gets published the same automatic way as the existing DMGs; no CI workflow changes are needed.

## Scope decisions (Elling's explicit answers)

- **Who:** everyone — every install (Elling's and every beta tester's) checks and can self-update, not just a dev-only path.
- **Behavior:** ask first, then install. Never download anything without an explicit confirm click.
- **Install timing:** immediate. Once the download finishes, the app quits and relaunches itself right away — not deferred to the next time the user happens to quit on their own.

## Architecture

**Main process** owns `autoUpdater`, with `autoUpdater.autoDownload = false` set explicitly (overriding electron-updater's own default of `true`, which is what made the old `checkForUpdatesAndNotify()` call silently download in the background).

**Check cadence:** once on startup (same `app.isPackaged` guard the existing stub already has — never runs in dev, where there's no meaningful "newer published release" to check against), and then every 4 hours for as long as the app stays open, via a `setInterval` in the same startup code path. The periodic timer must skip its own `checkForUpdates()` call whenever the current state isn't `idle` (i.e. an update is already known-available, downloading, or installing) — otherwise a 4-hour tick landing while the user is mid-download (or has an "available" dialog sitting unanswered) would kick off a redundant overlapping check. No manual "check for updates" menu entry — out of scope for this design (see Non-goals).

**State machine**, driven entirely by `autoUpdater`'s own events, mirrored into renderer state over IPC:

- `idle` — nothing to report (starting state, and after "later" is dismissed).
- `available` — `update-available` fired; renderer shows the dialog with the new version number and "update now" / "later" buttons. `autoDownload` is off, so nothing downloads yet.
- `downloading` — user clicked "update now"; `autoUpdater.downloadUpdate()` was called. `download-progress` events (0–100, via `progress.percent`) update a progress bar in the same dialog.
- `installing` — `update-downloaded` fired; `autoUpdater.quitAndInstall()` is called immediately. Dialog copy switches to indicate the app is about to restart (there's a brief real-world gap between calling `quitAndInstall()` and the process actually exiting).
- `error` — any `error` event from `autoUpdater`, at any stage (check, download, or otherwise). Dialog shows a short message and a dismiss button; never fatal to the running app, matching the existing stub's own "background convenience check, not a load-bearing startup step" comment. Returns to `idle` on dismiss.

**IPC surface** (new channels, following this codebase's existing kebab-case-channel/camelCase-bridge-method convention):

- Main → renderer, one-way `send` (not `invoke`, since these are push events, not main-initiated-by-renderer requests): `update-state-changed`, payload `{ state: 'idle' | 'available' | 'downloading' | 'installing' | 'error', version?: string, percent?: number, error?: string }` — one consolidated event carrying the full current state, rather than one event per state, so the renderer never has to reconcile partial updates out of order.
- Renderer → main, `invoke`: `update-confirm-install` (user clicked "update now" — triggers `downloadUpdate()`), `update-dismiss` (user clicked "later" or dismissed an error — resets to `idle`, no engine-side effect since nothing was downloading yet in the "later" case, and dismissing an error is purely a UI reset).

**Preload bridge** additions to `window.rifffApi`, matching the existing bridge's shape: `onUpdateStateChanged(callback)` (returns an unsubscribe function, same convention as `onCaptureLevelUpdate` etc.), `confirmUpdateInstall()`, `dismissUpdate()`.

**Renderer UI:** a new `UpdateAvailableDialog.tsx`, mounted once, unconditionally, from `App.tsx` — same convention as `UnsavedChangesDialog.tsx`. Visible only when state isn't `idle`. Design-system-compliant: sharp corners (no `border-radius`), monochrome shell, Silkscreen font, lowercase copy, no emoji/exclamation marks. Content per state:
- `available`: "a new version of sssketch is available (v{version}) — update now?" with "update now" / "later" buttons.
- `downloading`: "downloading update... {percent}%" with a plain filled-bar progress indicator (no percentage-based color, consistent with this app's "color only for audio info" rule — a single neutral/accent fill bar is fine here, matching the VU meter's own established fill-bar pattern from earlier this session).
- `installing`: "installing update — sssketch will restart in a moment."
- `error`: "update failed: {error}" with a "dismiss" button.

## Build change

`electron-builder.yml`'s mac `target` list:

```yaml
  target:
    - dmg
```

becomes:

```yaml
  target:
    - dmg
    - zip
```

The existing `defaultArch: arm64` comment's reasoning (unsuffixed arm64 filenames) already covers both targets equally — `expandArtifactNamePattern`'s arch-suffix logic isn't target-specific, so this needs no additional config beyond adding `zip` to the list. No change needed to `.github/workflows/release.yml`'s `--publish always` invocation — it already builds and publishes whatever targets `electron-builder.yml` specifies.

## Error handling

Every `autoUpdater` event handler wraps its own IPC send in nothing more than the send itself — no additional try/catch needed beyond what the renderer-side dialog already handles by falling back to `error` state display. A failed check (no network, no releases published yet, GitHub rate-limited, etc.) must never surface as anything more alarming than the existing dialog's own `error` state, and must never block app startup or normal use — matching the existing stub's own documented intent.

## Testing

Per this project's established convention (root `CLAUDE.md`'s Testing conventions):

- The state-machine reducer logic (mapping `autoUpdater` events to the consolidated `update-state-changed` payload) is pure enough to unit test with real TDD (vitest) if extracted as a small pure function — given a stream of fake events, assert the resulting state sequence.
- `UpdateAvailableDialog.tsx` itself: typecheck/lint-verified only, per this codebase's own convention that React components aren't directly unit tested.
- The real end-to-end path (a genuinely older signed, notarized build discovering, downloading, and successfully installing a genuinely newer one) can only be verified by actually cutting two tagged releases and watching the older one update itself live — this cannot be faked with mocks, and is a manual-walkthrough item requiring Elling, similar to the plugin-state and playhead-sync features shipped earlier this session.

## Non-goals (explicitly out of scope for this design)

- A manual "check for updates now" menu item or button — the automatic launch + 4-hour cadence is the whole mechanism for this design; add a manual trigger later only if it turns out to be genuinely wanted.
- "Skip this version" / "don't ask again for vX.Y.Z" — dismissing via "later" simply means it asks again at the next check, every time, for as long as that version stays the latest published release. No persisted per-version dismissal state.
- Staged/percentage rollout, delta (binary-diff) updates beyond whatever `electron-updater`/Squirrel.Mac already does by default, or a self-hosted update feed — GitHub Releases (already wired via `publish.provider: github`) is the whole feed.
- Windows/Linux auto-update — this app is macOS-first per root `CLAUDE.md`; the `build:win`/`build:linux` scripts exist but aren't part of this session's release pipeline, and adding update support for those platforms is out of scope here.
- Interrupting an in-progress recording specifically — not handled as a special case. The dialog only ever appears on a background timer or at launch, and nothing downloads or installs without an explicit "update now" click, so the user is always the one choosing the moment, including whether that moment is mid-session.
