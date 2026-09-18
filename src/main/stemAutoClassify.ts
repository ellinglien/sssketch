// src/main/stemAutoClassify.ts
import type Database from 'better-sqlite3'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
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

// Real finding, 2026-09-18: a direct query against Elling's real library
// showed 5,462 of 20,176 embedding-classified 'drums' stems were mask-
// tagged 'notes'/'bass'/other, not drums at all (confirmed live with a
// screenshot: a 'notes'-masked stem sitting in the drums slot). Direct
// correction: "audio in stems can indeed be drums though, so no...
// otherwise we can rely on the endlesss categories easily" -- audioIn is a
// catch-all for "recorded via live input" that genuinely can be anything,
// not a real category by itself, but drums/notes/bass are real, reliable
// performer-set ground truth (the same reasoning instrumentMaskCentroidBackfill.ts
// already trusts enough to skip classification for drums/bass entirely).
// Follow-up direct request: lean into this cheap, reliable signal over the
// expensive audio-similarity search wherever it meaningfully cuts
// processing cost, even at the expense of some precision -- "computers
// aren't always good at [finding the perfect match]... if it means
// trimming the processing time a lot we can go that way."
function reliableMaskSoundType(instrument: number): 'drums' | 'notes' | 'bass' | null {
  const soundType = instrumentMaskToSoundType(instrument)
  return soundType === 'drums' || soundType === 'notes' || soundType === 'bass' ? soundType : null
}

/** Looks up each StemCID's own Instrument bitmask by checking `dbs` in
 * order, stopping early once every StemCID asked for has been found --
 * real-world shape: a stem's own "Stems" row can live in a DIFFERENT db
 * than the one its cached embedding/features live in (StemEmbeddingCache/
 * StemFeatureCache are sssketch-exclusive, ownDb-only, but the stem itself
 * may belong to a jam synced from an external, read-only LORE archive).
 * Bounded to exactly the StemCIDs asked for (a plain primary-key
 * `IN (...)` lookup per db, up to BATCH_SIZE=200 at a time) rather than a
 * full table scan -- cheap even against a huge external archive. */
