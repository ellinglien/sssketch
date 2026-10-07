// src/main/discoverIndexCache.ts
import type Database from 'better-sqlite3'
import type { RiffIndexEntry } from './discoverCandidates'
import type { RowidWatermark } from './rowidWatermark'
import { countWork } from './workCounters'

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

/** Rows per page when loading a saved index at startup. Measured on a cold
 * copy of Elling's ownDb (891k rows): 5,000-row pages blocked up to 430 ms;
 * 2,000-row pages up to 155 ms in the full startup (the 3.5 GB file's pages
 * cold); 1,000 keeps a page well under 100 ms. */
const LOAD_PAGE_SIZE = 1000

/** Same budget as scanTargetCache.ts's writePairs: one transaction holds
 * the main process at most about this long before it commits and yields. */
const TRANSACTION_BUDGET_MS = 16

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// --- Rowid watermarks (scan plan b21ea5a2 Task 2) ---------------------------
//
// The meta rows gain the watermark the shared extension rule needs
// (rowidWatermark.ts): MaxRowid, and the key of the row at it. A meta row
// written before this has MaxRowid NULL with a non-zero count: "legacy" --
// it loads as before while the counts match, and the first move rebuilds it
// once, with a watermark from then on. The riff index also keeps the
// skeleton riffs it has seen (no stems yet; the sync fills them in place
// later, which no count or watermark can see) so every extension re-reads
// them: DiscoverRiffIndexOpenRiffs, as DiscoverScanTargetOpenRiffs does for
// the scan targets.
//
// Ensured lazily, once per connection: a column added to an existing tiny
// meta table and one CREATE TABLE IF NOT EXISTS -- instant even on the
// 3.6 GB warehouse, and it also covers tests' hand-written schemas.
//
// "Once" is remembered only when the DDL ran outside a transaction. Inside
// one (a keep's saveDiscoveredRifff can be the first caller on a
// connection) the ALTERs belong to that transaction: if it rolls back, the
// columns go with it, so the next call has to look again rather than trust
// a mark that outlived them.
const watermarkSchemaReady = new WeakSet<Database.Database>()

function addColumnsIfMissing(
  db: Database.Database,
  table: string,
  columns: readonly [string, string][]
): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (existing.length === 0) return
  for (const [name, type] of columns) {
    if (!existing.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
  }
}

export function ensureDiscoverIndexWatermarkSchema(ownDb: Database.Database): void {
  if (watermarkSchemaReady.has(ownDb)) return
  addColumnsIfMissing(ownDb, 'DiscoverRiffIndexCacheMeta', [
    ['MaxRowid', 'INTEGER'],
    ['WatermarkRiffCID', 'TEXT'],
    // The entries the copy holds (one per stem in a riff): the total a load
    // of it reports against (2026-10-07). NULL: not known (saved before).
    ['EntryCount', 'INTEGER']
  ])
  addColumnsIfMissing(ownDb, 'DiscoverInstrumentRowsCacheMeta', [
    ['MaxRowid', 'INTEGER'],
    ['WatermarkStemCID', 'TEXT']
  ])
  ownDb.exec(`CREATE TABLE IF NOT EXISTS DiscoverRiffIndexOpenRiffs (
    SourceDbKey TEXT NOT NULL,
    RiffRowid INTEGER NOT NULL,
    PRIMARY KEY (SourceDbKey, RiffRowid)
  )`)
  if (!ownDb.inTransaction) watermarkSchemaReady.add(ownDb)
}

/** A saved index's meta: the rows it accounts for, and its watermark --
 * null for a legacy row (saved before watermarks: loads while the count
 * matches, never extends). */
export interface IndexCacheMeta {
  count: number
  watermark: RowidWatermark | null
}

function metaOf(count: number, maxRowid: number | null, key: string | null): IndexCacheMeta {
  if (maxRowid === null && count > 0) return { count, watermark: null }
  return { count, watermark: { count, maxRowid, keyAtMax: key } }
}

export function readRiffIndexMeta(
  ownDb: Database.Database,
  sourceDbKey: string
): IndexCacheMeta | null {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const row = ownDb
    .prepare(
      `SELECT RiffCount, MaxRowid, WatermarkRiffCID FROM DiscoverRiffIndexCacheMeta
       WHERE SourceDbKey = ?`
    )
    .get(sourceDbKey) as
    { RiffCount: number; MaxRowid: number | null; WatermarkRiffCID: string | null } | undefined
  return row ? metaOf(row.RiffCount, row.MaxRowid, row.WatermarkRiffCID) : null
}

/** `entries`: the walk's entry count after this page (left as it was when
 * not given). */
