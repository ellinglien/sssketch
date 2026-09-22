// src/main/stemAnalysisResultsWriter.ts
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import type { StemAnalysisWrite } from '@shared/stemAnalysisWrite'
import { countWork } from './workCounters'
import { writeStemPeaksRow } from './stemPeaksCacheStore'
import { afterStemFeatureRowWritten, writeStemFeatureRow } from './stemFeatureCacheStore'
import { afterStemEmbeddingRowWritten, writeStemEmbeddingRow } from './stemEmbeddingCacheStore'
import { applyYamnetZeroShotCategory, markYamnetZeroShotAttempted } from './stemAutoCategoryStore'

const RESOLVE_CHUNK = 500
// Same budget as stemAutoClassify.ts's classify transactions: keep writing
// into the current transaction until this much time has passed, then
// commit and yield -- a large batch never holds the main thread for long.
const TRANSACTION_BUDGET_MS = 16

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Which of these candidate StemCIDs are real library stems -- the batched
 * form of stemCIDForPath's check (a Stems row in `db`, else in one of the
 * extra dbs, in order): one IN-list query per chunk per db, only for what
 * the earlier dbs didn't already find. */
function resolveStemCIDs(dbs: Database.Database[], candidates: string[]): Set<string> {
  const found = new Set<string>()
  let remaining = [...new Set(candidates)]
  for (const db of dbs) {
    if (remaining.length === 0) break
    for (let i = 0; i < remaining.length; i += RESOLVE_CHUNK) {
      const chunk = remaining.slice(i, i + RESOLVE_CHUNK)
      countWork('sql:stem-analysis-results.resolve')
      const rows = db
        .prepare(`SELECT StemCID FROM Stems WHERE StemCID IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as { StemCID: string }[]
      for (const row of rows) found.add(row.StemCID)
    }
    remaining = remaining.filter((c) => !found.has(c))
  }
  return found
}

/**
 * Background efficiency B7: persists every output of several analysed
 * stems at once -- the ambient scans' write queue (analysisWriteQueue.ts,
 * renderer) sends one of these per flush instead of up to five separate
 * IPCs per stem, each with its own StemCID lookup and autocommit.
 *
 * Same rows, same values, same follow-ups as the single-write handlers:
 * each field goes through the store's own row writer (writeStem*Row,
 * markYamnetZeroShotAttempted, applyYamnetZeroShotCategory), and the
 * in-memory hooks those handlers fire (the trait value table / feature-
 * version counters via afterStemFeatureRowWritten, the overnight
 * classifier's wake signals) fire for every written row once its
 * transaction has committed. A path that isn't a real library stem is
 * skipped, as the single writers skip it. Writes run in time-budgeted
 * transactions (TRANSACTION_BUDGET_MS) with a yield between them.
 */
export async function writeStemAnalysisResults(
  db: Database.Database,
  results: StemAnalysisWrite[],
  extractedAt: number,
  extraCandidateDbs: Database.Database[] = []
): Promise<void> {
  if (results.length === 0) return
  countWork('stem-analysis-results.stems', results.length)
  const valid = resolveStemCIDs(
    [db, ...extraCandidateDbs],
    results.map((r) => basename(r.path))
  )
  let index = 0
  while (index < results.length) {
    const followUps: (() => void)[] = []
    db.transaction(() => {
      const start = performance.now()
      do {
        const result = results[index]
        index += 1
        const stemCID = basename(result.path)
        if (!valid.has(stemCID)) continue
        if (result.peaks) writeStemPeaksRow(db, stemCID, result.peaks, extractedAt)
        if (result.features) {
          const features = result.features
          writeStemFeatureRow(db, stemCID, features, extractedAt)
          followUps.push(() => afterStemFeatureRowWritten(db, stemCID, features))
        }
        if (result.embedding) {
          writeStemEmbeddingRow(db, stemCID, result.embedding, extractedAt)
          followUps.push(() => afterStemEmbeddingRowWritten(db, stemCID))
        }
        if (result.zeroShotAttempted) markYamnetZeroShotAttempted(db, stemCID, extractedAt)
        if (result.zeroShotClassIndex !== undefined) {
          applyYamnetZeroShotCategory(db, stemCID, result.zeroShotClassIndex, extractedAt)
        }
      } while (index < results.length && performance.now() - start < TRANSACTION_BUDGET_MS)
    })()
    for (const followUp of followUps) followUp()
    if (index < results.length) await yieldToEventLoop()
  }
}
