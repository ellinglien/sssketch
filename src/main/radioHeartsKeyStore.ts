// src/main/radioHeartsKeyStore.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

/** The ell.ing/radio hearts.json key, for "fetch radio hearts"
 * (radioHeartsImport.ts). A secret, so it is kept the way endlesssApi.ts
 * keeps the Endlesss session: encrypted with safeStorage (the macOS
 * keychain) in userData, never in plaintext, never in a project file, never
 * in git. Where encryption is unavailable it lives in memory for the
 * session only -- asking again next launch is the safer failure.
 *
 * The key never goes back to the renderer: the settings modal only learns
 * WHETHER one is set (hasRadioHeartsKey). */
const KEY_FILENAME = 'radio-hearts-key.enc'

function keyFilePath(): string {
  return join(app.getPath('userData'), KEY_FILENAME)
}

let sessionKey: string | null = null
let loaded = false

export function loadRadioHeartsKey(): string | null {
  if (loaded) return sessionKey
  loaded = true
  if (!safeStorage.isEncryptionAvailable() || !existsSync(keyFilePath())) return sessionKey
  try {
    const key = safeStorage.decryptString(readFileSync(keyFilePath())).trim()
    sessionKey = key === '' ? null : key
  } catch (err) {
    console.error('radioHeartsKeyStore: failed to read the key:', err)
  }
  return sessionKey
}

/** Sets the key, or clears it with null / an empty string. */
export function saveRadioHeartsKey(key: string | null): void {
  const trimmed = key?.trim() ?? ''
  sessionKey = trimmed === '' ? null : trimmed
  loaded = true
  try {
    if (sessionKey === null) {
      rmSync(keyFilePath(), { force: true })
      return
    }
    if (!safeStorage.isEncryptionAvailable()) return
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(keyFilePath(), safeStorage.encryptString(sessionKey))
  } catch (err) {
    console.error('radioHeartsKeyStore: failed to write the key:', err)
  }
}

export function hasRadioHeartsKey(): boolean {
  return loadRadioHeartsKey() !== null
}

/** Test-only: forget the in-memory copy so the next load reads disk. */
export function resetRadioHeartsKeyForTests(): void {
  sessionKey = null
  loaded = false
}
