// src/main/categoryCentroidTraining.ts
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { toFeatureArray, type StemFeatures } from '@shared/stemFeatures'
import {
  emptyCategoryCentroidStore,
  isTrainableCategory,
  recordConfirmedCategory,
  type CategoryCentroidStore
} from '@shared/categoryCentroids'
import {
  categoryCentroidStorePath,
  readCategoryCentroidStoreFile,
  saveCategoryCentroidStore
} from './categoryCentroidStore'
import { getStemFeatureCache } from './stemFeatureCacheStore'
import {
  upsertStemCategoryBus,
  type StemBusCategoryEntry,
  type StemRoleCategoryEntry
} from './stemCategoriesStore'

// The trained record, in ownDb, lazy (review of plan b21ea5a2 Task 13 M1;
// per store file since the review of b4d9924a):
// - StemBusTrained(StorePath, StemCID, BusId): every (stem, bus) pair whose
//   features are in the bus centroids of the store file at StorePath.
// - CentroidStoreGeneration(StorePath, Generation): the generation of that
//   file the record describes (categoryCentroidStore.ts).
// Keyed by the store's path because the dev and the packaged app each keep
// their own store (userData) over one own db (~/Music): one shared record
// would credit a pair trained into one store to the other.
//
// b4d9924a's StemBusTrained(StemCID, BusId), if this db has one, is renamed
// StemBusTrainedBeforeGenerations and read only when a store from before
// generations is adopted (adoptStoreFromBeforeGenerations).
const recordReady = new WeakSet<Database.Database>()

function ensureTrainedRecordSchema(db: Database.Database): void {
  if (recordReady.has(db)) return
  db.transaction(() => {
    const columns = db.prepare(`PRAGMA table_info(StemBusTrained)`).all() as { name: string }[]
    if (columns.length > 0 && !columns.some((column) => column.name === 'StorePath')) {
      db.exec(`ALTER TABLE StemBusTrained RENAME TO StemBusTrainedBeforeGenerations`)
    }
    db.exec(`CREATE TABLE IF NOT EXISTS StemBusTrained (
      StorePath TEXT NOT NULL,
      StemCID TEXT NOT NULL,
      BusId TEXT NOT NULL,
      PRIMARY KEY (StorePath, StemCID, BusId)
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS CentroidStoreGeneration (
      StorePath TEXT PRIMARY KEY,
      Generation TEXT NOT NULL
    )`)
  })()
  if (!db.inTransaction) recordReady.add(db)
}

function recordedGeneration(db: Database.Database, storePath: string): string | null {
  const row = db
    .prepare(`SELECT Generation FROM CentroidStoreGeneration WHERE StorePath = ?`)
    .get(storePath) as { Generation: string } | undefined
  return row?.Generation ?? null
}

/** Empties the record for `storePath` and names the generation it now
 * describes. Call inside a transaction. */
function restartRecord(db: Database.Database, storePath: string, generation: string): void {
  db.prepare(`DELETE FROM StemBusTrained WHERE StorePath = ?`).run(storePath)
  db.prepare(
    `INSERT INTO CentroidStoreGeneration (StorePath, Generation) VALUES (?, ?)
     ON CONFLICT(StorePath) DO UPDATE SET Generation = excluded.Generation`
  ).run(storePath, generation)
}

interface BusPair {
  stemCID: string
  busId: string
}

const pairKey = (stemCID: string, busId: string): string => `${stemCID}\u0000${busId}`

/** A store opened for training, and how its record stands. */
interface TrainingTarget {
  storePath: string
  generation: string
  /** The store as opened (for a new file, with the db's bus rows in it). */
  store: CategoryCentroidStore
  /** A new file: on commit, the record for storePath restarts at this
   * generation with `pending` in it. */
  restart: boolean
  /** Pairs already in `store` but not yet in the record. */
  pending: BusPair[]
  isTrained(stemCID: string, busId: string): boolean
}

let lastRefusal: string | null = null
const warnedGenerations = new Set<string>()

