// src/main/stemAutoClassify.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'
import { suggestCategoryFromEmbedding } from '@shared/embeddingMatch'
import { suggestCategory } from '@shared/categoryCentroids'
import { toFeatureArray, type StemFeatures } from '@shared/stemFeatures'
import { getConfirmedEmbeddings } from './embeddingMatch'
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import { upsertStemAutoCategory } from './stemAutoCategoryStore'

// How many stems ONE call classifies, per data source, before returning --
// bounds a single call's own cost so the scheduler driving this (see
// stemAutoClassifyScheduler.ts) can check in between calls rather than
// this function ever running unbounded.
const BATCH_SIZE = 200

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

interface EmbeddingCandidateRow {
  StemCID: string
  EmbeddingJSON: string
}

interface FeatureCandidateRow {
  StemCID: string
  FeaturesJSON: string
}

// Shared by both the count and fetch queries below -- a stem is eligible
// for the EMBEDDING pass when it isn't already human-confirmed (ANY role)
// and isn't already in StemAutoCategory. `e`/`f` is the outer table's own
// alias (StemEmbeddingCache or StemFeatureCache).
const EMBEDDING_ELIGIBILITY_WHERE = (alias: string): string => `
  NOT EXISTS (SELECT 1 FROM StemCategories c WHERE c.StemCID = ${alias}.StemCID AND c.ArrangeRole IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = ${alias}.StemCID)
`

// Same as above, PLUS excludes any stem that has an embedding at all --
// real bug, found live (root cause of a sustained, WORSENING beachball at
// real library scale, ~45,000 stems): the original version of this
// function pulled the FULL id list from StemEmbeddingCache/
// StemFeatureCache/StemAutoCategory into JS on EVERY SINGLE CALL (roughly
// once a second, for as long as a real backlog remained) just to compute
// which stems were eligible and to enforce "prefer embedding over
// centroid, never re-attempt the same stem via both." Reading and
// Set-building tens of thousands of rows a second, forever, is real,
// sustained CPU/syscall cost -- confirmed live (10M+ Unix syscalls within
// minutes of a fresh app launch, multiple recorded app hangs). Rewritten
// so SQLite does the eligibility filtering, random sampling, AND
// bounding directly (NOT EXISTS + ORDER BY RANDOM() + LIMIT) -- JS never
// sees more than BATCH_SIZE StemCIDs, let alone the full pending
// universe, on any single call. Excluding "has any embedding at all"
// (not just "was in this call's own embedding batch") is a clean,
// slightly SIMPLER restatement of the same "embedding preferred, never
// re-attempted by centroid" invariant this function has always had --
// a stem with an embedding waits for the embedding classifier
// exclusively, whether or not THIS call's own embedding pass gets to it.
const FEATURE_ELIGIBILITY_WHERE = (alias: string): string => `
  ${EMBEDDING_ELIGIBILITY_WHERE(alias)}
  AND NOT EXISTS (SELECT 1 FROM StemEmbeddingCache e WHERE e.StemCID = ${alias}.StemCID)
`

function countPendingEmbeddings(ownDb: Database.Database): number {
  return (
    ownDb
      .prepare(
        `SELECT COUNT(*) AS n FROM StemEmbeddingCache e WHERE ${EMBEDDING_ELIGIBILITY_WHERE('e')}`
      )
      .get() as { n: number }
  ).n
}

function fetchPendingEmbeddingBatch(
  ownDb: Database.Database,
  limit: number
): EmbeddingCandidateRow[] {
  return ownDb
    .prepare(
      `SELECT StemCID, EmbeddingJSON FROM StemEmbeddingCache e
       WHERE ${EMBEDDING_ELIGIBILITY_WHERE('e')}
       ORDER BY RANDOM() LIMIT ?`
    )
    .all(limit) as EmbeddingCandidateRow[]
}

