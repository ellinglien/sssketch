// src/main/embeddingMatch.ts
import type Database from 'better-sqlite3'
import type { ConfirmedEmbedding } from '@shared/embeddingMatch'
import type { CategoryAxis } from '@shared/categoryCentroids'

// Reuses categoryCentroids.ts's own CategoryAxis rather than a second,
// structurally-identical local type -- one axis union for the whole
// classifier system, so a future new axis can't be added to one and
// forgotten in the other.
const COLUMN_FOR_AXIS: Record<CategoryAxis, string> = {
  bus: 'BusId',
  arrangeRole: 'ArrangeRole',
  drumSubRole: 'DrumSubRole'
}

/** Every confirmed stem on the given axis that ALSO has a cached embedding
 * -- a bulk read (real SQL JOIN, not the per-entry lookup loop
 * categoryCentroidTraining.ts's own training functions use, since this is
 * "give me everything trained so far," closer in spirit to
 * loadCategoryCentroidStore()'s own "load the whole store" shape) feeding
 * embeddingMatch.ts's (src/shared/) own suggestCategoryFromEmbedding.
 * `db` is checked first, then each of `extraCandidateDbs` in order -- same
 * convention as every other StemCategories/StemFeatureCache reader in this
 * codebase (stemCategoriesStore.ts's own stemCIDForPath). */
export function getConfirmedEmbeddings(
  db: Database.Database,
  axis: CategoryAxis,
  extraCandidateDbs: Database.Database[] = []
): ConfirmedEmbedding[] {
  const column = COLUMN_FOR_AXIS[axis]
  const results: ConfirmedEmbedding[] = []
  for (const candidateDb of [db, ...extraCandidateDbs]) {
    const rows = candidateDb
      .prepare(
        `SELECT c.${column} AS category, e.EmbeddingJSON AS embeddingJson
         FROM StemCategories c
         JOIN StemEmbeddingCache e ON e.StemCID = c.StemCID
         WHERE c.${column} IS NOT NULL`
      )
      .all() as { category: string; embeddingJson: string }[]
    for (const row of rows) {
      try {
        results.push({
          category: row.category,
          embedding: JSON.parse(row.embeddingJson) as number[]
        })
      } catch {
        // Corrupted row -- skip rather than throw, same defensive handling
        // as stemEmbeddingCacheStore.ts's own getStemEmbeddingCache.
      }
    }
  }
  return results
}
