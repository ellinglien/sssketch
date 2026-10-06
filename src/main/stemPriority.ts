// src/main/stemPriority.ts
//
// Who goes first in every per-stem background pass (Elling, 2026-10-06):
// his own stems, then his favourites, then the rest. The rule itself is
// @shared/stemPriorityOrder (pure); this module builds the two sets it
// ranks by, once per username, and keeps them current cheaply.
//
// - own: StemCIDs whose CreatorUserName is the app's username, from every
//   source db (candidateDbsForRiff: the configured archive, plus the own db
//   when that is not it). A LORE archive has Stems_IndexUser, so this is an
//   index range read in rowid windows (`CreatorUserName = ? AND rowid > ?
//   ORDER BY rowid LIMIT n`); the own db has no such index, so its windows
//   are bounded rowid ranges read whole and filtered in JS. Never one
//   unbounded statement: measured read-only 2026-10-06 on Elling's archive,
//   the 68,251 'elling' rows as one statement took 4.2 s cold off the USB
//   drive (one table lookup per row) -- windows of OWN_WINDOW keep each
//   statement short, with a yield between.
//   Kept per username with a rowid watermark per db (rowidWatermark.ts, the
//   rule every archive index here uses): a later call reads only rows added
//   since (a sync bringing new own stems), one index seek -- unless rows at
//   or below the watermark were deleted (deleteJamRows, then a sync reusing
//   the freed top rowids), VACUUM renumbered them, or the file was
//   replaced: then that db's set is read again from the start. An in-place
//   UPDATE of CreatorUserName is not seen (no row count or rowid moves).
// - favourites: StemFavourite (the stars; radio hearts and likes land there
//   too, radioHeartsImport.ts) and the stems of favourite riffs (Tags.Favour
//   = 1, slots 1-8 and RiffStemsExtra). A few hundred rows: re-read on every
//   call, so a new star counts at the next pass that asks.
//
// No username (none typed, not logged in): no own set; favourites still go
// first. With neither, every pass keeps its own order.
//
// Main-process rules: `.all()` per bounded statement, never `.iterate()`
// across an await; per-db SQL, never per jam.
import type Database from 'better-sqlite3'
import type { StemPrioritySets } from '@shared/stemPriorityOrder'
import { candidateDbsForRiff } from './riffLibraryStore'
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
import { canExtendByRowid, keyAtRowid, type RowidWatermark } from './rowidWatermark'
import { readTableHead, readTableSignal, sameTableHead, type TableHead } from './tableChangeSignal'
import { countWork } from './workCounters'

export interface StemPriority extends StemPrioritySets {
  /** The username the own set was read for; null when none is configured. */
  username: string | null
  /** Moves exactly when `own` or `favourites` changed since the last call
   * (or the username did); the sets themselves are then new objects. */
  version: number
}

