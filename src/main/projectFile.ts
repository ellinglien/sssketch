import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { dialog, BrowserWindow, app } from 'electron'
import {
  sketchDir,
  sketchProjectPath,
  listLibrarySketches,
  nextVersionName
} from './projectLibrary'

// Fun, short words for the auto-generated default project name -- kept
// tasteful and on-theme for a music/creative tool, not an exhaustive
// dictionary. Deliberately lowercase (matches the date prefix's own
// lowercase-with-hyphens style) so the whole generated name reads as one
// consistent pattern.
const ADJECTIVES = [
  'groovy',
  'fuzzy',
  'velvet',
  'electric',
  'hazy',
  'wobbly',
  'crispy',
  'dusty',
  'neon',
  'silent',
  'golden',
  'feral',
  'lucid',
  'moody',
  'plush',
  'spare',
  'tangled',
  'vivid',
  'warped',
  'zesty',
  'breezy',
  'chunky',
  'glassy',
  'inky',
  'jagged',
  'lush',
  'muted',
  'radiant',
  'rusty',
  'sleepy'
]

const NOUNS = [
  'sparrow',
  'echo',
  'canyon',
  'lantern',
  'orbit',
  'thicket',
  'ember',
  'harbor',
  'compass',
  'meadow',
  'signal',
  'anchor',
  'prism',
  'ridge',
  'tide',
  'willow',
  'beacon',
  'current',
  'drift',
  'ferry',
  'grove',
  'hollow',
  'kestrel',
  'marsh',
  'nectar',
  'otter',
  'pebble',
  'quartz',
  'raven',
  'summit'
]

// Matches ADJECTIVES/NOUNS's own tasteful, music/creative tone above.
// Randomly prefixed onto every generated name (see generateDefaultProjectName)
// -- purely cosmetic personality/glanceability in the library list, not
// load-bearing for anything else.
const EMOJIS = [
  '🎵',
  '🎶',
  '🎸',
  '🎹',
  '🥁',
  '🎧',
  '🎤',
  '🌊',
  '🔥',
  '✨',
  '🌙',
  '⚡',
  '🍃',
  '🌀',
  '🔮',
  '💫',
  '🌈',
  '🪐'
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Generates a default project filename (without extension), following the
 * pattern `YYYY-MM-DD-adjective-noun-emoji` -- e.g.
 * "2026-08-01-groovy-sparrow-🌙". `date` is injectable for deterministic
 * tests; defaults to now. The emoji is placed AFTER the date (not before,
 * as originally shipped) specifically so library folders keep sorting
 * chronologically by default in Finder -- the date-first scheme's whole
 * point was defeated by an emoji prefix. */
export function generateDefaultProjectName(date: Date = new Date()): string {
  const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)]
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${dateStr}-${adjective}-${noun}-${emoji}`
}

/**
 * Opens a save dialog and writes `json` to the chosen path. A rejected/failed write
 * (permission denied, disk full, path vanished mid-dialog, etc.) must not surface as an
 * unhandled promise rejection to the renderer's bare button `onClick` — so failures are
 * logged here and reported back as `null`, the same shape a cancelled dialog already
 * produces. The caller (App.tsx) doesn't need to distinguish "user cancelled" from
 * "write failed"; both are a no-op from its point of view, but the failure is never
 * silent — it lands in the main process's console with the path and error.
 */
export async function saveProjectAs(win: BrowserWindow, json: string): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: `${generateDefaultProjectName()}.sssketchproj`,
    filters: [{ name: 'sssketch Project', extensions: ['sssketchproj'] }]
  })
  if (result.canceled || !result.filePath) return null

  try {
    writeFileSync(result.filePath, json, 'utf-8')
    // The user's own file now has this exact content, so the crash-recovery
    // snapshot (see writeAutosave below) is redundant — clear it so a later
    // launch doesn't offer to "recover" work that's already safely saved.
    clearAutosave()
    return result.filePath
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveProjectAs: failed to write project to ${result.filePath}: ${message}`)
    return null
  }
}

/** Writes json directly to path, no dialog -- the write-and-clear-autosave
 * sequence saveProjectToLibrary needs; saveProjectAs still does this inline
 * since it's kept untouched as the escape hatch.
 *
 * Deliberately no try/catch here: unlike openProject/openLibrarySketch/
 * autosave (which return null on failure because they're either
 * background/optional operations or "not found" is a normal outcome), a
 * real write failure (disk full, permissions) must throw and surface
 * visibly rather than silently masquerade as a successful save. This
 * matches exportAbleton.ts's buildAndWriteAlsProject/exportAbleton
 * convention -- a real failure here throws/rejects rather than being
 * caught and resolved as null. The caller (a later task's App.tsx Save
 * action) is expected to wrap this in its own try/catch. */
