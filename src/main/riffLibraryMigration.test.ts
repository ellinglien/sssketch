import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'music' ? musicDir : userDataDir)
  }
}))

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-migration-userdata-'))
  musicDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-migration-music-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(musicDir, { recursive: true, force: true })
})

function writeOldRiffLibrary(): void {
  const dbDir = join(userDataDir, 'lore-warehouse', 'cache', 'common')
  mkdirSync(dbDir, { recursive: true })
  writeFileSync(join(dbDir, 'warehouse.db3'), 'fake sqlite bytes')
  writeFileSync(join(dbDir, 'warehouse.db3-wal'), 'fake wal bytes')
}

describe('migrateRiffLibraryLocation', () => {
  it('moves the whole old lore-warehouse/ directory (db3 + WAL sidecar) to the new location', async () => {
    writeOldRiffLibrary()
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    const newDbPath = join(musicDir, 'sssketch', 'library', 'cache', 'common', 'warehouse.db3')
    const newWalPath = join(musicDir, 'sssketch', 'library', 'cache', 'common', 'warehouse.db3-wal')
    expect(existsSync(newDbPath)).toBe(true)
    expect(existsSync(newWalPath)).toBe(true)
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(false)
  })

  it('is idempotent -- a second run does not touch new content reappearing at the old default', async () => {
    writeOldRiffLibrary()
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    // Simulate a fresh db reappearing at the OLD default (shouldn't happen
    // in practice, but proves the new-location-populated check wins
    // regardless of old-side state, not just "old side is now empty").
    writeOldRiffLibrary()
    migrateRiffLibraryLocation()
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(true) // untouched this run
  })

  it('does nothing when there is nothing at the old default', async () => {
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    expect(() => migrateRiffLibraryLocation()).not.toThrow()
    expect(existsSync(join(musicDir, 'sssketch', 'library'))).toBe(false)
  })

  it('does nothing when an explicit riff library root override is already stored', async () => {
    writeOldRiffLibrary()
    writeFileSync(
      join(userDataDir, 'riffLibraryPrefs.json'),
      JSON.stringify({ root: '/Volumes/External/MyLoreArchive' })
    )
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(true) // untouched
  })

  it('does nothing when only a LEGACY (pre-rename) prefs override is stored -- carried forward first, then honored', async () => {
    // Real first-launch-after-upgrade scenario: a user who already pointed
    // sssketch at a real external LORE archive under the pre-rename prefs
    // filename, with real directory content still sitting at the old
    // default too. hasStoredRiffLibraryRootOverride() (called by this
    // migration) triggers riffLibraryStore.ts's own
    // carryForwardLegacyRiffLibraryPrefs() as a side effect, which must
    // create riffLibraryPrefs.json BEFORE this migration's own override
    // check runs -- so the directory move is correctly skipped in the same
    // call, not just on some later run.
    writeOldRiffLibrary()
    writeFileSync(
      join(userDataDir, 'loreWarehousePrefs.json'),
      JSON.stringify({ root: '/Volumes/External/MyLoreArchive' })
    )
    const { migrateRiffLibraryLocation } = await import('./riffLibraryMigration')
    migrateRiffLibraryLocation()
    expect(existsSync(join(userDataDir, 'lore-warehouse'))).toBe(true) // untouched
    expect(existsSync(join(userDataDir, 'riffLibraryPrefs.json'))).toBe(true) // carried forward
    expect(existsSync(join(userDataDir, 'loreWarehousePrefs.json'))).toBe(false) // legacy cleaned up
  })
})
