// src/main/stemClassificationVersion.ts
//
// In-process change counter for a db's stem CLASSIFICATION tables
// (StemCategories' ArrangeRole, StemAutoCategory) -- bumped by this app's
// own writers (upsertStemCategoryRole, upsertStemAutoCategory), read by
// discoverCandidates.ts to decide when its precomputed per-kind stem lists
// (background efficiency B2) are stale. O(1) both ways; no 'electron'
// import, so the stores stay testable from plain vitest.
//
// One counter PER TABLE since scan plan b21ea5a2 Task 10: a confirmation
// ('confirmed', StemCategories) rebuilds the whole kind index, an overnight
// guess ('auto', StemAutoCategory -- about once a second while zero-shot
// work is pending) only its small guess layer.
import type Database from 'better-sqlite3'

export type ClassificationTable = 'confirmed' | 'auto'

const versions = new WeakMap<Database.Database, Record<ClassificationTable, number>>()

export function bumpStemClassificationVersion(
  db: Database.Database,
  table: ClassificationTable
): void {
  const v = versions.get(db) ?? { confirmed: 0, auto: 0 }
  v[table] += 1
  versions.set(db, v)
}

export function getStemClassificationVersion(
  db: Database.Database,
  table: ClassificationTable
): number {
  return versions.get(db)?.[table] ?? 0
}
