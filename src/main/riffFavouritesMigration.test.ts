import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL, SyncComplete INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL, Instrument INTEGER,
      Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
    CREATE TABLE StemLedger (StemCID TEXT PRIMARY KEY, Type TEXT NOT NULL, Note TEXT);
  `)
  return db
}

describe('riffFavouritesMigration', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-favourites-migration-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('copies every legacy favourite into Tags as a new favourited row', async () => {
    writeFileSync(
      join(userDataDir, 'riffFavourites.json'),
      JSON.stringify({ riffCIDs: ['riff_1', 'riff_2'] })
    )
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    migrateLegacyFavourites(db)
    const rows = db.prepare('SELECT RiffCID, Favour FROM Tags ORDER BY RiffCID').all()
    expect(rows).toEqual([
      { RiffCID: 'riff_1', Favour: 1 },
      { RiffCID: 'riff_2', Favour: 1 }
    ])
  })

  it('is idempotent -- running it twice does not error or duplicate rows', async () => {
    writeFileSync(
      join(userDataDir, 'riffFavourites.json'),
      JSON.stringify({ riffCIDs: ['riff_1'] })
    )
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    migrateLegacyFavourites(db)
    migrateLegacyFavourites(db)
    const rows = db.prepare('SELECT COUNT(*) as n FROM Tags').get() as { n: number }
    expect(rows.n).toBe(1)
  })

  it('does not overwrite an existing Tags row that was already un-favourited in the new system', async () => {
    writeFileSync(
      join(userDataDir, 'riffFavourites.json'),
      JSON.stringify({ riffCIDs: ['riff_1'] })
    )
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    db.prepare('INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES (?, NULL, 0)').run('riff_1')
    migrateLegacyFavourites(db)
    const row = db.prepare('SELECT Favour FROM Tags WHERE RiffCID = ?').get('riff_1') as {
      Favour: number
    }
    expect(row.Favour).toBe(0)
  })

  it('does nothing when no legacy favourites file exists', async () => {
    const { migrateLegacyFavourites } = await import('./riffFavouritesMigration')
    const db = freshDb()
    expect(() => migrateLegacyFavourites(db)).not.toThrow()
    const rows = db.prepare('SELECT COUNT(*) as n FROM Tags').get() as { n: number }
    expect(rows.n).toBe(0)
  })
})