function writeRiffIndexMeta(
  ownDb: Database.Database,
  sourceDbKey: string,
  watermark: RowidWatermark,
  entries?: number
): void {
  ownDb
    .prepare(
      `INSERT INTO DiscoverRiffIndexCacheMeta
         (SourceDbKey, RiffCount, MaxRowid, WatermarkRiffCID, ComputedAt, EntryCount)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(SourceDbKey) DO UPDATE SET
         RiffCount = excluded.RiffCount, MaxRowid = excluded.MaxRowid,
         WatermarkRiffCID = excluded.WatermarkRiffCID, ComputedAt = excluded.ComputedAt,
         EntryCount = COALESCE(excluded.EntryCount, EntryCount)`
    )
    .run(
      sourceDbKey,
      watermark.count,
      watermark.maxRowid,
      watermark.keyAtMax,
      Date.now(),
      entries ?? null
    )
}

/** How many entries the saved riff index for `sourceDbKey` holds, or null
 * when unknown (nothing saved, or saved before this was kept). Read with
 * the meta, so a load's progress has a total in its own unit (2026-10-07:
 * RiffCount counts Riffs, not entries -- "761,929 / 900,041"). */
export function readRiffIndexEntryCount(
  ownDb: Database.Database,
  sourceDbKey: string
): number | null {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const row = ownDb
    .prepare(`SELECT EntryCount FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = ?`)
    .get(sourceDbKey) as { EntryCount: number | null } | undefined
  return row?.EntryCount ?? null
}

/** Records the entry count a load found (a copy saved before the count was
 * kept, or one another app version touched), for the next load's total.
 * Nothing without a meta row. */
export function recordRiffIndexEntryCount(
  ownDb: Database.Database,
  sourceDbKey: string,
  entries: number
): void {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  ownDb
    .prepare(`UPDATE DiscoverRiffIndexCacheMeta SET EntryCount = ? WHERE SourceDbKey = ?`)
    .run(entries, sourceDbKey)
}

/** Runs `steps` in time-budgeted transactions (TRANSACTION_BUDGET_MS each),
 * yielding between them; `finish` runs in the last one. Never one long
 * synchronous block, however many rows a page brings. */
async function runSliced(
  ownDb: Database.Database,
  steps: number,
  step: (i: number) => void,
  finish: () => void
): Promise<void> {
  let i = 0
  for (;;) {
    const done = ownDb.transaction((): boolean => {
      const started = performance.now()
      while (i < steps) {
        step(i++)
        if (performance.now() - started >= TRANSACTION_BUDGET_MS) return false
      }
      finish()
      return true
    })()
    countWork('sql:discover-index.slice')
    if (done) return
    await yieldToEventLoop()
  }
}

/** Deletes `table`'s rows for `sourceDbKey` in bounded chunks with yields --
 * a big archive's cache is hundreds of thousands of rows, and one DELETE
 * would block for a while. */
async function deleteKeyInChunks(
  ownDb: Database.Database,
  table: string,
  sourceDbKey: string
): Promise<void> {
  const deleteChunk = ownDb.prepare(
    `DELETE FROM ${table} WHERE rowid IN
       (SELECT rowid FROM ${table} WHERE SourceDbKey = ? LIMIT ${PAGE_SIZE})`
  )
  while (deleteChunk.run(sourceDbKey).changes > 0) await yieldToEventLoop()
}

/** Starts the riff index for `sourceDbKey` over: meta first (so a partial
 * cache is never read as the old complete one), then the rows and open
 * riffs in chunks, then an EMPTY watermark -- a valid base the walk extends
 * page by page, so an interrupted rebuild resumes where it stopped. */
export async function resetRiffIndexCache(
  ownDb: Database.Database,
  sourceDbKey: string
): Promise<void> {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  countWork('discover-index:reset.riff-index')
  ownDb.prepare(`DELETE FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = ?`).run(sourceDbKey)
  await deleteKeyInChunks(ownDb, 'DiscoverRiffIndexCache', sourceDbKey)
  await deleteKeyInChunks(ownDb, 'DiscoverRiffIndexOpenRiffs', sourceDbKey)
  writeRiffIndexMeta(ownDb, sourceDbKey, { count: 0, maxRowid: null, keyAtMax: null }, 0)
}

/** One walked page's effect on the riff index. */
export interface RiffIndexPage {
  /** Entries set or moved to an earlier riff (by RiffCID) in this page. */
  changed: [string, RiffIndexEntry][]
  /** Skeleton riffs seen (rowids), and open riffs found filled in. */
  opened: number[]
  closed: number[]
  /** The walk's watermark after this page. */
  watermark: RowidWatermark
  /** The walk's entry count after this page (its whole index, not just
   * this page's changes): saved with the meta, for a later load's total. */
  entries?: number
}

