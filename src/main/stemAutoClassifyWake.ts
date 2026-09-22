// src/main/stemAutoClassifyWake.ts
//
// Wake signals for the overnight classifier (background efficiency B4,
// docs/superpowers/specs/2026-09-22-background-efficiency-design.md). The
// classifier (stemAutoClassify.ts) keeps its own in-memory pending list and
// its scheduler (stemAutoClassifyScheduler.ts) sleeps once that list is
// empty; the writers that can create new classify work call in here:
//
// - noteAutoClassifyInputRow: a StemEmbeddingCache / StemFeatureCache row
//   was written (stemEmbeddingCacheStore.ts, stemFeatureCacheStore.ts, the
//   batched writer) -- the StemCID joins the pending list without a
//   re-query of the whole eligibility set.
// - noteAutoClassifyTrainingChanged: a confirmation or centroid retrain
//   (stemCategoriesStore.ts's upsertStemCategoryRole, categoryCentroidStore.ts's
//   saveCategoryCentroidStore) -- can make previously unclassifiable stems
//   classifiable, so the next batch rebuilds the whole pending list.
//
// Pure and O(1) per call; no 'electron' import, so the stores stay testable
// from plain vitest.
import type Database from 'better-sqlite3'

export type AutoClassifyInputKind = 'embedding' | 'feature'

interface AddedRows {
  embedding: Set<string>
  feature: Set<string>
}

const addedByDb = new WeakMap<Database.Database, AddedRows>()
let trainingGeneration = 0
let listener: (() => void) | null = null

function notify(): void {
  listener?.()
}

/** A cache row that can feed the classifier was written for `stemCID`. */
export function noteAutoClassifyInputRow(
  db: Database.Database,
  kind: AutoClassifyInputKind,
  stemCID: string
): void {
  let added = addedByDb.get(db)
  if (!added) {
    added = { embedding: new Set(), feature: new Set() }
    addedByDb.set(db, added)
  }
  added[kind].add(stemCID)
  notify()
}

/** Classifier training (confirmations, centroids) changed -- every pending
 * list is rebuilt from scratch on its next batch. */
export function noteAutoClassifyTrainingChanged(): void {
  trainingGeneration += 1
  notify()
}

export function getAutoClassifyTrainingGeneration(): number {
  return trainingGeneration
}

/** Takes (and clears) the rows noted for `db` since the last drain. */
export function drainAutoClassifyInputRows(db: Database.Database): {
  embedding: string[]
  feature: string[]
} {
  const added = addedByDb.get(db)
  if (!added) return { embedding: [], feature: [] }
  addedByDb.delete(db)
  return { embedding: [...added.embedding], feature: [...added.feature] }
}

/** The scheduler's wake hook -- one listener (the app has one scheduler). */
export function setAutoClassifyWakeListener(fn: (() => void) | null): void {
  listener = fn
}
