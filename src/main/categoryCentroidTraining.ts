// src/main/categoryCentroidTraining.ts
import type Database from 'better-sqlite3'
import { toFeatureArray } from '@shared/stemFeatures'
import {
  emptyCategoryCentroidStore,
  isTrainableCategory,
  recordConfirmedCategory,
  type CategoryCentroidStore
} from '@shared/categoryCentroids'
import { readCategoryCentroidStoreFile, saveCategoryCentroidStore } from './categoryCentroidStore'
import { getStemFeatureCache } from './stemFeatureCacheStore'
import {
  upsertStemCategoryBus,
  type StemBusCategoryEntry,
  type StemRoleCategoryEntry
} from './stemCategoriesStore'

let lastRefusal: string | null = null

/** The store a training write adds to: the file's, or a new empty one when
 * there is no file yet. Null when the file exists but won't load: training
 * then neither trains nor saves (a save would replace every sample in it
 * with this write's), so its bus entries stay `waiting` and a project that
 * has them is parsed again next launch, until the file loads or is removed.
 * Logged once per distinct error. */
function openStoreForTraining(): CategoryCentroidStore | null {
  const file = readCategoryCentroidStoreFile()
  if (file.kind === 'missing') return emptyCategoryCentroidStore()
  if (file.kind === 'ok') return file.store
  if (file.error !== lastRefusal) {
    lastRefusal = file.error
    console.error(
      `categoryCentroidTraining: busCentroids.json exists but will not load (${file.error}); ` +
        'not training or saving until it loads or is removed, so the samples in it are kept'
    )
  }
  return null
}

// StemBusTrained(StemCID, BusId): every (stem, bus) pair whose features are
// already in the bus centroids. Lazy, in ownDb (review of plan b21ea5a2
// Task 13 M1). Created seeded with every bus row whose stem has features:
// each such write trained it before this record existed (most of them many
// times over: the startup backfill re-trained every project on every launch).
const busTrainedReady = new WeakSet<Database.Database>()

function ensureBusTrainedSchema(db: Database.Database): void {
  if (busTrainedReady.has(db)) return
  const exists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'StemBusTrained'`)
    .get()
  if (!exists) {
    db.transaction(() => {
      db.exec(`CREATE TABLE StemBusTrained (
        StemCID TEXT NOT NULL,
        BusId TEXT NOT NULL,
        PRIMARY KEY (StemCID, BusId)
      )`)
      db.exec(`INSERT OR IGNORE INTO StemBusTrained (StemCID, BusId)
        SELECT c.StemCID, c.BusId FROM StemCategories c
        WHERE c.BusId IS NOT NULL
          AND EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = c.StemCID)`)
    })()
  }
  if (!db.inTransaction) busTrainedReady.add(db)
}

/** What recordStemCategoryBus left undone. */
export interface StemBusRecordResult {
  /** Entries whose path resolved to no Stems row: nothing written. */
  unresolved: StemBusCategoryEntry[]
  /** Trainable entries the row agrees with, not trained yet because their
   * stem has no features (or the store could not be saved): a later write of
   * the same assignment trains them. */
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
 * such a project until then: `waiting`). An entry trains only while the row
 * holds its bus, so a write the guard refused teaches nothing: the row holds
 * a newer bus of its own (BusUpdatedAt, upsertStemCategoryBus), so it is
 * complete, not waiting. */
export function recordStemCategoryBus(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
): StemBusRecordResult {
  // Before the write: the seed must see only what earlier writes trained.
  ensureBusTrainedSchema(db)
  const target = openStoreForTraining()
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
  const trained = db.prepare(`SELECT 1 FROM StemBusTrained WHERE StemCID = ? AND BusId = ?`)
  const untrained: StemBusCategoryEntry[] = []
  const stemCIDOf = new Map<StemBusCategoryEntry, string>()
  const seen = new Set<string>()
  for (const { entry, stemCID } of candidates) {
    const key = `${stemCID}\u0000${entry.busId}`
    if (seen.has(key)) continue // one batch naming the same pair twice
    seen.add(key)
    const row = busOf.get(stemCID) as { BusId: string | null } | undefined
    if (row?.BusId !== entry.busId) continue // refused: a newer bus stands
    if (trained.get(stemCID, entry.busId)) continue
    untrained.push(entry)
    stemCIDOf.set(entry, stemCID)
  }
  if (!target) return { unresolved, waiting: untrained } // the file won't load
  const { store, trained: added } = trainBusInto(db, target, untrained, extraCandidateDbs)
  const nowTrained = new Set(added.length > 0 && saveCategoryCentroidStore(store) ? added : [])
  if (nowTrained.size > 0) {
    const mark = db.prepare(`INSERT OR IGNORE INTO StemBusTrained (StemCID, BusId) VALUES (?, ?)`)
    db.transaction(() => {
      for (const entry of nowTrained) mark.run(stemCIDOf.get(entry), entry.busId)
    })()
  }
  return { unresolved, waiting: untrained.filter((entry) => !nowTrained.has(entry)) }
}

/** Adds each entry whose stem has features to `store`'s bus axis: the new
 * store, and the entries that added a sample. Saves nothing. */
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

/** The server-side half of "every StemCategories write trains the
 * classifier, not just Tidy Up's own" (design spec §6), for the bus axis
 * outside the trained record (recordStemCategoryBus is the path every real
 * bus write takes). Reads each entry's ALREADY-PERSISTED StemFeatures (Plan
 * A's StemFeatureCache, via getStemFeatureCache) rather than needing a fresh
 * Web Audio decode, which is what makes training possible entirely
 * server-side with no renderer involvement. A stem whose features haven't
 * been scanned/persisted yet is silently skipped (not an error). Returns the
 * entries that added a sample, once the store is saved; none if it wasn't,
 * or if the store file exists but won't load (openStoreForTraining).
 * extraCandidateDbs is passed straight through to getStemFeatureCache,
 * mirroring stemCategoriesStore.ts's own upsertStemCategoryBus/-Role -- a
 * stem from an external LORE archive needs the same candidate-db lookup to
 * find its cached features that it already needed to validate its StemCID
 * in the first place. */
export function trainCentroidsFromBusEntries(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  extraCandidateDbs: Database.Database[] = []
): StemBusCategoryEntry[] {
  const target = openStoreForTraining()
  if (!target) return []
  const { store, trained } = trainBusInto(db, target, entries, extraCandidateDbs)
  if (trained.length > 0 && saveCategoryCentroidStore(store)) return trained
  return []
}

/** The role axes: trained on every write that has features (no trained
 * record), into the same file, under the same refusal when it won't load. */
export function trainCentroidsFromRoleEntries(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  extraCandidateDbs: Database.Database[] = []
): void {
  let store: CategoryCentroidStore | null = null
  let changed = false
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    if (!store) {
      store = openStoreForTraining()
      if (!store) return // the file won't load: never saved over
    }
    const raw = toFeatureArray(features)
    const afterArrangeRole = recordConfirmedCategory(store, 'arrangeRole', entry.arrangeRole, raw)
    if (afterArrangeRole !== store) changed = true
    store = afterArrangeRole
    if (entry.drumSubRole) {
      const afterDrumSubRole = recordConfirmedCategory(store, 'drumSubRole', entry.drumSubRole, raw)
      if (afterDrumSubRole !== store) changed = true
      store = afterDrumSubRole
    }
  }
  if (changed && store) saveCategoryCentroidStore(store)
}
