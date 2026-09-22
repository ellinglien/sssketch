// src/main/scanTargetCache.ts
//
// Background efficiency B6 (docs/superpowers/specs/2026-09-22-background-
// efficiency-design.md): a persisted, incrementally extended copy of what
// listLibraryScanTargets (discoverLibraryStems.ts) used to derive from a
// full keyset walk of every source db's Riffs table on every launch -- the
// distinct (StemCID, OwnerJamCID) pairs its riffs reference, each with the
// first (RiffCID, slot) it appears at, so reading the pairs back in that
// order reproduces the walk's own order exactly.
//
// Kept in ownDb (the only writable db; an external LORE archive is read-
// only), keyed by SourceDbKey = the source db's file path (Database#name),
// same convention as discoverIndexCache.ts. A launch then only reads the
// riffs added since the cached rowid watermark, plus the "open" riffs it
// last saw as skeletons (all eight StemCID columns NULL) -- the sync inserts
// a riff as a skeleton and fills in its stems later with an in-place UPDATE
// (riffLibraryWriter.ts), which a rowid watermark alone would miss. Riffs
// are otherwise immutable (Endlesss riffs are snapshots), and a filled riff
// that is re-written gets the same stems.
//
// Rebuilt from scratch when the source changed in a way the watermark can't
// explain: fewer rows than cached, a row count that doesn't match "cached +
// rows past the watermark", or a different RiffCID at the watermark rowid
// (the file was replaced, or VACUUM renumbered rowids). A source db without
// rowids, or an in-memory one (no stable identity), isn't cached at all --
// the caller walks it exactly as before.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'

export interface StemJamPair {
  stemCID: string
  jamCID: string
}

const RIFF_PAGE_SIZE = 2000
const CACHE_PAGE_SIZE = 5000
const OPEN_RECHECK_CHUNK = 500
// Same time budget as stemAutoClassify.ts's classify transactions: a full
// rebuild's inserts (hundreds of thousands of rows on a big archive) are
// committed in short transactions with a yield between them.
const TRANSACTION_BUDGET_MS = 16

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS DiscoverScanTargetCache (
  SourceDbKey TEXT NOT NULL,
  StemCID TEXT NOT NULL,
  OwnerJamCID TEXT NOT NULL,
  RiffCID TEXT NOT NULL,
  Slot INTEGER NOT NULL,
  PRIMARY KEY (SourceDbKey, StemCID, OwnerJamCID)
);
CREATE INDEX IF NOT EXISTS idx_scan_target_cache_order
  ON DiscoverScanTargetCache(SourceDbKey, RiffCID, Slot);
