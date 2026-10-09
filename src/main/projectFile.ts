import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, renameSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { dialog, BrowserWindow, app } from 'electron'
import {
  sketchDir,
  sketchProjectPath,
  listLibrarySketches,
  nextVersionName,
  rotateBackupBeforeOverwrite,
  libraryRootPath
} from './projectLibrary'
import { rememberExternalProject, renameKnownProject } from './reonedCopiesStore'

/** Library projects are scanned for the re-oned copies they name at cleanup time; a project
 * anywhere else is remembered with its names (reonedCopiesStore.ts), so its copies stay kept
 * while its drive is away. */
function isInsideLibrary(path: string): boolean {
  return resolve(path).startsWith(resolve(libraryRootPath()) + sep)
}

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
  'sleepy',
  'sleve',
  'onson',
  'darryl',
  'anatoli',
  'rey',
  'glenallen',
  'mario',
  'raul',
  'kevin',
  'tony',
  'bobson',
  'willie',
  'jeromy',
  'scott',
  'shown',
  'dean',
  'mike',
  'dwigt',
  'tim',
  'karl',
  'todd'
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
  'summit',
  'mcdichael',
  'sweemey',
  'archideld',
  'smorin',
  'mcsriff',
  'mixon',
  'mcrlwain',
  'chamgerlain',
  'nogilny',
  'smehrik',
  'dugnutt',
  'dustice',
  'gride',
  'dourque',
  'furcotte',
  'wesrey',
  'truk',
  'rortugal',
  'sandaele',
  'dandleton',
  'sernandez',
  'bonzalez'
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

/** A random "adjective noun" pair off the same word lists above (e.g.
 * "groovy sparrow") -- the shared building block behind
 * generateDefaultProjectName's own filename below, and reused as-is for
 * naming other auto-generated, personality-bearing things in the app (see
 * importOneShot.ts's recorded-take naming) that want the same tasteful,
 * on-theme randomness without a project filename's date/emoji trappings. */
export function randomAdjectiveNoun(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective} ${noun}`
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
  // randomAdjectiveNoun() returns a space-joined pair ("groovy sparrow") --
  // this filename's own pattern needs hyphens instead, so split and rejoin
  // rather than duplicating the word-list-picking logic here.
  const adjectiveNoun = randomAdjectiveNoun().replace(' ', '-')
  return `${dateStr}-${adjectiveNoun}-${emoji}`
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
    if (!isInsideLibrary(result.filePath)) rememberExternalProject(result.filePath, json)
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
  // saveProjectToLibrary comes through here too: only a file outside the library is remembered.
  if (!isInsideLibrary(path)) rememberExternalProject(path, json)
}

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
  renameKnownProject(oldPath, newPath)
  return { ok: true, path: newPath }
}

/** Routine, no-dialog save for a library-resident sketch -- creates the
 * sketch's own folder on first save, overwrites in place on every
 * subsequent one. See docs/superpowers/specs/
 * 2026-08-05-project-library-design.md. Throws on failure -- see
 * saveProjectInPlace's doc comment for why. */
export function saveProjectToLibrary(name: string, json: string): { path: string } {
  mkdirSync(sketchDir(name), { recursive: true })
  const path = sketchProjectPath(name)
  // Backs up whatever's CURRENTLY on disk before it's overwritten --
  // covers this function's own callers: explicit Save (the Save button,
  // Cmd+S, and the quit-time save prompt, all via handleSave), naming a
  // brand-new sketch for the first time, and duplicating as a new version.
  // Without this, an unwanted overwrite has no way back -- see
  // rotateBackupBeforeOverwrite's own doc comment for the recovery story
  // (list/restore via the Project Library browser).
  rotateBackupBeforeOverwrite(name)
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

/** "Duplicate as new version": writes `json` -- the live project, unsaved
 * edits and plugin settings included (the renderer's serializeForSave) --
 * as a freshly-computed `<name>-N` sketch. The original sketch is never
 * written: its folder stays byte-identical, so the edits move to the new
 * version and the original keeps what it last saved. As before, the project
 * file is the only file the new version gets: nothing audio-related is
 * copied (the project file is just JSON pointers to source stem paths; the
 * new sketch's own NEXT Ableton export benefits from the shared sample
 * cache automatically, see projectLibrary.ts), and the original's exports,
 * backups and favourite flag stay its own. Returns null if currentName
 * isn't an existing library sketch. */
export function duplicateSketchAsNewVersion(
  currentName: string,
  json: string
): { name: string; path: string } | null {
  if (!existsSync(sketchProjectPath(currentName))) return null
  const newName = nextVersionName(
    currentName,
    listLibrarySketches().map((s) => s.name)
  )
  return { name: newName, ...saveProjectToLibrary(newName, json) }
}

export const AUTOSAVE_FILENAME = 'autosave.sssketchproj'
const AUTOSAVE_SKETCH_FILENAME = 'autosaveSketch.json'
// One kept previous snapshot (and its sidecar): an offered snapshot nobody decided on, moved
// aside when this session needed the recovery file. Bounded at one: a second move aside
// replaces it.
export const AUTOSAVE_PREVIOUS_FILENAME = 'autosave.previous.sssketchproj'
const AUTOSAVE_PREVIOUS_SKETCH_FILENAME = 'autosaveSketch.previous.json'

function autosavePath(): string {
  return join(app.getPath('userData'), AUTOSAVE_FILENAME)
}

function autosaveSketchPath(): string {
  return join(app.getPath('userData'), AUTOSAVE_SKETCH_FILENAME)
}

function previousAutosavePath(): string {
  return join(app.getPath('userData'), AUTOSAVE_PREVIOUS_FILENAME)
}

function previousAutosaveSketchPath(): string {
  return join(app.getPath('userData'), AUTOSAVE_PREVIOUS_SKETCH_FILENAME)
}

// True while the recovery file on disk is one this app has offered (loadAutosave) and the user
// has neither recovered nor discarded (discardAutosave). The welcome's x leaves it undecided,
// and so does any welcome button other than recover/discard. Writing or clearing the recovery
// file then would destroy it without the user deciding, so both move it aside first
// (setUndecidedAutosaveAside), and the next launch offers it again.
let autosaveUndecided = false

function readIfExists(path: string, caller: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${caller}: failed to read ${path}: ${message}`)
    return null
  }
}

