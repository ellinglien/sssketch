// src/main/stemEmbeddingCacheStore.ts
import type Database from 'better-sqlite3'
import { stemCIDForPath } from './stemCategoriesStore'
import { countWork } from './workCounters'
import { noteAutoClassifyInputRow } from './stemAutoClassifyWake'

/** Reads a stem's persisted YAMNet embedding by its on-disk path -- exact
 * structural mirror of stemFeatureCacheStore.ts's own getStemFeatureCache,
 * swapping StemFeatures for a plain 1024-dim number[]. Returns null both
 * for "never extracted yet" and "not a real library stem at all" -- a
 * caller treats both identically: no embedding available, fall back to
 * Plan B1's classifier (see roleEmbeddingRefinement.ts, a later task). A
 * row whose EmbeddingJSON fails to parse (shouldn't happen -- only ever
 * written by setStemEmbeddingCache below -- but defensive against a
 * corrupted DB file) is treated the same as a miss rather than throwing. */
export function getStemEmbeddingCache(
  db: Database.Database,
  path: string,
  extraCandidateDbs: Database.Database[] = []
): number[] | null {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return null
  countWork('sql:stem-embedding-cache.get')
  const row = db
    .prepare(`SELECT EmbeddingJSON FROM StemEmbeddingCache WHERE StemCID = ?`)
    .get(stemCID) as { EmbeddingJSON: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.EmbeddingJSON) as number[]
  } catch {
    return null
  }
}

/** Persists a freshly extracted embedding for a stem, keyed by the StemCID
 * its path resolves to. A no-op (not an error) for a path that doesn't
 * resolve to a real Stems row -- same silent-skip behavior as
 * stemFeatureCacheStore.ts's own setStemFeatureCache, for the same reason
 * (a locally-dropped file/one-shot/in-app recording has nothing to persist
 * against). extraCandidateDbs, same as getStemEmbeddingCache above, are
 * checked only to validate the StemCID -- the row is always written into
 * `db` itself. */
export function setStemEmbeddingCache(
  db: Database.Database,
  path: string,
  embedding: number[],
  extractedAt: number,
  extraCandidateDbs: Database.Database[] = []
): void {
  const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
  if (!stemCID) return
  writeStemEmbeddingRow(db, stemCID, embedding, extractedAt)
  afterStemEmbeddingRowWritten(db, stemCID)
}

/** The StemEmbeddingCache upsert for an already-resolved StemCID -- shared
 * with the batched writer (stemAnalysisResultsWriter.ts). Pair with
 * afterStemEmbeddingRowWritten once committed. */
export function writeStemEmbeddingRow(
  db: Database.Database,
  stemCID: string,
  embedding: number[],
  extractedAt: number
): void {
  countWork('sql:stem-embedding-cache.set')
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt)
     VALUES (@stemCID, @embeddingJson, @extractedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       EmbeddingJSON = excluded.EmbeddingJSON,
       ExtractedAt = excluded.ExtractedAt`
  ).run({ stemCID, embeddingJson: JSON.stringify(embedding), extractedAt })
}

export function afterStemEmbeddingRowWritten(db: Database.Database, stemCID: string): void {
  // Wakes the overnight classifier with this stem (background efficiency B4).
  noteAutoClassifyInputRow(db, 'embedding', stemCID)
}
