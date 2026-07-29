import { writeFileSync } from 'fs'
import { join } from 'path'
import { dialog, BrowserWindow } from 'electron'
import type { ExportedStem } from '@shared/types'

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

/**
 * Opens a folder picker and writes each rendered stem to its own WAV inside
 * it. Mirrors exportMixToWav's cancel/failure handling — resolves null on a
 * cancelled dialog, logs (but doesn't throw across IPC) on a write failure.
 */
export async function exportStemsToWavs(
  win: BrowserWindow,
  stems: ExportedStem[]
): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a folder for the exported stems'
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const dir = result.filePaths[0]
  try {
    for (const stem of stems) {
      writeFileSync(join(dir, stem.fileName), stem.bytes)
    }
    return dir
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`exportStemsToWavs: failed to write stems to ${dir}: ${message}`)
    return null
  }
}