function countPendingFeatures(ownDb: Database.Database): number {
  return (
    ownDb
      .prepare(
        `SELECT COUNT(*) AS n FROM StemFeatureCache f WHERE ${FEATURE_ELIGIBILITY_WHERE('f')}`
      )
      .get() as { n: number }
  ).n
}

function fetchPendingFeatureBatch(ownDb: Database.Database, limit: number): FeatureCandidateRow[] {
  return ownDb
    .prepare(
      `SELECT StemCID, FeaturesJSON FROM StemFeatureCache f
       WHERE ${FEATURE_ELIGIBILITY_WHERE('f')}
       ORDER BY RANDOM() LIMIT ?`
    )
    .all(limit) as FeatureCandidateRow[]
}

export interface ClassifyBatchResult {
  /** How many stems this call actually classified and persisted. */
  processed: number
  /** How many eligible-but-unprocessed stems are left (across both
   * sources) after this call -- 0 means "fully caught up, for now" (the
   * scan that feeds this may still be finding new stems to embed/extract
   * features for, so this can go back above 0 later). */
  remaining: number
}

/** One bounded batch of the background "pre-categorize the whole library"
 * pass -- direct request, 2026-09-15 ("why not just do a prelim scan that
 * pre-categorizes the stems... something people can leave running
 * overnight"). Classifies stems that have a cached embedding or feature
 * vector (StemEmbeddingCache / StemFeatureCache, populated by
 * DiscoverLibraryScan.tsx's own renderer-side scan) but aren't yet in
 * StemAutoCategory, and persists the result there -- so
 * discoverCandidates.ts's own candidate query can read a plain, fast
 * SELECT instead of re-running classifiers on every single Discover roll,
 * which is what made rolling itself slow earlier the same day.
 *
 * Prefers the EMBEDDING classifier over the DSP/centroid one when a stem
 * has both (described elsewhere this session as noticeably more
 * accurate) -- a stem with ANY cached embedding is excluded from the
 * feature/centroid pass entirely (FEATURE_ELIGIBILITY_WHERE, above),
 * whether or not the embedding pass actually gets to classify it THIS
 * call. Skips anything already confirmed (StemCategories) for ANY role --
 * a real human confirmation needs no auto-guess, same
 * cross-role-leakage-avoidance convention discoverCandidates.ts's own
 * (now-retired at query time, but still real) widening sources used.
 *
 * A stem neither classifier can confidently place (both return null) is
 * simply left out of StemAutoCategory rather than marked "tried and
 * failed" -- it'll be re-attempted on a LATER call, which is deliberate
 * (more Tidy Up confirmations over time can make a previously-unplaceable
 * stem classifiable later) at the cost of some repeated work on stems
 * that stay unclassifiable indefinitely. Each call's own batch is a
 * RANDOM sample of the pending pool (`ORDER BY RANDOM() LIMIT`, done by
 * SQLite directly), not a deterministic "first N" -- a real live bug
 * found this way: a deterministic batch can get permanently stuck
 * retrying the exact same unclassifiable stems forever once they
 * out-number BATCH_SIZE, starving every classifiable stem elsewhere in a
 * real multi-thousand-stem table.
 *
 * Every eligibility/random/bound decision happens IN SQL (NOT EXISTS +
 * ORDER BY RANDOM() + LIMIT) -- JS never materializes the full pending id
 * universe, only ever the >= BATCH_SIZE rows actually selected for this
 * call. A real, live perf bug this specifically fixes: the original
 * version of this function read every row of StemEmbeddingCache/
 * StemFeatureCache/StemAutoCategory into a JS array and built Sets from
 * them on EVERY call, once a second, for as long as a real backlog
 * remained -- tens of thousands of row reads a second, confirmed live via
 * 10M+ Unix syscalls within minutes of a fresh launch and multiple
 * recorded app hangs.
 *
 * `.all()`, never `.iterate()` -- same "never leave a SQLite statement
 * open across an await" discipline as every other bulk read added this
 * session, after the real "database connection is busy" crash it fixed.
 *
 * Each pass's own writes run inside ONE `ownDb.transaction(...)` call --
 * real bug, found live (root cause of a sustained, WORSENING beachball
 * once there was a real multi-thousand-stem backlog to work through):
 * writing each classified stem via its own separate
 * `upsertStemAutoCategory` call, with no explicit transaction, means
 * better-sqlite3/SQLite auto-commits (and fsyncs) EVERY SINGLE INSERT
 * individually -- up to BATCH_SIZE (200) of those, once per call, roughly
 * once a second for as long as a real backlog remains, is hundreds of
 * individual disk syncs a second. Batching them into one transaction per
 * pass (one commit for up to 200 writes, not 200) is the same pattern
 * this codebase already uses elsewhere for bulk writes (riffLibrarySync.ts).
 * A transaction callback must stay fully synchronous -- better-sqlite3
 * throws if it ever returns a promise -- so this function yields ONCE per
 * pass (after its own transaction commits) rather than per row; a single
 * up-to-200-row synchronous stretch of classify math plus one batched
 * write is an acceptable cost in one stretch, the same assumption the
 * old per-row yield threshold always relied on. */
