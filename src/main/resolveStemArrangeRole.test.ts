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
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
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
