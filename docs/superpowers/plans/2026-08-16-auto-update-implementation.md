# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing non-functional `autoUpdater.checkForUpdatesAndNotify()` startup stub with a real check → ask → confirm → download → install auto-update flow, for every install (not just dev), that never downloads or installs anything without an explicit user confirmation.

**Architecture:** A small pure state machine (`src/shared/updateState.ts`) maps `electron-updater` events onto a consolidated `UpdateState`, held in `src/main/index.ts` and pushed to the renderer over one IPC channel (`update-state-changed`) any time it changes. The renderer's new `UpdateAvailableDialog.tsx`, mounted unconditionally, renders nothing while idle and shows the right copy/controls for whichever state it's in. `electron-builder.yml` gains a `zip` mac build target (required by Squirrel.Mac, which `electron-updater` wraps, to actually apply an update — the existing DMG-only target can be found but never downloaded/installed).

**Tech Stack:** `electron-updater` (already a dependency), TypeScript across main/preload/renderer/shared, vitest for the pure state-machine logic.

---

## Read before starting

- `docs/superpowers/specs/2026-08-16-auto-update-design.md` — the approved design this plan implements.

## Working directly on master, no worktree

Matches this session's established convention for every prior task tonight.

---

### Task 1: `src/shared/updateState.ts` — pure state machine + tests

**Files:**
- Create: `src/shared/updateState.ts`
- Create: `src/shared/updateState.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/updateState.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { nextUpdateState, type UpdateState } from './updateState'

const idle: UpdateState = { state: 'idle' }

describe('nextUpdateState', () => {
  it('update-available moves idle to available, carrying the version', () => {
    const next = nextUpdateState(idle, { type: 'update-available', version: '1.2.0' })
    expect(next).toEqual({ state: 'available', version: '1.2.0' })
  })

  it('confirm-install moves available to downloading at 0 percent', () => {
    const available: UpdateState = { state: 'available', version: '1.2.0' }
    const next = nextUpdateState(available, { type: 'confirm-install' })
    expect(next).toEqual({ state: 'downloading', version: '1.2.0', percent: 0 })
  })

  it('confirm-install is a no-op from any state other than available', () => {
    const next = nextUpdateState(idle, { type: 'confirm-install' })
    expect(next).toEqual(idle)
  })

  it('download-progress updates percent while downloading', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 10 }
    const next = nextUpdateState(downloading, { type: 'download-progress', percent: 42 })
    expect(next).toEqual({ state: 'downloading', version: '1.2.0', percent: 42 })
  })

  it('download-progress is a no-op outside downloading', () => {
    const next = nextUpdateState(idle, { type: 'download-progress', percent: 42 })
    expect(next).toEqual(idle)
  })

  it('update-downloaded moves downloading to installing, keeping the version', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 100 }
    const next = nextUpdateState(downloading, { type: 'update-downloaded' })
    expect(next).toEqual({ state: 'installing', version: '1.2.0' })
  })

  it('update-downloaded is a no-op outside downloading', () => {
    const next = nextUpdateState(idle, { type: 'update-downloaded' })
    expect(next).toEqual(idle)
  })

  it('error moves any state to error, carrying the message', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 42 }
    const next = nextUpdateState(downloading, { type: 'error', error: 'network unreachable' })
    expect(next).toEqual({ state: 'error', error: 'network unreachable' })
  })

  it('dismiss resets any state to idle', () => {
    const error: UpdateState = { state: 'error', error: 'network unreachable' }
    expect(nextUpdateState(error, { type: 'dismiss' })).toEqual(idle)

    const available: UpdateState = { state: 'available', version: '1.2.0' }
    expect(nextUpdateState(available, { type: 'dismiss' })).toEqual(idle)
  })

  it('update-available while already downloading/installing does not interrupt it -- a second poll finding the same or a different version mid-flight should not reset progress', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 42 }
    const next = nextUpdateState(downloading, { type: 'update-available', version: '1.2.0' })
    expect(next).toEqual(downloading)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/shared/updateState.test.ts`