CREATE TABLE IF NOT EXISTS DiscoverScanTargetOpenRiffs (
  SourceDbKey TEXT NOT NULL,
  RiffRowid INTEGER NOT NULL,
  PRIMARY KEY (SourceDbKey, RiffRowid)
);
CREATE TABLE IF NOT EXISTS DiscoverScanTargetCacheMeta (
  SourceDbKey TEXT PRIMARY KEY,
  RiffCount INTEGER NOT NULL,
  MaxRowid INTEGER,
  WatermarkRiffCID TEXT,
  ComputedAt INTEGER NOT NULL
);
`

const schemaReady = new WeakSet<Database.Database>()

function ensureSchema(ownDb: Database.Database): void {
  if (schemaReady.has(ownDb)) return
  ownDb.exec(SCHEMA_SQL)
  schemaReady.add(ownDb)
}

interface RiffRow {
  RowId: number
  RiffCID: string
  OwnerJamCID: string
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

const RIFF_COLUMNS = `rowid AS RowId, RiffCID, OwnerJamCID, StemCID_1, StemCID_2, StemCID_3,
  StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8`

interface PairEntry {
  stemCID: string
  jamCID: string
  riffCID: string
  slot: number
}

function slotsOf(riff: RiffRow): { slot: number; stemCID: string }[] {
  const out: { slot: number; stemCID: string }[] = []
  for (let slot = 1; slot <= 8; slot++) {
    const stemCID = riff[`StemCID_${slot}` as keyof RiffRow] as string | null
    if (stemCID) out.push({ slot, stemCID })
  }
  return out
}

function isEarlier(a: { riffCID: string; slot: number }, b: PairEntry): boolean {
  return a.riffCID < b.riffCID || (a.riffCID === b.riffCID && a.slot < b.slot)
}

/** Records every pair `riff` references into `pairs` (keeping each pair's
 * earliest position). True when the riff is a skeleton (no stems yet). */
function collectRiff(riff: RiffRow, pairs: Map<string, PairEntry>): boolean {
  const slots = slotsOf(riff)
  for (const { slot, stemCID } of slots) {
    const key = `${stemCID}|${riff.OwnerJamCID}`
    const existing = pairs.get(key)
    const position = { riffCID: riff.RiffCID, slot }
    if (!existing) {
      pairs.set(key, { stemCID, jamCID: riff.OwnerJamCID, ...position })
    } else if (isEarlier(position, existing)) {
      existing.riffCID = riff.RiffCID
      existing.slot = slot
    }
  }
  return slots.length === 0
}

interface LiveSignal {
  count: number
  maxRowid: number | null
}

function readLiveSignal(sourceDb: Database.Database): LiveSignal | null {
  try {
    const row = sourceDb
      .prepare(`SELECT COUNT(*) AS n, MAX(rowid) AS maxRowid FROM Riffs`)
      .get() as { n: number; maxRowid: number | null }
    return { count: row.n, maxRowid: row.maxRowid }
  } catch {
    return null
  }
}

interface MetaRow {
  RiffCount: number
  MaxRowid: number | null
  WatermarkRiffCID: string | null
}

function riffCIDAtRowid(sourceDb: Database.Database, rowid: number): string | null {
  const row = sourceDb.prepare(`SELECT RiffCID FROM Riffs WHERE rowid = ?`).get(rowid) as
    { RiffCID: string } | undefined
  return row?.RiffCID ?? null
}

/** Whether the cached state can be extended rather than rebuilt. */
function canExtend(sourceDb: Database.Database, meta: MetaRow, live: LiveSignal): boolean {
  if (live.count < meta.RiffCount) return false
  if (meta.MaxRowid === null) return meta.RiffCount === 0
  if (riffCIDAtRowid(sourceDb, meta.MaxRowid) !== meta.WatermarkRiffCID) return false
  const added = (
    sourceDb.prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE rowid > ?`).get(meta.MaxRowid) as {
      n: number
    }
  ).n
  return meta.RiffCount + added === live.count
}

/** Inserts/merges `pairs` (keeping the earlier position on conflict) and
 * `openRowids`, in time-budgeted transactions with yields; `finish` runs in
 * the last transaction (meta update). */
async function writePairs(
  ownDb: Database.Database,
  key: string,
  pairs: PairEntry[],
  openRowids: number[],
  finish: () => void
): Promise<void> {
  const upsertPair = ownDb.prepare(
    `INSERT INTO DiscoverScanTargetCache (SourceDbKey, StemCID, OwnerJamCID, RiffCID, Slot)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(SourceDbKey, StemCID, OwnerJamCID) DO UPDATE SET
       RiffCID = excluded.RiffCID, Slot = excluded.Slot
     WHERE excluded.RiffCID < DiscoverScanTargetCache.RiffCID
        OR (excluded.RiffCID = DiscoverScanTargetCache.RiffCID
            AND excluded.Slot < DiscoverScanTargetCache.Slot)`
  )
  const insertOpen = ownDb.prepare(
    `INSERT OR IGNORE INTO DiscoverScanTargetOpenRiffs (SourceDbKey, RiffRowid) VALUES (?, ?)`
  )
  let pairIndex = 0
  let openIndex = 0
  for (;;) {
    const done = ownDb.transaction((): boolean => {
      const start = performance.now()
      while (pairIndex < pairs.length || openIndex < openRowids.length) {
        if (pairIndex < pairs.length) {
          const p = pairs[pairIndex++]
          upsertPair.run(key, p.stemCID, p.jamCID, p.riffCID, p.slot)
        } else {
          insertOpen.run(key, openRowids[openIndex++])
        }
        if (performance.now() - start >= TRANSACTION_BUDGET_MS) return false
      }
      finish()
      return true
    })()
    if (done) return
    await yieldToEventLoop()
  }
}

