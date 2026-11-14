// src/main/stemAutoClassify.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import {
  STEM_CATEGORY_MODEL,
  guessFromProbs,
  predictCategoryProbs,
  type CategoryProbs,
  type StemCategoryModel
} from '@shared/stemCategoryModel'
import { CATEGORY_ROLE } from '@shared/stemCategory'
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
// one BATCH_SIZE (200) transaction of the old nearest-neighbour
// classification (~50ms a row) ran as a single multi-second synchronous
// block on the main process. The model is a dot product, far cheaper, but
// the budget stays as the guard. Rows are now committed in
// TIME-budgeted transactions: keep classifying into the current transaction
// until TRANSACTION_BUDGET_MS has passed, then commit and yield. Cheap rows
// (mask short-circuits, model guesses) still share one commit -- per-row
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
// The notes bit says "melodic", not front or back, so it no longer decides (2026-11-14).
// Changing this? Bump CLASSIFIER_VERSION (below).
function reliableMaskSoundType(instrument: number): 'drums' | 'bass' | null {
  const soundType = instrumentMaskToSoundType(instrument)
  return soundType === 'drums' || soundType === 'bass' ? soundType : null
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
  /** The stem category model (tests inject their own); default the shipped one. */
  model?: StemCategoryModel
}

interface EmbeddingCandidateRow {
  StemCID: string
  EmbeddingJSON: string
}

// Shared by both the count and fetch queries below -- a stem is eligible
// for either pass when it isn't already human-confirmed (ANY role) and
// has no StemAutoCategory row from the model or the mask. A row from an
// older app's guessers (embedding, centroid, zero-shot; the dev and packaged
// apps share this db) is guessed again (2026-11-14). `e`/`f` is the outer
// table's own alias (StemEmbeddingCache or StemFeatureCache).
const BASE_ELIGIBILITY_WHERE = (alias: string): string => `
  NOT EXISTS (SELECT 1 FROM StemCategories c WHERE c.StemCID = ${alias}.StemCID AND c.ArrangeRole IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = ${alias}.StemCID AND a.Source IN ('model', 'instrumentMask'))
`

// Same as above, PLUS excludes any stem that has an embedding at all: the
// embedding pass (the model) takes those. The feature pass only places a
// feature-only stem by its mask.
const featureEligibilityWhere = (alias: string): string =>
  `${BASE_ELIGIBILITY_WHERE(alias)}
   AND NOT EXISTS (SELECT 1 FROM StemEmbeddingCache e WHERE e.StemCID = ${alias}.StemCID)`

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
 * every batch. Rebuilt when the fingerprint changed (the model or the
 * classifier's code), when a confirmation is noted via
 * stemAutoClassifyWake.ts (it changes who is eligible), or when both lists are empty and no
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

/** The classifier's own code, as part of the fingerprint a stem is tried
 * under (trainingFingerprintOf): a stem recorded as tried and not placed
 * (StemAutoClassifyTried) is only tried again once its fingerprint moves, so
 * any change that could place a stem the old code couldn't must move it too
 * (review of 0adc41ca, important 2). Bump it for a change to any of:
 * - the decision rule in this file (which source wins, what's placed);
 * - CONFIDENT_DRUMS_BASS (stemCategoryModel.ts);
 * - reliableMaskSoundType (above).
 * New weights move the fingerprint by themselves (the model's version).
 * A bump re-tries the whole residue once, so don't bump it for a change
 * that can't move an answer. 2 since 2026-11-14 (the one model). */
export const CLASSIFIER_VERSION = 2

/** What a stem is tried under, as it survives a restart: the classifier's
 * code and the model's version. A confirmation doesn't move it (the model
 * doesn't train on device). The dev and packaged apps can ship different
 * weights, so each tries under its own fingerprint and keeps its own record
 * of the same stem (StemAutoClassifyTried is keyed on both). */
function trainingFingerprintOf(model: StemCategoryModel): string {
  return `c${CLASSIFIER_VERSION}|m${model.version}`
}

/** The persisted tried-ledger key for the shipped model, for the gear-menu
 * progress request. */
export function currentAutoClassifyTrainingFingerprint(): string {
  return trainingFingerprintOf(STEM_CATEGORY_MODEL)
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
  const feature = await eligibleStemCIDs(ownDb, 'StemFeatureCache', featureEligibilityWhere('t'))
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
      `SELECT e.StemCID AS StemCID, e.EmbeddingJSON AS EmbeddingJSON
       FROM StemEmbeddingCache e
       WHERE e.StemCID IN (${inPlaceholders(ids)}) AND ${BASE_ELIGIBILITY_WHERE('e')}`
    )
    .all(...ids) as EmbeddingCandidateRow[]
}

