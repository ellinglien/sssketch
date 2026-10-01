// src/main/soundSettingsStore.ts -- the app-wide default sound settings (native radio sound plan,
// Task 2): what a new project, and a project saved before the radio sound existed, start from.
// A userData JSON, read and written through normalizeSoundSettings, as discoverSettingsStore.ts
// does for Discover's. Everything on by default (Elling, 2026-10-01).
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { normalizeSoundSettings, type SoundSettings } from '@shared/radioSound'

const STORE_FILENAME = 'soundSettings.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** The defaults, all on, when nothing is saved yet or reading fails (never a thrown error). */
export function loadSoundSettings(): SoundSettings {
  const path = storePath()
  if (!existsSync(path)) return normalizeSoundSettings(undefined)
  try {
    return normalizeSoundSettings(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadSoundSettings: failed to read ${path}: ${message}`)
    return normalizeSoundSettings(undefined)
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    writeFileSync(storePath(), JSON.stringify(normalizeSoundSettings(settings), null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveSoundSettings: failed to write ${storePath()}: ${message}`)
  }
}
