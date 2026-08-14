# Explicit Save Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sssketch's continuous debounced autosave-to-the-real-project-file with an
explicit-save model (Save button / Cmd+S only), add a shared "unsaved changes?" discard-guard
used consistently at every point that currently replaces the live project (New, Open a
different project, Open from disk, Quit), and raise the rotating-backup cap from 3 to 15.

**Architecture:** A pure `hasUnsavedChanges` helper (renderer-only, testable) becomes the single
source of truth for "is there real content that would be lost." `App.tsx`'s `Frame` component
(which already owns `currentSketch`/`lastSavedJsonRef`) grows a `confirmDiscardIfDirty()` guard
built on a small local dialog (`UnsavedChangesDialog.tsx`, mirroring the existing
`LockInConfirmDialog.tsx` pattern) and absorbs `handleSave`/`handleNew` from the child
`ProjectMenu` component (which becomes purely presentational) so a new Cmd+S handler and the
quit-time IPC flow can call the same save logic directly. The main process tracks a dirty flag
pushed from the renderer and, on `before-quit`, shows a native Save/Don't Save/Cancel dialog,
requesting a save from the renderer over a small round-trip IPC pair when needed.

**Tech Stack:** TypeScript, React (renderer), Electron main/preload, Vitest.

---

## Spec reference

`docs/superpowers/specs/2026-08-14-explicit-save-model-design.md` is the source of truth for
scope and rationale. Section numbers referenced below (§1–§6) refer to that document's "Design"
section.

## Files touched (map)

- `src/renderer/src/state/unsavedChanges.ts` (NEW) — pure `hasUnsavedChanges` helper.
- `src/renderer/src/state/unsavedChanges.test.ts` (NEW) — its unit tests.
- `src/renderer/src/components/UnsavedChangesDialog.tsx` (NEW) — the 3-button discard-guard
  dialog.
- `src/renderer/src/App.tsx` (MODIFY, large) — `ProjectMenu` becomes presentational; `Frame`
  gains `handleSave`/`handleNew`/`confirmDiscardIfDirty`/Cmd+S/quit-flow wiring; the debounced
  autosave effect loses its library-write branch.
- `src/renderer/src/components/Titlebar.tsx` (MODIFY, small) — new `dirty` prop, renders a dot.
- `src/renderer/src/components/ProjectLibraryBrowser.tsx` (MODIFY, small) — new
  `onBeforeReplaceProject` prop, called before the row-click open and before
  `restoreSketchBackup`.
- `src/main/index.ts` (MODIFY) — dirty-state tracking, `set-dirty-state` handler,
  `request-save-before-quit` round trip, upgraded `before-quit` handler.
- `src/preload/index.ts` (MODIFY) — `setDirtyState`, `onRequestSaveBeforeQuit`,
  `notifySaveBeforeQuitComplete` bridge methods.
- `src/main/projectLibrary.ts` (MODIFY, 1 line) — `MAX_BACKUPS` 3 → 15.
- `src/main/projectLibrary.test.ts` (MODIFY) — update the backup-retention test to the new cap.

---

### Task 1: `hasUnsavedChanges` pure function + test

**Files:**
- Create: `src/renderer/src/state/unsavedChanges.ts`
- Test: `src/renderer/src/state/unsavedChanges.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/state/unsavedChanges.test.ts
import { describe, expect, it } from 'vitest'
import { hasUnsavedChanges } from './unsavedChanges'
import type { AppState } from './store'
import type { Rifff } from '@shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }
  ]
}
const oneRifff: AppState['rifffs'] = { r1: rifff }
const noRifffs: AppState['rifffs'] = {}

describe('hasUnsavedChanges', () => {
  it('is false when there are no rifffs at all, regardless of the last-saved snapshot', () => {
    expect(hasUnsavedChanges(noRifffs, '{"rifffs":{}}', null)).toBe(false)
    expect(hasUnsavedChanges(noRifffs, '{"rifffs":{}}', '{"rifffs":{"stale":true}}')).toBe(false)
  })

  it('is false when the serialized state matches the last-saved snapshot', () => {
    expect(hasUnsavedChanges(oneRifff, '{"rifffs":{"r1":{}}}', '{"rifffs":{"r1":{}}}')).toBe(
      false
    )
  })

  it('is true when there are rifffs and the serialized state differs from the last-saved snapshot', () => {
    expect(hasUnsavedChanges(oneRifff, '{"rifffs":{"r1":{}}}', '{"rifffs":{}}')).toBe(true)
  })

  it('is true when there are rifffs and nothing has ever been saved (lastSavedJson is null)', () => {
    expect(hasUnsavedChanges(oneRifff, '{"rifffs":{"r1":{}}}', null)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/unsavedChanges.test.ts`