export function saveProjectInPlace(path: string, json: string): void {
  writeFileSync(path, json, 'utf-8')
  clearAutosave()
}

/** Routine, no-dialog save for a library-resident sketch -- creates the
 * sketch's own folder on first save, overwrites in place on every
 * subsequent one. See docs/superpowers/specs/
 * 2026-08-05-project-library-design.md. Throws on failure -- see
 * saveProjectInPlace's doc comment for why. */
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
export function duplicateSketchAsNewVersion(
  currentName: string
): { name: string; path: string } | null {
  const source = openLibrarySketch(currentName)
  if (!source) return null
  const newName = nextVersionName(
    currentName,
    listLibrarySketches().map((s) => s.name)
  )
  return { name: newName, ...saveProjectToLibrary(newName, source.json) }
}

const AUTOSAVE_FILENAME = 'autosave.sssketchproj'

function autosavePath(): string {
  return join(app.getPath('userData'), AUTOSAVE_FILENAME)
}

/**
 * Silently writes the current project to a fixed, dedicated recovery
 * location — never the user's own named .sssketchproj file, and never through
 * a dialog. Purely a crash/forgot-to-save safety net; App.tsx debounces
 * calls to this after real edits, independent of the user's own explicit
 * Save (which goes through saveProjectAs above and clears this instead).
 */
export function writeAutosave(json: string): void {
  try {
    writeFileSync(autosavePath(), json, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeAutosave: failed to write ${autosavePath()}: ${message}`)
  }
}

/** Reads back the recovery snapshot, if one exists — checked once at
 * startup so App.tsx can offer to restore it. Returns null (not a thrown
 * error) both when no snapshot exists yet and when reading one fails, since
 * either way there's nothing to offer the user. */
export function loadAutosave(): string | null {
  const path = autosavePath()
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadAutosave: failed to read ${path}: ${message}`)
    return null
  }
}

const AUTOSAVE_SKETCH_FILENAME = 'autosaveSketch.json'

function autosaveSketchPath(): string {
  return join(app.getPath('userData'), AUTOSAVE_SKETCH_FILENAME)
}

/** Persists which sketch the current autosave snapshot belongs to (see
 * writeAutosave) as an opaque JSON blob -- main process doesn't need to
 * understand its shape (the renderer's own CurrentSketch type), just
 * store/retrieve it verbatim -- so a crash-recovery restore can also
 * restore the CORRECT currentSketch instead of silently forking a new
 * library entry on the next Save. Written in lockstep with writeAutosave
 * from App.tsx's own debounced autosave effect. */
export function writeAutosaveSketchInfo(json: string): void {
  try {
    writeFileSync(autosaveSketchPath(), json, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeAutosaveSketchInfo: failed to write ${autosaveSketchPath()}: ${message}`)
  }
}

/** Reads back the sketch-info sidecar, if one exists -- checked alongside
 * loadAutosave() when offering to restore a crash-recovery snapshot.
 * Returns null (not a thrown error) both when nothing was ever written
 * (e.g. an autosave captured before this existed, or a genuinely untitled
 * sketch) and when reading one fails. */
export function loadAutosaveSketchInfo(): string | null {
  const path = autosaveSketchPath()
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadAutosaveSketchInfo: failed to read ${path}: ${message}`)
    return null
  }
}

/** Deletes the recovery snapshot — called once the user has been asked
 * about it at startup (whichever way they answered, so a later launch
 * doesn't keep asking about the same stale snapshot), and again after any
 * explicit Save (see saveProjectAs above). Also deletes the sketch-info
 * sidecar (see writeAutosaveSketchInfo) in the same pass, so every
 * existing call site clears both files together automatically. A no-op
 * if there's nothing there. */
export function clearAutosave(): void {
  const path = autosavePath()
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`clearAutosave: failed to delete ${path}: ${message}`)
  }
  const sketchPath = autosaveSketchPath()
  try {
    if (existsSync(sketchPath)) unlinkSync(sketchPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`clearAutosave: failed to delete ${sketchPath}: ${message}`)
  }
}

/**
 * Opens a file dialog and reads back the selected .sssketchproj file. A read failure
 * (permission denied, file deleted between selection and read, etc.) is logged and
 * reported as `null` rather than throwing across the IPC boundary.
 */
export async function openProject(
  win: BrowserWindow
): Promise<{ path: string; json: string } | null> {
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: 'sssketch Project', extensions: ['sssketchproj'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const path = result.filePaths[0]
  try {
    return { path, json: readFileSync(path, 'utf-8') }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`openProject: failed to read project from ${path}: ${message}`)
    return null
  }
}
