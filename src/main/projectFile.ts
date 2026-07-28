import { readFileSync, writeFileSync } from 'fs'
import { dialog, BrowserWindow } from 'electron'

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
    filters: [{ name: 'Rifff Arranger Project', extensions: ['rifffproj'] }]
  })
  if (result.canceled || !result.filePath) return null

  try {
    writeFileSync(result.filePath, json, 'utf-8')
    return result.filePath
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveProjectAs: failed to write project to ${result.filePath}: ${message}`)
    return null
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
    filters: [{ name: 'Rifff Arranger Project', extensions: ['rifffproj'] }],
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