Expected: FAIL with "Cannot find module './updateState'"

- [ ] **Step 3: Implement `src/shared/updateState.ts`**

```typescript
/** Consolidated auto-update state, pushed to the renderer as a single IPC
 * payload on every change (see main/index.ts's update-state-changed push)
 * rather than one event per field -- so the renderer never has to
 * reconcile partial updates arriving out of order. `idle` is both the
 * starting state and where every terminal action (dismiss, a fresh
 * update-not-available) returns to. */
export type UpdateState =
  | { state: 'idle' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'installing'; version: string }
  | { state: 'error'; error: string }

/** Mirrors the electron-updater events (plus the two user-driven actions,
 * confirm-install/dismiss) that can move this state machine. main/index.ts
 * maps each real electron-updater callback onto one of these before calling
 * nextUpdateState -- see that file's own pushUpdateState helper. */
export type UpdateEvent =
  | { type: 'update-available'; version: string }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded' }
  | { type: 'error'; error: string }
  | { type: 'confirm-install' }
  | { type: 'dismiss' }

/** Pure reducer: given the current state and one event, returns the next
 * state. Guards each transition against firing from the wrong current
 * state (e.g. confirm-install only does anything from 'available') rather
 * than trusting every caller to only ever dispatch events in the "right"
 * order -- electron-updater's own events aren't under this app's control,
 * so defensive no-ops here are cheaper than trying to prevent an
 * out-of-order call at every call site. */
export function nextUpdateState(current: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'update-available':
      // A second update-available mid-download/mid-install (e.g. the
      // periodic timer's own next tick somehow still fired) must not
      // reset progress -- see this file's own test on this exact case.
      if (current.state === 'downloading' || current.state === 'installing') return current
      return { state: 'available', version: event.version }
    case 'confirm-install':
      if (current.state !== 'available') return current
      return { state: 'downloading', version: current.version, percent: 0 }
    case 'download-progress':
      if (current.state !== 'downloading') return current
      return { state: 'downloading', version: current.version, percent: event.percent }
    case 'update-downloaded':
      if (current.state !== 'downloading') return current
      return { state: 'installing', version: current.version }
    case 'error':
      return { state: 'error', error: event.error }
    case 'dismiss':
      return { state: 'idle' }
    default:
      return current
  }
}
```

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `npx vitest run src/shared/updateState.test.ts`
Expected: PASS, all 10 tests

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors from these two new files.

- [ ] **Step 6: Commit**

```bash
git add src/shared/updateState.ts src/shared/updateState.test.ts
git commit -m "$(cat <<'EOF'
Add updateState.ts: pure auto-update state machine + tests

Maps electron-updater's own events (plus the two user-driven actions,
confirm-install/dismiss) onto a single consolidated UpdateState, so
main/index.ts's IPC push and the renderer's dialog both work off one
shape rather than reconciling several partial-update events. Nothing
wires this up yet -- that's the next task.
EOF
)"
```

---

### Task 2: `electron-builder.yml` — add the `zip` mac build target

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Add `zip` to the mac target list**

In `electron-builder.yml`, replace:

```yaml
  target:
    - dmg
```

with:

```yaml
  target:
    - dmg
    - zip
```

This is inside the `mac:` block, right after the long comment explaining why `target` is a bare list (not `{ target: dmg, arch: [...] }`) and right before the `defaultArch: arm64` line — that surrounding context is unchanged, only the `target` list itself gains the new entry.

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "$(cat <<'EOF'
electron-builder: add zip mac build target for auto-update