function fetchPendingFeatureRows(ownDb: Database.Database, ids: string[]): { StemCID: string }[] {
  if (ids.length === 0) return []
  countWork('sql:auto-classify.fetch-features')
  return ownDb
    .prepare(
      `SELECT f.StemCID AS StemCID FROM StemFeatureCache f
       WHERE f.StemCID IN (${inPlaceholders(ids)})
       AND ${featureEligibilityWhere('f')}`
    )
    .all(...ids) as { StemCID: string }[]
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
 * Since 2026-11-14 one shipped model decides (stemCategoryModel.ts): a
 * stem with an embedding is placed by Endlesss's drums/bass bit if it has
 * one, else by the model (a category and, for back/front, its dial). A stem
 * with features but no embedding can only be placed by its mask; a stem
 * with an embedding is never in the feature pass (featureEligibilityWhere).
 * Skips anything already confirmed (StemCategories) for ANY role -- a real
 * human confirmation needs no auto-guess.
 *
 * A stem neither pass can place (an untrained model, an embedding it can't
 * read, a feature-only stem with no drums/bass bit) is recorded as tried
 * (StemAutoClassifyTried, see withoutTried) and taken again only once the
 * fingerprint moves (new weights, CLASSIFIER_VERSION), its own mask
 * changes, or a store rewrites its row -- not at the scheduler's safety
 * rebuild or a relaunch. Each call's batch is taken from a SHUFFLED pending list,
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

  const model = options.model ?? STEM_CATEGORY_MODEL
  const fingerprint = trainingFingerprintOf(model)
  const pending = await getPendingState(ownDb, fingerprint, stemDbs, options)
  const now = Date.now()

  /** One row's outcome, written in the batch's transaction: placed (its
   * StemAutoCategory row, and any old tried record dropped), or not placed
   * (recorded as tried under this training with the mask it has now, so no
   * rebuild -- or launch -- tries it again until either moves). */
  function settle(
    stemCID: string,
    mask: number | undefined,
    placed: { role: ArrangeRole; source: StemAutoCategorySource; frontScore: number | null } | null
  ): boolean {
    if (placed) {
      upsertStemAutoCategory(ownDb, stemCID, placed.role, placed.source, now, placed.frontScore)
      forgetStemTried(ownDb, stemCID)
      return true
    }
    recordStemTried(ownDb, stemCID, fingerprint, mask ?? null, now)
    countWork('auto-classify:rows-tried-recorded')
    return false
  }

  // --- Embedding pass: the mask's drums/bass, else the model ---
  if (pending.embedding.ids.length > 0) {
    // A row left unplaced (an untrained model, an embedding it can't read)
    // is recorded as tried (StemAutoClassifyTried) and taken again once the
    // fingerprint or its own mask moves, or a store rewrites its row.
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
          role: reliable,
          source: 'instrumentMask',
          frontScore: null
        })
      }
      let probs: CategoryProbs | null = null
      try {
        probs = predictCategoryProbs(model, JSON.parse(row.EmbeddingJSON) as number[])
      } catch {
        // Corrupted row: not placed. A re-extraction rewrites it and forgets the record.
      }
      if (!probs) return settle(row.StemCID, instrument, null)
      const guess = guessFromProbs(probs)
      return settle(row.StemCID, instrument, {
        role: CATEGORY_ROLE[guess.category],
        source: 'model',
        frontScore: guess.frontScore
      })
    })
  }

  // --- Feature pass: a feature-only stem is placed by its mask, or tried ---
  if (pending.feature.ids.length > 0) {
    const taken = takePending(pending.feature, BATCH_SIZE)
    const batchRows = fetchPendingFeatureRows(ownDb, taken)
    const masks = lookupInstrumentMasks(
      stemDbs,
      batchRows.map((r) => r.StemCID),
      options.instrumentLookup
    )
    processed += await classifyInYieldingChunks(ownDb, batchRows, (row) => {
      const instrument = masks.get(row.StemCID)
      const reliable = instrument !== undefined ? reliableMaskSoundType(instrument) : null
      return settle(
        row.StemCID,
        instrument,
        reliable ? { role: reliable, source: 'instrumentMask', frontScore: null } : null
      )
    })
  }

  // Ids still waiting in this call's pending lists -- 0 means caught up
  // until a wake signal (stemAutoClassifyWake.ts) or the scheduler's
  // safety interval.
  const remaining = pending.embedding.ids.length + pending.feature.ids.length
  return { processed, remaining }
}
