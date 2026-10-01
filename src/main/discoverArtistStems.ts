// src/main/discoverArtistStems.ts
//
// One artist's stems, for Discover artist mode. Read from the archive's
// Stems_IndexUser index, paged by rowid INSIDE that index (measured
// 2026-10-01 on Elling's 1.19 GB USB archive: 31,398 rows in 1.63 s cold as
// one statement, 2,000 rows in 9 ms per page) so no single slice blocks the
// main process. The own db has no CreatorUserName index; its pages are
// rowid-range scans of a small SSD table, which is cheap.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
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
/** Per db. 31k rows is ~3 MB; a handful of artists per session is plenty. */
const MAX_CACHED_ARTISTS = 8

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

interface Entry {
  rows: ArtistStemRow[]
  state: ScanCacheState
}
const cache = new WeakMap<Database.Database, Map<string, Entry>>()

async function rowsForDb(db: Database.Database, artist: string): Promise<ArtistStemRow[]> {
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = new Map()
    cache.set(db, perDb)
  }
  const hit = perDb.get(artist)
  if (hit && isScanCacheCurrent(db, 'Stems', hit.state)) {
    // Re-insert: Map order is the LRU order.
    perDb.delete(artist)
    perDb.set(artist, hit)
    return hit.rows
  }
  // Signal read BEFORE the walk: a write landing mid-walk reads as stale next time.
  const state = newScanCacheState(readTableSignal(db, 'Stems'))
  const rows = await readArtistStemRows(db, artist)
  perDb.delete(artist)
  perDb.set(artist, { rows, state })
  while (perDb.size > MAX_CACHED_ARTISTS) perDb.delete(perDb.keys().next().value as string)
  return rows
}

/** Every db's rows, merged; the FIRST db listing a StemCID decides its jam. */
export async function getArtistStemRows(
  dbs: readonly Database.Database[],
  artist: string
): Promise<ArtistStemRow[]> {
  const seen = new Set<string>()
  const out: ArtistStemRow[] = []
  for (const db of dbs) {
    for (const row of await rowsForDb(db, artist)) {
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
  artist: string
): Promise<ReadonlySet<string>> {
  return new Set((await getArtistStemRows(dbs, artist)).map((r) => r.stemCID))
}
