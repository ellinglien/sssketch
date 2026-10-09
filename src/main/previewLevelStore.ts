// src/main/previewLevelStore.ts -- the import view's "preview level" dial, remembered.
//
// previewLevel.json in userData, beside discoverSettings.json: a per-machine preference, never
// project data. See @shared/previewLevel for what the level does.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { DEFAULT_PREVIEW_LEVEL, normalizePreviewLevel } from '@shared/previewLevel'

const STORE_FILENAME = 'previewLevel.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** The saved level, or 100%. Never throws: a settings file must not be able to break previews. */
export function loadPreviewLevel(): number {
  const path = storePath()
  if (!existsSync(path)) return DEFAULT_PREVIEW_LEVEL
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { previewLevel?: unknown } | null
    return normalizePreviewLevel(parsed?.previewLevel)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadPreviewLevel: failed to read ${path}: ${message}`)
    return DEFAULT_PREVIEW_LEVEL
  }
}

export function savePreviewLevel(level: number): void {
  const previewLevel = normalizePreviewLevel(level)
  try {
    writeFileSync(storePath(), JSON.stringify({ previewLevel }, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`savePreviewLevel: failed to write ${storePath()}: ${message}`)
  }
}