/** Persists one walked page in time-budgeted transactions: entries (an
 * existing entry moves only to an earlier RiffCID -- first seen in RiffCID
 * order wins, decision 4), open riffs, then the meta in the last
 * transaction. Interrupted part-way, the meta still describes a page
 * boundary and the rows past it are re-read on resume (every write here is
 * idempotent). */
export async function persistRiffIndexPage(
  ownDb: Database.Database,
  sourceDbKey: string,
  page: RiffIndexPage
): Promise<void> {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const upsert = ownDb.prepare(
    `INSERT INTO DiscoverRiffIndexCache
       (SourceDbKey, StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(SourceDbKey, StemCID) DO UPDATE SET
       RiffCID = excluded.RiffCID, OwnerJamCID = excluded.OwnerJamCID,
       BPMrnd = excluded.BPMrnd, CreationTime = excluded.CreationTime
     WHERE excluded.RiffCID < DiscoverRiffIndexCache.RiffCID`
  )
  const open = ownDb.prepare(
    `INSERT OR IGNORE INTO DiscoverRiffIndexOpenRiffs (SourceDbKey, RiffRowid) VALUES (?, ?)`
  )
  const close = ownDb.prepare(
    `DELETE FROM DiscoverRiffIndexOpenRiffs WHERE SourceDbKey = ? AND RiffRowid = ?`
  )
  const { changed, opened, closed } = page
  const total = changed.length + opened.length + closed.length
  await runSliced(
    ownDb,
    total,
    (i) => {
      if (i < changed.length) {
        const [stemCID, e] = changed[i]
        upsert.run(sourceDbKey, stemCID, e.riffCID, e.ownerJamCID, e.bpmRnd, e.creationTime)
      } else if (i < changed.length + opened.length) {
        open.run(sourceDbKey, opened[i - changed.length])
      } else {
        close.run(sourceDbKey, closed[i - changed.length - opened.length])
      }
    },
    () => writeRiffIndexMeta(ownDb, sourceDbKey, page.watermark, page.entries)
  )
}

export function loadCachedRiffOpenRowids(
  ownDb: Database.Database,
  sourceDbKey: string
): Set<number> {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const rows = ownDb
    .prepare(`SELECT RiffRowid FROM DiscoverRiffIndexOpenRiffs WHERE SourceDbKey = ?`)
    .all(sourceDbKey) as { RiffRowid: number }[]
  return new Set(rows.map((r) => r.RiffRowid))
}

/** (Tests and the legacy shape; the prewarm reads readRiffIndexMeta.)
 * The row count this SourceDbKey's riff index was last saved with, or
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

/** Reads a previously-saved riff index back out, LOAD_PAGE_SIZE rows per
 * synchronous page with a yield between (this cache holds hundreds of
 * thousands of rows). Returns an empty map for a key that's never been
 * saved, same "absent = empty, never throw" convention as the live scan's
 * own missing-table handling.
 *
 * No COUNT first (faster startup, 2026-10-06): one `COUNT(*) ... WHERE
 * SourceDbKey = ?` over 891k rows took 1.26 s cold on Elling's ownDb, one
 * statement, only to give the progress line a total. The caller's
 * `totalHint` (a meta count) stands in for it; the last update is always
 * completed === total. */
export async function loadCachedRiffIndex(
  ownDb: Database.Database,
  sourceDbKey: string,
  onProgress?: (completed: number, total: number) => void,
  totalHint = 0
): Promise<Map<string, RiffIndexEntry>> {
  const index = new Map<string, RiffIndexEntry>()
  // Keyset on the primary key (SourceDbKey, StemCID): no OFFSET re-skip.
  const statement = ownDb.prepare(
    `SELECT StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime FROM DiscoverRiffIndexCache
     WHERE SourceDbKey = ? AND StemCID > ? ORDER BY StemCID LIMIT ?`
  )
  let after = ''
  for (;;) {
    const page = statement.all(sourceDbKey, after, LOAD_PAGE_SIZE) as {
      StemCID: string
      RiffCID: string
      OwnerJamCID: string
      BPMrnd: number
      CreationTime: number | null
    }[]
    countWork('prewarm:rows-loaded.riff-index', page.length)
    for (const row of page) {
      index.set(row.StemCID, {
        riffCID: row.RiffCID,
        ownerJamCID: row.OwnerJamCID,
        bpmRnd: row.BPMrnd,
        creationTime: row.CreationTime
      })
    }
    if (page.length < LOAD_PAGE_SIZE) break
    // No total given: a running count (total 0), never "n of n".
    onProgress?.(index.size, totalHint > 0 ? Math.max(totalHint, index.size) : 0)
    after = page[page.length - 1].StemCID
    await yieldToEventLoop()
  }
  if (index.size > 0) onProgress?.(index.size, index.size)
  return index
}

