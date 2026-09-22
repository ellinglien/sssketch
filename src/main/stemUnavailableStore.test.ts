import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  clearStemUnavailable,
  countUnavailableStems,
  isStemUnavailable,
  loadUnavailableStemCIDs,
  markStemUnavailable
} from './stemUnavailableStore'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemUnavailable (
      StemCID TEXT PRIMARY KEY, Reason TEXT NOT NULL, CheckedAt INTEGER NOT NULL
    );
  `)
  return db
}

describe('stemUnavailableStore', () => {
  it('reports a stem nobody has marked as available', () => {
    const db = freshDb()
    expect(isStemUnavailable(db, 'stem-1')).toBe(false)
  })

  it('remembers a stem marked unavailable, with its reason', () => {
    const db = freshDb()
    markStemUnavailable(db, 'stem-1', 'http 403', 1000)
    expect(isStemUnavailable(db, 'stem-1')).toBe(true)
    const row = db
      .prepare(`SELECT Reason, CheckedAt FROM StemUnavailable WHERE StemCID = ?`)
      .get('stem-1')
    expect(row).toEqual({ Reason: 'http 403', CheckedAt: 1000 })
  })

  it('re-marking a stem updates the reason and timestamp rather than failing', () => {
    const db = freshDb()
    markStemUnavailable(db, 'stem-1', 'http 403', 1000)
    markStemUnavailable(db, 'stem-1', 'http 404', 2000)
    expect(countUnavailableStems(db)).toBe(1)
    const row = db
      .prepare(`SELECT Reason, CheckedAt FROM StemUnavailable WHERE StemCID = ?`)
      .get('stem-1')
    expect(row).toEqual({ Reason: 'http 404', CheckedAt: 2000 })
  })

  it('clearing a stem makes it available again -- a host that comes back heals itself', () => {
    const db = freshDb()
    markStemUnavailable(db, 'stem-1', 'http 403', 1000)
    clearStemUnavailable(db, 'stem-1')
    expect(isStemUnavailable(db, 'stem-1')).toBe(false)
    expect(countUnavailableStems(db)).toBe(0)
  })

  it('loads every marked stem as a set for candidate filtering', () => {
    const db = freshDb()
    markStemUnavailable(db, 'stem-1', 'http 403', 1000)
    markStemUnavailable(db, 'stem-2', 'http 403', 1000)
    expect([...loadUnavailableStemCIDs(db)].sort()).toEqual(['stem-1', 'stem-2'])
  })

  it('the loaded set reflects a mark made after it was first loaded', () => {
    const db = freshDb()
    markStemUnavailable(db, 'stem-1', 'http 403', 1000)
    expect(loadUnavailableStemCIDs(db).size).toBe(1)
    markStemUnavailable(db, 'stem-2', 'http 403', 1000)
    expect(loadUnavailableStemCIDs(db).size).toBe(2)
    clearStemUnavailable(db, 'stem-1')
    expect([...loadUnavailableStemCIDs(db)]).toEqual(['stem-2'])
  })

  it('degrades to empty (never throws) against a db with no StemUnavailable table', () => {
    const db = new Database(':memory:')
    expect(loadUnavailableStemCIDs(db).size).toBe(0)
    expect(isStemUnavailable(db, 'stem-1')).toBe(false)
    expect(countUnavailableStems(db)).toBe(0)
    expect(() => markStemUnavailable(db, 'stem-1', 'http 403', 1000)).not.toThrow()
  })
})
