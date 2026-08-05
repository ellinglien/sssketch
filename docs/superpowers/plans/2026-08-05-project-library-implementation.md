# Project Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give sssketch an app-owned project library — routine Save/Export write in place with no
dialogs, a shared content-keyed sample cache with copy-on-write cloning avoids redundant
FLAC-decoding/copying across re-exports and duplicated sketch versions, and a new browser modal
lists what's there — per `docs/superpowers/specs/2026-08-05-project-library-design.md`.

**Architecture:** A new `src/main/projectLibrary.ts` owns all pure path/naming/caching logic
(library root resolution, per-sketch paths, cache-key derivation, copy-on-write cloning,
next-version-name computation, overwrite-safety mtime check). `projectFile.ts` and
`exportAbleton.ts` consume it to add library-aware save/export paths alongside their existing
dialog-based ones (kept as the "save a copy elsewhere" escape hatch). A new
`ProjectLibraryBrowser.tsx` modal (matching the existing `LoreLibraryBrowser`/
`PluginCatalogBrowser` pattern) lists sketches; `App.tsx` gains a `currentSketch` piece of state
tracking whether the open project is untitled, library-resident, or an externally-opened legacy
file, which determines whether Save/Export write in place or fall back to a dialog.

**Tech Stack:** Node's built-in `fs`/`crypto`/`path` (no new dependencies), `fs.copyFileSync`
with `COPYFILE_FICLONE` for APFS copy-on-write cloning, the existing native engine `bake-stem` IPC
command (unchanged), Electron's existing `app.getPath('music')`/`app.getPath('userData')`.

---

## Before you start

Two things this plan builds directly on top of, both already shipped on `master`:

1. **`src/main/exportAbleton.ts`** already has the WAV-vs-non-WAV split (`isWavPath`) and native
   `bake-stem` decode integration from the most recent Ableton export fix. This plan replaces its
   internal per-stem copy loop with a cache-first version but keeps `buildAndWriteAlsProject`'s
   own signature (`state, outputDir, projectName`) and the dialog-based `exportAbleton(win,
   state)` wrapper untouched as the escape hatch.
2. **`src/main/pluginCatalog.ts`** is the established pattern for "small JSON preference/state
   file in `app.getPath('userData')`" this plan's library-root preference follows exactly — read
   it if you want to see the pattern before Task 1.

---

### Task 1: `projectLibrary.ts` — core path/naming/caching logic

**Files:**
- Create: `src/main/projectLibrary.ts`
- Test: `src/main/projectLibrary.test.ts`

All pure/filesystem-light logic the rest of this feature depends on: where the library lives,
per-sketch paths, the shared sample cache's key derivation and copy-on-write cloning, computing
the next unused version name, and the per-sketch metadata used for the overwrite-safety check.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/projectLibrary.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

