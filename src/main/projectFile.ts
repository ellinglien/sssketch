import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { dialog, BrowserWindow, app } from 'electron'

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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Generates a default project filename (without extension), following the
 * pattern `YYYY-MM-DD-adjective-noun` -- e.g. "2026-08-01-groovy-sparrow".
 * `date` is injectable for deterministic tests; defaults to now. */
export function generateDefaultProjectName(date: Date = new Date()): string {
  const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${dateStr}-${adjective}-${noun}`
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

/** Deletes the recovery snapshot — called once the user has been asked
 * about it at startup (whichever way they answered, so a later launch
 * doesn't keep asking about the same stale snapshot), and again after any
 * explicit Save (see saveProjectAs above). A no-op if there's nothing
 * there. */
export function clearAutosave(): void {
  const path = autosavePath()
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`clearAutosave: failed to delete ${path}: ${message}`)
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
