// src/main/ownStemIndex.ts
//
// The own-only index a full rebuild serves first (faster startup plan,
// docs/superpowers/plans/2026-10-06-faster-startup.md): one user's own
// stems (instrument rows) and, for each, a riff that holds it -- built in
// seconds instead of the two-minute walk of the whole archive, so "only my
// stems" can roll while that walk runs. In memory only, never persisted;
// discoverCandidates.ts drops it once the full index is installed.
//
// Read through the archive's username indexes, in rowid pages inside them:
// - Stems WHERE CreatorUserName = ? (Stems_IndexUser): measured read-only
//   on Elling's USB archive, 68,251 rows in 3.0 s; a 2,000-row page blocked
//   up to 133 ms cold, so pages are 1,000 rows.
// - Riffs WHERE UserName = ? (Riff_IndexUser): 78,342 riffs in 3.8 s, up to
//   151 ms per 2,000 rows.
// A db without such an index (sssketch's own warehouse: its Riffs.UserName
// is empty on 98% of rows, and it lives on the internal SSD) is walked in
// plain rowid pages instead, keeping only the user's rows.
//
// Each own stem maps to the riff with the smallest RiffCID among the riffs
// read -- the full index's rule (riffIndexWalk.ts), applied to the user's
// own riffs only. On his archive that is the full index's riff for 62,714
// of 68,172 stems; for the rest it is another riff that also holds the stem
// (the full index may name one of someone else's riffs). 79 of his stems
// appear only in other people's riffs: not in this index, so not rolled
// until the full one is in.
//
// Main-process rules: `.all()` per page, a yield after every page and
// inside one whenever the slice budget is spent; never a statement held
// across an await.
import type Database from 'better-sqlite3'
import { columnStemSlots, mergeStemSlots, type StemSlotRef } from '@shared/riffStemSlots'
import type { RiffIndexEntry } from './discoverCandidates'
import type { InstrumentRow } from './instrumentRowsLookup'
import { hasExtraStemSlotsTable, readExtraStemSlots } from './riffStemsExtra'
import { countWork } from './workCounters'

export interface OwnStemIndex {
  username: string
  /** Own StemCID -> a riff of the user's that holds it. */
  riffIndex: Map<string, RiffIndexEntry>
  /** The user's Stems rows, in StemCID order. */
  rows: InstrumentRow[]
}

export interface OwnStemIndexOptions {
  /** Rows per indexed page (default 1,000); unindexed pages are twice it. */
  pageSize?: number
  /** Rows read so far (stems, then riffs). */
  onProgress?: (completed: number) => void
}

const SLICE_MS = 8

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Whether `table` has `column`, and an index leading with it. */
function columnInfo(
  db: Database.Database,
  table: string,
  column: string
): { present: boolean; indexed: boolean; columns: Set<string> } {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  )
  if (!columns.has(column)) return { present: false, indexed: false, columns }
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]
  const indexed = indexes.some((idx) => {
    const info = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all() as {
      seqno: number
      name: string | null
    }[]
    return info.find((c) => c.seqno === 0)?.name === column
  })
  return { present: true, indexed, columns }
}

interface StemRow {
  rid: number
  StemCID: string
  Instrument: number | null
  OwnerJamCID: string
  CreatorUserName: string | null
}