/** The store a training write adds to, its generation, and its record, in
 * step with each other (review of b4d9924a, important 1). Called before the
 * write it trains, so a seed sees only what earlier writes trained.
 *
 * - No file: a new store under a new generation. Every bus row the db holds
 *   (trainable, with features) is trained into it here, so a lost or deleted
 *   file is rebuilt from the db at once, not only as projects happen to be
 *   parsed again (most are stamped complete and never are). The record for
 *   this path restarts when the new file is first saved, not before: a file
 *   put back meanwhile still matches its record.
 * - A file that won't load: null. Nothing trains or saves (a save would
 *   replace every sample in it with this write's); the bus entries stay
 *   `waiting`, so a project holding them is parsed again next launch, until
 *   the file loads or is removed. Logged once per distinct error.
 * - A file from before generations: adopted (adoptStoreFromBeforeGenerations).
 * - A file whose generation is not the one recorded for its path (the own
 *   db deleted or new, a backup restored, a file copied in): its samples
 *   are kept as they are, the store being the authority on what it holds,
 *   and the record restarts empty at its generation. Which pairs it holds
 *   is unknown, so each pair written from here on trains into it once:
 *   one extra sample for a pair it already held, once, never per launch.
 *   Rebuilding it from the db would drop samples the db no longer has
 *   labels for (a deleted db takes its labels with it), and seeding the
 *   record from the db's bus rows would credit it with pairs it may never
 *   have held. Logged once.
 * - Its recorded generation: trained as recorded. */
function openTrainingTarget(db: Database.Database): TrainingTarget | null {
  ensureTrainedRecordSchema(db)
  const storePath = categoryCentroidStorePath()
  const file = readCategoryCentroidStoreFile()
  if (file.kind === 'unreadable') {
    if (file.error !== lastRefusal) {
      lastRefusal = file.error
      console.error(
        `categoryCentroidTraining: ${storePath} exists but will not load (${file.error}); ` +
          'not training or saving until it loads or is removed, so the samples in it are kept'
      )
    }
    return null
  }
  if (file.kind === 'missing') return newStoreFromDb(db, storePath)
  if (file.generation === null) return adoptStoreFromBeforeGenerations(db, storePath, file.store)
  const recorded = recordedGeneration(db, storePath)
  if (recorded !== file.generation) {
    if (!warnedGenerations.has(file.generation)) {
      warnedGenerations.add(file.generation)
      console.warn(
        `categoryCentroidTraining: ${storePath} is generation ${file.generation}, but this ` +
          `library db's record is for ${recorded ?? 'none'}: keeping its samples and ` +
          'restarting the record, so a pair it already holds may be counted once more'
      )
    }
    const generation = file.generation
    db.transaction(() => restartRecord(db, storePath, generation))()
  }
  return recordedTarget(db, storePath, file.generation, file.store)
}

function recordedTarget(
  db: Database.Database,
  storePath: string,
  generation: string,
  store: CategoryCentroidStore
): TrainingTarget {
  const trained = db.prepare(
    `SELECT 1 FROM StemBusTrained WHERE StorePath = ? AND StemCID = ? AND BusId = ?`
  )
  return {
    storePath,
    generation,
    store,
    restart: false,
    pending: [],
    isTrained: (stemCID, busId) => trained.get(storePath, stemCID, busId) !== undefined
  }
}

/** Every trainable bus row whose stem has features, with them. One .all():
 * nothing is held open across the training. */
function busRowsWithFeatures(
  db: Database.Database
): { pair: BusPair; features: StemFeatures | null }[] {
  const rows = db
    .prepare(
      `SELECT c.StemCID, c.BusId, f.FeaturesJSON FROM StemCategories c
       JOIN StemFeatureCache f ON f.StemCID = c.StemCID
       WHERE c.BusId IS NOT NULL`
    )
    .all() as { StemCID: string; BusId: string; FeaturesJSON: string }[]
  return rows
    .filter((row) => isTrainableCategory('bus', row.BusId))
    .map((row) => {
      let features: StemFeatures | null = null
      try {
        features = JSON.parse(row.FeaturesJSON) as StemFeatures
      } catch {
        // Unreadable features train nothing, as in getStemFeatureCache.
      }
      return { pair: { stemCID: row.StemCID, busId: row.BusId }, features }
    })
}

function newStoreFromDb(db: Database.Database, storePath: string): TrainingTarget {
  let store = emptyCategoryCentroidStore()
  const pending: BusPair[] = []
  for (const { pair, features } of busRowsWithFeatures(db)) {
    if (!features) continue
    store = recordConfirmedCategory(store, 'bus', pair.busId, toFeatureArray(features))
    pending.push(pair)
  }
  const inStore = new Set(pending.map(({ stemCID, busId }) => pairKey(stemCID, busId)))
  return {
    storePath,
    generation: randomUUID(),
    store,
    restart: true,
    pending,
    isTrained: (stemCID, busId) => inStore.has(pairKey(stemCID, busId))
  }
}

