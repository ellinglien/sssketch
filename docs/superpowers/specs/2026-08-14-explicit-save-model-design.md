# Explicit Save Model — Design

**Status:** Drafted through the brainstorming skill with Elling. Follows directly from two things
in the same session: a real bug report ("if I made changes I didn't intend to keep, opening
another project saves over the last version anyway") and the rotating-backup/restore/preview
safety net already shipped as a stopgap. This design reconsiders the save model itself rather
than continuing to patch around it.

## Background

sssketch currently autosaves continuously: a debounced effect in `App.tsx` (`AUTOSAVE_DEBOUNCE_MS`,
4000ms after the last edit) calls `saveProjectToLibrary(currentSketch.name, persistedJson)` — the
same function `handleSave` uses — writing straight to the sketch's real `<name>.sssketchproj` file
on disk. There is no "discard this session's changes" concept for a library-resident sketch: by
the time you decide you don't want an edit, it's usually already saved.

Already shipped this session as a stopgap, and **kept unchanged by this design**: rotating backups
(`rotateBackupBeforeOverwrite`/`listSketchBackups`/`restoreSketchBackup`/`readSketchBackup` in
`projectLibrary.ts`, capped at `MAX_BACKUPS = 3`) plus a "history" list with restore and
audio-only preview in `ProjectLibraryBrowser.tsx`. That infrastructure already triggers on every
call to `saveProjectToLibrary` — under this design it just means something more (a deliberate save
point) once autosave stops calling that function on every edit.

Separately, and easy to conflate with the above: `writeAutosave`/`loadAutosave`/`clearAutosave`
(`projectFile.ts`) are a completely different mechanism — a single fixed crash-recovery snapshot
file in `userData`, decoupled from any named sketch, that only ever affects the "recover unsaved
work from a previous session?" prompt on next launch. This already matches where this design wants
autosave to live; it needs no architectural change, just to keep being the *only* thing that
writes automatically.

## Goal

The real project file on disk changes only when the user explicitly saves. Crash recovery and
version history both stay robust — crash recovery via the existing snapshot mechanism, version
history via the already-shipped rotating-backup feature (with a higher cap). Every place the app
is about to replace or lose the current in-memory project — New, Open a different project, Open
from disk, Quit — consistently offers Save/Discard/Cancel, instead of only "New" having that check
today (the gap that caused the original bug report).

## Non-goals

- **No visual arranger "rewind"/scrub feature.** Raised during brainstorming as a natural next
  step once real, deliberate save points exist — explicitly deferred, not designed here (see
  "Future work" below).
- **No change to *what* gets backed up or how backups are stored.**
  `rotateBackupBeforeOverwrite`/`sketchBackupsDir`/`listSketchBackups`/`restoreSketchBackup`/
  `readSketchBackup` all stay exactly as shipped. Only *when* a save happens changes, plus the
  retention cap (section 6).
- **No change to the crash-recovery snapshot mechanism itself** — `writeAutosave`/`loadAutosave`/
  `clearAutosave`, the sketch-info sidecar, and the "recover unsaved work?" prompt all stay as they
  are. Already decoupled from the named project file; already the right shape for this design.
- **No cloud sync or collaboration considerations.** Solo, local-first app.

## Design

### 1. Remove the debounced live autosave-to-named-file

`App.tsx`'s debounced autosave effect (`AUTOSAVE_DEBOUNCE_MS` after `persistedJson` changes)
currently does two things: (a) writes the crash-recovery snapshot
(`window.rifffApi.autosaveProject`/`autosaveProjectSketch`) — **keep this unchanged**; (b) when
`currentSketch.kind === 'library'` and `state.rifffs` is non-empty, also calls
`saveProjectToLibrary(currentSketch.name, persistedJson)` and updates `lastSavedJsonRef.current` —
**remove this**. After this change, `saveProjectToLibrary`/`saveProjectInPlace` are called from
exactly two places: `handleSave` (unchanged) and the new Cmd+S handler below.

### 2. Add Cmd+S

A new global keydown handler, matching this file's existing pattern for Cmd+Z/Cmd+0-style
shortcuts, binds Cmd+S/Ctrl+S to call the same `handleSave()` already wired to the Save button —
no new save logic, just a new trigger for the existing one. `e.preventDefault()` so the OS/browser
doesn't intercept it.

### 3. Unsaved-changes indicator

A derived boolean — `hasUnsavedChanges = Object.keys(state.rifffs).length > 0 &&
serializeProject(state) !== lastSavedJsonRef.current` — is the exact expression `handleNew`
already computes inline today. Hoist it to one shared place so `handleNew`, the new discard-guard
(section 4), and a visual indicator all read the same value instead of three separate
recomputations. Shown as a small marker (e.g. a dot) next to the project name in the top bar —
title-only, using existing design tokens, no new design-system elements needed.

### 4. Shared discard-guard, used everywhere the app is about to replace the live project

A new function, `confirmDiscardIfDirty(): Promise<'save' | 'discard' | 'cancel'>` — if
`!hasUnsavedChanges`, resolves `'discard'` immediately (nothing to lose). Otherwise shows a 3-way
choice. Matching this app's own established convention (`LockInConfirmDialog.tsx` — a custom
themed overlay, not a native `window.confirm`, specifically because a native confirm can't carry
custom button labels): a new small reusable dialog component (e.g. `UnsavedChangesDialog.tsx`,
same shape as `LockInConfirmDialog.tsx` — transient visibility state, three explicitly-labeled
buttons: "save", "discard", "cancel"). Reused at:

