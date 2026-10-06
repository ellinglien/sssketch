// src/main/riffIndexWalk.ts
//
// The riff index's walk of a Riffs table (scan plan b21ea5a2 Task 2,
// audit 5A): StemCID -> its riff with the smallest RiffCID, built by
// reading Riffs in ROWID order, page by page, and extendable from a rowid
// watermark (rowidWatermark.ts) instead of rebuilt whenever the count moves.
//
// Why rowid order, measured read-only on Elling's USB archive (2026-10-05,
// 2,000-row pages at random depths): rowid pages 15-70 ms; RiffCID-ordered
// keyset pages 0.8-1.2 s (the index order means a random table read per
// row); the old `ORDER BY RiffCID LIMIT/OFFSET` re-skipped everything before
// each page, seconds per deep page, ~180 pages. Rowid order is the file's
// own order, so a full walk is a sequential read, and the rows past a
// watermark are exactly the new ones.
//
// The result is the old walk's exactly: it kept the FIRST riff seen in
// RiffCID order for each stem, i.e. the smallest RiffCID; here an entry is
// replaced only by a riff with a smaller RiffCID (scanTargetCache.ts's
// isEarlier rule, decision 4), whatever order the riffs arrive in.
//
// Skeleton riffs (no stems yet -- the sync fills them in place later, which
// no count or watermark sees) are kept in an open set; every extension
// re-reads them (decision 3). This also fixes a gap the count-only cache
// had: a skeleton filled in between launches left the count unchanged, so
// the saved index loaded without its stems.
//
// Main-process rules: `.all()` per page, never a statement held across an
// await; a yield after every page and inside a page whenever the slice
// budget is spent (a page of riffs x 8 slots is real work).
import type Database from 'better-sqlite3'
import { columnStemSlots, mergeStemSlots, type StemSlotRef } from '@shared/riffStemSlots'
import type { RiffIndexEntry } from './discoverCandidates'
import type { RiffIndexPage } from './discoverIndexCache'
import { hasExtraStemSlotsTable, readExtraStemSlots } from './riffStemsExtra'
import type { RowidWatermark } from './rowidWatermark'
import { countWork } from './workCounters'

/** Rows per page. A cold page of 2,000 riffs read by rowid is 15-70 ms on
 * the USB archive (measured), and this slice must not grow. */
export const RIFF_WALK_PAGE_SIZE = 2000
/** Open riffs re-read per statement. They are scattered rowids -- a random
 * read each, not a sequential page -- so a chunk of 500 was an estimated
 * 200-300 ms cold on USB in one synchronous call; 100 keeps each well
 * under a page's cost, with a yield between chunks. */
const OPEN_RECHECK_CHUNK = 100
/** Main-process budget for the JS part of a page between yields. */
const SLICE_MS = 8

/** Everything an index needs to be extended later. `watermark` is null only
 * for an index loaded from a legacy saved cache (no watermark), which can
 * be replaced but never extended. */
export interface RiffIndexState {
  index: Map<string, RiffIndexEntry>
  open: Set<number>
  watermark: RowidWatermark | null
}

export function emptyRiffIndexState(): RiffIndexState {
  return {
    index: new Map(),
    open: new Set(),
    watermark: { count: 0, maxRowid: null, keyAtMax: null }
  }
}