/** Rows per own-stem window (indexed: matches; unindexed: rowids). */
const OWN_WINDOW = 500
/** Favourite riffs per IN-list. */
const ID_CHUNK = 500
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function normalUsername(username: string | null | undefined): string | null {
  const trimmed = username?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Whether `db`'s Stems has CreatorUserName at all, and an index leading
 * with it. A PRAGMA that fails (a busy or flaky connection) reads as
 * present but unindexed: the bounded rowid windows work either way, and a
 * db without the column then fails its window read, which refresh skips
 * -- never "no own stems here" with the watermark moved past them. */
function creatorColumn(db: Database.Database): { present: boolean; indexed: boolean } {
  try {
    const cols = db.prepare(`PRAGMA table_info(Stems)`).all() as { name: string }[]
    if (!cols.some((c) => c.name === 'CreatorUserName')) return { present: false, indexed: false }
    const indexes = db.prepare(`PRAGMA index_list(Stems)`).all() as { name: string }[]
    const indexed = indexes.some((idx) => {
      const info = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all() as {
        seqno: number
        name: string | null
      }[]
      return info.find((c) => c.seqno === 0)?.name === 'CreatorUserName'
    })
    return { present: true, indexed }
  } catch {
    return { present: true, indexed: false }
  }
}

/** One db's own-stem reader: adds `username`'s StemCIDs with rowid in
 * (after, through] to `into`, window by window. `through` is the MAX(rowid)
 * the watermark records, so a row inserted mid-walk is left for the next
 * call rather than read without being counted. */
async function readOwnStems(
  db: Database.Database,
  username: string,
  after: number,
  through: number,
  into: Set<string>,
  windowSize: number,
  onWindow?: () => void
): Promise<void> {
  const column = creatorColumn(db)
  if (!column.present) return
  if (column.indexed) {
    const windowed = db.prepare(
      `SELECT rowid AS rid, StemCID FROM Stems
       WHERE CreatorUserName = ? AND rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`
    )
    for (;;) {
      const rows = windowed.all(username, after, through, windowSize) as {
        rid: number
        StemCID: string
      }[]
      onWindow?.()
      countWork('sql:stem-priority.own-window')
      for (const row of rows) into.add(row.StemCID)
      if (rows.length > 0) after = rows[rows.length - 1].rid
      if (rows.length < windowSize) return
      await yieldToEventLoop()
    }
  }
  const windowed = db.prepare(
    `SELECT rowid AS rid, StemCID, CreatorUserName = ? AS mine FROM Stems
     WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`
  )
  for (;;) {
    const rows = windowed.all(username, after, through, windowSize) as {
      rid: number
      StemCID: string
      mine: number | null
    }[]
    onWindow?.()
    countWork('sql:stem-priority.own-window')
    for (const row of rows) if (row.mine === 1) into.add(row.StemCID)
    if (rows.length > 0) after = rows[rows.length - 1].rid
    if (rows.length < windowSize) return
    await yieldToEventLoop()
  }
}

/** One db's own stems and the watermark they were read through. */
interface DbOwnStems {
  watermark: RowidWatermark
  own: Set<string>
  /** Stems' cheap head as it stood before the read (null when it could not
   * be read): unmoved at the next call means nothing to do there. */
  head: TableHead | null
}

/** Brings `previous` (this db's last read, if any) up to date: extended by
 * the rows past its watermark when rowidWatermark.ts's rule allows, else
 * read again from the start. Undefined when the table can't be read now
 * (missing, or an I/O error): the caller keeps what it had.
 *
 * First, Stems' head (MAX(rowid), data_version, this process's Stems
 * writes -- tableChangeSignal.ts's readTableHead): unmoved since the last
 * read, `previous` is current and nothing else is read. Without it, every
 * auto-classify tick paid readTableSignal on the own db, whose COUNT(*)
 * memo is keyed on total_changes(), which the classifier's own writes to
 * StemAutoCategory move: a full COUNT of Stems per tick (measured
 * 2026-10-06 on a synthetic read-write db: 0.2 ms at the own db's 81,902
 * rows, 18 ms at 891,062 -- an own db that is the whole library), plus the
 * watermark checks and a window read. */
async function refreshDbOwnStems(
  db: Database.Database,
  username: string,
  previous: DbOwnStems | undefined,
  windowSize: number,
  onWindow?: () => void
): Promise<DbOwnStems | undefined> {
  const head = db.inTransaction ? null : readTableHead(db, 'Stems')
  if (previous?.head && head && sameTableHead(previous.head, head)) {
    countWork('stem-priority:unmoved')
    return previous
  }
  const live = readTableSignal(db, 'Stems')
  if (!live) return undefined
  if (live.maxRowid === null) {
    return {
      watermark: { count: live.count, maxRowid: null, keyAtMax: null },
      own: new Set(),
      head
    }
  }
  const extend =
    previous !== undefined && canExtendByRowid(db, 'Stems', 'StemCID', previous.watermark, live)
  countWork(extend ? 'stem-priority:extend' : 'stem-priority:rebuild')
  // Read with the signal, before the walk yields: the watermark describes
  // the table as it stood when the walk's bound was taken.
  const keyAtMax = keyAtRowid(db, 'Stems', 'StemCID', live.maxRowid)
  const watermark = { count: live.count, maxRowid: live.maxRowid, keyAtMax }
  if (!extend) {
    // A new set, so the old one stays whole if the walk fails part way.
    const own = new Set<string>()
    await readOwnStems(db, username, 0, live.maxRowid, own, windowSize, onWindow)
    return { watermark, own, head }
  }
  const added = new Set<string>()
  const after = previous.watermark.maxRowid ?? 0
  await readOwnStems(db, username, after, live.maxRowid, added, windowSize, onWindow)
  // Nothing new (most calls): the same set, not a 70k-entry copy per tick.
  if (added.size === 0) return { watermark, own: previous.own, head }
  return { watermark, own: new Set([...previous.own, ...added]), head }
}

/** Stars plus the stems of favourite riffs, from every db given. */
function readFavourites(dbs: readonly Database.Database[], ownDb: Database.Database): Set<string> {
  const favourites = new Set<string>()
  try {
    const rows = ownDb.prepare(`SELECT StemCID FROM StemFavourite`).all() as { StemCID: string }[]
    for (const row of rows) favourites.add(row.StemCID)
  } catch {
    // no StemFavourite table (an older or hand-made db): no stars
  }
  // Tags first, then Riffs and RiffStemsExtra by key: as one JOIN, SQLite
  // (no ANALYZE stats on a LORE archive) puts Riffs on the outside and scans
  // all ~372k of them for a Tags table with no favourites -- measured 38 s
  // off Elling's USB archive, 2026-10-06. Favourite riffs are a handful.
  for (const db of new Set([...dbs, ownDb])) {
    let riffCIDs: string[]
    try {
      riffCIDs = (
        db.prepare(`SELECT RiffCID FROM Tags WHERE Favour = 1`).all() as { RiffCID: string }[]
      ).map((r) => r.RiffCID)
    } catch {
      continue // no Tags here
    }
    for (let i = 0; i < riffCIDs.length; i += ID_CHUNK) {
      const chunk = riffCIDs.slice(i, i + ID_CHUNK)
      const marks = chunk.map(() => '?').join(',')
      try {
        const rows = db
          .prepare(`SELECT ${SLOTS.join(', ')} FROM Riffs WHERE RiffCID IN (${marks})`)
          .all(...chunk) as Record<string, string | null>[]
        for (const row of rows) for (const slot of SLOTS) if (row[slot]) favourites.add(row[slot]!)
      } catch {
        // no Riffs here
      }
      try {
        const rows = db
          .prepare(`SELECT StemCID FROM RiffStemsExtra WHERE RiffCID IN (${marks})`)
          .all(...chunk) as { StemCID: string }[]
        for (const row of rows) favourites.add(row.StemCID)
      } catch {
        // an external LORE archive has no RiffStemsExtra
      }
    }
  }
  return favourites
}

function unionOf(parts: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  if (parts.length === 1) return parts[0]
  const union = new Set<string>()
  for (const part of parts) for (const stemCID of part) union.add(stemCID)
  return union
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

export interface BuildStemPriorityOptions {
  /** Rows per own-stem window (default 500). */
  windowSize?: number
}

/** The priority sets for `username`, read fresh from `sourceDbs` and `ownDb`. */
export async function buildStemPriority(
  sourceDbs: readonly Database.Database[],
  ownDb: Database.Database,
  username: string | null,
  options: BuildStemPriorityOptions = {}
): Promise<StemPriority> {
  const cache = createStemPriorityCache({
    sourceDbs: () => sourceDbs,
    ownDb: () => ownDb,
    windowSize: options.windowSize
  })
  return cache.get(username)
}

export interface StemPriorityCacheDeps {
  sourceDbs: () => readonly Database.Database[]
  ownDb: () => Database.Database
  windowSize?: number
  /** Test seam: called after each own-stem window statement. */
  onOwnWindow?: () => void
}

export interface StemPriorityCache {
  /** The current sets for `username`: the own set extended by rows added
   * since the last call, favourites re-read. Calls in flight are shared. */
  get(username: string | null): Promise<StemPriority>
}

export function createStemPriorityCache(deps: StemPriorityCacheDeps): StemPriorityCache {
  const windowSize = Math.max(1, deps.windowSize ?? OWN_WINDOW)
  // Keyed by connection, weakly: a db closed and reopened (a switched
  // archive) is a new key, and the old one's set goes with it.
  let state: {
    username: string | null
    perDb: WeakMap<Database.Database, DbOwnStems>
  } | null = null
  let inFlight: { username: string | null; promise: Promise<StemPriority> } | null = null
  // What the last call returned, so an unchanged answer is the same sets
  // (no union per tick) under the same version.
  let version = 0
  let last: {
    username: string | null
    parts: ReadonlySet<string>[]
    own: ReadonlySet<string>
    favourites: ReadonlySet<string>
  } | null = null

  async function refresh(username: string | null): Promise<StemPriority> {
    const dbs = [...new Set([...deps.sourceDbs(), deps.ownDb()])]
    if (!state || state.username !== username) {
      state = { username, perDb: new WeakMap() }
    }
    const current = state
    const parts: ReadonlySet<string>[] = []
    if (username !== null) {
      for (const db of dbs) {
        const previous = current.perDb.get(db)
        try {
          const next = await refreshDbOwnStems(db, username, previous, windowSize, deps.onOwnWindow)
          if (next) current.perDb.set(db, next)
        } catch (err) {
          // One unreadable db (an external file, a failed read off the USB
          // volume) keeps what it had; the others still count.
          countWork('stem-priority:db-error')
          console.error('stemPriority: reading own stems failed for a db:', err)
        }
        const part = current.perDb.get(db)?.own
        if (part) parts.push(part)
      }
    }
    // A db's set is replaced, never mutated, whenever it changes: the same
    // parts are the same union.
    const sameOwn =
      last !== null &&
      last.username === username &&
      last.parts.length === parts.length &&
      parts.every((part, i) => part === last!.parts[i])
    const own = sameOwn ? last!.own : unionOf(parts)
    const read = readFavourites(deps.sourceDbs(), deps.ownDb())
    const sameFavourites = last !== null && sameMembers(last.favourites, read)
    const favourites = sameFavourites ? last!.favourites : read
    if (!sameOwn || !sameFavourites) version += 1
    last = { username, parts, own, favourites }
    return { username, own, favourites, version }
  }

  return {
    get(rawUsername) {
      const username = normalUsername(rawUsername)
      if (inFlight && inFlight.username === username) return inFlight.promise
      const run = (inFlight?.promise ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => refresh(username))
      const entry = { username, promise: run }
      inFlight = entry
      void run
        .finally(() => {
          if (inFlight === entry) inFlight = null
        })
        .catch(() => undefined)
      return run
    }
  }
}

// ---------------------------------------------------------------------------
// The app-wide instance and the username main ranks by.

let appCache: StemPriorityCache | null = null
let configuredUsername: string | null = null

/** The username the renderer last reported (its riff library username: the
 * one typed, else the Endlesss session's; null when neither). */
export function setStemPriorityUsername(username: string | null): void {
  configuredUsername = normalUsername(username)
}

export function getStemPriorityUsername(): string | null {
  return configuredUsername
}

/** The app's current priority sets (the reported username unless one is
 * given). Own stems come from candidateDbsForRiff and the own db. */
export function getStemPriority(
  username: string | null = configuredUsername
): Promise<StemPriority> {
  if (!appCache) {
    appCache = createStemPriorityCache({
      sourceDbs: () => candidateDbsForRiff(),
      ownDb: () => openOwnRiffLibraryDb()
    })
  }
  return appCache.get(username)
}
