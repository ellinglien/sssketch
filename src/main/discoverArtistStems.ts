// src/main/discoverArtistStems.ts
//
// One artist's stems, for Discover artist mode. Read from the archive's
// Stems_IndexUser index, paged by rowid INSIDE that index (measured
// 2026-10-01 on Elling's 1.19 GB USB archive: 31,398 rows in 1.63 s cold as
// one statement; per 2,000-row page, ~9 ms warm and ~250 ms cold) so no
// single slice blocks the main process for long. The own db has no CreatorUserName index; its pages are
// rowid-range scans of a small SSD table, which is cheap.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
import { getStemPriority, getStemPriorityUsername } from './stemPriority'
import {
  isScanCacheCurrent,
  newScanCacheState,
  readTableSignal,
  type ScanCacheState
} from './tableChangeSignal'

export interface ArtistStemRow {
  stemCID: string
  jamCID: string
}

const ARTIST_PAGE = 2000
/** "Only my stems" for a name stemPriority.ts does not keep (the
 * RIFF_LIBRARY_USERNAME fallback): his own run to ~69k rows, ~34 pages at
 * ARTIST_PAGE, each up to ~250 ms of main-process block cold off the USB
 * archive and again after every sync. A quarter of that per page. */
const OWN_STEMS_PAGE = 500
/** Per db. 31k rows is ~4.6 MB of row objects and CID strings; a handful
 * of artists per session is plenty. Combine artists keeps a whole selection
 * (at most MAX_COMBINED_ARTISTS) cached: discoverArtistStems.test.ts pins it. */
export const MAX_CACHED_ARTISTS = 8

/** Set on quit (abortArtistIndexWork calls it): running walks stop at
 * their next page, so none holds a statement on a closing db. */
let aborted = false

export function abortArtistStemWalks(): void {
  aborted = true
}

export function resetArtistStemAbortForTests(): void {
  aborted = false
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function readArtistStemRows(
  db: Database.Database,
  artist: string,
  pageSize = ARTIST_PAGE
): Promise<ArtistStemRow[]> {
  let stmt: Database.Statement
  try {
    stmt = db.prepare(
      `SELECT rowid AS rid, StemCID, OwnerJamCID FROM Stems
       WHERE CreatorUserName = ? AND rowid > ? ORDER BY rowid LIMIT ?`
    )
  } catch {
    return [] // an external db missing the table -- same tolerance as everywhere
  }
  const out: ArtistStemRow[] = []
  let after = 0
  for (;;) {
    if (aborted) throw new Error('discoverArtistStems: aborted (quitting)')
    countWork('sql:discover.artist-stems-page')
    const page = stmt.all(artist, after, pageSize) as {
      rid: number
      StemCID: string
      OwnerJamCID: string
    }[]
    for (const row of page) out.push({ stemCID: row.StemCID, jamCID: row.OwnerJamCID })
    if (page.length < pageSize) break
    after = page[page.length - 1].rid
    await yieldToEventLoop()
  }
  return out
}

interface PerDb {
  /** ONE Stems signal for every artist cached on this db, read once, before
   * the first walk on an empty cache starts (so concurrent walks share the
   * earliest reading). Any write since then reads as stale and drops every
   * artist at once, so a roll pays one signal check per db, not one per
   * cached artist. Null after an invalidation until the next walk starts. */
  state: ScanCacheState | null
  /** Map order is the LRU order. */
  artists: Map<string, ArtistStemRow[]>
  /** Walks still running, so concurrent rolls for one artist share one. */
  inFlight: Map<string, Promise<ArtistStemRow[]>>
  /** Bumped on invalidation: a walk that started before it must not
   * repopulate the cache with rows read against the old table. */
  generation: number
}
const cache = new WeakMap<Database.Database, PerDb>()

function perDbFor(db: Database.Database): PerDb {
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = { state: null, artists: new Map(), inFlight: new Map(), generation: 0 }
    cache.set(db, perDb)
  }
  return perDb
}