interface RiffRow {
  RowId: number
  RiffCID: string
  OwnerJamCID: string
  BPMrnd: number
  CreationTime: number | null
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

const RIFF_COLUMNS = `rowid AS RowId, RiffCID, OwnerJamCID, BPMrnd, CreationTime,
  StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8`

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export interface RiffWalkOptions {
  /** Called after each page (and after the open riffs' re-read) with what
   * it changed -- the prewarm persists it. Awaited: a rejection stops the
   * walk, and the state then describes the last completed page. */
  onPage?: (page: RiffIndexPage) => Promise<void>
  onProgress?: (completed: number, total: number) => void
  /** For onProgress: the live row count. */
  total?: number
}

interface PageAccumulator {
  changed: Map<string, RiffIndexEntry>
  opened: number[]
  closed: number[]
}

/** Folds one riff into `state`, noting what it changed in `acc`. */
function applyRiff(
  riff: RiffRow,
  extras: Map<string, StemSlotRef[]>,
  state: RiffIndexState,
  acc: PageAccumulator
): void {
  const slots = mergeStemSlots(
    columnStemSlots(riff as unknown as Record<string, unknown>),
    extras.get(riff.RiffCID) ?? []
  )
  if (slots.length === 0) {
    if (!state.open.has(riff.RowId)) {
      state.open.add(riff.RowId)
      acc.opened.push(riff.RowId)
    }
    return
  }
  if (state.open.delete(riff.RowId)) acc.closed.push(riff.RowId)
  for (const { stemCID } of slots) {
    const existing = state.index.get(stemCID)
    if (existing && existing.riffCID <= riff.RiffCID) continue
    const entry: RiffIndexEntry = {
      riffCID: riff.RiffCID,
      ownerJamCID: riff.OwnerJamCID,
      bpmRnd: riff.BPMrnd,
      creationTime: riff.CreationTime
    }
    state.index.set(stemCID, entry)
    acc.changed.set(stemCID, entry)
  }
}

async function applyRows(
  rows: RiffRow[],
  extras: Map<string, StemSlotRef[]>,
  state: RiffIndexState,
  acc: PageAccumulator
): Promise<void> {
  let started = performance.now()
  for (const riff of rows) {
    applyRiff(riff, extras, state, acc)
    if (performance.now() - started >= SLICE_MS) {
      await yieldToEventLoop()
      started = performance.now()
    }
  }
}

function pageOf(acc: PageAccumulator, watermark: RowidWatermark): RiffIndexPage {
  return {
    changed: [...acc.changed],
    opened: acc.opened,
    closed: acc.closed,
    watermark: { ...watermark }
  }
}

function newAccumulator(): PageAccumulator {
  return { changed: new Map(), opened: [], closed: [] }
}

/** Brings `state` up to date with `db`'s Riffs: re-reads its open riffs,
 * then reads every riff past its watermark, page by page. A fresh
 * emptyRiffIndexState() makes this a full walk (a rebuild). `state` is
 * mutated in place and is consistent after every page -- its watermark
 * names the last riff read -- so a walk stopped by a failing onPage leaves
 * a state (and, persisted, a cache) the next extension continues from.
 * Throws only what onPage throws; a page read that fails (a broken db) ends
 * the walk quietly, as the old walk did. */
export async function walkRiffs(
  db: Database.Database,
  state: RiffIndexState,
  options: RiffWalkOptions = {}
): Promise<void> {
  const watermark = state.watermark
  if (!watermark) throw new Error('walkRiffs: a legacy index has no watermark to extend from')
  // Slots 9+ (sssketch's own db only; an external archive has no such
  // table: checked here once per walk, so a db without it never calls the
  // reader -- on the own db readExtraStemSlots repeats that cheap PRAGMA
  // table_info, against the in-memory schema, once per call, i.e. per page
  // or open-riff chunk) are read with each batch of riffs, one
  // `RiffCID IN (...)` query per statement's rows -- never per riff, and
  // never once up front: a riff committed while the walk runs (its
  // RiffStemsExtra rows land in the same transaction) would otherwise be
  // folded in without them, and nothing re-reads a closed riff.
  const extrasTable = hasExtraStemSlotsTable(db)
  const extrasFor = (rows: RiffRow[]): Map<string, StemSlotRef[]> =>
    extrasTable
      ? readExtraStemSlots(
          db,
          rows.map((r) => r.RiffCID)
        )
      : new Map()

  // The open (skeleton) riffs first: a filled one is folded in like a new riff.
  if (state.open.size > 0) {
    const acc = newAccumulator()
    const open = [...state.open]
    for (let i = 0; i < open.length; i += OPEN_RECHECK_CHUNK) {
      const chunk = open.slice(i, i + OPEN_RECHECK_CHUNK)
      countWork('sql:riff-index.open-recheck')
      let rows: RiffRow[]
      let extras: Map<string, StemSlotRef[]>
      try {
        rows = (
          db
            .prepare(
              `SELECT ${RIFF_COLUMNS} FROM Riffs WHERE rowid IN (${chunk.map(() => '?').join(',')})`
            )
            .all(...chunk) as RiffRow[]
        )
          // Rows past the watermark are read by the page walk below; only
          // the ones it won't reach are folded in here.
          .filter((r) => r.RowId <= (watermark.maxRowid ?? 0))
        extras = extrasFor(rows)
      } catch {
        return
      }
      countWork('walk:riff-index.rows', rows.length)
      await applyRows(rows, extras, state, acc)
      await yieldToEventLoop()
    }
    if (acc.changed.size > 0 || acc.closed.length > 0) {
      await options.onPage?.(pageOf(acc, watermark))
    }
  }

  const statement = db.prepare(
    `SELECT ${RIFF_COLUMNS} FROM Riffs WHERE rowid > ? ORDER BY rowid LIMIT ?`
  )
  for (;;) {
    const pageStarted = performance.now()
    let rows: RiffRow[]
    let extras: Map<string, StemSlotRef[]>
    try {
      rows = statement.all(watermark.maxRowid ?? 0, RIFF_WALK_PAGE_SIZE) as RiffRow[]
      extras = extrasFor(rows)
    } catch {
      return
    }
    countWork('walk:riff-index.page')
    countWork('ms:walk.riff-index', Math.round(performance.now() - pageStarted))
    if (rows.length === 0) return
    countWork('walk:riff-index.rows', rows.length)
    const acc = newAccumulator()
    await applyRows(rows, extras, state, acc)
    const last = rows[rows.length - 1]
    const next: RowidWatermark = {
      count: watermark.count + rows.length,
      maxRowid: last.RowId,
      keyAtMax: last.RiffCID
    }
    // Persisted first, then adopted: a failed save leaves the in-memory
    // watermark on the last page that is also on disk.
    await options.onPage?.(pageOf(acc, next))
    watermark.count = next.count
    watermark.maxRowid = next.maxRowid
    watermark.keyAtMax = next.keyAtMax
    options.onProgress?.(watermark.count, options.total ?? watermark.count)
    if (rows.length < RIFF_WALK_PAGE_SIZE) return
    await yieldToEventLoop()
  }
}
