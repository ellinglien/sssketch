// src/main/stemsTableWalk.ts
//
// ONE walk of a source db's Stems table for everything that indexes it
// (scan plan b21ea5a2 Tasks 3 and 4, audit 5A): Discover's instrument rows
// (StemCID, Instrument, OwnerJamCID) and the artist picker's distinct
// (jam, user) pairs used to be two separate full walks of the same 891k-row
// archive table; now each page is read once and handed to both.
//
// ROWID order, page by page -- measured read-only on Elling's USB archive
// (2026-10-05, 2,000-row pages at random depths): 21-40 ms by rowid against
// 0.49-0.69 s by StemCID keyset (index order = a random table read per row;
// one unpaged `ORDER BY StemCID` read of the whole table took 154 s), and
// 3 s for one cold deep OFFSET page. Rowid order is the file's own, so a full
// walk is a sequential read and the rows past a rowid watermark
// (rowidWatermark.ts) are exactly the new ones.
//
// Discover's mask lookup (instrumentRowsLookup.ts) wants the rows in StemCID
// order, so a full walk's rows are sorted afterwards -- in JS, in time-
// budgeted slices (sortInstrumentRowsSliced), never one long block.
//
// Main-process rules: `.all()` per page, a yield after every page; a page is
// never held open across an await.
import type Database from 'better-sqlite3'
import type { InstrumentRow } from './instrumentRowsLookup'
import type { RowidWatermark } from './rowidWatermark'
import { countWork } from './workCounters'

/** Rows per page: one synchronous read. 21-40 ms cold on the USB archive by
 * rowid (measured); this slice must not grow. */
export const STEMS_WALK_PAGE_SIZE = 2000
const SLICE_MS = 8

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** One walked page. `from` is where the whole walk started (the same object
 * for every page of one walk); `watermark` is where it stands after this
 * page (count = rows through this page). */
export interface StemsWalkPage {
  rows: InstrumentRow[]
  /** This page's distinct (OwnerJamCID, CreatorUserName) pairs, empty and
   * NULL users skipped. */
  pairs: [string, string][]
  from: RowidWatermark
  watermark: RowidWatermark
  /** sssketch's own db, when the starter has it (the prewarm does): where
   * a sink may persist what it derives. */
  ownDb?: Database.Database
}

export interface StemsWalkResult {
  /** Every row walked, in rowid order. */
  rows: InstrumentRow[]
  watermark: RowidWatermark
  /** False when a page read failed (no Stems table, a read error): the
   * walk stopped early with what it had. */
  complete: boolean
}

/** A consumer of every page of every walk, whoever started it (the artist
 * pairs, Task 4) -- so a launch after a LORE sync walks Stems once. */
export interface StemsWalkSink {
  onPage: (db: Database.Database, page: StemsWalkPage) => void
  /** After the walk that started at `from` ended, either way. */
  onEnd?: (db: Database.Database, from: RowidWatermark, result: StemsWalkResult | null) => void
}

const sinks = new Set<StemsWalkSink>()

