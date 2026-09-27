import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  RIFF_STEMS_EXTRA_DDL,
  hasExtraStemSlotsTable,
  readExtraStemSlots,
  readAllExtraStemSlots,
  writeExtraStemSlots,
  deleteExtraStemSlotsForRiff,
  deleteExtraStemSlotsForJam,
  extraStemCIDsForJam
} from './riffStemsExtra'

/** A warehouse WITH the sssketch extension -- i.e. sssketch's own. */
function ownDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  db.exec(RIFF_STEMS_EXTRA_DDL)
  return db
}

/** A warehouse WITHOUT it -- exactly what a real external OUROVEON/LORE
 * warehouse.db3 looks like, and it is opened read-only so it can never be
 * given the table. */
function externalDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  return db
}

describe('riffStemsExtra', () => {
  it('detects the table on sssketch own db and its absence on an external one', () => {
    expect(hasExtraStemSlotsTable(ownDb())).toBe(true)
    expect(hasExtraStemSlotsTable(externalDb())).toBe(false)
  })

  it('round-trips slots 9-12 for one riff', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [
      { slot: 9, stemCID: 's9' },
      { slot: 10, stemCID: 's10' },
      { slot: 11, stemCID: 's11' },
      { slot: 12, stemCID: 's12' }
    ])
    expect(readExtraStemSlots(db, ['r1']).get('r1')).toEqual([
      { slot: 9, stemCID: 's9' },
      { slot: 10, stemCID: 's10' },
      { slot: 11, stemCID: 's11' },
      { slot: 12, stemCID: 's12' }
    ])
  })

  it('reads several riffs in one query and keys them apart', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])
    const map = readExtraStemSlots(db, ['r1', 'r2', 'r3'])
    expect(map.get('r1')).toEqual([{ slot: 9, stemCID: 'a' }])
    expect(map.get('r2')).toEqual([{ slot: 9, stemCID: 'b' }])
    expect(map.has('r3')).toBe(false)
  })

  it('rewriting a riff replaces its extras rather than accumulating them', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [
      { slot: 9, stemCID: 'a' },
      { slot: 10, stemCID: 'b' }
    ])
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'c' }])
    expect(readExtraStemSlots(db, ['r1']).get('r1')).toEqual([{ slot: 9, stemCID: 'c' }])
  })

  it('shrinking a riff back under nine leaves no rows behind', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r1', [])
    expect(readExtraStemSlots(db, ['r1']).has('r1')).toBe(false)
  })

  it('refuses a slot inside the column range at the storage layer', () => {
    const db = ownDb()
    expect(() => writeExtraStemSlots(db, 'r1', [{ slot: 8, stemCID: 'a' }])).toThrow()
  })

  it('readAllExtraStemSlots returns the whole table in one pass', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])
    const all = readAllExtraStemSlots(db)
    expect(all.size).toBe(2)
    expect(all.get('r2')).toEqual([{ slot: 9, stemCID: 'b' }])
  })

  it('every reader is empty, not an error, against a db with no such table', () => {
    const db = externalDb()
    expect(readExtraStemSlots(db, ['r1']).size).toBe(0)
    expect(readAllExtraStemSlots(db).size).toBe(0)
    expect(extraStemCIDsForJam(db, 'jam1')).toEqual([])
  })

  it('every writer is a no-op, not an error, against a db with no such table', () => {
    const db = externalDb()
    expect(() => writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])).not.toThrow()
    expect(() => deleteExtraStemSlotsForRiff(db, 'r1')).not.toThrow()
    expect(() => deleteExtraStemSlotsForJam(db, 'jam1')).not.toThrow()
  })

  it('deletes one riff extras without touching another', () => {
    const db = ownDb()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])
    deleteExtraStemSlotsForRiff(db, 'r1')
    expect(readAllExtraStemSlots(db).size).toBe(1)
  })

  it('collects and deletes a whole jam extras through the Riffs join', () => {
    const db = ownDb()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r1', 'jamA')`).run()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r2', 'jamB')`).run()
    writeExtraStemSlots(db, 'r1', [{ slot: 9, stemCID: 'a' }])
    writeExtraStemSlots(db, 'r2', [{ slot: 9, stemCID: 'b' }])

    expect(extraStemCIDsForJam(db, 'jamA')).toEqual(['a'])
    deleteExtraStemSlotsForJam(db, 'jamA')
    expect(extraStemCIDsForJam(db, 'jamA')).toEqual([])
    expect(extraStemCIDsForJam(db, 'jamB')).toEqual(['b'])
  })

  it('reads more riffCIDs than one SQL statement can bind, in chunks', () => {
    const db = ownDb()
    const riffCIDs = Array.from({ length: 2500 }, (_, i) => `r${i}`)
    for (const riffCID of riffCIDs)
      writeExtraStemSlots(db, riffCID, [{ slot: 9, stemCID: riffCID }])
    expect(readExtraStemSlots(db, riffCIDs).size).toBe(2500)
  })
})
