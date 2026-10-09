// src/main/stemAutoClassify.ts
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { createEmbeddingSuggester } from '@shared/embeddingMatch'
import { suggestCategory, type CategoryCentroidStore } from '@shared/categoryCentroids'
import { toFeatureArray, type StemFeatures } from '@shared/stemFeatures'
import { getConfirmedEmbeddings } from './embeddingMatch'
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import {
  forgetStemTried,
  pruneStemsTriedSlice,
  readStemsTriedUnder,
  recordStemTried
} from './stemAutoClassifyTried'
import { upsertStemAutoCategory, type StemAutoCategorySource } from './stemAutoCategoryStore'
import { countWork } from './workCounters'
import { whenTableCountsSettled } from './tableChangeSignal'
import {
  STEM_PRIORITY_FAVOURITE,
  STEM_PRIORITY_OWN,
  STEM_PRIORITY_REST,
  orderByStemPriority,
  stemPriorityRank,
  type StemPrioritySets
} from '@shared/stemPriorityOrder'
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
// Changing this? Bump CLASSIFIER_VERSION (below).
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
export function lookupAutoClassifyInstrumentMasks(
  dbs: Database.Database[],
  stemCIDs: string[],
  instrumentLookup: InstrumentLookupFor | undefined
): Map<string, number> {
  const found = new Map<string, number>()
  if (stemCIDs.length === 0) return found
  const remaining = new Set(stemCIDs)
  for (const db of dbs) {
    if (remaining.size === 0) break
    // The same answer from the rows already in memory, when they're current
    // for this db (background scan audit item 2b): a stem the rows don't
    // have, or have with no mask, goes on to the next db exactly as a
    // missing/NULL SQL row did.
    const inMemory = instrumentLookup?.(db)
    if (inMemory) {
      countWork('auto-classify:mask-from-memory', remaining.size)
      for (const stemCID of [...remaining]) {
        const instrument = inMemory(stemCID)
        if (instrument === null || instrument === undefined) continue
        found.set(stemCID, instrument)
        remaining.delete(stemCID)
      }
      continue
    }
    countWork('sql:auto-classify.mask-lookup')
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

// Kept as a local name throughout the batch implementation; the exported
// name lets the read-only progress snapshot use the exact same lookup and
// null/zero semantics without duplicating them.
const lookupInstrumentMasks = lookupAutoClassifyInstrumentMasks

/** For a db, a StemCID -> Stems.Instrument lookup over rows already in
 * memory (number, null for no mask, undefined for no such stem), or null to
 * ask that db's Stems table. Injected (the scheduler passes
 * discoverCandidates.ts's getInstrumentMaskLookup) so this module doesn't
 * depend on the Discover caches and stays testable on its own. */
export type InstrumentLookupFor = (
  db: Database.Database
) => ((stemCID: string) => number | null | undefined) | null

export interface ClassifyBatchOptions {
  instrumentLookup?: InstrumentLookupFor
  /** Own stems, then favourites, first (stemPriority.ts; 2026-10-06). The
   * pending lists keep their random order within each group. */
  priority?: StemPrioritySets
}

interface EmbeddingCandidateRow {
  StemCID: string
  EmbeddingJSON: string
  /** 1 when the stem has a StemFeatureCache row too (the feature pass's to
   * record while the embedding axis is untrained), else 0. */
  HasFeatures: number
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
 * mirrors `ids` so a noted row already waiting isn't queued twice.
 *
 * With a priority (own stems first, 2026-10-06) the ids are laid out
 * [rest | favourites | own], each segment shuffled, so the end -- taken
 * first -- is own stems; `counts` holds each rank's segment length
 * (indexed by StemPriorityRank). Without one, everything is one segment:
 * the plain shuffle as before. */
interface PendingList {
  ids: string[]
  members: Set<string>
  counts: [number, number, number]
}

const NO_PRIORITY: StemPrioritySets = { own: new Set(), favourites: new Set() }

/** The ids laid out by rank, [rest | favourites | own], each group keeping
 * the order it had. */
function layOut(ids: string[], priority: StemPrioritySets): PendingList {
  // orderByStemPriority gives [own | favourites | rest]: reversed, the end
  // (taken first) is own. Reversing a shuffled group leaves it shuffled.
  const ordered = orderByStemPriority(ids, (id) => id, priority).reverse()
  const counts: [number, number, number] = [0, 0, 0]
  for (const id of ordered) counts[stemPriorityRank(priority, id)] += 1
  return { ids: ordered, members: new Set(ordered), counts }
}

function pendingListOf(ids: string[], priority: StemPrioritySets): PendingList {
  shuffleInPlace(ids)
  return layOut(ids, priority)
}

/** Adds `stemCID` at a uniformly random position within its rank's segment
 * -- keeps each segment a random order, same as a fresh shuffle. */
function addPending(list: PendingList, stemCID: string, priority: StemPrioritySets): void {
  if (list.members.has(stemCID)) return
  list.members.add(stemCID)
  const rank = stemPriorityRank(priority, stemCID)
  const [own, favourites, rest] = list.counts
  const start =
    rank === STEM_PRIORITY_REST ? 0 : rank === STEM_PRIORITY_FAVOURITE ? rest : rest + favourites
  const length =
    rank === STEM_PRIORITY_REST ? rest : rank === STEM_PRIORITY_FAVOURITE ? favourites : own
  list.ids.splice(start + Math.floor(Math.random() * (length + 1)), 0, stemCID)
  list.counts[rank] += 1
}

function takePending(list: PendingList, n: number): string[] {
  const taken = list.ids.splice(Math.max(0, list.ids.length - n))
  for (const id of taken) list.members.delete(id)
  // taken from the end: own first, then favourites, then the rest
  let left = taken.length
  for (const rank of [STEM_PRIORITY_OWN, STEM_PRIORITY_FAVOURITE, STEM_PRIORITY_REST] as const) {
    const fromRank = Math.min(left, list.counts[rank])
    list.counts[rank] -= fromRank
    left -= fromRank
  }
  return taken
}

/** Which priority a list was laid out for. Sizes alone missed a star
 * swapped for another (review of 147dca78), so: stemPriority.ts's version,
 * which moves whenever either set's contents do; a priority without one
 * (hand-made) by an order-free hash of its contents. */
function priorityKeyOf(priority: StemPrioritySets): string {
  const username = (priority as { username?: string | null }).username ?? ''
  const sizes = `${priority.own.size}|${priority.favourites.size}`
  if (priority.version !== undefined) return `${username}|${sizes}|v${priority.version}`
  return `${username}|${sizes}|${membersHash(priority.own)}|${membersHash(priority.favourites)}`
}

/** A sum of each member's FNV-1a hash: the same for the same members in
 * any order. */
function membersHash(set: ReadonlySet<string>): number {
  let sum = 0
  for (const member of set) {
    let h = 0x811c9dc5
    for (let i = 0; i < member.length; i++) h = Math.imul(h ^ member.charCodeAt(i), 0x01000193)
    sum = (sum + (h >>> 0)) >>> 0
  }
  return sum
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
  /** priorityKeyOf the priority the lists are laid out for. */
  priorityKey: string
  embedding: PendingList
  feature: PendingList
}
const pendingByDb = new WeakMap<Database.Database, PendingState>()

/** The classifier's own code, as part of the training a stem is tried under
 * (trainingFingerprintOf): a stem recorded as tried and not placed
 * (StemAutoClassifyTried) is only tried again once its fingerprint moves, so
 * any change that could place a stem the old code couldn't must move it too
 * (review of 0adc41ca, important 2). Bump it for a change to any of:
 * - categoryCentroids.ts: CONFIDENCE_RATIO, MIN_SAMPLES_PER_CATEGORY,
 *   MIN_TRAINED_CATEGORIES_FOR_SUGGESTION, or how suggestCategory measures;
 * - embeddingMatch.ts (the embedding suggester): SIMILARITY_MARGIN,
 *   MIN_SAMPLES_PER_CATEGORY, MIN_CATEGORIES_FOR_SUGGESTION, or how
 *   createEmbeddingSuggester ranks;
 * - reliableMaskSoundType (below), or which source is preferred in
 *   classifyAutoCategoryBatch;
 * - the feature layout: toFeatureArray / StemFeatures (stemFeatures.ts).
 * A bump re-tries the whole residue once (~10 min in the background on
 * Elling's library), so don't bump it for a change that can't move an
 * answer. */
export const CLASSIFIER_VERSION = 1

/** The training a stem is tried under, as it survives a restart
 * (2026-10-07): the confirmed-embedding fingerprint (COUNT:MAX(UpdatedAt))
 * and a hash of the two parts of the centroid store the centroid pass reads
 * (the arrangeRole axis and the global normalizer). A new confirmation or a
 * centroid retrain, in this app or the other one sharing the db, moves it;
 * a restart does not. Replaces the in-memory training generation, which
 * started at 0 every launch. The classifier's code is in it too
 * (CLASSIFIER_VERSION).
 *
 * One change it misses: a re-extracted embedding of an already-confirmed
 * stem (the confirmed fingerprint leaves out ExtractedAt, see
 * confirmedEmbeddingsFingerprint). Folding it in means reading past every
 * embedding blob (~100 ms a batch), and it matters little: a lone
 * re-extraction moves one reference among thousands, and a whole-library
 * re-extraction (a new embedding model) rewrites every unplaced stem's row
 * too, and each such write forgets that stem's record anyway
 * (stemAutoClassifyWake.ts). The next confirmation picks it up.
 *
 * The dev and the packaged app each have their
 * own centroid store, so each tries under its own fingerprint and keeps its
 * own record of the same stem (StemAutoClassifyTried is keyed on both). */
function trainingFingerprintOf(
  prepared: PreparedConfirmed,
  centroidStore: CategoryCentroidStore
): string {
  return `c${CLASSIFIER_VERSION}|${prepared.fingerprint}|${centroidStoreHash(centroidStore)}`
}

/** The persisted tried-ledger key for the classifier as trained right now.
 * Unlike getPreparedConfirmedEmbeddings, this does not parse the confirmed
 * embedding blobs or construct a suggester: the gear-menu progress request
 * needs the identity of the training, never the classifier itself. */
export function currentAutoClassifyTrainingFingerprint(ownDb: Database.Database): string {
  const preparedFingerprint = confirmedEmbeddingsFingerprint(ownDb)
  return `c${CLASSIFIER_VERSION}|${preparedFingerprint}|${centroidStoreHash(loadCategoryCentroidStore())}`
}

/** Per store object: loadCategoryCentroidStore hands back the same object
 * until the file changes, so the sha1 over the store's JSON runs once per
 * save, not once per batch (review of 0adc41ca). */
const centroidHashByStore = new WeakMap<CategoryCentroidStore, string>()

function centroidStoreHash(centroidStore: CategoryCentroidStore): string {
  const cached = centroidHashByStore.get(centroidStore)
  if (cached !== undefined) return cached
  const hash = createHash('sha1')
    .update(JSON.stringify([centroidStore.arrangeRoles, centroidStore.global]))
    .digest('hex')
    .slice(0, 16)
  centroidHashByStore.set(centroidStore, hash)
  return hash
}

/** Ids per mask lookup while filtering a rebuilt list: one IN query per db
 * per chunk (or the in-memory rows), a yield between chunks. */
const TRIED_MASK_CHUNK = 500

/** Background scan audit item 2 (2026-10-05), persisted 2026-10-07: drops
 * the ids already tried under `fingerprint` (StemAutoClassifyTried,
 * stemAutoClassifyTried.ts) whose Instrument mask is still the one they were
 * tried with. Neither classifier can give such a stem a different answer,
 * so a rebuild (the scheduler's 10-minute safety wake, or a launch) leaves
 * it out instead of re-running it. On Elling's library that was the
 * ~20,452-stem residue: ~10 minutes and ~4 minutes of main-process CPU per
 * launch, placing 0, plus a full re-try mid-session whenever any write
 * moved the own db's Stems table (a Shared Feed sync), since the old
 * in-memory record was keyed on the whole table's signal. The per-stem mask
 * replaces that signal: a stem whose mask arrives or changes, in any db, is
 * tried again; a sync that touches other stems changes nothing.
 *
 * `noted` ids (rows a store rewrote, which also forgets their record) are
 * kept whatever the record says. */
async function withoutTried(
  ids: string[],
  triedUnder: Map<string, number | null>,
  noted: string[],
  stemDbs: Database.Database[],
  instrumentLookup: InstrumentLookupFor | undefined
): Promise<string[]> {
  if (triedUnder.size === 0) return ids
  const keep = new Set(noted)
  const toCheck = ids.filter((id) => triedUnder.has(id) && !keep.has(id))
  if (toCheck.length === 0) return ids
  const changed = new Set<string>()
  for (let i = 0; i < toCheck.length; i += TRIED_MASK_CHUNK) {
    const chunk = toCheck.slice(i, i + TRIED_MASK_CHUNK)
    const masks = lookupInstrumentMasks(stemDbs, chunk, instrumentLookup)
    for (const id of chunk) {
      if ((masks.get(id) ?? null) !== triedUnder.get(id)) changed.add(id)
    }
    await yieldToEventLoop()
  }
  const out = ids.filter((id) => !triedUnder.has(id) || keep.has(id) || changed.has(id))
  countWork('auto-classify:rows-skipped-tried', ids.length - out.length)
  if (changed.size > 0) countWork('auto-classify:rows-mask-changed', changed.size)
  return out
}

/** Where the next rebuild's prune of StemAutoClassifyTried starts
 * (pruneStemsTriedSlice): one bounded slice per rebuild sweeps the table. */
const triedPruneCursorByDb = new WeakMap<Database.Database, number>()

async function getPendingState(
  ownDb: Database.Database,
  prepared: PreparedConfirmed,
  fingerprint: string,
  stemDbs: Database.Database[],
  options: ClassifyBatchOptions
): Promise<PendingState> {
  const priority = options.priority ?? NO_PRIORITY
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
    state.fingerprint === fingerprint &&
    state.trainingGeneration === generation
  ) {
    // A new priority (the username reported after the lists were built, a
    // new star): lay the lists out again, no rebuild.
    const priorityKey = priorityKeyOf(priority)
    if (state.priorityKey !== priorityKey) {
      countWork('auto-classify:priority-relayout')
      state.embedding = layOut(state.embedding.ids, priority)
      state.feature = layOut(state.feature.ids, priority)
      state.priorityKey = priorityKey
    }
    for (const id of added.embedding) addPending(state.embedding, id, priority)
    for (const id of added.feature) addPending(state.feature, id, priority)
    return state
  }
  countWork('auto-classify:rebuild')
  const embedding = await eligibleStemCIDs(ownDb, 'StemEmbeddingCache', BASE_ELIGIBILITY_WHERE('t'))
  const feature = await eligibleStemCIDs(
    ownDb,
    'StemFeatureCache',
    featureEligibilityWhere('t', prepared.embeddingAxisTrained)
  )
  countWork('sql:auto-classify.tried-prune')
  triedPruneCursorByDb.set(ownDb, pruneStemsTriedSlice(ownDb, triedPruneCursorByDb.get(ownDb) ?? 0))
  countWork('sql:auto-classify.tried-read')
  const triedUnder = readStemsTriedUnder(ownDb, fingerprint)
  const rebuilt: PendingState = {
    fingerprint,
    trainingGeneration: generation,
    priorityKey: priorityKeyOf(priority),
    embedding: pendingListOf(
      await withoutTried(embedding, triedUnder, added.embedding, stemDbs, options.instrumentLookup),
      priority
    ),
    feature: pendingListOf(
      await withoutTried(feature, triedUnder, added.feature, stemDbs, options.instrumentLookup),
      priority
    )
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
      `SELECT e.StemCID AS StemCID, e.EmbeddingJSON AS EmbeddingJSON,
         EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = e.StemCID) AS HasFeatures
       FROM StemEmbeddingCache e
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
 * see PendingState) or a store rewrites its row, rather than on every
 * batch as before B4 (the answer can't change until the training does),
 * and no longer at the scheduler's safety rebuild or a relaunch either
 * (StemAutoClassifyTried, see withoutTried). Each call's batch is taken from a SHUFFLED pending list,
 * not a deterministic "first N" -- a real live bug found this way: a
 * deterministic batch can get permanently stuck retrying the exact same
 * unclassifiable stems forever once they out-number BATCH_SIZE, starving
 * every classifiable stem elsewhere in a real multi-thousand-stem table.
 * The list is consumed through to the end before it's rebuilt, so every
 * eligible stem gets its turn. With `options.priority` (2026-10-06) the
 * shuffle is per group -- own stems are taken first, then favourites, then
 * the rest (PendingList) -- and a new priority lays the lists out again
 * without a rebuild.
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
  stemDbs: Database.Database[] = [ownDb],
  options: ClassifyBatchOptions = {}
): Promise<ClassifyBatchResult> {
  let processed = 0
  // The mask lookups (instrumentLookup reads the archive's Stems signal):
  // after the startup worker's count, if one is running (tableCountSeed.ts),
  // never a COUNT of its own on the main thread.
  await Promise.all(stemDbs.map((db) => whenTableCountsSettled(db)))

  // Computed ONCE per call, shared by both passes below -- the feature
  // pass's own eligibility depends on whether the embedding axis is
  // trained (see featureEligibilityWhere's own doc comment), so both
  // passes must agree on the same answer within one call.
  const prepared = getPreparedConfirmedEmbeddings(ownDb)
  const { embeddingAxisTrained, suggestFromEmbedding } = prepared
  const centroidStore = loadCategoryCentroidStore()
  const fingerprint = trainingFingerprintOf(prepared, centroidStore)
  const pending = await getPendingState(ownDb, prepared, fingerprint, stemDbs, options)
  const now = Date.now()

  /** One row's outcome, written in the batch's transaction: placed (its
   * StemAutoCategory row, and any old tried record dropped), or not placed
   * (recorded as tried under this training with the mask it has now, so no
   * rebuild -- or launch -- tries it again until either moves), or `skip`
   * (not this pass's to record). */
  function settle(
    stemCID: string,
    mask: number | undefined,
    placed: { role: ArrangeRole; source: StemAutoCategorySource } | null | 'skip'
  ): boolean {
    if (placed === 'skip') return false
    if (placed) {
      upsertStemAutoCategory(ownDb, stemCID, placed.role, placed.source, now)
      forgetStemTried(ownDb, stemCID)
      return true
    }
    recordStemTried(ownDb, stemCID, fingerprint, mask ?? null, now)
    countWork('auto-classify:rows-tried-recorded')
    return false
  }

  // --- Embedding pass (preferred) ---
  if (pending.embedding.ids.length > 0) {
    // Fetched regardless of embeddingAxisTrained now (real change,
    // 2026-09-18): the instrument-mask short-circuit below needs to see
    // each row's own StemCID to check its mask, so there's no way to
    // "count these as remaining without spending a call on them" the way
    // an untrained axis alone used to allow -- a mask-resolvable stem must
    // still be classified even while the embedding axis itself has never
    // trained. `remaining` below only ever reflects ids not yet taken
    // from the pending lists. A row left unplaced is recorded as tried
    // (StemAutoClassifyTried) and taken again once the training moves or
    // its own mask does -- except while the axis is untrained and the stem
    // has a feature row: it is in the feature list too, and that pass
    // records it (recording it here would keep it out of the feature list
    // at the next rebuild). One with no feature row is recorded here, or
    // it'd be fetched again at every rebuild and launch (review of
    // 0adc41ca); a feature row arriving through the store forgets it.
    const taken = takePending(pending.embedding, BATCH_SIZE)
    const batchRows = fetchPendingEmbeddingRows(ownDb, taken)
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID),
      options.instrumentLookup
    )
    processed += await classifyInYieldingChunks(ownDb, batchRows, (row) => {
      const instrument = masks.get(row.StemCID)
      const reliable = instrument !== undefined ? reliableMaskSoundType(instrument) : null
      if (reliable) {
        return settle(row.StemCID, instrument, {
          role: SOUND_TYPE_TO_ARRANGE_ROLE[reliable],
          source: 'instrumentMask'
        })
      }
      // Nothing trained yet on this axis -- every call would return null;
      // leave it to the feature pass rather than spending a classify call,
      // or, with no feature row for that pass, record it as not placed.
      if (!embeddingAxisTrained) {
        return settle(row.StemCID, instrument, row.HasFeatures ? 'skip' : null)
      }
      let guessed: string | null = null
      try {
        guessed = suggestFromEmbedding(JSON.parse(row.EmbeddingJSON) as number[])
      } catch {
        // Corrupted row -- not placed, same defensive handling this
        // table's own readers elsewhere already use. A re-extraction
        // rewrites it through the store, which forgets the record.
      }
      return settle(
        row.StemCID,
        instrument,
        guessed ? { role: guessed as ArrangeRole, source: 'embedding' } : null
      )
    })
  }

  // --- Feature/centroid pass (fallback) ---
  if (pending.feature.ids.length > 0) {
    const taken = takePending(pending.feature, BATCH_SIZE)
    const batchRows = fetchPendingFeatureRows(ownDb, taken, embeddingAxisTrained)
    // Same instrument-mask short-circuit as the embedding pass above --
    // see reliableMaskSoundType's own doc comment for why.
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID),
      options.instrumentLookup
    )
    processed += await classifyInYieldingChunks(ownDb, batchRows, (row) => {
      const instrument = masks.get(row.StemCID)
      const reliable = instrument !== undefined ? reliableMaskSoundType(instrument) : null
      if (reliable) {
        return settle(row.StemCID, instrument, {
          role: SOUND_TYPE_TO_ARRANGE_ROLE[reliable],
          source: 'instrumentMask'
        })
      }
      let guessed: string | null = null
      try {
        const features = JSON.parse(row.FeaturesJSON) as StemFeatures
        guessed = suggestCategory(centroidStore, 'arrangeRole', toFeatureArray(features))
      } catch {
        // Corrupted row -- not placed.
      }
      return settle(
        row.StemCID,
        instrument,
        guessed ? { role: guessed as ArrangeRole, source: 'centroid' } : null
      )
    })
  }

  // Ids still waiting in this call's pending lists -- 0 means caught up
  // until a wake signal (stemAutoClassifyWake.ts) or the scheduler's
  // safety interval.
  const remaining = pending.embedding.ids.length + pending.feature.ids.length
  return { processed, remaining }
}
