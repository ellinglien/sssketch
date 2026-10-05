// src/main/stemAnalysisNeeds.ts
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import {
  stemFeatureVersionOf,
  stemLevelVersionOf,
  STEM_FEATURE_VERSION,
  type StemFeatures
} from '@shared/stemFeatures'
import { STEM_LEVEL_VERSION } from '@shared/stemLevel'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { countWork } from './workCounters'

const DEFAULT_CHUNK_SIZE = 500

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Rows in `table` for these StemCIDs -- one IN-list query per chunk. */
function presentStemCIDs(
  db: Database.Database,
  table: 'StemPeaksCache' | 'StemEmbeddingCache',
  stemCIDs: string[]
): Set<string> {
  countWork(`sql:stem-analysis-needs.${table}`)
  const placeholders = stemCIDs.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT StemCID FROM ${table} WHERE StemCID IN (${placeholders})`)
    .all(...stemCIDs) as { StemCID: string }[]
  return new Set(rows.map((r) => r.StemCID))
}

/** StemCIDs whose feature row exists AND is at STEM_FEATURE_VERSION, and of those the ones whose
 * level pass is older than STEM_LEVEL_VERSION (or missing: spec 2026-10-05-radio-intensity-arc-
 * design 7.3) -- read in the same parse. The version lives inside FeaturesJSON (no json_extract
 * anywhere in this codebase), so it's parsed here in JS -- only for rows that exist, one chunk at
 * a time. An unparseable row counts as missing, matching getStemFeatureCache (which returns null
 * for it). */
function currentFeatureStemCIDs(
  db: Database.Database,
  stemCIDs: string[]
): { current: Set<string>; needsLevel: Set<string> } {
  countWork('sql:stem-analysis-needs.StemFeatureCache')
  const placeholders = stemCIDs.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
    )
    .all(...stemCIDs) as { StemCID: string; FeaturesJSON: string }[]
  const current = new Set<string>()
  const needsLevel = new Set<string>()
  for (const row of rows) {
    try {
      const features = JSON.parse(row.FeaturesJSON) as StemFeatures
      if (stemFeatureVersionOf(features) >= STEM_FEATURE_VERSION) {
        current.add(row.StemCID)
        if (stemLevelVersionOf(features) < STEM_LEVEL_VERSION) needsLevel.add(row.StemCID)
      }
    } catch {
      // missing, as above
    }
  }
  return { current, needsLevel }
}

/** StemCIDs (of these) that still need the YAMNet zero-shot step
 * (background efficiency B5): an embedding row exists, no attempt is
 * recorded, the stem has its own Stems row here, and it isn't confirmed or
 * auto-categorized by anything -- exactly the eligibility the old
 * per-session retroactive scan (listYamnetZeroShotRetroactiveTargets)
 * enumerated, now asked only for the paths being checked. A db missing one
 * of these tables answers "none". */
function zeroShotPendingStemCIDs(db: Database.Database, stemCIDs: string[]): Set<string> {
  countWork('sql:stem-analysis-needs.zeroShot')
  const placeholders = stemCIDs.map(() => '?').join(',')
  try {
    const rows = db
      .prepare(
        `SELECT e.StemCID AS StemCID FROM StemEmbeddingCache e
         JOIN Stems s ON s.StemCID = e.StemCID
         WHERE e.StemCID IN (${placeholders})
         AND NOT EXISTS (SELECT 1 FROM StemYamnetZeroShotAttempted t WHERE t.StemCID = e.StemCID)
         AND NOT EXISTS (
           SELECT 1 FROM StemCategories c WHERE c.StemCID = e.StemCID AND c.ArrangeRole IS NOT NULL
         )
         AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = e.StemCID)`
      )
      .all(...stemCIDs) as { StemCID: string }[]
    return new Set(rows.map((r) => r.StemCID))
  } catch {
    return new Set()
  }
}

/**
 * Which persisted analyses each path still needs (background-efficiency
 * spec, A3) -- lets the ambient scans skip already-analysed stems without
 * a per-stem "do you have it?" round trip. Result is index-aligned with
 * `paths`. StemCID = the path's basename (the content-addressed library
 * layout, see stemCIDForPath); a path with no cache rows -- including one
 * that isn't a library stem at all -- simply needs everything, exactly
 * what the per-module getters would conclude. Batched: one query per cache
 * table per chunk of `chunkSize` paths (via `.all()`, never `.iterate()`
 * across the yields), yielding to the event loop between chunks.
 */
export async function getStemAnalysisNeeds(
  db: Database.Database,
  paths: string[],
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<StemAnalysisNeeds[]> {
  const out: StemAnalysisNeeds[] = []
  for (let start = 0; start < paths.length; start += chunkSize) {
    if (start > 0) await yieldToEventLoop()
    const chunkPaths = paths.slice(start, start + chunkSize)
    const stemCIDs = [...new Set(chunkPaths.map((p) => basename(p)))]
    const peaks = presentStemCIDs(db, 'StemPeaksCache', stemCIDs)
    const embeddings = presentStemCIDs(db, 'StemEmbeddingCache', stemCIDs)
    const features = currentFeatureStemCIDs(db, stemCIDs)
    const zeroShot = zeroShotPendingStemCIDs(db, stemCIDs)
    for (const path of chunkPaths) {
      const stemCID = basename(path)
      out.push({
        peaks: !peaks.has(stemCID),
        features: !features.current.has(stemCID),
        embedding: !embeddings.has(stemCID),
        zeroShot: zeroShot.has(stemCID),
        // only when it is needed: an answer without it reads as no level work
        ...(features.needsLevel.has(stemCID) && { level: true })
      })
    }
  }
  return out
}