async function readOwnStemRows(
  db: Database.Database,
  username: string,
  pageSize: number,
  progress: (read: number) => void
): Promise<InstrumentRow[]> {
  const info = columnInfo(db, 'Stems', 'CreatorUserName')
  if (!info.present) return []
  const instrument = info.columns.has('Instrument') ? 'Instrument' : 'NULL AS Instrument'
  const select = `SELECT rowid AS rid, StemCID, ${instrument}, OwnerJamCID, CreatorUserName FROM Stems`
  const statement = info.indexed
    ? db.prepare(`${select} WHERE CreatorUserName = ? AND rowid > ? ORDER BY rowid LIMIT ?`)
    : db.prepare(`${select} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
  const limit = info.indexed ? pageSize : pageSize * 2
  const out: InstrumentRow[] = []
  let after = 0
  for (;;) {
    countWork('sql:own-index.stems-page')
    const page = (
      info.indexed ? statement.all(username, after, limit) : statement.all(after, limit)
    ) as StemRow[]
    for (const r of page) {
      if (r.CreatorUserName !== username) continue
      out.push({ StemCID: r.StemCID, Instrument: r.Instrument, OwnerJamCID: r.OwnerJamCID })
    }
    progress(out.length)
    if (page.length < limit) return out
    after = page[page.length - 1].rid
    await yieldToEventLoop()
  }
}

interface RiffRow {
  rid: number
  RiffCID: string
  OwnerJamCID: string
  BPMrnd: number
  CreationTime: number | null
  [slot: string]: unknown
}

async function readOwnRiffs(
  db: Database.Database,
  username: string,
  own: ReadonlySet<string>,
  pageSize: number,
  progress: (n: number) => void
): Promise<Map<string, RiffIndexEntry>> {
  const index = new Map<string, RiffIndexEntry>()
  if (own.size === 0) return index
  const info = columnInfo(db, 'Riffs', 'UserName')
  const select = `SELECT rowid AS rid, RiffCID, OwnerJamCID, BPMrnd, CreationTime,
    StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
    FROM Riffs`
  const statement = info.indexed
    ? db.prepare(`${select} WHERE UserName = ? AND rowid > ? ORDER BY rowid LIMIT ?`)
    : db.prepare(`${select} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
  const limit = info.indexed ? pageSize : pageSize * 2
  const extrasTable = hasExtraStemSlotsTable(db)
  let after = 0
  for (;;) {
    countWork('sql:own-index.riffs-page')
    const page = (
      info.indexed ? statement.all(username, after, limit) : statement.all(after, limit)
    ) as RiffRow[]
    const extras: Map<string, StemSlotRef[]> = extrasTable
      ? readExtraStemSlots(
          db,
          page.map((r) => r.RiffCID)
        )
      : new Map()
    let started = performance.now()
    for (const r of page) {
      for (const { stemCID } of mergeStemSlots(columnStemSlots(r), extras.get(r.RiffCID) ?? [])) {
        if (!own.has(stemCID)) continue
        const existing = index.get(stemCID)
        if (existing && existing.riffCID <= r.RiffCID) continue
        index.set(stemCID, {
          riffCID: r.RiffCID,
          ownerJamCID: r.OwnerJamCID,
          bpmRnd: r.BPMrnd,
          creationTime: r.CreationTime
        })
      }
      if (performance.now() - started >= SLICE_MS) {
        await yieldToEventLoop()
        started = performance.now()
      }
    }
    progress(page.length)
    if (page.length < limit) return index
    after = page[page.length - 1].rid
    await yieldToEventLoop()
  }
}

/** `username`'s own stems in `db` and a riff for each -- see the module
 * comment. A db missing Stems or Riffs (or their username column) gives
 * what it has, never a throw. */
export async function buildOwnStemIndex(
  db: Database.Database,
  username: string,
  options: OwnStemIndexOptions = {}
): Promise<OwnStemIndex> {
  const pageSize = options.pageSize ?? 1000
  let read = 0
  let rows: InstrumentRow[] = []
  try {
    rows = await readOwnStemRows(db, username, pageSize, (n) => options.onProgress?.(n))
  } catch {
    return { username, riffIndex: new Map(), rows: [] }
  }
  read = rows.length
  options.onProgress?.(read)
  rows.sort((a, b) => (a.StemCID < b.StemCID ? -1 : a.StemCID > b.StemCID ? 1 : 0))
  let riffIndex = new Map<string, RiffIndexEntry>()
  try {
    riffIndex = await readOwnRiffs(
      db,
      username,
      new Set(rows.map((r) => r.StemCID)),
      pageSize,
      (n) => {
        read += n
        options.onProgress?.(read)
      }
    )
  } catch {
    // No Riffs table: no riff to put a stem in, so nothing can be rolled.
  }
  countWork('own-index:built')
  return { username, riffIndex, rows }
}
