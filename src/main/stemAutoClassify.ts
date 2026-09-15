// src/main/stemAutoClassify.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'
import { suggestCategoryFromEmbedding } from '@shared/embeddingMatch'
import { suggestCategory } from '@shared/categoryCentroids'
import { toFeatureArray, type StemFeatures } from '@shared/stemFeatures'
import { getConfirmedEmbeddings } from './embeddingMatch'
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import { getAllAutoCategorizedStemCIDs, upsertStemAutoCategory } from './stemAutoCategoryStore'

// How many stems ONE call classifies, per data source, before returning --
// bounds a single call's own cost so the scheduler driving this (see
// stemAutoClassifyScheduler.ts) can check in between calls rather than
// this function ever running unbounded.
const BATCH_SIZE = 200

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// Real bug, found live (root cause of a "stuck" report -- progress frozen
// at a small fraction of a real ~45,000-stem backlog, never advancing
// across repeated checks): the original version of this function always
// took `pendingIds.slice(0, BATCH_SIZE)` -- the SAME leading N ids, in
// stable table order, every single call. Once that leading batch
// contained BATCH_SIZE or more stems that never gets removed from
// "pending" (e.g. a real contiguous run this large is common on the
// embedding axis before it has ANY trained categories -- see the
// `confirmedEmbeddings.length === 0` branch below, which spends zero
// classify attempts on the WHOLE pending set), the slice window can never
// advance past it -- the scheduler ticks every ~1s forever
// (BUSY_DELAY_MS, stemAutoClassifyScheduler.ts, since `remaining` stays
// > 0), but permanently starves every stem past that point in the table,
// no matter how many of them WOULD classify successfully. A random
// sample instead guarantees the whole pending pool gets explored over
// many calls, so a batch of persistently-unclassifiable stems can never
// permanently block classifiable ones elsewhere in the table. Shuffles
// only as many elements as needed (partial Fisher-Yates via swap-to-end),
// not the whole (potentially tens-of-thousands-long) pending array --
// `items` here is only ever a list of bare StemCID strings, never the
// heavy JSON payload, so this stays cheap even at real library scale. */
function pickRandomBatch<T>(items: T[], size: number): T[] {
  if (items.length <= size) return items
  const pool = [...items]
  const picked: T[] = []
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool[idx])
    pool[idx] = pool[pool.length - 1]
    pool.pop()
  }
  return picked
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
 * accurate) -- classified once, a stem is never re-attempted by the
 * OTHER source too. Skips anything already confirmed (StemCategories) for
 * ANY role -- a real human confirmation needs no auto-guess, same
 * cross-role-leakage-avoidance convention discoverCandidates.ts's own
 * (now-retired at query time, but still real) widening sources used.
 *
 * A stem neither classifier can confidently place (both return null) is
 * simply left out of StemAutoCategory rather than marked "tried and
 * failed" -- it'll be re-attempted on a LATER call, which is deliberate
 * (more Tidy Up confirmations over time can make a previously-unplaceable
 * stem classifiable later) at the cost of some repeated work on stems
 * that stay unclassifiable indefinitely. Each call's own batch is a
 * RANDOM sample of the pending pool (pickRandomBatch, below), not always
 * the same leading N in table order -- a real live bug found this way:
 * a deterministic "first N" batch can get permanently stuck retrying the
 * exact same unclassifiable stems forever once they out-number
 * BATCH_SIZE, starving every classifiable stem elsewhere in a real
 * multi-thousand-stem table. Random sampling means the WHOLE pool gets
 * explored across enough calls, so no fixed subset can block the rest
 * indefinitely -- an accepted "eventually consistent, not perfectly
 * efficient" tradeoff, same as elsewhere in this session's own work.
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
 * throws if it ever returns a promise -- so this function now yields
 * ONCE per pass (after its own transaction commits) rather than per row;
 * a single up-to-200-row synchronous stretch of classify math plus one
 * batched write is the same "acceptable cost in one stretch" assumption
 * the old per-row yield threshold already relied on. */
