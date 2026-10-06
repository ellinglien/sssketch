// src/main/ownStemIndex.test.ts
//
// The own-only index a full rebuild serves first (faster startup plan,
// docs/superpowers/plans/2026-10-06-faster-startup.md). Opens databases, so
// it is on vitest.config.ts's CI exclusion list.
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'
import { buildOwnStemIndex } from './ownStemIndex'

/** `lore`: the archive's shape, with Stems_IndexUser and Riff_IndexUser. */
function library(lore: boolean): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (StemCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL,
      Instrument INTEGER, CreatorUserName TEXT, PRIMARY KEY(StemCID));
    CREATE TABLE Riffs (RiffCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL,
      CreationTime INTEGER, BPMrnd REAL, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT, PRIMARY KEY(RiffCID));
  `)
  if (lore) {
    db.exec(`CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);
             CREATE INDEX Riff_IndexUser ON Riffs (UserName);`)
  }
  return db
}

function stem(db: Database.Database, cid: string, user: string | null, instrument = 2): void {
  db.prepare(`INSERT INTO Stems VALUES (?, 'jam1', ?, ?)`).run(cid, instrument, user)
}

function riff(db: Database.Database, cid: string, user: string | null, stems: string[]): void {
  const slots = [...stems, ...Array(8 - stems.length).fill(null)]
  db.prepare(`INSERT INTO Riffs VALUES (?, 'jam1', 1000, 120, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    cid,
    user,
    ...slots
  )
}

describe('buildOwnStemIndex on an archive with username indexes', () => {
  it("holds the user's own stems, each in the smallest-RiffCID riff of theirs that holds it", async () => {
    const db = library(true)
    stem(db, 'mine1', 'elling', 4)
    stem(db, 'mine2', 'elling', 8)
    stem(db, 'mine3', 'elling') // only in someone else's riff
    stem(db, 'theirs', 'other')
    riff(db, 'r9', 'elling', ['mine1', 'theirs'])
    riff(db, 'r5', 'elling', ['mine1', 'mine2'])
    riff(db, 'r1', 'other', ['mine1', 'mine3']) // smaller, but not his riff
    const own = await buildOwnStemIndex(db, 'elling', { pageSize: 1 })
    expect(own.username).toBe('elling')
    expect([...own.riffIndex.keys()].sort()).toEqual(['mine1', 'mine2'])
    expect(own.riffIndex.get('mine1')).toEqual({
      riffCID: 'r5',
      ownerJamCID: 'jam1',
      bpmRnd: 120,
      creationTime: 1000
    })
    expect(own.rows).toEqual([
      { StemCID: 'mine1', Instrument: 4, OwnerJamCID: 'jam1' },
      { StemCID: 'mine2', Instrument: 8, OwnerJamCID: 'jam1' },
      { StemCID: 'mine3', Instrument: 2, OwnerJamCID: 'jam1' }
    ])
    // What stemPriority would have read for the same user, and its watermark.
    expect(own.stems).toEqual({
      own: new Set(['mine1', 'mine2', 'mine3']),
      watermark: { count: 4, maxRowid: 4, keyAtMax: 'theirs' },
      head: expect.objectContaining({ maxRowid: 4 })
    })
  })
})

describe('buildOwnStemIndex on a db without them (the own db)', () => {
  it('walks every riff, keeping only own stems, smallest RiffCID first, slots 9+ included', async () => {
    const db = library(false)
    db.exec(RIFF_STEMS_EXTRA_DDL)
    stem(db, 'mine1', 'elling')
    stem(db, 'mine2', 'elling')
    stem(db, 'theirs', 'other')
    riff(db, 'r9', null, ['mine1', 'theirs'])
    riff(db, 'r5', '', ['mine1'])
    riff(db, 'r7', null, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    db.prepare(
      `INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES ('r7', 9, 'mine2')`
    ).run()
    const own = await buildOwnStemIndex(db, 'elling', { pageSize: 2 })
    expect(own.riffIndex.get('mine1')?.riffCID).toBe('r5')
    expect(own.riffIndex.get('mine2')?.riffCID).toBe('r7')
    expect(own.riffIndex.has('theirs')).toBe(false)
    expect(own.rows.map((r) => r.StemCID)).toEqual(['mine1', 'mine2'])
  })

  it('is empty, never a throw, for a db missing its tables or a user with no stems', async () => {
    const empty = new Database(':memory:')
    expect(await buildOwnStemIndex(empty, 'elling')).toMatchObject({ rows: [] })
    const db = library(true)
    stem(db, 'x', 'other')
    const own = await buildOwnStemIndex(db, 'elling')
    expect(own.rows).toEqual([])
    expect(own.riffIndex.size).toBe(0)
    expect(own.stems?.own.size).toBe(0)
  })
})
