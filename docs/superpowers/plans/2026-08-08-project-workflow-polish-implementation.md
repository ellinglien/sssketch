# Project Workflow Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable-name modal to "New" (cutting down on anonymously-auto-named
library clutter), a "tidy up first" recommendation before an un-tidied Ableton export, and
click-to-rename on the top-bar project name.

**Architecture:** Two new small overlay-modal components (`NewProjectModal.tsx`,
`TidyUpNudgeModal.tsx`) following this codebase's existing fixed-overlay modal pattern (see
`BeatPicker.tsx`). A new main-process `renameSketch` (library sketches) and
`renameExternalSketchFile` (explicit-path sketches) do the real filesystem rename, wired
through the standard IPC handler → preload bridge pattern already used by every other
project-file operation. `Titlebar.tsx` gains inline click-to-edit; the actual rename logic
lives in `App.tsx`'s `Frame`, which already owns `currentSketch`.

**Tech Stack:** TypeScript/React (renderer), Electron IPC, Node `fs`, Vitest with real temp
directories.

**Reference:** `docs/superpowers/specs/2026-08-08-project-workflow-polish-design.md`

---

### Task 1: `renameSketch` (library) + `renameExternalSketchFile` (explicit path)

**Files:**
- Modify: `src/main/projectLibrary.ts`
- Modify: `src/main/projectFile.ts`
- Test: `src/main/projectLibrary.test.ts`
- Test: `src/main/projectFile.test.ts`

- [ ] **Step 1: Write the failing tests for `renameSketch`**

Add to `src/main/projectLibrary.test.ts`, inside the existing top-level `describe('projectLibrary', ...)` block (alongside the other nested `describe`s):

```ts
  describe('renameSketch', () => {
    it('renames the sketch directory and its inner .sssketchproj file', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchDir, sketchProjectPath } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      const result = renameSketch('old-name', 'new-name')
      expect(result).toEqual({ ok: true, name: 'new-name' })
      expect(existsSync(sketchDir('old-name'))).toBe(false)
      expect(existsSync(sketchProjectPath('new-name'))).toBe(true)
      expect(readFileSync(sketchProjectPath('new-name'), 'utf-8')).toBe('{"rifffs":{}}')
    })

    it('renames an existing Ableton/<name>.als alongside it', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchAbletonDir } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      mkdirSync(sketchAbletonDir('old-name'), { recursive: true })
      writeFileSync(join(sketchAbletonDir('old-name'), 'old-name.als'), 'fake als bytes')
      renameSketch('old-name', 'new-name')
      expect(existsSync(join(sketchAbletonDir('new-name'), 'new-name.als'))).toBe(true)
      expect(existsSync(join(sketchAbletonDir('new-name'), 'old-name.als'))).toBe(false)
    })

    it('leaves a sketch with no .als yet untouched on that front', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchAbletonDir } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      const result = renameSketch('old-name', 'new-name')
      expect(result).toEqual({ ok: true, name: 'new-name' })
      expect(existsSync(sketchAbletonDir('new-name'))).toBe(false)
    })

    it('rejects when the target name already exists, leaving the original untouched', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchDir } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      saveProjectToLibrary('taken-name', '{"rifffs":{}}')
      const result = renameSketch('old-name', 'taken-name')
      expect(result.ok).toBe(false)
      expect(existsSync(sketchDir('old-name'))).toBe(true)
    })
  })
```

Add the needed imports to the top of `src/main/projectLibrary.test.ts` (it already imports
`mkdirSync, writeFileSync, readFileSync` — just add `existsSync` alongside them):

```ts
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync
} from 'node:fs'
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/projectLibrary.test.ts
```

Expected: FAIL — `renameSketch` is not exported yet.

- [ ] **Step 3: Implement `renameSketch`**

Add `renameSync` to `src/main/projectLibrary.ts`'s existing `node:fs` import:

```ts
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  renameSync,
  constants
} from 'node:fs'
```

