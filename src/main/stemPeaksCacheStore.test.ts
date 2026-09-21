import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getStemPeaksCache, setStemPeaksCache, type StemPeaks } from './stemPeaksCacheStore'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemPeaksCache (
      StemCID TEXT PRIMARY KEY, PeaksJSON TEXT NOT NULL, BrightnessJSON TEXT NOT NULL,
      ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
  `)
  return db
}

function fakePeaks(): StemPeaks {
  return {
    peaks: Array.from({ length: 128 }, (_, i) => i / 128),
    brightness: Array.from({ length: 128 }, (_, i) => 1 - i / 128)
  }
}

describe('stemPeaksCacheStore', () => {
  it('returns null for a path with no cached row yet', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    expect(getStemPeaksCache(db, '/lib/cid-1')).toBe(null)
  })

  it('round-trips a written peaks/brightness pair back out', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    const peaks = fakePeaks()
    setStemPeaksCache(db, '/lib/cid-1', peaks, 1000)
    expect(getStemPeaksCache(db, '/lib/cid-1')).toEqual(peaks)
  })

  it('a later write overwrites an earlier one for the same stem', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    setStemPeaksCache(db, '/lib/cid-1', fakePeaks(), 1000)
    const updated = { peaks: [0.9, 0.1], brightness: [0.2, 0.8] }
    setStemPeaksCache(db, '/lib/cid-1', updated, 2000)
    expect(getStemPeaksCache(db, '/lib/cid-1')).toEqual(updated)
  })

  it('silently skips writing for a path whose basename is not a real StemCID', () => {
    const db = freshDb()
    setStemPeaksCache(db, '/local/one-shot.wav', fakePeaks(), 1000)
    expect(getStemPeaksCache(db, '/local/one-shot.wav')).toBe(null)
    const count = db.prepare(`SELECT COUNT(*) as n FROM StemPeaksCache`).get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('validates and writes a stem via an extra candidate db when the primary db does not have it', () => {
    const db = freshDb()
    const externalDb = freshDb()
    externalDb.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-external')
    const peaks = fakePeaks()
    setStemPeaksCache(db, '/lore-archive/cid-external', peaks, 1000, [externalDb])
    // The row is written into `db` (the primary/own warehouse), even
    // though the StemCID was only validated against `externalDb`.
    expect(getStemPeaksCache(db, '/lore-archive/cid-external', [externalDb])).toEqual(peaks)
    const ownRow = db
      .prepare(`SELECT COUNT(*) as n FROM StemPeaksCache WHERE StemCID = ?`)
      .get('cid-external') as { n: number }
    expect(ownRow.n).toBe(1)
  })

  it('a corrupted PeaksJSON/BrightnessJSON row is treated as a miss, not a throw', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    db.prepare(
      `INSERT INTO StemPeaksCache (StemCID, PeaksJSON, BrightnessJSON, ExtractedAt)
       VALUES (?, ?, ?, ?)`
    ).run('cid-1', 'not json', '[]', 1000)
    expect(() => getStemPeaksCache(db, '/lib/cid-1')).not.toThrow()
    expect(getStemPeaksCache(db, '/lib/cid-1')).toBe(null)
  })
})
