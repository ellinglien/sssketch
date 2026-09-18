// src/main/yamnetZeroShotRetroactiveScan.ts
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { resolveStemPath } from './riffLibraryStore'

// Direct report, 2026-09-18: "just tried to start the app and it appears
// to be hanging .. stuck here for a minute." Root cause: this function
// used to call existsFn synchronously for every eligible row (Elling's
// real library: ~37,000) in one unbroken .filter() call on the Electron
// MAIN process's single JS thread -- the EXACT bug class
// discoverLibraryStems.ts's own listLibraryScanTargets already documents
// a real prior incident for ("clicking 'new project' beachballed for
// ~30s... tens of thousands of synchronous existsSync syscalls in one
// unbroken loop... nothing else could run until the whole enumeration
// finished"). This file copied that function's own injectable-existsFn
// PATTERN (for testability) when the missing-file check was added, but
// not its yielding behavior -- reintroducing the identical freeze this
// codebase already spent real effort fixing once. Same fix: yield back
// to the event loop every YIELD_EVERY stems so queued IPC/UI work can
// interleave instead of piling up behind one multi-second-to-tens-of-
// seconds call.
const YIELD_EVERY = 200

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export interface YamnetZeroShotRetroactiveTarget {
  path: string
}

interface EligibleRow {
  StemCID: string
  OwnerJamCID: string
}

/** Every stem, library-wide, that already has a cached YAMNet embedding
 * (StemEmbeddingCache) but has never had a zero-shot classification
 * attempt recorded (StemYamnetZeroShotAttempted) -- the real, one-time
 * migration gap this whole file exists to close. getOrExtractStemEmbedding
 * (stemEmbeddingCache.ts, renderer) is cache-hit-first: it returns the
 * already-persisted embedding immediately, without ever running
 * extractEmbeddingAndTopClass again -- so any stem embedded before the
 * zero-shot classification code existed would otherwise never get a
 * chance to be classified by it. Direct report, 2026-09-17 ("in discover
 * it wasn't really as accurate honestly"), root-caused to exactly this:
 * StemAutoCategory's 'yamnet-zeroshot' source had zero rows against
 * Elling's real ~37,000-already-embedded-stem library.
 *
 * Also excludes anything already confirmed/auto-categorized by ANY other
 * source -- mirrors isStemEligibleForAutoCategory's own NOT EXISTS pair
 * (stemAutoCategoryStore.ts) -- no point re-decoding a stem whose write
 * would just no-op anyway.
 *
 * Reads from `ownDb` only, joining its own Stems table for OwnerJamCID --
 * StemEmbeddingCache/StemYamnetZeroShotAttempted/StemCategories/
 * StemAutoCategory are all sssketch-exclusive tables that only ever live
 * there (see discoverCandidates.ts's own repeated notes on why an
 * external LORE archive db is never a candidate for these), so a stem
 * with a cached embedding necessarily already has its own Stems row here
 * too -- no cross-db enumeration needed, unlike discoverLibraryStems.ts's
 * own listLibraryScanTargets (which discovers NEW stems from scratch
 * across every jam's own separate db). This function only ever
 * re-visits stems already known here.
 *
 * `existsFn` (defaults to the real existsSync, injectable for the same
 * testability reason as discoverLibraryStems.ts's own listLibraryScanTargets)
 * -- code review, 2026-09-17: an earlier version of this function had no
 * such check at all, silently reintroducing the exact "re-decode the same
 * stem forever" cost this whole migration exists to eliminate, just
 * triggered by a different condition (a moved/repointed LORE root, an
 * evicted local cache, a deleted jam) than the one StemYamnetZeroShotAttempted
 * was built to prevent (an unmapped AudioSet class). A stem whose resolved
 * path doesn't exist on disk right now is filtered out here, at the
 * SOURCE, rather than ever becoming a target that fails at decode time --
 * ensureYamnetZeroShotClassified (stemEmbeddingCache.ts) never marks a
 * stem attempted on failure, so a genuinely missing file would otherwise
 * get re-selected, re-attempted, and re-fail on every future app launch.
 * Not marking it attempted here either (simply excluding it) is
 * deliberate, matching listLibraryScanTargets's own "a missing file is
 * just not a target this pass" convention -- if the file reappears later
 * (re-downloaded, LORE root repointed back), a future pass picks it up
 * naturally. */
export async function listYamnetZeroShotRetroactiveTargets(
  ownDb: Database.Database,
  existsFn: (path: string) => boolean = existsSync
): Promise<YamnetZeroShotRetroactiveTarget[]> {
  const rows = ownDb
    .prepare(
      `SELECT s.StemCID AS StemCID, s.OwnerJamCID AS OwnerJamCID
       FROM StemEmbeddingCache e
       JOIN Stems s ON s.StemCID = e.StemCID
       WHERE NOT EXISTS (
         SELECT 1 FROM StemYamnetZeroShotAttempted t WHERE t.StemCID = e.StemCID
       )
       AND NOT EXISTS (
         SELECT 1 FROM StemCategories c WHERE c.StemCID = e.StemCID AND c.ArrangeRole IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = e.StemCID
       )`
    )
    .all() as EligibleRow[]

  const targets: YamnetZeroShotRetroactiveTarget[] = []
  let sinceYield = 0
  for (const row of rows) {
    const path = resolveStemPath(row.OwnerJamCID, row.StemCID)
    if (existsFn(path)) targets.push({ path })
    sinceYield += 1
    if (sinceYield >= YIELD_EVERY) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }
  return targets
}
