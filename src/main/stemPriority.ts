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
//   Kept per username with a rowid watermark per db: a later call reads
//   only rows added since (a sync bringing new own stems), one index seek.
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
import { countWork } from './workCounters'

export interface StemPriority extends StemPrioritySets {
  /** The username the own set was read for; null when none is configured. */
  username: string | null
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
 * with it. */
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
    return { present: false, indexed: false }
  }
}

/** One db's own-stem reader: adds `username`'s StemCIDs with rowid above the
 * watermark to `into`, window by window, and returns the new watermark. */
async function readOwnStems(
  db: Database.Database,
  username: string,
  after: number,
  into: Set<string>,
  windowSize: number,
  onWindow?: () => void
): Promise<number> {
  const column = creatorColumn(db)
  if (!column.present) return after
  if (column.indexed) {
    const windowed = db.prepare(
      `SELECT rowid AS rid, StemCID FROM Stems
       WHERE CreatorUserName = ? AND rowid > ? ORDER BY rowid LIMIT ?`
    )
    for (;;) {
      const rows = windowed.all(username, after, windowSize) as { rid: number; StemCID: string }[]
      onWindow?.()
      countWork('sql:stem-priority.own-window')
      for (const row of rows) into.add(row.StemCID)
      if (rows.length > 0) after = rows[rows.length - 1].rid
      if (rows.length < windowSize) return after
      await yieldToEventLoop()
    }
  }
  const windowed = db.prepare(
    `SELECT rowid AS rid, StemCID, CreatorUserName = ? AS mine FROM Stems
     WHERE rowid > ? ORDER BY rowid LIMIT ?`
  )
  for (;;) {
    const rows = windowed.all(username, after, windowSize) as {
      rid: number
      StemCID: string
      mine: number | null
    }[]
    onWindow?.()
    countWork('sql:stem-priority.own-window')
    for (const row of rows) if (row.mine === 1) into.add(row.StemCID)
    if (rows.length > 0) after = rows[rows.length - 1].rid
    if (rows.length < windowSize) return after
    await yieldToEventLoop()
  }
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
  let state: {
    username: string | null
    own: Set<string>
    after: Map<Database.Database, number>
  } | null = null
  let inFlight: { username: string | null; promise: Promise<StemPriority> } | null = null

  async function refresh(username: string | null): Promise<StemPriority> {
    const dbs = [...new Set([...deps.sourceDbs(), deps.ownDb()])]
    if (!state || state.username !== username) {
      state = { username, own: new Set(), after: new Map() }
    }
    const current = state
    if (username !== null) {
      for (const db of dbs) {
        const after = await readOwnStems(
          db,
          username,
          current.after.get(db) ?? 0,
          current.own,
          windowSize,
          deps.onOwnWindow
        )
        current.after.set(db, after)
      }
    }
    const favourites = readFavourites(deps.sourceDbs(), deps.ownDb())
    return { username, own: new Set(current.own), favourites }
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