Append to the end of `src/main/projectLibrary.ts`:

```ts
/**
 * Renames a library sketch in place -- a real directory+file rename (single
 * renameSync per piece, same volume), never a copy, matching the disk-
 * efficiency work already in flight elsewhere in this codebase. A library
 * sketch is a whole directory (sketchDir) containing <name>.sssketchproj,
 * .sssketch-meta.json, and an optional Ableton/<name>.als -- the project
 * file and .als are both keyed by name (not fixed filenames like the meta
 * file), so a plain directory rename alone would leave them stale. See
 * docs/superpowers/specs/2026-08-08-project-workflow-polish-design.md.
 */
export function renameSketch(
  oldName: string,
  newName: string
): { ok: true; name: string } | { ok: false; reason: string } {
  if (!existsSync(sketchDir(oldName))) {
    return { ok: false, reason: `no sketch named "${oldName}"` }
  }
  if (existsSync(sketchDir(newName))) {
    return { ok: false, reason: `a sketch named "${newName}" already exists` }
  }
  renameSync(sketchDir(oldName), sketchDir(newName))
  const oldProjectPath = join(sketchDir(newName), `${oldName}.sssketchproj`)
  if (existsSync(oldProjectPath)) {
    renameSync(oldProjectPath, sketchProjectPath(newName))
  }
  const oldAlsPath = join(sketchAbletonDir(newName), `${oldName}.als`)
  if (existsSync(oldAlsPath)) {
    renameSync(oldAlsPath, join(sketchAbletonDir(newName), `${newName}.als`))
  }
  return { ok: true, name: newName }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/projectLibrary.test.ts
```

Expected: PASS, all `renameSketch` tests plus every pre-existing test in the file.

- [ ] **Step 5: Write the failing test for `renameExternalSketchFile`**

Add to `src/main/projectFile.test.ts` (a new top-level `describe`, alongside the existing
`describe('generateDefaultProjectName', ...)`):

```ts
describe('renameExternalSketchFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sssketch-external-rename-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('renames the file in place, keeping its directory and extension', async () => {
    const { renameExternalSketchFile } = await import('./projectFile')
    const oldPath = join(dir, 'old-name.sssketchproj')
    writeFileSync(oldPath, '{"rifffs":{}}')
    const result = renameExternalSketchFile(oldPath, 'new-name')
    expect(result).toEqual({ ok: true, path: join(dir, 'new-name.sssketchproj') })
    expect(existsSync(oldPath)).toBe(false)
    expect(readFileSync(join(dir, 'new-name.sssketchproj'), 'utf-8')).toBe('{"rifffs":{}}')
  })

  it('rejects when the target filename already exists', async () => {
    const { renameExternalSketchFile } = await import('./projectFile')
    const oldPath = join(dir, 'old-name.sssketchproj')
    writeFileSync(oldPath, '{"rifffs":{}}')
    writeFileSync(join(dir, 'taken-name.sssketchproj'), '{}')
    const result = renameExternalSketchFile(oldPath, 'taken-name')
    expect(result.ok).toBe(false)
    expect(existsSync(oldPath)).toBe(true)
  })
})
```

This needs `beforeEach`/`afterEach` already imported (they are, per the existing top-level
import) and `dirname` used inside the implementation, not the test.

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run src/main/projectFile.test.ts
```

Expected: FAIL — `renameExternalSketchFile` is not exported yet.

- [ ] **Step 7: Implement `renameExternalSketchFile`**

Update the top imports of `src/main/projectFile.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
```

Add near `saveProjectInPlace` (they're the two functions operating on an arbitrary
explicit path rather than the library structure):

```ts
/** Renames an explicitly-opened (non-library) sketch file in place -- same
 * directory, same .sssketchproj extension, just a new basename. Mirrors
 * renameSketch's library-directory rename (projectLibrary.ts) for a sketch
 * that was never saved into the library at all. */