/** A store saved before generations existed gets one, and its record is
 * seeded with every bus row whose stem has features (each such write
 * trained it then, most of them many times over: the startup backfill
 * re-trained every project on every launch), plus b4d9924a's record if this
 * db has one. The generation is saved into the file before the write, so
 * the seed is never taken again over rows this write adds. If that save
 * fails, the adoption is undone and nothing trains (null). */
function adoptStoreFromBeforeGenerations(
  db: Database.Database,
  storePath: string,
  store: CategoryCentroidStore
): TrainingTarget | null {
  const generation = randomUUID()
  const hasOldRecord = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'StemBusTrainedBeforeGenerations'`
    )
    .get()
  db.transaction(() => {
    restartRecord(db, storePath, generation)
    db.prepare(
      `INSERT OR IGNORE INTO StemBusTrained (StorePath, StemCID, BusId)
       SELECT ?, c.StemCID, c.BusId FROM StemCategories c
       WHERE c.BusId IS NOT NULL
         AND EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = c.StemCID)`
    ).run(storePath)
    if (hasOldRecord) {
      db.prepare(
        `INSERT OR IGNORE INTO StemBusTrained (StorePath, StemCID, BusId)
         SELECT ?, StemCID, BusId FROM StemBusTrainedBeforeGenerations`
      ).run(storePath)
    }
  })()
  if (!saveCategoryCentroidStore(store, generation)) {
    db.transaction(() => {
      db.prepare(`DELETE FROM StemBusTrained WHERE StorePath = ?`).run(storePath)
      db.prepare(`DELETE FROM CentroidStoreGeneration WHERE StorePath = ?`).run(storePath)
    })()
    return null
  }
  return recordedTarget(db, storePath, generation, store)
}

/** Saves `store` under the target's generation, then records the pairs it
 * added. False (nothing recorded) when there was nothing to save or the save
 * failed.
 *
 * The order is deliberate. The file is written first and the record second,
 * in two stores no transaction spans, so a crash between them leaves samples
 * on disk that the record lacks: the next write of those pairs trains them
 * again, one duplicate batch at most. The other order would fail toward
 * loss: pairs recorded as trained whose samples never reached the file,
 * never trained again, and nothing could tell. (A new file's record restarts
 * in that same second step: after a crash there, the next open finds a
 * generation the record doesn't name, and the batch in the new file is
 * counted once more.) */
function commitTraining(
  db: Database.Database,
  target: TrainingTarget,
  store: CategoryCentroidStore,
  added: BusPair[]
): boolean {
  if (store === target.store && target.pending.length === 0) return false
  if (!saveCategoryCentroidStore(store, target.generation)) return false
  const mark = db.prepare(
    `INSERT OR IGNORE INTO StemBusTrained (StorePath, StemCID, BusId) VALUES (?, ?, ?)`
  )
  db.transaction(() => {
    if (target.restart) restartRecord(db, target.storePath, target.generation)
    for (const { stemCID, busId } of [...target.pending, ...added]) {
      mark.run(target.storePath, stemCID, busId)
    }
  })()
  return true
}

/** What recordStemCategoryBus left undone. */
export interface StemBusRecordResult {
  /** Entries whose path resolved to no Stems row: nothing written. */
  unresolved: StemBusCategoryEntry[]
  /** Trainable entries the row agrees with, not trained yet because their
   * stem has no features, the store could not be saved, or the store file
   * will not load: a later write of the same assignment trains them. */
  waiting: StemBusCategoryEntry[]
}

/** A bus confirmation, written and learned from: the one path both the
 * upsert-stem-category-bus IPC handler and the startup backfill take.
 *
 * Each (stem, bus) pair adds one sample to the centroids, once, ever
 * (StemBusTrained). So the same assignment written again -- a later Tidy Up
 * re-confirming it, the project saved after the live write, an unchanged
 * project parsed on every launch while a stem is unresolved, a bus flipping
 * back and forth between an old project and Tidy Up -- adds nothing, while a
 * stem assigned before it had features still trains, once, the first time
 * the assignment is written after they exist (the backfill keeps parsing
 * such a project until then: `waiting`). A stem whose bus changes keeps a
 * sample in every bus it has held: the store can add a sample but never
 * take one back out. An entry trains only while the row holds its bus, so a
 * write the guard refused teaches nothing: the row holds a newer bus of its
 * own (BusUpdatedAt, upsertStemCategoryBus), so it is complete, not
 * waiting. The store file and the record are kept in step by
 * openTrainingTarget. */
export function recordStemCategoryBus(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
): StemBusRecordResult {
  // Before the write: a seed or a rebuild must see only earlier writes.
  const target = openTrainingTarget(db)
  const { resolved, unresolved } = upsertStemCategoryBus(
    db,
    entries,
    source,
    sourceProject,
    updatedAt,
    extraCandidateDbs
  )
  const candidates = resolved.filter(({ entry }) => isTrainableCategory('bus', entry.busId))
  if (candidates.length === 0) return { unresolved, waiting: [] }
  const busOf = db.prepare(`SELECT BusId FROM StemCategories WHERE StemCID = ?`)
  const agreed: { entry: StemBusCategoryEntry; stemCID: string }[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = pairKey(candidate.stemCID, candidate.entry.busId)
    if (seen.has(key)) continue // one batch naming the same pair twice
    seen.add(key)
    const row = busOf.get(candidate.stemCID) as { BusId: string | null } | undefined
    if (row?.BusId !== candidate.entry.busId) continue // refused: a newer bus stands
    agreed.push(candidate)
  }
  // The file won't load: what it holds is unknown, so everything waits.
  if (!target) return { unresolved, waiting: agreed.map(({ entry }) => entry) }
  const untrained = agreed.filter(({ entry, stemCID }) => !target.isTrained(stemCID, entry.busId))
  const { store, trained } = trainBusInto(
    db,
    target.store,
    untrained.map(({ entry }) => entry),
    extraCandidateDbs
  )
  const stemCIDOf = new Map(untrained.map(({ entry, stemCID }) => [entry, stemCID]))
  const added = trained.map((entry) => ({ stemCID: stemCIDOf.get(entry)!, busId: entry.busId }))
  const nowTrained = new Set(commitTraining(db, target, store, added) ? trained : [])
  return {
    unresolved,
    waiting: untrained.map(({ entry }) => entry).filter((entry) => !nowTrained.has(entry))
  }
}

/** Adds each entry whose stem has features to `store`'s bus axis: the new
 * store, and the entries that added a sample. Saves nothing. Reads each
 * entry's ALREADY-PERSISTED StemFeatures (Plan A's StemFeatureCache, via
 * getStemFeatureCache) rather than needing a fresh Web Audio decode, which
 * is what makes training possible entirely server-side with no renderer
 * involvement; a stem without them yet is skipped (not an error).
 * extraCandidateDbs is passed straight through to getStemFeatureCache,
 * mirroring stemCategoriesStore.ts's own upsertStemCategoryBus/-Role -- a
 * stem from an external LORE archive needs the same candidate-db lookup to
 * find its cached features that it already needed to validate its StemCID
 * in the first place. */
function trainBusInto(
  db: Database.Database,
  store: CategoryCentroidStore,
  entries: StemBusCategoryEntry[],
  extraCandidateDbs: Database.Database[]
): { store: CategoryCentroidStore; trained: StemBusCategoryEntry[] } {
  const trained: StemBusCategoryEntry[] = []
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    const next = recordConfirmedCategory(store, 'bus', entry.busId, toFeatureArray(features))
    if (next !== store) trained.push(entry)
    store = next
  }
  return { store, trained }
}

/** The role axes (design spec §6: every StemCategories write trains the
 * classifier): trained on every role write whose stem has features, with no
 * record of their own, into the same store file as the bus axis and through
 * the same openTrainingTarget, so a role write never saves over a file that
 * won't load, keeps the file's generation, and, finding no file, starts the
 * new one with the db's bus rows like a bus write would. */
export function trainCentroidsFromRoleEntries(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  extraCandidateDbs: Database.Database[] = []
): void {
  let target: TrainingTarget | null = null
  let store: CategoryCentroidStore | null = null
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    if (!target) {
      target = openTrainingTarget(db)
      if (!target) return // the file won't load: never saved over
      store = target.store
    }
    const raw = toFeatureArray(features)
    store = recordConfirmedCategory(store!, 'arrangeRole', entry.arrangeRole, raw)
    if (entry.drumSubRole) {
      store = recordConfirmedCategory(store, 'drumSubRole', entry.drumSubRole, raw)
    }
  }
  if (target && store) commitTraining(db, target, store, [])
}
