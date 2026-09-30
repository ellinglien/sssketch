import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { addStemFavourites, listStemFavourites, toggleStemFavourite } from './stemFavouriteStore'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE StemFavourite (StemCID TEXT PRIMARY KEY, FavouritedAt INTEGER NOT NULL)`)
  return db
}

describe('addStemFavourites', () => {
  it('stars stems that are not starred and counts only those', () => {
    const db = freshDb()
    toggleStemFavourite(db, 'a')
    expect(addStemFavourites(db, ['a', 'b', 'c'])).toBe(2)
    expect(listStemFavourites(db).sort()).toEqual(['a', 'b', 'c'])
  })

  it('is idempotent -- never un-stars, never duplicates', () => {
    const db = freshDb()
    addStemFavourites(db, ['a'])
    const before = db.prepare(`SELECT FavouritedAt FROM StemFavourite WHERE StemCID = 'a'`).get()
    expect(addStemFavourites(db, ['a', 'a'])).toBe(0)
    expect(listStemFavourites(db)).toEqual(['a'])
    expect(db.prepare(`SELECT FavouritedAt FROM StemFavourite WHERE StemCID = 'a'`).get()).toEqual(
      before
    )
  })
})