function deleteIfExists(path: string, caller: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${caller}: failed to delete ${path}: ${message}`)
  }
}

/** Moves an undecided snapshot (see autosaveUndecided) and its sidecar to the one kept previous
 * slot, replacing whatever was there. A no-op once decided or moved. */
function setUndecidedAutosaveAside(): void {
  if (!autosaveUndecided) return
  autosaveUndecided = false
  try {
    if (!existsSync(autosavePath())) return
    renameSync(autosavePath(), previousAutosavePath())
    // The sidecar goes with its snapshot; a missing one must not leave an older one paired
    // with it.
    if (existsSync(autosaveSketchPath()))
      renameSync(autosaveSketchPath(), previousAutosaveSketchPath())
    else deleteIfExists(previousAutosaveSketchPath(), 'setUndecidedAutosaveAside')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`setUndecidedAutosaveAside: failed to move ${autosavePath()}: ${message}`)
  }
}

/**
 * Silently writes the current project to a fixed, dedicated recovery
 * location — never the user's own named .sssketchproj file, and never through
 * a dialog. Purely a crash/forgot-to-save safety net; App.tsx debounces
 * calls to this after real edits, independent of the user's own explicit
 * Save (which goes through saveProjectAs above and clears this instead).
 * A previous session's snapshot still awaiting the user's decision is moved
 * aside first, not overwritten (setUndecidedAutosaveAside).
 */
export function writeAutosave(json: string): void {
  setUndecidedAutosaveAside()
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
 * either way there's nothing to offer the user. A snapshot read here is being
 * offered: it stays undecided (autosaveUndecided) until discardAutosave. */
export function loadAutosave(): string | null {
  const json = readIfExists(autosavePath(), 'loadAutosave')
  if (json !== null) autosaveUndecided = true
  return json
}

/** Persists which sketch the current autosave snapshot belongs to (see
 * writeAutosave) as an opaque JSON blob -- main process doesn't need to
 * understand its shape (the renderer's own CurrentSketch type), just
 * store/retrieve it verbatim -- so a crash-recovery restore can also
 * restore the CORRECT currentSketch instead of silently forking a new
 * library entry on the next Save. Written in lockstep with writeAutosave
 * from App.tsx's own debounced autosave effect. */
export function writeAutosaveSketchInfo(json: string): void {
  setUndecidedAutosaveAside()
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
  return readIfExists(autosaveSketchPath(), 'loadAutosaveSketchInfo')
}

/** Clears the recovery file because this session no longer needs it: after
 * any explicit Save (see saveProjectAs above), a discard of this session's
 * unsaved work (New, open, quit's Don't Save), or a welcome button that moves
 * on without recovering. Deletes the snapshot and its sidecar (see
 * writeAutosaveSketchInfo) together -- unless it is a previous session's
 * snapshot still awaiting the user's decision, which is moved aside instead
 * (setUndecidedAutosaveAside). A no-op if there's nothing there. */
export function clearAutosave(): void {
  setUndecidedAutosaveAside()
  deleteIfExists(autosavePath(), 'clearAutosave')
  deleteIfExists(autosaveSketchPath(), 'clearAutosave')
}

/** The user decided on the offered snapshot (recovered it into the editor, or
 * discarded it): deletes it and its sidecar for good. */
export function discardAutosave(): void {
  autosaveUndecided = false
  deleteIfExists(autosavePath(), 'discardAutosave')
  deleteIfExists(autosaveSketchPath(), 'discardAutosave')
}

/** The one kept previous snapshot (see setUndecidedAutosaveAside) and its
 * sidecar, offered at launch next to the current one. Null when there is none
 * or it can't be read. */
export function loadPreviousAutosave(): { json: string; sketchJson: string | null } | null {
  const json = readIfExists(previousAutosavePath(), 'loadPreviousAutosave')
  if (json === null) return null
  return { json, sketchJson: readIfExists(previousAutosaveSketchPath(), 'loadPreviousAutosave') }
}

/** The user decided on the kept previous snapshot (recovered or discarded it). */
export function discardPreviousAutosave(): void {
  deleteIfExists(previousAutosavePath(), 'discardPreviousAutosave')
  deleteIfExists(previousAutosaveSketchPath(), 'discardPreviousAutosave')
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
    const json = readFileSync(path, 'utf-8')
    if (!isInsideLibrary(path)) rememberExternalProject(path, json)
    return { path, json }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`openProject: failed to read project from ${path}: ${message}`)
    return null
  }
}