/** LEGACY shape (no watermark), kept for what still reads it: a cache saved
 * before Task 2, which tests simulate with this. Production saves go page by
 * page through resetRiffIndexCache + persistRiffIndexPage instead, never as
 * one transaction.
 *
 * Replaces whatever was previously cached for `sourceDbKey` with `index`
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
  // The meta row is replaced, not updated, so a watermark from an earlier
  // walk can't outlive it.
  const delMeta = ownDb.prepare(`DELETE FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = ?`)
  const tx = ownDb.transaction(() => {
    del.run(sourceDbKey)
    delMeta.run(sourceDbKey)
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

export function readInstrumentRowsMeta(
  ownDb: Database.Database,
  sourceDbKey: string
): IndexCacheMeta | null {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const row = ownDb
    .prepare(
      `SELECT StemCount, MaxRowid, WatermarkStemCID FROM DiscoverInstrumentRowsCacheMeta
       WHERE SourceDbKey = ?`
    )
    .get(sourceDbKey) as
    { StemCount: number; MaxRowid: number | null; WatermarkStemCID: string | null } | undefined
  return row ? metaOf(row.StemCount, row.MaxRowid, row.WatermarkStemCID) : null
}

function writeInstrumentRowsMeta(
  ownDb: Database.Database,
  sourceDbKey: string,
  watermark: RowidWatermark
): void {
  ownDb
    .prepare(
      `INSERT INTO DiscoverInstrumentRowsCacheMeta
         (SourceDbKey, StemCount, MaxRowid, WatermarkStemCID, ComputedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(SourceDbKey) DO UPDATE SET
         StemCount = excluded.StemCount, MaxRowid = excluded.MaxRowid,
         WatermarkStemCID = excluded.WatermarkStemCID, ComputedAt = excluded.ComputedAt`
    )
    .run(sourceDbKey, watermark.count, watermark.maxRowid, watermark.keyAtMax, Date.now())
}

/** resetRiffIndexCache's counterpart for the instrument rows (Task 3). */
export async function resetInstrumentRowsCache(
  ownDb: Database.Database,
  sourceDbKey: string
): Promise<void> {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  countWork('discover-index:reset.instrument-rows')
  ownDb
    .prepare(`DELETE FROM DiscoverInstrumentRowsCacheMeta WHERE SourceDbKey = ?`)
    .run(sourceDbKey)
  await deleteKeyInChunks(ownDb, 'DiscoverInstrumentRowsCache', sourceDbKey)
  writeInstrumentRowsMeta(ownDb, sourceDbKey, { count: 0, maxRowid: null, keyAtMax: null })
}

/** Persists one walked Stems page (stemsTableWalk.ts) in time-budgeted
 * transactions, the watermark in the last. Stems rows are written once
 * (never filled in place), so a row already saved is left as it is. */