export function renameExternalSketchFile(
  oldPath: string,
  newName: string
): { ok: true; path: string } | { ok: false; reason: string } {
  const newPath = join(dirname(oldPath), `${newName}.sssketchproj`)
  if (existsSync(newPath)) {
    return { ok: false, reason: `a file named "${newName}.sssketchproj" already exists there` }
  }
  renameSync(oldPath, newPath)
  return { ok: true, path: newPath }
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/main/projectFile.test.ts src/main/projectLibrary.test.ts
```

Expected: PASS, all tests in both files.

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/projectLibrary.ts src/main/projectLibrary.test.ts src/main/projectFile.ts src/main/projectFile.test.ts
git commit -m "Add renameSketch and renameExternalSketchFile"
```

---

### Task 2: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the two functions to `index.ts`'s existing imports**

`src/main/index.ts` already imports several functions from `./projectLibrary`:

```ts
import {
  listLibrarySketches,
  libraryRootPath,
  setLibraryRootPath,
  shouldWarnBeforeOverwrite
} from './projectLibrary'
```

Change to:

```ts
import {
  listLibrarySketches,
  libraryRootPath,
  setLibraryRootPath,
  shouldWarnBeforeOverwrite,
  renameSketch
} from './projectLibrary'
```

Find `renameExternalSketchFile`'s home module, `./projectFile` — it's already imported at
the top for several other functions (`saveProjectToLibrary`, `openLibrarySketch`, etc. --
see the existing `} from './projectFile'` closing brace around line 26). Add
`renameExternalSketchFile` to that same import list.

- [ ] **Step 2: Add the two IPC handlers**

In `src/main/index.ts`, right after the existing `duplicate-sketch` handler:

```ts
  ipcMain.handle('duplicate-sketch', (_event, currentName: string) =>
    duplicateSketchAsNewVersion(currentName)
  )

  ipcMain.handle('rename-sketch', (_event, oldName: string, newName: string) =>
    renameSketch(oldName, newName)
  )

  ipcMain.handle('rename-external-sketch-file', (_event, oldPath: string, newName: string) =>
    renameExternalSketchFile(oldPath, newName)
  )
```

- [ ] **Step 3: Add the preload bridges**

In `src/preload/index.ts`, right after the existing `duplicateSketch` bridge:

```ts
  duplicateSketch: (currentName: string): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke('duplicate-sketch', currentName),
  renameSketch: (
    oldName: string,
    newName: string
  ): Promise<{ ok: true; name: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('rename-sketch', oldName, newName),
  renameExternalSketchFile: (
    oldPath: string,
    newName: string
  ): Promise<{ ok: true; path: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('rename-external-sketch-file', oldPath, newName),
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: clean. (`window.rifffApi`'s type is inferred from this same preload object in
this codebase's convention — no separate `.d.ts` to update.)

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire renameSketch/renameExternalSketchFile through IPC + preload"
```

---

### Task 3: New-project naming modal

**Files:**
- Create: `src/renderer/src/components/NewProjectModal.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `NewProjectModal.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'

/** Shown when "New" is clicked, after the discard-unsaved-changes confirm
 * already passed -- lets the user see and edit the auto-generated name
 * BEFORE a new project is actually created, instead of the old silent
 * apply-and-go. Aimed at cutting down on anonymously-auto-named clutter in
 * the project library. Deliberately does no state reset itself -- that only
 * happens in onCreate (App.tsx), so cancel truly leaves the current project
 * untouched. See docs/superpowers/specs/
 * 2026-08-08-project-workflow-polish-design.md. */
export function NewProjectModal({
  defaultName,
  onCreate,
  onCancel
}: {
  defaultName: string
  onCreate: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function commit(): void {
    const trimmed = name.trim()
    onCreate(trimmed.length > 0 ? trimmed : defaultName)
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(360px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">name this project</span>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') onCancel()
          }}
          autoFocus
          style={{
            display: 'block',
            width: '100%',
            marginTop: 10,
            height: 26,
            padding: '0 8px',
            fontSize: 12,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row)',
            color: 'var(--ra-text)'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
          <button
            onClick={commit}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            create
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`'s `ProjectMenu`**

Add the import near the top of `src/renderer/src/App.tsx`, alongside the other
`components/` imports:

```ts
import { NewProjectModal } from './components/NewProjectModal'
```

Inside `ProjectMenu`, add new local state right after the existing `saveMenu` state:

```ts
  const [saveMenu, setSaveMenu] = useState<{ x: number; y: number } | null>(null)
  const [newProjectModal, setNewProjectModal] = useState<{ defaultName: string } | null>(null)
```

Replace `handleNew` (currently does the reset immediately) with:

```ts
  async function handleNew(): Promise<void> {
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

Add the modal's render right before the closing `</div>` of `ProjectMenu`'s returned JSX
(alongside the existing `{exportMenu && <ContextMenu .../>}` block):

```tsx
      {newProjectModal && (
        <NewProjectModal
          defaultName={newProjectModal.defaultName}
          onCreate={commitNewProject}
          onCancel={() => setNewProjectModal(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: both clean.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Click "New" with an empty/fresh project (no confirm dialog expected), confirm the modal
appears pre-filled with an auto-generated name, type a different name, click "create",
confirm the top bar shows the typed name. Click "New" again, this time click "cancel",
confirm nothing changed. Quit (Cmd+Q) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NewProjectModal.tsx src/renderer/src/App.tsx
git commit -m "Show an editable naming modal on New instead of a silent auto-name"
```

---

### Task 4: Tidy-up-first Ableton export nudge

**Files:**
- Create: `src/renderer/src/components/TidyUpNudgeModal.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `TidyUpNudgeModal.tsx`**

```tsx
/** Shown from the Ableton export flow when the current project hasn't been
 * tidied up yet (state.busOf is empty -- ClusterStemsBrowser.tsx's
 * ASSIGN_TO_BUS/ASSIGN_STEMS_TO_BUS are its only callers, so an empty
 * busOf reliably means "never tidied"). Matches this codebase's preference
 * for clearly-labeled buttons over a generic OK/Cancel confirm. See
 * docs/superpowers/specs/2026-08-08-project-workflow-polish-design.md. */
export function TidyUpNudgeModal({
  onTidyUp,
  onExportAnyway
}: {
  onTidyUp: () => void
  onExportAnyway: () => void
}): React.JSX.Element {
  return (
    <div
      onClick={onExportAnyway}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">this project hasn't been tidied up yet</span>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-2)' }}>
          tidy up groups similar stems onto shared Ableton tracks, making the exported
          project much easier to mix. tidy up first?
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={onExportAnyway}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            export anyway
          </button>
          <button
            onClick={onTidyUp}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            tidy up first
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`'s `ProjectMenu`**

Add the import alongside the one added in Task 3:

```ts
import { TidyUpNudgeModal } from './components/TidyUpNudgeModal'
```

Add a new prop to `ProjectMenu`'s destructured signature:

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
  lastSavedJsonRef: React.RefObject<string | null>
  onOpenLibrary: () => void
  /** Opens the "tidy up" browser -- the same callback TransportBar.tsx's
   * own tidy-up button already uses (wired to setClusterStemsOpen(true) in
   * App.tsx's Frame). Reused here for the export-time nudge's "tidy up
   * first" button. */
  onOpenClusterStems: () => void
```

(the type block's closing `}` and function body continue unchanged after this).

Add new local state alongside `newProjectModal`:

```ts
  const [tidyUpNudgeOpen, setTidyUpNudgeOpen] = useState(false)
```

Rename the existing `handleExportAbleton` function body to `runExportAbleton`, and add a
new thin `handleExportAbleton` that gates on `busOf`:

```ts
  async function runExportAbleton(): Promise<void> {
    setExporting(true)
    try {
      if (currentSketch !== null && currentSketch.kind === 'library') {
        const warn = await window.rifffApi.shouldWarnBeforeAbletonOverwrite(currentSketch.name)
        if (
          warn &&
          !window.confirm(
            "This sketch's Ableton export has been modified since the last export from sssketch (likely from mixing directly in Ableton). Exporting again will overwrite it. Continue?"
          )
        ) {
          return
        }
        await window.rifffApi.exportAlsToLibrary(JSON.stringify(state), currentSketch.name)
      } else if (currentSketch !== null && currentSketch.kind === 'external') {
        await window.rifffApi.exportAlsNextToSource(JSON.stringify(state), currentSketch.path)
      } else {
        const defaultName = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.exportAls(JSON.stringify(state), defaultName)
      }
    } catch (err) {
      console.error('ProjectMenu: failed to export to Ableton:', err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  function handleExportAbleton(): void {
    if (Object.keys(state.busOf).length === 0) {
      setTidyUpNudgeOpen(true)
      return
    }
    void runExportAbleton()
  }
```

(This is the exact existing body of `handleExportAbleton`, just renamed and split — no
other logic changes.)

Add the modal's render alongside `NewProjectModal`'s (from Task 3), right before the
closing `</div>` of `ProjectMenu`'s returned JSX:

```tsx
      {tidyUpNudgeOpen && (
        <TidyUpNudgeModal
          onTidyUp={() => {
            setTidyUpNudgeOpen(false)
            onOpenClusterStems()
          }}
          onExportAnyway={() => {
            setTidyUpNudgeOpen(false)
            void runExportAbleton()
          }}
        />
      )}
```

Finally, pass the new prop at `ProjectMenu`'s own call site in `Frame` (currently missing
`onOpenClusterStems`):

```tsx
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              lastSavedJsonRef={lastSavedJsonRef}
              onOpenLibrary={() => setLibraryBrowserOpen(true)}
              onOpenClusterStems={() => setClusterStemsOpen(true)}
            />
```

- [ ] **Step 3: Typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: both clean.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Import a rifff or two into a fresh project, export to Ableton — confirm the nudge modal
appears. Click "tidy up first" — confirm the tidy-up browser opens and export did NOT run.
Close it, tidy up the stems, export to Ableton again — confirm it exports directly with no
nudge this time. Start a fresh project, import a rifff, export to Ableton, this time click
"export anyway" — confirm it exports normally. Quit (Cmd+Q) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TidyUpNudgeModal.tsx src/renderer/src/App.tsx
git commit -m "Recommend tidy-up before an un-tidied Ableton export"
```

---

### Task 5: Click-to-rename project name in the top bar

**Files:**
- Modify: `src/renderer/src/components/Titlebar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add click-to-edit to `Titlebar.tsx`**

Add the hooks import at the top of `src/renderer/src/components/Titlebar.tsx` (the file
currently has no import statement at all — this becomes its first line):

```tsx
import { useEffect, useRef, useState } from 'react'
```

Update the `Titlebar` function's signature:

```tsx
export function Titlebar({
  sketchName,
  rifffCount,
  stemCount,
  mode,
  sketchEligible,
  onCycleMode,
  onRename,
  renameError
}: {
  sketchName: string
  rifffCount: number
  stemCount: number
  mode: 'normal' | 'sketch'
  sketchEligible: boolean
  onCycleMode: () => void
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sketchName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEditing(): void {
    setDraft(sketchName === 'untitled sketch' ? '' : sketchName)
    setEditing(true)
  }

  function commit(): void {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed.length === 0 || trimmed === sketchName) return
    onRename(trimmed)
  }

  return (
```

Replace the existing static name span:

```tsx
        <span style={{ color: 'var(--ra-text-2)' }}>{sketchName}</span>
```

with:

```tsx
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            style={{
              fontSize: 12,
              padding: '1px 4px',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row)',
              color: 'var(--ra-text)'
            }}
          />
        ) : (
          <span
            onClick={startEditing}
            title="click to rename"
            style={{ color: 'var(--ra-text-2)', cursor: 'pointer' }}
          >
            {sketchName}
          </span>
        )}
        {renameError && (
          <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{renameError}</span>
        )}
```

- [ ] **Step 2: Wire rename logic into `App.tsx`'s `Frame`**

Add the import for `renameExternalSketchFile`'s IPC bridge is already covered by
`window.rifffApi` — no new import needed for that. Add new state right after
`lastSavedJsonRef` is defined in `Frame` (search for where `currentSketch`/
`setCurrentSketch` are declared in `Frame`, and add alongside them):

```ts
  const [renameError, setRenameError] = useState<string | null>(null)

  async function handleRename(newName: string): Promise<void> {
    setRenameError(null)
    if (currentSketch === null) {
      try {
        const json = serializeProject(state)
        await window.rifffApi.saveProjectToLibrary(newName, json)
        setCurrentSketch({ kind: 'library', name: newName })
        lastSavedJsonRef.current = json
      } catch (err) {
        console.error('Frame: failed to save project under new name:', err)
        setRenameError(err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (currentSketch.kind === 'library') {
      const result = await window.rifffApi.renameSketch(currentSketch.name, newName)
      if (!result.ok) {
        setRenameError(result.reason)
        return
      }
      setCurrentSketch({ kind: 'library', name: newName })
      return
    }
    const result = await window.rifffApi.renameExternalSketchFile(currentSketch.path, newName)
    if (!result.ok) {
      setRenameError(result.reason)
      return
    }
    setCurrentSketch({ kind: 'external', path: result.path })
  }
```

Update the `<Titlebar>` call site to pass the two new props:

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
              mode={state.mode}
              sketchEligible={isSketchEligible(state)}
              onCycleMode={() =>
                dispatch({ type: 'SET_ARRANGER_MODE', mode: nextArrangerMode(state) })
              }
              onRename={(newName) => void handleRename(newName)}
              renameError={renameError}
            />
```

- [ ] **Step 3: Typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: both clean.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

On a brand-new "untitled sketch" project, click the name in the top bar, type a name,
press Enter — confirm it saves to the library under that name and the top bar updates. On
a library-saved project, click the name, rename it, confirm the top bar updates and the
sketch still opens correctly afterward (Open → Library). Try renaming to an already-taken
name — confirm the rejection message appears and nothing changes. Press Escape while
editing — confirm it reverts with no rename. Quit (Cmd+Q) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Titlebar.tsx src/renderer/src/App.tsx
git commit -m "Click-to-rename the project name in the top bar"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (819 existing + 4 new `renameSketch` + 2 new
`renameExternalSketchFile` = 825).

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: both clean.

- [ ] **Step 3: Manual walkthrough (cannot be fully done by an agent — flag for Elling)**

Covers all three features together in one pass, since they all touch project identity:

1. Quit sssketch fully (Cmd+Q) if running, relaunch via `npm run dev`.
2. New → confirm the naming modal appears, edit the name, create — confirm the project
   library shows it under the typed name (Open → Library).
3. Import a couple of rifffs, export to Ableton without tidying — confirm the nudge
   appears; tidy up, export again — confirm no nudge the second time.
4. Click the project name in the top bar, rename it — confirm the library reflects the
   new name and the renamed sketch still opens, plays back, and (if it had one) still
   shows its previous Ableton export correctly associated (no "modified since last
   export" false warning from a stale `.als` name).
5. Open a project via the legacy "open" file dialog (an `external`-kind sketch) and try
   renaming it too, confirming the file on disk actually renamed.

- [ ] **Step 4: Commit if any fixes were needed during verification**

Only if Steps 1-3 above turned up something to fix — otherwise nothing to commit here.
