// src/main/categoryCentroidTraining.ts
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
  saveCategoryCentroidStore,
  type TrainedBusPair
} from './categoryCentroidStore'
import { getStemFeatureCache } from './stemFeatureCacheStore'
import {
  hasBusStampColumn,
  upsertStemCategoryBus,
  upsertStemCategoryRole,
  type StemBusCategoryEntry,
  type StemRoleCategoryEntry
} from './stemCategoriesStore'

// Which (stem, bus) pairs a store file holds is kept in that file
// (trainedPairs, categoryCentroidStore.ts), saved in the same atomic write as
// its samples: nothing in the library db, so nothing to keep in step with it.

const pairKey = (stemCID: string, busId: string): string => `${stemCID}\u0000${busId}`

/** A store opened for training. */
interface TrainingTarget {
  store: CategoryCentroidStore
  /** The (stem, bus) pairs in `store`'s bus axis. */
  trainedPairs: TrainedBusPair[]
  /** Built here rather than read as saved (a rebuild, or a seed): the first
   * commit saves it even when its write trains nothing new. */
  unsaved: boolean
  isTrained(stemCID: string, busId: string): boolean
}

function trainingTarget(
  store: CategoryCentroidStore,
  trainedPairs: TrainedBusPair[],
  unsaved: boolean
): TrainingTarget {
  const keys = new Set(trainedPairs.map(({ stemCID, busId }) => pairKey(stemCID, busId)))
  return {
    store,
    trainedPairs,
    unsaved,
    isTrained: (stemCID, busId) => keys.has(pairKey(stemCID, busId))
  }
}

let unreadableListener: ((path: string, error: string) => void) | null = null
let lastRefusal: string | null = null

/** Told once per distinct error when the store file exists but will not
 * load (index.ts shows it to the user). Null to stop. */
export function setCentroidStoreUnreadableListener(
  listener: ((path: string, error: string) => void) | null
): void {
  unreadableListener = listener
}

/** The store a training write adds to (review of b4d9924a, important 1):
 * - A file that won't load: null. Nothing trains or saves (a save would
 *   replace every sample in it with this write's); the bus entries stay
 *   `waiting`, so a project holding them is parsed again next launch, until
 *   the file loads or is moved aside. Logged and reported once per distinct
 *   error.
 * - No file: rebuilt from the db (rebuildStoreFromDb), every axis.
 * - A file saved before trainedPairs: seeded once (seedTrainedPairs).
 * - Otherwise: the file as saved. */
function openTrainingTarget(db: Database.Database): TrainingTarget | null {
  const file = readCategoryCentroidStoreFile()
  if (file.kind === 'unreadable') {
    if (file.error !== lastRefusal) {
      lastRefusal = file.error
      const path = categoryCentroidStorePath()
      console.error(
        `categoryCentroidTraining: ${path} exists but will not load (${file.error}); ` +
          'not training or saving until it loads or is moved aside, so the samples in it are kept'
      )
      unreadableListener?.(path, file.error)
    }
    return null
  }
  lastRefusal = null
  if (file.kind === 'missing') {
    const { store, trainedPairs } = rebuildStoreFromDb(db)
    return trainingTarget(store, trainedPairs, true)
  }
  if (file.trainedPairs === null) {
    return trainingTarget(file.store, seedTrainedPairs(db), true)
  }
  return trainingTarget(file.store, file.trainedPairs, false)
}

interface LabelledRow {
  stemCID: string
  busId: string | null
  arrangeRole: string | null
  drumSubRole: string | null
  features: StemFeatures
}

/** Every StemCategories row whose stem has readable features, with them; or,
 * with 'unstampedBus', only the rows holding a bus written before
 * BusUpdatedAt existed (NULL there, or no such column yet). One .all():
 * nothing is held open across the training, and nothing here awaits. */
