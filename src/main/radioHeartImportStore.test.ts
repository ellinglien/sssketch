import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { heartNameForRiff } from './radioHeartImportStore'

describe('heartNameForRiff', () => {
  it('reads the label for a riff', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE RadioHeartImport (
      Combo TEXT PRIMARY KEY, RiffCID TEXT NOT NULL, Name TEXT NOT NULL, ImportedAt INTEGER NOT NULL
    )`)
    db.prepare(`INSERT INTO RadioHeartImport VALUES ('a,b', 'r1', '♥ 2 · pale ibis', 1)`).run()
    expect(heartNameForRiff(db, 'r1')).toBe('♥ 2 · pale ibis')
    expect(heartNameForRiff(db, 'r2')).toBeNull()
  })

  it('reads a db without the table as no name', () => {
    expect(heartNameForRiff(new Database(':memory:'), 'r1')).toBeNull()
  })

  it('lets any other error through', () => {
    const db = new Database(':memory:')
    db.close()
    expect(() => heartNameForRiff(db, 'r1')).toThrow(/not open/i)
  })
})
