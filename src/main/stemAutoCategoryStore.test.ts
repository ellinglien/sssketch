// src/main/stemAutoCategoryStore.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  getAllAutoCategorizedStemCIDs,
  getAutoCategorizedStemCIDs,
  upsertStemAutoCategory
} from './stemAutoCategoryStore'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

describe('upsertStemAutoCategory / getAutoCategorizedStemCIDs', () => {
  it('inserts a new row, readable by role', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 's1', 'drums', 'embedding', 1000)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['s1']))
    expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set())
  })

  it('overwrites an existing row on conflict rather than throwing', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 's1', 'drums', 'embedding', 1000)
    upsertStemAutoCategory(db, 's1', 'bass', 'centroid', 2000)

    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set())
    expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set(['s1']))

    const row = db
      .prepare(`SELECT Source, ComputedAt FROM StemAutoCategory WHERE StemCID = ?`)
      .get('s1') as {
      Source: string
      ComputedAt: number
    }
    expect(row).toEqual({ Source: 'centroid', ComputedAt: 2000 })
  })
})

describe('getAllAutoCategorizedStemCIDs', () => {
  it('returns every StemCID regardless of role', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 's1', 'drums', 'embedding', 1000)
    upsertStemAutoCategory(db, 's2', 'bass', 'centroid', 1000)
    expect(getAllAutoCategorizedStemCIDs(db)).toEqual(new Set(['s1', 's2']))
  })

  it('returns an empty set when the table is empty', () => {
    const db = freshDb()
    expect(getAllAutoCategorizedStemCIDs(db)).toEqual(new Set())
  })
})
