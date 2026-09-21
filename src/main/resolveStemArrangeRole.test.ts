// src/main/resolveStemArrangeRole.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { resolveStemArrangeRole, resolveStemArrangeRoles } from './resolveStemArrangeRole'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
  `)
  return db
}

function seedConfirmed(db: Database.Database, stemCID: string, arrangeRole: string): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
     VALUES (?, ?, NULL, NULL, 'tidyup', NULL, 1000)`
  ).run(stemCID, arrangeRole)
}

function seedAuto(db: Database.Database, stemCID: string, arrangeRole: string): void {
  db.prepare(
    `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt) VALUES (?, ?, 'centroid', 1000)`
  ).run(stemCID, arrangeRole)
}

describe('resolveStemArrangeRole', () => {
  it('prefers a human-confirmed StemCategories row over everything else', () => {
    const db = freshDb()
    seedConfirmed(db, 'stem-1', 'drums')
    seedAuto(db, 'stem-1', 'lead')
    const fallback = vi.fn(() => 'vocal' as const)
    expect(resolveStemArrangeRole(db, 'stem-1', fallback)).toBe('drums')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to StemAutoCategory when there is no human confirmation', () => {
    const db = freshDb()
    seedAuto(db, 'stem-1', 'bass')
    const fallback = vi.fn(() => 'vocal' as const)
    expect(resolveStemArrangeRole(db, 'stem-1', fallback)).toBe('bass')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('ignores a StemCategories row whose ArrangeRole is null (bus-only confirmation)', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
       VALUES ('stem-1', NULL, NULL, 'drums', 'tidyup', NULL, 1000)`
    ).run()
    seedAuto(db, 'stem-1', 'drums')
    expect(resolveStemArrangeRole(db, 'stem-1', () => null)).toBe('drums')
  })

  it('calls the fallback only when neither table has an answer', () => {
    const db = freshDb()
    const fallback = vi.fn(() => 'textureFx' as const)
    expect(resolveStemArrangeRole(db, 'stem-unknown', fallback)).toBe('textureFx')
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('returns null when neither table has an answer and the fallback itself has none', () => {
    const db = freshDb()
    expect(resolveStemArrangeRole(db, 'stem-unknown', () => null)).toBeNull()
  })

  // Direct request, 2026-09-16 ("can we take a good look at the things we
  // just added... and see if we can improve the speed"): discoverAdjacency.ts's
  // own matchRole calls this once per stem while walking outward from a
  // center riff -- up to 8 stems x up to 32 riffs per direction in the
  // worst case. Proves the two lookup statements are prepared ONCE per db
  // connection, not re-parsed from scratch on every call.
  it('prepares its two lookup statements only once across many calls for the same db', () => {
    const db = freshDb()
    seedConfirmed(db, 'stem-1', 'drums')
    seedAuto(db, 'stem-2', 'bass')
    const prepareSpy = vi.spyOn(db, 'prepare')

    resolveStemArrangeRole(db, 'stem-1', () => null)
    resolveStemArrangeRole(db, 'stem-2', () => null)
    resolveStemArrangeRole(db, 'stem-3', () => 'vocal')

    const categoryQueries = prepareSpy.mock.calls.filter(([sql]) =>
      sql.includes('FROM StemCategories')
    )
    const autoQueries = prepareSpy.mock.calls.filter(([sql]) =>
      sql.includes('FROM StemAutoCategory')
    )
    expect(categoryQueries.length).toBe(1)
    expect(autoQueries.length).toBe(1)
  })

  it('prepares fresh statements for a DIFFERENT db, never reusing a stale one from another connection', () => {
    const dbA = freshDb()
    const dbB = freshDb()
    seedConfirmed(dbA, 'stem-1', 'drums')
    seedConfirmed(dbB, 'stem-1', 'bass')

    expect(resolveStemArrangeRole(dbA, 'stem-1', () => null)).toBe('drums')
    expect(resolveStemArrangeRole(dbB, 'stem-1', () => null)).toBe('bass')
  })
})

describe('resolveStemArrangeRoles', () => {
  it('resolves a batch of stems independently, each against its own fallback', () => {
    const db = freshDb()
    seedConfirmed(db, 'stem-1', 'drums')
    seedAuto(db, 'stem-2', 'bass')
    const fallbacks: Record<string, ArrangeRoleLike> = { 'stem-3': 'vocal' }
    const result = resolveStemArrangeRoles(
      db,
      ['stem-1', 'stem-2', 'stem-3'],
      (stemCID) => fallbacks[stemCID] ?? null
    )
    expect(result).toEqual({ 'stem-1': 'drums', 'stem-2': 'bass', 'stem-3': 'vocal' })
  })

  it('returns an empty object for an empty stemCID list', () => {
    const db = freshDb()
    expect(resolveStemArrangeRoles(db, [], () => null)).toEqual({})
  })
})

type ArrangeRoleLike =
  'drums' | 'bass' | 'lead' | 'backing' | 'aux' | 'textureFx' | 'fill' | 'vocal'
