import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { dialog, BrowserWindow, app } from 'electron'

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
    filters: [{ name: 'ssstitch Project', extensions: ['rifffproj'] }]
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

const AUTOSAVE_FILENAME = 'autosave.rifffproj'

function autosavePath(): string {
  return join(app.getPath('userData'), AUTOSAVE_FILENAME)
}

/**
 * Silently writes the current project to a fixed, dedicated recovery
 * location — never the user's own named .rifffproj file, and never through
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
 * Opens a file dialog and reads back the selected .rifffproj file. A read failure
 * (permission denied, file deleted between selection and read, etc.) is logged and
 * reported as `null` rather than throwing across the IPC boundary.
 */
export async function openProject(
  win: BrowserWindow
): Promise<{ path: string; json: string } | null> {
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: 'ssstitch Project', extensions: ['rifffproj'] }],
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
