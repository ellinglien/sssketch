// src/main/discoverLibraryStems.ts
import { existsSync } from 'fs'
import type Database from 'better-sqlite3'
import { resolveStemPath } from './riffLibraryStore'

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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
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
 * real `existsSync`) for the same testability reason as
 * discoverCandidates.ts's own getDiscoverCandidates -- this keeps the test
 * suite free of any real filesystem dependency. */
export async function listLibraryScanTargets(
  jams: JamDbPair[],
  existsFn: (path: string) => boolean = existsSync
): Promise<LibraryScanTarget[]> {
  const seen = new Set<string>()
  const out: LibraryScanTarget[] = []
  let sinceYield = 0

  for (const { jamCID, dbForJam } of jams) {
    let riffRows: RiffStemColumnsRow[]
    try {
      riffRows = dbForJam
        .prepare(
          `SELECT StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                  StemCID_5, StemCID_6, StemCID_7, StemCID_8
           FROM Riffs WHERE OwnerJamCID = ?`
        )
        .all(jamCID) as RiffStemColumnsRow[]
    } catch {
      continue
    }
    for (const riff of riffRows) {
      for (let slot = 1; slot <= 8; slot++) {
        const stemCID = riff[`StemCID_${slot}` as keyof RiffStemColumnsRow]
        if (!stemCID || seen.has(stemCID)) continue
        seen.add(stemCID)
        const path = resolveStemPath(jamCID, stemCID)
        if (existsFn(path)) out.push({ key: stemCID, path })
        sinceYield += 1
        if (sinceYield >= YIELD_EVERY) {
          sinceYield = 0
          await yieldToEventLoop()
        }
      }
    }
  }
  return out
}
