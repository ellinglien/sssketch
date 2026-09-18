// src/main/discoverIndexCache.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  getCachedRiffCount,
  getCachedStemCount,
  loadCachedRiffIndex,
  saveRiffIndexCache,
  loadCachedInstrumentRows,
  saveInstrumentRowsCache
} from './discoverIndexCache'

function freshOwnDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE DiscoverRiffIndexCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
      OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL,
      PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverRiffIndexCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, RiffCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE DiscoverInstrumentRowsCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, Instrument INTEGER,
      OwnerJamCID TEXT NOT NULL,
      PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverInstrumentRowsCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, StemCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

describe('discoverIndexCache', () => {
  describe('riff index cache', () => {
    it('getCachedRiffCount returns null when nothing has been cached for this key', () => {
      const own = freshOwnDb()
      expect(getCachedRiffCount(own, 'some-db-path')).toBeNull()
    })

    it('round-trips a riff index through save then load', async () => {
      const own = freshOwnDb()
      const index = new Map([
        ['s1', { riffCID: 'r1', ownerJamCID: 'jam1', bpmRnd: 128 }],
        ['s2', { riffCID: 'r1', ownerJamCID: 'jam1', bpmRnd: 128 }],
        ['s3', { riffCID: 'r2', ownerJamCID: 'jam2', bpmRnd: 140 }]
      ])
      saveRiffIndexCache(own, 'db-a', index, 2)

      expect(getCachedRiffCount(own, 'db-a')).toBe(2)
      const loaded = await loadCachedRiffIndex(own, 'db-a')
      expect(loaded).toEqual(index)
    })

    it('keeps caches for different SourceDbKeys independent', () => {
      const own = freshOwnDb()
      saveRiffIndexCache(
        own,
        'db-a',
        new Map([['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128 }]]),
        1
      )
      saveRiffIndexCache(
        own,
        'db-b',
        new Map([['s2', { riffCID: 'r2', ownerJamCID: 'j2', bpmRnd: 90 }]]),
        1
      )

      expect(getCachedRiffCount(own, 'db-a')).toBe(1)
      expect(getCachedRiffCount(own, 'db-b')).toBe(1)
    })

    it('re-saving for the same key replaces the previous cache, not appends to it', async () => {
      const own = freshOwnDb()
      saveRiffIndexCache(
        own,
        'db-a',
        new Map([['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128 }]]),
        1
      )
      saveRiffIndexCache(
        own,
        'db-a',
        new Map([['s2', { riffCID: 'r2', ownerJamCID: 'j2', bpmRnd: 90 }]]),
        1
      )

      const loaded = await loadCachedRiffIndex(own, 'db-a')
      expect([...loaded.keys()]).toEqual(['s2'])
    })

    it('loadCachedRiffIndex reports progress and reaches completed === total', async () => {
      const own = freshOwnDb()
      const index = new Map([
        ['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128 }],
        ['s2', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128 }]
      ])
      saveRiffIndexCache(own, 'db-a', index, 1)

      const updates: Array<{ completed: number; total: number }> = []
      await loadCachedRiffIndex(own, 'db-a', (completed, total) =>
        updates.push({ completed, total })
      )
      expect(updates.length).toBeGreaterThan(0)
      expect(updates[updates.length - 1]).toEqual({ completed: 2, total: 2 })
    })

    it('loadCachedRiffIndex returns an empty map for an unknown key', async () => {
      const own = freshOwnDb()
      expect(await loadCachedRiffIndex(own, 'never-saved')).toEqual(new Map())
    })
  })

  describe('instrument rows cache', () => {
    it('getCachedStemCount returns null when nothing has been cached for this key', () => {
      const own = freshOwnDb()
      expect(getCachedStemCount(own, 'some-db-path')).toBeNull()
    })

    it('round-trips instrument rows through save then load', async () => {
      const own = freshOwnDb()
      const rows = [
        { StemCID: 's1', Instrument: 1, OwnerJamCID: 'jam1' },
        { StemCID: 's2', Instrument: null, OwnerJamCID: 'jam1' }
      ]
      saveInstrumentRowsCache(own, 'db-a', rows, rows.length)

      expect(getCachedStemCount(own, 'db-a')).toBe(2)
      const loaded = await loadCachedInstrumentRows(own, 'db-a')
      expect(loaded.sort((a, b) => a.StemCID.localeCompare(b.StemCID))).toEqual(rows)
    })

    it('re-saving for the same key replaces the previous cache, not appends to it', async () => {
      const own = freshOwnDb()
      saveInstrumentRowsCache(own, 'db-a', [{ StemCID: 's1', Instrument: 1, OwnerJamCID: 'j1' }], 1)
      saveInstrumentRowsCache(own, 'db-a', [{ StemCID: 's2', Instrument: 2, OwnerJamCID: 'j1' }], 1)

      const loaded = await loadCachedInstrumentRows(own, 'db-a')
      expect(loaded.map((r) => r.StemCID)).toEqual(['s2'])
    })
  })
})