macOS auto-update (Squirrel.Mac, which electron-updater wraps) applies
updates from a zipped app bundle, not a DMG -- without this, autoUpdater
can discover that a new version exists (via latest-mac.yml) but has
nothing to actually download and install. The existing DMG target is
untouched and still what manual downloads from the Releases page use;
this zip is a second, additional artifact nobody manually touches.
release.yml's existing `--publish always` already uploads whatever
targets this file specifies -- no CI workflow change needed.
EOF
)"
```

(This task has no automated test of its own -- the artifact only exists once a real `electron-builder --mac` build runs, which Task 6's full verification does not repeat, since it would duplicate a full signed/notarized build unnecessarily. The real proof this works is the release cut at the end of this plan actually producing a `.zip` asset alongside the `.dmg`s -- verify that explicitly when checking release assets.)

---

### Task 3: `src/main/index.ts` — replace the stub with the real check/ask/download/install flow

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import the new state machine**

In `src/main/index.ts`, right after:

```typescript
import type { BusCentroidStore } from '@shared/busCentroids'
```

add:

```typescript
import { nextUpdateState, type UpdateState } from '@shared/updateState'
```

- [ ] **Step 2: Add the module-scope state variable next to `mainWindow`**

Replace:

```typescript
let mainWindow: BrowserWindow | undefined
```

with:

```typescript
let mainWindow: BrowserWindow | undefined
// Single source of truth for the auto-update flow -- see @shared/updateState's
// own doc comment. Only ever mutated by pushUpdateState, defined inside the
// `if (app.isPackaged)` block below (stays 'idle' forever in dev, where that
// whole block never runs).
let currentUpdateState: UpdateState = { state: 'idle' }
```

- [ ] **Step 3: Replace the stub block**

Replace:

```typescript
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

with:

```typescript
  // Only in a packaged (production) build -- never in dev, where there's no
  // meaningful "newer published release" to check against, and running it
  // unconditionally would just spam electron-updater's own network calls +
  // logging on every dev-server restart for no benefit. Failure at any
  // stage below must never be fatal to the rest of the app -- it's a
  // background convenience feature, not a load-bearing startup step.
  if (app.isPackaged) {
    // electron-updater defaults autoDownload to true -- explicitly turned
    // off here since nothing may download or install without the user
    // confirming first via the update-confirm-install handler below (see
    // this feature's own design doc).
    autoUpdater.autoDownload = false

    function pushUpdateState(next: UpdateState): void {
      currentUpdateState = next
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-state-changed', currentUpdateState)
      }
    }

    autoUpdater.on('update-available', (info) => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'update-available', version: info.version }))
    })
    autoUpdater.on('update-not-available', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'dismiss' }))
    })
    autoUpdater.on('download-progress', (progress) => {
      pushUpdateState(
        nextUpdateState(currentUpdateState, { type: 'download-progress', percent: progress.percent })
      )
    })
    autoUpdater.on('update-downloaded', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'update-downloaded' }))
      // Immediate, per this feature's own design doc -- the app quits and
      // relaunches itself on the new version right away rather than
      // waiting for the user to quit on their own.
      autoUpdater.quitAndInstall()
    })
    autoUpdater.on('error', (err) => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'error', error: err.message }))
    })

    ipcMain.handle('update-confirm-install', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'confirm-install' }))
      autoUpdater.downloadUpdate().catch((err: unknown) => {
        console.error('index: auto-update download failed', err)
      })
    })

    ipcMain.handle('update-dismiss', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'dismiss' }))
    })

    autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.error('index: auto-update check failed', err)
    })
    // Every 4 hours for as long as the app stays open. Skips its own check
    // whenever a check/download/install is already in flight (state isn't
    // idle) -- otherwise a tick landing while the user has an unanswered
    // "available" dialog open, or mid-download, would kick off a redundant
    // overlapping check (see this feature's own design doc).
    setInterval(
      () => {
        if (currentUpdateState.state === 'idle') {
          autoUpdater.checkForUpdates().catch((err: unknown) => {
            console.error('index: periodic auto-update check failed', err)
          })
        }
      },
      4 * 60 * 60 * 1000
    )
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `src/main/index.ts`. (`src/preload/index.ts` and `src/renderer/src/` are not yet updated -- expect no errors from them either at this point, since nothing yet calls the not-yet-added preload bridge methods.)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "$(cat <<'EOF'
main: real ask-first auto-update flow, replacing the non-functional stub

Replaces checkForUpdatesAndNotify() (which auto-downloaded silently in
the background, and never worked anyway -- see the previous task's own
commit message on the missing zip artifact) with a real state machine:
check on startup + every 4 hours, push update-state-changed to the
renderer on every electron-updater event, and two new IPC handlers
(update-confirm-install, update-dismiss) so nothing downloads or
installs without the user explicitly confirming. Once a download
finishes, installs immediately (quitAndInstall) per this feature's own
design doc. Nothing in the renderer listens for update-state-changed
yet -- that's the next two tasks.
EOF
)"
```