- **`handleNew`** — replaces its current inline `window.confirm`.
- **`ProjectLibraryBrowser`'s row-click (`onSelect`) and "restore" action** — currently has *no*
  check at all; this is the exact gap the original bug report came from.
- **`onOpenFromDisk`** — also currently has no check.

If the guard resolves `'save'`, call `handleSave()` (awaited) before proceeding; if `'discard'`,
proceed immediately; if `'cancel'`, abort the whole operation (don't create-new, don't open, don't
restore). For the restore case specifically, the guard must run *before* `restoreSketchBackup` is
called, not just before the subsequent `onSelect` — restoring already changes the file on disk
(safely, via its own pre-restore backup), so checking after the fact would leave the live editor
out of sync with a disk change the user just cancelled loading. Since `confirmDiscardIfDirty` and
`hasUnsavedChanges` live in `App.tsx` but the restore button lives in `ProjectLibraryBrowser.tsx`,
this likely means passing the guard down as a prop rather than only wrapping `onSelect` —
left for planning to work out the exact prop shape.

### 5. Quit-time flow

The renderer keeps the main process informed of the current `hasUnsavedChanges` value via a new
lightweight one-way IPC call (e.g. `set-dirty-state(boolean)`), fired from a `useEffect` on
`hasUnsavedChanges`'s own transitions (not on every keystroke). Main (`index.ts`) keeps this in a
simple in-memory variable alongside the existing `isQuitting` flag.

The existing `before-quit` handler (currently only coordinating engine-subprocess shutdown) gains
an earlier check: if the tracked dirty flag is true, show `dialog.showMessageBoxSync` — **native**,
not the custom in-app dialog. At shutdown, a custom React-rendered modal is less reliable (the
window may already be tearing down), and a native quit-prompt matches what every Mac user already
expects from Cmd+Q. Three buttons: "Save", "Don't Save", "Cancel".

- **"Cancel"** — `event.preventDefault()`, stop here, same as today's re-entrancy guard.
- **"Don't Save"** — fall through to the existing engine-shutdown-then-quit sequence, unchanged.
- **"Save"** — send an IPC message asking the renderer to save now and reply when done (new
  channel, e.g. `request-save-before-quit`), await that reply with a fixed timeout matching the
  existing `shutdownTimeout` pattern (so a hung renderer can't make the app unquittable), then fall
  through to the existing shutdown-then-quit sequence.

### 6. Version history cap

`MAX_BACKUPS` in `projectLibrary.ts` raised from `3` to `15`, now that a save point is a
deliberate action rather than firing every few seconds. No other change to
`rotateBackupBeforeOverwrite`/`listSketchBackups`/`restoreSketchBackup`/`readSketchBackup` or the
Project Library browser's history UI — both already handle an arbitrary count correctly.

## Testing

- The shared `hasUnsavedChanges` computation should get its own unit test if it's extracted into a
  pure, testable module rather than staying inline in `App.tsx` (which is untested by this
  project's own convention — see root `CLAUDE.md`'s testing-conventions section). Worth deciding
  placement during planning.
- `projectLibrary.test.ts`'s existing `'keeps only the most recent MAX_BACKUPS (3), newest first'`
  test (written this session) needs updating to whatever count is chosen, or parameterizing.
- The quit-time flow and native dialog are not unit-testable in this environment (Electron
  main-process native dialog + real app-quit lifecycle) — manual verification only, same
  documented posture as `engineProcess.ts`/other real-device-dependent native code per
  `CLAUDE.md`.

## Future work (explicitly out of scope now)

A visual "rewind" in the arranger — scrubbing through previous saved versions directly in the
timeline UI, rather than only via the Project Library browser's history list. Raised during this
design's brainstorming as a natural next step once real, deliberate save points exist (this
design's own outcome) — not designed or scoped here.