Expected: FAIL — `Cannot find module './unsavedChanges'` (the module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/state/unsavedChanges.ts
import type { AppState } from './store'

/** True when there's real, unsaved content that would be lost by replacing
 * the live project (New, Open, Restore, Quit) -- the exact "is there
 * anything real to lose" check ProjectMenu's old handleNew used to compute
 * inline, hoisted out so App.tsx's Frame, the shared discard-guard, and the
 * unsaved-changes indicator all read the same value instead of three
 * separate recomputations (see docs/superpowers/specs/2026-08-14-explicit-
 * save-model-design.md, section 3).
 *
 * Takes the already-serialized state JSON (not the full AppState) so a
 * caller that re-evaluates this on every render (the indicator) can reuse
 * an already-memoized serialize instead of paying for a fresh one every
 * time -- see App.tsx's Frame, which threads its own `persistedJson` memo
 * through here.
 *
 * An empty project (no rifffs at all) is never "unsaved" even if
 * lastSavedJson is null/stale -- nothing has been imported yet, so there's
 * nothing real to lose. */
export function hasUnsavedChanges(
  rifffs: AppState['rifffs'],
  serializedState: string,
  lastSavedJson: string | null
): boolean {
  return Object.keys(rifffs).length > 0 && serializedState !== lastSavedJson
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/unsavedChanges.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/unsavedChanges.ts src/renderer/src/state/unsavedChanges.test.ts
git commit -m "$(cat <<'EOF'
Add hasUnsavedChanges pure helper for the explicit-save discard-guard

Hoists the "is there anything real to lose" check that ProjectMenu's
handleNew already computed inline, so it can be shared by the new
confirmDiscardIfDirty guard and an unsaved-changes indicator too.
EOF
)"
```

---

### Task 2: `UnsavedChangesDialog.tsx` component

**Files:**
- Create: `src/renderer/src/components/UnsavedChangesDialog.tsx`

Not unit-tested — React components are verified via typecheck/lint + manual walkthrough per
this project's own testing conventions (see root `CLAUDE.md`).

- [ ] **Step 1: Write the component**

```tsx
// src/renderer/src/components/UnsavedChangesDialog.tsx

// Same backdrop+panel shape as LockInConfirmDialog.tsx, but driven by plain
// props (App.tsx's Frame owns the visibility state and a stored
// resolve-function ref) rather than reducer state -- confirmDiscardIfDirty
// is only ever invoked from within Frame itself, or from a callback Frame
// hands down as a prop (see ProjectLibraryBrowser.tsx's
// onBeforeReplaceProject), never from several independent component
// instances at once the way LockInConfirmDialog's pendingLockInConfirm
// needs to be (see that component's own doc comment for why THAT one
// needs reducer-level state). So this one skips that complexity entirely
// and just takes callback props.
//
// Deliberately no backdrop-click-to-dismiss, for the same reason
// LockInConfirmDialog has none: "click outside to cancel" would just
// reintroduce the exact ambiguity (save? discard? cancel?) this dialog
// exists to remove. The user must press one of the three explicitly
// labeled buttons.
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

export function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel
}: {
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}): React.JSX.Element {
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
        <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
          this project has unsaved changes.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={buttonStyle()}>
            cancel
          </button>
          <button onClick={onDiscard} style={buttonStyle()}>
            discard
          </button>
          <button onClick={onSave} style={buttonStyle()}>
            save
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS, no errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/UnsavedChangesDialog.tsx
git commit -m "$(cat <<'EOF'
Add UnsavedChangesDialog component for the discard-guard

Mirrors LockInConfirmDialog.tsx's backdrop+panel shape with three
explicitly-labeled buttons (save/discard/cancel), driven by plain
callback props rather than reducer state since it only ever has one
call site's worth of concurrent use (App.tsx's Frame).
EOF
)"
```

---

### Task 3: Lift save/new logic from `ProjectMenu` into `Frame` (mechanical move, no behavior change)

This is the structural fix the design needs: `handleSave`/`handleNew` currently live inside the
child `ProjectMenu` component, but the Cmd+S handler (Task 6) and the quit-time flow (Task 9–11)
both need to run at the `Frame` level, since `Frame` is what owns `currentSketch`/
`lastSavedJsonRef`. This task moves `handleSave`, `handleNew`, `commitNewProject`, and the
`newProjectModal` state up into `Frame`, and turns `ProjectMenu` into a component that receives
`handleNew`/`handleSave` as props instead of defining them. Behavior is unchanged by this task —
`handleNew` still uses its old inline `window.confirm` check; Task 4 replaces that.

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Remove `handleSave` from `ProjectMenu` and add it to `Frame`**

In `src/renderer/src/App.tsx`, remove this block from `ProjectMenu`:

```ts
  async function handleSave(): Promise<void> {
    try {
      const json = serializeProject(state)
      if (currentSketch === null) {
        const name = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
      lastSavedJsonRef.current = json
    } catch (err) {
      console.error('ProjectMenu: failed to save project:', err)
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
```

In `Frame`, right after the existing `handleRename` function (which ends with
`setCurrentSketch({ kind: 'external', path: result.path })\n  }`), add:

```ts

  async function handleSave(): Promise<void> {
    try {
      const json = serializeProject(state)
      if (currentSketch === null) {
        const name = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
      lastSavedJsonRef.current = json
    } catch (err) {
      console.error('Frame: failed to save project:', err)
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
```

- [ ] **Step 2: Remove `handleNew`/`commitNewProject`/`newProjectModal` from `ProjectMenu` and add them to `Frame`**

In `ProjectMenu`, remove:

```ts
  const [newProjectModal, setNewProjectModal] = useState<{ defaultName: string } | null>(null)
```

(this sits alongside `ProjectMenu`'s other local `useState` declarations near the top of the
function — remove only this one line, leave `tidyUpNudgeOpen`/`pendingExportFormat`/etc. as-is).

Also remove this block from `ProjectMenu`:

```ts
  async function handleNew(): Promise<void> {
    // Only worth interrupting for if there's actually something that would
    // be lost: an empty project has nothing to discard, and a project whose
    // current content already matches the last known-saved snapshot (an
    // explicit Save, the debounced library autosave having already caught
    // up, or simply never having been touched since it was opened) isn't
    // going anywhere -- it's already sitting safely in the library/file.
    // Previously this only checked "is there any content at all," which
    // fired the confirm dialog constantly for projects that were, in fact,
    // already fully saved.
    const hasUnsavedChanges =
      Object.keys(state.rifffs).length > 0 && serializeProject(state) !== lastSavedJsonRef.current
    if (hasUnsavedChanges && !window.confirm('Discard the current project and start a new one?')) {
      return
    }
    setNewProjectModal({ defaultName: await window.rifffApi.generateDefaultProjectName() })
  }

  function commitNewProject(name: string): void {
    dispatch({ type: 'LOAD_STATE', state: initialState })
    lastSavedJsonRef.current = serializeProject(initialState)
    setCurrentSketch({ kind: 'library', name })
    setNewProjectModal(null)
  }
```

In `Frame`, right after the `handleSave` function added in Step 1, add:

```ts

  const [newProjectModal, setNewProjectModal] = useState<{ defaultName: string } | null>(null)

  async function handleNew(): Promise<void> {
    // Only worth interrupting for if there's actually something that would
    // be lost: an empty project has nothing to discard, and a project whose
    // current content already matches the last known-saved snapshot isn't
    // going anywhere -- it's already sitting safely in the library/file.
    const hasUnsaved =
      Object.keys(state.rifffs).length > 0 && serializeProject(state) !== lastSavedJsonRef.current
    if (hasUnsaved && !window.confirm('Discard the current project and start a new one?')) {
      return
    }
    setNewProjectModal({ defaultName: await window.rifffApi.generateDefaultProjectName() })
  }

  function commitNewProject(name: string): void {
    dispatch({ type: 'LOAD_STATE', state: initialState })
    lastSavedJsonRef.current = serializeProject(initialState)
    setCurrentSketch({ kind: 'library', name })
    setNewProjectModal(null)
  }
```

(renamed the local `hasUnsavedChanges` variable to `hasUnsaved` here only to avoid shadowing the
pure `hasUnsavedChanges` function Task 4 imports into this same file — Task 4 replaces this
whole function body anyway.)

- [ ] **Step 3: Remove the now-dead `dispatch` from `ProjectMenu`**

`commitNewProject` was `ProjectMenu`'s only use of `dispatch`. In `ProjectMenu`, remove:

```ts
  const dispatch = useDispatch()
```

(leave `const state = useAppState()` — still used by the export flow and the save-menu's
`currentSketch`-adjacent checks.)

- [ ] **Step 4: Update `ProjectMenu`'s signature to receive `handleNew`/`handleSave` as props, drop `lastSavedJsonRef`**

Replace:

```ts
function ProjectMenu({
  currentSketch,
  setCurrentSketch,
  lastSavedJsonRef,
  onOpenLibrary,
  onOpenClusterStems
}: {
  currentSketch: CurrentSketch
  setCurrentSketch: (sketch: CurrentSketch) => void
  /** Baseline to diff the live project against -- see App's own doc comment
   * on this ref. A plain mutable ref (not state) passed down from App,
   * which is the only place that knows every "this content is now durably
   * saved" moment (initial load/recovery, the debounced library autosave,
   * explicit Open) -- handleNew reads it, handleSave writes it. */
  lastSavedJsonRef: React.RefObject<string | null>
  onOpenLibrary: () => void
  /** Opens the "tidy up" browser -- the same callback TransportBar.tsx's
   * own tidy-up button already uses (wired to setClusterStemsOpen(true) in
   * App.tsx's Frame). Reused here for the export-time nudge's "tidy up
   * first" button. */
  onOpenClusterStems: () => void
}): React.JSX.Element {
```

with:

```ts
function ProjectMenu({
  currentSketch,
  setCurrentSketch,
  handleNew,
  handleSave,
  onOpenLibrary,
  onOpenClusterStems
}: {
  currentSketch: CurrentSketch
  setCurrentSketch: (sketch: CurrentSketch) => void
  /** Owned by App.tsx's Frame -- the only place that knows every "this
   * content is now durably saved" moment (initial load/recovery, explicit
   * Save/Cmd+S, the quit-time save prompt) and the only place that can run
   * the shared discard-guard (Frame also owns confirmDiscardIfDirty).
   * ProjectMenu itself is purely presentational for these two. */
  handleNew: () => Promise<void>
  handleSave: () => Promise<void>
  onOpenLibrary: () => void
  /** Opens the "tidy up" browser -- the same callback TransportBar.tsx's
   * own tidy-up button already uses (wired to setClusterStemsOpen(true) in
   * App.tsx's Frame). Reused here for the export-time nudge's "tidy up
   * first" button. */
  onOpenClusterStems: () => void
}): React.JSX.Element {
```

- [ ] **Step 5: Wire the button/menu to the prop, remove the `NewProjectModal` render from `ProjectMenu`**

Replace:

```tsx
      <button onClick={handleNew} style={buttonStyle}>
        new
      </button>
```

with the same code (unchanged — `handleNew` now resolves to the prop instead of a local
function, no JSX change needed).

In the save `ContextMenu`'s items, `{ label: 'save', onClick: handleSave }` is likewise
unchanged in text — it now resolves to the prop.

Remove this block from `ProjectMenu`'s returned JSX:

```tsx
      {newProjectModal && (
        <NewProjectModal
          defaultName={newProjectModal.defaultName}
          onCreate={commitNewProject}
          onCancel={() => setNewProjectModal(null)}
        />
      )}
```

- [ ] **Step 6: Render `NewProjectModal` from `Frame` instead, and update the `<ProjectMenu>` call site**

In `Frame`'s returned JSX, find:

```tsx
        {clusterStemsOpen && <ClusterStemsBrowser onClose={() => setClusterStemsOpen(false)} />}
        <LockInConfirmDialog />
```

and insert the modal render between them:

```tsx
        {clusterStemsOpen && <ClusterStemsBrowser onClose={() => setClusterStemsOpen(false)} />}
        {newProjectModal && (
          <NewProjectModal
            defaultName={newProjectModal.defaultName}
            onCreate={commitNewProject}
            onCancel={() => setNewProjectModal(null)}
          />
        )}
        <LockInConfirmDialog />
```

Then update the `<ProjectMenu>` call site — replace:

```tsx
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              lastSavedJsonRef={lastSavedJsonRef}
              onOpenLibrary={() => setLibraryBrowserOpen(true)}
              onOpenClusterStems={() => setClusterStemsOpen(true)}
            />
```

with:

```tsx
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              handleNew={handleNew}
              handleSave={handleSave}
              onOpenLibrary={() => setLibraryBrowserOpen(true)}
              onOpenClusterStems={() => setClusterStemsOpen(true)}
            />
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. If lint flags an unused `React.RefObject` import or similar leftover, remove it.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Lift handleSave/handleNew from ProjectMenu into Frame

Mechanical move, no behavior change: Frame is what owns
currentSketch/lastSavedJsonRef, and the upcoming Cmd+S handler and
quit-time save flow both need to call the same save logic directly
rather than reaching into a child component. ProjectMenu now receives
handleNew/handleSave as props and is purely presentational for them.
EOF
)"
```

---

### Task 4: Wire `hasUnsavedChanges` into `Frame` — dirty indicator + `confirmDiscardIfDirty` + `handleNew`

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Titlebar.tsx`

- [ ] **Step 1: Import the new pieces in `App.tsx`**

Add near the top of `src/renderer/src/App.tsx`, alongside the other component imports:

```ts
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
```

and alongside the other `state/` imports:

```ts
import { hasUnsavedChanges } from './state/unsavedChanges'
```

- [ ] **Step 2: Move `persistedJson`'s declaration earlier in `Frame`, add the dirty-state hooks**

Find (later in `Frame`, just before the debounced autosave effect):

```ts
  // Debounced crash-recovery autosave — fires AUTOSAVE_DEBOUNCE_MS after the
  // last real edit. Depends on the SERIALIZED content (a string), not state
  // itself, so a purely transient UI change (mode, volumeDragMode — both
  // already excluded from serializeProject's own output) produces the exact
  // same string and doesn't reset the debounce timer for nothing. Also
  // writes currentSketch to its own sidecar file in lockstep (see
  // writeAutosaveSketchInfo), so a crash-recovery restore knows which
  // sketch the recovered snapshot actually belongs to.
  const persistedJson = useMemo(() => serializeProject(state), [state])
```

and remove just the `const persistedJson = useMemo(...)` line from it (keep the doc comment in
place — it still documents the effect below):

```ts
  // Debounced crash-recovery autosave — fires AUTOSAVE_DEBOUNCE_MS after the
  // last real edit. Depends on the SERIALIZED content (a string), not state
  // itself, so a purely transient UI change (mode, volumeDragMode — both
  // already excluded from serializeProject's own output) produces the exact
  // same string and doesn't reset the debounce timer for nothing. Also
  // writes currentSketch to its own sidecar file in lockstep (see
  // writeAutosaveSketchInfo), so a crash-recovery restore knows which
  // sketch the recovered snapshot actually belongs to.
```

Now find (near the top of `Frame`, right after `const [renameError, setRenameError] =
useState<string | null>(null)`):

```ts
  const [renameError, setRenameError] = useState<string | null>(null)
```

and insert immediately after it:

```ts
  const [renameError, setRenameError] = useState<string | null>(null)

  // Moved up from where it used to sit (right before the debounced-autosave
  // effect further down) so both confirmDiscardIfDirty and the dirty
  // indicator below can reuse it instead of paying for a second serialize
  // of potentially-large project state on every render.
  const persistedJson = useMemo(() => serializeProject(state), [state])

  // Bumped after every explicit save (handleSave) so the dirty indicator
  // below picks up lastSavedJsonRef's new value immediately. lastSavedJsonRef
  // is a plain ref specifically so most of its writers (initial load,
  // crash-recovery restore, opening a different sketch) don't need to force
  // a re-render -- those are already followed by a state-changing
  // dispatch/setCurrentSketch of their own. handleSave is the one writer
  // that changes nothing else React-visible, so without this the indicator
  // would stay stuck showing "dirty" immediately after a real save.
  const [, setSaveVersion] = useState(0)

  // See UnsavedChangesDialog.tsx's own doc comment for why this doesn't
  // need LockInConfirmDialog's reducer-level visibility state -- only Frame
  // (and callbacks it hands down, like ProjectLibraryBrowser's
  // onBeforeReplaceProject below) ever calls confirmDiscardIfDirty.
  const [unsavedChangesPromptOpen, setUnsavedChangesPromptOpen] = useState(false)
  const unsavedChangesResolveRef = useRef<
    ((choice: 'save' | 'discard' | 'cancel') => void) | null
  >(null)

  // The single shared "is there real content that would be lost" value --
  // see state/unsavedChanges.ts's own doc comment. Recomputed on every
  // render (cheap: an Object.keys().length plus a string comparison against
  // an already-memoized serialize), which is what lets the indicator below
  // and confirmDiscardIfDirty always read a fresh value without a separate
  // recomputation each.
  const dirty = hasUnsavedChanges(state.rifffs, persistedJson, lastSavedJsonRef.current)
```

- [ ] **Step 3: Add `confirmDiscardIfDirty` + `resolveUnsavedChangesPrompt`, amend `handleSave` and `handleNew`**

Replace the `handleSave` function added in Task 3 (find it by its `async function handleSave():
Promise<void> {` signature) with the same body plus the `setSaveVersion` bump:

```ts
  async function handleSave(): Promise<void> {
    try {
      const json = serializeProject(state)
      if (currentSketch === null) {
        const name = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
      lastSavedJsonRef.current = json
      setSaveVersion((v) => v + 1)
    } catch (err) {
      console.error('Frame: failed to save project:', err)
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Shared discard-guard -- called from every place about to replace the
   * live in-memory project (New, opening/restoring a different library
   * sketch, opening from disk). Resolves 'discard' immediately when there's
   * nothing real to lose; otherwise shows UnsavedChangesDialog and resolves
   * once the user picks a button. See
   * docs/superpowers/specs/2026-08-14-explicit-save-model-design.md,
   * section 4. */
  function confirmDiscardIfDirty(): Promise<'save' | 'discard' | 'cancel'> {
    if (!dirty) return Promise.resolve('discard')
    return new Promise((resolve) => {
      unsavedChangesResolveRef.current = resolve
      setUnsavedChangesPromptOpen(true)
    })
  }

  function resolveUnsavedChangesPrompt(choice: 'save' | 'discard' | 'cancel'): void {
    setUnsavedChangesPromptOpen(false)
    unsavedChangesResolveRef.current?.(choice)
    unsavedChangesResolveRef.current = null
  }
```

Then replace `handleNew` (added in Task 3) with:

```ts
  async function handleNew(): Promise<void> {
    const choice = await confirmDiscardIfDirty()
    if (choice === 'cancel') return
    if (choice === 'save') await handleSave()
    setNewProjectModal({ defaultName: await window.rifffApi.generateDefaultProjectName() })
  }
```

- [ ] **Step 4: Render `UnsavedChangesDialog`**

In `Frame`'s returned JSX, find the `NewProjectModal` render added in Task 3:

```tsx
        {newProjectModal && (
          <NewProjectModal
            defaultName={newProjectModal.defaultName}
            onCreate={commitNewProject}
            onCancel={() => setNewProjectModal(null)}
          />
        )}
        <LockInConfirmDialog />
```

and insert the new dialog right after it:

```tsx
        {newProjectModal && (
          <NewProjectModal
            defaultName={newProjectModal.defaultName}
            onCreate={commitNewProject}
            onCancel={() => setNewProjectModal(null)}
          />
        )}
        {unsavedChangesPromptOpen && (
          <UnsavedChangesDialog
            onSave={() => resolveUnsavedChangesPrompt('save')}
            onDiscard={() => resolveUnsavedChangesPrompt('discard')}
            onCancel={() => resolveUnsavedChangesPrompt('cancel')}
          />
        )}
        <LockInConfirmDialog />
```

- [ ] **Step 5: Add the `dirty` prop to `Titlebar` and render the indicator dot**

In `src/renderer/src/components/Titlebar.tsx`, replace the props destructure/type:

```ts
export function Titlebar({
  sketchName,
  rifffCount,
  stemCount,
  onRename,
  renameError
}: {
  /** The real current project name, already resolved by the caller (see
   * App.tsx's Frame) -- was previously a hardcoded "untitled sketch 04"
   * placeholder that never reflected the actual sketch, library-saved or
   * not, a real reported bug. */
  sketchName: string
  rifffCount: number
  stemCount: number
  /** Called with whatever was typed when a rename is committed (Enter or
   * blur, non-empty and different from the current name). App.tsx's Frame
   * owns the actual rename logic -- Titlebar itself stays presentational.
   * Fire-and-forget from here; rejection is signaled back via renameError,
   * not a thrown value. */
  onRename: (newName: string) => void
  /** Non-null right after a rename attempt was rejected (e.g. name already
   * taken) -- shown inline next to the name. */
  renameError?: string | null
}): React.JSX.Element {
```

with:

```ts
export function Titlebar({
  sketchName,
  rifffCount,
  stemCount,
  onRename,
  renameError,
  dirty
}: {
  /** The real current project name, already resolved by the caller (see
   * App.tsx's Frame) -- was previously a hardcoded "untitled sketch 04"
   * placeholder that never reflected the actual sketch, library-saved or
   * not, a real reported bug. */
  sketchName: string
  rifffCount: number
  stemCount: number
  /** Called with whatever was typed when a rename is committed (Enter or
   * blur, non-empty and different from the current name). App.tsx's Frame
   * owns the actual rename logic -- Titlebar itself stays presentational.
   * Fire-and-forget from here; rejection is signaled back via renameError,
   * not a thrown value. */
  onRename: (newName: string) => void
  /** Non-null right after a rename attempt was rejected (e.g. name already
   * taken) -- shown inline next to the name. */
  renameError?: string | null
  /** True when the live project differs from what's last known to be
   * durably saved -- see state/unsavedChanges.ts's hasUnsavedChanges.
   * Shown as a small dot next to the project name; App.tsx's Frame is the
   * only place that knows both sides of that comparison. */
  dirty?: boolean
}): React.JSX.Element {
```

Then replace:

```tsx
        {renameError && (
          <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{renameError}</span>
        )}
```

with:

```tsx
        {dirty && (
          <span
            title="unsaved changes"
            aria-label="unsaved changes"
            style={{ color: 'var(--ra-text-3)', fontSize: 14, lineHeight: 1 }}
          >
            •
          </span>
        )}
        {renameError && (
          <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{renameError}</span>
        )}
```

(a plain Unicode bullet glyph as text content, not a `border-radius` element — this app's design
system forbids rounded corners on UI chrome, but a typographic character isn't chrome.)

- [ ] **Step 6: Pass `dirty` from `Frame`'s `<Titlebar>` call site**

Replace:

```tsx
            <Titlebar
              sketchName={
                currentSketch === null
                  ? 'untitled sketch'
                  : currentSketch.kind === 'library'
                    ? currentSketch.name
                    : basenameWithoutProjectExt(currentSketch.path)
              }
              rifffCount={Object.keys(state.rifffs).length}
              stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
              onRename={(newName) => void handleRename(newName)}
              renameError={renameError}
            />
```

with:

```tsx
            <Titlebar
              sketchName={
                currentSketch === null
                  ? 'untitled sketch'
                  : currentSketch.kind === 'library'
                    ? currentSketch.name
                    : basenameWithoutProjectExt(currentSketch.path)
              }
              rifffCount={Object.keys(state.rifffs).length}
              stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
              onRename={(newName) => void handleRename(newName)}
              renameError={renameError}
              dirty={dirty}
            />
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Titlebar.tsx
git commit -m "$(cat <<'EOF'
Wire hasUnsavedChanges + confirmDiscardIfDirty + dirty indicator into Frame

handleNew now goes through the shared discard-guard (save/discard/
cancel) instead of a plain window.confirm. Titlebar shows a small dot
next to the project name whenever there's real unsaved content.
EOF
)"
```

---

### Task 5: Remove the debounced library-autosave write (keep crash-recovery only)

Implements design doc §1. The crash-recovery snapshot write
(`autosaveProject`/`autosaveProjectSketch`) is unchanged; only the branch that wrote straight to
the library file on a timer is removed.

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Remove the library-write branch from the debounced autosave effect**

Find:

```ts
  useEffect(() => {
    const id = window.setTimeout(() => {
      void window.rifffApi.autosaveProject(persistedJson)
      void window.rifffApi.autosaveProjectSketch(JSON.stringify(currentSketch))
      // Also writes straight to the library folder once there's a real
      // named sketch AND real content -- the whole point of auto-naming a
      // fresh sketch immediately (see the mount effect above) is that
      // imported content ends up somewhere real and discoverable without
      // an explicit Save. Gated on non-empty rifffs so a session where
      // nothing was ever imported doesn't litter the library with an
      // empty, auto-named folder on every launch.
      if (
        currentSketch !== null &&
        currentSketch.kind === 'library' &&
        Object.keys(state.rifffs).length > 0
      ) {
        void window.rifffApi.saveProjectToLibrary(currentSketch.name, persistedJson)
        lastSavedJsonRef.current = persistedJson
      }
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [persistedJson, currentSketch, state.rifffs])
```

and replace it with:

```ts
  // Used to ALSO write straight to the library folder (saveProjectToLibrary)
  // once a real named sketch had real content -- removed as of the explicit
  // save model (see docs/superpowers/specs/2026-08-14-explicit-save-model-
  // design.md, section 1): the real project file on disk should only change
  // on an explicit save (the Save button, Cmd+S, or the quit-time prompt),
  // never on a timer. This effect's only remaining job is the
  // crash-recovery snapshot, always a separate, decoupled mechanism (see
  // projectFile.ts's writeAutosave/loadAutosave/clearAutosave) that needed
  // no change here.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void window.rifffApi.autosaveProject(persistedJson)
      void window.rifffApi.autosaveProjectSketch(JSON.stringify(currentSketch))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [persistedJson, currentSketch])
```

(the dependency array drops `state.rifffs`, no longer referenced in the effect body.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — in particular, no `react-hooks/exhaustive-deps` warning about a stale or
unnecessary dependency.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Stop autosaving to the library file on a debounce timer

The real project file on disk should only change on an explicit save
now (Save button, Cmd+S, or the quit-time prompt). Crash-recovery's
own decoupled snapshot mechanism (writeAutosave/loadAutosave) is
unchanged.
EOF
)"
```

---

### Task 6: Add Cmd+S / Ctrl+S to save

Implements design doc §2.

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the keydown handler**

In `Frame`, find the Cmd+0 reset-zoom handler:

```ts
  // Cmd+0 resets zoom to its default level -- the standard "reset zoom"
  // convention across creative and browser apps. Cmd only, matching the
  // wheel-zoom trigger's own modifier (see handleTimelineWheel's comment).
  // Skipped while focus is in a text input, same pattern as every other
  // global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.metaKey || e.key !== '0') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'RESET_ZOOM' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])
```

and insert a new effect right after it:

```ts
  // Cmd+0 resets zoom to its default level -- the standard "reset zoom"
  // convention across creative and browser apps. Cmd only, matching the
  // wheel-zoom trigger's own modifier (see handleTimelineWheel's comment).
  // Skipped while focus is in a text input, same pattern as every other
  // global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.metaKey || e.key !== '0') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'RESET_ZOOM' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])

  // Cmd+S/Ctrl+S saves the current project -- the same handleSave() already
  // wired to the Save button, just a keyboard trigger for it. Skipped while
  // focus is in a text input, matching every other global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const key = e.key.toLowerCase()
      if (!(e.metaKey || e.ctrlKey) || key !== 's') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave is a fresh closure every render (reads state/currentSketch directly), same reasoning as the Tab/undo-redo handlers above: re-registering on every render would be wasteful without behavioral difference, since it always reads the CURRENT closure's state anyway.
  }, [state, currentSketch])
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Add Cmd+S/Ctrl+S keyboard shortcut for save

Calls the same handleSave() already wired to the Save button -- no
new save logic, just a keyboard trigger.
EOF
)"
```

---

### Task 7: Thread the discard-guard through `ProjectLibraryBrowser` (row-click open + restore + open-from-disk)

Implements design doc §4's `ProjectLibraryBrowser`/`onOpenFromDisk` bullets — currently neither
has any unsaved-changes check at all, which is the exact gap the original bug report came from.

**Design decision (flagged for review):** `onBeforeReplaceProject` returns `Promise<'proceed' |
'cancel'>`, not the 3-way `'save' | 'discard' | 'cancel'` `confirmDiscardIfDirty` itself
resolves to. `ProjectLibraryBrowser` doesn't have access to `handleSave` (that stays in `Frame`),
so Frame's own implementation of the prop performs the save internally when the user picks
"save," and only tells `ProjectLibraryBrowser` whether it's safe to proceed.

**Files:**
- Modify: `src/renderer/src/components/ProjectLibraryBrowser.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the new prop to `ProjectLibraryBrowser`'s signature**

Replace:

```ts
export function ProjectLibraryBrowser({
  onSelect,
  onOpenFromDisk,
  onClose,
  currentLibraryName
}: {
  onSelect: (name: string) => void
  /** The "open" toolbar button now opens straight to this browser (the
   * library is the primary way to find a project) -- this is the escape
   * hatch for the less common case of opening a project that was never
   * saved to the library at all (e.g. shared from elsewhere on disk).
   * Expected to close this modal itself once it's done (mirrors onSelect
   * above, which also closes via its own onClose() call rather than this
   * component closing on the caller's behalf). */
  onOpenFromDisk: () => void
  onClose: () => void
  /** The library name of whatever's currently open in the arranger, if
   * anything -- used to disable that row's delete button. Deleting the
   * sketch you're actively working in out from under yourself would leave
   * the app referencing files that no longer exist. */
  currentLibraryName: string | null
}): React.JSX.Element {
```

with:

```ts
export function ProjectLibraryBrowser({
  onSelect,
  onOpenFromDisk,
  onClose,
  currentLibraryName,
  onBeforeReplaceProject
}: {
  onSelect: (name: string) => void
  /** The "open" toolbar button now opens straight to this browser (the
   * library is the primary way to find a project) -- this is the escape
   * hatch for the less common case of opening a project that was never
   * saved to the library at all (e.g. shared from elsewhere on disk).
   * Expected to close this modal itself once it's done (mirrors onSelect
   * above, which also closes via its own onClose() call rather than this
   * component closing on the caller's behalf). */
  onOpenFromDisk: () => void
  onClose: () => void
  /** The library name of whatever's currently open in the arranger, if
   * anything -- used to disable that row's delete button. Deleting the
   * sketch you're actively working in out from under yourself would leave
   * the app referencing files that no longer exist. */
  currentLibraryName: string | null
  /** App.tsx's Frame's shared discard-guard, adapted to this component's
   * needs -- called before replacing the live project (a row click, or a
   * backup restore) to give the user a chance to save/discard/cancel first.
   * Resolves 'proceed' immediately when there's nothing unsaved to lose.
   * Frame's own implementation performs the actual save internally when
   * the user picks "save" (this component has no access to handleSave),
   * so the only thing this needs to branch on is whether to continue. */
  onBeforeReplaceProject: () => Promise<'proceed' | 'cancel'>
}): React.JSX.Element {
```

- [ ] **Step 2: Guard the row-click open**

Replace:

```tsx
                <span
                  onClick={() => {
                    onSelect(sketch.name)
                    onClose()
                  }}
                  role="button"
                  aria-label={`open ${sketch.name}`}
                  style={{ flex: 1, color: 'var(--ra-text)', cursor: 'pointer' }}
                >
                  {sketch.name}
                </span>
```

with:

```tsx
                <span
                  onClick={() => {
                    void (async () => {
                      if ((await onBeforeReplaceProject()) === 'cancel') return
                      onSelect(sketch.name)
                      onClose()
                    })()
                  }}
                  role="button"
                  aria-label={`open ${sketch.name}`}
                  style={{ flex: 1, color: 'var(--ra-text)', cursor: 'pointer' }}
                >
                  {sketch.name}
                </span>
```

- [ ] **Step 3: Guard `handleRestoreClick` before `restoreSketchBackup` is called**

Replace:

```ts
  async function handleRestoreClick(name: string, backupPath: string): Promise<void> {
    if (restoreArmedPath !== backupPath) {
      setRestoreArmedPath(backupPath)
      return
    }
    setRestoreArmedPath(null)
    stopBackupPreview()
    const result = await window.rifffApi.restoreSketchBackup(name, backupPath)
    if (!result.ok) {
      console.error('ProjectLibraryBrowser: restoreSketchBackup failed:', result.reason)
      window.alert(`Couldn't restore that version: ${result.reason}`)
      return
    }
    setHistoryOpenName(null)
    onSelect(name)
    onClose()
  }
```

with:

```ts
  async function handleRestoreClick(name: string, backupPath: string): Promise<void> {
    if (restoreArmedPath !== backupPath) {
      setRestoreArmedPath(backupPath)
      return
    }
    // Runs BEFORE restoreSketchBackup, not just before the subsequent
    // onSelect -- restoring already changes the file on disk (safely, via
    // its own pre-restore backup), so checking only after the fact would
    // leave the live editor out of sync with a disk change the user just
    // tried to cancel.
    if ((await onBeforeReplaceProject()) === 'cancel') {
      setRestoreArmedPath(null)
      return
    }
    setRestoreArmedPath(null)
    stopBackupPreview()
    const result = await window.rifffApi.restoreSketchBackup(name, backupPath)
    if (!result.ok) {
      console.error('ProjectLibraryBrowser: restoreSketchBackup failed:', result.reason)
      window.alert(`Couldn't restore that version: ${result.reason}`)
      return
    }
    setHistoryOpenName(null)
    onSelect(name)
    onClose()
  }
```

- [ ] **Step 4: Wire the new prop, and guard `onOpenFromDisk`, from `Frame`**

In `src/renderer/src/App.tsx`, find the `<ProjectLibraryBrowser>` render:

```tsx
        {libraryBrowserOpen && (
          <ProjectLibraryBrowser
            onClose={() => setLibraryBrowserOpen(false)}
            currentLibraryName={
              currentSketch !== null && currentSketch.kind === 'library' ? currentSketch.name : null
            }
            onSelect={(name) => {
              void (async () => {
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'library', name })
                } catch (err) {
                  console.error('App: failed to open library sketch:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
            onOpenFromDisk={() => {
              setLibraryBrowserOpen(false)
              void (async () => {
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openProject()
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  // Same pre-warm-before-LOAD_STATE reasoning as the onSelect
                  // handler right above -- see its own comment history.
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'external', path: result.path })
                } catch (err) {
                  console.error('App: failed to open project from disk:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
          />
        )}
```

Replace it with:

```tsx
        {libraryBrowserOpen && (
          <ProjectLibraryBrowser
            onClose={() => setLibraryBrowserOpen(false)}
            currentLibraryName={
              currentSketch !== null && currentSketch.kind === 'library' ? currentSketch.name : null
            }
            onBeforeReplaceProject={async () => {
              const choice = await confirmDiscardIfDirty()
              if (choice === 'cancel') return 'cancel'
              if (choice === 'save') await handleSave()
              return 'proceed'
            }}
            onSelect={(name) => {
              void (async () => {
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'library', name })
                } catch (err) {
                  console.error('App: failed to open library sketch:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
            onOpenFromDisk={() => {
              void (async () => {
                const choice = await confirmDiscardIfDirty()
                if (choice === 'cancel') return
                if (choice === 'save') await handleSave()
                setLibraryBrowserOpen(false)
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openProject()
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  // Same pre-warm-before-LOAD_STATE reasoning as the onSelect
                  // handler right above -- see its own comment history.
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'external', path: result.path })
                } catch (err) {
                  console.error('App: failed to open project from disk:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
          />
        )}
```

(`setLibraryBrowserOpen(false)` moved to after the guard resolves, instead of firing
unconditionally before the async IIFE — closing the library browser out from under a "cancel"
choice would otherwise leave the user unable to see or retry the open they just backed out of.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ProjectLibraryBrowser.tsx
git commit -m "$(cat <<'EOF'
Guard project-library open/restore/open-from-disk with the discard prompt

ProjectLibraryBrowser's row-click open and backup-restore previously
had no unsaved-changes check at all -- the exact gap the original bug
report came from. onOpenFromDisk gets the same guard directly in
Frame, since its implementation already lives there.
EOF
)"
```

---

### Task 8: Main process — dirty-state tracking + `set-dirty-state` IPC handler

Implements the tracking half of design doc §5.

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the module-level dirty flag**

Find:

```ts
// Guards before-quit's shutdown-then-requit sequence (see below) against
// re-entering itself when it calls app.quit() a second time.
let isQuitting = false
```

and insert right after it:

```ts
// Guards before-quit's shutdown-then-requit sequence (see below) against
// re-entering itself when it calls app.quit() a second time.
let isQuitting = false

// Kept in sync with the renderer's own hasUnsavedChanges value via the
// 'set-dirty-state' IPC call below, fired on each of its transitions (not
// every keystroke) -- read from the before-quit handler to decide whether
// Cmd+Q needs to ask before discarding real unsaved work.
let rendererHasUnsavedChanges = false
```

- [ ] **Step 2: Add the `set-dirty-state` handler**

Find:

```ts
  ipcMain.handle('load-last-opened-sketch', () => loadLastOpenedSketch())
```

and insert right after it:

```ts
  ipcMain.handle('load-last-opened-sketch', () => loadLastOpenedSketch())

  ipcMain.handle('set-dirty-state', (_event, dirty: boolean) => {
    rendererHasUnsavedChanges = dirty
  })
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "$(cat <<'EOF'
Track renderer dirty state in main via a new set-dirty-state IPC call

Groundwork for the quit-time save prompt -- before-quit needs to know
whether there's real unsaved content without querying the renderer
synchronously.
EOF
)"
```

---

### Task 9: Main process — `request-save-before-quit` round trip + upgraded `before-quit` handler

Implements the quit-prompt half of design doc §5. Not unit-testable in this environment
(Electron main-process native dialog + real app-quit lifecycle) — manual verification only, same
documented posture as `engineProcess.ts`/other real-device-dependent native code (see this
project's `CLAUDE.md`).

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add `requestSaveBeforeQuit`**

Find the existing `app.on('before-quit', (event) => {` block. Insert a new function immediately
above it:

```ts
// Asks the renderer to save now (the quit dialog's own "Save" choice,
// below), awaiting its reply over a dedicated round-trip pair --
// 'request-save-before-quit' pushed to the renderer, 'save-before-quit-
// complete' sent back once handleSave() resolves (see preload/index.ts's
// onRequestSaveBeforeQuit/notifySaveBeforeQuitComplete and App.tsx's Frame,
// which wires the two together). Raced against a fixed timeout, the same
// Promise.race shape as the engine shutdownTimeout below, so a hung or
// already-torn-down renderer can't make the app un-quittable.
function requestSaveBeforeQuit(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()
  const win = mainWindow
  const replyPromise = new Promise<void>((resolve) => {
    ipcMain.once('save-before-quit-complete', () => resolve())
  })
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000))
  win.webContents.send('request-save-before-quit')
  return Promise.race([replyPromise, timeoutPromise])
}

```

- [ ] **Step 2: Upgrade the `before-quit` handler**

Replace:

```ts
app.on('before-quit', (event) => {
  // shutdown() is async — normally it resolves fast enough that this race
  // never matters, but if a crash-triggered respawn happens to be in flight
  // exactly when the user quits, shutdown() has to await that respawn
  // unwinding before it kills the engine process, which can run past the
  // point Electron's default quit sequence is blocked on. Deferring the
  // actual quit until shutdown() has genuinely finished avoids leaving an
  // orphaned native engine subprocess behind. isQuitting guards against
  // infinite recursion from the app.quit() call below re-triggering this
  // same handler.
  if (isQuitting || !playbackEngine) return
  isQuitting = true
  event.preventDefault()
  // shutdown() has no internal timeout of its own — if a respawn's
  // EngineClient.connect() were to hang (unlike spawnEngine()'s own 5s
  // readiness timeout, a raw socket.connect() has no bound), awaiting it
  // unconditionally could make the app un-quittable via Cmd+Q/dock/menu,
  // which is worse than the orphaned-subprocess risk this handler exists to
  // avoid. Race it against a fixed timeout so quitting is never held
  // hostage by the engine layer.
  const shutdownTimeout = new Promise<void>((resolve) => setTimeout(resolve, 5000))
  Promise.race([playbackEngine.shutdown(), shutdownTimeout])
    .catch((err: unknown) => {
      // Not expected to reject under normal conditions (shutdown()'s
      // internal errors are already caught), but guarded the same way
      // playbackEngineLifecycle.ts guards its own internal fire-and-forget
      // respawn() call, since this runs with nothing else downstream to
      // catch a rejection.
      console.error('index: playbackEngine shutdown failed', err)
    })
    .finally(() => {
      app.quit()
    })
})
```

with:

```ts
app.on('before-quit', (event) => {
  // isQuitting guards against infinite recursion from the app.quit() calls
  // below (both this handler's own dirty-prompt branch and the
  // engine-shutdown branch further down) re-triggering this same handler --
  // each of those is a deliberate re-issue of quit once there's nothing
  // left to interrupt it for, not a bug.
  if (isQuitting) return

  // Ask before discarding real unsaved work -- see rendererHasUnsavedChanges's
  // own doc comment above (kept current via the 'set-dirty-state' IPC call).
  // A NATIVE dialog here, not the custom in-app UnsavedChangesDialog: at
  // shutdown the window may already be tearing down, and a native
  // quit-prompt matches what every Mac user already expects from Cmd+Q. See
  // docs/superpowers/specs/2026-08-14-explicit-save-model-design.md, §5.
  if (rendererHasUnsavedChanges) {
    event.preventDefault()
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'This project has unsaved changes.',
      detail: 'Do you want to save before quitting?'
    })
    if (choice === 2) return // Cancel -- stay open, nothing else to do.
    if (choice === 0) {
      // Save -- ask the renderer to save and wait for its reply (bounded by
      // a timeout, see requestSaveBeforeQuit), then re-issue quit now that
      // there's nothing left to lose.
      void requestSaveBeforeQuit().finally(() => {
        rendererHasUnsavedChanges = false
        app.quit()
      })
      return
    }
    // Don't Save.
    rendererHasUnsavedChanges = false
    app.quit()
    return
  }

  // shutdown() is async — normally it resolves fast enough that this race
  // never matters, but if a crash-triggered respawn happens to be in flight
  // exactly when the user quits, shutdown() has to await that respawn
  // unwinding before it kills the engine process, which can run past the
  // point Electron's default quit sequence is blocked on. Deferring the
  // actual quit until shutdown() has genuinely finished avoids leaving an
  // orphaned native engine subprocess behind.
  if (!playbackEngine) return
  isQuitting = true
  event.preventDefault()
  // shutdown() has no internal timeout of its own — if a respawn's
  // EngineClient.connect() were to hang (unlike spawnEngine()'s own 5s
  // readiness timeout, a raw socket.connect() has no bound), awaiting it
  // unconditionally could make the app un-quittable via Cmd+Q/dock/menu,
  // which is worse than the orphaned-subprocess risk this handler exists to
  // avoid. Race it against a fixed timeout so quitting is never held
  // hostage by the engine layer.
  const shutdownTimeout = new Promise<void>((resolve) => setTimeout(resolve, 5000))
  Promise.race([playbackEngine.shutdown(), shutdownTimeout])
    .catch((err: unknown) => {
      // Not expected to reject under normal conditions (shutdown()'s
      // internal errors are already caught), but guarded the same way
      // playbackEngineLifecycle.ts guards its own internal fire-and-forget
      // respawn() call, since this runs with nothing else downstream to
      // catch a rejection.
      console.error('index: playbackEngine shutdown failed', err)
    })
    .finally(() => {
      app.quit()
    })
})
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "$(cat <<'EOF'
Add native Save/Don't Save/Cancel quit prompt for unsaved changes

before-quit now checks rendererHasUnsavedChanges before its existing
engine-shutdown sequence. "Save" round-trips through the renderer via
request-save-before-quit/save-before-quit-complete, raced against a
5s timeout so a hung renderer can't block quitting.
EOF
)"
```

---

### Task 10: Preload bridge — `setDirtyState` / `onRequestSaveBeforeQuit` / `notifySaveBeforeQuitComplete`

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the three bridge methods**

Find:

```ts
  loadLastOpenedSketch: (): Promise<string | null> => ipcRenderer.invoke('load-last-opened-sketch'),
```

and insert right after it:

```ts
  loadLastOpenedSketch: (): Promise<string | null> => ipcRenderer.invoke('load-last-opened-sketch'),
  // One-way: main just stores the boolean, no reply expected. Fired from
  // App.tsx's Frame whenever hasUnsavedChanges's own value transitions, not
  // on every keystroke -- see index.ts's rendererHasUnsavedChanges.
  setDirtyState: (dirty: boolean): Promise<void> => ipcRenderer.invoke('set-dirty-state', dirty),
  // Main pushes this when the quit dialog's "Save" choice is picked (see
  // index.ts's requestSaveBeforeQuit) -- the renderer's own listener (Frame)
  // runs handleSave() and calls notifySaveBeforeQuitComplete() once it
  // resolves, which main is waiting on via a matching ipcMain.once().
  onRequestSaveBeforeQuit: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('request-save-before-quit', listener)
    return () => ipcRenderer.removeListener('request-save-before-quit', listener)
  },
  notifySaveBeforeQuitComplete: (): void => {
    ipcRenderer.send('save-before-quit-complete')
  },
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "$(cat <<'EOF'
Expose setDirtyState/onRequestSaveBeforeQuit/notifySaveBeforeQuitComplete

Preload bridge for the quit-time save round trip added in the
previous main-process task.
EOF
)"
```

---

### Task 11: Renderer wiring — push dirty state to main, respond to the quit-time save request

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Push `dirty` transitions to main**

In `Frame`, find the Cmd+S effect added in Task 6 (ends with `}, [state, currentSketch])`), and
insert a new effect right after it:

```ts
  // Keeps main's own rendererHasUnsavedChanges (index.ts) in sync so the
  // quit-time dialog (before-quit) knows whether to ask before discarding
  // real unsaved work. `dirty` only changes value on a real transition (see
  // its own declaration above), so this effect only fires then, not on
  // every keystroke.
  useEffect(() => {
    void window.rifffApi.setDirtyState(dirty)
  }, [dirty])
```

- [ ] **Step 2: Respond to `request-save-before-quit`**

Insert another effect right after the one from Step 1:

```ts

  // Main pushes 'request-save-before-quit' when the user picks "Save" on
  // the native quit-time dialog (index.ts's before-quit handler) -- run the
  // same handleSave() the Save button/Cmd+S use, then reply so main's own
  // requestSaveBeforeQuit() (racing against a timeout) can stop waiting.
  useEffect(() => {
    return window.rifffApi.onRequestSaveBeforeQuit(() => {
      void handleSave().finally(() => window.rifffApi.notifySaveBeforeQuitComplete())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave is a fresh closure every render (reads state/currentSketch directly), same reasoning as the Cmd+S effect just above: re-subscribing on every render would be wasteful without behavioral difference, since the listener always reads the CURRENT closure's state anyway.
  }, [state, currentSketch])
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Wire renderer side of the quit-time save round trip

Frame now pushes dirty-state transitions to main (setDirtyState) and
responds to main's request-save-before-quit push by running the same
handleSave() the Save button uses, replying once it resolves.
EOF
)"
```

---

### Task 12: Raise the rotating-backup cap from 3 to 15

Implements design doc §6.

**Files:**
- Modify: `src/main/projectLibrary.ts`
- Modify: `src/main/projectLibrary.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/projectLibrary.test.ts`, find:

```ts
    it('keeps only the most recent MAX_BACKUPS (3), newest first', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { listSketchBackups } = await import('./projectLibrary')
      for (let i = 0; i < 5; i++) {
        saveProjectToLibrary('many-saves', `{"rifffs":{"n":${i}}}`)
        await tick()
      }
      const backups = listSketchBackups('many-saves')
      expect(backups).toHaveLength(3)
      // Saves 0..4 each back up the PREVIOUS content just before
      // overwriting -- so the 5 saves produce backups of versions 0,1,2,3
      // (save 4's own content is still live, never backed up). Newest
      // three kept: versions 3, 2, 1.
      const contents = backups.map((b) => JSON.parse(readFileSync(b.path, 'utf-8')).rifffs.n)
      expect(contents).toEqual([3, 2, 1])
    })
```

and replace it with:

```ts
    it('keeps only the most recent MAX_BACKUPS (15), newest first', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { listSketchBackups } = await import('./projectLibrary')
      for (let i = 0; i < 17; i++) {
        saveProjectToLibrary('many-saves', `{"rifffs":{"n":${i}}}`)
        await tick()
      }
      const backups = listSketchBackups('many-saves')
      expect(backups).toHaveLength(15)
      // Saves 0..16 each back up the PREVIOUS content just before
      // overwriting -- so the 17 saves produce backups of versions 0..15
      // (save 16's own content is still live, never backed up). Newest 15
      // kept: versions 15 down to 1 (version 0 pruned).
      const contents = backups.map((b) => JSON.parse(readFileSync(b.path, 'utf-8')).rifffs.n)
      expect(contents).toEqual(Array.from({ length: 15 }, (_, idx) => 15 - idx))
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/projectLibrary.test.ts -t "keeps only the most recent"`
Expected: FAIL — `expected 4 to be 15` (current `MAX_BACKUPS = 3` only keeps 3, and 17 saves
only produced 16 backups here anyway, so the exact failure will report a length/content
mismatch against the still-3 cap).

- [ ] **Step 3: Update `MAX_BACKUPS`**

In `src/main/projectLibrary.ts`, find:

```ts
// Only the most recent few -- this is a safety net against an unwanted
// autosave overwrite, not real version control; unbounded growth would
// just be silent disk usage nobody asked for.
const MAX_BACKUPS = 3
```

and replace it with:

```ts
// Only the most recent few -- this is a safety net against an unwanted
// overwrite (an explicit Save, or the quit-time save prompt), not real
// version control; unbounded growth would just be silent disk usage nobody
// asked for. Raised from 3 to 15 once a save point became a deliberate
// action (the explicit-save model) rather than firing every few seconds --
// see docs/superpowers/specs/2026-08-14-explicit-save-model-design.md, §6.
const MAX_BACKUPS = 15
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/projectLibrary.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add src/main/projectLibrary.ts src/main/projectLibrary.test.ts
git commit -m "$(cat <<'EOF'
Raise rotating-backup cap from 3 to 15

Now that a save point is a deliberate action (explicit-save model)
rather than firing every few seconds, 3 backups was too shallow a
safety net. rotateBackupBeforeOverwrite/listSketchBackups/
restoreSketchBackup already handle an arbitrary count correctly.
EOF
)"
```

---

### Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full TypeScript/lint/test suite**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all PASS. In particular, confirm `unsavedChanges.test.ts` and the updated
`projectLibrary.test.ts` both pass, and that no other test broke from the `App.tsx`/
`ProjectLibraryBrowser.tsx`/`Titlebar.tsx` refactors (React components in this codebase are not
unit-tested directly, but their non-React collaborators — `serializeProject`, `store.ts`'s
reducer, etc. — have their own suites that must still be green).

- [ ] **Step 2: Confirm no native-engine changes were made**

This plan touches only `src/renderer/`, `src/main/`, and `src/preload/` — nothing under
`native-engine/Source/`. Run:

```bash
git diff --stat HEAD~12 -- native-engine/
```

Expected: empty output (no native files touched by this plan's tasks). No engine rebuild or app
relaunch is required for this feature by itself, though a normal `npm run dev` reload is still
needed to pick up the renderer/main/preload changes.

- [ ] **Step 3: Manual walkthrough checklist**

This project's own convention (see root `CLAUDE.md`'s testing-conventions section) is that React
UI and Electron main-process native-dialog/quit-lifecycle behavior are verified by manual
walkthrough, not automated tests — a coding agent cannot click through the app itself, so this
step should be reported to the user as a checklist to verify manually, not claimed as done:

- [ ] Import a stem, confirm the Save button and Cmd+S both save; confirm the project file on
      disk only changes at that moment (not a few seconds after an edit with no save).
- [ ] Make an edit, confirm the small dot appears next to the project name in the top bar;
      Save, confirm the dot disappears immediately.
- [ ] Make an edit, click "new" — confirm the save/discard/cancel dialog appears; test all three
      buttons (Cancel stays on the current project with edits intact; Discard starts a fresh
      project losing the edit; Save saves first, then starts fresh).
- [ ] Make an edit, open the project library, click a different sketch's row — confirm the same
      three-way prompt appears before it switches.
- [ ] Make an edit, open the project library, expand "history" on any sketch, click "restore" —
      confirm the prompt appears and blocks the restore on Cancel.
- [ ] Make an edit, click "open from disk…" in the project library — confirm the prompt appears.
- [ ] Make an edit, quit the app (Cmd+Q) — confirm the native Save/Don't Save/Cancel dialog
      appears; test all three, including that "Save" actually writes the file before quitting
      (reopen the sketch afterward to confirm).
- [ ] With no unsaved changes, quit the app — confirm it quits immediately with no prompt.
- [ ] Save a sketch 17+ times in a row (or via repeated edits+Cmd+S), open its "history" in the
      project library, confirm at most 15 backups are listed.

- [ ] **Step 4: Report results**

No commit for this task — it's verification-only. Report the typecheck/lint/test output and the
manual walkthrough checklist (to be completed by a human, or explicitly called out as pending)
back to the user.

---
