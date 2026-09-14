// src/main/categoryCentroidTraining.ts
import type Database from 'better-sqlite3'
import { toFeatureArray } from '@shared/stemFeatures'
import { recordConfirmedCategory, type CategoryCentroidStore } from '@shared/categoryCentroids'
import { loadCategoryCentroidStore, saveCategoryCentroidStore } from './categoryCentroidStore'
import { getStemFeatureCache } from './stemFeatureCacheStore'
import type { StemBusCategoryEntry, StemRoleCategoryEntry } from './stemCategoriesStore'

/** The server-side half of "every StemCategories write trains the
 * classifier, not just Tidy Up's own" (design spec §6). Called from every
 * real write site (the upsert-stem-category-bus/-role IPC handlers, and
 * the backfill migration) right after their own StemCategories write --
 * reads each entry's ALREADY-PERSISTED StemFeatures (Plan A's
 * StemFeatureCache, via getStemFeatureCache) rather than needing a fresh
 * Web Audio decode, which is what makes training possible entirely
 * server-side with no renderer involvement. A stem whose features haven't
 * been scanned/persisted yet is silently skipped for training purposes
 * (not an error) -- it simply doesn't contribute a data point this time;
 * a later StemCategories write for the same stem, once its features exist,
 * trains it then. extraCandidateDbs is passed straight through to
 * getStemFeatureCache, mirroring stemCategoriesStore.ts's own
 * upsertStemCategoryBus/-Role -- a stem from an external LORE archive
 * needs the same candidate-db lookup to find its cached features that it
 * already needed to validate its StemCID in the first place. */
export function trainCentroidsFromBusEntries(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  extraCandidateDbs: Database.Database[] = []
): void {
  let store: CategoryCentroidStore | null = null
  let changed = false
  for (const entry of entries) {
    const features = getStemFeatureCache(db, entry.path, extraCandidateDbs)
    if (!features) continue
    store ??= loadCategoryCentroidStore()
    const next = recordConfirmedCategory(store, 'bus', entry.busId, toFeatureArray(features))
    if (next !== store) changed = true
    store = next
  }
  if (changed && store) saveCategoryCentroidStore(store)
}

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
    store ??= loadCategoryCentroidStore()
    const raw = toFeatureArray(features)
    const afterArrangeRole = recordConfirmedCategory(store, 'arrangeRole', entry.arrangeRole, raw)
    if (afterArrangeRole !== store) changed = true
    store = afterArrangeRole
    if (entry.drumSubRole) {
      const afterDrumSubRole = recordConfirmedCategory(
        store,
        'drumSubRole',
        entry.drumSubRole,
        raw
      )
      if (afterDrumSubRole !== store) changed = true
      store = afterDrumSubRole
    }
  }
  if (changed && store) saveCategoryCentroidStore(store)
}
