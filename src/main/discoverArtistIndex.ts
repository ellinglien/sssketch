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
import { loadSavedPairs, savePairs } from './discoverJamUserPairsStore'

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
let pairsCache = new WeakMap<Database.Database, Cached<[string, string][]>>()
let pairsInFlight = new WeakMap<Database.Database, Promise<void>>()
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

function savedSignalMatches(
  saved: { stemCount: number | null; maxRowid: number | null },
  live: TableSignal | null
): boolean {
  return saved.stemCount === (live?.count ?? null) && saved.maxRowid === (live?.maxRowid ?? null)
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
  if (!hit && !diskTried.has(db)) {
    diskTried.add(db)
    const saved = loadSavedPairs(ownDb, db.name)
    if (saved) {
      const live = signalOf(db)
      if (savedSignalMatches(saved, live)) {
        pairsCache.set(db, { value: saved.pairs, state: newScanCacheState(live) })
        return { pairs: saved.pairs, pending: false }
      }
      stalePairs.set(db, saved.pairs)
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

  // Signal read BEFORE the walk: a write landing mid-walk reads as stale next time.
  const state = newScanCacheState(signalOf(db))
  const run = readJamUserPairs(db)
    .then((value) => {
      pairsCache.set(db, { value, state })
      stalePairs.delete(db)
      pairsFailedAt.delete(db)
      savePairs(
        ownDb,
        db.name,
        { stemCount: state.signal?.count ?? null, maxRowid: state.signal?.maxRowid ?? null },
        value
      )
    })
    .catch((err: unknown) => {
      pairsFailedAt.set(db, Date.now())
      if (!aborted) console.error('discoverArtistIndex: pairs walk failed:', err)
    })
    .finally(() => pairsInFlight.delete(db))
  pairsInFlight.set(db, run)
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
  stalePairs = new WeakMap()
  diskTried = new WeakSet()
  pairsFailedAt = new WeakMap()
  lastList = null
  analysedCache = new Map()
  aborted = false
  resetArtistStemAbortForTests()
}