export async function classifyAutoCategoryBatch(
  ownDb: Database.Database
): Promise<ClassifyBatchResult> {
  let processed = 0
  let remaining = 0

  // --- Embedding pass (preferred) ---
  const pendingEmbeddingCount = countPendingEmbeddings(ownDb)
  if (pendingEmbeddingCount > 0) {
    const confirmedEmbeddings = getConfirmedEmbeddings(ownDb, 'arrangeRole')
    // Nothing trained yet on this axis -- every call would return null;
    // count these as "remaining" (there's real work waiting, just not
    // doable yet) without spending a single classify call on them.
    if (confirmedEmbeddings.length === 0) {
      remaining += pendingEmbeddingCount
    } else {
      const batchRows = fetchPendingEmbeddingBatch(ownDb, BATCH_SIZE)
      remaining += Math.max(0, pendingEmbeddingCount - batchRows.length)
      const now = Date.now()
      processed += ownDb.transaction((rows: typeof batchRows) => {
        let count = 0
        for (const row of rows) {
          try {
            const embedding = JSON.parse(row.EmbeddingJSON) as number[]
            const guessed = suggestCategoryFromEmbedding(confirmedEmbeddings, embedding)
            if (guessed) {
              upsertStemAutoCategory(ownDb, row.StemCID, guessed as ArrangeRole, 'embedding', now)
              count += 1
            }
          } catch {
            // Corrupted row -- skip, same defensive handling this
            // table's own readers elsewhere already use.
          }
        }
        return count
      })(batchRows)
      await yieldToEventLoop()
    }
  }

  // --- Feature/centroid pass (fallback) ---
  const pendingFeatureCount = countPendingFeatures(ownDb)
  if (pendingFeatureCount > 0) {
    const centroidStore = loadCategoryCentroidStore()
    const batchRows = fetchPendingFeatureBatch(ownDb, BATCH_SIZE)
    remaining += Math.max(0, pendingFeatureCount - batchRows.length)
    const now = Date.now()
    processed += ownDb.transaction((rows: typeof batchRows) => {
      let count = 0
      for (const row of rows) {
        try {
          const features = JSON.parse(row.FeaturesJSON) as StemFeatures
          const guessed = suggestCategory(centroidStore, 'arrangeRole', toFeatureArray(features))
          if (guessed) {
            upsertStemAutoCategory(ownDb, row.StemCID, guessed as ArrangeRole, 'centroid', now)
            count += 1
          }
        } catch {
          // Corrupted row -- skip.
        }
      }
      return count
    })(batchRows)
    await yieldToEventLoop()
  }

  return { processed, remaining }
}
