// src/main/stemAutoClassify.ts
import type Database from 'better-sqlite3'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { createEmbeddingSuggester } from '@shared/embeddingMatch'
import { suggestCategory } from '@shared/categoryCentroids'
import { toFeatureArray, type StemFeatures } from '@shared/stemFeatures'
import { getConfirmedEmbeddings } from './embeddingMatch'
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import { upsertStemAutoCategory } from './stemAutoCategoryStore'
import { countWork } from './workCounters'
import {
  drainAutoClassifyInputRows,
  getAutoClassifyTrainingGeneration
} from './stemAutoClassifyWake'

// How many stems ONE call classifies, per data source, before returning --
// bounds a single call's own cost so the scheduler driving this (see
// stemAutoClassifyScheduler.ts) can check in between calls rather than
// this function ever running unbounded.
const BATCH_SIZE = 200

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// Real live freeze, profiled 2026-09-21 (typing lag + macOS beachball):
// one BATCH_SIZE (200) transaction of embedding classification -- a
// nearest-neighbor search against every confirmed embedding, per row
// (~50ms each on Elling's real library: ~5,850 confirmed x 1024 dims) --
// ran as a single multi-second synchronous block on the main process every
// few seconds, stalling all input to the app. Rows are now committed in
// TIME-budgeted transactions: keep classifying into the current transaction
// until TRANSACTION_BUDGET_MS has passed, then commit and yield. Cheap rows
// (mask short-circuits, centroid guesses) still share one commit -- per-row
// commits are their own real cost, see "writes each pass batch inside a
// single transaction" in the tests -- while an expensive row never holds
// the thread much past one budget. Rows are a plain array (already
// .all()-fetched), never an iterator held across the await.
const TRANSACTION_BUDGET_MS = 16

async function classifyInYieldingChunks<Row>(
  db: Database.Database,
  rows: Row[],
  classifyRow: (row: Row) => boolean
): Promise<number> {
  let count = 0
  let index = 0
  while (index < rows.length) {
    count += db.transaction(() => {
      const start = performance.now()
      let n = 0
      do {
        if (classifyRow(rows[index])) n += 1
        index += 1
      } while (index < rows.length && performance.now() - start < TRANSACTION_BUDGET_MS)
      return n
    })()
    await yieldToEventLoop()
  }
  return count
}

// Real live freeze, profiled 2026-09-21 (typing lag + macOS beachball):
// every call (one per BUSY_DELAY_MS, 3s) re-read and JSON-parsed EVERY
// confirmed embedding -- ~5,850 x 1024 floats on Elling's real library,
// 100+ MB of JSON -- in one synchronous block, then prepared it again.
// That set only changes when a stem is confirmed (or gains an embedding),
// which this batch loop never does itself, so it's prepared once and
// reused until a cheap fingerprint query says otherwise. Keyed by db
// connection (WeakMap) so separate dbs -- e.g. each test's fresh in-memory
// one -- never share an entry.
interface PreparedConfirmed {
  fingerprint: string
  embeddingAxisTrained: boolean
  suggestFromEmbedding: (embedding: number[]) => string | null
}
const preparedConfirmedByDb = new WeakMap<Database.Database, PreparedConfirmed>()