export async function persistInstrumentRowsPage(
  ownDb: Database.Database,
  sourceDbKey: string,
  rows: readonly CachedInstrumentRow[],
  watermark: RowidWatermark
): Promise<void> {
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverInstrumentRowsCache (SourceDbKey, StemCID, Instrument, OwnerJamCID)
     VALUES (?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  await runSliced(
    ownDb,
    rows.length,
    (i) => insert.run(sourceDbKey, rows[i].StemCID, rows[i].Instrument, rows[i].OwnerJamCID),
    () => writeInstrumentRowsMeta(ownDb, sourceDbKey, watermark)
  )
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
  onProgress?: (completed: number, total: number) => void,
  totalHint = 0
): Promise<CachedInstrumentRow[]> {
  const rows: CachedInstrumentRow[] = []
  // Keyset on the primary key (SourceDbKey, StemCID): StemCID order, which
  // the mask lookup binary-searches (instrumentRowsLookup.ts), and no
  // OFFSET re-skip.
  const statement = ownDb.prepare(
    `SELECT StemCID, Instrument, OwnerJamCID FROM DiscoverInstrumentRowsCache
     WHERE SourceDbKey = ? AND StemCID > ? ORDER BY StemCID LIMIT ?`
  )
  let after = ''
  for (;;) {
    const page = statement.all(sourceDbKey, after, LOAD_PAGE_SIZE) as CachedInstrumentRow[]
    countWork('prewarm:rows-loaded.instrument-rows', page.length)
    for (const row of page) rows.push(row)
    if (page.length < LOAD_PAGE_SIZE) break
    onProgress?.(rows.length, totalHint > 0 ? Math.max(totalHint, rows.length) : 0)
    after = page[page.length - 1].StemCID
    await yieldToEventLoop()
  }
  if (rows.length > 0) onProgress?.(rows.length, rows.length)
  return rows
}

/** LEGACY shape (no watermark), like saveRiffIndexCache above: production
 * saves go page by page through resetInstrumentRowsCache +
 * persistInstrumentRowsPage.
 *
 * Same replace-in-one-transaction shape as saveRiffIndexCache above.
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
  const delMeta = ownDb.prepare(`DELETE FROM DiscoverInstrumentRowsCacheMeta WHERE SourceDbKey = ?`)
  const tx = ownDb.transaction(() => {
    del.run(sourceDbKey)
    delMeta.run(sourceDbKey)
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
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const meta = ownDb
    .prepare(`SELECT RiffCount, MaxRowid FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = ?`)
    .get(sourceDbKey) as { RiffCount: number; MaxRowid: number | null } | undefined
  if (!meta) return
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverRiffIndexCache (SourceDbKey, StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  let added = 0
  for (const row of rows) {
    added += insert.run(
      sourceDbKey,
      row.stemCID,
      row.riffCID,
      row.ownerJamCID,
      row.bpmRnd,
      row.creationTime
    ).changes
  }
  if (added > 0) {
    ownDb
      .prepare(
        `UPDATE DiscoverRiffIndexCacheMeta SET EntryCount = EntryCount + ?
         WHERE SourceDbKey = ? AND EntryCount IS NOT NULL`
      )
      .run(added, sourceDbKey)
  }
  // Scan plan decision 5: a watermarked meta is left alone -- the next
  // extension reads the kept riff (past the watermark) again, and the
  // upserts are idempotent, so it never has to assume no other riff arrived
  // meanwhile. A legacy meta (no watermark) keeps the count bump it always
  // had. Forgetting the group before that extension has to drop the meta
  // (invalidateRiffIndexCache, below).
  if (meta.MaxRowid !== null) return
  ownDb
    .prepare(
      `UPDATE DiscoverRiffIndexCacheMeta SET RiffCount = ?, ComputedAt = ? WHERE SourceDbKey = ?`
    )
    .run(meta.RiffCount + riffCountDelta, Date.now(), sourceDbKey)
}

/** Drops the saved riff index's meta for `sourceDbKey`, so the next launch
 * rebuilds it (no meta = never cached; appendRiffIndexRows writes nothing
 * to it meanwhile). For a forgotten kept group (forgetDiscoveredRifff):
 * its rows were appended past the watermark, and once its Riffs row is
 * deleted before any extension has read it, the count, MAX(rowid) and the
 * RiffCID at it are back where the watermark stands -- the saved index
 * reads as current and keeps pointing its stems at a riff that is gone.
 * (Forgotten after an extension, the count moves and it rebuilds anyway.)
 * No transaction of its own: forget runs it inside its own. */
export function invalidateRiffIndexCache(ownDb: Database.Database, sourceDbKey: string): void {
  ownDb.prepare(`DELETE FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = ?`).run(sourceDbKey)
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
  ensureDiscoverIndexWatermarkSchema(ownDb)
  const meta = ownDb
    .prepare(
      `SELECT StemCount, MaxRowid FROM DiscoverInstrumentRowsCacheMeta WHERE SourceDbKey = ?`
    )
    .get(sourceDbKey) as { StemCount: number; MaxRowid: number | null } | undefined
  if (!meta) return
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverInstrumentRowsCache (SourceDbKey, StemCID, Instrument, OwnerJamCID)
     VALUES (?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  for (const row of rows) insert.run(sourceDbKey, row.StemCID, row.Instrument, row.OwnerJamCID)
  // Decision 5, as appendRiffIndexRows: a watermarked meta is left alone.
  // The next extension walks these stems again: harmless here (DO NOTHING),
  // and the in-memory rows it extends skip the ones they already hold
  // (discoverCandidates.ts's withWalkedRows) -- the loaded copy has them.
  if (meta.MaxRowid !== null) return
  ownDb
    .prepare(
      `UPDATE DiscoverInstrumentRowsCacheMeta SET StemCount = ?, ComputedAt = ? WHERE SourceDbKey = ?`
    )
    .run(meta.StemCount + stemCountDelta, Date.now(), sourceDbKey)
}