---

### Task 4: `src/preload/index.ts` — bridge methods

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Import the shared type**

In `src/preload/index.ts`, right after:

```typescript
import type { RawPluginStatesCapture } from '@shared/pluginStates'
```

add:

```typescript
import type { UpdateState } from '@shared/updateState'
```

- [ ] **Step 2: Add the three bridge methods**

Right after `onCaptureLevelUpdate`'s closing `},` (i.e. right before `onGatedRecordingUpdate`'s own declaration):

```typescript
  onCaptureLevelUpdate: (
    callback: (channelId: string, peakL: number, peakR: number) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; peakL: number; peakR: number }
    ): void => callback(payload.channelId, payload.peakL, payload.peakR)
    ipcRenderer.on('engine-capture-level-update', listener)
    return () => ipcRenderer.removeListener('engine-capture-level-update', listener)
  },
```

add, right after it (before `onGatedRecordingUpdate`):

```typescript
  // main/index.ts's update-state-changed push (see @shared/updateState's
  // own doc comment for the full UpdateState shape) -- one consolidated
  // payload per change, not one event per field.
  onUpdateStateChanged: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: unknown, state: UpdateState): void => callback(state)
    ipcRenderer.on('update-state-changed', listener)
    return () => ipcRenderer.removeListener('update-state-changed', listener)
  },
  confirmUpdateInstall: (): Promise<void> => ipcRenderer.invoke('update-confirm-install'),
  dismissUpdate: (): Promise<void> => ipcRenderer.invoke('update-dismiss'),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts
git commit -m "$(cat <<'EOF'
preload: onUpdateStateChanged/confirmUpdateInstall/dismissUpdate bridge

Matches main/index.ts's new IPC surface from the previous task. Nothing
in the renderer calls these yet -- that's the next task.
EOF
)"
```

---

### Task 5: `UpdateAvailableDialog.tsx` + mount in `App.tsx`

**Files:**
- Create: `src/renderer/src/components/UpdateAvailableDialog.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `UpdateAvailableDialog.tsx`**

```tsx
// src/renderer/src/components/UpdateAvailableDialog.tsx
import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/updateState'

// Self-contained, mounted once and unconditionally from App.tsx (see
// <LockInConfirmDialog /> for the same "no props, subscribes to its own
// state source, renders null when there's nothing to show" convention) --
// unlike UnsavedChangesDialog.tsx (driven by a caller-owned prop), this one
// has exactly one source of truth (main/index.ts's update-state-changed
// push) and no caller ever needs to control its visibility directly.
//
// Same backdrop+panel visual treatment as UnsavedChangesDialog.tsx --
// sharp corners (no border-radius), monochrome shell, no backdrop-click-
// to-dismiss (same reasoning: an ambiguous "click outside" shouldn't stand
// in for an explicit button press on something this consequential).
function buttonStyle(): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '4px 10px',
    background: 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    color: 'var(--ra-text)',
    cursor: 'pointer'
  }
}

