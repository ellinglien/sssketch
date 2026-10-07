// src/main/loginSyncConsentStore.ts -- the answer to "sync your jams now?", kept per machine.
//
// loginSync.json in userData, beside discoverSettings.json. The rule is @shared/loginSyncConsent:
// a saved answer wins; with none, an install whose own riff library already holds a synced riff
// has said yes (Elling's, and anyone who synced before the question existed), and that is written
// down at once so it is decided once.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
import { resolveLoginSyncConsent, type LoginSyncConsent } from '@shared/loginSyncConsent'

const STORE_FILENAME = 'loginSync.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

function readSaved(): unknown {
  const path = storePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    console.error(`loginSyncConsentStore: failed to read ${path}:`, err)
    return null
  }
}

export function saveLoginSyncConsent(consent: 'yes' | 'no'): void {
  try {
    writeFileSync(storePath(), JSON.stringify({ consent }, null, 2), 'utf-8')
  } catch (err) {
    console.error(`loginSyncConsentStore: failed to write ${storePath()}:`, err)
  }
}

/** `hasEarlierSync` is asked only when nothing is saved. */
export function loadLoginSyncConsent(hasEarlierSync: () => boolean): LoginSyncConsent {
  const saved = readSaved()
  const resolved = resolveLoginSyncConsent(saved, false)
  if (resolved !== 'ask') return resolved
  if (!hasEarlierSync()) return 'ask'
  saveLoginSyncConsent('yes')
  return 'yes'
}

/** Whether the own riff library holds any riff a sync wrote: every riff there but the
 * discovered room's (kept groups, written by Discover, not by a sync). */
export function ownDbHasEarlierSync(db: Database.Database): boolean {
  return (
    db.prepare('SELECT 1 FROM Riffs WHERE OwnerJamCID <> ? LIMIT 1').get(DISCOVERED_JAM_CID) !==
    undefined
  )
}
