// src/main/stemAutoCategoryStore.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'

export type StemAutoCategorySource = 'embedding' | 'centroid' | 'yamnet-zeroshot'

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

export interface StemAutoClassifyProgress {
  /** Rows in StemAutoCategory -- stems the background scan has already
   * classified. */
  classified: number
  /** Distinct stems with a cached embedding or feature vector (whichever
   * of the two the background scan can classify from, see
   * stemAutoClassify.ts's own two-pass logic) that aren't already
   * human-confirmed for any role -- the scan's own real target set, same
   * "confirmed for ANY role" exclusion classifyAutoCategoryBatch itself
   * uses. NOT the same as the full library size: a stem with neither an
   * embedding nor a feature vector yet (still waiting on
   * DiscoverLibraryScan.tsx's own renderer-side extraction pass) isn't
   * counted here at all -- see that component's own progress readout for
   * extraction progress, a genuinely separate number. */
  eligible: number
}

/** A cheap, on-demand snapshot of the background classify scan's own
 * progress (stemAutoClassify.ts) -- for the settings menu's "turn on/off
 * discover library scan" entry to show alongside itself
 * (TransportBar.tsx). Deliberately a live query, not a running counter
 * kept in memory by the scheduler: fetched fresh only when the settings
 * menu opens (same "fetch when relevant, not streamed" convention
 * TransportBar.tsx's own endlesssStatus/linkStatus already use), so there's
 * no persistent poll/subscription just for a number glanced at a few times
 * a session. */
export function getStemAutoClassifyProgress(ownDb: Database.Database): StemAutoClassifyProgress {
  const classified = (
    ownDb.prepare(`SELECT COUNT(*) AS n FROM StemAutoCategory`).get() as { n: number }
  ).n
  const eligible = (
    ownDb
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT StemCID FROM StemEmbeddingCache
           UNION
           SELECT StemCID FROM StemFeatureCache
         ) candidates
         WHERE candidates.StemCID NOT IN (
           SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL
         )`
      )
      .get() as { n: number }
  ).n
  return { classified, eligible }
}

/** Persists one stem's precomputed classification. Upsert (not insert-only)
 * so a stem reclassified by a later scan pass (shouldn't normally happen --
 * the scan itself skips anything already in this table -- but a hand-edited
 * db or a future reclassification policy could still want this) overwrites
 * cleanly rather than throwing a PRIMARY KEY conflict. */
/** Mirrors stemAutoClassify.ts's own BASE_ELIGIBILITY_WHERE idiom (NOT
 * EXISTS ... AND NOT EXISTS ..., not a UNION -- UNION's implicit DISTINCT
 * is unnecessary work here) for a single on-demand stem, rather than that
 * file's own batch queries: a stem is eligible for a fresh auto-category
 * write only when it has NO StemCategories row with a non-null ArrangeRole
 * (already human-confirmed) AND NO StemAutoCategory row at all (already
 * claimed by some other classifier source -- first classifier to claim a
 * stem wins, same convention BASE_ELIGIBILITY_WHERE's own callers use). */
export function isStemEligibleForAutoCategory(ownDb: Database.Database, stemCID: string): boolean {
  const row = ownDb
    .prepare(
      `SELECT 1 AS eligible WHERE
         NOT EXISTS (SELECT 1 FROM StemCategories WHERE StemCID = ? AND ArrangeRole IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM StemAutoCategory WHERE StemCID = ?)`
    )
    .get(stemCID, stemCID)
  return row !== undefined
}

/** Records that a YAMNet zero-shot classification attempt has happened
 * for this stem -- regardless of whether it produced a StemAutoCategory
 * row (most stems' own top AudioSet class won't map to anything in
 * audiosetClasses.ts's deliberately narrow table, and that's a genuine,
 * deterministic answer for a given audio file, not a reason to retry).
 * `ON CONFLICT ... DO NOTHING` makes this idempotent -- a stem attempted
 * twice (e.g. by both a fresh extraction and, in a narrow race, the
 * retroactive scan) keeps its FIRST AttemptedAt rather than one silently
 * overwriting the other; nothing downstream reads this table's own
 * timestamp for ordering/conflict resolution the way StemCategories'
 * UpdatedAt does, so there's no correctness reason to prefer "latest"
 * here. */
export function markYamnetZeroShotAttempted(
  ownDb: Database.Database,
  stemCID: string,
  attemptedAt: number
): void {
  ownDb
    .prepare(
      `INSERT INTO StemYamnetZeroShotAttempted (StemCID, AttemptedAt)
       VALUES (@stemCID, @attemptedAt)
       ON CONFLICT(StemCID) DO NOTHING`
    )
    .run({ stemCID, attemptedAt })
}

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
