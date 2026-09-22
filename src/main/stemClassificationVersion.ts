// src/main/stemClassificationVersion.ts
//
// In-process change counter for a db's stem CLASSIFICATION tables
// (StemCategories' ArrangeRole, StemAutoCategory) -- bumped by this app's
// own writers (upsertStemCategoryRole, upsertStemAutoCategory), read by
// discoverCandidates.ts to decide when its precomputed per-kind stem lists
// (background efficiency B2) are stale. O(1) both ways; no 'electron'
// import, so the stores stay testable from plain vitest.
import type Database from 'better-sqlite3'

const versions = new WeakMap<Database.Database, number>()

export function bumpStemClassificationVersion(db: Database.Database): void {
  versions.set(db, (versions.get(db) ?? 0) + 1)
}

export function getStemClassificationVersion(db: Database.Database): number {
  return versions.get(db) ?? 0
}
