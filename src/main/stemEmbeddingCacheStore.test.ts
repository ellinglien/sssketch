// src/main/stemEmbeddingCacheStore.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getStemEmbeddingCache, setStemEmbeddingCache } from './stemEmbeddingCacheStore'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
  `)
  return db
}

describe('stemEmbeddingCacheStore', () => {
  it('returns null for a stem that has never been extracted', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('abc123')
    expect(getStemEmbeddingCache(db, '/lib/abc123')).toBeNull()
  })

  it('returns null for a path that is not a real library stem', () => {
    const db = freshDb()
    expect(getStemEmbeddingCache(db, '/lib/not-a-real-stem')).toBeNull()
  })

  it('round-trips a stored embedding', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('abc123')
    const embedding = new Array(1024).fill(0).map((_, i) => i / 1024)
    setStemEmbeddingCache(db, '/lib/abc123', embedding, 1000)
    expect(getStemEmbeddingCache(db, '/lib/abc123')).toEqual(embedding)
  })

  it('overwrites a prior embedding for the same stem on re-extraction', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('abc123')
    setStemEmbeddingCache(db, '/lib/abc123', new Array(1024).fill(0), 1000)
    setStemEmbeddingCache(db, '/lib/abc123', new Array(1024).fill(1), 2000)
    expect(getStemEmbeddingCache(db, '/lib/abc123')).toEqual(new Array(1024).fill(1))
  })

  it('is a silent no-op when setting for a path that is not a real library stem', () => {
    const db = freshDb()
    expect(() => setStemEmbeddingCache(db, '/lib/not-real', [1, 2, 3], 1000)).not.toThrow()
    expect(getStemEmbeddingCache(db, '/lib/not-real')).toBeNull()
  })

  it('checks extraCandidateDbs after the primary db to resolve the StemCID', () => {
    const db = freshDb()
    const externalDb = freshDb()
    externalDb.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('ext123')
    // The embedding cache row itself always lives in the PRIMARY db, never
    // the external one -- same as stemFeatureCacheStore.ts's own contract.
    setStemEmbeddingCache(db, '/lib/ext123', [1, 2, 3], 1000, [externalDb])
    expect(getStemEmbeddingCache(db, '/lib/ext123', [externalDb])).toEqual([1, 2, 3])
    expect(
      externalDb.prepare('SELECT 1 FROM StemEmbeddingCache WHERE StemCID = ?').get('ext123')
    ).toBeUndefined()
  })
})
