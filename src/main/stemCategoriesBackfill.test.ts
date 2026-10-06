import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
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
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
  `)
  return db
}

const FEATURES = {
  transientDensity: 0.5,
  bassEnergyRatio: 0.3,
  spectralCentroidHz: 1200,
  zcrBrightness: 0.4,
  voicedFraction: 0.1,
  pitchVarianceCents: 20,
  mfcc: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]
}

/** A Stems row with cached features: everything the backfill can learn. */
function analysedStem(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(stemCID)
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
  ).run(stemCID, JSON.stringify(FEATURES))
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
    expect(row?.sourceProject).toBe(
      join(musicDir, 'sssketch', 'projects', 'my-sketch', 'my-sketch.sssketchproj')
    )
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

  // Background scan audit "Minor" (plan Task 13 M1): every launch re-parsed
  // every project file before the window opened.
  it('a second run parses nothing; a touched file is parsed again', async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    analysedStem(db, 'cid-2')
    writeSketch('one', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    writeSketch('two', {
      busOf: { 'group-b:1': 'bass' },
      rifffs: { 'group-b': { groupId: 'group-b', stems: [{ slot: 1, path: '/lib/cid-2' }] } }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    const reads: string[] = []
    const readFile = (path: string): string => {
      reads.push(path)
      return readFileSync(path, 'utf-8')
    }

    const first = backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(reads).toHaveLength(2)
    expect(first).toMatchObject({ scannedProjects: 2, unchangedProjects: 0, categorizedStems: 2 })

    reads.length = 0
    const second = backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(reads).toEqual([])
    expect(second).toMatchObject({ scannedProjects: 2, unchangedProjects: 2, categorizedStems: 0 })

    const touched = writeSketch('two', {
      busOf: { 'group-b:1': 'drums', 'group-b:2': 'bass' },
      rifffs: { 'group-b': { groupId: 'group-b', stems: [{ slot: 1, path: '/lib/cid-2' }] } }
    })
    const third = backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(reads).toEqual([touched])
    expect(third).toMatchObject({ unchangedProjects: 1, categorizedStems: 1 })
    expect(getStemCategory(db, 'cid-2')?.busId).toBe('drums')
    expect(getStemCategory(db, 'cid-1')?.busId).toBe('drums')
  })

  // A version of a project is only stamped once it has nothing left to give:
  // a stem the Stems tables don't hold yet (the archive unmounted, a jam not
  // synced) or one without features (nothing to train from) is retried.
  it('a project with a stem not yet resolvable or analysed is parsed again until it is', async () => {
    const db = freshDb()
    writeSketch('waiting', {
      busOf: { 'group-a:1': 'drums', 'group-a:2': 'bass' },
      rifffs: {
        'group-a': {
          groupId: 'group-a',
          stems: [
            { slot: 1, path: '/lib/cid-1' },
            { slot: 2, path: '/drops/kick.wav' } // never a StemCID: never waited for
          ]
        }
      }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    let reads = 0
    const readFile = (path: string): string => {
      reads += 1
      return readFileSync(path, 'utf-8')
    }
    backfillStemCategoriesFromProjectLibrary(db, { readFile }) // cid-1 unknown
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    backfillStemCategoriesFromProjectLibrary(db, { readFile }) // known, no features
    expect(reads).toBe(2)
    expect(getStemCategory(db, 'cid-1')?.busId).toBe('drums')
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
    ).run('cid-1', JSON.stringify(FEATURES))
    backfillStemCategoriesFromProjectLibrary(db, { readFile }) // complete: stamped
    backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(reads).toBe(3)
  })

  it('an unparsable project file is tried (and reported) again next launch', async () => {
    const db = freshDb()
    const dir = join(musicDir, 'sssketch', 'projects', 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.sssketchproj'), 'not valid json', 'utf-8')
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    backfillStemCategoriesFromProjectLibrary(db)
    expect(backfillStemCategoriesFromProjectLibrary(db).skippedProjects).toEqual(['broken'])
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

  it('trains centroid classifiers when backfill entries have cached features', async () => {
    const db = freshDb()
    // Seed a stem with cached features
    const stemCID = 'cid-1'
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(stemCID)
    const features = {
      transientDensity: 0.5,
      bassEnergyRatio: 0.3,
      spectralCentroidHz: 1200,
      zcrBrightness: 0.4,
      voicedFraction: 0.1,
      pitchVarianceCents: 20,
      mfcc: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]
    }
    const timestamp = Date.now()
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, ?)`
    ).run(stemCID, JSON.stringify(features), timestamp)

    // Write a sketch that assigns this stem to the 'drums' bus
    writeSketch('my-sketch', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })

    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const summary = backfillStemCategoriesFromProjectLibrary(db)
    expect(summary.categorizedStems).toBe(1)

    // Verify the centroid store was actually trained with this stem's category
    const store = loadCategoryCentroidStore()
    expect(store.buses.drums?.count).toBe(1)
  })
})
