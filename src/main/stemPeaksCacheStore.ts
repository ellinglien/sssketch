// src/main/stemPeaksCacheStore.ts
import type Database from 'better-sqlite3'
import { stemCIDForPath } from './stemCategoriesStore'
import { countWork } from './workCounters'

export interface StemPeaks {
  peaks: number[]
  brightness: number[]
}

/** Reads a stem's persisted waveform decode (peaks + zero-crossing
 * brightness, 128 buckets each) by its on-disk path -- same StemCID
 * resolution/miss-handling/corrupted-row handling as
 * stemFeatureCacheStore.ts's own getStemFeatureCache, mirrored exactly
 * (see that function's own doc comment for the full reasoning, identical
 * here). `extraCandidateDbs` (default empty) are additional databases
 * checked after `db` when resolving the StemCID; the cache row itself is
 * always read from `db`. */
export function getStemPeaksCache(
  db: Database.Database,
  path: string,
  extraCandidateDbs: Database.Database[] = []
): StemPeaks | null {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return null
  countWork('sql:stem-peaks-cache.get')
  const row = db
    .prepare(`SELECT PeaksJSON, BrightnessJSON FROM StemPeaksCache WHERE StemCID = ?`)
    .get(stemCID) as { PeaksJSON: string; BrightnessJSON: string } | undefined
  if (!row) return null
  try {
    return {
      peaks: JSON.parse(row.PeaksJSON) as number[],
      brightness: JSON.parse(row.BrightnessJSON) as number[]
    }
  } catch {
    return null
  }
}

/** Persists a freshly decoded StemPeaks for a stem, keyed by the StemCID
 * its path resolves to -- same shape/silent-skip-for-a-non-library-path
 * behavior as stemFeatureCacheStore.ts's own setStemFeatureCache. */
export function setStemPeaksCache(
  db: Database.Database,
  path: string,
  peaks: StemPeaks,
  extractedAt: number,
  extraCandidateDbs: Database.Database[] = []
): void {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return
  countWork('sql:stem-peaks-cache.set')
  db.prepare(
    `INSERT INTO StemPeaksCache (StemCID, PeaksJSON, BrightnessJSON, ExtractedAt)
     VALUES (@stemCID, @peaksJson, @brightnessJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       PeaksJSON = excluded.PeaksJSON,
       BrightnessJSON = excluded.BrightnessJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({
    stemCID,
    peaksJson: JSON.stringify(peaks.peaks),
    brightnessJson: JSON.stringify(peaks.brightness),
    extractedAt
  })
}
