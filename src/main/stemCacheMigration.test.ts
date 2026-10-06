import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => globalThis.__testUserDataDir
  }
}))

declare global {
  var __testUserDataDir: string
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-migration-test-'))
  globalThis.__testUserDataDir = userDataDir
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

function writeOldStem(
  source: 'shared' | 'jam',
  riffCID: string,
  stemCID: string,
  content: string
): string {
  const dir = join(userDataDir, 'endlesss-cache', 'stems', source, riffCID)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, stemCID)
  writeFileSync(path, content)
  return path
}

describe('migrateEndlesssStemCache', () => {
  it('moves a stem to its content-addressed path and symlinks the old path to it', async () => {
    const oldPath = writeOldStem('jam', 'riff_1', 'stem_abc', 'audio bytes')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    const newPath = join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_abc')
    expect(existsSync(newPath)).toBe(true)
    expect(readFileSync(newPath, 'utf-8')).toBe('audio bytes')
    expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(oldPath, 'utf-8')).toBe('audio bytes')
  })

  it('dedupes the same stemCID cached under both shared and jam into one real file', async () => {
    const sharedPath = writeOldStem('shared', 'riff_1', 'stem_dup', 'same audio')
    const jamPath = writeOldStem('jam', 'riff_2', 'stem_dup', 'same audio')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    const newPath = join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_dup')
    expect(lstatSync(sharedPath).isSymbolicLink()).toBe(true)
    expect(lstatSync(jamPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(newPath, 'utf-8')).toBe('same audio')
  })

  it('is idempotent -- a second run is a no-op', async () => {
    const oldPath = writeOldStem('jam', 'riff_1', 'stem_abc', 'audio bytes')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    migrateEndlesssStemCache()
    expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)
    const newPath = join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_abc')
    expect(readFileSync(newPath, 'utf-8')).toBe('audio bytes')
  })

  it('discards a stale .downloading leftover instead of migrating it as a fake stem', async () => {
    const dir = join(userDataDir, 'endlesss-cache', 'stems', 'jam', 'riff_1')
    mkdirSync(dir, { recursive: true })
    const staleDownloadPath = join(dir, 'stem_partial.downloading')
    writeFileSync(staleDownloadPath, 'incomplete')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    expect(existsSync(staleDownloadPath)).toBe(false)
  })

  // Background scan audit "Minor" (plan Task 13 M1): the old dirs were
  // listed on every launch, long after the migration finished.
  describe('the done-marker', () => {
    function markerOf(db: Database.Database): string | undefined {
      const row = db
        .prepare(`SELECT Stamp FROM StartupBackfillSeen WHERE Path = ?`)
        .get('migration:endlesss-stem-cache') as { Stamp: string } | undefined
      return row?.Stamp
    }

    it('is written by a pass that moved nothing, not by one that moved something', async () => {
      writeOldStem('jam', 'riff_1', 'stem_abc', 'audio bytes')
      const db = new Database(':memory:')
      const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
      migrateEndlesssStemCache(db)
      expect(markerOf(db)).toBeUndefined()
      migrateEndlesssStemCache(db) // only symlinks left
      expect(markerOf(db)).toBe('done')
      db.close()
    })

    it('with the marker present, the old dirs are never listed', async () => {
      const db = new Database(':memory:')
      const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
      migrateEndlesssStemCache(db) // neither old tree: done at once
      expect(markerOf(db)).toBe('done')
      const oldPath = writeOldStem('jam', 'riff_1', 'stem_late', 'audio bytes')
      migrateEndlesssStemCache(db)
      expect(lstatSync(oldPath).isSymbolicLink()).toBe(false)
      expect(existsSync(join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_late'))).toBe(false)
      db.close()
    })
  })

  it('does nothing when neither old tree exists', async () => {
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    expect(() => migrateEndlesssStemCache()).not.toThrow()
  })
})
