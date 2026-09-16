import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => musicDir
  }
}))

describe('riffLibrarySchema', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-schema-test-'))
  })

  afterEach(async () => {
    const { closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    closeOwnRiffLibraryDb()
    rmSync(musicDir, { recursive: true, force: true })
  })

  it("ownRiffLibraryDbPath lives under <music>/sssketch/library/cache/common, matching riffLibraryStore.ts's own join convention", async () => {
    const { ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    expect(ownRiffLibraryDbPath()).toBe(
      join(musicDir, 'sssketch', 'library', 'cache', 'common', 'warehouse.db3')
    )
  })

  it('openOwnRiffLibraryDb creates the db file and every expected table', async () => {
    const { openOwnRiffLibraryDb, ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    expect(existsSync(ownRiffLibraryDbPath())).toBe(true)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual([
      'Jams',
      'Riffs',
      'StemAutoCategory',
      'StemCategories',
      'StemEmbeddingCache',
      'StemFavourite',
      'StemFeatureCache',
      'StemLedger',
      'Stems',
      'Tags'
    ])
  })

  it('opening twice returns the same cached connection, not a second one', async () => {
    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const first = openOwnRiffLibraryDb()
    const second = openOwnRiffLibraryDb()
    expect(first).toBe(second)
  })

  it('closeOwnRiffLibraryDb followed by a re-open works (re-creates the schema idempotently)', async () => {
    const { openOwnRiffLibraryDb, closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    openOwnRiffLibraryDb()
    closeOwnRiffLibraryDb()
    expect(() => openOwnRiffLibraryDb()).not.toThrow()
  })
})