export async function classifyAutoCategoryBatch(
  ownDb: Database.Database
): Promise<ClassifyBatchResult> {
  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )

  let processed = 0
  let remaining = 0

  // --- Embedding pass (preferred) ---
  const alreadyDone = getAllAutoCategorizedStemCIDs(ownDb)
  // StemCID only, not the heavy EmbeddingJSON payload (a 1024-dim float
  // array per row, per embeddingMatch.ts's own doc comment) -- this needs
  // to know the FULL pending id set every call (for pickRandomBatch above
  // and the cross-pass exclusion below), but has no reason to pull and
  // JSON-parse every pending stem's own embedding on every single call,
  // only the ones actually selected for this call's batch (fetched
  // separately, below, bounded to at most BATCH_SIZE).
  const embeddingIdRows = ownDb.prepare(`SELECT StemCID FROM StemEmbeddingCache`).all() as {
    StemCID: string
  }[]
  const pendingEmbeddingIds = embeddingIdRows
    .map((r) => r.StemCID)
    .filter((id) => !confirmedAnyRole.has(id) && !alreadyDone.has(id))

  if (pendingEmbeddingIds.length > 0) {
    const confirmedEmbeddings = getConfirmedEmbeddings(ownDb, 'arrangeRole')
    // Nothing trained yet on this axis -- every call would return null;
    // count these as "remaining" (there's real work waiting, just not
    // doable yet) without spending a single classify call on them.
    if (confirmedEmbeddings.length === 0) {
      remaining += pendingEmbeddingIds.length
    } else {
      const batchIds = pickRandomBatch(pendingEmbeddingIds, BATCH_SIZE)
      remaining += pendingEmbeddingIds.length - batchIds.length
      const now = Date.now()
      const placeholders = batchIds.map(() => '?').join(', ')
      const batchRows = ownDb
        .prepare(
          `SELECT StemCID, EmbeddingJSON FROM StemEmbeddingCache WHERE StemCID IN (${placeholders})`
        )
        .all(...batchIds) as { StemCID: string; EmbeddingJSON: string }[]
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
  // Re-read "already done" -- the embedding pass above may just have
  // classified some of these; the feature pass must not re-attempt (or
  // downgrade via the less-accurate centroid classifier) a stem the
  // embedding pass already confidently placed.
  const alreadyDoneAfterEmbedding =
    processed > 0 ? getAllAutoCategorizedStemCIDs(ownDb) : alreadyDone
  // Real bug caught in review before this shipped: excluding only
  // alreadyDoneAfterEmbedding (what got WRITTEN this call) isn't enough --
  // a stem past index BATCH_SIZE in pendingEmbedding is deferred, not
  // written, so without this it would fall through to the centroid pass
  // in this SAME call and get permanently locked in under the
  // less-accurate classifier the moment it's written. This is the normal
  // case, not an edge case, the first time this runs against a real
  // multi-thousand-stem backlog. Every stem with a pending embedding is
  // reserved for the embedding pass exclusively (this call or a later
  // one) -- never falls through to centroid -- matching this function's
  // own "preferred over centroid when a stem has both, never re-attempted
  // by the other source" invariant, above.
  const deferredEmbeddingStemCIDs = new Set(pendingEmbeddingIds)
  // Same "id-only first, heavy payload only for the selected batch" shape
  // as the embedding pass above, for the same reason.
  const featureIdRows = ownDb.prepare(`SELECT StemCID FROM StemFeatureCache`).all() as {
    StemCID: string
  }[]
  const pendingFeatureIds = featureIdRows
    .map((r) => r.StemCID)
    .filter(
      (id) =>
        !confirmedAnyRole.has(id) &&
        !alreadyDoneAfterEmbedding.has(id) &&
        !deferredEmbeddingStemCIDs.has(id)
    )

  if (pendingFeatureIds.length > 0) {
    const centroidStore = loadCategoryCentroidStore()
    const batchIds = pickRandomBatch(pendingFeatureIds, BATCH_SIZE)
    remaining += pendingFeatureIds.length - batchIds.length
    const now = Date.now()
    const placeholders = batchIds.map(() => '?').join(', ')
    const batchRows = ownDb
      .prepare(
        `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
      )
      .all(...batchIds) as { StemCID: string; FeaturesJSON: string }[]
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
