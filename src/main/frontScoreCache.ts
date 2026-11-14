// src/main/frontScoreCache.ts
//
// Every stored FrontScore (the model's front/back dial, StemAutoCategory) and its library
// percentile table, per db, for Discover's back and front kinds (@shared/stemCategoryDial). A stem
// with a role label is left out: its label sets its dial, and a stale model row would skew the table.
import type Database from 'better-sqlite3'
import { buildQuantileTable, type QuantileTable } from '@shared/traitQuantiles'
import { getStemClassificationVersion } from './stemClassificationVersion'
import { PLACED_AUTO_CATEGORY_SQL } from './stemAutoCategoryStore'
import { countWork } from './workCounters'

export interface FrontScores {
  byStemCID: Map<string, number>
  table: QuantileTable | null
}

// While the overnight pass runs the version moves every batch; rebuilding at most this often
// keeps a roll from re-reading the table each time (same idea as GUESS_LAYER_MIN_MS).
const MIN_REBUILD_MS = 10_000

const cache = new WeakMap<
  Database.Database,
  { version: string; builtAt: number; scores: FrontScores }
>()

export function getFrontScores(ownDb: Database.Database, now = Date.now()): FrontScores {
  // Both tables: a guess moves a score, a label takes one out.
  const version = `${getStemClassificationVersion(ownDb, 'auto')}:${getStemClassificationVersion(ownDb, 'confirmed')}`
  const hit = cache.get(ownDb)
  if (hit && (hit.version === version || now - hit.builtAt < MIN_REBUILD_MS)) return hit.scores
  countWork('sql:front-scores')
  const rows = ownDb
    .prepare(
      `SELECT a.StemCID, a.FrontScore FROM StemAutoCategory a
       WHERE a.FrontScore IS NOT NULL AND ${PLACED_AUTO_CATEGORY_SQL}
         AND NOT EXISTS (SELECT 1 FROM StemCategories c
                         WHERE c.StemCID = a.StemCID AND c.ArrangeRole IS NOT NULL)`
    )
    .all() as { StemCID: string; FrontScore: number }[]
  const scores: FrontScores = {
    byStemCID: new Map(rows.map((r) => [r.StemCID, r.FrontScore])),
    table: buildQuantileTable(rows.map((r) => r.FrontScore))
  }
  cache.set(ownDb, { version, builtAt: now, scores })
  return scores
}
