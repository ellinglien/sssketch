// src/main/ownUsernameStore.ts
//
// The last username the renderer reported as "me" (its riff library
// username: typed, else the Endlesss session's), kept across launches so the
// startup prewarm knows whose own-only index to build on a rebuild before
// the renderer has said anything (faster startup plan,
// docs/superpowers/plans/2026-10-06-faster-startup.md). The renderer reports
// it again at every launch and on every change; this is only the head start.
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { normalizeEndlesssUsername } from '@shared/endlesssUsername'

const STORE_FILENAME = 'ownUsername.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** The saved username, normalised (@shared/endlesssUsername: lowercase, and
 * an email is nobody -- a file saved before 2026-10-07 can hold either), or
 * null (none saved, or the file can't be read). */
export function loadOwnUsername(): string | null {
  const path = storePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { username?: unknown }
    const name =
      typeof parsed.username === 'string' ? normalizeEndlesssUsername(parsed.username) : ''
    return name === '' ? null : name
  } catch (err) {
    console.error(`loadOwnUsername: failed to read ${path}:`, err)
    return null
  }
}

/** Saves `username` (null or blank: none). Never throws. Written to a temp
 * file, fsynced, then renamed over the old one (categoryCentroidStore.ts's
 * pattern): a crash or a full disk mid-write leaves the previous name, never
 * a truncated file that reads as none. */
export function saveOwnUsername(username: string | null): void {
  const name = username?.trim() ?? ''
  const path = storePath()
  const tmpPath = `${path}.tmp`
  try {
    const fd = openSync(tmpPath, 'w')
    try {
      writeFileSync(fd, JSON.stringify({ username: name === '' ? null : name }), 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmpPath, path)
  } catch (err) {
    console.error(`saveOwnUsername: failed to write ${path}:`, err)
  }
}
