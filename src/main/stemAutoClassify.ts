// src/main/stemAutoClassify.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'
import { suggestCategoryFromEmbedding } from '@shared/embeddingMatch'
import { suggestCategory } from '@shared/categoryCentroids'
import { toFeatureArray, type StemFeatures } from '@shared/stemFeatures'
import { getConfirmedEmbeddings } from './embeddingMatch'
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import { getAllAutoCategorizedStemCIDs, upsertStemAutoCategory } from './stemAutoCategoryStore'

// Same yield discipline as every classify loop added earlier the same day
// (discoverCandidates.ts's own CLASSIFY_YIELD_EVERY) -- real per-row
// classification work (cosine similarity / centroid distance), not free.
const YIELD_EVERY = 200
// How many stems ONE call classifies, per data source, before returning --
// bounds a single call's own cost so the scheduler driving this (see
// stemAutoClassifyScheduler.ts) can check in between calls rather than
// this function ever running unbounded.
const BATCH_SIZE = 200

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
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
 * that stay unclassifiable indefinitely. Accepted the same way this
 * session already accepted comparable "eventually consistent, not
 * perfectly efficient" tradeoffs elsewhere.
 *
 * `.all()`, never `.iterate()` -- same "never leave a SQLite statement
 * open across an await" discipline as every other bulk read added this
 * session, after the real "database connection is busy" crash it fixed. */
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
  let sinceYield = 0

  // --- Embedding pass (preferred) ---
  const alreadyDone = getAllAutoCategorizedStemCIDs(ownDb)
  const embeddingRows = ownDb
    .prepare(`SELECT StemCID, EmbeddingJSON FROM StemEmbeddingCache`)
    .all() as { StemCID: string; EmbeddingJSON: string }[]
  const pendingEmbedding = embeddingRows.filter(
    (r) => !confirmedAnyRole.has(r.StemCID) && !alreadyDone.has(r.StemCID)
  )

  if (pendingEmbedding.length > 0) {
    const confirmedEmbeddings = getConfirmedEmbeddings(ownDb, 'arrangeRole')
    // Nothing trained yet on this axis -- every call would return null;
    // count these as "remaining" (there's real work waiting, just not
    // doable yet) without spending a single classify call on them.
    if (confirmedEmbeddings.length === 0) {
      remaining += pendingEmbedding.length
    } else {
      const batch = pendingEmbedding.slice(0, BATCH_SIZE)
      remaining += pendingEmbedding.length - batch.length
      const now = Date.now()
      for (const row of batch) {
        try {
          const embedding = JSON.parse(row.EmbeddingJSON) as number[]
          const guessed = suggestCategoryFromEmbedding(confirmedEmbeddings, embedding)
          if (guessed) {
            upsertStemAutoCategory(ownDb, row.StemCID, guessed as ArrangeRole, 'embedding', now)
            processed += 1
          }
        } catch {
          // Corrupted row -- skip, same defensive handling this
          // table's own readers elsewhere already use.
        }
        sinceYield += 1
        if (sinceYield >= YIELD_EVERY) {
          sinceYield = 0
          await yieldToEventLoop()
        }
      }
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
  const deferredEmbeddingStemCIDs = new Set(pendingEmbedding.map((r) => r.StemCID))
  const featureRows = ownDb.prepare(`SELECT StemCID, FeaturesJSON FROM StemFeatureCache`).all() as {
    StemCID: string
    FeaturesJSON: string
  }[]
  const pendingFeatures = featureRows.filter(
    (r) =>
      !confirmedAnyRole.has(r.StemCID) &&
      !alreadyDoneAfterEmbedding.has(r.StemCID) &&
      !deferredEmbeddingStemCIDs.has(r.StemCID)
  )

  if (pendingFeatures.length > 0) {
    const centroidStore = loadCategoryCentroidStore()
    const batch = pendingFeatures.slice(0, BATCH_SIZE)
    remaining += pendingFeatures.length - batch.length
    const now = Date.now()
    for (const row of batch) {
      try {
        const features = JSON.parse(row.FeaturesJSON) as StemFeatures
        const guessed = suggestCategory(centroidStore, 'arrangeRole', toFeatureArray(features))
        if (guessed) {
          upsertStemAutoCategory(ownDb, row.StemCID, guessed as ArrangeRole, 'centroid', now)
          processed += 1
        }
      } catch {
        // Corrupted row -- skip.
      }
      sinceYield += 1
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }

  return { processed, remaining }
}
