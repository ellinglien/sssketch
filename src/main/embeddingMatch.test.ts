// src/main/embeddingMatch.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getConfirmedEmbeddings } from './embeddingMatch'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY,
      ArrangeRole TEXT,
      DrumSubRole TEXT,
      BusId TEXT,
      Source TEXT NOT NULL,
      SourceProject TEXT,
      UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
  `)
  return db
}

function seedStem(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(stemCID)
}

function seedCategory(
  db: Database.Database,
  stemCID: string,
  fields: { busId?: string; arrangeRole?: string; drumSubRole?: string }
): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, BusId, ArrangeRole, DrumSubRole, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @busId, @arrangeRole, @drumSubRole, 'test', NULL, 1000)`
  ).run({
    stemCID,
    busId: fields.busId ?? null,
    arrangeRole: fields.arrangeRole ?? null,
    drumSubRole: fields.drumSubRole ?? null
  })
}

function seedEmbedding(db: Database.Database, stemCID: string, embedding: number[]): void {
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, JSON.stringify(embedding))
}

describe('getConfirmedEmbeddings', () => {
  it('returns an empty array when nothing is confirmed', () => {
    const db = freshDb()
    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([])
  })

  it('only includes stems with BOTH a confirmed category on the axis AND a cached embedding', () => {
    const db = freshDb()
    seedStem(db, 'a')
    seedCategory(db, 'a', { busId: 'drums' })
    // No embedding for 'a' yet -- excluded.
    seedStem(db, 'b')
    seedCategory(db, 'b', { busId: 'bass' })
    seedEmbedding(db, 'b', [1, 2, 3])
    seedStem(db, 'c')
    // Embedding but no confirmed bus -- excluded.
    seedEmbedding(db, 'c', [4, 5, 6])

    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([{ category: 'bass', embedding: [1, 2, 3] }])
  })

  it('reads the ArrangeRole column for the arrangeRole axis, DrumSubRole for the drumSubRole axis', () => {
    const db = freshDb()
    seedStem(db, 'a')
    seedCategory(db, 'a', { arrangeRole: 'vocal' })
    seedEmbedding(db, 'a', [1, 0, 0])
    seedStem(db, 'b')
    seedCategory(db, 'b', { arrangeRole: 'drums', drumSubRole: 'kick' })
    seedEmbedding(db, 'b', [0, 1, 0])

    expect(getConfirmedEmbeddings(db, 'arrangeRole')).toEqual(
      expect.arrayContaining([
        { category: 'vocal', embedding: [1, 0, 0] },
        { category: 'drums', embedding: [0, 1, 0] }
      ])
    )
    expect(getConfirmedEmbeddings(db, 'drumSubRole')).toEqual([
      { category: 'kick', embedding: [0, 1, 0] }
    ])
  })

  // No extraCandidateDbs param (removed 2026-09-15, real-world bug fix) --
  // an external LORE archive db never has StemCategories/StemEmbeddingCache
  // at all (they're sssketch-exclusive tables), so querying one would throw
  // "no such table" rather than just correctly finding nothing. Confirmed
  // embeddings can only ever live in the own db -- see getConfirmedEmbeddings's
  // own doc comment.
  it('does not throw or query anything beyond the given db (no extraCandidateDbs param)', () => {
    const db = freshDb()
    seedStem(db, 'own1')
    seedCategory(db, 'own1', { busId: 'drums' })
    seedEmbedding(db, 'own1', [1, 1, 1])

    expect(() => getConfirmedEmbeddings(db, 'bus')).not.toThrow()
    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([{ category: 'drums', embedding: [1, 1, 1] }])
  })

  it('silently skips a row whose EmbeddingJSON fails to parse, rather than throwing', () => {
    const db = freshDb()
    seedStem(db, 'good')
    seedCategory(db, 'good', { busId: 'drums' })
    seedEmbedding(db, 'good', [1, 2, 3])
    seedStem(db, 'corrupt')
    seedCategory(db, 'corrupt', { busId: 'bass' })
    // Bypasses seedEmbedding's own JSON.stringify to insert genuinely
    // malformed JSON directly, simulating a corrupted DB file -- same
    // defensive scenario stemEmbeddingCacheStore.ts's own
    // getStemEmbeddingCache is documented to handle identically.
    db.prepare(
      `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, ?, ?)`
    ).run('corrupt', 'not valid json{{{', 1000)

    expect(() => getConfirmedEmbeddings(db, 'bus')).not.toThrow()
    expect(getConfirmedEmbeddings(db, 'bus')).toEqual([{ category: 'drums', embedding: [1, 2, 3] }])
  })
})