function writeMeta(
  ownDb: Database.Database,
  key: string,
  count: number,
  maxRowid: number | null,
  watermarkRiffCID: string | null
): void {
  ownDb
    .prepare(
      `INSERT INTO DiscoverScanTargetCacheMeta
         (SourceDbKey, RiffCount, MaxRowid, WatermarkRiffCID, ComputedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(SourceDbKey) DO UPDATE SET
         RiffCount = excluded.RiffCount, MaxRowid = excluded.MaxRowid,
         WatermarkRiffCID = excluded.WatermarkRiffCID, ComputedAt = excluded.ComputedAt`
    )
    .run(key, count, maxRowid, watermarkRiffCID, Date.now())
}

/** Full keyset walk (RiffCID order, as listLibraryScanTargets always did),
 * then replaces the cache for `key`. The live signal is read BEFORE the
 * walk so a riff the sync adds mid-walk is picked up again next launch
 * (merging is idempotent). */
async function rebuild(
  ownDb: Database.Database,
  sourceDb: Database.Database,
  key: string,
  live: LiveSignal
): Promise<void> {
  countWork('sql:scan-targets.full-rebuild')
  const pairs = new Map<string, PairEntry>()
  const openRowids: number[] = []
  const statement = sourceDb.prepare(
    `SELECT ${RIFF_COLUMNS} FROM Riffs WHERE RiffCID > ? ORDER BY RiffCID LIMIT ?`
  )
  let after = ''
  for (;;) {
    const page = statement.all(after, RIFF_PAGE_SIZE) as RiffRow[]
    if (page.length === 0) break
    after = page[page.length - 1].RiffCID
    for (const riff of page) {
      if (collectRiff(riff, pairs)) openRowids.push(riff.RowId)
    }
    await yieldToEventLoop()
  }
  const watermark = live.maxRowid === null ? null : riffCIDAtRowid(sourceDb, live.maxRowid)
  // Meta first, so an interrupted rebuild is never mistaken for a complete
  // cache; the old rows go in bounded chunks (a big archive's cache is
  // hundreds of thousands of rows -- one DELETE would block for a while).
  ownDb.prepare(`DELETE FROM DiscoverScanTargetCacheMeta WHERE SourceDbKey = ?`).run(key)
  for (const table of ['DiscoverScanTargetCache', 'DiscoverScanTargetOpenRiffs']) {
    const deleteChunk = ownDb.prepare(
      `DELETE FROM ${table} WHERE rowid IN
         (SELECT rowid FROM ${table} WHERE SourceDbKey = ? LIMIT ${CACHE_PAGE_SIZE})`
    )
    while (deleteChunk.run(key).changes > 0) await yieldToEventLoop()
  }
  await writePairs(ownDb, key, [...pairs.values()], openRowids, () =>
    writeMeta(ownDb, key, live.count, live.maxRowid, watermark)
  )
}

/** Reads riffs past the watermark and re-reads the open (skeleton) riffs,
 * merging whatever stems they now reference. */
