// src/main/stemAutoCategoryStore.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'
import { bumpStemClassificationVersion } from './stemClassificationVersion'

/** What wrote a row: the model, tagged with the classifier code and weights that
 * wrote it (modelAutoCategorySource, stemAutoClassify.ts), or Endlesss's mask. */
export type StemAutoCategorySource = `model:${string}` | 'instrumentMask'

const MASK_DRUMS_BASS_SQL = `(a.Source = 'instrumentMask' AND a.ArrangeRole IN ('drums', 'bass'))`

/** SQL: a StemAutoCategory row, aliased `a`, that is a usable guess (every reader) --
 * any model's (an older model's keeps serving until it is guessed again; the bare
 * 'model' rows of this branch's first commits too), or Endlesss's drums/bass bit.
 * Anything else (an older app's guess, or its notes-bit 'lead' mask row; dev and
 * packaged share this db) is never read and is guessed again. */
export const PLACED_AUTO_CATEGORY_SQL = `(a.Source LIKE 'model%' OR ${MASK_DRUMS_BASS_SQL})`

/** SQL: a row, aliased `a`, that the current model needs no new guess for (the
 * classifier's eligibility, its progress and the tried-ledger prune): written by
 * `modelSource` (the current tag), or the drums/bass bit. A row from any other
 * model is guessed again, once. */
export function currentAutoCategorySql(modelSource: string): string {
  // Interpolated, so only the numeric tag modelAutoCategorySource builds.
  if (!/^model:[\d.]+$/.test(modelSource)) throw new Error(`bad model source: ${modelSource}`)
  return `(a.Source = '${modelSource}' OR ${MASK_DRUMS_BASS_SQL})`
}

export interface StemAutoClassifyProgress {
  /** Eligible analysed stems that received an automatic category from the
   * current model or the mask (an older app's or older model's guess is
   * pending: it is guessed again). */
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
  modelSource: string,
  trainingFingerprint?: string,
  lookupMasks?: (stemCIDs: string[]) => Map<string, number>
): Promise<StemAutoClassifyProgress> {
  const rows = ownDb
    .prepare(
      `SELECT candidates.StemCID AS StemCID,
         EXISTS (SELECT 1 FROM StemAutoCategory a
                 WHERE a.StemCID = candidates.StemCID
                   AND ${currentAutoCategorySql(modelSource)}) AS Categorized
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

/** Persists one stem's precomputed classification. Upsert (not insert-only):
 * a stem guessed again (a newer model, CLASSIFIER_VERSION) overwrites its row
 * rather than throwing a PRIMARY KEY conflict. */
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
