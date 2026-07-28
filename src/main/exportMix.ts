import { writeFileSync } from 'fs'
import { dialog, BrowserWindow } from 'electron'

/**
 * Opens a save dialog and writes the rendered mixdown bytes to the chosen path.
 * Mirrors saveProjectAs's failure handling: a cancelled dialog and a failed write
 * both just resolve null (logged here, not thrown across the IPC boundary) — the
 * caller doesn't need to distinguish the two.
 */
export async function exportMixToWav(
  win: BrowserWindow,
  bytes: Uint8Array
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    defaultPath: 'mixdown.wav'
  })
  if (result.canceled || !result.filePath) return null

  try {
    writeFileSync(result.filePath, bytes)
    return result.filePath
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`exportMixToWav: failed to write to ${result.filePath}: ${message}`)
    return null
  }
}
