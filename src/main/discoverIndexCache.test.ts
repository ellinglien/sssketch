// src/main/discoverIndexCache.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  appendInstrumentRows,
  appendRiffIndexRows,
  getCachedRiffCount,
  getCachedStemCount,
  loadCachedRiffIndex,
  saveRiffIndexCache,
  loadCachedInstrumentRows,
  saveInstrumentRowsCache,
  persistRiffIndexPage,
  readRiffIndexMeta,
  readRiffIndexEntryCount,
  recordRiffIndexEntryCount,
  resetRiffIndexCache,
  loadCachedRiffOpenRowids
} from './discoverIndexCache'

function freshOwnDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE DiscoverRiffIndexCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
      OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL, CreationTime INTEGER,
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
        ['s1', { riffCID: 'r1', ownerJamCID: 'jam1', bpmRnd: 128, creationTime: 1700000000 }],
        ['s2', { riffCID: 'r1', ownerJamCID: 'jam1', bpmRnd: 128, creationTime: 1700000000 }],
        // A null creationTime (e.g. a riff whose CreationTime column was
        // itself null) must round-trip as null, not silently become 0 or
        // undefined.
        ['s3', { riffCID: 'r2', ownerJamCID: 'jam2', bpmRnd: 140, creationTime: null }]
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
        new Map([
          ['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128, creationTime: 1700000000 }]
        ]),
        1
      )
      saveRiffIndexCache(
        own,
        'db-b',
        new Map([
          ['s2', { riffCID: 'r2', ownerJamCID: 'j2', bpmRnd: 90, creationTime: 1700000001 }]
        ]),
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
        new Map([
          ['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128, creationTime: 1700000000 }]
        ]),
        1
      )
      saveRiffIndexCache(
        own,
        'db-a',
        new Map([
          ['s2', { riffCID: 'r2', ownerJamCID: 'j2', bpmRnd: 90, creationTime: 1700000001 }]
        ]),
        1
      )

      const loaded = await loadCachedRiffIndex(own, 'db-a')
      expect([...loaded.keys()]).toEqual(['s2'])
    })

    it('loadCachedRiffIndex reports progress and reaches completed === total', async () => {
      const own = freshOwnDb()
      const index = new Map([
        ['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128, creationTime: 1700000000 }],
        ['s2', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128, creationTime: 1700000000 }]
      ])
      saveRiffIndexCache(own, 'db-a', index, 1)

      const updates: Array<{ completed: number; total: number }> = []
      await loadCachedRiffIndex(own, 'db-a', (completed, total) =>
        updates.push({ completed, total })
      )
      expect(updates.length).toBeGreaterThan(0)
      expect(updates[updates.length - 1]).toEqual({ completed: 2, total: 2 })
    })

    it('the loads run no COUNT (1.3 s cold on his ownDb) and report the total they are given', async () => {
      const own = freshOwnDb()
      const index = new Map(
        [...Array(2500)].map((_, i) => [
          `s${String(i).padStart(5, '0')}`,
          { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128, creationTime: 1 }
        ])
      )
      saveRiffIndexCache(own, 'db-a', index, 1)
      saveInstrumentRowsCache(
        own,
        'db-a',
        [...index.keys()].map((StemCID) => ({ StemCID, Instrument: 1, OwnerJamCID: 'j1' })),
        index.size
      )
      const prepare = vi.spyOn(own, 'prepare')
      const updates: Array<{ completed: number; total: number }> = []
      const loaded = await loadCachedRiffIndex(
        own,
        'db-a',
        (completed, total) => updates.push({ completed, total }),
        3000
      )
      const rows = await loadCachedInstrumentRows(own, 'db-a', undefined, 3000)
      expect(loaded.size).toBe(2500)
      expect(rows).toHaveLength(2500)
      expect(prepare.mock.calls.some(([sql]) => String(sql).includes('COUNT('))).toBe(false)
      expect(updates[0]).toEqual({ completed: expect.any(Number), total: 3000 })
      expect(updates[updates.length - 1]).toEqual({ completed: 2500, total: 2500 })
    })

    it('with no total given, the loads report a running count (total 0) until the end', async () => {
      const own = freshOwnDb()
      const index = new Map(
        [...Array(2500)].map((_, i) => [
          `s${String(i).padStart(5, '0')}`,
          { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 128, creationTime: 1 }
        ])
      )
      saveRiffIndexCache(own, 'db-a', index, 1)
      saveInstrumentRowsCache(
        own,
        'db-a',
        [...index.keys()].map((StemCID) => ({ StemCID, Instrument: 1, OwnerJamCID: 'j1' })),
        index.size
      )
      for (const load of [
        (cb: (c: number, t: number) => void) => loadCachedRiffIndex(own, 'db-a', cb),
        (cb: (c: number, t: number) => void) => loadCachedInstrumentRows(own, 'db-a', cb)
      ]) {
        const updates: Array<{ completed: number; total: number }> = []
        await load((completed, total) => updates.push({ completed, total }))
        expect(updates.slice(0, -1).every((u) => u.total === 0 && u.completed > 0)).toBe(true)
        expect(updates.length).toBeGreaterThan(1)
        expect(updates[updates.length - 1]).toEqual({ completed: 2500, total: 2500 })
      }
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

  describe('appendRiffIndexRows', () => {
    it('adds a row and bumps the stored RiffCount', async () => {
      const db = freshOwnDb()
      saveRiffIndexCache(
        db,
        'key1',
        new Map([['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 120, creationTime: 10 }]]),
        1
      )
      appendRiffIndexRows(
        db,
        'key1',
        [
          {
            stemCID: 's2',
            riffCID: 'r2',
            ownerJamCID: 'discovered',
            bpmRnd: 140,
            creationTime: 20
          }
        ],
        1
      )
      expect(getCachedRiffCount(db, 'key1')).toBe(2)
      const loaded = await loadCachedRiffIndex(db, 'key1')
      expect(loaded.get('s2')).toEqual({
        riffCID: 'r2',
        ownerJamCID: 'discovered',
        bpmRnd: 140,
        creationTime: 20
      })
    })

    it('leaves an already-indexed stem pointing at the riff it was first seen in', async () => {
      const db = freshOwnDb()
      saveRiffIndexCache(
        db,
        'key1',
        new Map([['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 120, creationTime: 10 }]]),
        1
      )
      appendRiffIndexRows(
        db,
        'key1',
        [
          {
            stemCID: 's1',
            riffCID: 'r2',
            ownerJamCID: 'discovered',
            bpmRnd: 140,
            creationTime: 20
          }
        ],
        1
      )
      const loaded = await loadCachedRiffIndex(db, 'key1')
      expect(loaded.get('s1')?.riffCID).toBe('r1')
      expect(getCachedRiffCount(db, 'key1')).toBe(2)
    })

    it('does nothing at all for a key that has never been cached', () => {
      const db = freshOwnDb()
      appendRiffIndexRows(
        db,
        'never',
        [{ stemCID: 's1', riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 120, creationTime: 1 }],
        1
      )
      expect(getCachedRiffCount(db, 'never')).toBe(null)
    })
  })

  describe('appendInstrumentRows', () => {
    it('adds a row and bumps the stored StemCount', async () => {
      const db = freshOwnDb()
      saveInstrumentRowsCache(db, 'key1', [{ StemCID: 's1', Instrument: 1, OwnerJamCID: 'j1' }], 1)
      appendInstrumentRows(
        db,
        'key1',
        [{ StemCID: 's2', Instrument: 4, OwnerJamCID: 'discovered' }],
        1
      )
      expect(getCachedStemCount(db, 'key1')).toBe(2)
      const rows = await loadCachedInstrumentRows(db, 'key1')
      expect(rows.map((r) => r.StemCID).sort()).toEqual(['s1', 's2'])
    })

    it('does nothing at all for a key that has never been cached', () => {
      const db = freshOwnDb()
      appendInstrumentRows(db, 'never', [{ StemCID: 's1', Instrument: 1, OwnerJamCID: 'j' }], 1)
      expect(getCachedStemCount(db, 'never')).toBe(null)
    })
  })
})

// Scan plan b21ea5a2 Task 2: the walk persists page by page, never as one
// 844k-row transaction.
describe('persistRiffIndexPage (sliced saves)', () => {
  const entry = (
    i: number
  ): { riffCID: string; ownerJamCID: string; bpmRnd: number; creationTime: number } => ({
    riffCID: `r${i}`,
    ownerJamCID: 'j',
    bpmRnd: 120,
    creationTime: i
  })

  it('commits 50k rows in many transactions with a yield between them, the meta in the last', async () => {
    const own = freshOwnDb()
    await resetRiffIndexCache(own, 'k')
    const changed: [string, ReturnType<typeof entry>][] = Array.from({ length: 50_000 }, (_, i) => [
      `s${String(i).padStart(6, '0')}`,
      entry(i)
    ])
    const transactions = vi.spyOn(own, 'transaction')
    const yields = vi.spyOn(globalThis, 'setImmediate')
    const metaAtEachYield: (number | null)[] = []
    yields.mockImplementation(((fn: () => void) => {
      metaAtEachYield.push(readRiffIndexMeta(own, 'k')?.watermark?.maxRowid ?? null)
      fn()
      return 0 as unknown as NodeJS.Immediate
    }) as unknown as typeof setImmediate)
    await persistRiffIndexPage(own, 'k', {
      changed,
      opened: [7, 8],
      closed: [],
      watermark: { count: 50_002, maxRowid: 50_002, keyAtMax: 'last' }
    })
    yields.mockRestore()
    expect(transactions.mock.calls.length).toBeGreaterThan(1)
    expect(metaAtEachYield.length).toBeGreaterThan(0)
    // Until the last slice, the meta is still the empty watermark.
    expect(metaAtEachYield.every((m) => m === null)).toBe(true)
    expect(readRiffIndexMeta(own, 'k')?.watermark).toEqual({
      count: 50_002,
      maxRowid: 50_002,
      keyAtMax: 'last'
    })
    const loaded = await loadCachedRiffIndex(own, 'k')
    expect(loaded).toEqual(new Map(changed))
    expect(loadCachedRiffOpenRowids(own, 'k')).toEqual(new Set([7, 8]))
  })

  it('moves an entry only to an earlier RiffCID', async () => {
    const own = freshOwnDb()
    await resetRiffIndexCache(own, 'k')
    const wm = { count: 1, maxRowid: 1, keyAtMax: 'x' }
    await persistRiffIndexPage(own, 'k', {
      changed: [['s', { ...entry(1), riffCID: 'm' }]],
      opened: [],
      closed: [],
      watermark: wm
    })
    await persistRiffIndexPage(own, 'k', {
      changed: [['s', { ...entry(2), riffCID: 'z' }]],
      opened: [],
      closed: [],
      watermark: wm
    })
    expect((await loadCachedRiffIndex(own, 'k')).get('s')?.riffCID).toBe('m')
    await persistRiffIndexPage(own, 'k', {
      changed: [['s', { ...entry(3), riffCID: 'a' }]],
      opened: [],
      closed: [],
      watermark: wm
    })
    expect((await loadCachedRiffIndex(own, 'k')).get('s')?.riffCID).toBe('a')
  })

  it('a reset drops the old rows and open riffs, and leaves an empty watermark to extend from', async () => {
    const own = freshOwnDb()
    saveRiffIndexCache(own, 'k', new Map([['s1', entry(1)]]), 1)
    expect(readRiffIndexMeta(own, 'k')).toEqual({ count: 1, watermark: null }) // legacy
    await resetRiffIndexCache(own, 'k')
    expect(readRiffIndexMeta(own, 'k')).toEqual({
      count: 0,
      watermark: { count: 0, maxRowid: null, keyAtMax: null }
    })
    expect((await loadCachedRiffIndex(own, 'k')).size).toBe(0)
  })
})

// 2026-10-07: a load's total must count what the load counts. The meta's
// RiffCount counts Riffs (900,041 on his archive); the copy holds one entry
// per stem in a riff (761,929). The entry count is kept beside it.
describe('the saved riff index entry count', () => {
  const entry = (
    i: number
  ): { riffCID: string; ownerJamCID: string; bpmRnd: number; creationTime: number } => ({
    riffCID: `r${i}`,
    ownerJamCID: 'j',
    bpmRnd: 120,
    creationTime: i
  })

  it('unknown for a copy saved without one', () => {
    const own = freshOwnDb()
    expect(readRiffIndexEntryCount(own, 'k')).toBeNull()
    saveRiffIndexCache(own, 'k', new Map([['s1', entry(1)]]), 1)
    expect(readRiffIndexEntryCount(own, 'k')).toBeNull()
  })

  it('a reset starts it at 0, each walked page records the walk total, a kept stem adds one', async () => {
    const own = freshOwnDb()
    await resetRiffIndexCache(own, 'k')
    expect(readRiffIndexEntryCount(own, 'k')).toBe(0)
    await persistRiffIndexPage(own, 'k', {
      changed: [
        ['s1', entry(1)],
        ['s2', entry(1)]
      ],
      opened: [],
      closed: [],
      watermark: { count: 1, maxRowid: 1, keyAtMax: 'r1' },
      entries: 2
    })
    expect(readRiffIndexEntryCount(own, 'k')).toBe(2)
    // A page without a total (an older caller) leaves the count alone.
    await persistRiffIndexPage(own, 'k', {
      changed: [],
      opened: [],
      closed: [],
      watermark: { count: 2, maxRowid: 2, keyAtMax: 'r2' }
    })
    expect(readRiffIndexEntryCount(own, 'k')).toBe(2)
    appendRiffIndexRows(
      own,
      'k',
      [
        { stemCID: 's2', riffCID: 'r9', ownerJamCID: 'j', bpmRnd: 120, creationTime: 9 },
        { stemCID: 's3', riffCID: 'r9', ownerJamCID: 'j', bpmRnd: 120, creationTime: 9 }
      ],
      1
    )
    expect(readRiffIndexEntryCount(own, 'k')).toBe(3) // s2 was already there
    expect((await loadCachedRiffIndex(own, 'k')).size).toBe(3)
  })

  it('a load records the size it found, so the next one has a total', () => {
    const own = freshOwnDb()
    saveRiffIndexCache(own, 'k', new Map([['s1', entry(1)]]), 1)
    recordRiffIndexEntryCount(own, 'k', 1)
    expect(readRiffIndexEntryCount(own, 'k')).toBe(1)
    // No meta row: nothing to record against.
    recordRiffIndexEntryCount(own, 'other', 5)
    expect(readRiffIndexEntryCount(own, 'other')).toBeNull()
  })
})

describe('ensureDiscoverIndexWatermarkSchema inside a transaction', () => {
  it('a first use inside a transaction that rolls back does not leave the connection marked ready', () => {
    const db = freshOwnDb()
    // A keep (saveDiscoveredRifff) is the first thing to touch these tables
    // on this connection, inside its own transaction, and that transaction fails.
    expect(() =>
      db.transaction(() => {
        appendRiffIndexRows(db, 'key1', [], 0)
        throw new Error('the keep failed')
      })()
    ).toThrow('the keep failed')
    // The ALTERs rolled back with it: the next use must add the columns again.
    expect(() => readRiffIndexMeta(db, 'key1')).not.toThrow()
    const columns = (
      db.prepare(`PRAGMA table_info(DiscoverRiffIndexCacheMeta)`).all() as { name: string }[]
    ).map((c) => c.name)
    expect(columns).toContain('MaxRowid')
  })
})