function confirmedEmbeddingsFingerprint(db: Database.Database): string {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(c.UpdatedAt) AS latest
       FROM StemCategories c JOIN StemEmbeddingCache e ON e.StemCID = c.StemCID
       WHERE c.ArrangeRole IS NOT NULL`
    )
    .get() as { n: number; latest: number | null }
  // Deliberately NOT MAX(e.ExtractedAt): that column sits after the ~20KB
  // EmbeddingJSON blob, so reading it walked every blob's overflow pages
  // (~100ms). Count + latest confirmation catches every real change (a new
  // confirmation, a changed role, a confirmed stem gaining an embedding);
  // only a re-extraction of an ALREADY-confirmed stem's embedding goes
  // unseen until the next confirmation, an acceptable staleness.
  return `${row.n}:${row.latest}`
}

function getPreparedConfirmedEmbeddings(db: Database.Database): PreparedConfirmed {
  const fingerprint = confirmedEmbeddingsFingerprint(db)
  const cached = preparedConfirmedByDb.get(db)
  if (cached && cached.fingerprint === fingerprint) return cached
  const confirmed = getConfirmedEmbeddings(db, 'arrangeRole')
  const prepared: PreparedConfirmed = {
    fingerprint,
    embeddingAxisTrained: confirmed.length > 0,
    suggestFromEmbedding: createEmbeddingSuggester(confirmed)
  }
  preparedConfirmedByDb.set(db, prepared)
  return prepared
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
// `embeddingAxisTrained` in getPreparedConfirmedEmbeddings). DiscoverLibraryScan.tsx's
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

// Rows per keyset page when (re)building a pending list -- ids only, so a
// page is a few hundred KB at most; the build yields between pages.
const PENDING_BUILD_PAGE_SIZE = 5000

/** Every eligible StemCID in `table`, in StemCID order, read as keyset
 * pages (ids only, never a blob) with a yield between pages. `.all()` per
 * page -- never a statement held open across the yield. */
async function eligibleStemCIDs(
  ownDb: Database.Database,
  table: 'StemEmbeddingCache' | 'StemFeatureCache',
  where: string
): Promise<string[]> {
  const statement = ownDb.prepare(
    `SELECT t.StemCID AS StemCID FROM ${table} t
     WHERE t.StemCID > ? AND ${where}
     ORDER BY t.StemCID LIMIT ?`
  )
  const out: string[] = []
  let after = ''
  for (;;) {
    countWork(`sql:auto-classify.pending-build.${table}`)
    const page = statement.all(after, PENDING_BUILD_PAGE_SIZE) as { StemCID: string }[]
    for (const row of page) out.push(row.StemCID)
    if (page.length < PENDING_BUILD_PAGE_SIZE) break
    after = page[page.length - 1].StemCID
    await yieldToEventLoop()
  }
  return out
}

function shuffleInPlace(ids: string[]): void {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = ids[i]
    ids[i] = ids[j]
    ids[j] = tmp
  }
}

/** One pass's pending ids: shuffled, consumed from the end. `members`
 * mirrors `ids` so a noted row already waiting isn't queued twice. */
interface PendingList {
  ids: string[]
  members: Set<string>
}

function pendingListOf(ids: string[]): PendingList {
  shuffleInPlace(ids)
  return { ids, members: new Set(ids) }
}

/** Adds `stemCID` at a uniformly random position among the ids still
 * waiting -- keeps the list a random order, same as a fresh shuffle. */
function addPending(list: PendingList, stemCID: string): void {
  if (list.members.has(stemCID)) return
  list.members.add(stemCID)
  list.ids.push(stemCID)
  const j = Math.floor(Math.random() * list.ids.length)
  const last = list.ids.length - 1
  const tmp = list.ids[last]
  list.ids[last] = list.ids[j]
  list.ids[j] = tmp
}

function takePending(list: PendingList, n: number): string[] {
  const taken = list.ids.splice(Math.max(0, list.ids.length - n))
  for (const id of taken) list.members.delete(id)
  return taken
}

/** Background efficiency B4: the classifier's own pending lists, built once
 * from the eligibility queries and consumed a batch at a time -- instead of
 * a COUNT(*) plus an `ORDER BY RANDOM()` over the whole eligible set on
 * every batch. Rebuilt when the training it was built against changed
 * (confirmed-embedding fingerprint, or a confirmation/centroid retrain
 * noted via stemAutoClassifyWake.ts), or when both lists are empty and no
 * new rows were noted (the scheduler's long safety wake, or a caller that
 * wrote rows without going through the stores). New embedding/feature rows
 * noted by the cache stores join the lists directly. An id's eligibility is
 * re-checked when its batch is fetched, so a list entry that has since been
 * confirmed or classified by another source is simply dropped. */
interface PendingState {
  fingerprint: string
  trainingGeneration: number
  embedding: PendingList
  feature: PendingList
}
const pendingByDb = new WeakMap<Database.Database, PendingState>()

async function getPendingState(
  ownDb: Database.Database,
  prepared: PreparedConfirmed
): Promise<PendingState> {
  const state = pendingByDb.get(ownDb)
  const added = drainAutoClassifyInputRows(ownDb)
  const generation = getAutoClassifyTrainingGeneration()
  const exhausted =
    state !== undefined &&
    state.embedding.ids.length === 0 &&
    state.feature.ids.length === 0 &&
    added.embedding.length === 0 &&
    added.feature.length === 0
  if (
    state &&
    !exhausted &&
    state.fingerprint === prepared.fingerprint &&
    state.trainingGeneration === generation
  ) {
    for (const id of added.embedding) addPending(state.embedding, id)
    for (const id of added.feature) addPending(state.feature, id)
    return state
  }
  const embedding = await eligibleStemCIDs(ownDb, 'StemEmbeddingCache', BASE_ELIGIBILITY_WHERE('t'))
  const feature = await eligibleStemCIDs(
    ownDb,
    'StemFeatureCache',
    featureEligibilityWhere('t', prepared.embeddingAxisTrained)
  )
  const rebuilt: PendingState = {
    fingerprint: prepared.fingerprint,
    trainingGeneration: generation,
    embedding: pendingListOf(embedding),
    feature: pendingListOf(feature)
  }
  pendingByDb.set(ownDb, rebuilt)
  return rebuilt
}

function inPlaceholders(ids: string[]): string {
  return ids.map(() => '?').join(', ')
}

/** Blobs for one batch of pending ids, re-checking eligibility (the list
 * may predate a confirmation or another source's write). */
function fetchPendingEmbeddingRows(
  ownDb: Database.Database,
  ids: string[]
): EmbeddingCandidateRow[] {
  if (ids.length === 0) return []
  countWork('sql:auto-classify.fetch-embeddings')
  return ownDb
    .prepare(
      `SELECT e.StemCID AS StemCID, e.EmbeddingJSON AS EmbeddingJSON FROM StemEmbeddingCache e
       WHERE e.StemCID IN (${inPlaceholders(ids)}) AND ${BASE_ELIGIBILITY_WHERE('e')}`
    )
    .all(...ids) as EmbeddingCandidateRow[]
}

function fetchPendingFeatureRows(
  ownDb: Database.Database,
  ids: string[],
  embeddingAxisTrained: boolean
): FeatureCandidateRow[] {
  if (ids.length === 0) return []
  countWork('sql:auto-classify.fetch-features')
  return ownDb
    .prepare(
      `SELECT f.StemCID AS StemCID, f.FeaturesJSON AS FeaturesJSON FROM StemFeatureCache f
       WHERE f.StemCID IN (${inPlaceholders(ids)})
       AND ${featureEligibilityWhere('f', embeddingAxisTrained)}`
    )
    .all(...ids) as FeatureCandidateRow[]
}

export interface ClassifyBatchResult {
  /** How many stems this call actually classified and persisted. */
  processed: number
  /** How many pending ids are left (across both sources) after this call
   * -- 0 means "fully caught up, for now": the scheduler sleeps until a
   * wake signal (new embedding/feature rows, a confirmation -- see
   * stemAutoClassifyWake.ts) or its safety interval. */
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
 * that stay unclassifiable indefinitely -- re-attempted once the training
 * changes (a confirmation or centroid retrain rebuilds the pending lists,
 * see PendingState) or at the scheduler's long safety interval, rather
 * than on every batch as before B4 (the answer can't change until the
 * training does). Each call's batch is taken from a SHUFFLED pending list,
 * not a deterministic "first N" -- a real live bug found this way: a
 * deterministic batch can get permanently stuck retrying the exact same
 * unclassifiable stems forever once they out-number BATCH_SIZE, starving
 * every classifiable stem elsewhere in a real multi-thousand-stem table.
 * The list is consumed through to the end before it's rebuilt, so every
 * eligible stem gets its turn.
 *
 * Eligibility is decided IN SQL (NOT EXISTS) both when the pending list is
 * built (ids only, keyset pages with yields -- background efficiency B4:
 * once per rebuild, not a COUNT(*) + `ORDER BY RANDOM()` per batch) and
 * again for each batch's own <= BATCH_SIZE ids when their blobs are read.
 * A real, live perf bug this specifically avoids: the original version of
 * this function read every row of StemEmbeddingCache/StemFeatureCache/
 * StemAutoCategory (blobs included) into a JS array and built Sets from
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

  // Computed ONCE per call, shared by both passes below -- the feature
  // pass's own eligibility depends on whether the embedding axis is
  // trained (see featureEligibilityWhere's own doc comment), so both
  // passes must agree on the same answer within one call.
  const prepared = getPreparedConfirmedEmbeddings(ownDb)
  const { embeddingAxisTrained, suggestFromEmbedding } = prepared
  const pending = await getPendingState(ownDb, prepared)

  // --- Embedding pass (preferred) ---
  if (pending.embedding.ids.length > 0) {
    // Fetched regardless of embeddingAxisTrained now (real change,
    // 2026-09-18): the instrument-mask short-circuit below needs to see
    // each row's own StemCID to check its mask, so there's no way to
    // "count these as remaining without spending a call on them" the way
    // an untrained axis alone used to allow -- a mask-resolvable stem must
    // still be classified even while the embedding axis itself has never
    // trained. `remaining` below only ever reflects ids not yet taken
    // from the pending lists; a fetched row left unresolved (no mask, axis
    // untrained) stays eligible for the next rebuild, same accepted cost
    // as an ambiguous embedding guess (see "leaves an unclassifiable stem
    // out of StemAutoCategory", above).
    const batchRows = fetchPendingEmbeddingRows(ownDb, takePending(pending.embedding, BATCH_SIZE))
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID)
    )
    const now = Date.now()
    processed += await classifyInYieldingChunks(ownDb, batchRows, (row) => {
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
        return true
      }
      // Nothing trained yet on this axis -- every call would return
      // null; leave it pending rather than spending a classify call on
      // it.
      if (!embeddingAxisTrained) return false
      try {
        const embedding = JSON.parse(row.EmbeddingJSON) as number[]
        const guessed = suggestFromEmbedding(embedding)
        if (guessed) {
          upsertStemAutoCategory(ownDb, row.StemCID, guessed as ArrangeRole, 'embedding', now)
          return true
        }
      } catch {
        // Corrupted row -- skip, same defensive handling this
        // table's own readers elsewhere already use.
      }
      return false
    })
  }

  // --- Feature/centroid pass (fallback) ---
  if (pending.feature.ids.length > 0) {
    const centroidStore = loadCategoryCentroidStore()
    const batchRows = fetchPendingFeatureRows(
      ownDb,
      takePending(pending.feature, BATCH_SIZE),
      embeddingAxisTrained
    )
    // Same instrument-mask short-circuit as the embedding pass above --
    // see reliableMaskSoundType's own doc comment for why.
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID)
    )
    const now = Date.now()
    processed += await classifyInYieldingChunks(ownDb, batchRows, (row) => {
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
        return true
      }
      try {
        const features = JSON.parse(row.FeaturesJSON) as StemFeatures
        const guessed = suggestCategory(centroidStore, 'arrangeRole', toFeatureArray(features))
        if (guessed) {
          upsertStemAutoCategory(ownDb, row.StemCID, guessed as ArrangeRole, 'centroid', now)
          return true
        }
      } catch {
        // Corrupted row -- skip.
      }
      return false
    })
  }

  // Ids still waiting in this call's pending lists -- 0 means caught up
  // until a wake signal (stemAutoClassifyWake.ts) or the scheduler's
  // safety interval.
  const remaining = pending.embedding.ids.length + pending.feature.ids.length
  return { processed, remaining }
}
