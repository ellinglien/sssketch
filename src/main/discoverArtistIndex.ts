// src/main/discoverArtistIndex.ts
//
// The artist picker's data (spec §1, §3). Measured 2026-10-01 against
// Elling's archive (781,509 stems, 5,921 users, 1.19 GB on USB/ExFAT):
//   counts: GROUP BY over the covering Stems_IndexUser -- 2.86 s cold,
//           0.09 s warm. Paged by username so no slice blocks main.
//   pairs:  every distinct (OwnerJamCID, CreatorUserName) needs the whole
//           table -- 15 s even warm (the table does not stay in the page
//           cache). The obvious IN-subquery form took 60-69 s. So pairs are
//           built by a BACKGROUND rowid walk, paged and yielding, and the
//           picker works from the counts until it lands.
// Since scan plan b21ea5a2 Task 4 the pairs ride the ONE shared Stems walk
// (stemsTableWalk.ts; the same pages Discover's instrument rows are built
// from) and are extended from a rowid watermark rather than re-walked -- see
// onWalkPage below. readJamUserPairs stays for an in-memory db.
// Counts are in memory, per session. Pairs are in memory AND saved to the
// own db per source db (Elling's decision, 2026-10-01;
// discoverJamUserPairsStore.ts): on launch a db whose Stems count and
// MAX(rowid) still match its saved pairs is not walked at all, and a change
// re-walks only the db that moved. The jammed-with list is rebuilt from the
// pairs in JS. Everything is re-validated against the Stems table signal,
// read at most ONCE per db per call. Known gap across launches (no
// in-place-update signal survives a restart): see the store's header.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
import { getTraitValueTable } from './traitQuantileCache'
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
import {
  CACHE_CHANGE_CHECK_INTERVAL_MS,
  isTableCountInFlight,
  isTableSignalCurrent,
  newScanCacheState,
  readTableSignal,
  whenTableCountsSettled,
  type ScanCacheState,
  type TableSignal
} from './tableChangeSignal'
import {
  jammedWithFromPairs,
  mergeArtistCounts,
  type ArtistCount,
  type ArtistIndex,
  type JammedWith
} from '@shared/discoverArtist'
import {
  abortArtistStemWalks,
  getArtistStemCIDs,
  resetArtistStemAbortForTests
} from './discoverArtistStems'
import { appendSavedPairs, loadSavedPairs, resetSavedPairs } from './discoverJamUserPairsStore'
import { canExtendByRowid, keyAtRowid, type RowidWatermark } from './rowidWatermark'
import {
  addStemsWalkSink,
  walkStems,
  type StemsWalkPage,
  type StemsWalkResult
} from './stemsTableWalk'

const USER_PAGE = 500
/** Rowid pages of the full table. Kept at the size a cold USB page was
 * measured at (2,000 rows ~250 ms in discoverArtistStems.ts) so no single
 * slice blocks the main process for longer. ~390 pages for 781k stems. */
const PAIR_PAGE = 2000
/** After a failed pairs walk, the picker's polls wait this long before
 * starting another, rather than looping on a broken db. */
const PAIRS_RETRY_MS = 60_000
const FEATURE_CHUNK = 500

/** Set on quit: running walks stop at their next page and nothing new
 * starts, so no walk holds a statement on a db that is being closed. */
let aborted = false

