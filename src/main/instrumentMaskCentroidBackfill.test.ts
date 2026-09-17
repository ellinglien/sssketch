import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backfillInstrumentMaskCategories } from './instrumentMaskCentroidBackfill'

let musicDir: string
let userDataDir: string

// resolveStemPath and candidateDbsForRiff (riffLibraryStore.ts) both read
// app.getPath -- same vi.mock('electron', ...)/freshDb() pattern as
// stemCategoriesBackfill.test.ts, this task's own direct precedent, per
// this task's Step 1 instructions.
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
      OwnerJamCID TEXT NOT NULL,
      Instrument INTEGER
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
  `)
  return db
}

describe('backfillInstrumentMaskCategories', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-instrument-mask-backfill-music-test-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-instrument-mask-backfill-userdata-test-'))
  })

  afterEach(() => {
    rmSync(musicDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('writes a drums ArrangeRole for a stem with a clean drums-bit-only mask', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db
      .prepare(`SELECT ArrangeRole, Source FROM StemCategories WHERE StemCID = ?`)
      .get('stem-drums') as { ArrangeRole: string; Source: string } | undefined
    expect(row?.ArrangeRole).toBe('drums')
    expect(row?.Source).toBe('instrumentMask')
  })

  it('writes a bass ArrangeRole for a stem with a clean bass-bit-only mask', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-bass', 'jam-1', 8)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db
      .prepare(`SELECT ArrangeRole FROM StemCategories WHERE StemCID = ?`)
      .get('stem-bass') as { ArrangeRole: string } | undefined
    expect(row?.ArrangeRole).toBe('bass')
  })

  it('skips a stem whose mask has more than one bit set (ambiguous, not a clean signal)', () => {
    const db = freshDb()
    // drums bit (2) + audioIn bit (16) both set -- ambiguous, must not guess
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-mixed', 'jam-1', 18)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT * FROM StemCategories WHERE StemCID = ?`).get('stem-mixed')
    expect(row).toBeUndefined()
  })

  it('skips a stem whose mask is a bit this backfill does not touch (notes/audioIn)', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-notes', 'jam-1', 4)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db.prepare(`SELECT * FROM StemCategories WHERE StemCID = ?`).get('stem-notes')
    expect(row).toBeUndefined()
  })

  it('never overwrites an existing StemCategories row, even a low-confidence one', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()
    db.prepare(
      `INSERT INTO StemCategories (StemCID, ArrangeRole, Source, UpdatedAt)
       VALUES ('stem-drums', 'lead', 'tidyup', 1000)`
    ).run()

    backfillInstrumentMaskCategories(db)

    const row = db
      .prepare(`SELECT ArrangeRole, Source FROM StemCategories WHERE StemCID = ?`)
      .get('stem-drums') as { ArrangeRole: string; Source: string }
    expect(row.ArrangeRole).toBe('lead')
    expect(row.Source).toBe('tidyup')
  })

  it('is idempotent -- calling it twice in a row does not error or duplicate', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()

    backfillInstrumentMaskCategories(db)
    backfillInstrumentMaskCategories(db)

    const count = (db.prepare(`SELECT COUNT(*) AS n FROM StemCategories`).get() as { n: number }).n
    expect(count).toBe(1)
  })

  it('returns a summary of how many stems it categorized', () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-drums', 'jam-1', 2)`
    ).run()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('stem-bass', 'jam-1', 8)`
    ).run()

    const summary = backfillInstrumentMaskCategories(db)

    expect(summary.categorizedStems).toBe(2)
  })
})
