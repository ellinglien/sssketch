// src/main/stemFeatureCacheStore.ts
import type Database from 'better-sqlite3'
import type { StemFeatures } from '@shared/stemFeatures'
import { stemCIDForPath } from './stemCategoriesStore'

/** Reads a stem's persisted StemFeatures by its on-disk path -- resolves
 * the same content-addressed StemCID convention stemCategoriesStore.ts
 * already established (basename of a real library stem's path IS its
 * StemCID). Returns null both for "never scanned yet" and "not a real
 * library stem at all" -- a caller (stemFeaturesCache.ts's own
 * getStemFeatures) treats both identically: compute fresh. A row whose
 * FeaturesJSON fails to parse (shouldn't happen -- only ever written by
 * setStemFeatureCache below -- but defensive against a corrupted DB file)
 * is treated the same as a miss rather than throwing. */
export function getStemFeatureCache(db: Database.Database, path: string): StemFeatures | null {
  const stemCID = stemCIDForPath(db, path)
  if (!stemCID) return null
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
 * behavior for the same reason. */
export function setStemFeatureCache(
  db: Database.Database,
  path: string,
  features: StemFeatures,
  extractedAt: number
): void {
  const stemCID = stemCIDForPath(db, path)
  if (!stemCID) return
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt)
     VALUES (@stemCID, @featuresJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       FeaturesJSON = excluded.FeaturesJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({ stemCID, featuresJson: JSON.stringify(features), extractedAt })
}
