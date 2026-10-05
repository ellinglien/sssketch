// src/main/stemFeatureCacheStore.ts
import type Database from 'better-sqlite3'
import { isCurrentStemFeatureVersion, type StemFeatures } from '@shared/stemFeatures'
import type { StemLevelWrite } from '@shared/stemAnalysisWrite'
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
  writeStemFeatureRow(db, stemCID, features, extractedAt)
  afterStemFeatureRowWritten(db, stemCID, features)
}

/** The StemFeatureCache upsert itself, for an already-resolved StemCID --
 * shared by setStemFeatureCache and the batched writer
 * (stemAnalysisResultsWriter.ts), which runs it inside its own
 * transaction. Pair with afterStemFeatureRowWritten once committed. */
export function writeStemFeatureRow(
  db: Database.Database,
  stemCID: string,
  features: StemFeatures,
  extractedAt: number
): void {
  countWork('sql:stem-feature-cache.set')
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt)
     VALUES (@stemCID, @featuresJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       FeaturesJSON = excluded.FeaturesJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({ stemCID, featuresJson: JSON.stringify(features), extractedAt })
}

/** In-memory follow-ups to a written feature row -- every writer calls
 * this, single or batched. */
export function afterStemFeatureRowWritten(
  db: Database.Database,
  stemCID: string,
  features: StemFeatures
): void {
  // Lets the Discover trait quantile tables rebuild as the Phase 3
  // re-extraction replaces old rows (traitQuantileCache.ts), and keeps its
  // in-memory trait value table current for Discover rolls -- O(1).
  noteStemFeatureRowWritten(db, features, stemCID)
  // Wakes the overnight classifier with this stem (background efficiency B4).
  noteAutoClassifyInputRow(db, 'feature', stemCID)
}

/** The level pass's backfill (spec 2026-10-05-radio-intensity-arc-design 7.3): merges `level` into
 * the stem's existing feature row -- read, merge, write, inside the caller's transaction -- and
 * returns the merged row, or null when there is no row to merge into (none, unparseable, or
 * older than STEM_FEATURE_VERSION: the scan's fresh extraction measures the level itself). Every
 * other field, featureVersion and ExtractedAt stay as they were. Pair with
 * noteStemFeatureRowWritten once committed (not the classifier's wake: none of its inputs moved). */
export function mergeStemFeatureLevelRow(
  db: Database.Database,
  stemCID: string,
  level: StemLevelWrite
): StemFeatures | null {
  countWork('sql:stem-feature-cache.merge-level')
  const row = db
    .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
    .get(stemCID) as { FeaturesJSON: string } | undefined
  if (!row) return null
  let features: StemFeatures
  try {
    features = JSON.parse(row.FeaturesJSON) as StemFeatures
  } catch {
    return null
  }
  if (!features || typeof features !== 'object' || !isCurrentStemFeatureVersion(features)) {
    return null
  }
  // only the pass's own four fields, whatever else the renderer's object carries
  const merged: StemFeatures = {
    ...features,
    loudnessLufs: level.loudnessLufs,
    lowLevelDb: level.lowLevelDb,
    activeFraction: level.activeFraction,
    levelVersion: level.levelVersion
  }
  db.prepare(`UPDATE StemFeatureCache SET FeaturesJSON = ? WHERE StemCID = ?`).run(
    JSON.stringify(merged),
    stemCID
  )
  return merged
}