function rowsForDb(
  db: Database.Database,
  artist: string,
  pageSize: number
): Promise<ArtistStemRow[]> {
  const perDb = perDbFor(db)
  if (perDb.state !== null && !isScanCacheCurrent(db, 'Stems', perDb.state)) {
    perDb.state = null
    perDb.artists.clear()
    // Walks still running read the old table: the next call must not join one.
    perDb.inFlight.clear()
    perDb.generation += 1
  }
  const hit = perDb.artists.get(artist)
  if (hit) {
    perDb.artists.delete(artist)
    perDb.artists.set(artist, hit)
    return Promise.resolve(hit)
  }
  const pending = perDb.inFlight.get(artist)
  if (pending) return pending

  // Signal read BEFORE the walk, into the shared state: a write landing
  // mid-walk reads as stale next time.
  if (perDb.state === null) perDb.state = newScanCacheState(readTableSignal(db, 'Stems'))
  const generation = perDb.generation
  // `let` so the finally below can compare against it; assigned before that
  // finally can run (the body suspends at its first await).
  let walk: Promise<ArtistStemRow[]> | null = null
  walk = (async (): Promise<ArtistStemRow[]> => {
    try {
      const rows = await readArtistStemRows(db, artist, pageSize)
      if (perDb.generation === generation) {
        perDb.artists.delete(artist)
        perDb.artists.set(artist, rows)
        while (perDb.artists.size > MAX_CACHED_ARTISTS) {
          perDb.artists.delete(perDb.artists.keys().next().value as string)
        }
      }
      return rows
    } finally {
      // Only our own entry: an invalidation may have replaced it already.
      if (perDb.inFlight.get(artist) === walk) perDb.inFlight.delete(artist)
    }
  })()
  // Set before anything awaits it: the async body above has suspended at
  // its first await by now, so its finally cannot have run yet.
  perDb.inFlight.set(artist, walk)
  return walk
}

/** Every db's rows, merged; the FIRST db listing a StemCID decides its jam.
 * `pageSize` only shapes a walk this call starts (one already in flight or
 * cached is shared whatever its page size). */
export async function getArtistStemRows(
  dbs: readonly Database.Database[],
  artist: string,
  pageSize = ARTIST_PAGE
): Promise<ArtistStemRow[]> {
  const seen = new Set<string>()
  const out: ArtistStemRow[] = []
  for (const db of dbs) {
    for (const row of await rowsForDb(db, artist, pageSize)) {
      if (seen.has(row.stemCID)) continue
      seen.add(row.stemCID)
      out.push(row)
    }
  }
  return out
}

/** The per-db rows are cached above; building a 31k-entry Set per roll is
 * ~2 ms, so no second cache layer here. */
export async function getArtistStemCIDs(
  dbs: readonly Database.Database[],
  artist: string,
  pageSize = ARTIST_PAGE
): Promise<ReadonlySet<string>> {
  return new Set((await getArtistStemRows(dbs, artist, pageSize)).map((r) => r.stemCID))
}

/** The stems a Discover roll may draw from, applied BEFORE each pool's
 * bounded random sample (getDiscoverCandidates' `artistStemCIDs`): artist
 * mode's artist; else, with "only my stems", the target user's own; else
 * undefined (no restriction).
 *
 * "Only my stems" used to sample 1,000 stems from the whole library and
 * filter by owner afterwards (the pools' post-filters, kept as a safety
 * net), so where his own are 1% a roll had ~10 candidates. His own come
 * from stemPriority.ts when targetUser is the name it keeps (the usual
 * case): already built, kept current by a rowid watermark, and asked for
 * under that same name so it is never evicted. Its dbs are
 * candidateDbsForRiff plus the own db -- the same dbs listJamsWithDb lists
 * Discover's jams from -- so `dbs` is not consulted on that path. Any other
 * name (the RIFF_LIBRARY_USERNAME fallback) is read as an artist is (cached
 * per db and name, Stems_IndexUser windows) in OWN_STEMS_PAGE pages.
 */
export async function discoverStemRestriction(
  dbs: readonly Database.Database[],
  {
    artist,
    onlyOwnStems,
    targetUser
  }: { artist?: string; onlyOwnStems: boolean; targetUser?: string }
): Promise<ReadonlySet<string> | undefined> {
  const artistName = artist?.trim() || undefined
  if (artistName) return getArtistStemCIDs(dbs, artistName)
  const ownName = onlyOwnStems ? targetUser?.trim() || undefined : undefined
  if (!ownName) return undefined
  if (ownName === getStemPriorityUsername()) return (await getStemPriority(ownName)).own
  return getArtistStemCIDs(dbs, ownName, OWN_STEMS_PAGE)
}
