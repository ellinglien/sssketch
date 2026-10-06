// src/main/stemPriority.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStemPriority, createStemPriorityCache } from './stemPriority'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stem-priority-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A LORE-shaped archive: Stems indexed on CreatorUserName. */
function archiveDb(): Database.Database {
  const db = new Database(join(dir, 'archive.db'))
  db.exec(`
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreatorUserName TEXT);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER);
  `)
  return db
}

/** sssketch's own db: Stems NOT indexed on CreatorUserName, plus stars. */
function ownDb(): Database.Database {
  const db = new Database(join(dir, 'own.db'))
  db.exec(`
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreatorUserName TEXT);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
    CREATE TABLE RiffStemsExtra (RiffCID TEXT NOT NULL, Slot INTEGER NOT NULL, StemCID TEXT NOT NULL,
      PRIMARY KEY (RiffCID, Slot));
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE StemFavourite (StemCID TEXT PRIMARY KEY, FavouritedAt INTEGER NOT NULL);
  `)
  return db
}

function stem(db: Database.Database, stemCID: string, user: string | null): void {
  db.prepare(`INSERT INTO Stems VALUES (?, 'jam', ?)`).run(stemCID, user)
}

function riff(db: Database.Database, riffCID: string, stems: string[]): void {
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)
  db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, ${cols.join(', ')}) VALUES (?, 'jam', ${cols.map(() => '?').join(', ')})`
  ).run(riffCID, ...cols.map((_, i) => stems[i] ?? null))
}

function fixture(): { archive: Database.Database; own: Database.Database } {
  const archive = archiveDb()
  const own = ownDb()
  for (const [cid, user] of [
    ['a1', 'me'],
    ['a2', 'other'],
    ['a3', 'me'],
    ['a4', null],
    ['a5', 'me'],
    ['a6', 'other'],
    ['a7', 'me']
  ] as const)
    stem(archive, cid, user)
  for (const [cid, user] of [
    ['s1', 'other'],
    ['s2', 'me'],
    ['s3', 'other'],
    ['s4', 'other'],
    ['s5', 'me']
  ] as const)
    stem(own, cid, user)
  own.prepare(`INSERT INTO StemFavourite VALUES ('star1', 0), ('a1', 0)`).run()
  // a favourite riff in the archive, and one (with a ninth slot) in the own db
  riff(archive, 'rFav', ['rs1', 'rs2'])
  riff(archive, 'rNot', ['nope'])
  archive.prepare(`INSERT INTO Tags VALUES ('rFav', 'jam', 1), ('rNot', 'jam', 0)`).run()
  riff(own, 'oFav', ['os1'])
  own.prepare(`INSERT INTO RiffStemsExtra VALUES ('oFav', 9, 'os9')`).run()
  own.prepare(`INSERT INTO Tags VALUES ('oFav', 'jam', 1)`).run()
  return { archive, own }
}

describe('buildStemPriority', () => {
  it('own stems from every db (indexed or not), across windows; favourites from stars and favourite riffs', async () => {
    const { archive, own } = fixture()
    const p = await buildStemPriority([archive, own], own, 'me', { windowSize: 2 })
    expect([...p.own].sort()).toEqual(['a1', 'a3', 'a5', 'a7', 's2', 's5'])
    expect([...p.favourites].sort()).toEqual(['a1', 'os1', 'os9', 'rs1', 'rs2', 'star1'])
    expect(p.username).toBe('me')
  })

  it('no username: no own stems, favourites still first', async () => {
    const { archive, own } = fixture()
    for (const name of [null, '', '  ']) {
      const p = await buildStemPriority([archive, own], own, name)
      expect(p.own.size).toBe(0)
      expect(p.username).toBeNull()
      expect(p.favourites.size).toBe(6)
    }
  })

  it('a db without the tables or the column gives nothing, without throwing', async () => {
    const bare = new Database(':memory:')
    bare.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY)`)
    const empty = new Database(':memory:')
    const p = await buildStemPriority([bare, empty], empty, 'me')
    expect(p.own.size).toBe(0)
    expect(p.favourites.size).toBe(0)
  })
})

