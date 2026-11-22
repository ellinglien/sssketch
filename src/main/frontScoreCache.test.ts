import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { getFrontScores } from './frontScoreCache'
import { bumpStemClassificationVersion } from './stemClassificationVersion'

function dbWithScores(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE StemAutoCategory (
    StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
    ComputedAt INTEGER NOT NULL, FrontScore REAL
  );
  CREATE TABLE StemCategories (
    StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
    Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
  )`)
  const insert = db.prepare(
    `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt, FrontScore) VALUES (?, ?, ?, 1, ?)`
  )
  insert.run('a', 'backing', 'model', 0.1)
  insert.run('b', 'backing', 'model', 0.5)
  insert.run('c', 'lead', 'model', 0.9)
  insert.run('d', 'drums', 'model', null)
  // An older app's leftover: not a placed row, never read.
  insert.run('e', 'lead', 'centroid', 0.7)
  // A labelled stem's stale model row: its label sets its dial, so its score stays out of the table.
  insert.run('f', 'lead', 'model', 0.95)
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, Source, UpdatedAt) VALUES ('f', 'backing', 'tidyup', 1)`
  ).run()
  // Labelled on the bus axis only: not a role label, so its score counts.
  insert.run('g', 'lead', 'model', 0.6)
  db.prepare(
    `INSERT INTO StemCategories (StemCID, BusId, Source, UpdatedAt) VALUES ('g', 'lead', 'tidyup', 1)`
  ).run()
  return db
}

describe('getFrontScores', () => {
  it('reads every placed, unlabelled FrontScore and builds its table', () => {
    const { byStemCID, table } = getFrontScores(dbWithScores(), 0)
    expect([...byStemCID].sort()).toEqual([
      ['a', 0.1],
      ['b', 0.5],
      ['c', 0.9],
      ['g', 0.6]
    ])
    expect(table?.[0]).toBe(0.1)
    expect(table?.[table.length - 1]).toBe(0.9)
  })

  it('caches until the auto version moves and 10 s have passed', () => {
    const db = dbWithScores()
    const first = getFrontScores(db, 0)
    expect(getFrontScores(db, 1_000)).toBe(first)
    db.prepare(`UPDATE StemAutoCategory SET FrontScore = 0.3 WHERE StemCID = 'c'`).run()
    bumpStemClassificationVersion(db, 'auto')
    expect(getFrontScores(db, 5_000)).toBe(first)
    const rebuilt = getFrontScores(db, 11_000)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.byStemCID.get('c')).toBe(0.3)
  })

  it('rebuilds after a label, which takes the stem out', () => {
    const db = dbWithScores()
    const first = getFrontScores(db, 0)
    db.prepare(
      `INSERT INTO StemCategories (StemCID, ArrangeRole, Source, UpdatedAt) VALUES ('c', 'lead', 'tidyup', 2)`
    ).run()
    bumpStemClassificationVersion(db, 'confirmed')
    expect(getFrontScores(db, 11_000).byStemCID.has('c')).toBe(false)
    expect(first.byStemCID.has('c')).toBe(true)
  })
})
