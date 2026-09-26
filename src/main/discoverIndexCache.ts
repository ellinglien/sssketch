// src/main/discoverIndexCache.ts
import type Database from 'better-sqlite3'
import type { RiffIndexEntry } from './discoverCandidates'

/** Persisted counterpart to discoverCandidates.ts's own in-memory
 * riffIndexCache/instrumentRowsCache -- see the schema doc comment for
 * DiscoverRiffIndexCache (riffLibrarySchema.ts) for the full "why". This
 * file is pure CRUD against those cache tables in `ownDb` (sssketch's own
 * writable warehouse -- the only db these tables ever live in, even when
 * caching data ABOUT an external, read-only LORE archive, keyed by that
 * archive's own SourceDbKey); the caller (discoverCandidates.ts's own
 * prewarmDiscoverCandidateCaches) owns the actual decide-cache-vs-rescan
 * logic and the in-memory WeakMap seeding, since only that module can
 * touch its own private caches directly. */

const PAGE_SIZE = 5000

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** The row count this SourceDbKey's riff index was last saved with, or
 * null if nothing has ever been cached for it -- the freshness check a
 * caller compares against a fresh `SELECT COUNT(*) FROM Riffs` before
 * trusting the cache. */
export function getCachedRiffCount(ownDb: Database.Database, sourceDbKey: string): number | null {
  const row = ownDb
    .prepare(`SELECT RiffCount FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = ?`)
    .get(sourceDbKey) as { RiffCount: number } | undefined
  return row?.RiffCount ?? null
}

export function getCachedStemCount(ownDb: Database.Database, sourceDbKey: string): number | null {
  const row = ownDb
    .prepare(`SELECT StemCount FROM DiscoverInstrumentRowsCacheMeta WHERE SourceDbKey = ?`)
    .get(sourceDbKey) as { StemCount: number } | undefined
  return row?.StemCount ?? null
}

/** Reads a previously-saved riff index back out, paginated + yielded the
 * same way as discoverCandidates.ts's own buildRiffIndex (same
 * PAGE_SIZE/yield-between-pages discipline, for the same "don't block the
 * main process on one huge synchronous fetch" reason -- this cache can
 * legitimately hold hundreds of thousands of rows too). Returns an empty
 * map for a key that's never been saved, same "absent = empty, never
 * throw" convention as the live scan's own missing-table handling. */
