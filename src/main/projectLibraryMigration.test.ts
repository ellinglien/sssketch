import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string
let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'music' ? musicDir : userDataDir)
  }
}))

beforeEach(() => {
  musicDir = mkdtempSync(join(tmpdir(), 'sssketch-projectlib-migration-music-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-projectlib-migration-userdata-'))
})

afterEach(() => {
  rmSync(musicDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
})

function writeOldSketch(name: string): void {
  const dir = join(musicDir, 'sssketch', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.sssketchproj`), '{}')
}

describe('migrateProjectLibraryLocation', () => {
  it('moves a real sketch folder from the old default into the new projects/ subfolder', async () => {
    writeOldSketch('groovy-sparrow')
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    const newPath = join(
      musicDir,
      'sssketch',
      'projects',
      'groovy-sparrow',
      'groovy-sparrow.sssketchproj'
    )
    expect(existsSync(newPath)).toBe(true)
    expect(existsSync(join(musicDir, 'sssketch', 'groovy-sparrow'))).toBe(false)
  })

  it('is idempotent -- a second run does not touch new content at the old default once already migrated', async () => {
    writeOldSketch('groovy-sparrow')
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    writeOldSketch('second-one') // simulate new content appearing at the old default after migration
    migrateProjectLibraryLocation()
    expect(existsSync(join(musicDir, 'sssketch', 'second-one'))).toBe(true) // untouched
    expect(existsSync(join(musicDir, 'sssketch', 'projects', 'second-one'))).toBe(false)
  })

  it('ignores non-sketch folders (e.g. .samples-cache) at the old default', async () => {
    mkdirSync(join(musicDir, 'sssketch', '.samples-cache'), { recursive: true })
    writeFileSync(join(musicDir, 'sssketch', '.samples-cache', 'somefile.wav'), 'x')
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    expect(existsSync(join(musicDir, 'sssketch', '.samples-cache'))).toBe(true)
    expect(existsSync(join(musicDir, 'sssketch', 'projects'))).toBe(false)
  })

  it('does nothing when the old default has no real sketch content', async () => {
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    expect(() => migrateProjectLibraryLocation()).not.toThrow()
    expect(existsSync(join(musicDir, 'sssketch', 'projects'))).toBe(false)
  })

  it('does nothing when an explicit library root override is already stored', async () => {
    writeOldSketch('groovy-sparrow')
    writeFileSync(
      join(userDataDir, 'libraryPrefs.json'),
      JSON.stringify({ root: '/Volumes/External/MySketches' })
    )
    const { migrateProjectLibraryLocation } = await import('./projectLibraryMigration')
    migrateProjectLibraryLocation()
    expect(existsSync(join(musicDir, 'sssketch', 'groovy-sparrow'))).toBe(true) // untouched
  })
})