describe('projectLibrary', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('libraryRootPath / setLibraryRootPath', () => {
    it('defaults to <music>/sssketch when no preference has been set', async () => {
      const { libraryRootPath } = await import('./projectLibrary')
      expect(libraryRootPath()).toBe(join(musicDir, 'sssketch'))
    })

    it('returns a previously-set custom root', async () => {
      const { libraryRootPath, setLibraryRootPath } = await import('./projectLibrary')
      const customRoot = join(musicDir, 'elsewhere')
      setLibraryRootPath(customRoot)
      expect(libraryRootPath()).toBe(customRoot)
    })
  })

  describe('sketch path helpers', () => {
    it('derives every per-sketch path from the library root and sketch name', async () => {
      const { sketchDir, sketchProjectPath, sketchMetaPath, sketchAbletonDir, samplesCacheDir } =
        await import('./projectLibrary')
      const root = join(musicDir, 'sssketch')
      expect(sketchDir('my-sketch')).toBe(join(root, 'my-sketch'))
      expect(sketchProjectPath('my-sketch')).toBe(join(root, 'my-sketch', 'my-sketch.sssketchproj'))
      expect(sketchMetaPath('my-sketch')).toBe(join(root, 'my-sketch', '.sssketch-meta.json'))
      expect(sketchAbletonDir('my-sketch')).toBe(join(root, 'my-sketch', 'Ableton'))
      expect(samplesCacheDir()).toBe(join(root, '.samples-cache'))
    })
  })

  describe('isWavPath', () => {
    it('is true only for a .wav extension, case-insensitively', async () => {
      const { isWavPath } = await import('./projectLibrary')
      expect(isWavPath('/a/b/stem.wav')).toBe(true)
      expect(isWavPath('/a/b/stem.WAV')).toBe(true)
      expect(isWavPath('/a/b/9f8a7b2c1d')).toBe(false)
      expect(isWavPath('/a/b/stem.flac')).toBe(false)
    })
  })

  describe('stemCacheKey', () => {
    it('uses the basename directly for a non-WAV (LORE-cached) path', async () => {
      const { stemCacheKey } = await import('./projectLibrary')
      expect(stemCacheKey('/warehouse/cache/common/stem_v2/abc/d/9f8a7b2c1d')).toBe('9f8a7b2c1d')
    })

    it('derives a stable hash from path+size+mtime for a .wav path', async () => {
      const { stemCacheKey } = await import('./projectLibrary')
      const wavPath = join(userDataDir, 'a.wav')
      writeFileSync(wavPath, 'fake wav bytes')
      const key1 = stemCacheKey(wavPath)
      const key2 = stemCacheKey(wavPath)
      expect(key1).toBe(key2)
      expect(key1).toMatch(/^[a-f0-9]+$/)
    })

    it('produces a different key when the wav file content/size changes', async () => {
      const { stemCacheKey } = await import('./projectLibrary')
      const wavPath = join(userDataDir, 'b.wav')
      writeFileSync(wavPath, 'short')
      const keyBefore = stemCacheKey(wavPath)
      writeFileSync(wavPath, 'a much longer set of fake wav bytes than before')
      const keyAfter = stemCacheKey(wavPath)
      expect(keyBefore).not.toBe(keyAfter)
    })
  })

  describe('cachedStemPath', () => {
    it('joins the cache dir with the derived key and a .wav extension', async () => {
      const { cachedStemPath, samplesCacheDir } = await import('./projectLibrary')
      const path = cachedStemPath('/warehouse/cache/common/stem_v2/abc/d/9f8a7b2c1d')
      expect(path).toBe(join(samplesCacheDir(), '9f8a7b2c1d.wav'))
    })
  })

  describe('cloneOrCopy', () => {
    it('produces an independent file with the same content as the source', async () => {
      const { cloneOrCopy } = await import('./projectLibrary')
      const src = join(userDataDir, 'src.wav')
      const dest = join(userDataDir, 'dest.wav')
      writeFileSync(src, 'clone me')
      cloneOrCopy(src, dest)
      expect(readFileSync(dest, 'utf-8')).toBe('clone me')
    })
  })

  describe('listLibrarySketches', () => {
    it('returns an empty array when the library root does not exist yet', async () => {
      const { listLibrarySketches } = await import('./projectLibrary')
      expect(listLibrarySketches()).toEqual([])
    })

    it('lists only subfolders containing a matching .sssketchproj, excluding .samples-cache', async () => {
      const { listLibrarySketches, libraryRootPath } = await import('./projectLibrary')
      const root = libraryRootPath()
      mkdirSync(join(root, 'sketch-a'), { recursive: true })
      writeFileSync(join(root, 'sketch-a', 'sketch-a.sssketchproj'), '{}')
      mkdirSync(join(root, 'sketch-b'), { recursive: true })
      writeFileSync(join(root, 'sketch-b', 'sketch-b.sssketchproj'), '{}')
      mkdirSync(join(root, '.samples-cache'), { recursive: true })
      mkdirSync(join(root, 'empty-folder'), { recursive: true })

      const sketches = listLibrarySketches()
      expect(sketches.map((s) => s.name).sort()).toEqual(['sketch-a', 'sketch-b'])
    })
  })

  describe('nextVersionName', () => {
    it('appends -2 to a base name with no existing numbered siblings', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      expect(nextVersionName('outdoor-jam', [])).toBe('outdoor-jam-2')
    })

    it('finds the next unused number when some already exist', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      expect(nextVersionName('outdoor-jam', ['outdoor-jam', 'outdoor-jam-2'])).toBe('outdoor-jam-3')
    })

    it('strips an existing trailing -N from the base before computing, so duplicating a duplicate does not stack suffixes', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      expect(nextVersionName('outdoor-jam-2', ['outdoor-jam', 'outdoor-jam-2'])).toBe('outdoor-jam-3')
    })
  })

  describe('sketch meta / overwrite safety', () => {
    it('readSketchMeta returns an empty object when no meta file exists', async () => {
      const { readSketchMeta } = await import('./projectLibrary')
      expect(readSketchMeta('nonexistent-sketch')).toEqual({})
    })

    it('writeSketchMeta then readSketchMeta round-trips', async () => {
      const { writeSketchMeta, readSketchMeta } = await import('./projectLibrary')
      writeSketchMeta('a-sketch', { lastExportAlsMtimeMs: 12345 })
      expect(readSketchMeta('a-sketch')).toEqual({ lastExportAlsMtimeMs: 12345 })
    })

    it('shouldWarnBeforeOverwrite is false when no .als has ever been exported', async () => {
      const { shouldWarnBeforeOverwrite } = await import('./projectLibrary')
      expect(shouldWarnBeforeOverwrite('never-exported')).toBe(false)
    })

    it('shouldWarnBeforeOverwrite is false when the .als mtime matches the last recorded export', async () => {
      const { shouldWarnBeforeOverwrite, sketchAbletonDir, writeSketchMeta } =
        await import('./projectLibrary')
      const { statSync } = await import('node:fs')
      const dir = sketchAbletonDir('matching-sketch')
      mkdirSync(dir, { recursive: true })
      const alsPath = join(dir, 'matching-sketch.als')
      writeFileSync(alsPath, 'fake als bytes')
      const mtimeMs = statSync(alsPath).mtimeMs
      writeSketchMeta('matching-sketch', { lastExportAlsMtimeMs: mtimeMs })
      expect(shouldWarnBeforeOverwrite('matching-sketch')).toBe(false)
    })

    it('shouldWarnBeforeOverwrite is true when the .als has been modified since the last recorded export', async () => {
      const { shouldWarnBeforeOverwrite, sketchAbletonDir, writeSketchMeta } =
        await import('./projectLibrary')
      const dir = sketchAbletonDir('touched-sketch')
      mkdirSync(dir, { recursive: true })
      const alsPath = join(dir, 'touched-sketch.als')
      writeFileSync(alsPath, 'fake als bytes')
      writeSketchMeta('touched-sketch', { lastExportAlsMtimeMs: 1 }) // deliberately stale
      expect(shouldWarnBeforeOverwrite('touched-sketch')).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/projectLibrary.test.ts`
Expected: FAIL — `Cannot find module './projectLibrary'`

- [ ] **Step 3: Implement**

```typescript
// src/main/projectLibrary.ts
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  copyFileSync,
  constants
} from 'node:fs'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'

const LIBRARY_PREFS_FILENAME = 'libraryPrefs.json'

function libraryPrefsPath(): string {
  return join(app.getPath('userData'), LIBRARY_PREFS_FILENAME)
}

function defaultLibraryRoot(): string {
  return join(app.getPath('music'), 'sssketch')
}

/** Where every sketch's own subfolder lives -- user-relocatable (see
 * setLibraryRootPath), defaulting to `<Music>/sssketch`. Read fresh every
 * call rather than cached, matching pluginCatalog.ts's own loadCatalog
 * convention -- this is a rarely-called, cheap file read, not a hot path. */
export function libraryRootPath(): string {
  const path = libraryPrefsPath()
  if (!existsSync(path)) return defaultLibraryRoot()
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? defaultLibraryRoot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`libraryRootPath: failed to read ${path}: ${message}`)
    return defaultLibraryRoot()
  }
}

export function setLibraryRootPath(newRoot: string): void {
  try {
    writeFileSync(libraryPrefsPath(), JSON.stringify({ root: newRoot }, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`setLibraryRootPath: failed to write ${libraryPrefsPath()}: ${message}`)
  }
}

export function sketchDir(name: string): string {
  return join(libraryRootPath(), name)
}

export function sketchProjectPath(name: string): string {
  return join(sketchDir(name), `${name}.sssketchproj`)
}

export function sketchMetaPath(name: string): string {
  return join(sketchDir(name), '.sssketch-meta.json')
}

export function sketchAbletonDir(name: string): string {
  return join(sketchDir(name), 'Ableton')
}

/** The one cache shared by every sketch's Ableton export, keyed by stem
 * identity (see stemCacheKey) -- see docs/superpowers/specs/
 * 2026-08-05-project-library-design.md for the full rationale. */
export function samplesCacheDir(): string {
  return join(libraryRootPath(), '.samples-cache')
}

// A hard, reliable split rather than a probe/fallback -- matches
// bakeOffset.ts's and exportAbleton.ts's own isWavPath exactly: a regular
// drag-and-drop import is always a WAV, while a LORE-cached stem's path is
// the raw StemCID with no extension. Consolidated here since both
// exportAbleton.ts's copy-vs-decode branch and this module's own
// stemCacheKey need the identical distinction.
export function isWavPath(path: string): boolean {
  return path.toLowerCase().endsWith('.wav')
}

/** A stable identifier for a stem's own source audio, used as the shared
 * cache's filename (see cachedStemPath). A LORE-cached stem's path is
 * already `.../<StemCID>` with no extension -- StemCID is already a
 * globally unique, stable, filesystem-safe identifier (see
 * loreWarehouse.ts's resolveStemPath), so its basename is used directly, no
 * hashing needed. A drag-and-dropped WAV has no such stable ID, so a hash
 * of (path, size, mtime) stands in -- good enough to detect "the same file
 * as before" without reading/hashing its full contents. */
export function stemCacheKey(stemPath: string): string {
  if (isWavPath(stemPath)) {
    const stat = statSync(stemPath)
    return createHash('sha1').update(`${stemPath}:${stat.size}:${stat.mtimeMs}`).digest('hex')
  }
  return basename(stemPath)
}

export function cachedStemPath(stemPath: string): string {
  return join(samplesCacheDir(), `${stemCacheKey(stemPath)}.wav`)
}

/** Clones `src` to `dest` via APFS copy-on-write when the volume supports
 * it (near-instant, no extra disk space until either copy is later
 * modified independently) -- COPYFILE_FICLONE is documented to fall back
 * to a normal full copy automatically when the filesystem doesn't support
 * cloning (e.g. a non-APFS external drive), so no separate fallback branch
 * is needed here. */
export function cloneOrCopy(src: string, dest: string): void {
  copyFileSync(src, dest, constants.COPYFILE_FICLONE)
}

export interface LibrarySketchSummary {
  name: string
  mtimeMs: number
}

/** Scans the library root for sketch subfolders -- a folder counts only if
 * it contains a `<name>.sssketchproj` matching its own folder name, which
 * excludes `.samples-cache` (no such file inside it) and any stray empty
 * folder without needing an explicit denylist. Newest-first, by the
 * project file's own mtime. */
export function listLibrarySketches(): LibrarySketchSummary[] {
  const root = libraryRootPath()
  if (!existsSync(root)) return []
  const entries = readdirSync(root, { withFileTypes: true })
  const sketches: LibrarySketchSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectPath = join(root, entry.name, `${entry.name}.sssketchproj`)
    if (!existsSync(projectPath)) continue
    sketches.push({ name: entry.name, mtimeMs: statSync(projectPath).mtimeMs })
  }
  return sketches.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** Computes the next unused `<root>-N` name for "duplicate as new version",
 * given the current sketch's own name and every existing library sketch
 * name. Strips any trailing `-<number>` from `baseName` first, so
 * duplicating an already-numbered version (e.g. "outdoor-jam-2") continues
 * the SAME sequence ("outdoor-jam-3") instead of stacking a second suffix
 * ("outdoor-jam-2-2"). */
export function nextVersionName(baseName: string, existingNames: string[]): string {
  const root = baseName.replace(/-\d+$/, '')
  const existing = new Set(existingNames)
  let n = 2
  while (existing.has(`${root}-${n}`)) n++
  return `${root}-${n}`
}

export interface SketchMeta {
  /** The exported .als file's own mtime at the moment sssketch itself last
   * wrote it -- see shouldWarnBeforeOverwrite. */
  lastExportAlsMtimeMs?: number
}

export function readSketchMeta(name: string): SketchMeta {
  const path = sketchMetaPath(name)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SketchMeta
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`readSketchMeta: failed to read ${path}: ${message}`)
    return {}
  }
}

