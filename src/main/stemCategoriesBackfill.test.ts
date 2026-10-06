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

/** A store file from before trainedPairs: one sample on each named bus. */
function legacyStore(buses: string[]): Record<string, unknown> {
  const mean = new Array(19).fill(0.5)
  return {
    buses: Object.fromEntries(buses.map((bus) => [bus, { mean, count: 1 }])),
    global: { mean, m2: new Array(19).fill(0), count: buses.length }
  }
}

function storeFilePath(): string {
  return join(userDataDir, 'busCentroids.json')
}

function fileTrainedPairs(): unknown {
  return (JSON.parse(readFileSync(storeFilePath(), 'utf-8')) as { trainedPairs?: unknown })
    .trainedPairs
}

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as {
      name: string
    }[]
  ).map(({ name }) => name)
}

/** A StemCategories row written directly, as an earlier version left it. */
function labelRow(
  db: Database.Database,
  stemCID: string,
  labels: { busId?: string; arrangeRole?: string; drumSubRole?: string }
): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, BusId, ArrangeRole, DrumSubRole, Source, UpdatedAt)
     VALUES (?, ?, ?, ?, 'tidyup', 1)`
  ).run(stemCID, labels.busId ?? null, labels.arrangeRole ?? null, labels.drumSubRole ?? null)
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
  // synced) or a trainable one without features is retried -- and trains
  // exactly once, when its features arrive.
  it('a project with a stem not yet resolvable or analysed is parsed again until it is', async () => {
    const db = freshDb()
    writeSketch('waiting', {
      busOf: { 'group-a:1': 'drums', 'group-a:2': 'bass', 'group-a:3': 'aux' },
      rifffs: {
        'group-a': {
          groupId: 'group-a',
          stems: [
            { slot: 1, path: '/lib/cid-1' },
            { slot: 2, path: '/drops/kick.wav' }, // never a StemCID: never waited for
            { slot: 3, path: '/lib/cid-aux' } // aux never trains: never waited for
          ]
        }
      }
    })
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-aux')
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { getStemCategory } = await import('./stemCategoriesStore')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
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
    expect(loadCategoryCentroidStore().buses.drums?.count).toBeUndefined()
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
    ).run('cid-1', JSON.stringify(FEATURES))
    backfillStemCategoriesFromProjectLibrary(db, { readFile }) // trained, complete: stamped
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
    backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(reads).toBe(3)
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
  })

  // Review of Task 13 M1: a project that never completes (here a library
  // stem whose jam never syncs) is parsed on every launch, and each parse
  // used to add its stems to the centroids again.
  it('a second run leaves the bus centroid counts unchanged, even for a project parsed again', async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    analysedStem(db, 'cid-2')
    writeSketch('never-complete', {
      busOf: { 'group-a:1': 'drums', 'group-a:2': 'bass', 'group-a:3': 'lead' },
      rifffs: {
        'group-a': {
          groupId: 'group-a',
          stems: [
            { slot: 1, path: '/lib/cid-1' },
            { slot: 2, path: '/lib/cid-2' },
            { slot: 3, path: '/lib/cid-never-synced' }
          ]
        }
      }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const busCounts = (): Record<string, number> =>
      Object.fromEntries(
        Object.entries(loadCategoryCentroidStore().buses).map(([bus, c]) => [bus, c?.count ?? 0])
      )
    let reads = 0
    const readFile = (path: string): string => {
      reads += 1
      return readFileSync(path, 'utf-8')
    }

    backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(busCounts()).toEqual({ drums: 1, bass: 1 })
    backfillStemCategoriesFromProjectLibrary(db, { readFile })
    expect(reads).toBe(2) // parsed again: cid-never-synced may still arrive
    expect(busCounts()).toEqual({ drums: 1, bass: 1 })
  })

  // The live handler trains a Tidy Up assignment as it is made; the project
  // saved afterwards (a newer mtime) carries the same bus. Its backfill
  // must not count that stem a second time. A bus changed in the file does.
  it('a bus confirmed live and then saved in the project is counted once', async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    analysedStem(db, 'cid-2')
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const { getStemCategory } = await import('./stemCategoriesStore')
    // What the upsert-stem-category-bus handler does, a moment before the save.
    recordStemCategoryBus(
      db,
      [
        { path: '/lib/cid-1', busId: 'drums' },
        { path: '/lib/cid-2', busId: 'bass' }
      ],
      'tidyup',
      null,
      Date.now() / 1000 - 60
    )
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
    writeSketch('saved', {
      busOf: { 'group-a:1': 'drums', 'group-a:2': 'lead' },
      rifffs: {
        'group-a': {
          groupId: 'group-a',
          stems: [
            { slot: 1, path: '/lib/cid-1' },
            { slot: 2, path: '/lib/cid-2' }
          ]
        }
      }
    })
    backfillStemCategoriesFromProjectLibrary(db)
    const store = loadCategoryCentroidStore()
    expect(getStemCategory(db, 'cid-1')?.source).toBe('backfill') // the newer file landed
    expect(store.buses.drums?.count).toBe(1)
    expect(store.buses.bass?.count).toBe(1)
    expect(store.buses.lead?.count).toBe(1) // cid-2 moved to lead in the file
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

  // A stem whose bus flips between sources (an older project re-saved after
  // a Tidy Up moved the stem) gives each bus one sample, however often it
  // flips back.
  it('a bus that flips back and forth is counted once per bus', async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const entry = (busId: 'drums' | 'bass'): { path: string; busId: 'drums' | 'bass' } => ({
      path: '/lib/cid-1',
      busId
    })
    recordStemCategoryBus(db, [entry('drums')], 'backfill', '/p1', 1000)
    recordStemCategoryBus(db, [entry('bass')], 'tidyup', null, 2000)
    recordStemCategoryBus(db, [entry('drums')], 'backfill', '/p1', 3000)
    recordStemCategoryBus(db, [entry('bass')], 'tidyup', null, 4000)
    const store = loadCategoryCentroidStore()
    expect(store.buses.drums?.count).toBe(1)
    expect(store.buses.bass?.count).toBe(1)
  })

  // The trained record starts from what earlier versions already trained:
  // every bus row whose stem had features (each such write trained it).
  it('a bus row trained before the record existed is not trained again', async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    db.prepare(`INSERT INTO Stems (StemCID) VALUES ('cid-2')`).run()
    db.prepare(
      `INSERT INTO StemCategories (StemCID, BusId, Source, UpdatedAt)
       VALUES ('cid-1', 'drums', 'tidyup', 1), ('cid-2', 'bass', 'tidyup', 1)`
    ).run()
    // The store those writes trained, from before trainedPairs.
    writeFileSync(join(userDataDir, 'busCentroids.json'), JSON.stringify(legacyStore(['drums'])))
    writeSketch('old', {
      busOf: { 'group-a:1': 'drums', 'group-a:2': 'bass' },
      rifffs: {
        'group-a': {
          groupId: 'group-a',
          stems: [
            { slot: 1, path: '/lib/cid-1' },
            { slot: 2, path: '/lib/cid-2' }
          ]
        }
      }
    })
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    backfillStemCategoriesFromProjectLibrary(db)
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
    // cid-2 had no features then, so was never trained: it trains once now.
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
    ).run('cid-2', JSON.stringify(FEATURES))
    backfillStemCategoriesFromProjectLibrary(db)
    backfillStemCategoriesFromProjectLibrary(db)
    expect(loadCategoryCentroidStore().buses.bass?.count).toBe(1)
  })

  // Review of b4d9924a, minor 7: a sample is recorded as trained only once
  // the store holding it is on disk.
  it('a failed save records nothing, and its entries stay waiting until a save succeeds', async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const entries = [{ path: '/lib/cid-1', busId: 'drums' as const }]
    // The temp file cannot be written: a directory stands in its place.
    const blocker = join(userDataDir, 'busCentroids.json.tmp')
    mkdirSync(blocker)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = recordStemCategoryBus(db, entries, 'tidyup', null, 1000)
    errors.mockRestore()
    expect(failed.waiting).toEqual(entries)
    expect(loadCategoryCentroidStore().buses.drums?.count).toBeUndefined()

    rmSync(blocker, { recursive: true })
    const saved = recordStemCategoryBus(db, entries, 'tidyup', null, 2000)
    expect(saved.waiting).toEqual([])
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
  })

  // Review of b4d9924a, minor 7: a stem from an external LORE archive has its
  // Stems row there, and its features in the own db.
  it('a stem found only in the LORE db is written and trained through recordStemCategoryBus', async () => {
    const db = freshDb()
    const loreDb = freshDb()
    loreDb.prepare(`INSERT INTO Stems (StemCID) VALUES ('cid-lore')`).run()
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
    ).run('cid-lore', JSON.stringify(FEATURES))
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const { getStemCategory } = await import('./stemCategoriesStore')
    const entries = [{ path: '/lore-archive/cid-lore', busId: 'bass' as const }]
    const first = recordStemCategoryBus(db, entries, 'tidyup', null, 1000, [loreDb])
    expect(first).toEqual({ unresolved: [], waiting: [] })
    expect(getStemCategory(db, 'cid-lore')?.busId).toBe('bass')
    expect(loadCategoryCentroidStore().buses.bass?.count).toBe(1)
    // Without the LORE db the stem does not resolve, and nothing is written.
    expect(recordStemCategoryBus(db, entries, 'tidyup', null, 2000).unresolved).toEqual(entries)
    recordStemCategoryBus(db, entries, 'tidyup', null, 3000, [loreDb])
    expect(loadCategoryCentroidStore().buses.bass?.count).toBe(1)
  })

  // Review of b4d9924a, minor 4: a role confirmed after the project was saved
  // used to refuse the project's bus (one shared UpdatedAt), and the project
  // was stamped complete, so that bus never landed.
  it("a role confirmed after the project was saved does not keep the project's bus out", async () => {
    const db = freshDb()
    analysedStem(db, 'cid-1')
    writeSketch('older-than-the-role', {
      busOf: { 'group-a:1': 'drums' },
      rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
    })
    const { upsertStemCategoryRole, getStemCategory } = await import('./stemCategoriesStore')
    const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    upsertStemCategoryRole(
      db,
      [{ path: '/lib/cid-1', arrangeRole: 'lead' }],
      'tidyup',
      null,
      Date.now() / 1000 + 60
    )
    backfillStemCategoriesFromProjectLibrary(db)
    expect(getStemCategory(db, 'cid-1')).toMatchObject({ busId: 'drums', arrangeRole: 'lead' })
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
    expect(backfillStemCategoriesFromProjectLibrary(db).unchangedProjects).toBe(1)
  })

  // Review of b4d9924a, important 1: a store file that would not load read as
  // an empty store, the next training save replaced it, and the trained record
  // said its pairs were trained: every sample in it lost for good.
  describe('a store file that exists but will not load', () => {
    it('is never overwritten: nothing trains, nothing is recorded, and its entries wait', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      const storeFile = join(userDataDir, 'busCentroids.json')
      writeFileSync(storeFile, '{"buses": {"drums": {"mean": [1], "cou')
      const { recordStemCategoryBus, recordStemCategoryRole, setCentroidStoreUnreadableListener } =
        await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      const { getStemCategory } = await import('./stemCategoriesStore')
      const entries = [{ path: '/lib/cid-1', busId: 'drums' as const }]
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const told: string[] = []
      setCentroidStoreUnreadableListener((path) => told.push(path))
      const result = recordStemCategoryBus(db, entries, 'tidyup', null, 1000)
      recordStemCategoryRole(
        db,
        [{ path: '/lib/cid-1', arrangeRole: 'lead' }],
        'tidyup',
        null,
        1000
      )
      setCentroidStoreUnreadableListener(null)
      expect(errors.mock.calls.some(([message]) => /not train/.test(String(message)))).toBe(true)
      errors.mockRestore()
      expect(told).toEqual([storeFile]) // the user is told once, not per write
      expect(result.waiting).toEqual(entries)
      // The labels themselves land.
      expect(getStemCategory(db, 'cid-1')).toMatchObject({ busId: 'drums', arrangeRole: 'lead' })
      expect(readFileSync(storeFile, 'utf-8')).toBe('{"buses": {"drums": {"mean": [1], "cou')

      // Once the file is dealt with (here removed), the same write trains.
      rmSync(storeFile)
      expect(recordStemCategoryBus(db, entries, 'tidyup', null, 2000).waiting).toEqual([])
      expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
    })

    it('leaves a project parsed again next launch', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      writeFileSync(join(userDataDir, 'busCentroids.json'), 'not json')
      writeSketch('one', {
        busOf: { 'group-a:1': 'drums' },
        rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
      })
      const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      backfillStemCategoriesFromProjectLibrary(db)
      expect(backfillStemCategoriesFromProjectLibrary(db).unchangedProjects).toBe(0)
      errors.mockRestore()
    })
  })

  // Review of 89bf2a4c: which (stem, bus) pairs a store holds is kept in the
  // store file itself, saved in the same write as its samples.
  describe('the trained pairs live in the store file', () => {
    const drums = { path: '/lib/cid-1', busId: 'drums' as const }
    const bass = { path: '/lib/cid-2', busId: 'bass' as const }

    it('a save writes the pairs beside the samples, and the library db gets no tables for them', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      const before = tableNames(db)
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      recordStemCategoryBus(db, [drums], 'tidyup', null, 1000)
      expect(fileTrainedPairs()).toEqual([{ stemCID: 'cid-1', busId: 'drums' }])
      expect(tableNames(db)).toEqual(before)
    })

    // One file, one rename: a crash can no longer land between the samples
    // and the record of them. A failed save leaves both as they were.
    it('a failed save leaves the samples and the pairs both as they were', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      analysedStem(db, 'cid-2')
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      recordStemCategoryBus(db, [drums], 'tidyup', null, 1000)
      const onDisk = readFileSync(storeFilePath(), 'utf-8')
      mkdirSync(`${storeFilePath()}.tmp`)
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(recordStemCategoryBus(db, [bass], 'tidyup', null, 2000).waiting).toEqual([bass])
      errors.mockRestore()
      expect(readFileSync(storeFilePath(), 'utf-8')).toBe(onDisk)
    })

    it('a missing store file is rebuilt from the db on every axis, and nothing in it trains twice', async () => {
      const db = freshDb()
      for (const cid of ['cid-1', 'cid-2', 'cid-3', 'cid-5']) analysedStem(db, cid)
      db.prepare(`INSERT INTO Stems (StemCID) VALUES ('cid-4')`).run() // no features
      labelRow(db, 'cid-1', { busId: 'drums', arrangeRole: 'drums', drumSubRole: 'kick' })
      labelRow(db, 'cid-2', { busId: 'bass', arrangeRole: 'bass' })
      labelRow(db, 'cid-3', { arrangeRole: 'vocal' })
      labelRow(db, 'cid-4', { busId: 'lead', arrangeRole: 'lead' })
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      recordStemCategoryBus(db, [{ path: '/lib/cid-5', busId: 'backing' }], 'tidyup', null, 2000)
      const store = loadCategoryCentroidStore()
      expect(store.buses).toEqual({
        drums: expect.objectContaining({ count: 1 }),
        bass: expect.objectContaining({ count: 1 }),
        backing: expect.objectContaining({ count: 1 })
      })
      expect(store.arrangeRoles).toEqual({
        drums: expect.objectContaining({ count: 1 }),
        bass: expect.objectContaining({ count: 1 }),
        vocal: expect.objectContaining({ count: 1 })
      })
      expect(store.drumSubRoles).toEqual({ kick: expect.objectContaining({ count: 1 }) })
      expect(store.global.count).toBe(7) // cid-1 x3, cid-2 x2, cid-3, cid-5
      expect(fileTrainedPairs()).toEqual([
        { stemCID: 'cid-1', busId: 'drums' },
        { stemCID: 'cid-2', busId: 'bass' },
        { stemCID: 'cid-5', busId: 'backing' }
      ])

      // Deleted again: rebuilt again, one sample per label, never two.
      rmSync(storeFilePath())
      recordStemCategoryBus(db, [drums, bass], 'tidyup', null, 3000)
      const rebuilt = loadCategoryCentroidStore()
      expect(rebuilt.buses.drums?.count).toBe(1)
      expect(rebuilt.buses.backing?.count).toBe(1)
      expect(rebuilt.arrangeRoles.vocal?.count).toBe(1)
      expect(rebuilt.global.count).toBe(7)
    })

    it('a role write that finds no store file rebuilds every axis, and its own batch is counted once', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      analysedStem(db, 'cid-2')
      analysedStem(db, 'cid-3')
      labelRow(db, 'cid-1', { busId: 'drums' })
      const { recordStemCategoryRole } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      const roleWrite = (path: string, arrangeRole: 'lead' | 'vocal', at: number): void =>
        recordStemCategoryRole(db, [{ path, arrangeRole }], 'tidyup', null, at)
      roleWrite('/lib/cid-2', 'lead', 2000)
      let store = loadCategoryCentroidStore()
      expect(store.buses.drums?.count).toBe(1)
      expect(store.arrangeRoles.lead?.count).toBe(1)
      expect(fileTrainedPairs()).toEqual([{ stemCID: 'cid-1', busId: 'drums' }])
      roleWrite('/lib/cid-3', 'vocal', 3000)
      store = loadCategoryCentroidStore()
      expect([store.arrangeRoles.lead?.count, store.arrangeRoles.vocal?.count]).toEqual([1, 1])
    })

    // Review of 89bf2a4c, minor: a rebuild (or a seed) taken by a write that
    // trains nothing used to be thrown away and redone at the next write.
    it('a write with nothing to train still saves the rebuild', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      analysedStem(db, 'cid-2')
      labelRow(db, 'cid-1', { busId: 'drums', arrangeRole: 'drums' })
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      recordStemCategoryBus(db, [{ path: '/lib/cid-2', busId: 'aux' }], 'tidyup', null, 2000)
      expect(fileTrainedPairs()).toEqual([{ stemCID: 'cid-1', busId: 'drums' }])
      expect(loadCategoryCentroidStore().arrangeRoles.drums?.count).toBe(1)
    })

    // Each user's first launch on this code: the store's counts were inflated
    // by every launch re-training every project, so every bus row it could
    // have trained is credited, once, rather than trained once more.
    it('a store file from before trainedPairs is seeded once from the bus rows with features', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      db.prepare(`INSERT INTO Stems (StemCID) VALUES ('cid-2')`).run() // features come later
      analysedStem(db, 'cid-3')
      analysedStem(db, 'cid-4')
      labelRow(db, 'cid-1', { busId: 'drums' })
      labelRow(db, 'cid-2', { busId: 'bass' })
      const inflated = legacyStore(['drums'])
      ;(inflated.buses as Record<string, { count: number }>).drums.count = 5
      writeFileSync(storeFilePath(), JSON.stringify(inflated))
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')

      const first = recordStemCategoryBus(
        db,
        [drums, bass, { path: '/lib/cid-3', busId: 'lead' }],
        'tidyup',
        null,
        2000
      )
      let store = loadCategoryCentroidStore()
      expect(store.buses.drums?.count).toBe(5) // credited, not trained again
      expect(store.buses.lead?.count).toBe(1)
      expect(first.waiting).toEqual([bass])
      expect(fileTrainedPairs()).toEqual([
        { stemCID: 'cid-1', busId: 'drums' },
        { stemCID: 'cid-3', busId: 'lead' }
      ])

      // cid-2 was never trained (no features): it trains once they arrive.
      db.prepare(
        `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
      ).run('cid-2', JSON.stringify(FEATURES))
      recordStemCategoryBus(db, [bass], 'tidyup', null, 3000)
      recordStemCategoryBus(db, [bass], 'tidyup', null, 4000)
      expect(loadCategoryCentroidStore().buses.bass?.count).toBe(1)

      // The seed is not taken again: a row labelled since (here written
      // directly) is not credited, and trains when it is written.
      labelRow(db, 'cid-4', { busId: 'drums' })
      recordStemCategoryBus(db, [{ path: '/lib/cid-4', busId: 'drums' }], 'tidyup', null, 5000)
      store = loadCategoryCentroidStore()
      expect(store.buses.drums?.count).toBe(6)
    })

    // Review of 6fd465fe, minor 2: the seed is taken again at every write
    // until one saves it. A pair whose first training failed to save was then
    // in the bus rows the next seed credited, so it never trained.
    it('a pair whose training failed to save is not credited by the next seed', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      analysedStem(db, 'cid-2')
      writeFileSync(storeFilePath(), JSON.stringify(legacyStore(['drums'])))
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      mkdirSync(`${storeFilePath()}.tmp`) // the save fails
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(recordStemCategoryBus(db, [drums], 'tidyup', null, 1000).waiting).toEqual([drums])
      errors.mockRestore()
      rmSync(`${storeFilePath()}.tmp`, { recursive: true })

      // A later launch (nothing kept in memory); its first write is another
      // stem's: it takes the seed, and saves it.
      vi.resetModules()
      const relaunched = await import('./categoryCentroidTraining')
      relaunched.recordStemCategoryBus(db, [bass], 'tidyup', null, 2000)
      expect(fileTrainedPairs()).toEqual([{ stemCID: 'cid-2', busId: 'bass' }])
      // Written again, cid-1's pair trains: once.
      expect(relaunched.recordStemCategoryBus(db, [drums], 'tidyup', null, 3000).waiting).toEqual(
        []
      )
      relaunched.recordStemCategoryBus(db, [drums], 'tidyup', null, 4000)
      const store = loadCategoryCentroidStore()
      expect([store.buses.drums?.count, store.buses.bass?.count]).toEqual([2, 1])
    })

    it('a seed taken by a write with nothing to train is saved', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      labelRow(db, 'cid-1', { busId: 'drums' })
      writeFileSync(storeFilePath(), JSON.stringify(legacyStore(['drums'])))
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      recordStemCategoryBus(db, [{ path: '/drops/kick.wav', busId: 'drums' }], 'tidyup', null, 2000)
      expect(fileTrainedPairs()).toEqual([{ stemCID: 'cid-1', busId: 'drums' }])
    })

    // The library db deleted or replaced under an existing store: the file
    // still knows what it holds.
    it('a store over a new library db does not train a pair it already holds', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      recordStemCategoryBus(db, [drums], 'tidyup', null, 1000)
      const newDb = freshDb()
      analysedStem(newDb, 'cid-1')
      analysedStem(newDb, 'cid-2')
      recordStemCategoryBus(newDb, [drums, bass], 'tidyup', null, 2000)
      const store = loadCategoryCentroidStore()
      expect([store.buses.drums?.count, store.buses.bass?.count]).toEqual([1, 1])
    })

    it('a backup put back holds exactly its own pairs', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      analysedStem(db, 'cid-2')
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      recordStemCategoryBus(db, [drums], 'tidyup', null, 1000)
      const backup = readFileSync(storeFilePath(), 'utf-8')
      recordStemCategoryBus(db, [bass], 'tidyup', null, 2000)
      writeFileSync(storeFilePath(), backup) // the backup, which never held bass
      recordStemCategoryBus(db, [drums, bass], 'tidyup', null, 3000)
      const store = loadCategoryCentroidStore()
      expect([store.buses.drums?.count, store.buses.bass?.count]).toEqual([1, 1])
    })

    // The project is backfilled first, then Tidy Up confirms the same bus.
    it('a bus from a project and then confirmed live is counted once', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      writeSketch('first', {
        busOf: { 'group-a:1': 'drums' },
        rifffs: { 'group-a': { groupId: 'group-a', stems: [{ slot: 1, path: '/lib/cid-1' }] } }
      })
      const { backfillStemCategoriesFromProjectLibrary } = await import('./stemCategoriesBackfill')
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      const { getStemCategory } = await import('./stemCategoriesStore')
      backfillStemCategoriesFromProjectLibrary(db)
      recordStemCategoryBus(db, [drums], 'tidyup', null, Date.now() / 1000 + 60)
      expect(getStemCategory(db, 'cid-1')?.source).toBe('tidyup') // the live write landed
      expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
    })

    // The dev and the packaged app keep separate stores (userData) over one
    // own db (~/Music): each file holds its own pairs.
    it('two store files over one db each train a pair once', async () => {
      const db = freshDb()
      analysedStem(db, 'cid-1')
      const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
      const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
      const packaged = userDataDir
      const dev = mkdtempSync(join(tmpdir(), 'sssketch-backfill-userdata-dev-test-'))
      try {
        recordStemCategoryBus(db, [drums], 'tidyup', null, 1000) // packaged
        userDataDir = dev
        recordStemCategoryBus(db, [drums], 'tidyup', null, 2000)
        expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
        userDataDir = packaged
        recordStemCategoryBus(db, [drums], 'tidyup', null, 3000)
        expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
        userDataDir = dev
        recordStemCategoryBus(db, [drums], 'tidyup', null, 4000)
        expect(loadCategoryCentroidStore().buses.drums?.count).toBe(1)
      } finally {
        userDataDir = packaged
        rmSync(dev, { recursive: true, force: true })
      }
    })
  })
})