function labelledRowsWithFeatures(
  db: Database.Database,
  only: 'all' | 'unstampedBus'
): LabelledRow[] {
  const where =
    only === 'all'
      ? ''
      : hasBusStampColumn(db)
        ? 'WHERE c.BusId IS NOT NULL AND c.BusUpdatedAt IS NULL'
        : 'WHERE c.BusId IS NOT NULL'
  const rows = db
    .prepare(
      `SELECT c.StemCID, c.BusId, c.ArrangeRole, c.DrumSubRole, f.FeaturesJSON
       FROM StemCategories c JOIN StemFeatureCache f ON f.StemCID = c.StemCID
       ${where}`
    )
    .all() as {
    StemCID: string
    BusId: string | null
    ArrangeRole: string | null
    DrumSubRole: string | null
    FeaturesJSON: string
  }[]
  const out: LabelledRow[] = []
  for (const row of rows) {
    let features: StemFeatures
    try {
      features = JSON.parse(row.FeaturesJSON) as StemFeatures
    } catch {
      continue // unreadable features train nothing, as in getStemFeatureCache
    }
    out.push({
      stemCID: row.StemCID,
      busId: row.BusId,
      arrangeRole: row.ArrangeRole,
      drumSubRole: row.DrumSubRole,
      features
    })
  }
  return out
}

/** No store file (first run, or moved aside or deleted): a new store with
 * one sample per labelled stem with features, on every axis it is labelled
 * on -- its bus, its ArrangeRole and its DrumSubRole -- and so the global
 * stats too, as live training would have built them. Rebuilding the buses
 * alone would lose the role axes for good: they have no record to rebuild
 * them from but these rows. Synchronous: measured on Elling's db (208 bus
 * rows, ~8.5k role rows), ~50 ms. Samples whose labels are gone from the db
 * are gone from the store. */
function rebuildStoreFromDb(db: Database.Database): {
  store: CategoryCentroidStore
  trainedPairs: TrainedBusPair[]
} {
  let store = emptyCategoryCentroidStore()
  const trainedPairs: TrainedBusPair[] = []
  for (const row of labelledRowsWithFeatures(db, 'all')) {
    const raw = toFeatureArray(row.features)
    if (row.busId !== null && isTrainableCategory('bus', row.busId)) {
      store = recordConfirmedCategory(store, 'bus', row.busId, raw)
      trainedPairs.push({ stemCID: row.stemCID, busId: row.busId })
    }
    if (row.arrangeRole !== null) {
      store = recordConfirmedCategory(store, 'arrangeRole', row.arrangeRole, raw)
    }
    if (row.drumSubRole !== null) {
      store = recordConfirmedCategory(store, 'drumSubRole', row.drumSubRole, raw)
    }
  }
  return { store, trainedPairs }
}

/** A store file saved before trainedPairs existed (each user's first launch
 * on this code): every trainable bus row written by the code before it whose
 * stem has features is credited as already held. Those stores were trained
 * by every such write, most of them many times over (the startup backfill
 * re-trained every project on every launch, so their counts are inflated):
 * training them once more would only inflate them further. A row without
 * features was never trained, and trains once when they arrive.
 *
 * Only rows whose bus was written before BusUpdatedAt existed (NULL there)
 * are credited. A bus written since was written by this code, which records
 * each pair in the file it trains into, in the same save: so a stamped row
 * was never trained into a file without trainedPairs. That matters because
 * the seed is taken again at every write until one saves it (review of
 * 6fd465fe, minor 2): a write whose save failed has already written its row,
 * and crediting that row at the next write -- in this launch or a later
 * one -- would mean its pair never trained. The cost, also only after a
 * failed save: an old row the failed write re-stamped (the same bus written
 * again) trains once more. */
function seedTrainedPairs(db: Database.Database): TrainedBusPair[] {
  return labelledRowsWithFeatures(db, 'unstampedBus')
    .filter((row) => isTrainableCategory('bus', row.busId!))
    .map((row) => ({ stemCID: row.stemCID, busId: row.busId! }))
}