async function extend(
  ownDb: Database.Database,
  sourceDb: Database.Database,
  key: string,
  meta: MetaRow,
  live: LiveSignal
): Promise<void> {
  countWork('sql:scan-targets.extend')
  const pairs = new Map<string, PairEntry>()
  const openRowids: number[] = []
  const closedRowids: number[] = []

  const statement = sourceDb.prepare(
    `SELECT ${RIFF_COLUMNS} FROM Riffs WHERE rowid > ? ORDER BY rowid LIMIT ?`
  )
  let after = meta.MaxRowid ?? 0
  for (;;) {
    const page = statement.all(after, RIFF_PAGE_SIZE) as RiffRow[]
    if (page.length === 0) break
    countWork('scan-targets.new-riffs', page.length)
    after = page[page.length - 1].RowId
    for (const riff of page) {
      if (collectRiff(riff, pairs)) openRowids.push(riff.RowId)
    }
    await yieldToEventLoop()
  }

  const open = (
    ownDb
      .prepare(`SELECT RiffRowid FROM DiscoverScanTargetOpenRiffs WHERE SourceDbKey = ?`)
      .all(key) as { RiffRowid: number }[]
  ).map((r) => r.RiffRowid)
  for (let i = 0; i < open.length; i += OPEN_RECHECK_CHUNK) {
    const chunk = open.slice(i, i + OPEN_RECHECK_CHUNK)
    countWork('sql:scan-targets.open-recheck')
    const rows = sourceDb
      .prepare(
        `SELECT ${RIFF_COLUMNS} FROM Riffs WHERE rowid IN (${chunk.map(() => '?').join(',')})`
      )
      .all(...chunk) as RiffRow[]
    for (const riff of rows) {
      if (!collectRiff(riff, pairs)) closedRowids.push(riff.RowId)
    }
    await yieldToEventLoop()
  }

  // Nothing new and nothing filled in: the cache is current as it stands.
  if (pairs.size === 0 && openRowids.length === 0 && closedRowids.length === 0) return

  const watermark = live.maxRowid === null ? null : riffCIDAtRowid(sourceDb, live.maxRowid)
  const deleteOpen = ownDb.prepare(
    `DELETE FROM DiscoverScanTargetOpenRiffs WHERE SourceDbKey = ? AND RiffRowid = ?`
  )
  await writePairs(ownDb, key, [...pairs.values()], openRowids, () => {
    for (const rowid of closedRowids) deleteOpen.run(key, rowid)
    writeMeta(ownDb, key, live.count, live.maxRowid, watermark)
  })
}

async function loadPairs(ownDb: Database.Database, key: string): Promise<StemJamPair[]> {
  const statement = ownDb.prepare(
    `SELECT StemCID, OwnerJamCID, RiffCID, Slot FROM DiscoverScanTargetCache
     WHERE SourceDbKey = ? AND (RiffCID > ? OR (RiffCID = ? AND Slot > ?))
     ORDER BY RiffCID, Slot LIMIT ?`
  )
  const out: StemJamPair[] = []
  let afterRiff = ''
  let afterSlot = 0
  for (;;) {
    countWork('sql:scan-targets.load')
    const page = statement.all(key, afterRiff, afterRiff, afterSlot, CACHE_PAGE_SIZE) as {
      StemCID: string
      OwnerJamCID: string
      RiffCID: string
      Slot: number
    }[]
    for (const row of page) out.push({ stemCID: row.StemCID, jamCID: row.OwnerJamCID })
    if (page.length < CACHE_PAGE_SIZE) break
    afterRiff = page[page.length - 1].RiffCID
    afterSlot = page[page.length - 1].Slot
    await yieldToEventLoop()
  }
  return out
}

/** Every distinct (StemCID, OwnerJamCID) pair `sourceDb`'s Riffs reference,
 * in the order a RiffCID-ordered walk of its riffs (slots 1..8) first
 * meets them -- from the cache in `ownDb`, extended or rebuilt first as
 * needed. Null when `sourceDb` can't be cached (in-memory, no Riffs table,
 * no rowid): the caller walks it directly. */
export async function getCachedStemJamPairs(
  ownDb: Database.Database,
  sourceDb: Database.Database
): Promise<StemJamPair[] | null> {
  if (sourceDb.memory) return null
  const live = readLiveSignal(sourceDb)
  if (!live) return null
  ensureSchema(ownDb)
  const key = sourceDb.name
  const meta = ownDb
    .prepare(
      `SELECT RiffCount, MaxRowid, WatermarkRiffCID FROM DiscoverScanTargetCacheMeta
       WHERE SourceDbKey = ?`
    )
    .get(key) as MetaRow | undefined
  if (meta && canExtend(sourceDb, meta, live)) {
    await extend(ownDb, sourceDb, key, meta, live)
  } else {
    await rebuild(ownDb, sourceDb, key, live)
  }
  return loadPairs(ownDb, key)
}
