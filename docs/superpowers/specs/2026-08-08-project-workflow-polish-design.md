# Project workflow polish: naming modal, tidy-up nudge, click-to-rename — design

Three related project-identity/workflow changes, requested together:

1. "New" project shows an editable name in a modal instead of silently applying an
   auto-generated one — aimed at cutting down on the pile of anonymously-auto-named
   projects that accumulate in the library.
2. Exporting to Ableton recommends running "tidy up" first, if the project hasn't been.
3. Clicking the project name in the top bar renames it in place.

## 1. New-project naming modal

**Current flow** (`ProjectMenu.handleNew`, `App.tsx`): after the existing "discard unsaved
changes?" confirm, it immediately resets state and silently calls
`generateDefaultProjectName()`, applying the result with no user input.

**New flow:** after that same discard confirm passes, open a small modal
(`NewProjectModal.tsx`) instead of resetting state right away. The modal calls
`generateDefaultProjectName()` to seed a text input with the auto-generated name (still
auto-generated — just shown and editable instead of applied blind), auto-focused and
selected so typing immediately replaces it. Two buttons: **create** (primary) and
**cancel**.

- **create**: performs the reset that today's `handleNew` does immediately —
  `dispatch({ type: 'LOAD_STATE', state: initialState })` and
  `setCurrentSketch({ kind: 'library', name: <edited value> })` — using whatever's in the
  field (empty/whitespace-only falls back to the original auto-generated name rather than
  creating an unnamed sketch).
- **cancel**: closes the modal, nothing else happens. Since the state reset is deferred
  until create is clicked, canceling truly leaves the current project untouched (unlike a
  design where the reset happens first and the modal only affects the name after the fact).

No name-collision handling needed here specifically — the debounced library autosave
already only creates a real file once actual content exists, and `saveProjectToLibrary`'s
existing collision behavior (used by every other save path) applies unchanged once that
first autosave fires.

## 2. Ableton export: recommend tidy-up first

**Detection:** `Object.keys(state.busOf).length === 0` — `busOf` is only ever populated by
the tidy-up flow (`ClusterStemsBrowser.tsx`'s `ASSIGN_TO_BUS`/`ASSIGN_STEMS_TO_BUS`
dispatches are its only callers), so an empty `busOf` reliably means "never tidied."

**Flow:** in `handleExportAbleton` (`ProjectMenu`, `App.tsx`), before any of the three
existing export branches (library/external/unsaved), check the condition above. If true,
show a small modal instead of proceeding — matching this codebase's established preference
for clearly-labeled buttons over a generic OK/Cancel confirm (see the earlier gated-recording
confirm rework): **"tidy up first"** and **"export anyway"**.

- **tidy up first**: closes the modal and calls the same `onOpenClusterStems` callback
  `ProjectMenu` already receives (wired to `setClusterStemsOpen(true)` in `App.tsx`,
  currently used by the standalone "tidy up" button) — opens `ClusterStemsBrowser` and does
  **not** proceed with export. The user re-triggers export themselves once they're done.
- **export anyway**: closes the modal and runs the existing export logic exactly as today.

Only gates the Ableton export path (`handleExportAbleton`) — WAV mix and stems export
aren't affected, since bus/track organization is specifically an Ableton concept. Once
`busOf` has any entries, the gate never shows again for that project.

## 3. Click project name to rename

`Titlebar.tsx`'s `sketchName` span becomes click-to-edit: clicking swaps it for a
text input pre-filled with the current name (empty for "untitled sketch"), auto-focused
and selected. Enter or blur commits; Escape reverts without renaming. `Titlebar` gains an
`onRename: (newName: string) => void` prop — it stays presentational (matching this
codebase's components convention); the actual rename logic lives in `App.tsx`'s `Frame`,
which already owns `currentSketch`/`setCurrentSketch`.

Behavior depends on `currentSketch`:
- **`null`** ("untitled sketch", never saved): committing a typed name does what `handleSave`
  already does for a null `currentSketch`, just with the typed name instead of an
  auto-generated one — `saveProjectToLibrary(typedName, json)`, then
  `setCurrentSketch({ kind: 'library', name: typedName })`.
- **`{ kind: 'library', name }`**: calls a new main-process `renameSketch(oldName, newName)`
  (see below), then on success `setCurrentSketch({ kind: 'library', name: newName })`.
- **`{ kind: 'external', path }`**: renames just the file at its current location
  (`renameSync` to a sibling path with the new basename, same directory, same
  `.sssketchproj` extension), then `setCurrentSketch({ kind: 'external', path: newPath })`.
- Empty or unchanged name: no-op, revert to display.
- Name collision (library kind only): if `newName` already names a *different* existing
  sketch, the rename is rejected and an inline message shows next to the input in the same
  neutral text styling as the rest of the UI (no color-as-signal, matching the design
  system's "color only for audio info" rule) — the input stays open for another attempt
  rather than silently reverting.

**`renameSketch(oldName, newName)`** (new, `src/main/projectLibrary.ts`): a library sketch
is a whole directory (`sketchDir(name)`) containing `<name>.sssketchproj`,
`.sssketch-meta.json`, and an optional `Ableton/<name>.als`. Renaming needs to keep all
three name-bearing pieces consistent — a plain directory rename alone would leave the inner
`.sssketchproj` and `.als` files (whose names are derived from `name`, not fixed) stale:

1. Reject if `sketchDir(newName)` already exists (collision).
2. `renameSync(sketchDir(oldName), sketchDir(newName))` — one atomic move of the whole
   directory (meta file and Ableton subfolder move with it for free, since neither is
   keyed by name).
3. Inside the now-renamed directory, if `<oldName>.sssketchproj` exists, rename it to
   `<newName>.sssketchproj`.
4. If `Ableton/<oldName>.als` exists, rename it to `Ableton/<newName>.als` too — keeps
   `shouldWarnBeforeOverwrite`'s existing `${name}.als` lookup working post-rename, rather
   than it silently reading "no prior export" for a sketch that actually has one.

This is a real rename (single `renameSync` per piece, same volume), not a copy — no new
duplication, consistent with the disk-efficiency work already in flight.

## Testing

- **New-project modal**: renderer component, not unit tested per this codebase's convention
  (verified via typecheck/lint/manual walkthrough).
- **Tidy-up nudge**: same — renderer-only, verified via typecheck/lint/manual walkthrough.
  The `busOf`-empty detection itself needs no new logic (reads existing state directly).
- **`renameSketch`**: TDD, `projectLibrary.test.ts`, real temp directories (this module's
  existing convention, no fs mocking) — covers: renames a sketch's directory + inner
  `.sssketchproj`; also renames an existing `Ableton/<name>.als` when present; leaves a
  sketch with no `.als` yet untouched on that front; rejects when the target name already
  exists; leaves the original untouched on rejection.
- **`Titlebar`/App.tsx rename wiring**: renderer, verified via typecheck/lint/manual
  walkthrough for all three `currentSketch` branches (null/library/external) plus the
  collision-rejection message.

## Non-goals

- No bulk "clean up old auto-named projects" tool — this pass only changes what happens
  going forward at creation time.
- No name-collision auto-suffixing (e.g. `nextVersionName`'s `-N` pattern) for the rename
  path — a deliberate rename is an explicit choice, so an explicit rejection asking for a
  different name reads better here than something silently mutating what was actually typed.
- No change to the standalone "tidy up" button/entry point itself — this only adds an
  additional trigger point (the export gate) that reuses it.
