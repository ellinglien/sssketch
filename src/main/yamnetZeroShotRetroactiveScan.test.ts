import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listYamnetZeroShotRetroactiveTargets } from './yamnetZeroShotRetroactiveScan'

let musicDir: string
let userDataDir: string

// resolveStemPath (riffLibraryStore.ts) reads app.getPath -- same
// vi.mock('electron', ...)/freshDb() pattern as
// instrumentMaskCentroidBackfill.test.ts, its own direct precedent.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY,
      OwnerJamCID TEXT NOT NULL
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemYamnetZeroShotAttempted (
      StemCID TEXT PRIMARY KEY, AttemptedAt INTEGER NOT NULL
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

function seedStem(db: Database.Database, stemCID: string, jamCID = 'jam-1'): void {
  db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, ?)`).run(stemCID, jamCID)
}

function seedEmbedding(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, '[]', 1000)`
  ).run(stemCID)
}

describe('listYamnetZeroShotRetroactiveTargets', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-yamnet-retro-music-test-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-yamnet-retro-userdata-test-'))
  })

  afterEach(() => {
    rmSync(musicDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns a stem with a cached embedding and no attempt recorded', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')

    const targets = listYamnetZeroShotRetroactiveTargets(db, () => true)

    expect(targets).toHaveLength(1)
    expect(targets[0].path).toContain('s1')
  })

  it('excludes a stem with no cached embedding at all', () => {
    const db = freshDb()
    seedStem(db, 's1')

    expect(listYamnetZeroShotRetroactiveTargets(db, () => true)).toEqual([])
  })

  it('excludes a stem already marked attempted', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')
    db.prepare(
      `INSERT INTO StemYamnetZeroShotAttempted (StemCID, AttemptedAt) VALUES ('s1', 1000)`
    ).run()

    expect(listYamnetZeroShotRetroactiveTargets(db, () => true)).toEqual([])
  })

  it('excludes a stem already confirmed in StemCategories', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')
    db.prepare(
      `INSERT INTO StemCategories (StemCID, ArrangeRole, Source, UpdatedAt)
       VALUES ('s1', 'bass', 'tidyup', 1000)`
    ).run()

    expect(listYamnetZeroShotRetroactiveTargets(db, () => true)).toEqual([])
  })

  it('excludes a stem that already has ANY StemAutoCategory row', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')
    db.prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
       VALUES ('s1', 'drums', 'embedding', 1000)`
    ).run()

    expect(listYamnetZeroShotRetroactiveTargets(db, () => true)).toEqual([])
  })

  it('returns multiple eligible stems', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')
    seedStem(db, 's2')
    seedEmbedding(db, 's2')

    expect(listYamnetZeroShotRetroactiveTargets(db, () => true)).toHaveLength(2)
  })

  it('excludes a stem whose resolved path does not exist on disk (code review, 2026-09-17)', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')
    seedStem(db, 's2')
    seedEmbedding(db, 's2')

    const targets = listYamnetZeroShotRetroactiveTargets(db, (path) => !path.includes('s1'))

    expect(targets).toHaveLength(1)
    expect(targets[0].path).toContain('s2')
  })

  it('defaults to the real existsSync when no existsFn is supplied, excluding a genuinely missing file', () => {
    const db = freshDb()
    seedStem(db, 's1')
    seedEmbedding(db, 's1')

    // No real file was ever written for 's1' under this test's own tmp
    // music dir -- exercises the real default (existsSync), not a stub.
    expect(listYamnetZeroShotRetroactiveTargets(db)).toEqual([])
  })
})
