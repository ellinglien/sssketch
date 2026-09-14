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
 *
 * Queries `db` ONLY -- deliberately does NOT accept an `extraCandidateDbs`
 * list the way stemCIDForPath/getStemFeatureCache/getStemEmbeddingCache do
 * (2026-09-15 real-world bug, found via Elling's own live testing:
 * "SqliteError: no such table: StemCategories"). Those other functions'
 * own extraCandidateDbs param is ONLY ever used to validate a StemCID
 * against the `Stems` table, which every candidate db (including an
 * external LORE-synced archive with its own, different origin/schema) is
 * guaranteed to have -- but StemCategories and StemEmbeddingCache are both
 * sssketch-exclusive tables that upsertStemCategoryBus/Role and
 * setStemEmbeddingCache each only EVER write into `db` itself (see their
 * own doc comments), never into an extra candidate. A confirmed embedding
 * can therefore only ever exist in `db` -- iterating extraCandidateDbs
 * here was structurally pointless even when it worked, and crashes
 * outright the moment a real external archive (which never has these two
 * tables at all) is one of the candidates. The original doc comment here
 * claimed this matched "the same convention as every other
 * StemCategories/StemFeatureCache reader" -- that premise was itself
 * wrong; this fix aligns the code with the convention those other readers
 * actually follow.
 *
 * Unlike loadCategoryCentroidStore (a small, fixed-shape JSON file read),
 * this result set grows unboundedly with library size -- every confirmed
 * AND embedded stem ever, forever, each row carrying a 1024-dim float
 * array (2026-09-14 code quality review). No caching here yet; whichever
 * caller(s) end up invoking this once per axis per mount (a later task)
 * should revisit whether that cost is worth memoizing once the real call
 * pattern and real library sizes are known -- don't let this silently ride
 * unbounded as the confirmed-embeddings history grows over months of use. */
export function getConfirmedEmbeddings(
  db: Database.Database,
  axis: CategoryAxis
): ConfirmedEmbedding[] {
  const column = COLUMN_FOR_AXIS[axis]
  const results: ConfirmedEmbedding[] = []
  const rows = db
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
  return results
}