describe('createStemPriorityCache', () => {
  it('builds once per username, picks up stems added since, and shares a build in flight', async () => {
    const { archive, own } = fixture()
    let builds = 0
    const cache = createStemPriorityCache({
      sourceDbs: () => [archive, own],
      ownDb: () => own,
      windowSize: 2,
      onOwnWindow: () => {
        builds += 1
      }
    })
    const [p1, p1b] = await Promise.all([cache.get('me'), cache.get('me')])
    expect(p1).toBe(p1b)
    const windowsFirst = builds
    expect([...p1.own].sort()).toEqual(['a1', 'a3', 'a5', 'a7', 's2', 's5'])

    stem(archive, 'a8', 'me')
    stem(own, 's6', 'me')
    own.prepare(`INSERT INTO StemFavourite VALUES ('star2', 0)`).run()
    const p2 = await cache.get('me')
    expect([...p2.own].sort()).toEqual(['a1', 'a3', 'a5', 'a7', 'a8', 's2', 's5', 's6'])
    expect(p2.favourites.has('star2')).toBe(true)
    // only the new rows were read: far fewer windows than the first build
    expect(builds - windowsFirst).toBeLessThan(windowsFirst)

    const other = await cache.get('other')
    expect([...other.own].sort()).toEqual(['a2', 'a6', 's1', 's3', 's4'])
    const none = await cache.get(null)
    expect(none.own.size).toBe(0)
  })

  // Review of 06eecbdc: a plain `rowid > watermark` misses a stem that
  // reuses a deleted top rowid (deleteJamRows dropping a jam's orphaned
  // stems, then a sync inserting more: a rowid table hands out MAX+1 again).
  it('a stem inserted after the top rows were deleted is picked up (and the deleted ones dropped)', async () => {
    const { archive, own } = fixture()
    const cache = createStemPriorityCache({
      sourceDbs: () => [archive, own],
      ownDb: () => own,
      windowSize: 2
    })
    await cache.get('me')
    // a7 ('me') holds the archive's top rowid; s5 ('me') the own db's
    archive.prepare(`DELETE FROM Stems WHERE StemCID IN ('a6', 'a7')`).run()
    own.prepare(`DELETE FROM Stems WHERE StemCID = 's5'`).run()
    stem(archive, 'a9', 'me') // rowid 6 again
    stem(own, 's9', 'me') // rowid 5 again
    const p = await cache.get('me')
    expect([...p.own].sort()).toEqual(['a1', 'a3', 'a5', 'a9', 's2', 's9'])
  })

  it('a renumbered table (VACUUM, a replaced file) is read again', async () => {
    const { archive, own } = fixture()
    const cache = createStemPriorityCache({ sourceDbs: () => [archive], ownDb: () => own })
    await cache.get('me')
    // same count, same MAX(rowid), different row there: as after a VACUUM
    // renumbered rowids, or the file was swapped for another
    archive.prepare(`DELETE FROM Stems WHERE StemCID = 'a7'`).run()
    archive
      .prepare(
        `INSERT INTO Stems (rowid, StemCID, OwnerJamCID, CreatorUserName) VALUES (7, 'b7', 'jam', 'me')`
      )
      .run()
    const p = await cache.get('me')
    expect([...p.own].sort()).toEqual(['a1', 'a3', 'a5', 'b7', 's2', 's5'])
  })

  it('a failed PRAGMA reads the db unindexed rather than as having no creator column', async () => {
    const { archive, own } = fixture()
    const real = archive.prepare.bind(archive)
    vi.spyOn(archive, 'prepare').mockImplementation(((sql: string) => {
      if (sql.trim().startsWith('PRAGMA')) throw new Error('database is locked')
      return real(sql)
    }) as typeof archive.prepare)
    const p = await buildStemPriority([archive], own, 'me', { windowSize: 2 })
    expect([...p.own].sort()).toEqual(['a1', 'a3', 'a5', 'a7', 's2', 's5'])
  })

  // Review of 99b33f45: the catch in refresh had no test.
  it('one db that fails its read keeps its last set; the other dbs still update', async () => {
    const { archive, own } = fixture()
    const cache = createStemPriorityCache({
      sourceDbs: () => [archive, own],
      ownDb: () => own,
      windowSize: 2
    })
    await cache.get('me')
    stem(archive, 'a8', 'me')
    stem(own, 's6', 'me')
    const real = archive.prepare.bind(archive)
    const spy = vi.spyOn(archive, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('CreatorUserName = ?')) throw new Error('disk I/O error')
      return real(sql)
    }) as typeof archive.prepare)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = await cache.get('me')
    expect([...p.own].sort()).toEqual(['a1', 'a3', 'a5', 'a7', 's2', 's5', 's6'])
    expect(errors).toHaveBeenCalledTimes(1)
    // readable again: picks up where it left off
    spy.mockRestore()
    errors.mockRestore()
    const q = await cache.get('me')
    expect([...q.own].sort()).toEqual(['a1', 'a3', 'a5', 'a7', 'a8', 's2', 's5', 's6'])
  })

  it('a version that moves when either set changes, even at the same sizes, and only then', async () => {
    const { archive, own } = fixture()
    const cache = createStemPriorityCache({ sourceDbs: () => [archive, own], ownDb: () => own })
    const p1 = await cache.get('me')
    const p2 = await cache.get('me')
    expect(p2.version).toBe(p1.version)
    // a star swapped for another: same size, different set
    own.prepare(`DELETE FROM StemFavourite WHERE StemCID = 'star1'`).run()
    own.prepare(`INSERT INTO StemFavourite VALUES ('star9', 0)`).run()
    const p3 = await cache.get('me')
    expect(p3.favourites.size).toBe(p1.favourites.size)
    expect(p3.version).not.toBe(p2.version)
    // an own stem swapped for another: same size, different set
    archive.prepare(`DELETE FROM Stems WHERE StemCID = 'a7'`).run()
    stem(archive, 'a9', 'me')
    const p4 = await cache.get('me')
    expect(p4.own.size).toBe(p1.own.size)
    expect(p4.version).not.toBe(p3.version)
    expect((await cache.get('me')).version).toBe(p4.version)
  })
})