function lookupInstrumentMasks(dbs: Database.Database[], stemCIDs: string[]): Map<string, number> {
  const found = new Map<string, number>()
  if (stemCIDs.length === 0) return found
  const remaining = new Set(stemCIDs)
  for (const db of dbs) {
    if (remaining.size === 0) break
    const placeholders = [...remaining].map(() => '?').join(',')
    let rows: { StemCID: string; Instrument: number | null }[]
    try {
      rows = db
        .prepare(`SELECT StemCID, Instrument FROM Stems WHERE StemCID IN (${placeholders})`)
        .all(...remaining) as { StemCID: string; Instrument: number | null }[]
    } catch {
      continue
    }
    for (const row of rows) {
      if (row.Instrument === null) continue
      found.set(row.StemCID, row.Instrument)
      remaining.delete(row.StemCID)
    }
  }
  return found
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
// for either pass when it isn't already human-confirmed (ANY role) and
// isn't already in StemAutoCategory. `e`/`f` is the outer table's own
// alias (StemEmbeddingCache or StemFeatureCache).
const BASE_ELIGIBILITY_WHERE = (alias: string): string => `
  NOT EXISTS (SELECT 1 FROM StemCategories c WHERE c.StemCID = ${alias}.StemCID AND c.ArrangeRole IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = ${alias}.StemCID)
`

// Same as above, PLUS excludes any stem that has an embedding at all --
// ONLY when `embeddingAxisTrained` is true. Real bug, found live: a stem
// with ANY cached embedding used to be excluded from the centroid pass
// UNCONDITIONALLY, even while the embedding axis had never been trained
// (fewer than 3 confirmed+embedded samples in 2+ roles -- see
// `confirmedEmbeddings.length === 0` below). DiscoverLibraryScan.tsx's
// own renderer-side extraction embeds AND extracts features for nearly
// every stem, so almost the WHOLE backlog has an embedding -- with no
// centroid fallback while untrained, this meant classification could
// climb for a while (centroid catching feature-only stems while
// extraction was still catching up) and then hit a hard, permanent wall
// the moment extraction caught up and nearly everything had an embedding
// too: confirmed live (progress frozen at "21766/45057" across multiple
// full app restarts and a consent toggle, with zero errors logged --
// the code was working exactly as written, just permanently reserving
// almost the entire backlog for a classifier that may never train).
// `embeddingAxisTrained` is passed in (not re-derived here) so both the
// count and fetch queries for one call agree on the same answer.
const featureEligibilityWhere = (alias: string, embeddingAxisTrained: boolean): string =>
  embeddingAxisTrained
    ? `${BASE_ELIGIBILITY_WHERE(alias)}
       AND NOT EXISTS (SELECT 1 FROM StemEmbeddingCache e WHERE e.StemCID = ${alias}.StemCID)`
    : BASE_ELIGIBILITY_WHERE(alias)

function countPendingEmbeddings(ownDb: Database.Database): number {
  return (
    ownDb
      .prepare(
        `SELECT COUNT(*) AS n FROM StemEmbeddingCache e WHERE ${BASE_ELIGIBILITY_WHERE('e')}`
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
       WHERE ${BASE_ELIGIBILITY_WHERE('e')}
       ORDER BY RANDOM() LIMIT ?`
    )
    .all(limit) as EmbeddingCandidateRow[]
}

function countPendingFeatures(ownDb: Database.Database, embeddingAxisTrained: boolean): number {
  return (
    ownDb
      .prepare(
        `SELECT COUNT(*) AS n FROM StemFeatureCache f WHERE ${featureEligibilityWhere('f', embeddingAxisTrained)}`
      )
      .get() as { n: number }
  ).n
}

function fetchPendingFeatureBatch(
  ownDb: Database.Database,
  limit: number,
  embeddingAxisTrained: boolean
): FeatureCandidateRow[] {
  return ownDb
    .prepare(
      `SELECT StemCID, FeaturesJSON FROM StemFeatureCache f
       WHERE ${featureEligibilityWhere('f', embeddingAxisTrained)}
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
 * has both AND the embedding axis is actually trained (described
 * elsewhere this session as noticeably more accurate) -- a stem with ANY
 * cached embedding is excluded from the feature/centroid pass
 * (featureEligibilityWhere, above), whether or not the embedding pass
 * actually gets to classify it THIS call. Real bug, found live: that
 * exclusion used to apply UNCONDITIONALLY, even while the embedding axis
 * had never been trained -- since extraction embeds nearly every stem,
 * that meant almost the entire backlog got permanently reserved for a
 * classifier that might never train, with no fallback (confirmed live:
 * progress frozen at "21766/45057" across multiple app restarts, zero
 * errors -- the code was working exactly as written). The exclusion is
 * now conditional on `embeddingAxisTrained`: an untrained axis means the
 * embedding classifier could never help those stems ANYWAY, so they fall
 * through to the centroid pass instead of waiting forever. Skips
 * anything already confirmed (StemCategories) for ANY role -- a real
 * human confirmation needs no auto-guess, same cross-role-leakage-
 * avoidance convention discoverCandidates.ts's own (now-retired at query
 * time, but still real) widening sources used.
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
  ownDb: Database.Database,
  // Every db that might hold a candidate stem's own "Stems" row (its
  // Instrument mask) -- defaults to [ownDb] for callers that only ever
  // classify stems from ownDb's own jams; the real production call site
  // (stemAutoClassifyScheduler.ts) passes candidateDbsForRiff() so the
  // mask short-circuit below also covers stems synced from an external
  // LORE archive.
  stemDbs: Database.Database[] = [ownDb]
): Promise<ClassifyBatchResult> {
  let processed = 0
  let remaining = 0

  // Computed ONCE per call, shared by both passes below -- the feature
  // pass's own eligibility depends on whether the embedding axis is
  // trained (see featureEligibilityWhere's own doc comment), so both
  // passes must agree on the same answer within one call.
  const confirmedEmbeddings = getConfirmedEmbeddings(ownDb, 'arrangeRole')
  const embeddingAxisTrained = confirmedEmbeddings.length > 0

  // --- Embedding pass (preferred) ---
  const pendingEmbeddingCount = countPendingEmbeddings(ownDb)
  if (pendingEmbeddingCount > 0) {
    // Fetched regardless of embeddingAxisTrained now (real change,
    // 2026-09-18): the instrument-mask short-circuit below needs to see
    // each row's own StemCID to check its mask, so there's no way to
    // "count these as remaining without spending a call on them" the way
    // an untrained axis alone used to allow -- a mask-resolvable stem must
    // still be classified even while the embedding axis itself has never
    // trained. `remaining` below only ever reflects rows past BATCH_SIZE
    // that weren't fetched at all this call, same as every other pass;
    // a fetched row left unresolved (no mask, axis untrained) simply stays
    // eligible for a later call, same accepted cost as an ambiguous
    // embedding guess (see "leaves an unclassifiable stem out of
    // StemAutoCategory", above).
    const batchRows = fetchPendingEmbeddingBatch(ownDb, BATCH_SIZE)
    remaining += Math.max(0, pendingEmbeddingCount - batchRows.length)
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID)
    )
    const now = Date.now()
    processed += ownDb.transaction((rows: typeof batchRows) => {
      let count = 0
      for (const row of rows) {
        const instrument = masks.get(row.StemCID)
        const reliable = instrument !== undefined ? reliableMaskSoundType(instrument) : null
        if (reliable) {
          upsertStemAutoCategory(
            ownDb,
            row.StemCID,
            SOUND_TYPE_TO_ARRANGE_ROLE[reliable],
            'instrumentMask',
            now
          )
          count += 1
          continue
        }
        // Nothing trained yet on this axis -- every call would return
        // null; leave it pending rather than spending a classify call on
        // it.
        if (!embeddingAxisTrained) continue
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

  // --- Feature/centroid pass (fallback) ---
  const pendingFeatureCount = countPendingFeatures(ownDb, embeddingAxisTrained)
  if (pendingFeatureCount > 0) {
    const centroidStore = loadCategoryCentroidStore()
    const batchRows = fetchPendingFeatureBatch(ownDb, BATCH_SIZE, embeddingAxisTrained)
    remaining += Math.max(0, pendingFeatureCount - batchRows.length)
    // Same instrument-mask short-circuit as the embedding pass above --
    // see reliableMaskSoundType's own doc comment for why.
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID)
    )
    const now = Date.now()
    processed += ownDb.transaction((rows: typeof batchRows) => {
      let count = 0
      for (const row of rows) {
        const instrument = masks.get(row.StemCID)
        const reliable = instrument !== undefined ? reliableMaskSoundType(instrument) : null
        if (reliable) {
          upsertStemAutoCategory(
            ownDb,
            row.StemCID,
            SOUND_TYPE_TO_ARRANGE_ROLE[reliable],
            'instrumentMask',
            now
          )
          count += 1
          continue
        }
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