export function addStemsWalkSink(sink: StemsWalkSink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

function eachSink(fn: (sink: StemsWalkSink) => void): void {
  for (const sink of sinks) {
    try {
      fn(sink)
    } catch (err) {
      console.error('stemsTableWalk: a sink failed:', err)
    }
  }
}

const inFlight = new WeakMap<Database.Database, Map<string, Promise<StemsWalkResult>>>()

function fromKey(from: RowidWatermark): string {
  return `${from.count}:${from.maxRowid}:${from.keyAtMax}`
}

interface WalkRow {
  rid: number
  StemCID: string
  Instrument: number | null
  OwnerJamCID: string
  CreatorUserName: string | null
}

/** The walk's page statement. A Stems table missing Instrument or
 * CreatorUserName (a hand-made or very old db) reads NULL for it: the walk
 * still yields rows, or pairs, from what is there. Throws when there is no
 * Stems table at all. */
function pageStatement(db: Database.Database): Database.Statement {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(Stems)`).all() as { name: string }[]).map((c) => c.name)
  )
  const column = (name: string): string => (columns.has(name) ? name : `NULL AS ${name}`)
  return db.prepare(
    `SELECT rowid AS rid, StemCID, ${column('Instrument')}, OwnerJamCID, ${column('CreatorUserName')}
     FROM Stems WHERE rowid > ? ORDER BY rowid LIMIT ?`
  )
}

export interface StemsWalkOptions {
  /** The starter's own per-page step (Discover persists its rows), awaited
   * before the sinks; a rejection stops the walk. */
  onPage?: (page: StemsWalkPage) => Promise<void>
  /** Passed on to the sinks with every page. */
  ownDb?: Database.Database
  onProgress?: (completed: number, total: number) => void
  total?: number
}

/** Walks `db`'s Stems past `from` (a fresh {count 0, maxRowid null} walks the
 * whole table). Concurrent calls for the same db and starting point share
 * one walk -- a joiner gets the result, not the starter's onPage. Rejects
 * only with what onPage throws; a failing page read (no Stems table) ends
 * the walk quietly with what it has. */
export function walkStems(
  db: Database.Database,
  from: RowidWatermark,
  options: StemsWalkOptions = {}
): Promise<StemsWalkResult> {
  let perDb = inFlight.get(db)
  if (!perDb) {
    perDb = new Map()
    inFlight.set(db, perDb)
  }
  const key = fromKey(from)
  const running = perDb.get(key)
  if (running) return running
  const start = { ...from }
  const promise = runWalk(db, start, options).then(
    (result) => {
      perDb.delete(key)
      eachSink((sink) => sink.onEnd?.(db, start, result))
      return result
    },
    (err: unknown) => {
      perDb.delete(key)
      eachSink((sink) => sink.onEnd?.(db, start, null))
      throw err
    }
  )
  perDb.set(key, promise)
  return promise
}

async function runWalk(
  db: Database.Database,
  from: RowidWatermark,
  options: StemsWalkOptions
): Promise<StemsWalkResult> {
  const rows: InstrumentRow[] = []
  const watermark: RowidWatermark = { ...from }
  let statement: Database.Statement
  try {
    statement = pageStatement(db)
  } catch {
    return { rows, watermark, complete: false }
  }
  for (;;) {
    const pageStarted = performance.now()
    let page: WalkRow[]
    countWork('walk:instrument-rows.page')
    try {
      page = statement.all(watermark.maxRowid ?? 0, STEMS_WALK_PAGE_SIZE) as WalkRow[]
    } catch {
      return { rows, watermark, complete: false }
    }
    countWork('ms:walk.instrument-rows', Math.round(performance.now() - pageStarted))
    if (page.length === 0) return { rows, watermark, complete: true }
    countWork('walk:stems.rows', page.length)

    const pageRows: InstrumentRow[] = []
    const seen = new Set<string>()
    const pairs: [string, string][] = []
    for (const r of page) {
      pageRows.push({ StemCID: r.StemCID, Instrument: r.Instrument, OwnerJamCID: r.OwnerJamCID })
      if (!r.CreatorUserName) continue
      const pairKey = `${r.OwnerJamCID}\u0000${r.CreatorUserName}`
      if (seen.has(pairKey)) continue
      seen.add(pairKey)
      pairs.push([r.OwnerJamCID, r.CreatorUserName])
    }
    const last = page[page.length - 1]
    const next: RowidWatermark = {
      count: watermark.count + page.length,
      maxRowid: last.rid,
      keyAtMax: last.StemCID
    }
    const walked: StemsWalkPage = {
      rows: pageRows,
      pairs,
      from,
      watermark: next,
      ownDb: options.ownDb
    }
    await options.onPage?.(walked)
    eachSink((sink) => sink.onPage(db, walked))
    for (const r of pageRows) rows.push(r)
    watermark.count = next.count
    watermark.maxRowid = next.maxRowid
    watermark.keyAtMax = next.keyAtMax
    options.onProgress?.(watermark.count, options.total ?? watermark.count)
    if (page.length < STEMS_WALK_PAGE_SIZE) return { rows, watermark, complete: true }
    await yieldToEventLoop()
  }
}

/** Rows sorted by StemCID (JavaScript string order -- what the mask lookup
 * binary-searches by), without one long block: runs of RUN rows sorted
 * natively, then merged pass by pass in SLICE_MS slices with yields. About
 * 0.2 s of work for the archive's 891k rows, spread over many slices. */
const RUN = 2048

const byStemCID = (a: InstrumentRow, b: InstrumentRow): number =>
  a.StemCID < b.StemCID ? -1 : a.StemCID > b.StemCID ? 1 : 0

export async function sortInstrumentRowsSliced(
  rows: readonly InstrumentRow[]
): Promise<InstrumentRow[]> {
  let src = rows.slice()
  let started = performance.now()
  const maybeYield = async (): Promise<void> => {
    if (performance.now() - started < SLICE_MS) return
    await yieldToEventLoop()
    started = performance.now()
  }
  for (let i = 0; i < src.length; i += RUN) {
    const run = src.slice(i, i + RUN).sort(byStemCID)
    for (let j = 0; j < run.length; j++) src[i + j] = run[j]
    await maybeYield()
  }
  let dst = new Array<InstrumentRow>(src.length)
  for (let width = RUN; width < src.length; width *= 2) {
    for (let lo = 0; lo < src.length; lo += 2 * width) {
      const mid = Math.min(lo + width, src.length)
      const hi = Math.min(lo + 2 * width, src.length)
      let a = lo
      let b = mid
      let k = lo
      while (a < mid || b < hi) {
        const takeA = b >= hi || (a < mid && src[a].StemCID <= src[b].StemCID)
        dst[k++] = takeA ? src[a++] : src[b++]
        if ((k & 1023) === 0) await maybeYield()
      }
    }
    const t = src
    src = dst
    dst = t
  }
  countWork('instrument-rows:sorted', src.length)
  return src
}
