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
// Counts and pairs are in memory, per session, re-validated against the
// Stems table signal. The jammed-with LIST is also saved to the own db
// (Elling's decision, 2026-10-01; discoverJammedWithStore.ts): on launch it
// is served at once, with no walk, while every source db's Stems count and
// MAX(rowid) still match what it was built from.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
import {
  isScanCacheCurrent,
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
import { getArtistStemCIDs } from './discoverArtistStems'
import {
  loadSavedJammedWith,
  saveJammedWith,
  type JammedWithSource,
  type SavedJammedWith
} from './discoverJammedWithStore'

const USER_PAGE = 500
const PAIR_PAGE = 20_000
const FEATURE_CHUNK = 500

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
    countWork('sql:discover.artist-pairs-page')
    const page = stmt.all(after, pageSize) as { rid: number; jam: string; user: string | null }[]
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

interface Cached<T> {
  value: T
  state: ScanCacheState
}
let countsCache = new WeakMap<Database.Database, Cached<ArtistCount[]>>()
let pairsCache = new WeakMap<Database.Database, Cached<[string, string][]>>()
let pairsInFlight = new WeakMap<Database.Database, Promise<void>>()

async function countsFor(db: Database.Database): Promise<ArtistCount[]> {
  const hit = countsCache.get(db)
  if (hit && isScanCacheCurrent(db, 'Stems', hit.state)) return hit.value
  const state = newScanCacheState(readTableSignal(db, 'Stems'))
  const value = await readArtistCounts(db)
  countsCache.set(db, { value, state })
  return value
}

/** Current pairs, or null -- and starts the background walk when missing
 * or stale. Never awaited by a caller: the picker polls instead. */
function pairsFor(db: Database.Database): { pairs: [string, string][] | null; pending: boolean } {
  const hit = pairsCache.get(db)
  if (hit && isScanCacheCurrent(db, 'Stems', hit.state)) return { pairs: hit.value, pending: false }
  if (!pairsInFlight.has(db)) {
    const state = newScanCacheState(readTableSignal(db, 'Stems'))
    const run = readJamUserPairs(db)
      .then((value) => {
        pairsCache.set(db, { value, state })
      })
      .catch((err: unknown) => console.error('discoverArtistIndex: pairs walk failed:', err))
      .finally(() => pairsInFlight.delete(db))
    pairsInFlight.set(db, run)
  }
  // A stale-but-present answer is still shown while the refresh runs.
  return { pairs: hit?.value ?? null, pending: true }
}

function sourceOf(db: Database.Database, signal: TableSignal | null): JammedWithSource {
  return {
    sourceDbKey: db.name,
    stemCount: signal?.count ?? null,
    maxRowid: signal?.maxRowid ?? null
  }
}

/** Whether a saved list was built for this own username from exactly these
 * dbs, each still reading the Stems count and MAX(rowid) it had then. */
function savedMatches(
  saved: SavedJammedWith,
  ownUsername: string,
  live: readonly JammedWithSource[]
): boolean {
  if (saved.ownUsername !== ownUsername || saved.sources.length !== live.length) return false
  return live.every((l) =>
    saved.sources.some(
      (s) =>
        s.sourceDbKey === l.sourceDbKey && s.stemCount === l.stemCount && s.maxRowid === l.maxRowid
    )
  )
}

/** The jammed-with answer this session trusts without a walk: from disk
 * (first look) or from a finished walk. `states` are one per db, in order. */
interface Verified {
  ownUsername: string
  dbs: readonly Database.Database[]
  states: ScanCacheState[]
  value: JammedWith[]
}
let verified = new WeakMap<Database.Database, Verified>()
/** Shown while a walk runs, when nothing verified is: the saved list for
 * the same own username, even if a source db has moved since. */
let shownWhileWalking = new WeakMap<
  Database.Database,
  { ownUsername: string; value: JammedWith[] }
>()
/** Which (own username, dbs) the disk was already consulted for. */
let diskChecked = new WeakMap<Database.Database, string>()

function sameDbs(a: readonly Database.Database[], b: readonly Database.Database[]): boolean {
  return a.length === b.length && a.every((db, i) => db === b[i])
}

/** First look this session: the saved list, verified against live signals. */
function verifyFromDisk(
  ownDb: Database.Database,
  dbs: readonly Database.Database[],
  ownUsername: string
): Verified | null {
  const saved = loadSavedJammedWith(ownDb)
  if (!saved) return null
  if (saved.ownUsername === ownUsername) {
    shownWhileWalking.set(ownDb, { ownUsername, value: saved.list })
  }
  const signals = dbs.map((db) => readTableSignal(db, 'Stems'))
  const live = dbs.map((db, i) => sourceOf(db, signals[i]))
  if (!savedMatches(saved, ownUsername, live)) return null
  return {
    ownUsername,
    dbs: [...dbs],
    states: signals.map((signal) => newScanCacheState(signal)),
    value: saved.list
  }
}

export async function getArtistIndex(
  ownDb: Database.Database,
  dbs: readonly Database.Database[],
  ownUsername: string
): Promise<ArtistIndex> {
  const own = ownUsername.trim()
  const counts = mergeArtistCounts(await Promise.all(dbs.map((db) => countsFor(db))))

  // 1. A trusted answer, still current: no walk at all.
  const v = verified.get(ownDb)
  if (
    v &&
    v.ownUsername === own &&
    sameDbs(v.dbs, dbs) &&
    v.states.every((state, i) => isScanCacheCurrent(dbs[i], 'Stems', state))
  ) {
    return { counts, jammedWith: v.value, jammedWithPending: false }
  }

  // 2. First look this session (per own username and db set): the disk.
  const checkKey = [own, ...dbs.map((db) => db.name)].join('\u0000')
  if (diskChecked.get(ownDb) !== checkKey) {
    diskChecked.set(ownDb, checkKey)
    const fromDisk = verifyFromDisk(ownDb, dbs, own)
    if (fromDisk) {
      verified.set(ownDb, fromDisk)
      return { counts, jammedWith: fromDisk.value, jammedWithPending: false }
    }
  }

  // 3. The background walk, per db, as before.
  const perDb = dbs.map((db) => pairsFor(db))
  const pending = perDb.some((p) => p.pending)
  const ready = perDb.every((p) => p.pairs !== null)
  if (ready) {
    const value = jammedWithFromPairs(
      perDb.flatMap((p) => p.pairs as [string, string][]),
      own
    )
    if (!pending) {
      const states = dbs.map((db) => (pairsCache.get(db) as Cached<[string, string][]>).state)
      saveJammedWith(
        ownDb,
        own,
        dbs.map((db, i) => sourceOf(db, states[i].signal)),
        value
      )
      verified.set(ownDb, { ownUsername: own, dbs: [...dbs], states, value })
    }
    return { counts, jammedWith: value, jammedWithPending: pending }
  }
  const stale =
    (v && v.ownUsername === own ? v.value : null) ??
    (() => {
      const shown = shownWhileWalking.get(ownDb)
      return shown && shown.ownUsername === own ? shown.value : null
    })()
  return { counts, jammedWith: stale, jammedWithPending: pending }
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
  pairsCache = new WeakMap()
  pairsInFlight = new WeakMap()
  analysedCache = new Map()
  verified = new WeakMap()
  shownWhileWalking = new WeakMap()
  diskChecked = new WeakMap()
}
