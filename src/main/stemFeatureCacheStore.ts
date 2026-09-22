// src/main/stemFeatureCacheStore.ts
import type Database from 'better-sqlite3'
import type { StemFeatures } from '@shared/stemFeatures'
import { stemCIDForPath } from './stemCategoriesStore'
import { countWork } from './workCounters'
import { noteStemFeatureRowWritten } from './traitQuantileCache'
import { noteAutoClassifyInputRow } from './stemAutoClassifyWake'

/** Reads a stem's persisted StemFeatures by its on-disk path -- resolves
 * the same content-addressed StemCID convention stemCategoriesStore.ts
 * already established (basename of a real library stem's path IS its
 * StemCID). Returns null both for "never scanned yet" and "not a real
 * library stem at all" -- a caller (stemFeaturesCache.ts's own
 * getStemFeatures) treats both identically: compute fresh. A row whose
 * FeaturesJSON fails to parse (shouldn't happen -- only ever written by
 * setStemFeatureCache below -- but defensive against a corrupted DB file)
 * is treated the same as a miss rather than throwing.
 *
 * `extraCandidateDbs` (default empty) are additional databases -- typically
 * the currently-configured browsing root when it differs from the own
 * warehouse (an external LORE archive) -- checked after `db` when
 * resolving the StemCID, same as stemCategoriesStore.ts's own
 * stemCIDForPath. The cache row itself is always read from/written to
 * `db`. */
export function getStemFeatureCache(
  db: Database.Database,
  path: string,
  extraCandidateDbs: Database.Database[] = []
): StemFeatures | null {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return null
  countWork('sql:stem-feature-cache.get')
  const row = db
    .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
    .get(stemCID) as { FeaturesJSON: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.FeaturesJSON) as StemFeatures
  } catch {
    return null
  }
}

/** Persists a freshly computed StemFeatures for a stem, keyed by the
 * StemCID its path resolves to. A no-op (not an error) for a path that
 * doesn't resolve to a real Stems row -- a locally-dropped file, one-shot
 * sample, or in-app recording has nothing to persist against, exactly
 * matching stemCategoriesStore.ts's own upsert functions' same silent-skip
 * behavior for the same reason.
 *
 * `extraCandidateDbs` (default empty), same as getStemFeatureCache above,
 * are additional databases checked after `db` only to validate the
 * StemCID -- the row is always written into `db` itself, never into one
 * of the extra candidates. */
export function setStemFeatureCache(
  db: Database.Database,
  path: string,
  features: StemFeatures,
  extractedAt: number,
  extraCandidateDbs: Database.Database[] = []
): void {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return
  countWork('sql:stem-feature-cache.set')
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt)
     VALUES (@stemCID, @featuresJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       FeaturesJSON = excluded.FeaturesJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({ stemCID, featuresJson: JSON.stringify(features), extractedAt })
  // Lets the Discover trait quantile tables rebuild as the Phase 3
  // re-extraction replaces old rows (traitQuantileCache.ts), and keeps its
  // in-memory trait value table current for Discover rolls -- O(1).
  noteStemFeatureRowWritten(db, features, stemCID)
  // Wakes the overnight classifier with this stem (background efficiency B4).
  noteAutoClassifyInputRow(db, 'feature', stemCID)
}