export function UpdateAvailableDialog(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ state: 'idle' })

  useEffect(() => window.rifffApi.onUpdateStateChanged(setState), [])

  if (state.state === 'idle') return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          padding: 14,
          width: 320,
          fontSize: 11
        }}
      >
        {state.state === 'available' && (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
              a new version of sssketch is available (v{state.version}) -- update now?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => void window.rifffApi.dismissUpdate()} style={buttonStyle()}>
                later
              </button>
              <button onClick={() => void window.rifffApi.confirmUpdateInstall()} style={buttonStyle()}>
                update now
              </button>
            </div>
          </>
        )}
        {state.state === 'downloading' && (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
              downloading update... {Math.round(state.percent)}%
            </p>
            <div
              style={{
                height: 4,
                background: 'var(--ra-bg)',
                border: '1px solid var(--ra-border)'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${state.percent}%`,
                  background: 'var(--ra-text)'
                }}
              />
            </div>
          </>
        )}
        {state.state === 'installing' && (
          <p style={{ margin: 0, color: 'var(--ra-text)' }}>
            installing update -- sssketch will restart in a moment.
          </p>
        )}
        {state.state === 'error' && (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
              update failed: {state.error}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => void window.rifffApi.dismissUpdate()} style={buttonStyle()}>
                dismiss
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in `App.tsx`**

In `src/renderer/src/App.tsx`, add the import right after:

```typescript
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
```

add:

```typescript
import { UpdateAvailableDialog } from './components/UpdateAvailableDialog'
```

Then, in `Frame()`'s JSX, replace:

```tsx
        <LockInConfirmDialog />
```

with:

```tsx
        <LockInConfirmDialog />
        <UpdateAvailableDialog />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all pass, including Task 1's 10 new `updateState.test.ts` tests. `UpdateAvailableDialog.tsx` itself has no direct test, per this codebase's convention that React components are typecheck/lint/manual-walkthrough-verified, not unit tested.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/UpdateAvailableDialog.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Add UpdateAvailableDialog.tsx, mount unconditionally in App.tsx

Self-contained, no props -- subscribes directly to main/index.ts's
update-state-changed push (via the previous task's preload bridge) and
renders nothing while idle. Renders the right copy/controls for
available/downloading/installing/error, matching UnsavedChangesDialog's
visual treatment (sharp corners, monochrome, no backdrop-click-dismiss).
This completes the auto-update feature's own code -- only real-build
verification remains.
EOF
)"
```

---

### Task 6: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck, lint, and test suite**

Run:
```bash
npm run typecheck
npm run lint
npx vitest run
```
Expected: no errors, no failures. This feature touches no native-engine code, so no native rebuild/test is needed this time (unlike most other tasks this session).

- [ ] **Step 2: Manual walkthrough — flag explicitly, don't claim it was done**

Per root `CLAUDE.md`'s Testing conventions and this feature's own design doc, the real end-to-end path cannot be verified without cutting two real tagged, signed, notarized releases and watching the older one update itself live — this is not something an implementer subagent can complete solo, and requires Elling. Specifically, after this plan's own release (the standing "push to main" step below) ships as some version N:

1. On a machine still running the PREVIOUS version (N-1), confirm the update check actually fires (either wait for the periodic 4-hour timer, or relaunch the app, which triggers the startup check) and the "a new version of sssketch is available" dialog appears with the correct version number.
2. Click "update now" and confirm the progress bar moves from 0 to 100%.
3. Confirm the app quits and relaunches itself automatically once the download finishes, landing on the new version (check the version shown wherever this app surfaces it, or just confirm the new features/fixes are present).
4. Separately, confirm "later" genuinely dismisses without downloading anything, and that the dialog reappears on the next check (either the next periodic tick or a relaunch) rather than staying dismissed forever.
5. Confirm the release's build assets actually include a `.zip` file this time (in addition to the existing `.dmg` files) — the whole mechanism depends on it existing per Task 2.

Say so explicitly in any completion report — this needs two real signed builds and genuinely elapsed time (or an app relaunch) between them, and cannot be faked with mocks.

- [ ] **Step 3: Commit (only if Step 1 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