export function writeSketchMeta(name: string, meta: SketchMeta): void {
  try {
    writeFileSync(sketchMetaPath(name), JSON.stringify(meta, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeSketchMeta: failed to write ${sketchMetaPath(name)}: ${message}`)
  }
}

/** True when a routine re-export would silently overwrite an .als that's
 * been modified outside sssketch (almost certainly Ableton itself, saving
 * the user's own mixing work) since the last time sssketch wrote it. False
 * -- proceed without prompting -- both when there's no .als yet and when
 * there's no recorded prior export (a missing/corrupt meta file is treated
 * as "no prior export", never a hard failure: the worst case is one
 * unprompted overwrite, which is today's existing, already-accepted
 * behavior, not a regression). */
export function shouldWarnBeforeOverwrite(name: string): boolean {
  const alsPath = join(sketchAbletonDir(name), `${name}.als`)
  if (!existsSync(alsPath)) return false
  const meta = readSketchMeta(name)
  if (meta.lastExportAlsMtimeMs === undefined) return false
  return statSync(alsPath).mtimeMs !== meta.lastExportAlsMtimeMs
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/projectLibrary.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/projectLibrary.ts src/main/projectLibrary.test.ts
git commit -m "Add projectLibrary.ts: library paths, shared sample cache, versioning, overwrite safety"
```

---

### Task 2: `projectFile.ts` — emoji naming + library-aware save/open/duplicate

**Files:**
- Modify: `src/main/projectFile.ts`
- Modify: `src/main/projectFile.test.ts`

Adds an emoji prefix to `generateDefaultProjectName`, and three new library-aware operations
alongside the existing dialog-based `saveProjectAs`/`openProject` (both kept unchanged as the
"save/open a copy elsewhere" escape hatch).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/main/projectFile.test.ts` with the following — it keeps the
existing `generateDefaultProjectName` tests (updated for the new emoji prefix) and adds a new
describe block for the library-aware functions:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateDefaultProjectName } from './projectFile'

// vi.mock calls are hoisted to the top of the file by vitest's own
// transform, but ONLY when they're a top-level statement (not nested
// inside a describe/beforeEach callback) -- must sit here, matching
// pluginCatalog.test.ts's own exact placement, not nested further down.
// generateDefaultProjectName itself never calls app.getPath, so this mock
// being globally active for the whole file doesn't affect its own tests
// below -- it's simply unused for those.
let userDataDir: string
let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

describe('generateDefaultProjectName', () => {
  it('formats as an emoji + YYYY-MM-DD-adjective-noun for a given date', () => {
    const name = generateDefaultProjectName(new Date(2026, 7, 1)) // August 1, 2026
    expect(name).toMatch(/^\p{Extended_Pictographic}-2026-08-01-[a-z]+-[a-z]+$/u)
  })

  it('zero-pads single-digit month and day', () => {
    const name = generateDefaultProjectName(new Date(2026, 0, 5)) // January 5, 2026
    expect(name).toMatch(/^\p{Extended_Pictographic}-2026-01-05-[a-z]+-[a-z]+$/u)
  })

  it('varies the adjective-noun pair across calls (not a fixed pair)', () => {
    const date = new Date(2026, 7, 1)
    const names = new Set(Array.from({ length: 20 }, () => generateDefaultProjectName(date)))
    expect(names.size).toBeGreaterThan(1)
  })

  it('varies the emoji across calls (not a fixed one)', () => {
    const date = new Date(2026, 7, 1)
    const emojis = new Set(
      Array.from({ length: 30 }, () => generateDefaultProjectName(date).split('-')[0])
    )
    expect(emojis.size).toBeGreaterThan(1)
  })
})

describe('library-aware project functions', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('saveProjectToLibrary', () => {
    it('creates the sketch folder and writes the project file, no dialog involved', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { sketchProjectPath } = await import('./projectLibrary')
      const result = saveProjectToLibrary('my-sketch', '{"bpm":120}')
      expect(result.path).toBe(sketchProjectPath('my-sketch'))
      expect(existsSync(result.path)).toBe(true)
      expect(readFileSync(result.path, 'utf-8')).toBe('{"bpm":120}')
    })

    it('overwrites in place on a second call with the same name', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      saveProjectToLibrary('my-sketch', '{"bpm":120}')
      const result = saveProjectToLibrary('my-sketch', '{"bpm":140}')
      expect(readFileSync(result.path, 'utf-8')).toBe('{"bpm":140}')
    })
  })

  describe('saveProjectInPlace', () => {
    it('writes json directly to the given path with no dialog', async () => {
      const { saveProjectInPlace } = await import('./projectFile')
      const path = join(userDataDir, 'external.sssketchproj')
      saveProjectInPlace(path, '{"bpm":100}')
      expect(readFileSync(path, 'utf-8')).toBe('{"bpm":100}')
    })
  })

  describe('openLibrarySketch', () => {
    it('reads back a previously-saved library sketch', async () => {
      const { saveProjectToLibrary, openLibrarySketch } = await import('./projectFile')
      saveProjectToLibrary('readback-sketch', '{"bpm":90}')
      const result = openLibrarySketch('readback-sketch')
      expect(result).not.toBeNull()
      expect(result!.json).toBe('{"bpm":90}')
    })

    it('returns null for a sketch that does not exist', async () => {
      const { openLibrarySketch } = await import('./projectFile')
      expect(openLibrarySketch('nonexistent')).toBeNull()
    })
  })

  describe('duplicateSketchAsNewVersion', () => {
    it('copies the current sketch json into a new -2 named sketch', async () => {
      const { saveProjectToLibrary, duplicateSketchAsNewVersion, openLibrarySketch } =
        await import('./projectFile')
      saveProjectToLibrary('outdoor-jam', '{"bpm":128}')
      const result = duplicateSketchAsNewVersion('outdoor-jam')
      expect(result).not.toBeNull()
      expect(result!.name).toBe('outdoor-jam-2')
      const reopened = openLibrarySketch('outdoor-jam-2')
      expect(reopened!.json).toBe('{"bpm":128}')
    })

    it('returns null when the source sketch does not exist', async () => {
      const { duplicateSketchAsNewVersion } = await import('./projectFile')
      expect(duplicateSketchAsNewVersion('does-not-exist')).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/projectFile.test.ts`
Expected: FAIL — `generateDefaultProjectName` tests fail the emoji regex match; the new describe
block fails with `saveProjectToLibrary is not a function` etc.

- [ ] **Step 3: Implement**

Modify `src/main/projectFile.ts`:

1. Add the import (near the top, alongside the existing `fs`/`electron` imports):

```typescript
import {
  sketchDir,
  sketchProjectPath,
  listLibrarySketches,
  nextVersionName
} from './projectLibrary'
import { mkdirSync } from 'fs'
```

(Note: `readFileSync, writeFileSync, existsSync, unlinkSync` are already imported from `'fs'` at
the top of this file — just add `mkdirSync` to that same existing import list rather than a
second `from 'fs'` line.)

2. Add an `EMOJIS` array right after the existing `NOUNS` array:

```typescript
// Matches ADJECTIVES/NOUNS's own tasteful, music/creative tone above.
// Randomly prefixed onto every generated name (see generateDefaultProjectName)
// -- purely cosmetic personality/glanceability in the library list, not
// load-bearing for anything else.
const EMOJIS = [
  '🎵', '🎶', '🎸', '🎹', '🥁', '🎧', '🎤', '🌊', '🔥', '✨',
  '🌙', '⚡', '🍃', '🌀', '🔮', '💫', '🌈', '🪐'
]
```

3. Modify `generateDefaultProjectName` to prepend a random emoji:

```typescript
/** Generates a default project filename (without extension), following the
 * pattern `emoji-YYYY-MM-DD-adjective-noun` -- e.g.
 * "🌙-2026-08-01-groovy-sparrow". `date` is injectable for deterministic
 * tests; defaults to now. The emoji is deliberately placed BEFORE the date
 * (not after) -- this means library folders no longer sort chronologically
 * by default in Finder the way the date-first scheme alone would; accepted
 * as a known, easily-reversible tradeoff (see design spec's Naming
 * section). */
export function generateDefaultProjectName(date: Date = new Date()): string {
  const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)]
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${emoji}-${dateStr}-${adjective}-${noun}`
}
```

4. Add three new exported functions after the existing `saveProjectAs` function (leave
   `saveProjectAs` itself completely unchanged — it's the dialog-based "save a copy elsewhere"
   escape hatch):

```typescript
/** Writes json directly to path, no dialog -- the shared write-and-clear-
 * autosave behavior saveProjectAs (dialog-based) and saveProjectToLibrary
 * (library-based) both need, extracted so neither duplicates it. */
export function saveProjectInPlace(path: string, json: string): void {
  writeFileSync(path, json, 'utf-8')
  clearAutosave()
}

/** Routine, no-dialog save for a library-resident sketch -- creates the
 * sketch's own folder on first save, overwrites in place on every
 * subsequent one. See docs/superpowers/specs/
 * 2026-08-05-project-library-design.md. */
export function saveProjectToLibrary(name: string, json: string): { path: string } {
  mkdirSync(sketchDir(name), { recursive: true })
  const path = sketchProjectPath(name)
  saveProjectInPlace(path, json)
  return { path }
}

/** Reads back a library sketch's own project file, by name -- the
 * dialog-free counterpart to openProject, used by the new Project Library
 * browser. Returns null (not a thrown error) if the sketch doesn't exist
 * or its file can't be read, matching openProject's own convention. */
export function openLibrarySketch(name: string): { path: string; json: string } | null {
  const path = sketchProjectPath(name)
  if (!existsSync(path)) return null
  try {
    return { path, json: readFileSync(path, 'utf-8') }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`openLibrarySketch: failed to read ${path}: ${message}`)
    return null
  }
}

/** "Duplicate as new version": copies currentName's own project JSON
 * verbatim into a freshly-computed `<name>-N` sketch. Nothing audio-related
 * is copied here -- the project file is just JSON pointers to source stem
 * paths; the new sketch's own NEXT Ableton export benefits from the shared
 * sample cache automatically (see projectLibrary.ts), no special-casing
 * needed at this layer. Returns null if currentName isn't an existing
 * library sketch. */
export function duplicateSketchAsNewVersion(currentName: string): { name: string; path: string } | null {
  const source = openLibrarySketch(currentName)
  if (!source) return null
  const newName = nextVersionName(currentName, listLibrarySketches().map((s) => s.name))
  return { name: newName, ...saveProjectToLibrary(newName, source.json) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/projectFile.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS (no other suite touches projectFile.ts's changed exports)

- [ ] **Step 6: Commit**

```bash
git add src/main/projectFile.ts src/main/projectFile.test.ts
git commit -m "Add emoji-prefixed naming and library-aware save/open/duplicate to projectFile.ts"
```

---

### Task 3: `exportAbleton.ts` — shared cache integration + library export

**Files:**
- Modify: `src/main/exportAbleton.ts`

Replaces the current per-stem WAV-copy/native-decode loop with a cache-first version (materialize
into the shared cache once, then clone out — see Task 1's `cloneOrCopy`/`cachedStemPath`), clears
`Samples/Imported/` before repopulating so removed stems don't linger, and adds
`exportAbletonToLibrary` alongside the existing dialog-based `exportAbleton` (kept unchanged as
the "export a copy elsewhere" escape hatch).

- [ ] **Step 1: Implement**

Replace the entire contents of `src/main/exportAbleton.ts` with:

```typescript
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename, dirname } from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { stemKey } from '@shared/types'
// electron-vite's own Node-asset mechanism -- resolves to a real filesystem
// path in both dev and packaged builds, matching this file's own precedent
// (see index.ts's `import icon from '../../resources/icon.png?asset'`).
// Deliberately NOT imported by buildAlsXml.ts or its tests, which take the
// template text as a plain parameter instead -- vitest has no electron-vite
// plugin loaded to understand `?asset`, only the real Electron main build does.
import templatePath from './ableton/template.xml?asset'
import { buildAlsXml } from './ableton/buildAlsXml'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'
import {
  isWavPath,
  cachedStemPath,
  cloneOrCopy,
  samplesCacheDir,
  sketchAbletonDir,
  writeSketchMeta
} from './projectLibrary'

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux -- matches nativeExport.ts's own
// sanitizeFileNamePart exactly (duplicated rather than imported: it's not
// exported from that module, and it's a five-line pure function -- not worth
// coupling these two independent export features over).
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/** Materializes one stem's audio at `destPath`, via the shared cache (see
 * projectLibrary.ts's cachedStemPath/cloneOrCopy): if this stem's own
 * cache entry already exists (same source path+size+mtime, or same LORE
 * StemCID), it's cloned straight out -- no re-read of the source, no
 * re-decode. Otherwise it's materialized into the cache first (a WAV
 * source is a plain copy; anything else -- a LORE-cached stem, whose
 * actual on-disk bytes are Endlesss's own storage codec, confirmed FLAC --
 * is decoded via the native engine's bake-stem command, which needs
 * `client` to be connected), then cloned out the same way. Returns false
 * (caller should drop this stem from the export) on any failure, including
 * "needed to decode but no engine connection was available". */
async function materializeStem(
  path: string,
  destPath: string,
  client: EngineClient | null
): Promise<boolean> {
  const cachePath = cachedStemPath(path)
  if (!existsSync(cachePath)) {
    if (isWavPath(path)) {
      copyFileSync(path, cachePath)
    } else {
      if (!client) return false
      const result = (await client.sendAndAwaitType(
        'bake-stem',
        { path, rotationSec: 0, outputPath: cachePath },
        'bake-stem-result'
      )) as { success: boolean; error?: string }
      if (!result.success) {
        console.error(`materializeStem: native decode failed for ${path}: ${result.error}`)
        return false
      }
    }
  }
  cloneOrCopy(cachePath, destPath)
  return true
}

/**
 * Materializes every placed stem's source audio into
 * `<outputDir>/Samples/Imported/` (via the shared cache -- see
 * materializeStem), builds the .als XML, gzips it, and writes
 * `<outputDir>/<projectName>.als`. A stem whose source file can't be
 * copied/decoded is logged and skipped (its clip is simply absent from the
 * export) rather than failing the whole export -- matching this
 * codebase's existing "don't fail the whole export over one bad piece"
 * convention (see buildEngineProject.ts's rubberband-failure fallback).
 * Throws if no rifff is placed at all (nothing to export) or if the
 * checked-in template can't be read (should never happen in practice).
 *
 * `Samples/Imported/` is cleared before repopulating -- otherwise a stem
 * removed from the arrangement since the last export into this SAME
 * outputDir would leave its old copy orphaned there forever. This only
 * touches this one export's own destination folder, never the shared
 * cache itself (other sketches/versions may still reference those cached
 * files).
 */
export async function buildAndWriteAlsProject(
  state: AppState,
  outputDir: string,
  projectName: string
): Promise<void> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  if (placed.length === 0) {
    throw new Error('Nothing to export -- no rifffs are placed on the timeline.')
  }

  const samplesDir = join(outputDir, 'Samples', 'Imported')
  rmSync(samplesDir, { recursive: true, force: true })
  mkdirSync(samplesDir, { recursive: true })
  mkdirSync(samplesCacheDir(), { recursive: true })

  const stemFileNames = new Map<string, string>()
  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  const stemEntries: { key: string; path: string; destPath: string }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const fileName = uniqueFileName(rifff.name, stem.name)
      const entry = {
        key: stemKey(rifff.groupId, stem.slot),
        path: stem.path,
        destPath: join(samplesDir, fileName)
      }
      stemEntries.push(entry)
      stemFileNames.set(entry.key, fileName)
    }
  }

  // Only spawn the native engine at all if at least one stem actually needs
  // decoding -- if every stem is already cached from a prior export, this
  // export needs no engine process whatsoever.
  const needsEngine = stemEntries.some(
    ({ path }) => !isWavPath(path) && !existsSync(cachedStemPath(path))
  )
  let client: EngineClient | null = null
  let engineHandle: EngineHandle | null = null
  if (needsEngine) {
    engineHandle = await spawnEngine()
    client = new EngineClient()
    await client.connect(engineHandle.port)
  }
  try {
    for (const { key, path, destPath } of stemEntries) {
      try {
        const ok = await materializeStem(path, destPath, client)
        if (!ok) stemFileNames.delete(key)
      } catch (err) {
        stemFileNames.delete(key)
        console.error(`buildAndWriteAlsProject: failed to materialize stem from ${path}:`, err)
      }
    }
  } finally {
    client?.disconnect()
    engineHandle?.stop()
  }

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames)
  const gzipped = gzipSync(Buffer.from(alsXml, 'utf-8'))
  writeFileSync(join(outputDir, `${projectName}.als`), gzipped)
}

/**
 * Routine, no-dialog Ableton export for a library-resident sketch: writes
 * into that sketch's own `Ableton/` folder in place, then records the
 * freshly-written .als's mtime (see projectLibrary.ts's writeSketchMeta)
 * so the next export can detect whether it's been touched outside
 * sssketch since (shouldWarnBeforeOverwrite) -- the caller is expected to
 * have already checked that and confirmed with the user BEFORE calling
 * this, the same way App.tsx's handleNew owns its own window.confirm
 * rather than pushing that into the main process.
 */
export async function exportAbletonToLibrary(state: AppState, libraryName: string): Promise<void> {
  const abletonDir = sketchAbletonDir(libraryName)
  mkdirSync(abletonDir, { recursive: true })
  await buildAndWriteAlsProject(state, abletonDir, libraryName)
  const alsPath = join(abletonDir, `${libraryName}.als`)
  writeSketchMeta(libraryName, { lastExportAlsMtimeMs: statSync(alsPath).mtimeMs })
}

/**
 * Opens a save dialog (choosing the .als file's own name/location), then
 * builds the whole self-contained project folder around it -- the
 * "export a copy elsewhere" escape hatch, for sharing a fully standalone
 * copy outside the library. Mirrors exportMixToWav's cancel handling
 * (resolves null on a cancelled dialog), but NOT its failure handling: a
 * real failure here throws/rejects rather than being caught and resolved
 * as null, matching nativeExport.ts's own throw-and-let-the-renderer-catch
 * convention (see App.tsx's handleExportMix, which already try/catches +
 * window.alerts for exactly this) -- deliberately not swallowed the way
 * exportMixToWav's write failure is.
 */
export async function exportAbleton(win: BrowserWindow, state: AppState): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Ableton Live Set', extensions: ['als'] }],
    defaultPath: 'sssketch-export.als'
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.als')
  await buildAndWriteAlsProject(state, outputDir, projectName)
  return result.filePath
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run the existing Ableton export test suite to check for regressions**

Run: `npx vitest run src/main/ableton/`
Expected: PASS — `buildAlsXml.ts`/`alsXmlHelpers.ts` are unchanged by this task, only their
caller (`exportAbleton.ts`, itself untested at this layer per this codebase's convention) changed.

- [ ] **Step 4: Lint**

Run: `npx eslint src/main/exportAbleton.ts`
Expected: no errors (fix any `prettier/prettier` formatting warnings with `npx eslint --fix
src/main/exportAbleton.ts` if they appear)

- [ ] **Step 5: Commit**

```bash
git add src/main/exportAbleton.ts
git commit -m "Route Ableton export stems through the shared sample cache, add library export"
```

---

### Task 4: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

Wires every new `projectFile.ts`/`projectLibrary.ts`/`exportAbleton.ts` function onto the IPC
bridge, following this file's own existing one-line-per-channel convention exactly. The existing
`save-project`/`open-project`/`export-als` channels are untouched (still the dialog-based escape
hatches).

- [ ] **Step 1: Implement — `src/main/index.ts`**

Modify the import block (around line 10-16) to add the new functions:

```typescript
import {
  saveProjectAs,
  openProject,
  writeAutosave,
  loadAutosave,
  clearAutosave,
  saveProjectToLibrary,
  saveProjectInPlace,
  openLibrarySketch,
  duplicateSketchAsNewVersion
} from './projectFile'
```

Modify the `exportAbleton` import (around line 19) to also pull in the new library export:

```typescript
import { exportAbleton, exportAbletonToLibrary } from './exportAbleton'
```

Add a new import line for `projectLibrary.ts`'s browser-facing functions:

```typescript
import {
  listLibrarySketches,
  libraryRootPath,
  setLibraryRootPath,
  shouldWarnBeforeOverwrite
} from './projectLibrary'
```

Add these new handlers directly after the existing `export-als` handler (around line 246, right
before the `try { playbackEngine = await startPlaybackEngine() ... }` block):

```typescript
  ipcMain.handle('save-project-to-library', (_event, name: string, json: string) =>
    saveProjectToLibrary(name, json)
  )

  ipcMain.handle('save-project-in-place', (_event, path: string, json: string) =>
    saveProjectInPlace(path, json)
  )

  ipcMain.handle('open-library-sketch', (_event, name: string) => openLibrarySketch(name))

  ipcMain.handle('duplicate-sketch', (_event, currentName: string) =>
    duplicateSketchAsNewVersion(currentName)
  )

  ipcMain.handle('list-library-sketches', () => listLibrarySketches())

  ipcMain.handle('get-library-root', () => libraryRootPath())

  ipcMain.handle('set-library-root', (_event, newRoot: string) => setLibraryRootPath(newRoot))

  ipcMain.handle('should-warn-before-ableton-overwrite', (_event, libraryName: string) =>
    shouldWarnBeforeOverwrite(libraryName)
  )

  ipcMain.handle('export-als-to-library', async (_event, stateJson: string, libraryName: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportAbletonToLibrary(state, libraryName)
  })
```

- [ ] **Step 2: Implement — `src/preload/index.ts`**

Add these entries to the `api` object, directly after the existing `exportAls` entry (after line
44):

```typescript
  saveProjectToLibrary: (name: string, json: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('save-project-to-library', name, json),
  saveProjectInPlace: (path: string, json: string): Promise<void> =>
    ipcRenderer.invoke('save-project-in-place', path, json),
  openLibrarySketch: (name: string): Promise<{ path: string; json: string } | null> =>
    ipcRenderer.invoke('open-library-sketch', name),
  duplicateSketch: (currentName: string): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke('duplicate-sketch', currentName),
  listLibrarySketches: (): Promise<{ name: string; mtimeMs: number }[]> =>
    ipcRenderer.invoke('list-library-sketches'),
  getLibraryRoot: (): Promise<string> => ipcRenderer.invoke('get-library-root'),
  setLibraryRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('set-library-root', newRoot),
  shouldWarnBeforeAbletonOverwrite: (libraryName: string): Promise<boolean> =>
    ipcRenderer.invoke('should-warn-before-ableton-overwrite', libraryName),
  exportAlsToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-als-to-library', stateJson, libraryName),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Lint**

Run: `npx eslint src/main/index.ts src/preload/index.ts`
Expected: no errors (fix formatting with `--fix` if needed)

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire project library IPC handlers and preload bridge"
```

---

### Task 5: `ProjectLibraryBrowser.tsx` — new browser modal

**Files:**
- Create: `src/renderer/src/components/ProjectLibraryBrowser.tsx`

A modal listing every library sketch (name, last-modified), following
`PluginCatalogBrowser.tsx`'s exact modal-overlay/scrollable-panel/list-row pattern (see that file
for the established shape this mirrors). Clicking a row opens that sketch. A small "change
library location…" link at the bottom reuses the already-existing `pickFolder` IPC (no new
folder-picker dialog needed).

- [ ] **Step 1: Implement**

```typescript
// src/renderer/src/components/ProjectLibraryBrowser.tsx
import { useEffect, useState } from 'react'

interface LibrarySketchSummary {
  name: string
  mtimeMs: number
}

// See PluginCatalogBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
function buttonStyle(disabled?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '3px 8px',
    background: 'var(--ra-bg-row-active)',
    border: `1px solid ${disabled ? 'var(--ra-border-soft)' : 'var(--ra-border)'}`,
    borderRadius: 2,
    color: disabled ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
    cursor: disabled ? 'default' : 'pointer'
  }
}

function formatMtime(mtimeMs: number): string {
  return new Date(mtimeMs).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export function ProjectLibraryBrowser({
  onSelect,
  onClose
}: {
  onSelect: (name: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [sketches, setSketches] = useState<LibrarySketchSummary[] | null>(null)
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null)

  useEffect(() => {
    void window.rifffApi.listLibrarySketches().then(setSketches)
    void window.rifffApi.getLibraryRoot().then(setLibraryRoot)
  }, [])

  async function handleChangeLocation(): Promise<void> {
    const newRoot = await window.rifffApi.pickFolder()
    if (!newRoot) return
    await window.rifffApi.setLibraryRoot(newRoot)
    setLibraryRoot(newRoot)
    setSketches(await window.rifffApi.listLibrarySketches())
  }

  return (
    <div
      onClick={onClose}
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
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 4,
          padding: 10,
          width: 420,
          minHeight: 0,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          fontSize: 11
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8
          }}
        >
          <span style={{ color: 'var(--ra-text-2)' }}>project library</span>
          <button onClick={onClose} aria-label="Close project library" style={buttonStyle()}>
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {sketches === null && (
            <div style={{ color: 'var(--ra-text-2)', padding: '8px 0' }}>loading…</div>
          )}
          {sketches !== null && sketches.length === 0 && (
            <div style={{ color: 'var(--ra-text-2)', padding: '8px 0' }}>
              no sketches saved to the library yet
            </div>
          )}
          {sketches?.map((sketch) => (
            <div
              key={sketch.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0'
              }}
            >
              <span style={{ flex: 1, color: 'var(--ra-text)' }}>{sketch.name}</span>
              <span style={{ color: 'var(--ra-text-4)', fontSize: 9 }}>
                {formatMtime(sketch.mtimeMs)}
              </span>
              <button
                onClick={() => {
                  onSelect(sketch.name)
                  onClose()
                }}
                aria-label={`open ${sketch.name}`}
                style={buttonStyle()}
              >
                open
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--ra-border-soft)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span style={{ color: 'var(--ra-text-4)', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {libraryRoot ?? ''}
          </span>
          <button onClick={handleChangeLocation} style={buttonStyle()}>
            change location…
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: FAIL — `window.rifffApi.listLibrarySketches` etc. not yet declared on the `RifffApi`
type used by `window.rifffApi`. This is expected at this point: `RifffApi` is inferred from
`preload/index.ts`'s own `api` object (already updated in Task 4), so the type itself is correct
— this failure only happens if Task 4 hasn't actually been completed/committed first. Re-run
after confirming Task 4's preload changes are in place; it should PASS.

Run: `npm run typecheck:web`
Expected: PASS

- [ ] **Step 3: Lint**

Run: `npx eslint src/renderer/src/components/ProjectLibraryBrowser.tsx`
Expected: no errors (fix formatting with `--fix` if needed)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ProjectLibraryBrowser.tsx
git commit -m "Add ProjectLibraryBrowser.tsx modal"
```

---

### Task 6: `App.tsx` — current-sketch tracking + wire it all together

**Files:**
- Modify: `src/renderer/src/App.tsx`

Adds `currentSketch` state tracking whether the open project is untitled, library-resident, or an
externally-opened legacy file — this determines whether Save/Export write in place or fall back
to the existing dialog-based path. Adds a "library" button (opens `ProjectLibraryBrowser`) and a
"duplicate as new version" button (enabled only for a library-resident sketch) to `ProjectMenu`.

- [ ] **Step 1: Implement**

Add the import near the top of `App.tsx`, alongside the existing `LoreLibraryBrowser` import:

```typescript
import { ProjectLibraryBrowser } from './components/ProjectLibraryBrowser'
```

Add a `CurrentSketch` type definition near the top of the file (module scope, alongside any other
top-level type definitions already in this file):

```typescript
/** Tracks what the currently-open project actually is, so Save/Export know
 * whether to write in place (no dialog) or fall back to the existing
 * dialog-based path:
 * - `null`: untitled, never saved this session -- first Save creates a
 *   fresh library entry.
 * - `{ kind: 'library', name }`: a library-resident sketch -- routine
 *   Save/Export both write in place to that sketch's own folder.
 * - `{ kind: 'external', path }`: opened via the legacy "open" dialog from
 *   outside the library -- routine Save writes in place to that exact
 *   path (no dialog needed, the path is already known), but Export falls
 *   back to the dialog-based exportAbleton, since there's no library
 *   folder structure to write an Ableton export into.
 * See docs/superpowers/specs/2026-08-05-project-library-design.md. */
type CurrentSketch = { kind: 'library'; name: string } | { kind: 'external'; path: string } | null
```

Modify the top-level `App` component (the one that owns `loreLibraryOpen` state, around line 667)
to also own `currentSketch` and `libraryBrowserOpen`:

```typescript
  const [currentSketch, setCurrentSketch] = useState<CurrentSketch>(null)
  const [libraryBrowserOpen, setLibraryBrowserOpen] = useState(false)
```

Add the `ProjectLibraryBrowser` render, directly alongside the existing `{loreLibraryOpen && (
<LoreLibraryBrowser ... /> )}` block (around line 1323):

```typescript
        {libraryBrowserOpen && (
          <ProjectLibraryBrowser
            onClose={() => setLibraryBrowserOpen(false)}
            onSelect={(name) => {
              void (async () => {
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  setBusy('loading waveforms…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  setCurrentSketch({ kind: 'library', name })
                } catch (err) {
                  console.error('App: failed to open library sketch:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
          />
        )}
```

Now modify `ProjectMenu` itself. It currently reads `state`/`dispatch`/`setBusy` via hooks
directly rather than props — `currentSketch`/`setCurrentSketch`/`onOpenLibrary` need to reach it
the same way `Shelf` already receives `onOpenLoreLibrary` as a prop from `App`. Change
`ProjectMenu`'s own signature and every place it's rendered:

```typescript
function ProjectMenu({
  currentSketch,
  setCurrentSketch,
  onOpenLibrary
}: {
  currentSketch: CurrentSketch
  setCurrentSketch: (sketch: CurrentSketch) => void
  onOpenLibrary: () => void
}): React.JSX.Element {
```

Find where `<ProjectMenu />` is rendered (a plain, prop-less usage today) and change it to:

```typescript
          <ProjectMenu
            currentSketch={currentSketch}
            setCurrentSketch={setCurrentSketch}
            onOpenLibrary={() => setLibraryBrowserOpen(true)}
          />
```

Replace `ProjectMenu`'s existing `handleNew`, `handleSave`, `handleOpen`, `handleExportAbleton`
functions with:

```typescript
  function handleNew(): void {
    if (
      Object.keys(state.rifffs).length > 0 &&
      !window.confirm('Discard the current project and start a new one?')
    ) {
      return
    }
    dispatch({ type: 'LOAD_STATE', state: initialState })
    setCurrentSketch(null)
  }

  async function handleSave(): Promise<void> {
    try {
      const json = serializeProject(state)
      if (currentSketch === null) {
        const name = generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
    } catch (err) {
      console.error('ProjectMenu: failed to save project:', err)
    }
  }

  async function handleSaveCopyElsewhere(): Promise<void> {
    try {
      await window.rifffApi.saveProject(serializeProject(state))
    } catch (err) {
      console.error('ProjectMenu: failed to save a copy elsewhere:', err)
    }
  }

  async function handleOpen(): Promise<void> {
    setBusy('opening project…')
    try {
      const result = await window.rifffApi.openProject()
      if (!result) return
      const loaded = deserializeProject(JSON.parse(result.json))
      // Pre-warm every stem's analysis caches BEFORE dispatching LOAD_STATE
      // -- otherwise the timeline/sketch strip renders immediately with
      // blank waveforms/radial glyphs that visibly pop in one at a time as
      // each mounted component's own decode happens to finish. Waiting here
      // means the busy overlay covers that whole "still processing" window
      // instead of just the file read.
      setBusy('loading waveforms…')
      await warmStemCaches(loaded)
      dispatch({ type: 'LOAD_STATE', state: loaded })
      setCurrentSketch({ kind: 'external', path: result.path })
    } catch (err) {
      console.error('ProjectMenu: failed to open project:', err)
    } finally {
      setBusy(null)
    }
  }

  async function handleDuplicateAsNewVersion(): Promise<void> {
    if (currentSketch === null || currentSketch.kind !== 'library') return
    try {
      // Save current edits first, so the duplicate reflects them.
      await window.rifffApi.saveProjectToLibrary(currentSketch.name, serializeProject(state))
      const result = await window.rifffApi.duplicateSketch(currentSketch.name)
      if (!result) return
      setCurrentSketch({ kind: 'library', name: result.name })
    } catch (err) {
      console.error('ProjectMenu: failed to duplicate sketch as a new version:', err)
    }
  }
```

Replace the existing `handleExportAbleton` with:

```typescript
  async function handleExportAbleton(): Promise<void> {
    setExporting(true)
    try {
      if (currentSketch !== null && currentSketch.kind === 'library') {
        const warn = await window.rifffApi.shouldWarnBeforeAbletonOverwrite(currentSketch.name)
        if (
          warn &&
          !window.confirm(
            'This sketch\'s Ableton export has been modified since the last export from sssketch (likely from mixing directly in Ableton). Exporting again will overwrite it. Continue?'
          )
        ) {
          return
        }
        await window.rifffApi.exportAlsToLibrary(JSON.stringify(state), currentSketch.name)
      } else {
        await window.rifffApi.exportAls(JSON.stringify(state))
      }
    } catch (err) {
      console.error('ProjectMenu: failed to export to Ableton:', err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }
```

Add a "library" button and a "duplicate" button to the returned JSX, alongside the existing
`new`/`save`/`open`/`export` buttons:

```typescript
      <button onClick={handleNew} style={buttonStyle}>
        new
      </button>
      <button onClick={handleSave} style={buttonStyle}>
        save
      </button>
      <button onClick={handleOpen} style={buttonStyle}>
        open
      </button>
      <button onClick={onOpenLibrary} style={buttonStyle}>
        library
      </button>
      {currentSketch !== null && currentSketch.kind === 'library' && (
        <button onClick={handleDuplicateAsNewVersion} style={buttonStyle}>
          duplicate
        </button>
      )}
```

Finally, add "save a copy elsewhere" as an extra entry in the existing export `ContextMenu`
items array (find the `items={[{ label: 'export mix', ... }, ...]}` block inside `ProjectMenu`
and add one more object): actually this belongs on the SAVE side, not export — add a second,
separate small context menu triggered from the `save` button instead of a bare `onClick`. Change
the `save` button to open a menu, mirroring the existing `export` button's own
`onClick={(e) => { const rect = ...; setExportMenu(...) }}` pattern:

```typescript
  const [saveMenu, setSaveMenu] = useState<{ x: number; y: number } | null>(null)
```

(add this `useState` alongside the existing `exportMenu` one)

```typescript
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setSaveMenu({ x: rect.left, y: rect.bottom + 4 })
        }}
        style={buttonStyle}
      >
        save
      </button>
      {saveMenu && (
        <ContextMenu
          x={saveMenu.x}
          y={saveMenu.y}
          items={[
            { label: 'save', onClick: handleSave },
            { label: 'save a copy elsewhere…', onClick: handleSaveCopyElsewhere }
          ]}
          onClose={() => setSaveMenu(null)}
        />
      )}
```

(replace the plain `<button onClick={handleSave} style={buttonStyle}>save</button>` from above
with this menu-based version — don't have both.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS

- [ ] **Step 3: Lint**

Run: `npx eslint src/renderer/src/App.tsx`
Expected: no errors (fix formatting with `--fix` if needed)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire current-sketch tracking, library browser, and duplicate-as-new-version into App.tsx"
```

---

### Task 7: Full verification + manual walkthrough

**Files:** none (verification only)

**A deliberate v1 scope simplification, not an oversight**: the design spec's Error Handling
section describes prompting the user once to relocate the library root if it's missing/
unwritable on first use. This plan doesn't implement that explicit prompt — `mkdirSync(dir, {
recursive: true })` (used throughout Tasks 2-3) will simply throw if the default `<Music>/
sssketch` root is genuinely unwritable (an edge case expected to be extremely rare in practice),
and that exception surfaces through the existing renderer-side `try/catch` → `console.error`
already in place for every Save/Export handler — a silent no-op from the user's point of view,
not a crash, just less graceful than the spec's ideal. If this turns out to matter in practice,
add the explicit prompt then (reusing the already-wired `pickFolder`/`setLibraryRoot` IPC pair
from Task 5's "change location…" button) rather than building it speculatively now.

- [ ] **Step 1: Full automated verification**

Run each of these and confirm a clean result before moving to manual verification:

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all three pass with zero failures/errors (the pre-existing, unrelated
`scanOneCandidate` flaky test in `pluginScan.test.ts` — see its own history — may still fail
intermittently; that's a known, pre-existing issue unrelated to this feature, not a regression to
chase down here).

- [ ] **Step 2: Manual walkthrough (this repo's own established convention for anything
      Electron/native-process-dependent — see CLAUDE.md's Testing Conventions)**

Since this touches `src/main/index.ts`/`src/preload/index.ts`, **fully quit (Cmd+Q) and relaunch**
`npm run dev` before testing (a renderer reload alone won't pick up main/preload changes).

Walk through, in order:
1. **New → Save**: confirm a new sketch, once you place a rifff and hit Save, creates a folder
   under `~/Music/sssketch/` named after the auto-generated emoji-prefixed name, containing the
   `.sssketchproj` file — with no save dialog appearing.
2. **Edit → Save again**: confirm the second Save overwrites the same file in place, still no
   dialog.
3. **Export ableton**: confirm it writes into that same sketch's `Ableton/` subfolder (no dialog),
   and that the resulting `.als` opens correctly in Ableton (same verification bar as the
   original Ableton export feature — tracks/clips land right, at least one `drums` and one
   other-typed stem, one one-shot).
4. **Export ableton again, unchanged**: confirm it's noticeably faster than the first export (no
   engine spawn needed if every stem was already cached) — check Activity Monitor or just notice
   the near-instant completion.
5. **Open the exported `.als` in Ableton, save something in Ableton itself** (any trivial change,
   e.g. move a track), then **go back to sssketch and Export ableton again**: confirm the
   overwrite-confirmation dialog appears before it proceeds.
6. **Duplicate as new version**: confirm a `-2` named sibling folder appears under
   `~/Music/sssketch/`, and that switching to it and exporting to Ableton is fast (stems it
   shares with the original are cloned from the cache, not re-decoded).
7. **Library button**: confirm it opens the browser modal, lists both sketches with correct
   last-modified times, and clicking one loads it correctly.
8. **Open (legacy dialog)**: open a pre-existing `.sssketchproj` from outside
   `~/Music/sssketch/` (e.g. anything under `~/Documents/ssstitch/` from earlier testing).
   Confirm Save now writes back to that exact original file with no dialog, and Export ableton
   falls back to the old save-dialog-based flow (since it's not a library sketch).
9. **Change library location…**: from the Library browser, confirm it opens a folder picker and
   subsequent saves/exports go to the new location.

- [ ] **Step 3: Update the design spec if manual walkthrough reveals anything wrong**

If any step above behaves differently than `docs/superpowers/specs/
2026-08-05-project-library-design.md` describes, fix the code (or, if the spec's own assumption
was wrong, fix the spec) and re-verify — matching this codebase's own established practice
throughout the Ableton export feature's history of keeping the spec's "Known risks" section
honest and current.
