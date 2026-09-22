// src/main/discoverLibraryStems.ts
import { readdirSync } from 'fs'
import { basename, dirname } from 'path'
import type Database from 'better-sqlite3'
import { resolveStemPath } from './riffLibraryStore'
import { getCachedStemJamPairs, type StemJamPair } from './scanTargetCache'
import { countWork } from './workCounters'

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

export interface LibraryScanTarget {
  key: string
  path: string
}

interface RiffStemColumnsRow {
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

// Real bug, found via a live 2026-09-15 report: clicking "new project"
// beachballed for ~30s. Root cause traced to THIS function -- called
// synchronously, once per app session, by the get-discover-library-scan-
// targets IPC handler (main/index.ts), which DiscoverLibraryScan.tsx calls
// once on mount. At Elling's real library scale (52,493 stems) this was
// doing tens of thousands of synchronous existsSync syscalls in one
// unbroken loop on the Electron MAIN process's single JS thread -- which
// also owns every other ipcMain.handle callback, so nothing else (menus,
// other IPC calls, "new project"'s own generate-default-project-name) could
// run until the whole enumeration finished. Yielding back to the event loop
// every YIELD_EVERY stems (a plain setImmediate, not a real async
// filesystem call -- existsSync itself stays synchronous, cheap enough per
// call that batching the YIELD is what actually matters, not making each
// check async) lets queued IPC interleave instead of piling up behind one
// multi-second-to-tens-of-seconds call. Total wall-clock time for the scan
// itself is essentially unchanged; what changes is that the app stays
// responsive to everything else while it runs.
const YIELD_EVERY = 200

// Rows per keyset page when walking a db's whole Riffs table -- see
// listLibraryScanTargets.
const RIFF_PAGE_SIZE = 2000

interface RiffPageRow extends RiffStemColumnsRow {
  RiffCID: string
  OwnerJamCID: string
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Default `existsFn` for listLibraryScanTargets: reads each FOLDER once
 * (readdirSync) and answers every later check in that folder from memory.
 * Real live freeze, profiled 2026-09-21 (typing lag + macOS beachball):
 * one existsSync per stem across a ~50k-stem library was still ~12s of
 * main-process time per 25s sampled even with the YIELD_EVERY batching
 * above -- 200 stats per batch on a slow or external volume is itself a
 * long block. Stems live in a small number of shard folders, so this turns
 * tens of thousands of stat calls into a handful of directory reads. A
 * folder that can't be read counts as "nothing exists there". Listings are
 * taken once per instance -- fine for a list built once per session. */
export function createDirListingExists(): (path: string) => boolean {
  const listings = new Map<string, Set<string> | null>()
  return (path) => {
    const dir = dirname(path)
    let entries = listings.get(dir)
    if (entries === undefined) {
      try {
        entries = new Set(readdirSync(dir))
      } catch {
        entries = null
      }
      listings.set(dir, entries)
    }
    return entries?.has(basename(path)) ?? false
  }
}

/** Every stem, library-wide, whose audio is ALREADY downloaded locally --
 * deliberately excludes anything that would need a fresh download. Elling's
 * own consent (design spec §8.5) is about analyzing what's already on
 * disk, not triggering tens of thousands of new downloads -- that would be
 * a completely different, much larger cost this plan was never scoped to
 * incur. Deduplicated by StemCID (the same stem can appear in more than one
 * Riffs row's own StemCID_1..8 columns).
 *
 * `jams` is caller-supplied and `existsFn` is injectable (defaults to the
 * folder-listing createDirListingExists above) for the same testability reason as
 * discoverCandidates.ts's own getDiscoverCandidates -- this keeps the test
 * suite free of any real filesystem dependency. */
export async function listLibraryScanTargets(
  jams: JamDbPair[],
  existsFn: (path: string) => boolean = createDirListingExists(),
  // Background efficiency B6: sssketch's own writable db, holding the
  // persisted per-source-db stem/jam pairs (scanTargetCache.ts) -- a launch
  // then reads only riffs added since last time instead of walking every
  // Riffs table in full. Omitted (tests, or no cache wanted): walk as before.
  cacheDb?: Database.Database
): Promise<LibraryScanTarget[]> {
  const seen = new Set<string>()
  const out: LibraryScanTarget[] = []
  let sinceYield = 0

  // Existence check per stem, in the order the pairs are met -- the first
  // allowed pair for a StemCID decides its path (seen before exists, as
  // always). True every YIELD_EVERY stems: the caller yields then.
  function consider(stemCID: string, jamCID: string): boolean {
    if (seen.has(stemCID)) return false
    seen.add(stemCID)
    const path = resolveStemPath(jamCID, stemCID)
    if (existsFn(path)) out.push({ key: stemCID, path })
    sinceYield += 1
    if (sinceYield < YIELD_EVERY) return false
    sinceYield = 0
    return true
  }

  // One ordered, paged pass over each DB's Riffs table, filtering to the
  // caller's jams in memory -- real live freeze, profiled 2026-09-21: jams
  // share one db (~5,000 of them in one external archive), and the old
  // per-jam `WHERE OwnerJamCID = ?` query was a separate scan of that whole
  // table per jam (an external archive is read-only, so no index can be
  // added there). Keyset pagination (`RiffCID > ?`), not OFFSET, so each
  // page costs the same no matter how deep into the table it is.
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    // Cached pairs come back in the same order this walk meets them, so the
    // result is identical either way.
    let cached: StemJamPair[] | null = null
    if (cacheDb) {
      try {
        cached = await getCachedStemJamPairs(cacheDb, db)
      } catch (err) {
        console.error('listLibraryScanTargets: scan-target cache failed, walking instead:', err)
        cached = null
      }
    }
    if (cached) {
      countWork('scan-targets.cached-pairs', cached.length)
      for (const pair of cached) {
        if (!allowedJamCIDs.has(pair.jamCID)) continue
        if (consider(pair.stemCID, pair.jamCID)) await yieldToEventLoop()
      }
      continue
    }

    countWork('sql:scan-targets.walk')
    let page: RiffPageRow[]
    let afterRiffCID = ''
    let statement: Database.Statement
    try {
      statement = db.prepare(
        `SELECT RiffCID, OwnerJamCID, StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                StemCID_5, StemCID_6, StemCID_7, StemCID_8
         FROM Riffs WHERE RiffCID > ? ORDER BY RiffCID LIMIT ?`
      )
    } catch {
      continue
    }
    for (;;) {
      try {
        page = statement.all(afterRiffCID, RIFF_PAGE_SIZE) as RiffPageRow[]
      } catch {
        break
      }
      if (page.length === 0) break
      afterRiffCID = page[page.length - 1].RiffCID
      for (const riff of page) {
        if (!allowedJamCIDs.has(riff.OwnerJamCID)) continue
        for (let slot = 1; slot <= 8; slot++) {
          const stemCID = riff[`StemCID_${slot}` as keyof RiffStemColumnsRow]
          if (!stemCID) continue
          if (consider(stemCID, riff.OwnerJamCID)) await yieldToEventLoop()
        }
      }
      await yieldToEventLoop()
    }
  }
  return out
}
