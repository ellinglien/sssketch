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
})
