// src/main/stemAutoCategoryStore.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'

export type StemAutoCategorySource = 'embedding' | 'centroid'

/** Every StemCID, on `ownDb` only (StemAutoCategory, like StemCategories/
 * StemEmbeddingCache/StemFeatureCache, only ever lives there -- see
 * discoverCandidates.ts's own repeated notes on why an external LORE
 * archive db is never a candidate for these sssketch-exclusive tables),
 * already precomputed as `arrangeRole` by the background classify scan
 * (stemAutoClassify.ts). A plain, fast SELECT -- no classifier math at
 * query time, which is the whole point of persisting this instead of
 * recomputing it on every Discover roll (direct request, 2026-09-15). */
export function getAutoCategorizedStemCIDs(
  ownDb: Database.Database,
  arrangeRole: ArrangeRole
): Set<string> {
  const rows = ownDb
    .prepare(`SELECT StemCID FROM StemAutoCategory WHERE ArrangeRole = ?`)
    .all(arrangeRole) as { StemCID: string }[]
  return new Set(rows.map((r) => r.StemCID))
}

/** Every StemCID already present in StemAutoCategory, REGARDLESS of role --
 * used by the classify scan to skip stems it's already classified, and by
 * discoverCandidates.ts nowhere (that reads the role-scoped set above
 * instead) -- kept separate from getAutoCategorizedStemCIDs since the scan's
 * own "already done" check and a caller's own "give me role X" query are
 * genuinely different questions, even though both read the same table. */
export function getAllAutoCategorizedStemCIDs(ownDb: Database.Database): Set<string> {
  const rows = ownDb.prepare(`SELECT StemCID FROM StemAutoCategory`).all() as { StemCID: string }[]
  return new Set(rows.map((r) => r.StemCID))
}

/** Persists one stem's precomputed classification. Upsert (not insert-only)
 * so a stem reclassified by a later scan pass (shouldn't normally happen --
 * the scan itself skips anything already in this table -- but a hand-edited
 * db or a future reclassification policy could still want this) overwrites
 * cleanly rather than throwing a PRIMARY KEY conflict. */
export function upsertStemAutoCategory(
  ownDb: Database.Database,
  stemCID: string,
  arrangeRole: ArrangeRole,
  source: StemAutoCategorySource,
  computedAt: number
): void {
  ownDb
    .prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
       VALUES (@stemCID, @arrangeRole, @source, @computedAt)
       ON CONFLICT(StemCID) DO UPDATE SET
         ArrangeRole = excluded.ArrangeRole,
         Source = excluded.Source,
         ComputedAt = excluded.ComputedAt`
    )
    .run({ stemCID, arrangeRole, source, computedAt })
}