/** Saves `store` with the target's pairs plus `added`, in one write. True when
 * what was trained is on disk (also when there was nothing to save); false
 * when the save failed. */
function commitTraining(
  target: TrainingTarget,
  store: CategoryCentroidStore,
  added: TrainedBusPair[]
): boolean {
  if (!target.unsaved && store === target.store && added.length === 0) return true
  return saveCategoryCentroidStore(store, [...target.trainedPairs, ...added])
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
 * Each (stem, bus) pair adds one sample to a store file, once (the file's
 * trainedPairs). So the same assignment written again -- a later Tidy Up
 * re-confirming it, the project saved after the live write, an unchanged
 * project parsed on every launch while a stem is unresolved, a bus flipping
 * back and forth between an old project and Tidy Up -- adds nothing, while a
 * stem assigned before it had features still trains, once, the first time
 * the assignment is written after they exist (the backfill keeps parsing
 * such a project until then: `waiting`). A stem whose bus changes keeps a
 * sample in every bus it has held: the store can add a sample but never
 * take one back out. A new store file (rebuilt from the db) starts its own
 * pairs from the rows as they stand.
 *
 * An entry trains only while the row holds its bus, so a write the guard
 * refused teaches nothing and is complete, not waiting: written again, it
 * would be refused again. Usually the row holds a newer bus of its own
 * (BusUpdatedAt, upsertStemCategoryBus). For a row from before that column
 * that holds a bus, the guard falls back to the row's UpdatedAt, which may
 * be a role's: there a refusal can mean the role is newer, not the bus, and
 * the entry's bus (newer than the row's) never lands. */
export function recordStemCategoryBus(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
): StemBusRecordResult {
  // Before the write: a rebuild or a seed must see only earlier writes, so
  // that this write's own pairs are trained (rebuild) or not credited (seed).
  const target = openTrainingTarget(db)
  const { resolved, unresolved } = upsertStemCategoryBus(
    db,
    entries,
    source,
    sourceProject,
    updatedAt,
    extraCandidateDbs
  )
  const busOf = db.prepare(`SELECT BusId FROM StemCategories WHERE StemCID = ?`)
  const agreed: { entry: StemBusCategoryEntry; stemCID: string }[] = []
  const seen = new Set<string>()
  for (const candidate of resolved) {
    if (!isTrainableCategory('bus', candidate.entry.busId)) continue
    const key = pairKey(candidate.stemCID, candidate.entry.busId)
    if (seen.has(key)) continue // one batch naming the same pair twice
    seen.add(key)
    const row = busOf.get(candidate.stemCID) as { BusId: string | null } | undefined
    if (row?.BusId !== candidate.entry.busId) continue // refused: see above
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
  // Saved even with nothing added: a rebuild or a seed is kept, not redone.
  const nowTrained = new Set(commitTraining(target, store, added) ? trained : [])
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

/** A role confirmation, written and learned from: the one path both the
 * upsert-stem-category-role IPC handler and the instrument-mask backfill
 * take. The role axes (design spec §6: every StemCategories write trains the
 * classifier) are trained on every role write whose stem has features, with
 * no record of their own, into the same store file as the bus axis and
 * through the same openTrainingTarget, opened before the write as for a bus:
 * a role write never saves over a file that won't load, and a store rebuilt
 * here (no file) holds the rows as they were, this write's roles then
 * trained once like any other. */
export function recordStemCategoryRole(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
): void {
  const target = openTrainingTarget(db)
  upsertStemCategoryRole(db, entries, source, sourceProject, updatedAt, extraCandidateDbs)
  if (!target) return // the file won't load: never saved over
  let store = target.store
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    const raw = toFeatureArray(features)
    store = recordConfirmedCategory(store, 'arrangeRole', entry.arrangeRole, raw)
    if (entry.drumSubRole) {
      store = recordConfirmedCategory(store, 'drumSubRole', entry.drumSubRole, raw)
    }
  }
  commitTraining(target, store, [])
}