export async function loadCachedRiffIndex(
  ownDb: Database.Database,
  sourceDbKey: string,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, RiffIndexEntry>> {
  const index = new Map<string, RiffIndexEntry>()
  const total = (
    ownDb
      .prepare(`SELECT COUNT(*) AS n FROM DiscoverRiffIndexCache WHERE SourceDbKey = ?`)
      .get(sourceDbKey) as { n: number }
  ).n
  if (total === 0) return index

  let offset = 0
  while (offset < total) {
    const page = ownDb
      .prepare(
        `SELECT StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime FROM DiscoverRiffIndexCache
         WHERE SourceDbKey = ? ORDER BY StemCID LIMIT ? OFFSET ?`
      )
      .all(sourceDbKey, PAGE_SIZE, offset) as {
      StemCID: string
      RiffCID: string
      OwnerJamCID: string
      BPMrnd: number
      CreationTime: number | null
    }[]
    if (page.length === 0) break

    for (const row of page) {
      index.set(row.StemCID, {
        riffCID: row.RiffCID,
        ownerJamCID: row.OwnerJamCID,
        bpmRnd: row.BPMrnd,
        creationTime: row.CreationTime
      })
    }
    offset += page.length
    onProgress?.(offset, total)
    if (page.length < PAGE_SIZE) break
    await yieldToEventLoop()
  }
  return index
}

/** Replaces whatever was previously cached for `sourceDbKey` with `index`
 * -- a real DELETE+bulk-INSERT inside one transaction (not a row-by-row
 * loop with no transaction, which would be dramatically slower for a
 * 300k+-row index and could leave a half-written cache behind if
 * interrupted). `riffCount` is the REAL, freshly-measured `SELECT
 * COUNT(*) FROM Riffs` the caller already has from deciding to rescan --
 * stored so a future load can compare against it, not re-derived from
 * `index.size` (which counts unique STEMS, not riffs). */
export function saveRiffIndexCache(
  ownDb: Database.Database,
  sourceDbKey: string,
  index: Map<string, RiffIndexEntry>,
  riffCount: number
): void {
  const del = ownDb.prepare(`DELETE FROM DiscoverRiffIndexCache WHERE SourceDbKey = ?`)
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverRiffIndexCache (SourceDbKey, StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const setMeta = ownDb.prepare(
    `INSERT INTO DiscoverRiffIndexCacheMeta (SourceDbKey, RiffCount, ComputedAt) VALUES (?, ?, ?)
     ON CONFLICT(SourceDbKey) DO UPDATE SET RiffCount = excluded.RiffCount, ComputedAt = excluded.ComputedAt`
  )
  const tx = ownDb.transaction(() => {
    del.run(sourceDbKey)
    for (const [stemCID, entry] of index) {
      insert.run(
        sourceDbKey,
        stemCID,
        entry.riffCID,
        entry.ownerJamCID,
        entry.bpmRnd,
        entry.creationTime
      )
    }
    setMeta.run(sourceDbKey, riffCount, Date.now())
  })
  tx()
}

export interface CachedInstrumentRow {
  StemCID: string
  Instrument: number | null
  OwnerJamCID: string
}

/** Same shape/discipline as loadCachedRiffIndex above, for
 * getInstrumentRowsForDb's own cache. */
export async function loadCachedInstrumentRows(
  ownDb: Database.Database,
  sourceDbKey: string,
  onProgress?: (completed: number, total: number) => void
): Promise<CachedInstrumentRow[]> {
  const rows: CachedInstrumentRow[] = []
  const total = (
    ownDb
      .prepare(`SELECT COUNT(*) AS n FROM DiscoverInstrumentRowsCache WHERE SourceDbKey = ?`)
      .get(sourceDbKey) as { n: number }
  ).n
  if (total === 0) return rows

  let offset = 0
  while (offset < total) {
    const page = ownDb
      .prepare(
        `SELECT StemCID, Instrument, OwnerJamCID FROM DiscoverInstrumentRowsCache
         WHERE SourceDbKey = ? ORDER BY StemCID LIMIT ? OFFSET ?`
      )
      .all(sourceDbKey, PAGE_SIZE, offset) as CachedInstrumentRow[]
    if (page.length === 0) break

    rows.push(...page)
    offset += page.length
    onProgress?.(offset, total)
    if (page.length < PAGE_SIZE) break
    await yieldToEventLoop()
  }
  return rows
}

/** Same replace-in-one-transaction shape as saveRiffIndexCache above.
 * `stemCount` is the real `SELECT COUNT(*) FROM Stems` the caller already
 * measured -- always equal to `rows.length` in practice (this cache has
 * no dedup step, unlike the riff index), but passed explicitly rather
 * than derived, for the same "store what was actually measured, not a
 * re-derived proxy" reasoning as saveRiffIndexCache. */
export function saveInstrumentRowsCache(
  ownDb: Database.Database,
  sourceDbKey: string,
  rows: CachedInstrumentRow[],
  stemCount: number
): void {
  const del = ownDb.prepare(`DELETE FROM DiscoverInstrumentRowsCache WHERE SourceDbKey = ?`)
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverInstrumentRowsCache (SourceDbKey, StemCID, Instrument, OwnerJamCID)
     VALUES (?, ?, ?, ?)`
  )
  const setMeta = ownDb.prepare(
    `INSERT INTO DiscoverInstrumentRowsCacheMeta (SourceDbKey, StemCount, ComputedAt) VALUES (?, ?, ?)
     ON CONFLICT(SourceDbKey) DO UPDATE SET StemCount = excluded.StemCount, ComputedAt = excluded.ComputedAt`
  )
  const tx = ownDb.transaction(() => {
    del.run(sourceDbKey)
    for (const row of rows) {
      insert.run(sourceDbKey, row.StemCID, row.Instrument, row.OwnerJamCID)
    }
    setMeta.run(sourceDbKey, stemCount, Date.now())
  })
  tx()
}

/** One kept group's rows, appended to an ALREADY-SAVED riff index rather
 * than invalidating it.
 *
 * Why this exists: the freshness check for this cache is a per-db row
 * count (getCachedRiffCount vs a live COUNT(*) FROM Riffs, compared in
 * discoverCandidates.ts's prewarmDiscoverCandidateCaches). Saving a
 * discovered group adds a Riffs row to the own db, which moves that count,
 * which means the next launch pays a FULL rebuild. In the roll/keep/roll
 * loop this feature is built around, that is the difference between a game
 * and a progress bar.
 *
 * NO TRANSACTION OF ITS OWN, deliberately: the caller
 * (discoveredLibrary.ts's saveDiscoveredRifff) wraps this, writeRiffDetail
 * and everything else in ONE transaction, so a save is all-or-nothing
 * across the real rows and the cache rows alike.
 *
 * ON CONFLICT DO NOTHING matches buildRiffIndex's own first-seen-wins rule
 * for a stem that appears in more than one riff -- this table is
 * PRIMARY KEY (SourceDbKey, StemCID), one row per stem, not per riff.
 *
 * A key with no meta row has never been cached at all, and half a cache is
 * worse than none: appending to it would make a partial index look
 * complete. Returns without writing anything in that case. */
export function appendRiffIndexRows(
  ownDb: Database.Database,
  sourceDbKey: string,
  rows: readonly {
    stemCID: string
    riffCID: string
    ownerJamCID: string
    bpmRnd: number
    creationTime: number | null
  }[],
  riffCountDelta: number
): void {
  const existing = getCachedRiffCount(ownDb, sourceDbKey)
  if (existing === null) return
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverRiffIndexCache (SourceDbKey, StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  for (const row of rows) {
    insert.run(sourceDbKey, row.stemCID, row.riffCID, row.ownerJamCID, row.bpmRnd, row.creationTime)
  }
  ownDb
    .prepare(
      `UPDATE DiscoverRiffIndexCacheMeta SET RiffCount = ?, ComputedAt = ? WHERE SourceDbKey = ?`
    )
    .run(existing + riffCountDelta, Date.now(), sourceDbKey)
}

/** Same shape and the same reasoning as appendRiffIndexRows above, for
 * getInstrumentRowsForDb's own cache. Needed too, not just the riff index:
 * a stem from an external archive gets a genuinely NEW Stems row in the
 * own db when a group referencing it is kept, which moves the Stems count
 * this cache is checked against. */
export function appendInstrumentRows(
  ownDb: Database.Database,
  sourceDbKey: string,
  rows: readonly CachedInstrumentRow[],
  stemCountDelta: number
): void {
  const existing = getCachedStemCount(ownDb, sourceDbKey)
  if (existing === null) return
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverInstrumentRowsCache (SourceDbKey, StemCID, Instrument, OwnerJamCID)
     VALUES (?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  for (const row of rows) insert.run(sourceDbKey, row.StemCID, row.Instrument, row.OwnerJamCID)
  ownDb
    .prepare(
      `UPDATE DiscoverInstrumentRowsCacheMeta SET StemCount = ?, ComputedAt = ? WHERE SourceDbKey = ?`
    )
    .run(existing + stemCountDelta, Date.now(), sourceDbKey)
}
