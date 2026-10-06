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
import {
  CACHE_CHANGE_CHECK_INTERVAL_MS,
  isTableSignalCurrent,
  newScanCacheState,
  readTableSignal,
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
    if (b) return // another walk is already building this db's pairs
    const ownDb = page.ownDb ?? lastOwnDb
    const base = alignedBase(db, page.from, ownDb)
    if (!base) return
    b = { from: page.from, value: base.value.slice(), keys: new Set(base.keys), ownDb }
    building.set(db, b)
    if (page.from.count === 0 && ownDb) resetSavedPairs(ownDb, db.name)
  }
  const added: [string, string][] = []
  for (const [jam, user] of page.pairs) {
    const key = `${jam}\u0000${user}`
    if (b.keys.has(key)) continue
    b.keys.add(key)
    b.value.push([jam, user])
    added.push([jam, user])
  }
  if (b.ownDb) appendSavedPairs(b.ownDb, db.name, added, page.watermark)
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
  lastOwnDb = ownDb
  const signalOf = signalReader()
  const perDb = dbs.map((db) => pairsFor(ownDb, db, signalOf))
  const counts = mergeArtistCounts(await Promise.all(dbs.map((db) => countsFor(db, signalOf))))
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
  pairsCache = new WeakMap()
  pairsInFlight = new WeakMap()
  pairsBase = new WeakMap()
  building = new WeakMap()
  lastOwnDb = undefined
  stalePairs = new WeakMap()
  diskTried = new WeakSet()
  pairsFailedAt = new WeakMap()
  lastList = null
  analysedCache = new Map()
  aborted = false
  resetArtistStemAbortForTests()
}
