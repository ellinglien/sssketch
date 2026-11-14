// src/main/stemAutoCategoryStore.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'
import { bumpStemClassificationVersion } from './stemClassificationVersion'

export type StemAutoCategorySource = 'model' | 'instrumentMask'

/** SQL: a StemAutoCategory row, aliased `a`, that counts as placed -- the
 * model's, or Endlesss's drums/bass bit (the four-categories migration's own
 * rule, riffLibrarySchema.ts). Anything else (an older app's guess, or its
 * notes-bit 'lead' mask row; dev and packaged share this db) is guessed again. */
export const PLACED_AUTO_CATEGORY_SQL = `(a.Source = 'model' OR (a.Source = 'instrumentMask' AND a.ArrangeRole IN ('drums', 'bass')))`

export interface StemAutoClassifyProgress {
  /** Eligible analysed stems that received an automatic category from the
   * model or the mask (an older app's guess is pending: it is guessed again). */
  categorized: number
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
  /** Eligible stems tried under the classifier's current training whose
   * instrument mask has not changed, but for which neither classifier had
   * a confident answer. These are complete work, not a pending backlog. */
  terminalUnclassified: number
  /** Eligible stems neither categorized nor terminal under current
   * training. This is the number that can still make forward progress. */
  pending: number
  /** categorized + terminalUnclassified. */
  processed: number
}

/** An on-demand snapshot of the background classify scan's own
 * progress (stemAutoClassify.ts) -- for the settings menu's "turn on/off
 * discover library scan" entry to show alongside itself
 * (TransportBar.tsx). Deliberately a live query, not a running counter
 * kept in memory by the scheduler: fetched fresh only when the settings
 * menu opens (same "fetch when relevant, not streamed" convention
 * TransportBar.tsx's own endlesssStatus/linkStatus already use), so there's
 * no persistent poll/subscription just for a number glanced at a few times
 * a session. */
export async function getStemAutoClassifyProgress(
  ownDb: Database.Database,
  trainingFingerprint?: string,
  lookupMasks?: (stemCIDs: string[]) => Map<string, number>
): Promise<StemAutoClassifyProgress> {
  const rows = ownDb
    .prepare(
      `SELECT candidates.StemCID AS StemCID,
         EXISTS (SELECT 1 FROM StemAutoCategory a
                 WHERE a.StemCID = candidates.StemCID
                   AND ${PLACED_AUTO_CATEGORY_SQL}) AS Categorized
       FROM (
         SELECT StemCID FROM StemEmbeddingCache
         UNION
         SELECT StemCID FROM StemFeatureCache
       ) candidates
       WHERE NOT EXISTS (
         SELECT 1 FROM StemCategories c
         WHERE c.StemCID = candidates.StemCID AND c.ArrangeRole IS NOT NULL
       )`
    )
    .all() as { StemCID: string; Categorized: number }[]

  const categorized = rows.reduce((n, row) => n + (row.Categorized ? 1 : 0), 0)
  let terminalUnclassified = 0
  if (trainingFingerprint !== undefined && lookupMasks !== undefined) {
    const triedRows = ownDb
      .prepare(`SELECT StemCID, Mask FROM StemAutoClassifyTried WHERE TrainingFingerprint = ?`)
      .all(trainingFingerprint) as { StemCID: string; Mask: number | null }[]
    const tried = new Map(triedRows.map((row) => [row.StemCID, row.Mask]))
    const unresolved = rows
      .filter((row) => !row.Categorized && tried.has(row.StemCID))
      .map((row) => row.StemCID)
    // Keep each SQL fallback used by lookupMasks below SQLite's variable
    // limit, matching the classifier's own tried-mask audit chunk size.
    const chunkSize = 500
    for (let start = 0; start < unresolved.length; start += chunkSize) {
      const chunk = unresolved.slice(start, start + chunkSize)
      const currentMasks = lookupMasks(chunk)
      for (const stemCID of chunk) {
        if ((currentMasks.get(stemCID) ?? null) === tried.get(stemCID)) {
          terminalUnclassified += 1
        }
      }
      if (start + chunkSize < unresolved.length) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  }

  const eligible = rows.length
  const processed = categorized + terminalUnclassified
  return {
    categorized,
    eligible,
    terminalUnclassified,
    pending: eligible - processed,
    processed
  }
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

export function upsertStemAutoCategory(
  ownDb: Database.Database,
  stemCID: string,
  arrangeRole: ArrangeRole,
  source: StemAutoCategorySource,
  computedAt: number,
  frontScore: number | null = null
): void {
  ownDb
    .prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt, FrontScore)
       VALUES (@stemCID, @arrangeRole, @source, @computedAt, @frontScore)
       ON CONFLICT(StemCID) DO UPDATE SET
         ArrangeRole = excluded.ArrangeRole,
         Source = excluded.Source,
         ComputedAt = excluded.ComputedAt,
         FrontScore = excluded.FrontScore`
    )
    .run({ stemCID, arrangeRole, source, computedAt, frontScore })
  // Discover's precomputed per-kind stem lists read this table.
  bumpStemClassificationVersion(ownDb, 'auto')
}
