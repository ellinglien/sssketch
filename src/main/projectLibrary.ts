// src/main/projectLibrary.ts
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
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
    mkdirSync(sketchDir(name), { recursive: true })
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