export function abortArtistIndexWork(): void {
  aborted = true
  abortArtistStemWalks()
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function readArtistCounts(
  db: Database.Database,
  pageSize = USER_PAGE
): Promise<ArtistCount[]> {
  let stmt: Database.Statement
  try {
    stmt = db.prepare(
      `SELECT CreatorUserName AS user, COUNT(*) AS stems FROM Stems
       WHERE CreatorUserName > ? GROUP BY CreatorUserName
       ORDER BY CreatorUserName LIMIT ?`
    )
  } catch {
    return []
  }
  const out: ArtistCount[] = []
  // '' as the first bound skips NULL and empty names in one go.
  let after = ''
  for (;;) {
    if (aborted) throw new Error('discoverArtistIndex: aborted (quitting)')
    countWork('sql:discover.artist-counts-page')
    const page = stmt.all(after, pageSize) as ArtistCount[]
    out.push(...page)
    if (page.length < pageSize) break
    after = page[page.length - 1].user
    await yieldToEventLoop()
  }
  return out
}

/** Stems of a later db looked up in the earlier ones per IN query. */
const SEEK_CHUNK = 500

/** A Shared Feed jam or the kept groups: a synthetic jam holding copies of
 * other jams' stems, so whether an earlier db has them is asked per stem. */
function isSyntheticJam(jamCID: string): boolean {
  return jamCID.startsWith('shared:') || jamCID === DISCOVERED_JAM_CID
}

/** The stems of `db` none of the `earlier` dbs holds, counted per user --
 * so the lists getArtistIndex adds up count each StemCID once, in the first
 * db that has it (the archive; review of b859757c: the own db's ~56k rows of
 * jams the archive has, and the Shared Feed's 4,869 archive stems, were
 * counted twice).
 *
 * By jam, as Discover routes them (riffLibraryStore.ts's ownRoutedJams): a
 * real jam an earlier db has stems for is that db's, whole, so its rows here
 * are skipped with one seek per jam (Stems_IndexOwner on the archive). A
 * synthetic jam's stems (the Shared Feed's, kept groups) are looked up by
 * StemCID. A real jam only this db has is counted without a lookup.
 * Measured 2026-10-07 on his own db (81,902 stems) after the USB archive:
 * 20,345 counted (was 81,902), 48-56 ms warm, 1.2-2.0 s when the archive's
 * pages are cold (36 jam seeks, 5,307 lookups, spread over the walk's
 * pages); looking up every stem was 3.2 s warm, 8.3 s cold. Off from an
 * exact per-stem union by the stems this db alone has in jams an earlier db
 * has (97 on his, left out of Discover too) and a stem a real jam shares
 * with another db's jam (1 on his).
 *
 * The own db's Stems has no OwnerJamCID index, so it is walked in rowid
 * pages, yielding between them -- .all() per page, never .iterate() across
 * an await -- tallying real jams' rows per jam, then one seek per jam. A
 * failed lookup in an earlier db leaves the stem (or jam) counted. */
export async function readArtistCountsAfter(
  db: Database.Database,
  earlier: readonly Database.Database[],
  pageSize = PAIR_PAGE
): Promise<ArtistCount[]> {
  if (earlier.length === 0) return readArtistCounts(db)
  let page: Database.Statement
  try {
    page = db.prepare(
      `SELECT rowid AS rid, StemCID AS id, OwnerJamCID AS jam, CreatorUserName AS user FROM Stems
       WHERE rowid > ? ORDER BY rowid LIMIT ?`
    )
  } catch {
    return []
  }
  const counts = new Map<string, number>()
  const bump = (user: string, n = 1): void => {
    counts.set(user, (counts.get(user) ?? 0) + n)
  }
  // Real jams' rows, per jam and user: which jams an earlier db takes is
  // decided once the walk has seen them all.
  const perJam = new Map<string, Map<string, number>>()
  let after = 0
  for (;;) {
    if (aborted) throw new Error('discoverArtistIndex: aborted (quitting)')
    countWork('sql:discover.artist-counts-page')
    const rows = page.all(after, pageSize) as {
      rid: number
      id: string
      jam: string
      user: string | null
    }[]
    const lookUp: { id: string; user: string }[] = []
    for (const { id, jam, user } of rows) {
      if (!user) continue
      if (isSyntheticJam(jam)) {
        lookUp.push({ id, user })
        continue
      }
      let users = perJam.get(jam)
      if (!users) {
        users = new Map()
        perJam.set(jam, users)
      }
      users.set(user, (users.get(user) ?? 0) + 1)
    }
    for (let i = 0; i < lookUp.length; i += SEEK_CHUNK) {
      const chunk = lookUp.slice(i, i + SEEK_CHUNK)
      const held = new Set<string>()
      for (const other of earlier) {
        try {
          const found = other
            .prepare(
              `SELECT StemCID AS id FROM Stems WHERE StemCID IN (${chunk.map(() => '?').join(',')})`
            )
            .all(...chunk.map((row) => row.id)) as { id: string }[]
          for (const row of found) held.add(row.id)
        } catch {
          // Can't ask this db: these stems are counted here.
        }
      }
      for (const { id, user } of chunk) if (!held.has(id)) bump(user)
    }
    if (rows.length < pageSize) break
    after = rows[rows.length - 1].rid
    await yieldToEventLoop()
  }
  countWork('sql:discover.artist-counts-jams')
  const hasJam = earlier.flatMap((other) => {
    try {
      return [other.prepare(`SELECT 1 FROM Stems WHERE OwnerJamCID = ? LIMIT 1`)]
    } catch {
      return []
    }
  })
  for (const [jam, users] of perJam) {
    const taken = hasJam.some((stmt) => {
      try {
        return stmt.get(jam) !== undefined
      } catch {
        return false // can't ask this db: the jam's rows here are counted
      }
    })
    if (!taken) for (const [user, n] of users) bump(user, n)
  }
  return [...counts].map(([user, stems]) => ({ user, stems }))
}

export async function readJamUserPairs(
  db: Database.Database,
  pageSize = PAIR_PAGE
): Promise<[string, string][]> {
  let stmt: Database.Statement
  try {
    stmt = db.prepare(
      `SELECT rowid AS rid, OwnerJamCID AS jam, CreatorUserName AS user FROM Stems
       WHERE rowid > ? ORDER BY rowid LIMIT ?`
    )
  } catch {
    return []
  }
  const seen = new Set<string>()
  const out: [string, string][] = []
  let after = 0
  for (;;) {
    if (aborted) throw new Error('discoverArtistIndex: aborted (quitting)')
    countWork('sql:discover.artist-pairs-page')
    const pageStarted = performance.now()
    const page = stmt.all(after, pageSize) as { rid: number; jam: string; user: string | null }[]
    countWork('ms:walk.artist-pairs', Math.round(performance.now() - pageStarted))
    for (const { jam, user } of page) {
      if (!user) continue
      const key = `${jam}\u0000${user}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push([jam, user])
    }
    if (page.length < pageSize) break
    after = page[page.length - 1].rid
    await yieldToEventLoop()
  }
  return out
}

/** The live Stems signal, read at most once per db per getArtistIndex call
 * and shared by every check and every new cache state in that call. */
type SignalOf = (db: Database.Database) => TableSignal | null

function signalReader(): SignalOf {
  const read = new Map<Database.Database, TableSignal | null>()
  return (db) => {
    if (!read.has(db)) read.set(db, readTableSignal(db, 'Stems'))
    return read.get(db) as TableSignal | null
  }
}

/** isScanCacheCurrent, but taking the live signal from the call's reader so
 * counts and pairs never read it twice. */
function isCurrent(db: Database.Database, state: ScanCacheState, signalOf: SignalOf): boolean {
  const now = Date.now()
  if (now - state.checkedAt < CACHE_CHANGE_CHECK_INTERVAL_MS) return true
  // Put off while the startup worker counts Stems, as isScanCacheCurrent does.
  if (isTableCountInFlight(db, 'Stems')) return true
  state.checkedAt = now
  countWork('sql:cache-check.Stems')
  return isTableSignalCurrent(state.signal, signalOf(db), state.builtAt, now)
}

interface Cached<T> {
  value: T
  state: ScanCacheState
}
let countsCache = new WeakMap<Database.Database, Cached<ArtistCount[]>>()
let countsInFlight = new WeakMap<Database.Database, Promise<ArtistCount[]>>()
/** A later db's counts (readArtistCountsAfter): they also depend on the
 * earlier dbs, so they are kept with the earlier dbs and their states. */
interface CachedAfter extends Cached<ArtistCount[]> {
  earlier: readonly Database.Database[]
  earlierStates: ScanCacheState[]
}
let countsAfterCache = new WeakMap<Database.Database, CachedAfter>()
let countsAfterInFlight = new WeakMap<
  Database.Database,
  { earlier: readonly Database.Database[]; run: Promise<ArtistCount[]> }
>()
/** One source db's pairs in memory: `keys` mirrors `value` (jam\0user), and
 * `watermark` (rowidWatermark.ts) is how far through Stems they were built --
 * null for pairs from a legacy saved row, or an uncacheable db's walk,
 * which can be replaced but never extended. */
interface PairsEntry extends Cached<[string, string][]> {
  keys: Set<string>
  watermark: RowidWatermark | null
}
let pairsCache = new WeakMap<Database.Database, PairsEntry>()
let pairsInFlight = new WeakMap<Database.Database, Promise<void>>()
/** Saved pairs loaded as the base of an extension walk this session. */
let pairsBase = new WeakMap<Database.Database, PairsEntry>()
/** The pairs a walk is building right now, per source db (scan plan Task 4:
 * fed by stemsTableWalk.ts's sink, whoever started the walk). */
interface Building {
  from: RowidWatermark
  value: [string, string][]
  keys: Set<string>
  ownDb: Database.Database | undefined
}
let building = new WeakMap<Database.Database, Building>()
/** Walks (by their `from`) already taken up or turned down on their first page. */
let walksSeen = new WeakSet<RowidWatermark>()
/** The own db the picker last passed: where pages of walks started without
 * one (an in-session instrument-row refresh) are saved. */
let lastOwnDb: Database.Database | undefined
/** Saved pairs that no longer match their db: shown while it re-walks. */
let stalePairs = new WeakMap<Database.Database, [string, string][]>()
/** Source dbs whose saved pairs were already consulted this session. */
let diskTried = new WeakSet<Database.Database>()
let pairsFailedAt = new WeakMap<Database.Database, number>()

function countsFor(db: Database.Database, signalOf: SignalOf): Promise<ArtistCount[]> {
  const hit = countsCache.get(db)
  if (hit && isCurrent(db, hit.state, signalOf)) return Promise.resolve(hit.value)
  const pending = countsInFlight.get(db)
  if (pending) return pending
  const state = newScanCacheState(signalOf(db))
  const run = readArtistCounts(db)
    .then((value) => {
      countsCache.set(db, { value, state })
      return value
    })
    .catch((err: unknown) => {
      if (!aborted) console.error('discoverArtistIndex: counts failed:', err)
      return hit?.value ?? []
    })
    .finally(() => {
      if (countsInFlight.get(db) === run) countsInFlight.delete(db)
    })
  countsInFlight.set(db, run)
  return run
}

function sameDbs(a: readonly Database.Database[], b: readonly Database.Database[]): boolean {
  return a.length === b.length && a.every((db, i) => db === b[i])
}

/** countsFor for a db after others in getArtistIndex's list: its stems no
 * earlier db holds. Rebuilt when its own Stems or any earlier db's moves. */
function countsAfterFor(
  db: Database.Database,
  earlier: readonly Database.Database[],
  signalOf: SignalOf
): Promise<ArtistCount[]> {
  if (earlier.length === 0) return countsFor(db, signalOf)
  const hit = countsAfterCache.get(db)
  // Every state is checked (no short circuit), so each one's clock moves.
  const current =
    hit &&
    sameDbs(hit.earlier, earlier) &&
    [
      isCurrent(db, hit.state, signalOf),
      ...earlier.map((e, i) => isCurrent(e, hit.earlierStates[i], signalOf))
    ].every(Boolean)
  if (hit && current) return Promise.resolve(hit.value)
  const pending = countsAfterInFlight.get(db)
  if (pending && sameDbs(pending.earlier, earlier)) return pending.run
  const state = newScanCacheState(signalOf(db))
  const earlierStates = earlier.map((e) => newScanCacheState(signalOf(e)))
  const run = readArtistCountsAfter(db, earlier)
    .then((value) => {
      countsAfterCache.set(db, { value, state, earlier: [...earlier], earlierStates })
      return value
    })
    .catch((err: unknown) => {
      if (!aborted) console.error('discoverArtistIndex: counts failed:', err)
      return hit?.value ?? []
    })
    .finally(() => {
      if (countsAfterInFlight.get(db)?.run === run) countsAfterInFlight.delete(db)
    })
  countsAfterInFlight.set(db, { earlier: [...earlier], run })
  return run
}

function sameWatermark(a: RowidWatermark, b: RowidWatermark): boolean {
  return a.count === b.count && a.maxRowid === b.maxRowid && a.keyAtMax === b.keyAtMax
}

function entryOf(
  value: [string, string][],
  watermark: RowidWatermark | null,
  signal: TableSignal | null
): PairsEntry {
  return {
    value,
    keys: new Set(value.map(([jam, user]) => `${jam}\u0000${user}`)),
    watermark,
    state: newScanCacheState(signal)
  }
}

/** The saved pairs as an entry, when they are a watermark (new rows) or a
 * legacy row; null when nothing was saved. */
function savedEntry(
  ownDb: Database.Database,
  db: Database.Database,
  live: TableSignal | null
): { entry: PairsEntry; current: boolean; extendable: boolean } | null {
  const saved = loadSavedPairs(ownDb, db.name)
  if (!saved) return null
  const legacy = saved.watermarkStemCID === null && (saved.stemCount ?? 0) > 0
  const watermark: RowidWatermark | null = legacy
    ? null
    : { count: saved.stemCount ?? 0, maxRowid: saved.maxRowid, keyAtMax: saved.watermarkStemCID }
  const sameCount =
    saved.stemCount === (live?.count ?? null) && saved.maxRowid === (live?.maxRowid ?? null)
  const current =
    sameCount &&
    (legacy ||
      live?.maxRowid == null ||
      keyAtRowid(db, 'Stems', 'StemCID', live.maxRowid) === saved.watermarkStemCID)
  const extendable =
    !current &&
    watermark !== null &&
    live !== null &&
    canExtendByRowid(db, 'Stems', 'StemCID', watermark, live)
  return { entry: entryOf(saved.pairs, watermark, live), current, extendable }
}

// The one place pairs are built (scan plan Task 4): every page of every
// Stems walk (stemsTableWalk.ts) -- the prewarm's instrument-row walk, an
// in-session refresh, or the picker's own -- comes through here. A walk
// that starts where this db's pairs stand (a full walk, or an extension
// from their watermark) builds on them page by page, saving each page with
// its watermark; any other walk is ignored. So a launch after a LORE sync
// walks Stems once for both Discover and the picker.
function alignedBase(
  db: Database.Database,
  from: RowidWatermark,
  ownDb: Database.Database | undefined
): PairsEntry | null {
  if (from.count === 0) return entryOf([], from, null)
  for (const candidate of [pairsCache.get(db), pairsBase.get(db)]) {
    if (candidate?.watermark && sameWatermark(candidate.watermark, from)) return candidate
  }
  // A walk that started before the picker looked (the prewarm's extension):
  // the saved pairs, when they stand exactly where it started.
  if (ownDb) {
    const saved = savedEntry(ownDb, db, null)
    if (saved?.entry.watermark && sameWatermark(saved.entry.watermark, from)) return saved.entry
  }
  return null
}

function onWalkPage(db: Database.Database, page: StemsWalkPage): void {
  if (aborted) return
  let b = building.get(db)
  if (!b || b.from !== page.from) {
    // A walk is taken or turned down on its FIRST page, once: alignedBase
    // may read the saved pairs (~13k rows) and must not run again for every
    // page of a walk it can't use; and a walk taken up mid-way would miss
    // its earlier pages' pairs. `from` is the same object for every page of
    // one walk.
    if (walksSeen.has(page.from)) return
    walksSeen.add(page.from)
    if (b) return // another walk is already building this db's pairs
    const ownDb = page.ownDb ?? lastOwnDb
    const base = alignedBase(db, page.from, ownDb)
    if (!base) return
    b = { from: page.from, value: base.value.slice(), keys: new Set(base.keys), ownDb }
    building.set(db, b)
    // A failed reset saves nothing of this walk (the in-memory pairs still build).
    if (page.from.count === 0 && ownDb && !resetSavedPairs(ownDb, db.name)) b.ownDb = undefined
  }
  const added: [string, string][] = []
  for (const [jam, user] of page.pairs) {
    const key = `${jam}\u0000${user}`
    if (b.keys.has(key)) continue
    b.keys.add(key)
    b.value.push([jam, user])
    added.push([jam, user])
  }
  // A page that fails to save ends the saving for this walk (the in-memory
  // pairs still build): a later page's watermark would cover this one's
  // pairs on disk without them. The saved copy stays a whole-page prefix,
  // and the next launch extends from it.
  if (b.ownDb && !appendSavedPairs(b.ownDb, db.name, added, page.watermark)) b.ownDb = undefined
}

function onWalkEnd(
  db: Database.Database,
  from: RowidWatermark,
  result: StemsWalkResult | null
): void {
  const b = building.get(db)
  if (!b || b.from !== from) return
  building.delete(db)
  if (!result || !result.complete || aborted) return
  // Current only if nothing landed past the walk's last page meanwhile;
  // otherwise the next check sees the move and extends.
  const live = readTableSignal(db, 'Stems')
  const caughtUp =
    live?.count === result.watermark.count && live?.maxRowid === result.watermark.maxRowid
  const entry = entryOf(b.value, { ...result.watermark }, caughtUp ? live : null)
  if (!caughtUp) entry.state.checkedAt = 0
  pairsCache.set(db, entry)
  pairsBase.delete(db)
  stalePairs.delete(db)
  pairsFailedAt.delete(db)
}

addStemsWalkSink({ onPage: onWalkPage, onEnd: onWalkEnd })

/** Starts the walk that brings `db`'s pairs up to date -- from `base`'s
 * watermark when it extends, else in full -- and resolves when it has
 * landed (the sink above did the work). */
function startPairsWalk(
  ownDb: Database.Database,
  db: Database.Database,
  base: PairsEntry | null,
  live: TableSignal | null
): void {
  if (db.memory) {
    // No stable key to save under, nothing to extend: the plain walk.
    const run = readJamUserPairs(db)
      .then((value) => {
        pairsCache.set(db, entryOf(value, null, live))
        stalePairs.delete(db)
        pairsFailedAt.delete(db)
      })
      .catch((err: unknown) => {
        pairsFailedAt.set(db, Date.now())
        if (!aborted) console.error('discoverArtistIndex: pairs walk failed:', err)
      })
      .finally(() => pairsInFlight.delete(db))
    pairsInFlight.set(db, run)
    return
  }
  const extend =
    base?.watermark != null &&
    live !== null &&
    canExtendByRowid(db, 'Stems', 'StemCID', base.watermark, live)
  if (extend) pairsBase.set(db, base!)
  countWork(extend ? 'artist-pairs:extend' : 'artist-pairs:rebuild')
  const from: RowidWatermark = extend
    ? { ...base!.watermark! }
    : { count: 0, maxRowid: null, keyAtMax: null }
  const before = pairsCache.get(db)
  const run = walkStems(db, from, { ownDb })
    .then(() => {
      // The walk landed without building this db's pairs (a page read
      // failed, or another walk was building them): back off before the
      // next try rather than walking again on every poll.
      if (pairsCache.get(db) === before) pairsFailedAt.set(db, Date.now())
    })
    .catch((err: unknown) => {
      pairsFailedAt.set(db, Date.now())
      if (!aborted) console.error('discoverArtistIndex: pairs walk failed:', err)
    })
    .finally(() => pairsInFlight.delete(db))
  pairsInFlight.set(db, run)
}

/** Current pairs, or null -- and starts the background walk when missing or
 * stale. Never awaited by a caller: the picker polls instead. */
function pairsFor(
  ownDb: Database.Database,
  db: Database.Database,
  signalOf: SignalOf
): { pairs: [string, string][] | null; pending: boolean } {
  const hit = pairsCache.get(db)
  if (hit && isCurrent(db, hit.state, signalOf)) return { pairs: hit.value, pending: false }

  // First look this session: the pairs saved on an earlier launch.
  let base: PairsEntry | null = hit ?? null
  if (!hit && !diskTried.has(db)) {
    diskTried.add(db)
    const saved = db.memory ? null : savedEntry(ownDb, db, signalOf(db))
    if (saved?.current) {
      pairsCache.set(db, saved.entry)
      return { pairs: saved.entry.value, pending: false }
    }
    if (saved) {
      stalePairs.set(db, saved.entry.value)
      base = saved.entry
    }
  }

  // Shown while a walk runs (or while backing off after a failed one).
  const shown = hit?.value ?? stalePairs.get(db) ?? null
  if (pairsInFlight.has(db)) return { pairs: shown, pending: true }
  if (aborted) return { pairs: shown, pending: false }
  const failedAt = pairsFailedAt.get(db)
  if (failedAt !== undefined && Date.now() - failedAt < PAIRS_RETRY_MS) {
    return { pairs: shown, pending: false }
  }
  startPairsWalk(ownDb, db, base ?? pairsBase.get(db) ?? null, signalOf(db))
  return { pairs: shown, pending: true }
}

/** The last list built, reused while its pairs and own username are the
 * same (the picker polls; 13k pairs is a few ms each time otherwise). */
let lastList: { pairs: [string, string][][]; own: string; value: JammedWith[] } | null = null

function jammedWithFor(pairs: [string, string][][], own: string): JammedWith[] {
  if (
    lastList &&
    lastList.own === own &&
    lastList.pairs.length === pairs.length &&
    lastList.pairs.every((p, i) => p === pairs[i])
  ) {
    return lastList.value
  }
  const value = jammedWithFromPairs(pairs.flat(), own)
  lastList = { pairs, own, value }
  return value
}

export async function getArtistIndex(
  ownDb: Database.Database,
  dbs: readonly Database.Database[],
  ownUsername: string
): Promise<ArtistIndex> {
  const own = ownUsername.trim()
  // The Stems signal below, after the startup worker's count (tableCountSeed.ts).
  await Promise.all(dbs.map((db) => whenTableCountsSettled(db, ['Stems'])))
  lastOwnDb = ownDb
  const signalOf = signalReader()
  const perDb = dbs.map((db) => pairsFor(ownDb, db, signalOf))
  // Each db's list holds only stems no earlier db has (the archive comes
  // first), so adding them up counts each StemCID once.
  const counts = mergeArtistCounts(
    await Promise.all(dbs.map((db, i) => countsAfterFor(db, dbs.slice(0, i), signalOf)))
  )
  const ready = perDb.every((p) => p.pairs !== null)
  return {
    counts,
    jammedWith: ready
      ? jammedWithFor(
          perDb.map((p) => p.pairs as [string, string][]),
          own
        )
      : null,
    jammedWithPending: perDb.some((p) => p.pending)
  }
}

let analysedCache = new Map<string, { featureRows: number; analysed: number; total: number }>()

export async function getArtistAnalysed(
  ownDb: Database.Database,
  dbs: readonly Database.Database[],
  artist: string
): Promise<{ analysed: number; total: number }> {
  const ids = [...(await getArtistStemCIDs(dbs, artist))]
  // Scan plan Task 13 M2 (audit minor): while the trait value table accounts
  // for every StemFeatureCache row (one COUNT), it answers "has a row" for
  // each stem -- a parsed row or a malformed one, as the IN-COUNT below
  // counts both -- from memory. No cache needed: the count it would be keyed
  // on moves with every write while scanning, so the cache missed on every
  // picker poll anyway.
  const table = getTraitValueTable(ownDb)
  if (table) {
    if (aborted) throw new Error('discoverArtistIndex: aborted (quitting)')
    let analysed = 0
    for (const id of ids) if (table.versionsOf(id) !== undefined) analysed += 1
    return { analysed, total: ids.length }
  }
  let featureRows = 0
  try {
    featureRows = (
      ownDb.prepare(`SELECT COUNT(*) AS n FROM StemFeatureCache`).get() as { n: number }
    ).n
  } catch {
    return { analysed: 0, total: ids.length }
  }
  const hit = analysedCache.get(artist)
  if (hit && hit.featureRows === featureRows && hit.total === ids.length) {
    return { analysed: hit.analysed, total: hit.total }
  }
  let analysed = 0
  // Prepared once per placeholder count: at most two per call.
  const statements = new Map<number, Database.Statement>()
  const statementFor = (n: number): Database.Statement => {
    let stmt = statements.get(n)
    if (!stmt) {
      stmt = ownDb.prepare(
        `SELECT COUNT(*) AS n FROM StemFeatureCache
         WHERE StemCID IN (${new Array(n).fill('?').join(', ')})`
      )
      statements.set(n, stmt)
    }
    return stmt
  }
  for (let i = 0; i < ids.length; i += FEATURE_CHUNK) {
    if (aborted) throw new Error('discoverArtistIndex: aborted (quitting)')
    const idChunk = ids.slice(i, i + FEATURE_CHUNK)
    countWork('sql:discover.artist-analysed-chunk')
    analysed += (statementFor(idChunk.length).get(...idChunk) as { n: number }).n
    if ((i / FEATURE_CHUNK) % 10 === 9) await yieldToEventLoop()
  }
  analysedCache.set(artist, { featureRows, analysed, total: ids.length })
  return { analysed, total: ids.length }
}

export function resetArtistIndexForTests(): void {
  countsCache = new WeakMap()
  countsInFlight = new WeakMap()
  countsAfterCache = new WeakMap()
  countsAfterInFlight = new WeakMap()
  pairsCache = new WeakMap()
  pairsInFlight = new WeakMap()
  pairsBase = new WeakMap()
  building = new WeakMap()
  walksSeen = new WeakSet()
  lastOwnDb = undefined
  stalePairs = new WeakMap()
  diskTried = new WeakSet()
  pairsFailedAt = new WeakMap()
  lastList = null
  analysedCache = new Map()
  aborted = false
  resetArtistStemAbortForTests()
}
