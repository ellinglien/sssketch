import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string
let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
    CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL);
  `)
  return db
}

function writeSketch(
  name: string,
  contents: { busOf: Record<string, string>; rifffs: Record<string, unknown> }
): string {
  const dir = join(musicDir, 'sssketch', 'projects', name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.sssketchproj`)
  writeFileSync(path, JSON.stringify(contents), 'utf-8')
  return path
}

describe('stemCategoriesBackfill', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-backfill-music-test-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-backfill-userdata-test-'))
  })

  afterEach(() => {
    rmSync(musicDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('recovers busOf entries whose stem path resolves to a real StemCID', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.scannedProjects).toBe(1)
    expect(summary.categorizedStems).toBe(1)
    const row = getStemCategory(db, 'cid-1')
    expect(row?.busId).toBe('drums')
    expect(row?.source).toBe('backfill')
    expect(row?.sourceProject).toBe(join(musicDir, 'sssketch', 'projects', 'my-sketch', 'my-sketch.sssketchproj'))
  })

  it('skips a busOf entry whose stemKey has no matching rifff/stem in the same file', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums', 'group-b:1': 'bass' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.categorizedStems).toBe(1)
  })

  it('a more-recently-modified project wins when two projects categorize the same stem differently', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('older', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const olderPath = join(musicDir, 'sssketch', 'projects', 'older', 'older.sssketchproj')
    const olderStat = statSync(olderPath)
    // Force a real, distinct mtime ordering regardless of filesystem
    // timestamp resolution -- retry writing 'newer' until its mtime is
    // strictly greater than 'older's, bounded so this can never hang.
    let newerPath = ''
    for (let i = 0; i < 50; i++) {
      newerPath = writeSketch('newer', {
        busOf: { 'group-a:1': 'bass' },
        rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
      })
      if (statSync(newerPath).mtimeMs > olderStat.mtimeMs) break
    }
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    backfillStemCategoriesFromProjectLibrary(db)
    expect(getStemCategory(db, 'cid-1')?.busId).toBe('bass')
  })

  it('is safe to re-run: re-running with no changes does not throw and leaves rows as-is', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    backfillStemCategoriesFromProjectLibrary(db)
    expect(() => backfillStemCategoriesFromProjectLibrary(db)).not.toThrow()
    expect(getStemCategory(db, 'cid-1')?.busId).toBe('drums')
  })

  it('records an unparsable project file as skipped rather than throwing', async () => {
    const db = freshDb()
    const dir = join(musicDir, 'sssketch', 'projects', 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.sssketchproj'), 'not valid json', 'utf-8')
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.skippedProjects).toEqual(['broken'])
    expect(summary.categorizedStems).toBe(0)
  })
})
