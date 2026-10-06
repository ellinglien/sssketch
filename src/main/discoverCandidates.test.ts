// src/main/discoverCandidates.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getDiscoverCandidates,
  getRandomLibraryCandidate,
  prewarmDiscoverCandidateCaches,
  getRiffIndexForDb,
  appendToInMemoryDiscoverCaches,
  getInstrumentMaskLookup,
  instrumentRowsInMemoryForTests,
  sampleDistinctIndices
} from './discoverCandidates'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveRiffIndexCache, saveInstrumentRowsCache } from './discoverIndexCache'
import { discoverStemRestriction } from './discoverArtistStems'
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'
import { RIFF_WALK_PAGE_SIZE } from './riffIndexWalk'
import { STEMS_WALK_PAGE_SIZE } from './stemsTableWalk'
import { upsertStemCategoryRole } from './stemCategoriesStore'
import { upsertStemAutoCategory } from './stemAutoCategoryStore'
import { bumpTableWriteVersion } from './tableWriteVersion'
import { prewarmTraitQuantileTables } from './traitQuantileCache'
import { countWork } from './workCounters'
import { instrumentMaskToSoundType, soundSourceMatchesFilter } from '@shared/riffLibraryTypes'

/** tableChangeSignal.ts's cheap half of a table's change signal (MAX(rowid)
 * + data_version): not a read of the table's rows, so the query-count tests
 * below leave it out and count only the COUNT(*) and the walk's pages. */
function isSignalHead(sql: string): boolean {
  return sql.includes('pragma_data_version')
}

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL,
      Instrument INTEGER, Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE DiscoverRiffIndexCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
      OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL, CreationTime INTEGER,
      PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverRiffIndexCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, RiffCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE DiscoverInstrumentRowsCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, Instrument INTEGER,
      OwnerJamCID TEXT NOT NULL,
      PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverInstrumentRowsCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, StemCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE StemUnavailable (
      StemCID TEXT PRIMARY KEY, Reason TEXT NOT NULL, CheckedAt INTEGER NOT NULL
    );
  `)
  return db
}

/** Marks a stem as one whose audio can't be fetched any more -- the real
 * 2026-09-22 situation (one of Endlesss's buckets 403s every anonymous
 * GET). Discover must never offer one of these: the slot would resolve to
 * nothing and read as a bare "no match". */
function seedUnavailable(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO StemUnavailable (StemCID, Reason, CheckedAt) VALUES (?, 'http 403', 1000)`
  ).run(stemCID)
}

/** Writes directly to StemAutoCategory -- the background classify scan's
 * (stemAutoClassify.ts) own precomputed-results table -- rather than
 * seeding embeddings/features and letting a live classifier run. The
 * classification logic itself (embedding vs. centroid, confidence
 * thresholds) is stemAutoClassify's own concern and is tested there.
 * Since 2026-09-22 (direct request: audio-in/mic stems never appeared
 * under drums/bass/lead), a MASK kind's pool reads this table again -- but
 * only for stems the Endlesss instrument mask can't place (no mask, or
 * audio-in); an Endlesss drums/bass/notes mask stays ground truth. */
function seedAutoCategory(
  db: Database.Database,
  stemCID: string,
  arrangeRole: string,
  source: 'embedding' | 'centroid' = 'embedding'
): void {
  db.prepare(
    `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt) VALUES (?, ?, ?, 1000)`
  ).run(stemCID, arrangeRole, source)
}

function seedRiff(
  db: Database.Database,
  riffCID: string,
  jamCID: string,
  bpm: number,
  stemCIDs: string[]
): void {
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)
  const values: Record<string, unknown> = {
    riffCID,
    jamCID,
    bpm,
    creationTime: 1000
  }
  cols.forEach((c, i) => {
    values[c] = stemCIDs[i] ?? null
  })
  db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, ${cols.join(', ')})
     VALUES (@riffCID, @jamCID, @creationTime, @bpm, ${cols.map((c) => '@' + c).join(', ')})`
  ).run(values)
}

function seedStem(
  db: Database.Database,
  stemCID: string,
  jamCID: string,
  fields: {
    presetName?: string
    creatorUserName?: string
    bpm?: number
    /** OUROVEON's own instrument bitmask -- bit 1 = drum, bit 2 = note,
     * bit 3 = bass, bit 4 = mic (instrumentMaskToSoundType,
     * riffLibraryTypes.ts). */
    instrument?: number
  } = {}
): void {
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, PresetName, CreatorUserName, BPMrnd, Instrument)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    stemCID,
    jamCID,
    fields.presetName ?? 'test stem',
    fields.creatorUserName ?? 'elling',
    fields.bpm ?? null,
    fields.instrument ?? null
  )
}

function seedCategory(
  db: Database.Database,
  stemCID: string,
  fields: { arrangeRole?: string; drumSubRole?: string; busId?: string }
): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @arrangeRole, @drumSubRole, @busId, 'tidyup', NULL, 1000)`
  ).run({
    stemCID,
    arrangeRole: fields.arrangeRole ?? null,
    drumSubRole: fields.drumSubRole ?? null,
    busId: fields.busId ?? null
  })
}

function seedFeatures(db: Database.Database, stemCID: string, featuresJSON: string): void {
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, featuresJSON)
}

function featuresJSON(
  overrides: Partial<{
    transientDensity: number
    bassEnergyRatio: number
    spectralCentroidHz: number
    zcrBrightness: number
    rhythmicStrength: number
    spectralCentroidFftHz: number
    featureVersion: number
  }> = {}
): string {
  return JSON.stringify({
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 0,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  })
}

describe('getDiscoverCandidates', () => {
  it('returns only stems with a StemCategories row for the requested role', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1')
    seedStem(own, 's2', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    // s2 has no StemCategories row at all -- excluded.

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].stemCID).toBe('s1')
  })

  it('excludes a StemCategories row for a DIFFERENT arrangeRole', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'bass', busId: 'bass' })

    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums']
      })
    ).toEqual([])
  })

  it("carries the owning riff's own BPM and jamCID/riffCID alongside each candidate", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 140, ['s1'])
    seedStem(own, 's1', 'jam1', { presetName: '808 kick', creatorUserName: 'elling' })
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(c).toMatchObject({
      stemCID: 's1',
      riffCID: 'r1',
      jamCID: 'jam1',
      riffBpm: 140,
      presetName: '808 kick',
      creatorUserName: 'elling',
      slotKinds: ['drums']
    })
  })

  it("looks up StemCategories ONLY against ownDb, even when a jam's own Riffs/Stems live in a different db", async () => {
    const own = freshDb()
    const external = freshDb()
    // The candidate's raw Riffs/Stems rows live in the EXTERNAL db (an
    // external LORE archive) -- but its StemCategories confirmation, per
    // this codebase's own real convention (fixed commit 14505a0 today),
    // can only ever exist in the OWN db.
    seedRiff(external, 'r1', 'jamExt', 128, ['s1'])
    seedStem(external, 's1', 'jamExt')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jamExt', dbForJam: external }],
      kinds: ['drums']
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].stemCID).toBe('s1')
  })

  // Renamed/rewritten 2026-09-15 (code quality review, finding 1): the old
  // version of this test seeded an EXTERNAL db lacking StemCategories, but
  // the code never queries external dbs for StemCategories (only ownDb) --
  // so it passed trivially without exercising the outer catch at all. This
  // version actually exercises it: a jam whose own db genuinely lacks a
  // Riffs table (a real, if rare, possibility for a corrupted/partial
  // external LORE archive this app doesn't control the lifecycle of).
  it('skips a jam whose own db lacks a Riffs table, without aborting the whole multi-jam scan', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })

    const brokenExternal = new Database(':memory:')
    // Deliberately no Riffs (or Stems) table at all -- simulates a
    // corrupted/partial external archive db.

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [
        { jamCID: 'jamBroken', dbForJam: brokenExternal },
        { jamCID: 'jam1', dbForJam: own }
      ],
      kinds: ['drums']
    })

    // The broken jam is skipped silently; the good jam's candidate still
    // comes through -- one bad db doesn't sink the whole scan.
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  it('finds a confirmed stem in a jam that also has many other, unrelated stems with no StemCategories row', async () => {
    const own = freshDb()
    const stemCIDs = Array.from({ length: 20 }, (_, i) => `other-${i}`)
    seedRiff(own, 'r1', 'jam1', 128, [...stemCIDs.slice(0, 7), 's1'])
    for (const cid of stemCIDs) seedStem(own, cid, 'jam1')
    seedStem(own, 's1', 'jam1', { presetName: 'kick', creatorUserName: 'elling' })
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    // Plenty of OTHER riffs/stems in the same jam that have no
    // StemCategories row at all, and are unrelated to the requested role --
    // a more realistic library shape than the other tests' small,
    // all-relevant fixtures.
    for (let i = 0; i < 10; i++) {
      const extraStems = [`extra-${i}-a`, `extra-${i}-b`]
      seedRiff(own, `extra-riff-${i}`, 'jam1', 120, extraStems)
      for (const cid of extraStems) seedStem(own, cid, 'jam1')
    }

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ stemCID: 's1', riffCID: 'r1', presetName: 'kick' })
  })

  it('silently excludes a confirmed StemCID whose owning riff cannot be found in any jam (stale/orphaned StemCategories row)', async () => {
    const own = freshDb()
    // A real candidate, findable in jam1.
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    // An orphaned confirmation: StemCategories says this stem is a
    // confirmed drum, but no riff in any jam we're given actually contains
    // it (e.g. the jam was deleted/unsynced after the confirmation was
    // made).
    seedCategory(own, 'orphan-stem', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })

    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  it('filters by ownership when onlyOwnStems is true, reusing computeOwnerFraction-equivalent per-stem authorship', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1', { creatorUserName: 'elling' })
    seedStem(own, 's2', 'jam1', { creatorUserName: 'someone-else' })
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedCategory(own, 's2', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  it('aggregates candidates across multiple jams', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedRiff(own, 'r2', 'jam2', 130, ['s2'])
    seedStem(own, 's2', 'jam2')
    seedCategory(own, 's2', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own }
      ],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['s1', 's2'])
  })

  // Real perf bug, found live (root cause of a SECOND "stuck rolling"
  // report, once the background classify scan had produced thousands of
  // StemAutoCategory rows for one role): the candidate-resolution loop
  // used to query Riffs ONCE PER JAM (`WHERE OwnerJamCID = ?`), even
  // though jams typically share ONE db connection -- a real multi-hundred-
  // jam library paid for hundreds of redundant round trips of the same
  // query. Fixed by grouping jams by db connection and querying once per
  // (db, chunk) instead of once per (jam, chunk). This test seeds THREE
  // jams sharing one db and asserts exactly one Riffs query runs (not
  // three), while still correctly attributing each result's own jamCID
  // (read from the row itself, not the loop variable).
  it('resolves candidates across multiple jams sharing one db with a single query per chunk, not one per jam', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedRiff(own, 'r2', 'jam2', 130, ['s2'])
    seedStem(own, 's2', 'jam2')
    seedCategory(own, 's2', { arrangeRole: 'drums', busId: 'drums' })
    seedRiff(own, 'r3', 'jam3', 140, ['s3'])
    seedStem(own, 's3', 'jam3')
    seedCategory(own, 's3', { arrangeRole: 'drums', busId: 'drums' })

    const prepareSpy = vi.spyOn(own, 'prepare')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own },
        { jamCID: 'jam3', dbForJam: own }
      ],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['s1', 's2', 's3'])
    expect(candidates.map((c) => c.jamCID).sort()).toEqual(['jam1', 'jam2', 'jam3'])

    // 2, not 1 -- buildRiffIndex now pages via COUNT(*) + one LIMIT/OFFSET
    // page (PREWARM_CHUNK_SIZE=5000, this fixture's 3 rows fit in one page)
    // rather than a single un-chunked SELECT *; see PREWARM_CHUNK_SIZE's
    // own doc comment for why.
    const riffsQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Riffs') && !isSignalHead(sql)
    )
    expect(riffsQueries.length).toBe(2)
  })

  // Real perf bug, found live AGAIN at real scale (5,057 jams sharing one
  // read-only external archive connection -- no index possible there,
  // see riffLibraryStore.ts's own getRiffLibraryDb): even the db-grouped
  // query above still filtered `WHERE OwnerJamCID IN (...)`, chunked into
  // jam-chunks too -- since `jams` is ALWAYS the full listJamsWithDb()
  // result at every real call site (never a genuine subset), this filter
  // was pure overhead, multiplying an already-expensive unindexed query
  // by 26x (5,057 / 200) for zero real filtering benefit. Confirmed live:
  // getDiscoverCandidates alone took 80+ seconds. Fixed by dropping the
  // SQL-side jam filter (one query per (db, stem-chunk), not per (db,
  // jam-chunk, stem-chunk)) and moving the "is this jam allowed" check to
  // an in-memory Set per returned row instead. This test proves that
  // filter still works correctly even without SQL's help: a jam whose
  // Riffs happen to share the SAME db connection but ISN'T in the
  // caller's own `jams` list must still be excluded.
  it('excludes a riff whose jam is not in the caller-supplied jams list, even though it shares the same db connection', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    // Same db, same StemCategories confirmation reach -- but this jam is
    // deliberately NOT included in the `jams` list passed below.
    seedRiff(own, 'r2', 'jam-not-included', 130, ['s2'])
    seedStem(own, 's2', 'jam-not-included')
    seedCategory(own, 's2', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  // Real perf bug, found live AGAIN at real scale, even after the
  // db-grouping and redundant-jam-filter fixes above: query COUNT wasn't
  // the dominant cost, evaluating an unindexed 8-column `IN (...)` clause
  // against every row of a genuinely huge table was -- confirmed live via
  // a real ~80 SECOND getDiscoverCandidates call that stayed ~80 seconds
  // even after those two earlier fixes cut the query count by ~26x, on
  // Elling's own real library (5,057 jams, one read-only external
  // archive -- no index possible). Fixed by reading the whole Riffs
  // table ONCE per db connection (no WHERE clause at all) and caching an
  // in-memory index for several minutes. This test proves the fix: TWO
  // getDiscoverCandidates calls for the SAME db (even for different
  // roles) must only query `FROM Riffs` ONCE total, not once per call.
  it('caches the Riffs table scan across multiple calls for the same db, querying it only once', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedRiff(own, 'r2', 'jam1', 128, ['s2'])
    seedStem(own, 's2', 'jam1')
    seedCategory(own, 's2', { arrangeRole: 'bass', busId: 'bass' })

    const prepareSpy = vi.spyOn(own, 'prepare')

    const drumsCandidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    const bassCandidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bass']
    })
    expect(drumsCandidates.map((c) => c.stemCID)).toEqual(['s1'])
    expect(bassCandidates.map((c) => c.stemCID)).toEqual(['s2'])

    // 2, not 1 -- see the "single query per chunk" test above for why
    // (COUNT(*) + one LIMIT/OFFSET page for this fixture's row count).
    const riffsQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Riffs') && !isSignalHead(sql)
    )
    expect(riffsQueries.length).toBe(2)
    // No per-row predicate -- a plain sequential scan: the COUNT, and the
    // walk's rowid range (`WHERE rowid > ?`, scan plan Task 2), which is the
    // table's own order, not a filter evaluated on every row.
    const withoutRowidRange = (sql: string): string => sql.replace(/WHERE rowid > \?/, '')
    expect(withoutRowidRange(riffsQueries[0][0])).not.toMatch(/WHERE/)
    expect(withoutRowidRange(riffsQueries[1][0])).not.toMatch(/WHERE/)
  })

  // Direct request, 2026-09-16 ("can we take a good look at the things we
  // just added... and see if we can improve the speed"): the TTL cache
  // above only helps once the FIRST scan has already finished -- multiple
  // CONCURRENT callers (findRiffForStemPath, discoverAdjacency.ts, calls
  // getRiffIndexForDb once per seedStem-only Discover slot, and a
  // Shelf-sourced seed can easily have 8 of those mounting at once) landing
  // BEFORE that first scan settles would otherwise each independently
  // trigger their own full table scan. Proves getRiffIndexForDb itself
  // (exported for exactly this reuse) shares one in-flight scan across
  // concurrent callers.
  it('getRiffIndexForDb shares one in-flight scan across concurrent callers for the same db', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')

    const prepareSpy = vi.spyOn(own, 'prepare')

    const [indexA, indexB] = await Promise.all([getRiffIndexForDb(own), getRiffIndexForDb(own)])

    expect(indexA).toBe(indexB)
    expect(indexA.get('s1')?.riffCID).toBe('r1')
    // 2, not 1 -- see the "single query per chunk" test above for why.
    const riffsQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Riffs') && !isSignalHead(sql)
    )
    expect(riffsQueries.length).toBe(2)
  })

  // Direct request, 2026-09-22: audio-in/mic stems never appeared under
  // drums/bass/lead. The overnight classifier's guess (StemAutoCategory) is
  // back as a mask-kind source -- scoped to stems the Endlesss mask can't
  // place (no mask, or audio-in).
  it('includes an unmasked, unconfirmed stem whose only signal is a StemAutoCategory row for the role', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { presetName: 'maybe a kick' })
    seedAutoCategory(own, 's1', 'drums')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
    expect(candidates[0]).toMatchObject({ slotKinds: ['drums'], drumSubRole: null })
  })

  it('excludes a StemAutoCategory row for a stem confirmed to a DIFFERENT role (cross-role leakage guard)', async () => {
    const own = freshDb()
    // Real scenario this guards against: the background scan classified
    // this stem as 'drums' (StemAutoCategory) BEFORE it was later
    // human-confirmed as 'bass' (StemCategories) -- the scan never revisits
    // an already-written row, so the 'drums' guess goes stale. A confirmed
    // role always wins, on ANY role, not just the one being queried.
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'bass', busId: 'bass' })
    seedAutoCategory(own, 's1', 'drums')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates).toEqual([])
  })

  it('never includes a StemAutoCategory row for a DIFFERENT role than the one requested', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedAutoCategory(own, 's1', 'bass')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates).toEqual([])
  })

  // Widened again, same day, real user report: "can't we train it with
  // some basic data before handing it to someone?" -- Endlesss's own
  // recorded instrument category (Stems.Instrument, a bitmask) needs no
  // prior confirmation or background scan at all. Bit 1 = drum (mask 2),
  // bit 3 = bass (mask 8) -- instrumentMaskToSoundType's own doc comment.
  it('includes a stem with NEITHER a confirmation NOR an embedding, whose own Instrument bitmask marks it a drum', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { presetName: 'untitled loop', instrument: 2 }) // bit 1: drum

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
    expect(candidates[0]).toMatchObject({ slotKinds: ['drums'], drumSubRole: null })
  })

  it('does NOT include a stem confirmed for a DIFFERENT role even when its own Instrument bitmask would otherwise match', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    // Instrument bit says drum, but a human explicitly confirmed this one
    // as bass -- the real confirmation must always win.
    seedStem(own, 's1', 'jam1', { instrument: 2 })
    seedCategory(own, 's1', { arrangeRole: 'bass', busId: 'bass' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates).toEqual([])
  })

  it('ignores a stem with no Instrument value at all (NULL)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1') // instrument left unset -> NULL

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates).toEqual([])
  })

  // A mask kind's pool combines all THREE sources (2026-09-22): confirmed,
  // instrument-matched, and -- for stems the mask can't place -- the
  // overnight classifier's guess.
  it('combines all three sources (confirmed, instrument-matched, auto-classified unmasked) in one pool', async () => {
    const own = freshDb()
    // Confirmed 'drums'.
    seedRiff(own, 'rd1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1')
    seedCategory(own, 'd1', { arrangeRole: 'drums', busId: 'drums' })
    // StemAutoCategory-only, no confirmation and no instrument bit.
    seedRiff(own, 'rg', 'jam1', 128, ['guessed-1'])
    seedStem(own, 'guessed-1', 'jam1')
    seedAutoCategory(own, 'guessed-1', 'drums')
    // Instrument-matched: unconfirmed, no auto-category at all, just the bit.
    seedRiff(own, 'ri', 'jam1', 128, ['instrument-1'])
    seedStem(own, 'instrument-1', 'jam1', { instrument: 2 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['d1', 'guessed-1', 'instrument-1'])
  })

  // Real crash, found live via a full macOS crash report: SQLite trapped
  // (EXC_BREAKPOINT, compiling the query, not even running it) once a
  // widened pool pushed the `IN (...)` clause's bound parameter count too
  // high for one statement. This seeds enough distinct candidates to span
  // several query chunks (CANDIDATE_QUERY_CHUNK_SIZE=200) and asserts
  // every one of them still comes back -- not just that nothing throws,
  // but that chunking doesn't silently drop results from any chunk.
  it('returns every candidate correctly even when the pool spans multiple query chunks', async () => {
    const own = freshDb()
    const stemCIDs = Array.from({ length: 450 }, (_, i) => `d${i}`)
    for (const cid of stemCIDs) {
      seedRiff(own, `r-${cid}`, 'jam1', 128, [cid])
      // Instrument-matched (bit 1 = drum) -- no StemCategories/embedding
      // seeding needed per stem, keeping this test fast to construct.
      seedStem(own, cid, 'jam1', { instrument: 2 })
    }

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual([...stemCIDs].sort())
  })

  // Real perf bug, found live: once the background classify scan started
  // actually succeeding at real scale, a popular role's own confirmed
  // pool grew into the tens of thousands -- resolving every one of them,
  // even with the chunked query above, meant well over a hundred
  // sequential round trips and a genuine multi-minute app-wide beachball.
  // This seeds a pool well past MAX_CANDIDATE_RESOLUTION_POOL (1000) and
  // asserts the resolved result stays bounded, never growing to match the
  // full pool size.
  it('caps the resolved candidate pool at MAX_CANDIDATE_RESOLUTION_POOL, even when far more stems are confirmed', async () => {
    const own = freshDb()
    const stemCIDs = Array.from({ length: 2500 }, (_, i) => `many-${i}`)
    for (const cid of stemCIDs) {
      seedRiff(own, `r-${cid}`, 'jam1', 128, [cid])
      seedStem(own, cid, 'jam1', { instrument: 2 })
    }

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.length).toBe(1000)
    // Every returned candidate is still a REAL, valid match -- capping
    // samples the pool, it doesn't corrupt which stems come back.
    for (const c of candidates) {
      expect(stemCIDs).toContain(c.stemCID)
    }
  })

  // Speed fix, real user report: rolling took ~2 minutes with no
  // improvement, because getMaskKindStemMasks (unlike the
  // embedding-guessed path) had no cache at all -- every roll re-walked
  // every jam's own Stems table from scratch. Same TTL-cache pattern as
  // the embedding path's own equivalent test above.
  it('reuses the instrument-matched pool on a second call for the same db+role within the TTL, even if new data would otherwise change the result', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1', { instrument: 2 }) // bit 1: drum

    const first = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(first.map((c) => c.stemCID)).toEqual(['d1'])

    // A new instrument-matched stem lands after the first call.
    seedRiff(own, 'r2', 'jam1', 128, ['d2'])
    seedStem(own, 'd2', 'jam1', { instrument: 2 })

    const second = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    // Still the cached (stale) result.
    expect(second.map((c) => c.stemCID)).toEqual(['d1'])
  })

  // Real perf bug, found live TWICE: first (root cause of an earlier
  // "stuck rolling" report) as a missing WHERE OwnerJamCID filter --
  // listJamsWithDb() (main/riffLibraryStore.ts) pairs every non-"shared:"
  // jam with the SAME shared archive db connection, not a separate db per
  // jam, so without that filter this query re-scanned the library's
  // ENTIRE Stems table once per jam. Adding `WHERE OwnerJamCID = ?` fixed
  // THAT, but left the per-JAM LOOP itself in place -- confirmed live a
  // second time (root cause of a "still slow, 10-12 seconds every role"
  // report on a real 5,057-jam library): one query PER JAM is 5,057
  // separate round trips every time this role's own cache is cold, even
  // though each individual query was itself fast. Fixed the same way the
  // main candidate-resolution loop already was: group jams by db
  // CONNECTION and read each db's Stems table ONCE, filtering "is this
  // jam allowed" in JS instead of in SQL. This test seeds two jams
  // SHARING one db (the real-world shape) and asserts exactly one query
  // runs (not two), while still correctly excluding a jam outside the
  // caller's own `jams` list.
  it('reads the instrument-matched Stems table once per db, not once per jam, while still excluding jams outside the caller-supplied list', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1', { instrument: 2 }) // bit 1: drum
    seedRiff(own, 'r2', 'jam2', 128, ['d2'])
    seedStem(own, 'd2', 'jam2', { instrument: 2 })
    // Same db, but deliberately NOT in the `jams` list passed below --
    // must still be excluded even though the query no longer filters by
    // jam in SQL.
    seedRiff(own, 'r3', 'jam-not-included', 128, ['d3'])
    seedStem(own, 'd3', 'jam-not-included', { instrument: 2 })

    const prepareSpy = vi.spyOn(own, 'prepare')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own }
      ],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2'])

    const stemsInstrumentQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Stems') && sql.includes('Instrument')
    )
    expect(stemsInstrumentQueries.length).toBe(1)
    // No per-jam or per-row predicate: only the walk's own rowid range
    // (scan plan Task 3), the table's own order.
    expect(stemsInstrumentQueries[0][0].replace(/WHERE rowid > \?/, '')).not.toMatch(/WHERE/)
  })

  // Real perf bug, found live 2026-09-15 via a direct question ("if 15,054
  // drum stems have been analyzed, why does it take 38 seconds on first
  // load?"): the instrument-matched scan used to cache its own ALREADY-
  // FILTERED result per (db, role) -- so this same raw, unfiltered
  // `SELECT ... FROM Stems` (the expensive, disk-bound part on a real
  // external archive) was re-run in FULL for every role not yet
  // individually cached, even though every role reads the exact same rows
  // and only the JS-side bitmask check differs. Rolling 'drums' then
  // 'bass' in the same session, well within the TTL, used to pay that
  // scan twice for identical data. This test seeds one stem matching each
  // role and asserts the raw scan query runs exactly ONCE total across
  // both role calls, not once per role.
  it('reuses the raw instrument-matched Stems scan across DIFFERENT roles for the same db', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1', { instrument: 2 }) // bit 1: drum
    seedRiff(own, 'r2', 'jam1', 128, ['b1'])
    seedStem(own, 'b1', 'jam1', { instrument: 8 }) // bit 3: bass

    const prepareSpy = vi.spyOn(own, 'prepare')

    const drumsResult = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(drumsResult.map((c) => c.stemCID)).toEqual(['d1'])

    const bassResult = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bass']
    })
    expect(bassResult.map((c) => c.stemCID)).toEqual(['b1'])

    const stemsInstrumentQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Stems') && sql.includes('Instrument')
    )
    expect(stemsInstrumentQueries.length).toBe(1)
  })
})

describe('buildRiffIndex beyond the eight slot columns', () => {
  it('indexes a stem that only appears past the eighth slot', async () => {
    const db = freshDb()
    db.exec(RIFF_STEMS_EXTRA_DDL)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, CreationTime, StemCID_1)
       VALUES ('r1', 'jam_1', 120, 100, 'a')`
    ).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()

    const index = await getRiffIndexForDb(db)
    expect(index.has('only_extra')).toBe(true)
  })
})

describe('prewarmDiscoverCandidateCaches', () => {
  // Direct live report: even after the riff-index cache made every roll
  // AFTER the first one fast, the very FIRST roll of a fresh app session
  // still paid the real, one-time table-scan cost (57+ seconds on a real
  // library) on the user's own critical path. This proves pre-warming
  // actually avoids that: a getDiscoverCandidates call AFTER pre-warming
  // must not query Riffs again.
  it('warms the riff index so a later getDiscoverCandidates call does not query Riffs again', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })

    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: own }], own)

    const prepareSpy = vi.spyOn(own, 'prepare')
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])

    const riffsQueries = prepareSpy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))
    expect(riffsQueries.length).toBe(0)
  })

  it('warms each unique db connection exactly once, even with many jams sharing it', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedRiff(own, 'r2', 'jam2', 128, ['s2'])
    seedStem(own, 's2', 'jam2')

    const prepareSpy = vi.spyOn(own, 'prepare')
    await prewarmDiscoverCandidateCaches(
      [
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own }
      ],
      own
    )

    // 2: prewarmDiscoverCandidateCaches' own cache-freshness signal (one
    // COUNT(*)), then buildRiffIndex's one LIMIT/OFFSET page. buildRiffIndex
    // reads the Riffs signal again, but nothing moved in between, so that
    // read reuses the count (tableChangeSignal.ts's shared memo, background
    // scan audit item 1; it was 3 before). own is passed as both the source
    // db AND the cache-storage ownDb here, a realistic case (no external
    // archive configured), and there's no pre-existing cache yet, so this
    // always takes the live-scan path.
    const riffsQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Riffs') && !isSignalHead(sql)
    )
    expect(riffsQueries.length).toBe(2)
  })

  it('does not throw when a db lacks a Riffs table', async () => {
    const broken = new Database(':memory:')
    await expect(
      prewarmDiscoverCandidateCaches([{ jamCID: 'jamBroken', dbForJam: broken }], broken)
    ).resolves.toBeUndefined()
  })

  // Direct report, 2026-09-18: "it seems to do this on every load" -- the
  // real ~4-5 minute scan against a large external archive ran on EVERY
  // app launch, since the in-memory riffIndexCache/instrumentRowsCache are
  // process-lifetime-only. Proves the on-disk cache (discoverIndexCache.ts)
  // is actually consulted and actually skips the live scan when the
  // archive's own row counts haven't changed since it was last saved.
  it('loads from the on-disk cache instead of re-scanning Riffs/Stems when the row counts match', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')

    // Simulate a previous session's already-saved cache -- same row counts
    // (1 riff, 1 stem) as what's really in `own` right now.
    saveRiffIndexCache(
      own,
      own.name,
      new Map([['s1', { riffCID: 'r1', ownerJamCID: 'jam1', bpmRnd: 128, creationTime: 1000 }]]),
      1
    )
    saveInstrumentRowsCache(
      own,
      own.name,
      [{ StemCID: 's1', Instrument: null, OwnerJamCID: 'jam1' }],
      1
    )

    const prepareSpy = vi.spyOn(own, 'prepare')
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: own }], own)

    // Only the cheap freshness-check COUNT(*) against the real Riffs/Stems
    // tables runs (1 each) -- no page-scan query against either live table
    // at all, unlike the cache-miss case above (3 "FROM Riffs" queries).
    const riffsQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Riffs') && !isSignalHead(sql)
    )
    const stemsInstrumentQueries = prepareSpy.mock.calls.filter(([sql]) =>
      /SELECT StemCID, Instrument, OwnerJamCID FROM Stems|COUNT\(\*\) AS n FROM Stems/.test(sql)
    )
    expect(riffsQueries.length).toBe(1)
    expect(stemsInstrumentQueries.length).toBe(1)

    // And the loaded result is actually correct, not just "didn't crash".
    const index = await getRiffIndexForDb(own)
    expect(index.get('s1')).toEqual({
      riffCID: 'r1',
      ownerJamCID: 'jam1',
      bpmRnd: 128,
      creationTime: 1000
    })
  })

  it('falls back to a live scan when the on-disk cache is stale (row count changed)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')

    // A stale cache claiming 5 riffs existed when this was last saved --
    // the real table only has 1 right now, so this must be treated as
    // stale and re-scanned, not trusted.
    saveRiffIndexCache(
      own,
      own.name,
      new Map([
        ['stale', { riffCID: 'stale-riff', ownerJamCID: 'stale-jam', bpmRnd: 999, creationTime: 1 }]
      ]),
      5
    )

    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: own }], own)

    const index = await getRiffIndexForDb(own)
    // seedRiff's own CreationTime, 1000 -- see that helper's own fixture
    // above -- confirms this came from a REAL live rescan of Riffs, not
    // the stale cached 'stale' entry.
    expect(index.get('s1')).toEqual({
      riffCID: 'r1',
      ownerJamCID: 'jam1',
      bpmRnd: 128,
      creationTime: 1000
    })
    expect(index.has('stale')).toBe(false)
  })

  // Direct request, 2026-09-18 ("ideally it would also show a progress bar
  // or meter, or something telling details about what is happening and
  // how long to expect"): proves onProgress is actually threaded through
  // both phases with the right phase/dbIndex/dbCount/completed/total
  // shape, not just that the scan itself still works.
  it('reports onProgress for both phases, reaching completed === total', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1')
    seedStem(own, 's2', 'jam1')

    const updates: Array<{
      phase: string
      dbIndex: number
      dbCount: number
      completed: number
      total: number
    }> = []
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: own }], own, (progress) => {
      updates.push({ ...progress })
    })

    const riffUpdates = updates.filter((u) => u.phase === 'riffIndex')
    const instrumentUpdates = updates.filter((u) => u.phase === 'instrumentRows')
    expect(riffUpdates.length).toBeGreaterThan(0)
    expect(instrumentUpdates.length).toBeGreaterThan(0)

    const lastRiffUpdate = riffUpdates[riffUpdates.length - 1]
    expect(lastRiffUpdate).toMatchObject({ dbIndex: 0, dbCount: 1, completed: 1, total: 1 })
    const lastInstrumentUpdate = instrumentUpdates[instrumentUpdates.length - 1]
    expect(lastInstrumentUpdate).toMatchObject({ dbIndex: 0, dbCount: 1, completed: 2, total: 2 })
  })

  it('reports the correct dbIndex/dbCount when warming multiple unique dbs', async () => {
    const dbA = freshDb()
    seedRiff(dbA, 'r1', 'jamA', 128, ['s1'])
    seedStem(dbA, 's1', 'jamA')
    const dbB = freshDb()
    seedRiff(dbB, 'r2', 'jamB', 128, ['s2'])
    seedStem(dbB, 's2', 'jamB')

    // A separate db from either source -- a real ownDb is one single
    // writable db regardless of how many source dbs get scanned.
    const ownDb = freshDb()
    const dbIndexesSeen = new Set<number>()
    await prewarmDiscoverCandidateCaches(
      [
        { jamCID: 'jamA', dbForJam: dbA },
        { jamCID: 'jamB', dbForJam: dbB }
      ],
      ownDb,
      (progress) => {
        expect(progress.dbCount).toBe(2)
        dbIndexesSeen.add(progress.dbIndex)
      }
    )

    expect([...dbIndexesSeen].sort()).toEqual([0, 1])
  })
})

describe('getRandomLibraryCandidate', () => {
  it('returns a real, unclassified stem, labeled with the CALLER-supplied role', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 140, ['s1'])
    seedStem(own, 's1', 'jam1', { presetName: 'anything', creatorUserName: 'elling' })
    // Deliberately no StemCategories/embedding/instrument data at all --
    // this path needs none of it.

    const candidate = await getRandomLibraryCandidate({
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidate).toMatchObject({
      stemCID: 's1',
      riffCID: 'r1',
      jamCID: 'jam1',
      riffBpm: 140,
      presetName: 'anything',
      creatorUserName: 'elling',
      slotKinds: ['drums'],
      drumSubRole: null
    })
  })

  it('reliably finds a stem when most listed jams have none synced (real archive shape)', async () => {
    // Real bug, 2026-09-22: the external archive lists 5,056 jams but only
    // 42 have stems -- guessing 15 random jams missed ~88% of the time,
    // so most random rolls came back "no match".
    const own = freshDb()
    const jams = [{ jamCID: 'jam-with-stems', dbForJam: own }]
    for (let i = 0; i < 300; i++) jams.push({ jamCID: `empty-${i}`, dbForJam: own })
    seedRiff(own, 'r1', 'jam-with-stems', 120, ['s1'])
    seedStem(own, 's1', 'jam-with-stems')
    for (let i = 0; i < 30; i++) {
      const candidate = await getRandomLibraryCandidate({ jams, kinds: ['drums'] })
      expect(candidate?.stemCID).toBe('s1')
    }
  })

  it('returns null when no jam has any stem at all', async () => {
    const own = freshDb()
    const candidate = await getRandomLibraryCandidate({
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidate).toBeNull()
  })

  it('filters by ownership when onlyOwnStems is true', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { creatorUserName: 'someone-else' })

    const candidate = await getRandomLibraryCandidate({
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    // The only stem in the library belongs to someone else -- no match.
    expect(candidate).toBeNull()
  })

  it('finds an owned stem when onlyOwnStems is true and one exists', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1', { creatorUserName: 'someone-else' })
    seedStem(own, 's2', 'jam1', { creatorUserName: 'elling' })

    const candidate = await getRandomLibraryCandidate({
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bass'],
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    expect(candidate?.stemCID).toBe('s2')
  })

  it('does not throw and tries another jam when one jam has no Stems table at all', async () => {
    const broken = new Database(':memory:')
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')

    const candidate = await getRandomLibraryCandidate({
      jams: [
        { jamCID: 'jamBroken', dbForJam: broken },
        { jamCID: 'jam1', dbForJam: own }
      ],
      kinds: ['drums']
    })
    expect(candidate?.stemCID).toBe('s1')
  })

  // Real bug, found live 2026-09-15 (root cause of "no match for this
  // role" on EVERY role, for a brand-new empty project): onlyOwnStems used
  // to pick a random JAM first (up to RANDOM_CANDIDATE_MAX_JAM_ATTEMPTS =
  // 15 tries) and only THEN check whether that jam happened to contain a
  // stem belonging to targetUser -- on a real library where the user's own
  // content lives in a small fraction of all jams (Elling's own: 11 "own"
  // jams out of 5,057 synced, ~0.2% per random pick), 15 attempts
  // essentially never landed on one. This test seeds 1,000 jams sharing
  // ONE db connection (the real-world shape -- listJamsWithDb pairs most
  // jams with the same shared db), only ONE of which has a stem belonging
  // to targetUser -- a 15-random-jam draw out of 1,000 has under a 1.5%
  // chance of ever landing on it, so this reliably demonstrates the fix
  // (a deterministic, targeted query) rather than occasionally passing by
  // luck under the old code too.
  it('reliably finds an owned stem even when it sits in just one jam among many sharing a db -- not a random-jam lottery', async () => {
    const own = freshDb()
    const NUM_JAMS = 1000
    for (let i = 0; i < NUM_JAMS; i++) {
      seedRiff(own, `r${i}`, `jam${i}`, 128, [`s${i}`])
      seedStem(own, `s${i}`, `jam${i}`, { creatorUserName: 'someone-else' })
    }
    // Only jam500's own stem actually belongs to the target user.
    seedRiff(own, 'rOwned', 'jam500', 128, ['sOwned'])
    seedStem(own, 'sOwned', 'jam500', { creatorUserName: 'elling' })

    const jams = Array.from({ length: NUM_JAMS }, (_, i) => ({
      jamCID: `jam${i}`,
      dbForJam: own
    }))

    const candidate = await getRandomLibraryCandidate({
      jams,
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    expect(candidate?.stemCID).toBe('sOwned')
  })

  // Direct bug report, 2026-09-21: "unticked endlesss, still got Endlesss
  // drums" -- random rolls stayed kind-agnostic by design (that's the whole
  // point of the "+ random" escape hatch), but used to ignore the
  // endlesss/audioIn sound-source checkboxes entirely too, which was never
  // the intent. Filtered IN SQL (soundSourceSqlFragment), not by
  // post-filtering the one row already picked -- see that function's own
  // doc comment for why post-filtering would make an audioIn-only roll
  // almost always come back empty.
  describe('soundSource filtering', () => {
    it('audioIn-only returns only a mic-masked stem, never an unmasked/Endlesss one', async () => {
      const own = freshDb()
      seedRiff(own, 'r1', 'jam1', 128, ['drum-stem', 'mic-stem'])
      seedStem(own, 'drum-stem', 'jam1', { instrument: 1 << 1 })
      seedStem(own, 'mic-stem', 'jam1', { instrument: 1 << 4 })

      const candidate = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: false, audioIn: true }
      })
      expect(candidate?.stemCID).toBe('mic-stem')
    })

    it('endlesss-only never returns a mic-masked stem', async () => {
      const own = freshDb()
      seedRiff(own, 'r1', 'jam1', 128, ['drum-stem', 'mic-stem'])
      seedStem(own, 'drum-stem', 'jam1', { instrument: 1 << 1 })
      seedStem(own, 'mic-stem', 'jam1', { instrument: 1 << 4 })

      const candidate = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: true, audioIn: false }
      })
      expect(candidate?.stemCID).toBe('drum-stem')
    })

    it('an unmasked stem (no confident mask at all) counts as endlesss, not audioIn', async () => {
      const own = freshDb()
      seedRiff(own, 'r1', 'jam1', 128, ['unmasked-stem'])
      seedStem(own, 'unmasked-stem', 'jam1') // Instrument left NULL

      const audioInOnly = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: false, audioIn: true }
      })
      expect(audioInOnly).toBeNull()

      const endlesssOnly = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: true, audioIn: false }
      })
      expect(endlesssOnly?.stemCID).toBe('unmasked-stem')
    })

    it('returns null immediately when both endlesss and audioIn are false', async () => {
      const own = freshDb()
      seedRiff(own, 'r1', 'jam1', 128, ['s1'])
      seedStem(own, 's1', 'jam1')

      const candidate = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: false, audioIn: false }
      })
      expect(candidate).toBeNull()
    })

    it('defaults to unfiltered (both true) when soundSource is omitted, same as before', async () => {
      const own = freshDb()
      seedRiff(own, 'r1', 'jam1', 128, ['mic-stem'])
      seedStem(own, 'mic-stem', 'jam1', { instrument: 1 << 4 })

      const candidate = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums']
      })
      expect(candidate?.stemCID).toBe('mic-stem')
    })

    it('threads through to the onlyOwnStems path too', async () => {
      const own = freshDb()
      seedRiff(own, 'r1', 'jam1', 128, ['drum-stem', 'mic-stem'])
      seedStem(own, 'drum-stem', 'jam1', { creatorUserName: 'elling', instrument: 1 << 1 })
      seedStem(own, 'mic-stem', 'jam1', { creatorUserName: 'elling', instrument: 1 << 4 })

      const candidate = await getRandomLibraryCandidate({
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        onlyOwnStems: true,
        targetUser: 'elling',
        soundSource: { endlesss: false, audioIn: true }
      })
      expect(candidate?.stemCID).toBe('mic-stem')
    })
  })
})

describe('getDiscoverCandidates (trait kinds)', () => {
  it('trait-only pool includes mask-tagged stems too', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['high', 'low', 'masked-out'])
    seedStem(own, 'high', 'jam1')
    seedFeatures(own, 'high', featuresJSON({ bassEnergyRatio: 0.9 }))
    seedStem(own, 'low', 'jam1')
    seedFeatures(own, 'low', featuresJSON({ bassEnergyRatio: 0.1 }))
    // Drums-masked -- a trait-only set no longer excludes mask-tagged
    // stems (combination slots, 2026-09-21) -- this one still surfaces
    // despite a cached feature row and a high bassEnergyRatio.
    seedStem(own, 'masked-out', 'jam1', { instrument: 1 << 1 })
    seedFeatures(own, 'masked-out', featuresJSON({ bassEnergyRatio: 0.99 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bassHeavy']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['high', 'low', 'masked-out'])
    const high = candidates.find((c) => c.stemCID === 'high')!
    expect(high.traitValues.bassHeavy).toBeCloseTo(0.9)
    expect(high.slotKinds).toEqual(['bassHeavy'])
  })

  it('includes an audioIn-masked stem as a trait candidate (mask alone cannot place it)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { instrument: 1 << 4 }) // audioIn bit
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.8 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  it('excludes a stem with no cached StemFeatureCache row', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bright']
    })
    expect(candidates).toEqual([])
  })

  it('respects onlyOwnStems for trait kinds the same way mask kinds already do', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mine', 'theirs'])
    seedStem(own, 'mine', 'jam1', { creatorUserName: 'elling' })
    seedFeatures(own, 'mine', featuresJSON({ zcrBrightness: 0.5 }))
    seedStem(own, 'theirs', 'jam1', { creatorUserName: 'someoneElse' })
    seedFeatures(own, 'theirs', featuresJSON({ zcrBrightness: 0.5 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['warm'],
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['mine'])
  })

  it('soundSource: excludes an audioIn-masked stem when audioIn is turned off (endlesss-only)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic-stem'])
    seedStem(own, 'mic-stem', 'jam1', { instrument: 1 << 4 }) // audioIn bit
    seedFeatures(own, 'mic-stem', featuresJSON({ transientDensity: 0.8 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic'],
      soundSource: { endlesss: true, audioIn: false }
    })
    expect(candidates).toEqual([])
  })

  it('soundSource: audioIn-only excludes an unmasked (no confident mask) stem, which counts as Endlesss', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['unmasked'])
    seedStem(own, 'unmasked', 'jam1') // no instrument mask at all
    seedFeatures(own, 'unmasked', featuresJSON({ transientDensity: 0.8 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic'],
      soundSource: { endlesss: false, audioIn: true }
    })
    expect(candidates).toEqual([])
  })

  it('soundSource: audioIn-only INCLUDES an audioIn-masked stem, endlesss-only EXCLUDES it', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic-stem'])
    seedStem(own, 'mic-stem', 'jam1', { instrument: 1 << 4 })
    seedFeatures(own, 'mic-stem', featuresJSON({ transientDensity: 0.8 }))

    const audioInOnly = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic'],
      soundSource: { endlesss: false, audioIn: true }
    })
    expect(audioInOnly.map((c) => c.stemCID)).toEqual(['mic-stem'])

    const endlesssOnly = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic'],
      soundSource: { endlesss: true, audioIn: false }
    })
    expect(endlesssOnly).toEqual([])
  })

  it("soundSource omitted defaults to no filtering (both sources allowed), matching today's behavior", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic-stem', 'unmasked'])
    seedStem(own, 'mic-stem', 'jam1', { instrument: 1 << 4 })
    seedFeatures(own, 'mic-stem', featuresJSON({ transientDensity: 0.8 }))
    seedStem(own, 'unmasked', 'jam1')
    seedFeatures(own, 'unmasked', featuresJSON({ transientDensity: 0.2 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['mic-stem', 'unmasked'])
  })

  it('trait-only pool includes a stem confirmed for some role', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['confirmed-elsewhere'])
    seedStem(own, 'confirmed-elsewhere', 'jam1') // no instrument mask at all
    seedFeatures(own, 'confirmed-elsewhere', featuresJSON({ bassEnergyRatio: 0.9 }))
    seedCategory(own, 'confirmed-elsewhere', { arrangeRole: 'vocal' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bassHeavy']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['confirmed-elsewhere'])
  })

  it('skips a stem with malformed FeaturesJSON rather than crashing', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['broken', 'good'])
    seedStem(own, 'broken', 'jam1')
    own
      .prepare(
        `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 1000)`
      )
      .run('broken', 'not valid json{{{')
    seedStem(own, 'good', 'jam1')
    seedFeatures(own, 'good', featuresJSON({ bassEnergyRatio: 0.5 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bassHeavy']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['good'])
  })

  it('does not throw when a surviving stem has no matching db entry in the caller-supplied jams list', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ bassEnergyRatio: 0.5 }))

    // Empty jams list -- s1 is sampled from StemFeatureCache but has no
    // known owning jam/db at all, matching the real "stem exists in the
    // feature cache but the caller's own jams list doesn't cover it"
    // shape this function must tolerate rather than throw on.
    await expect(
      getDiscoverCandidates({ ownDb: own, jams: [], kinds: ['bassHeavy'] })
    ).resolves.toEqual([])
  })
})

describe('getDiscoverCandidates (kind sets)', () => {
  const DRUM = 1 << 1
  const BASS = 1 << 3

  it('mask kinds OR together, deduped', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d', 'b', 'n'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedStem(own, 'b', 'jam1', { instrument: BASS })
    seedStem(own, 'n', 'jam1', { instrument: 1 << 2 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bass', 'drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['b', 'd'])
    expect(candidates.every((c) => c.slotKinds.join('+') === 'drums+bass')).toBe(true)
  })

  // Direct request, 2026-09-22: the sound-source checkboxes alone decide
  // which side the user gets, applied to every mask-kind candidate by its
  // own instrument mask.
  const MIC = 1 << 4
  const endlesssOff = { endlesss: false, audioIn: true }
  const audioInOff = { endlesss: true, audioIn: false }

  it('an Endlesss drum-masked stem disappears from drums with endlesss off', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })

    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: endlesssOff
      })
    ).toEqual([])
  })

  it('a mic-masked stem auto-classified drums appears in drums, and survives endlesss off', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic', 'd'])
    seedStem(own, 'mic', 'jam1', { instrument: MIC })
    seedAutoCategory(own, 'mic', 'drums')
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    const jams = [{ jamCID: 'jam1', dbForJam: own }]

    const all = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    expect(all.map((c) => c.stemCID).sort()).toEqual(['d', 'mic'])

    const micOnly = await getDiscoverCandidates({
      ownDb: own,
      jams,
      kinds: ['drums'],
      soundSource: endlesssOff
    })
    expect(micOnly.map((c) => c.stemCID)).toEqual(['mic'])

    const endlesssOnly = await getDiscoverCandidates({
      ownDb: own,
      jams,
      kinds: ['drums'],
      soundSource: audioInOff
    })
    expect(endlesssOnly.map((c) => c.stemCID)).toEqual(['d'])
  })

  it('an unmasked auto-drums stem appears with endlesss on and disappears with audioIn-only', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['u'])
    seedStem(own, 'u', 'jam1')
    seedAutoCategory(own, 'u', 'drums')
    const jams = [{ jamCID: 'jam1', dbForJam: own }]

    const onlyEndlesss = await getDiscoverCandidates({
      ownDb: own,
      jams,
      kinds: ['drums'],
      soundSource: audioInOff
    })
    expect(onlyEndlesss.map((c) => c.stemCID)).toEqual(['u'])
    expect(
      await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'], soundSource: endlesssOff })
    ).toEqual([])
  })

  it('an Endlesss drum-masked stem auto-guessed bass does not appear in bass', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedAutoCategory(own, 'd', 'bass')
    const jams = [{ jamCID: 'jam1', dbForJam: own }]

    expect(await getDiscoverCandidates({ ownDb: own, jams, kinds: ['bass'] })).toEqual([])
    const drums = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    expect(drums.map((c) => c.stemCID)).toEqual(['d'])
  })

  it('a mic stem confirmed for another role is excluded even if auto-guessed for this one', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic'])
    seedStem(own, 'mic', 'jam1', { instrument: MIC })
    seedCategory(own, 'mic', { arrangeRole: 'vocal' })
    seedAutoCategory(own, 'mic', 'drums')

    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums']
      })
    ).toEqual([])
  })

  it('a confirmed mic stem obeys the sound-source filter by its own mask', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic'])
    seedStem(own, 'mic', 'jam1', { instrument: MIC })
    seedCategory(own, 'mic', { arrangeRole: 'lead' })
    const jams = [{ jamCID: 'jam1', dbForJam: own }]

    const micOnly = await getDiscoverCandidates({
      ownDb: own,
      jams,
      kinds: ['lead'],
      soundSource: endlesssOff
    })
    expect(micOnly.map((c) => c.stemCID)).toEqual(['mic'])
    expect(
      await getDiscoverCandidates({ ownDb: own, jams, kinds: ['lead'], soundSource: audioInOff })
    ).toEqual([])
  })

  it('mask kinds return nothing when both sources are off', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })

    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: false, audioIn: false }
      })
    ).toEqual([])
  })

  it('mask + trait: filters by mask, attaches trait values from StemFeatureCache', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['cached', 'uncached', 'mic'])
    seedStem(own, 'cached', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'cached', featuresJSON({ spectralCentroidHz: 400 }))
    seedStem(own, 'uncached', 'jam1', { instrument: DRUM })
    seedStem(own, 'mic', 'jam1', { instrument: 1 << 4 })
    seedFeatures(own, 'mic', featuresJSON({ spectralCentroidHz: 100 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['warm', 'drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['cached', 'uncached'])
    expect(candidates.find((c) => c.stemCID === 'cached')!.traitValues).toEqual({ warm: 400 })
    expect(candidates.find((c) => c.stemCID === 'uncached')!.traitValues).toEqual({})
  })

  it('trait-only: every requested trait value is attached', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.6, spectralCentroidHz: 900 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic', 'warm']
    })
    expect(c.traitValues).toEqual({ rhythmic: 0.6, warm: 900 })
    expect(c.slotKinds).toEqual(['rhythmic', 'warm'])
  })

  it('trait-only: attaches library-wide, direction-adjusted percentiles', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.5, spectralCentroidHz: 1000 }))
    // Library rows outside the pool (no Stems row) still shape the table:
    // s1 sits at the median of transientDensity and the top of centroid.
    for (const [cid, density, hz] of [
      ['lib0', 0, 0],
      ['lib1', 0.25, 250],
      ['lib2', 0.75, 500],
      ['lib3', 1, 750]
    ] as const) {
      seedFeatures(own, cid, featuresJSON({ transientDensity: density, spectralCentroidHz: hz }))
    }

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic', 'warm']
    })
    expect(c.stemCID).toBe('s1')
    expect(c.traitPercentiles.rhythmic).toBeCloseTo(0.5)
    // Highest centroid in the library -> least warm.
    expect(c.traitPercentiles.warm).toBeCloseTo(0)
  })

  it('Phase 3: a re-extracted stem is placed by the preferred field, an old row by its fallback field', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['fresh', 'old'])
    seedStem(own, 'fresh', 'jam1')
    seedStem(own, 'old', 'jam1')
    // fresh: median rhythmicStrength among re-extracted rows, but the
    // HIGHEST transientDensity of all -- so a transientDensity lookup would
    // wrongly put it at the top.
    seedFeatures(
      own,
      'fresh',
      featuresJSON({ transientDensity: 100, rhythmicStrength: 0.5, featureVersion: 2 })
    )
    // old: no rhythmicStrength -- median of transientDensity.
    seedFeatures(own, 'old', featuresJSON({ transientDensity: 2 }))
    for (const [cid, density, strength] of [
      ['lib0', 0, 0],
      ['lib1', 1, 0.25],
      ['lib2', 3, 0.75],
      ['lib3', 4, 1]
    ] as const) {
      seedFeatures(
        own,
        cid,
        featuresJSON({ transientDensity: density, rhythmicStrength: strength, featureVersion: 2 })
      )
    }

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic']
    })
    const fresh = candidates.find((c) => c.stemCID === 'fresh')!
    const old = candidates.find((c) => c.stemCID === 'old')!
    expect(fresh.traitValues).toEqual({ rhythmic: 0.5 })
    expect(fresh.traitFieldValues).toEqual({ rhythmicStrength: 0.5, transientDensity: 100 })
    expect(fresh.traitPercentiles.rhythmic).toBeCloseTo(0.5)
    expect(old.traitValues).toEqual({ rhythmic: 2 })
    // transientDensity over all 6 rows: 0,1,2,3,4,100 -> 2 sits at 0.4.
    expect(old.traitPercentiles.rhythmic).toBeCloseTo(0.4)
  })

  it('mask + trait: percentiles for cached stems, {} for uncached', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['cached', 'uncached'])
    seedStem(own, 'cached', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'cached', featuresJSON({ spectralCentroidHz: 400 }))
    seedFeatures(own, 'lib', featuresJSON({ spectralCentroidHz: 4000 }))
    seedStem(own, 'uncached', 'jam1', { instrument: DRUM })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bright', 'drums']
    })
    expect(candidates.find((c) => c.stemCID === 'cached')!.traitPercentiles).toEqual({
      bright: 0
    })
    expect(candidates.find((c) => c.stemCID === 'uncached')!.traitPercentiles).toEqual({})
  })

  it('mask-only: traitPercentiles is {}', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'd', featuresJSON({ spectralCentroidHz: 400 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(c.traitPercentiles).toEqual({})
  })

  it('alsoTraits (fold mode clash): a mask-only roll gets percentiles for the asked traits, nothing else changes', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'd', featuresJSON({ transientDensity: 0.5, spectralCentroidHz: 4000 }))
    seedFeatures(own, 'lib', featuresJSON({ transientDensity: 1, spectralCentroidHz: 400 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      alsoTraits: ['rhythmic', 'bright']
    })
    expect(c.slotKinds).toEqual(['drums'])
    expect(Object.keys(c.traitPercentiles).sort()).toEqual(['bright', 'rhythmic'])
    expect(c.traitPercentiles.bright).toBeCloseTo(1)
  })

  it("alsoTraits on a trait-only roll adds to the slot's own kinds", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.6, spectralCentroidHz: 900 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['warm'],
      alsoTraits: ['rhythmic', 'bright']
    })
    expect(c.slotKinds).toEqual(['warm'])
    expect(c.traitValues).toEqual({ warm: 900, rhythmic: 0.6, bright: 900 })
  })

  it('alsoIntensity: every candidate carries its intensity score; absent, none does', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['busy', 'calm', 'none'])
    seedStem(own, 'busy', 'jam1', { instrument: DRUM })
    seedStem(own, 'calm', 'jam1', { instrument: DRUM })
    seedStem(own, 'none', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'busy', featuresJSON({ transientDensity: 9, bassEnergyRatio: 0.9 }))
    seedFeatures(own, 'calm', featuresJSON({ transientDensity: 1, bassEnergyRatio: 0.1 }))
    const roll = (alsoIntensity?: boolean): ReturnType<typeof getDiscoverCandidates> =>
      getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        ...(alsoIntensity !== undefined && { alsoIntensity })
      })
    const leaned = await roll(true)
    const of = (id: string): number | null | undefined =>
      leaned.find((c) => c.stemCID === id)!.intensity
    expect(of('busy')!).toBeGreaterThan(of('calm')!)
    expect(of('none')).toBeNull()
    for (const c of await roll()) expect('intensity' in c).toBe(false)
    for (const c of await roll(false)) expect('intensity' in c).toBe(false)
  })

  it('an empty kind set returns []', async () => {
    const own = freshDb()
    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: []
      })
    ).toEqual([])
  })
})

describe('getDiscoverCandidates (kindSources)', () => {
  const DRUM = 1 << 1
  const BASS = 1 << 3
  const MIC = 1 << 4
  const jamsFor = (db: Database.Database): { jamCID: string; dbForJam: Database.Database }[] => [
    { jamCID: 'jam1', dbForJam: db }
  ]

  it("an Endlesss drum-masked stem is admitted to drums by 'tag'", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })

    const [c] = await getDiscoverCandidates({ ownDb: own, jams: jamsFor(own), kinds: ['drums'] })
    expect(c.kindSources).toEqual({ drums: 'tag' })
  })

  it("a stem confirmed for drums is 'confirmed', even when its mask would also say drums", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d', 'u'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedStem(own, 'u', 'jam1')
    seedCategory(own, 'd', { arrangeRole: 'drums' })
    seedCategory(own, 'u', { arrangeRole: 'drums' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: jamsFor(own),
      kinds: ['drums']
    })
    const byCID = new Map(candidates.map((c) => [c.stemCID, c]))
    expect(byCID.get('d')!.kindSources).toEqual({ drums: 'confirmed' })
    expect(byCID.get('u')!.kindSources).toEqual({ drums: 'confirmed' })
  })

  it("a mic stem admitted by the overnight classifier is 'guess'", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic', 'bare'])
    seedStem(own, 'mic', 'jam1', { instrument: MIC })
    seedStem(own, 'bare', 'jam1')
    seedAutoCategory(own, 'mic', 'drums')
    seedAutoCategory(own, 'bare', 'drums')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: jamsFor(own),
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.kindSources)).toEqual([{ drums: 'guess' }, { drums: 'guess' }])
  })

  it('a combination set records the source under the kind that admitted each stem', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d', 'b'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedStem(own, 'b', 'jam1', { instrument: BASS })
    seedCategory(own, 'b', { arrangeRole: 'bass' })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: jamsFor(own),
      kinds: ['drums', 'bass', 'bright']
    })
    const byCID = new Map(candidates.map((c) => [c.stemCID, c]))
    expect(byCID.get('d')!.kindSources).toEqual({ drums: 'tag' })
    expect(byCID.get('b')!.kindSources).toEqual({ bass: 'confirmed' })
  })

  it('trait-only candidates carry an empty kindSources', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'd', featuresJSON({ spectralCentroidHz: 400 }))

    const [c] = await getDiscoverCandidates({ ownDb: own, jams: jamsFor(own), kinds: ['bright'] })
    expect(c.kindSources).toEqual({})
  })

  // Phase 2 reclassify: Discover writes through Tidy Up's own role path
  // (upsertStemCategoryRole, source 'discover') with the bare StemCID as the
  // "path" -- stemCIDForPath resolves a path by its basename, and a
  // StemCID is its own basename.
  it("a Discover reclassify moves a guessed stem to the chosen kind as 'confirmed'", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['mic'])
    seedStem(own, 'mic', 'jam1', { instrument: MIC })
    seedAutoCategory(own, 'mic', 'drums')

    upsertStemCategoryRole(own, [{ path: 'mic', arrangeRole: 'bass' }], 'discover', null, 2000)

    const row = own
      .prepare(`SELECT ArrangeRole, Source FROM StemCategories WHERE StemCID = 'mic'`)
      .get()
    expect(row).toEqual({ ArrangeRole: 'bass', Source: 'discover' })
    expect(
      await getDiscoverCandidates({ ownDb: own, jams: jamsFor(own), kinds: ['drums'] })
    ).toEqual([])
    const [c] = await getDiscoverCandidates({ ownDb: own, jams: jamsFor(own), kinds: ['bass'] })
    expect(c.kindSources).toEqual({ bass: 'confirmed' })
  })
})

describe('background efficiency B1: trait values from the in-memory table', () => {
  const DRUM = 1 << 1
  const jams = (db: Database.Database): { jamCID: string; dbForJam: Database.Database }[] => [
    { jamCID: 'jam1', dbForJam: db }
  ]
  const byStem = (cs: { stemCID: string }[]): string[] => cs.map((c) => c.stemCID).sort()
  const traitShape = (
    cs: Awaited<ReturnType<typeof getDiscoverCandidates>>
  ): Record<string, unknown> =>
    Object.fromEntries(
      cs.map((c) => [
        c.stemCID,
        {
          traitValues: c.traitValues,
          traitFieldValues: c.traitFieldValues,
          traitPercentiles: c.traitPercentiles,
          kindSources: c.kindSources,
          riffCID: c.riffCID,
          presetName: c.presetName
        }
      ])
    )

  function seedLibrary(own: Database.Database): void {
    const stems = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    seedRiff(own, 'r1', 'jam1', 120, stems)
    stems.forEach((cid, i) => {
      seedStem(own, cid, 'jam1', { instrument: i % 2 === 0 ? DRUM : undefined })
      seedFeatures(
        own,
        cid,
        featuresJSON({
          transientDensity: i,
          bassEnergyRatio: i / 10,
          spectralCentroidHz: 500 + i * 100,
          ...(i % 3 === 0 ? { rhythmicStrength: i / 7, spectralCentroidFftHz: 900 + i } : {})
        })
      )
    })
    // No cached features for this one.
    seedRiff(own, 'r2', 'jam1', 120, ['nofeat'])
    seedStem(own, 'nofeat', 'jam1', { instrument: DRUM })
  }

  it('trait-only: once the table is built, a roll reads no FeaturesJSON and yields the same values', async () => {
    const own = freshDb()
    seedLibrary(own)
    const kinds = ['warm', 'rhythmic'] as const
    // First roll: no table yet -> SQL path (and its percentile step builds the table).
    const first = await getDiscoverCandidates({ ownDb: own, jams: jams(own), kinds: [...kinds] })

    const prepareSpy = vi.spyOn(own, 'prepare')
    const second = await getDiscoverCandidates({ ownDb: own, jams: jams(own), kinds: [...kinds] })
    expect(prepareSpy.mock.calls.filter(([sql]) => sql.includes('FeaturesJSON'))).toEqual([])

    expect(byStem(second)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(traitShape(second)).toEqual(traitShape(first))
  })

  it('mask + trait: once the table is built, trait values come from memory, identical to the SQL path', async () => {
    const own = freshDb()
    seedLibrary(own)
    const first = await getDiscoverCandidates({
      ownDb: own,
      jams: jams(own),
      kinds: ['drums', 'warm']
    })
    const prepareSpy = vi.spyOn(own, 'prepare')
    const second = await getDiscoverCandidates({
      ownDb: own,
      jams: jams(own),
      kinds: ['drums', 'warm']
    })
    expect(prepareSpy.mock.calls.filter(([sql]) => sql.includes('FeaturesJSON'))).toEqual([])
    expect(byStem(second)).toEqual(['a', 'c', 'e', 'g', 'nofeat'])
    expect(traitShape(second)).toEqual(traitShape(first))
    expect(second.find((c) => c.stemCID === 'nofeat')!.traitValues).toEqual({})
  })

  it('trait-only: the table-sampled pool stays bounded by MAX_CANDIDATE_RESOLUTION_POOL', async () => {
    const own = freshDb()
    const n = 1203
    const insertMany = own.transaction(() => {
      for (let r = 0; r * 8 < n; r++) {
        const cids = Array.from({ length: 8 }, (_, i) => `s${r * 8 + i}`).filter(
          (_, i) => r * 8 + i < n
        )
        seedRiff(own, `r${r}`, 'jam1', 120, cids)
        for (const cid of cids) {
          seedStem(own, cid, 'jam1')
          seedFeatures(own, cid, featuresJSON({ bassEnergyRatio: 0.5 }))
        }
      }
    })
    insertMany()
    await getDiscoverCandidates({ ownDb: own, jams: jams(own), kinds: ['bassHeavy'] })
    const pool = await getDiscoverCandidates({ ownDb: own, jams: jams(own), kinds: ['bassHeavy'] })
    expect(pool.length).toBe(1000)
    expect(new Set(pool.map((c) => c.stemCID)).size).toBe(1000)
  })

  it('a feature row written behind the table (count moved) sends the roll back to SQL, so it is still seen', async () => {
    const own = freshDb()
    seedLibrary(own)
    await getDiscoverCandidates({ ownDb: own, jams: jams(own), kinds: ['bassHeavy'] })
    seedFeatures(own, 'nofeat', featuresJSON({ bassEnergyRatio: 0.33 }))
    const pool = await getDiscoverCandidates({ ownDb: own, jams: jams(own), kinds: ['bassHeavy'] })
    expect(pool.find((c) => c.stemCID === 'nofeat')?.traitValues).toEqual({ bassHeavy: 0.33 })
  })
})

describe('background efficiency B2: per-kind stem lists', () => {
  const MASKS = [null, 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4, (1 << 4) | (1 << 1), 1 << 6]
  const ROLES = ['drums', 'bass', 'lead', 'aux']
  type Kind = 'drums' | 'bass' | 'lead'

  /** The pre-B2 walk (getMaskKindStemMasks + getMaskDiscoverCandidates's
   * confirmed/sound-source steps), written out plainly -- the reference the
   * precomputed lists must reproduce. */
  function referencePool(
    own: Database.Database,
    jams: { jamCID: string; dbForJam: Database.Database }[],
    kind: Kind,
    soundSource = { endlesss: true, audioIn: true }
  ): Map<string, string> {
    const confirmed = new Map(
      (
        own
          .prepare(`SELECT StemCID, ArrangeRole FROM StemCategories WHERE ArrangeRole IS NOT NULL`)
          .all() as { StemCID: string; ArrangeRole: string }[]
      ).map((r) => [r.StemCID, r.ArrangeRole])
    )
    const auto = new Map(
      (
        own.prepare(`SELECT StemCID, ArrangeRole FROM StemAutoCategory`).all() as {
          StemCID: string
          ArrangeRole: string
        }[]
      ).map((r) => [r.StemCID, r.ArrangeRole])
    )
    const byDb = new Map<Database.Database, Set<string>>()
    for (const j of jams) {
      if (!byDb.has(j.dbForJam)) byDb.set(j.dbForJam, new Set())
      byDb.get(j.dbForJam)!.add(j.jamCID)
    }
    const admitted = new Map<string, { instrument: number | null; source: string }>()
    for (const [db, allowed] of byDb) {
      const rows = db
        .prepare(`SELECT StemCID, Instrument, OwnerJamCID FROM Stems ORDER BY StemCID`)
        .all() as { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
      for (const row of rows) {
        if (!allowed.has(row.OwnerJamCID) || admitted.has(row.StemCID)) continue
        const c = confirmed.get(row.StemCID)
        if (c !== undefined) {
          if (c === kind)
            admitted.set(row.StemCID, { instrument: row.Instrument, source: 'confirmed' })
          continue
        }
        const t = row.Instrument === null ? null : instrumentMaskToSoundType(row.Instrument)
        const placed = t === 'drums' || t === 'bass' || t === 'notes'
        const ok = placed
          ? (t === 'drums' && kind === 'drums') ||
            (t === 'bass' && kind === 'bass') ||
            (t === 'notes' && kind === 'lead')
          : auto.get(row.StemCID) === kind
        if (ok)
          admitted.set(row.StemCID, {
            instrument: row.Instrument,
            source: placed ? 'tag' : 'guess'
          })
      }
    }
    const out = new Map<string, string>()
    // Confirmed stems the walk never passed still count (mask unknown).
    for (const [cid, role] of confirmed) if (role === kind) out.set(cid, 'confirmed')
    for (const [cid, a] of admitted) {
      if (!out.has(cid)) out.set(cid, a.source)
    }
    for (const cid of [...out.keys()]) {
      if (!soundSourceMatchesFilter(admitted.get(cid)?.instrument, soundSource)) out.delete(cid)
    }
    return out
  }

  function seedRandomLibrary(own: Database.Database, other: Database.Database, seed: number): void {
    let x = seed
    const rand = (n: number): number => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x % n
    }
    for (let r = 0; r < 40; r++) {
      const db = r % 4 === 3 ? other : own
      const jam = `jam${r % 5}`
      const cids = Array.from({ length: 8 }, (_, i) => `s${r * 8 + i}`)
      seedRiff(db, `r${r}`, jam, 120, cids)
      for (const cid of cids) {
        seedStem(db, cid, jam, { instrument: MASKS[rand(MASKS.length)] ?? undefined })
        if (rand(5) === 0) seedCategory(own, cid, { arrangeRole: ROLES[rand(ROLES.length)] })
        else if (rand(4) === 0) seedCategory(own, cid, { busId: 'drums' }) // bus-only row
        if (rand(3) === 0) seedAutoCategory(own, cid, ROLES[rand(ROLES.length)])
      }
    }
    // A stem present in both dbs with different masks.
    seedRiff(other, 'rdup', 'jam1', 120, ['s0'])
    seedStem(other, 's0', 'jam1', { instrument: 1 << 3 })
  }

  it('matches the old per-roll walk for a mixed library (tag/confirmed/guess/excluded, two dbs, a jam left out)', async () => {
    for (const seed of [1, 7, 42]) {
      const own = freshDb()
      const other = freshDb()
      seedRandomLibrary(own, other, seed)
      const jams = [
        { jamCID: 'jam0', dbForJam: own },
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own },
        { jamCID: 'jam3', dbForJam: own },
        { jamCID: 'jam1', dbForJam: other },
        { jamCID: 'jam3', dbForJam: other }
      ]
      for (const kind of ['drums', 'bass', 'lead'] as Kind[]) {
        for (const soundSource of [
          { endlesss: true, audioIn: true },
          { endlesss: false, audioIn: true },
          { endlesss: true, audioIn: false }
        ]) {
          const expected = referencePool(own, jams, kind, soundSource)
          const got = await getDiscoverCandidates({ ownDb: own, jams, kinds: [kind], soundSource })
          // A confirmed stem with no resolvable riff/Stems row drops out at
          // resolution -- compare against what resolution keeps.
          const resolvable = new Set(got.map((c) => c.stemCID))
          const expectedResolvable = [...expected].filter(([cid]) => resolvable.has(cid))
          expect(got.map((c) => [c.stemCID, c.kindSources[kind]]).sort()).toEqual(
            expectedResolvable.sort()
          )
          // ...and nothing the reference admits that is resolvable is missing.
          for (const [cid] of expected) {
            const inSomeJam = jams.some(
              (j) =>
                j.dbForJam
                  .prepare(`SELECT 1 FROM Stems WHERE StemCID = ? AND OwnerJamCID = ?`)
                  .get(cid, j.jamCID) &&
                j.dbForJam
                  .prepare(
                    `SELECT 1 FROM Riffs WHERE StemCID_1 = ? OR StemCID_2 = ? OR StemCID_3 = ? OR StemCID_4 = ? OR StemCID_5 = ? OR StemCID_6 = ? OR StemCID_7 = ? OR StemCID_8 = ?`
                  )
                  .get(...Array(8).fill(cid))
            )
            if (inSomeJam) expect(resolvable.has(cid)).toBe(true)
          }
        }
      }
    }
  })

  it('reuses the precomputed lists when nothing changed (no classification re-read)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['d1', 'm1'])
    seedStem(own, 'd1', 'jam1', { instrument: 1 << 1 })
    seedStem(own, 'm1', 'jam1', { instrument: 1 << 4 })
    seedAutoCategory(own, 'm1', 'drums')
    const jams = [{ jamCID: 'jam1', dbForJam: own }]
    await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })

    const prepareSpy = vi.spyOn(own, 'prepare')
    const again = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    const bass = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['bass'] })
    expect(again.map((c) => c.stemCID).sort()).toEqual(['d1', 'm1'])
    expect(bass).toEqual([])
    const rebuildReads = prepareSpy.mock.calls.filter(
      ([sql]) =>
        /SELECT StemCID, ArrangeRole FROM StemAutoCategory/.test(sql) ||
        /ArrangeRole IS NOT NULL`?$/.test(sql.trim()) ||
        /FROM StemAutoCategory WHERE ArrangeRole = \?/.test(sql)
    )
    expect(rebuildReads).toEqual([])
  })

  it('picks up a reclassify (upsertStemCategoryRole) on the very next roll', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['mic', 'd1'])
    seedStem(own, 'mic', 'jam1', { instrument: 1 << 4 })
    seedStem(own, 'd1', 'jam1', { instrument: 1 << 1 })
    seedCategory(own, 'mic', { arrangeRole: 'drums' }) // UpdatedAt 1000
    const jams = [{ jamCID: 'jam1', dbForJam: own }]
    const before = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    expect(before.map((c) => [c.stemCID, c.kindSources.drums]).sort()).toEqual([
      ['d1', 'tag'],
      ['mic', 'confirmed']
    ])

    // An in-place role change with the SAME UpdatedAt: row count, MAX and
    // TOTAL of UpdatedAt all stay put -- only the writer's version bump
    // can tell the precomputed lists they're stale.
    upsertStemCategoryRole(own, [{ path: 'mic', arrangeRole: 'bass' }], 'discover', null, 1000)
    const drums = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    expect(drums.map((c) => c.stemCID)).toEqual(['d1'])
    const bass = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['bass'] })
    expect(bass.map((c) => [c.stemCID, c.kindSources.bass])).toEqual([['mic', 'confirmed']])
  })

  it('picks up a StemAutoCategory row written straight to SQL (change signal query)', async () => {
    let now = 3_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['mic'])
    seedStem(own, 'mic', 'jam1', { instrument: 1 << 4 })
    const jams = [{ jamCID: 'jam1', dbForJam: own }]
    expect(await getDiscoverCandidates({ ownDb: own, jams, kinds: ['lead'] })).toEqual([])
    seedAutoCategory(own, 'mic', 'lead')
    // The guess layer rebuilds at most every GUESS_LAYER_MIN_MS (scan plan
    // Task 10): the signal still sees the write, on the next rebuild.
    now += 10_000
    const lead = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['lead'] })
    expect(lead.map((c) => [c.stemCID, c.kindSources.lead])).toEqual([['mic', 'guess']])
    vi.restoreAllMocks()
  })
})

describe('background efficiency B3: change detection instead of a TTL', () => {
  const T0 = 1_000_000_000
  let now = T0
  const advance = (ms: number): void => {
    now += ms
  }
  const pageQueries = (spy: { mock: { calls: unknown[][] } }, table: string): unknown[] =>
    spy.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes(`FROM ${table}`) && sql.includes('LIMIT')
    )

  beforeEach(() => {
    now = T0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('an unchanged Riffs table is never rescanned, however long it has been', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    const first = await getRiffIndexForDb(own)
    const spy = vi.spyOn(own, 'prepare')
    for (let i = 0; i < 5; i++) {
      advance(10 * 60_000)
      expect(await getRiffIndexForDb(own)).toBe(first)
    }
    expect(pageQueries(spy, 'Riffs')).toEqual([])
  })

  it('checks at most once per interval: an insert inside it is not looked for yet', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    const first = await getRiffIndexForDb(own)
    seedRiff(own, 'r2', 'jam1', 128, ['s2'])
    const spy = vi.spyOn(own, 'prepare')
    advance(5_000)
    expect(await getRiffIndexForDb(own)).toBe(first)
    expect(spy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))).toEqual([])
  })

  it('picks up an insert on the next check -- by extending the index, not rebuilding it', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    const first = await getRiffIndexForDb(own)
    seedRiff(own, 'r2', 'jam1', 128, ['s2'])
    advance(31_000)
    const second = await getRiffIndexForDb(own)
    // Extended in place from its rowid watermark (scan plan Task 2).
    expect(second).toBe(first)
    expect(second.get('s2')?.riffCID).toBe('r2')
    expect(second.get('s1')?.riffCID).toBe('r1')
  })

  it('rebuilds after a delete (count moved, max rowid did not)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedRiff(own, 'r2', 'jam1', 128, ['s2'])
    const first = await getRiffIndexForDb(own)
    own.prepare(`DELETE FROM Riffs WHERE RiffCID = 'r1'`).run()
    advance(31_000)
    const second = await getRiffIndexForDb(own)
    expect(second.has('s1')).toBe(false)
    expect(second.has('s2')).toBe(true)
    expect(first.has('s1')).toBe(true)
  })

  // REWRITTEN 2026-09-28 (see tableWriteVersion.ts). This used to assert
  // that an in-place UPDATE made straight to SQL was picked up once the
  // cache aged past SCAN_CACHE_INPLACE_TTL_MS, which worked because the
  // signal included `total_changes()`. That counter is per-CONNECTION and
  // spans every table, and since the background classifier writes
  // StemAutoCategory on this same connection every few seconds, it made
  // EVERY cache here stale on a 5-minute timer forever -- the exact
  // behaviour 8d81f22 set out to remove. In-place detection is now
  // per-table and announced by the writer, so the contract changed in
  // both directions, and both directions are pinned below.
  it('an in-place UPDATE is picked up on the next check once the writer announces it', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, [])
    const first = await getRiffIndexForDb(own)
    expect(first.size).toBe(0)
    own.prepare(`UPDATE Riffs SET StemCID_1 = 's1' WHERE RiffCID = 'r1'`).run()
    // Exactly what every real Riffs writer now does (riffLibraryWriter.ts).
    bumpTableWriteVersion(own, 'Riffs')
    advance(31_000)
    const later = await getRiffIndexForDb(own)
    // Immediately on the next check -- no 5-minute wait, because the
    // write is known rather than inferred.
    expect(later.get('s1')?.riffCID).toBe('r1')
  })

  it('an in-place UPDATE written straight to SQL, behind the writers, is NOT detected', async () => {
    // The deliberate cost of the above. Nothing in this app writes
    // Jams/Riffs/Stems outside riffLibraryWriter.ts, and a foreign
    // connection (a real LORE sync writing the archive) still moves
    // data_version and is still caught. An unannounced raw write on our
    // OWN connection is the one case that is now invisible, and it is
    // worth far less than a cache that survives longer than five minutes.
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, [])
    const first = await getRiffIndexForDb(own)
    own.prepare(`UPDATE Riffs SET StemCID_1 = 's1' WHERE RiffCID = 'r1'`).run()
    advance(31_000 + 5 * 60_000)
    expect(await getRiffIndexForDb(own)).toBe(first)
  })

  it('the background classifier writing StemAutoCategory does NOT invalidate the riff index', async () => {
    // The regression this whole change exists to prevent. Measured
    // 2026-09-28 on Elling's own 5,058-jam archive: the classifier writes
    // these rows continuously, and under the old connection-wide signal
    // that alone was enough to force a full rebuild every five minutes --
    // of a 435,740-row index, on a USB volume, while radio was playing.
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    const first = await getRiffIndexForDb(own)
    for (let i = 0; i < 50; i += 1) {
      upsertStemAutoCategory(own, `other-stem-${i}`, 'drums', 'embedding', 2000 + i)
    }
    advance(31_000 + 10 * 60_000)
    expect(await getRiffIndexForDb(own)).toBe(first)
  })

  it('the instrument rows follow the same rule: a new drum stem appears after the next check, and an unchanged table is not rescanned', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1', { instrument: 1 << 1 })
    const jams = [{ jamCID: 'jam1', dbForJam: own }]
    await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })

    const spy = vi.spyOn(own, 'prepare')
    advance(10 * 60_000)
    const unchanged = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    expect(unchanged.map((c) => c.stemCID)).toEqual(['d1'])
    expect(pageQueries(spy, 'Stems')).toEqual([])
    expect(pageQueries(spy, 'Riffs')).toEqual([])

    seedRiff(own, 'r2', 'jam1', 128, ['d2'])
    seedStem(own, 'd2', 'jam1', { instrument: 1 << 1 })
    advance(31_000)
    const after = await getDiscoverCandidates({ ownDb: own, jams, kinds: ['drums'] })
    expect(after.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2'])
  })

  it('a cache loaded from disk by the prewarm is change-checked the same way', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    saveRiffIndexCache(
      own,
      own.name,
      new Map([['s1', { riffCID: 'r1', ownerJamCID: 'jam1', bpmRnd: 128, creationTime: 1000 }]]),
      1
    )
    saveInstrumentRowsCache(
      own,
      own.name,
      [{ StemCID: 's1', Instrument: null, OwnerJamCID: 'jam1' }],
      1
    )
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: own }], own)
    const loaded = await getRiffIndexForDb(own)
    advance(10 * 60_000)
    expect(await getRiffIndexForDb(own)).toBe(loaded)
    seedRiff(own, 'r2', 'jam1', 128, ['s2'])
    advance(31_000)
    expect((await getRiffIndexForDb(own)).get('s2')?.riffCID).toBe('r2')
  })
})

// Real, diagnosed 2026-09-22: one of Endlesss's storage buckets now 403s
// every anonymous GET, so a large slice of a real library can no longer be
// downloaded at all. Offering one of those stems produces a slot that
// silently ends as "no match" -- so every pool filters them out. A stem
// already on disk is unaffected: the list is about fetching, not about the
// file (see @shared/stemAvailability's stemIsUsable).
describe('stems that can no longer be downloaded are never offered', () => {
  it('the mask pool skips an unavailable stem', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1', { instrument: 1 << 1 })
    seedStem(own, 's2', 'jam1', { instrument: 1 << 1 })
    seedUnavailable(own, 's1')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s2'])
  })

  it('a human-confirmed role does not rescue an unavailable stem -- there is no audio to place', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedUnavailable(own, 's1')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates).toEqual([])
  })

  it('the trait pool skips an unavailable stem', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1')
    seedStem(own, 's2', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ bassEnergyRatio: 0.9 }))
    seedFeatures(own, 's2', featuresJSON({ bassEnergyRatio: 0.8 }))
    seedUnavailable(own, 's1')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bassHeavy']
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s2'])
  })

  it('a random roll never lands on an unavailable stem', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['s1', 's2'])
    seedStem(own, 's1', 'jam1')
    seedStem(own, 's2', 'jam1')
    seedUnavailable(own, 's1')

    for (let i = 0; i < 20; i++) {
      const candidate = await getRandomLibraryCandidate({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums']
      })
      expect(candidate?.stemCID).toBe('s2')
    }
  })

  it("a random roll returns null rather than an unplayable stem when that's all there is", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedUnavailable(own, 's1')

    expect(
      await getRandomLibraryCandidate({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums']
      })
    ).toBeNull()
  })

  it('an own-stems random roll skips unavailable stems too', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['s1', 's2'])
    seedStem(own, 's1', 'jam1', { creatorUserName: 'elling' })
    seedStem(own, 's2', 'jam1', { creatorUserName: 'elling' })
    seedUnavailable(own, 's1')

    for (let i = 0; i < 20; i++) {
      const candidate = await getRandomLibraryCandidate({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        onlyOwnStems: true,
        targetUser: 'elling'
      })
      expect(candidate?.stemCID).toBe('s2')
    }
  })

  it('filters nothing when no stem has ever failed -- the common case pays no price', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1', { instrument: 1 << 1 })
    seedStem(own, 's2', 'jam1', { instrument: 1 << 1 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['s1', 's2'])
  })
})

describe('appendToInMemoryDiscoverCaches', () => {
  it('adds a stem to an already-built riff index without rebuilding it', async () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'j1', 120, ['s1'])
    seedStem(db, 's1', 'j1')
    const first = await getRiffIndexForDb(db)
    expect(first.size).toBe(1)

    seedRiff(db, 'r2', 'discovered', 140, ['s2'])
    appendToInMemoryDiscoverCaches(
      db,
      [
        {
          stemCID: 's2',
          entry: { riffCID: 'r2', ownerJamCID: 'discovered', bpmRnd: 140, creationTime: 20 }
        }
      ],
      []
    )
    const second = await getRiffIndexForDb(db)
    expect(second).toBe(first)
    expect(second.get('s2')?.riffCID).toBe('r2')
    db.close()
  })

  it('leaves a stem already in the index pointing at the riff it was first seen in', async () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'j1', 120, ['s1'])
    seedStem(db, 's1', 'j1')
    await getRiffIndexForDb(db)

    appendToInMemoryDiscoverCaches(
      db,
      [
        {
          stemCID: 's1',
          entry: { riffCID: 'r2', ownerJamCID: 'discovered', bpmRnd: 140, creationTime: 20 }
        }
      ],
      []
    )
    const index = await getRiffIndexForDb(db)
    expect(index.get('s1')?.riffCID).toBe('r1')
    db.close()
  })

  it('is a no-op for a db whose caches were never built', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY); CREATE TABLE Stems (StemCID TEXT);`)
    expect(() =>
      appendToInMemoryDiscoverCaches(
        db,
        [{ stemCID: 's1', entry: { riffCID: 'r', ownerJamCID: 'j', bpmRnd: 1, creationTime: 1 } }],
        []
      )
    ).not.toThrow()
    db.close()
  })
})

describe('sampleDistinctIndices order', () => {
  function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let x = Math.imul(a ^ (a >>> 15), 1 | a)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }

  it('returns k distinct in-range indices', () => {
    const out = sampleDistinctIndices(2000, 1000, mulberry32(1))
    expect(out).toHaveLength(1000)
    expect(new Set(out).size).toBe(1000)
    expect(out.every((i) => i >= 0 && i < 2000)).toBe(true)
  })

  it('position 0 lands in the first half of the table about half the time', () => {
    const n = 2000
    const k = 1000
    const runs = 2000
    const random = mulberry32(12345)
    let firstHalf = 0
    for (let r = 0; r < runs; r++) {
      if (sampleDistinctIndices(n, k, random)[0] < n / 2) firstHalf++
    }
    const frac = firstHalf / runs
    expect(frac).toBeGreaterThan(0.45)
    expect(frac).toBeLessThan(0.55)
  })
})

describe('artist mode: artistStemCIDs filters before the bounded sample', () => {
  // 1,200 of Elling's drums stems swamp a 1,000-stem sample; the 3 by
  // `tiny` must still all come back. Without the pre-filter, each would
  // survive only ~1000/1203 of the time -- this test would flake, not pass.
  function seedSwamp(own: Database.Database): void {
    for (let i = 0; i < 1200; i++) {
      seedRiff(own, `re${i}`, 'jam1', 128, [`e${i}`])
      seedStem(own, `e${i}`, 'jam1', { creatorUserName: 'elling' })
      seedCategory(own, `e${i}`, { arrangeRole: 'drums', busId: 'drums' })
    }
    for (const id of ['t1', 't2', 't3']) {
      seedRiff(own, `r-${id}`, 'jam1', 128, [id])
      seedStem(own, id, 'jam1', { creatorUserName: 'tiny' })
      seedCategory(own, id, { arrangeRole: 'drums', busId: 'drums' })
    }
  }

  it("mask kinds: returns exactly the artist's stems", async () => {
    const own = freshDb()
    seedSwamp(own)
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'tiny',
      artistStemCIDs: new Set(['t1', 't2', 't3'])
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['t1', 't2', 't3'])
  })

  it("trait kinds: samples only the artist's analysed stems (SQL fallback, no value table)", async () => {
    const own = freshDb()
    for (let i = 0; i < 1200; i++) {
      seedRiff(own, `re${i}`, 'jam1', 128, [`e${i}`])
      seedStem(own, `e${i}`, 'jam1', { creatorUserName: 'elling' })
      seedFeatures(own, `e${i}`, featuresJSON({ zcrBrightness: 0.5 }))
    }
    for (const id of ['t1', 't2']) {
      seedRiff(own, `r-${id}`, 'jam1', 128, [id])
      seedStem(own, id, 'jam1', { creatorUserName: 'tiny' })
      seedFeatures(own, id, featuresJSON({ zcrBrightness: 0.5 }))
    }
    seedRiff(own, 'r-t3', 'jam1', 128, ['t3'])
    seedStem(own, 't3', 'jam1', { creatorUserName: 'tiny' }) // not analysed
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bright'],
      onlyOwnStems: true,
      targetUser: 'tiny',
      artistStemCIDs: new Set(['t1', 't2', 't3'])
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['t1', 't2'])
  })

  it('an empty artist set yields nothing, not everything', async () => {
    const own = freshDb()
    seedSwamp(own)
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'nobody',
      artistStemCIDs: new Set()
    })
    expect(candidates).toEqual([])
  })
})

// "Only my stems" sampled 1,000 stems from the WHOLE library and filtered by
// owner afterwards, so a library where his own are 1% gave ~10 candidates.
// discoverStemRestriction (the get-discover-candidates handler's gate) now
// hands his own stems in as the before-the-sample set, as artist mode does.
describe('only my stems: restricted before the bounded sample', () => {
  /** 9,900 stems by others and 100 of his own (1%), every one a drums stem
   * with features. */
  function seedMostlyOthers(own: Database.Database): void {
    const insertRiff = own.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, StemCID_1) VALUES (?, 'jam1', 1000, 128, ?)`
    )
    const insertStem = own.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, PresetName, CreatorUserName) VALUES (?, 'jam1', 'p', ?)`
    )
    const insertCategory = own.prepare(
      `INSERT INTO StemCategories (StemCID, ArrangeRole, BusId, Source, UpdatedAt) VALUES (?, 'drums', 'drums', 'tidyup', 1000)`
    )
    const insertFeatures = own.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 1000)`
    )
    const features = featuresJSON({ zcrBrightness: 0.5 })
    own.transaction(() => {
      for (let i = 0; i < 10_000; i++) {
        const cid = i % 100 === 0 ? `mine-${i}` : `other-${i}`
        insertRiff.run(`r-${cid}`, cid)
        insertStem.run(cid, cid.startsWith('mine-') ? 'elling' : 'someone-else')
        insertCategory.run(cid)
        insertFeatures.run(cid, features)
      }
    })()
  }

  for (const kinds of [['drums'], ['bright']] as const) {
    it(`a "mine" roll (${kinds[0]}) returns every one of his stems, not ~1% of a 1,000 sample`, async () => {
      const own = freshDb()
      seedMostlyOthers(own)
      const jams = [{ jamCID: 'jam1', dbForJam: own }]
      const restriction = await discoverStemRestriction([own], {
        onlyOwnStems: true,
        targetUser: 'elling'
      })
      const candidates = await getDiscoverCandidates({
        ownDb: own,
        jams,
        kinds: [...kinds],
        onlyOwnStems: true,
        targetUser: 'elling',
        artistStemCIDs: restriction
      })
      expect(candidates).toHaveLength(100)
      expect(candidates.every((c) => c.stemCID.startsWith('mine-'))).toBe(true)
    })
  }

  it('an artist wins over "mine"; neither (or no user) restricts nothing', async () => {
    const own = freshDb()
    seedStem(own, 'e1', 'jam1', { creatorUserName: 'elling' })
    seedStem(own, 't1', 'jam1', { creatorUserName: 'tiny' })
    const dbs = [own]
    const all = { onlyOwnStems: true, targetUser: 'elling' }
    expect([...((await discoverStemRestriction(dbs, { ...all, artist: 'tiny' })) ?? [])]).toEqual([
      't1'
    ])
    expect([...((await discoverStemRestriction(dbs, all)) ?? [])]).toEqual(['e1'])
    expect(
      await discoverStemRestriction(dbs, { onlyOwnStems: false, targetUser: 'elling' })
    ).toBeUndefined()
    expect(await discoverStemRestriction(dbs, { onlyOwnStems: true })).toBeUndefined()
  })
})

// Pass-through spy for the trait fast-path test below (vi.mock is hoisted).
// countWork is a no-op in tests, so recording calls changes nothing else.
vi.mock('./workCounters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workCounters')>()
  return { ...actual, countWork: vi.fn() }
})

describe('artist mode: trait value-table fast path', () => {
  it('samples from the in-memory table, never the SQL page', async () => {
    const own = freshDb()
    for (let i = 0; i < 1200; i++) {
      seedRiff(own, `re${i}`, 'jam1', 128, [`e${i}`])
      seedStem(own, `e${i}`, 'jam1', { creatorUserName: 'elling' })
      seedFeatures(own, `e${i}`, featuresJSON({ zcrBrightness: 0.5 }))
    }
    for (const id of ['t1', 't2']) {
      seedRiff(own, `r-${id}`, 'jam1', 128, [id])
      seedStem(own, id, 'jam1', { creatorUserName: 'tiny' })
      seedFeatures(own, id, featuresJSON({ zcrBrightness: 0.5 }))
    }
    seedRiff(own, 'r-t3', 'jam1', 128, ['t3'])
    seedStem(own, 't3', 'jam1', { creatorUserName: 'tiny' }) // not analysed
    await prewarmTraitQuantileTables(own)
    vi.mocked(countWork).mockClear()
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bright'],
      onlyOwnStems: true,
      targetUser: 'tiny',
      artistStemCIDs: new Set(['t1', 't2', 't3'])
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['t1', 't2'])
    const kinds = vi.mocked(countWork).mock.calls.map(([kind]) => kind)
    // The value table was consulted (and current) ...
    expect(kinds).toContain('sql:trait-value-table.count')
    // ... so the SQL fallback never ran.
    expect(kinds).not.toContain('sql:discover.artist-trait-page')
  })
})

// Background scan audit item 2b: the overnight classifier reads each stem's
// Instrument from the instrument rows prewarm already holds, instead of an
// IN query against the USB archive per batch.
describe('getInstrumentMaskLookup', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mask-lookup-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** A file-backed archive, seeded through a writer and opened read-only
   * the way riffLibraryStore.ts opens the external LORE archive. */
  function archive(): { path: string; ro: Database.Database } {
    const path = join(dir, 'archive.db')
    const writer = new Database(path)
    writer.exec(`
      CREATE TABLE Riffs (
        RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER, BPMrnd REAL,
        StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
        StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
      );
      CREATE TABLE Stems (
        StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
        FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL,
        Instrument INTEGER, Length16s REAL, PresetName TEXT, CreatorUserName TEXT
      );
    `)
    seedRiff(writer, 'r1', 'jam1', 120, ['s-drums', 's-mic', 's-none'])
    seedStem(writer, 's-drums', 'jam1', { instrument: 2 })
    seedStem(writer, 's-mic', 'jam1', { instrument: 16 })
    seedStem(writer, 's-none', 'jam1')
    writer.close()
    return { path, ro: new Database(path, { readonly: true }) }
  }

  it('is null until the rows are in memory', () => {
    const { ro } = archive()
    expect(getInstrumentMaskLookup(ro)).toBeNull()
  })

  it("answers from prewarm's rows: the mask, null for none, undefined for no such stem", async () => {
    const { ro } = archive()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: ro }], freshDb())
    const spy = vi.spyOn(ro, 'prepare')
    const lookup = getInstrumentMaskLookup(ro)
    expect(lookup).not.toBeNull()
    expect(lookup?.('s-drums')).toBe(2)
    expect(lookup?.('s-mic')).toBe(16)
    expect(lookup?.('s-none')).toBeNull()
    expect(lookup?.('elsewhere')).toBeUndefined()
    // Only the cheap change signal touched the archive, never a Stems row read.
    expect(spy.mock.calls.filter(([sql]) => /FROM Stems WHERE|COUNT\(\*\)/.test(sql))).toEqual([])
  })

  it('is null once the archive changed under the rows (SQL decides until they are rebuilt)', async () => {
    const { path, ro } = archive()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: ro }], freshDb())
    const writer = new Database(path)
    seedStem(writer, 's-new', 'jam1', { instrument: 4 })
    writer.close()
    expect(getInstrumentMaskLookup(ro)).toBeNull()
  })

  it("leaves sssketch's own writable db to SQL (an index lookup on the internal disk)", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['s1'])
    seedStem(own, 's1', 'jam1', { instrument: 2 })
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam1', dbForJam: own }], own)
    expect(getInstrumentMaskLookup(own)).toBeNull()
  })
})

// Scan plan b21ea5a2 Task 2 (audit 5A): the riff index walks Riffs by rowid
// (sequential on the USB archive: 15-70 ms per 2,000-row page cold, against
// 0.8-1.2 s for a RiffCID-ordered keyset page and multi-second deep OFFSET
// pages), keeps the smallest RiffCID per stem (the old RiffCID-order walk's
// first-seen rule, exactly), persists page by page, and extends from a rowid
// watermark instead of rebuilding when the count moves.
describe('riff index walk and extension (scan plan Task 2)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'riff-walk-'))
    vi.mocked(countWork).mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  const ARCHIVE_DDL = `
    CREATE TABLE Riffs (
      RiffCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER, BPMrnd REAL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT, PRIMARY KEY (RiffCID)
    );
    CREATE TABLE Stems (
      StemCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL, Instrument INTEGER,
      CreatorUserName TEXT, PRIMARY KEY (StemCID)
    );`

  function archivePath(name = 'archive.db'): string {
    const path = join(dir, name)
    const db = new Database(path)
    db.exec(ARCHIVE_DDL)
    db.close()
    return path
  }

  /** Deterministic ids that land all over RiffCID order. */
  function prng(seed: number): () => number {
    let x = seed
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x / 2147483648
    }
  }

  function seedRiffs(path: string, n: number, seed: number, prefix = 'r'): void {
    const db = new Database(path)
    const rand = prng(seed)
    const insert = db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, StemCID_1, StemCID_2, StemCID_3)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        const riffCID = `${Math.floor(rand() * 1e9)
          .toString(16)
          .padStart(8, '0')}-${prefix}${i}`
        // Stems shared across riffs: the smallest RiffCID must win.
        insert.run(
          riffCID,
          `jam${i % 7}`,
          i,
          100 + (i % 40),
          `${prefix}s${i}`,
          `shared${Math.floor(rand() * 500)}`,
          i % 3 === 0 ? null : `${prefix}t${i % 900}`
        )
      }
    })()
    db.close()
  }

  /** The index the old RiffCID-ordered walk built: first seen wins. */
  function oracle(
    path: string
  ): Map<
    string,
    { riffCID: string; ownerJamCID: string; bpmRnd: number; creationTime: number | null }
  > {
    const db = new Database(path, { readonly: true })
    const rows = db.prepare(`SELECT * FROM Riffs ORDER BY RiffCID`).all() as Record<
      string,
      string | number | null
    >[]
    const index = new Map()
    for (const r of rows) {
      for (let s = 1; s <= 8; s++) {
        const stem = r[`StemCID_${s}`] as string | null
        if (!stem || index.has(stem)) continue
        index.set(stem, {
          riffCID: r.RiffCID,
          ownerJamCID: r.OwnerJamCID,
          bpmRnd: r.BPMrnd,
          creationTime: r.CreationTime
        })
      }
    }
    db.close()
    return index
  }

  /** A fresh connection: a new launch, as far as the in-memory caches go. */
  function launch(path: string): Database.Database {
    return new Database(path, { readonly: true })
  }

  async function prewarm(src: Database.Database, own: Database.Database): Promise<void> {
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own)
  }

  function walkedRiffs(): number {
    return vi
      .mocked(countWork)
      .mock.calls.filter(([kind]) => kind === 'walk:riff-index.rows')
      .reduce((sum, [, n]) => sum + (n ?? 1), 0)
  }

  async function persisted(own: Database.Database, path: string): Promise<Map<string, unknown>> {
    const { loadCachedRiffIndex } = await import('./discoverIndexCache')
    return loadCachedRiffIndex(own, path)
  }

  it('walks without OFFSET, and the index equals the old RiffCID-ordered read', async () => {
    const path = archivePath()
    seedRiffs(path, 12_345, 1)
    const src = launch(path)
    const own = freshDb()
    const spy = vi.spyOn(src, 'prepare')
    await prewarm(src, own)
    expect(spy.mock.calls.some(([sql]) => /OFFSET/i.test(sql))).toBe(false)
    const expected = oracle(path)
    expect(await getRiffIndexForDb(src)).toEqual(expected)
    expect(await persisted(own, path)).toEqual(expected)
    expect(walkedRiffs()).toBe(12_345)
  })

  it('an in-session rebuild (no prewarm) gives the same index', async () => {
    const path = archivePath()
    seedRiffs(path, 3_000, 2)
    expect(await getRiffIndexForDb(launch(path))).toEqual(oracle(path))
  })

  it('extends: the next launch reads only the riffs past the watermark', async () => {
    const path = archivePath()
    seedRiffs(path, 5_000, 3)
    const own = freshDb()
    await prewarm(launch(path), own)
    seedRiffs(path, 30, 4, 'n') // new riffs, some sharing stems with older ones
    vi.mocked(countWork).mockClear()

    const src = launch(path)
    await prewarm(src, own)
    expect(walkedRiffs()).toBe(30)
    const expected = oracle(path)
    expect(await getRiffIndexForDb(src)).toEqual(expected)
    expect(await persisted(own, path)).toEqual(expected)
  })

  it('a new riff with an earlier RiffCID takes over a stem it shares', async () => {
    const path = archivePath()
    const w = new Database(path)
    w.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('m', 'j1', 120, 'x')`
    ).run()
    w.close()
    const own = freshDb()
    await prewarm(launch(path), own)
    const w2 = new Database(path)
    w2.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('a', 'j2', 90, 'x')`
    ).run()
    w2.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('z', 'j3', 80, 'x')`
    ).run()
    w2.close()
    const src = launch(path)
    await prewarm(src, own)
    expect((await getRiffIndexForDb(src)).get('x')?.riffCID).toBe('a')
    expect(((await persisted(own, path)).get('x') as { riffCID: string }).riffCID).toBe('a')
  })

  it('a skeleton riff filled in place between launches is picked up (open riffs)', async () => {
    const path = archivePath()
    seedRiffs(path, 100, 5)
    const w = new Database(path)
    w.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd) VALUES ('skel', 'j1', 120)`).run()
    w.close()
    const own = freshDb()
    await prewarm(launch(path), own)

    const w2 = new Database(path)
    w2.prepare(`UPDATE Riffs SET StemCID_1 = 'filled' WHERE RiffCID = 'skel'`).run()
    w2.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd) VALUES ('later', 'j1', 1)`).run()
    w2.close()
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect((await getRiffIndexForDb(src)).get('filled')?.riffCID).toBe('skel')
    expect(await getRiffIndexForDb(src)).toEqual(oracle(path))
    expect(walkedRiffs()).toBe(2) // the open riff, re-read, and the new one
  })

  it('a skeleton riff filled in place with nothing else changed between launches is picked up', async () => {
    const path = archivePath()
    const w = new Database(path)
    w.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('a', 'j', 1, 's1')`
    ).run()
    w.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd) VALUES ('skel', 'j', 1)`).run()
    w.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('z', 'j', 1, 's2')`
    ).run()
    w.close()
    const own = freshDb()
    await prewarm(launch(path), own)

    // The sync fills the skeleton in place: count, MAX(rowid) and the RiffCID
    // at it are all unchanged, so the saved index reads as current.
    const w2 = new Database(path)
    w2.prepare(`UPDATE Riffs SET StemCID_1 = 'filled' WHERE RiffCID = 'skel'`).run()
    w2.close()
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect((await getRiffIndexForDb(src)).get('filled')?.riffCID).toBe('skel')
    expect(walkedRiffs()).toBe(1) // only the open riff, re-read
    expect(((await persisted(own, path)).get('filled') as { riffCID: string }).riffCID).toBe('skel')
    // Closed once filled: the launch after that reads nothing.
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedRiffs()).toBe(0)
  })

  it('slots 9+ of a riff committed mid-walk are indexed (extras read with each page)', async () => {
    const { walkRiffs, emptyRiffIndexState } = await import('./riffIndexWalk')
    const path = archivePath()
    seedRiffs(path, 2_500, 17)
    const w = new Database(path)
    w.exec(RIFF_STEMS_EXTRA_DDL)
    const src = launch(path)
    const state = emptyRiffIndexState()
    let pages = 0
    await walkRiffs(src, state, {
      onPage: async () => {
        if (pages++ > 0) return
        // A twelve-stem riff lands after the walk started, past its first page.
        w.prepare(
          `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('mid', 'j', 1, 'm1')`
        ).run()
        w.prepare(
          `INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES ('mid', 9, 'm9')`
        ).run()
      }
    })
    w.close()
    expect(state.index.get('m1')?.riffCID).toBe('mid')
    expect(state.index.get('m9')?.riffCID).toBe('mid')
  })

  it('a delete rebuilds', async () => {
    const path = archivePath()
    seedRiffs(path, 500, 6)
    const own = freshDb()
    await prewarm(launch(path), own)
    const w = new Database(path)
    w.prepare(`DELETE FROM Riffs WHERE rowid = 10`).run()
    w.close()
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedRiffs()).toBe(499)
    expect(await getRiffIndexForDb(src)).toEqual(oracle(path))
    expect(await persisted(own, path)).toEqual(oracle(path))
  })

  it('a different RiffCID at the watermark rowid (a replaced file) rebuilds', async () => {
    const path = archivePath()
    seedRiffs(path, 300, 7)
    const own = freshDb()
    await prewarm(launch(path), own)
    rmSync(path)
    archivePath()
    seedRiffs(path, 320, 8, 'other')
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedRiffs()).toBe(320)
    expect(await persisted(own, path)).toEqual(oracle(path))
  })

  it('the max riff deleted and a new one reusing its rowid (same count) rebuilds', async () => {
    const path = archivePath()
    seedRiffs(path, 200, 16)
    const own = freshDb()
    await prewarm(launch(path), own)
    const w = new Database(path)
    w.prepare(`DELETE FROM Riffs WHERE rowid = (SELECT MAX(rowid) FROM Riffs)`).run()
    w.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('swap', 'j', 1, 'sw')`
    ).run()
    w.close()
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedRiffs()).toBe(200)
    expect(await getRiffIndexForDb(src)).toEqual(oracle(path))
  })

  it('a kept group appends rows and leaves the watermark alone; the next launch extends over it', async () => {
    const { appendRiffIndexRows, readRiffIndexMeta } = await import('./discoverIndexCache')
    const path = archivePath()
    seedRiffs(path, 200, 9)
    const own = freshDb()
    await prewarm(launch(path), own)
    const before = readRiffIndexMeta(own, path)
    const w = new Database(path)
    w.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('kept', 'discovered', 120, 'k1')`
    ).run()
    w.close()
    appendRiffIndexRows(
      own,
      path,
      [
        {
          stemCID: 'k1',
          riffCID: 'kept',
          ownerJamCID: 'discovered',
          bpmRnd: 120,
          creationTime: null
        }
      ],
      1
    )
    expect(readRiffIndexMeta(own, path)).toEqual(before)
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedRiffs()).toBe(1)
    expect(await persisted(own, path)).toEqual(oracle(path))
    const n = (
      own
        .prepare(`SELECT COUNT(*) AS n FROM DiscoverRiffIndexCache WHERE SourceDbKey = ?`)
        .get(path) as {
        n: number
      }
    ).n
    expect(n).toBe(oracle(path).size)
  })

  it('a legacy meta row (no watermark) loads while counts match, rebuilds once when they move, then extends', async () => {
    const path = archivePath()
    seedRiffs(path, 50, 10)
    const own = freshDb()
    saveRiffIndexCache(own, path, oracle(path), 50)
    vi.mocked(countWork).mockClear()
    const first = launch(path)
    await prewarm(first, own)
    expect(walkedRiffs()).toBe(0)
    expect(await getRiffIndexForDb(first)).toEqual(oracle(path))

    seedRiffs(path, 1, 11, 'a')
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedRiffs()).toBe(51) // once, in full

    seedRiffs(path, 1, 12, 'b')
    vi.mocked(countWork).mockClear()
    const third = launch(path)
    await prewarm(third, own)
    expect(walkedRiffs()).toBe(1)
    expect(await getRiffIndexForDb(third)).toEqual(oracle(path))
  })

  it('an interrupted rebuild resumes where it stopped on the next launch', async () => {
    const indexCache = await import('./discoverIndexCache')
    const path = archivePath()
    seedRiffs(path, 5_000, 13)
    const own = freshDb()
    const real = indexCache.persistRiffIndexPage
    const persist = vi
      .spyOn(indexCache, 'persistRiffIndexPage')
      .mockImplementationOnce(real)
      .mockRejectedValueOnce(new Error('quit mid-walk'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await prewarm(launch(path), own)
    persist.mockRestore()
    errors.mockRestore()

    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedRiffs()).toBe(5_000 - RIFF_WALK_PAGE_SIZE) // the first page was saved
    expect(await getRiffIndexForDb(src)).toEqual(oracle(path))
    expect(await persisted(own, path)).toEqual(oracle(path))
  })

  it('in session, a stale index extends in memory rather than rewalking', async () => {
    const path = archivePath()
    seedRiffs(path, 2_500, 14)
    const own = freshDb()
    const src = launch(path)
    await prewarm(src, own)
    seedRiffs(path, 12, 15, 'late')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    vi.mocked(countWork).mockClear()
    expect(await getRiffIndexForDb(src)).toEqual(oracle(path))
    expect(walkedRiffs()).toBe(12)
  })
})

// Scan plan b21ea5a2 Task 3 (audit 5A): the instrument rows come from one
// rowid-order Stems walk (stemsTableWalk.ts), persisted page by page with a
// rowid watermark, extended rather than rebuilt, and sorted by StemCID in
// slices for the mask lookup.
describe('instrument rows walk and extension (scan plan Task 3)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stems-walk-'))
    vi.mocked(countWork).mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  function archive(): string {
    const path = join(dir, 'archive.db')
    const db = new Database(path)
    db.exec(`
      CREATE TABLE Riffs (RiffCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
        BPMrnd REAL, StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT, StemCID_5 TEXT,
        StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT, PRIMARY KEY (RiffCID));
      CREATE TABLE Stems (StemCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL, Instrument INTEGER,
        CreatorUserName TEXT, PRIMARY KEY (StemCID));`)
    db.close()
    return path
  }

  function seedStems(path: string, n: number, seed: number, prefix = 's'): void {
    const db = new Database(path)
    let x = seed
    const insert = db.prepare(`INSERT INTO Stems VALUES (?, ?, ?, ?)`)
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) % 2147483648
        insert.run(
          `${x.toString(16).padStart(8, '0')}${prefix}${i}`,
          `jam${i % 4}`,
          i % 7 === 0 ? null : i % 40,
          `u${i % 9}`
        )
      }
    })()
    db.close()
  }

  function oracle(
    path: string
  ): Map<string, { StemCID: string; Instrument: number | null; OwnerJamCID: string }> {
    const db = new Database(path, { readonly: true })
    const rows = db.prepare(`SELECT StemCID, Instrument, OwnerJamCID FROM Stems`).all() as {
      StemCID: string
      Instrument: number | null
      OwnerJamCID: string
    }[]
    db.close()
    return new Map(rows.map((r) => [r.StemCID, r]))
  }

  const launch = (path: string): Database.Database => new Database(path, { readonly: true })

  async function prewarm(src: Database.Database, own: Database.Database): Promise<void> {
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own)
  }

  function walkedStems(): number {
    return vi
      .mocked(countWork)
      .mock.calls.filter(([kind]) => kind === 'walk:stems.rows')
      .reduce((sum, [, n]) => sum + (n ?? 1), 0)
  }

  /** The in-memory rows, seen through the mask lookup (the only reader that
   * cares about their order) plus a full read of them via the lookup. */
  function lookupMap(
    src: Database.Database,
    ids: Iterable<string>
  ): Map<string, number | null | undefined> {
    const lookup = getInstrumentMaskLookup(src)
    expect(lookup).not.toBeNull()
    return new Map([...ids].map((id) => [id, lookup!(id)]))
  }

  async function persistedRows(
    own: Database.Database,
    path: string
  ): Promise<Map<string, unknown>> {
    const { loadCachedInstrumentRows } = await import('./discoverIndexCache')
    const rows = await loadCachedInstrumentRows(own, path)
    return new Map(rows.map((r) => [r.StemCID, r]))
  }

  it('walks Stems without OFFSET; rows saved and in memory equal the table, in StemCID order', async () => {
    const path = archive()
    seedStems(path, 9_000, 1)
    const src = launch(path)
    const own = freshDb()
    const spy = vi.spyOn(src, 'prepare')
    await prewarm(src, own)
    const stemsSql = spy.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes('FROM Stems'))
    expect(stemsSql.some((sql) => /OFFSET/i.test(sql))).toBe(false)
    expect(walkedStems()).toBe(9_000)
    const expected = oracle(path)
    expect(await persistedRows(own, path)).toEqual(expected)
    const masks = lookupMap(src, expected.keys())
    for (const [id, row] of expected) expect(masks.get(id)).toBe(row.Instrument)
    // Sorted after the walk: the lookup's binary-searched prefix covers every row.
    const sortedIds = [...expected.keys()].sort()
    const lookup = getInstrumentMaskLookup(src)!
    expect(sortedIds.every((id) => lookup(id) !== undefined)).toBe(true)
  })

  it('extends: the next launch reads only the stems past the watermark, and answers the same masks', async () => {
    const path = archive()
    seedStems(path, 5_000, 2)
    const own = freshDb()
    const first = launch(path)
    await prewarm(first, own)
    const before = lookupMap(first, oracle(path).keys())
    seedStems(path, 40, 3, 'n')
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedStems()).toBe(40)
    const expected = oracle(path)
    expect(await persistedRows(own, path)).toEqual(expected)
    const after = lookupMap(src, expected.keys())
    for (const [id, mask] of before) expect(after.get(id)).toBe(mask)
    for (const [id, row] of expected) expect(after.get(id)).toBe(row.Instrument)
  })

  it('a kept group appends rows and leaves the watermark alone; the next launch extends with no duplicates', async () => {
    const { appendInstrumentRows, readInstrumentRowsMeta } = await import('./discoverIndexCache')
    const path = archive()
    seedStems(path, 300, 4)
    const own = freshDb()
    await prewarm(launch(path), own)
    const before = readInstrumentRowsMeta(own, path)
    const w = new Database(path)
    w.prepare(`INSERT INTO Stems VALUES ('kept', 'discovered', 4, 'me')`).run()
    w.close()
    appendInstrumentRows(
      own,
      path,
      [{ StemCID: 'kept', Instrument: 4, OwnerJamCID: 'discovered' }],
      1
    )
    expect(readInstrumentRowsMeta(own, path)).toEqual(before)
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedStems()).toBe(1)
    expect(await persistedRows(own, path)).toEqual(oracle(path))
    const n = (
      own
        .prepare(`SELECT COUNT(*) AS n FROM DiscoverInstrumentRowsCache WHERE SourceDbKey = ?`)
        .get(path) as {
        n: number
      }
    ).n
    expect(n).toBe(301)
  })

  function duplicateStemCIDs(src: Database.Database): string[] {
    const rows = instrumentRowsInMemoryForTests(src)
    expect(rows).not.toBeNull()
    const seen = new Set<string>()
    const dups: string[] = []
    for (const row of rows!) {
      if (seen.has(row.StemCID)) dups.push(row.StemCID)
      seen.add(row.StemCID)
    }
    return dups
  }

  it('a kept stem saved past the watermark is not duplicated in memory by the next launch', async () => {
    const { appendInstrumentRows } = await import('./discoverIndexCache')
    const path = archive()
    seedStems(path, 50, 12)
    const own = freshDb()
    await prewarm(launch(path), own)
    const w = new Database(path)
    w.prepare(`INSERT INTO Stems VALUES ('kept', 'discovered', 1, 'me')`).run()
    w.close()
    appendInstrumentRows(
      own,
      path,
      [{ StemCID: 'kept', Instrument: 1, OwnerJamCID: 'discovered' }],
      1
    )
    const src = launch(path)
    await prewarm(src, own)
    expect(duplicateStemCIDs(src)).toEqual([])
    expect(instrumentRowsInMemoryForTests(src)!.length).toBe(51)
    expect(getInstrumentMaskLookup(src)!('kept')).toBe(1)
  })

  it('in session, a kept stem folded in memory is not duplicated by the next extension', async () => {
    const path = archive()
    seedStems(path, 50, 13)
    const own = freshDb()
    const src = launch(path)
    await prewarm(src, own)
    const w = new Database(path)
    w.prepare(`INSERT INTO Stems VALUES ('kept', 'discovered', 1, 'me')`).run()
    appendToInMemoryDiscoverCaches(
      src,
      [],
      [{ StemCID: 'kept', Instrument: 1, OwnerJamCID: 'discovered' }]
    )
    w.prepare(`INSERT INTO Stems VALUES ('synced', 'jam1', 2, 'u')`).run() // a sync, later
    w.close()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    vi.mocked(countWork).mockClear()
    await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: src }],
      kinds: ['drums']
    })
    expect(walkedStems()).toBe(2) // the extension read both
    expect(duplicateStemCIDs(src)).toEqual([])
    expect(instrumentRowsInMemoryForTests(src)!.length).toBe(52)
  })

  it('a delete, or a different StemCID at the watermark, rebuilds', async () => {
    const path = archive()
    seedStems(path, 400, 5)
    const own = freshDb()
    await prewarm(launch(path), own)
    const w = new Database(path)
    w.prepare(`DELETE FROM Stems WHERE rowid = 3`).run()
    w.close()
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedStems()).toBe(399)
    expect(await persistedRows(own, path)).toEqual(oracle(path))

    const w2 = new Database(path)
    w2.prepare(`DELETE FROM Stems WHERE rowid = (SELECT MAX(rowid) FROM Stems)`).run()
    w2.prepare(`INSERT INTO Stems VALUES ('replacement', 'jam1', 2, 'u')`).run() // reuses the max rowid
    w2.close()
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedStems()).toBe(399)
    expect(await persistedRows(own, path)).toEqual(oracle(path))
    expect(getInstrumentMaskLookup(src)!('replacement')).toBe(2)
  })

  it('a legacy saved copy (no watermark) loads while its count matches, then rebuilds once, then extends', async () => {
    const path = archive()
    seedStems(path, 60, 6)
    const own = freshDb()
    saveInstrumentRowsCache(own, path, [...oracle(path).values()], 60)
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedStems()).toBe(0)
    seedStems(path, 1, 7, 'a')
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedStems()).toBe(61)
    seedStems(path, 1, 8, 'b')
    vi.mocked(countWork).mockClear()
    await prewarm(launch(path), own)
    expect(walkedStems()).toBe(1)
    expect(await persistedRows(own, path)).toEqual(oracle(path))
  })

  it('an interrupted rebuild resumes from its last saved page', async () => {
    const indexCache = await import('./discoverIndexCache')
    const path = archive()
    seedStems(path, 5_000, 9)
    const own = freshDb()
    const real = indexCache.persistInstrumentRowsPage
    const persist = vi
      .spyOn(indexCache, 'persistInstrumentRowsPage')
      .mockImplementationOnce(real)
      .mockRejectedValueOnce(new Error('quit mid-walk'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await prewarm(launch(path), own)
    persist.mockRestore()
    vi.mocked(countWork).mockClear()
    const src = launch(path)
    await prewarm(src, own)
    expect(walkedStems()).toBe(5_000 - STEMS_WALK_PAGE_SIZE) // the first page was saved
    expect(await persistedRows(own, path)).toEqual(oracle(path))
    const lookup = getInstrumentMaskLookup(src)!
    for (const [id, row] of oracle(path)) expect(lookup(id)).toBe(row.Instrument)
  })

  it('in session, a stale copy extends in memory into a new array', async () => {
    const path = archive()
    seedStems(path, 2_500, 10)
    const own = freshDb()
    const src = launch(path)
    await prewarm(src, own)
    seedStems(path, 15, 11, 'late')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    vi.mocked(countWork).mockClear()
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: src }],
      kinds: ['drums']
    })
    void candidates
    expect(walkedStems()).toBe(15)
    const lookup = getInstrumentMaskLookup(src)!
    for (const [id, row] of oracle(path)) expect(lookup(id)).toBe(row.Instrument)
  })
})

// Scan plan b21ea5a2 Task 10 (audit 9): the kind index keeps a base layer
// (confirmed + tag, plus the residue rows the mask can't place) and rebuilds
// only its small guess layer when StemAutoCategory moves -- at most once per
// GUESS_LAYER_MIN_MS (10 s). Confirmations rebuild both at once.
describe('kind index layers (scan plan Task 10)', () => {
  const T0 = 2_000_000_000
  let now = T0
  beforeEach(() => {
    now = T0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.mocked(countWork).mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const count = (kind: string): number =>
    vi.mocked(countWork).mock.calls.filter(([k]) => k === kind).length

  function library(): Database.Database {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 120, ['d1', 'mic1', 'mic2', 'b1', 'c1'])
    seedStem(own, 'd1', 'jam1', { instrument: 1 << 1 })
    seedStem(own, 'mic1', 'jam1', { instrument: 1 << 4 })
    seedStem(own, 'mic2', 'jam1', { instrument: 1 << 4 })
    seedStem(own, 'b1', 'jam1', { instrument: 1 << 3 })
    seedStem(own, 'c1', 'jam1', { instrument: 1 << 4 })
    seedCategory(own, 'c1', { arrangeRole: 'lead' })
    return own
  }
  const jamsOf = (db: Database.Database): { jamCID: string; dbForJam: Database.Database }[] => [
    { jamCID: 'jam1', dbForJam: db }
  ]

  async function pool(
    own: Database.Database,
    kind: 'drums' | 'bass' | 'lead'
  ): Promise<Map<string, string | undefined>> {
    const got = await getDiscoverCandidates({ ownDb: own, jams: jamsOf(own), kinds: [kind] })
    return new Map(got.map((c) => [c.stemCID, c.kindSources[kind]]))
  }

  /** The same library, indexed from scratch (a fresh connection). */
  async function fromScratch(
    own: Database.Database,
    kind: 'drums' | 'bass' | 'lead'
  ): Promise<Map<string, string | undefined>> {
    return pool(new Database(own.serialize()), kind)
  }

  it('an auto write does not re-run the base pass; the guess shows once 10 s have passed', async () => {
    const own = library()
    expect(await pool(own, 'drums')).toEqual(new Map([['d1', 'tag']]))
    expect(count('scan:discover.kind-index-rows')).toBe(1)

    upsertStemAutoCategory(own, 'mic1', 'drums', 'embedding', 5)
    now += 1_000
    expect(await pool(own, 'drums')).toEqual(new Map([['d1', 'tag']])) // up to 10 s stale
    now += 9_500
    expect(await pool(own, 'drums')).toEqual(
      new Map([
        ['d1', 'tag'],
        ['mic1', 'guess']
      ])
    )
    expect(count('scan:discover.kind-index-rows')).toBe(1) // the base pass never re-ran
    expect(count('kind-index:guess-rebuild')).toBe(1)
  })

  it('a confirmation rebuilds both layers at once', async () => {
    const own = library()
    upsertStemAutoCategory(own, 'mic1', 'drums', 'embedding', 5)
    expect(await pool(own, 'drums')).toEqual(
      new Map([
        ['d1', 'tag'],
        ['mic1', 'guess']
      ])
    )
    upsertStemAutoCategory(own, 'mic2', 'drums', 'embedding', 6)
    upsertStemCategoryRole(own, [{ path: 'mic1', arrangeRole: 'bass' }], 'discover', null, 7)
    expect(await pool(own, 'drums')).toEqual(
      new Map([
        ['d1', 'tag'],
        ['mic2', 'guess']
      ])
    )
    expect(await pool(own, 'bass')).toEqual(
      new Map([
        ['b1', 'tag'],
        ['mic1', 'confirmed']
      ])
    )
    expect(count('scan:discover.kind-index-rows')).toBe(2)
  })

  it('after any mix of writes, once settled, the pools equal a from-scratch build', async () => {
    const own = library()
    const kinds = ['drums', 'bass', 'lead'] as const
    for (const kind of kinds) await pool(own, kind)
    const writes: (() => void)[] = [
      () => upsertStemAutoCategory(own, 'mic1', 'lead', 'embedding', 10),
      () => upsertStemAutoCategory(own, 'mic2', 'bass', 'yamnet-zeroshot', 11),
      () => upsertStemAutoCategory(own, 'c1', 'drums', 'embedding', 12), // confirmed wins
      () => upsertStemAutoCategory(own, 'd1', 'bass', 'embedding', 13), // the tag wins
      () =>
        upsertStemCategoryRole(own, [{ path: 'mic2', arrangeRole: 'drums' }], 'discover', null, 14),
      () => upsertStemAutoCategory(own, 'mic1', 'drums', 'centroid', 15)
    ]
    for (const write of writes) {
      write()
      now += 3_000
      for (const kind of kinds) await pool(own, kind)
    }
    now += 10_001
    for (const kind of kinds) expect(await pool(own, kind)).toEqual(await fromScratch(own, kind))
  })
})

describe('faster startup: usable before complete (2026-10-06)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'faster-startup-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  // Riff index rows past RIFF_WALK_PAGE_SIZE, so the walk takes many pages.
  const N = 4_500

  function archive(): string {
    const path = join(dir, 'archive.db')
    const db = new Database(path)
    db.exec(`
      CREATE TABLE Riffs (RiffCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
        BPMrnd REAL, UserName TEXT, StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
        StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT, PRIMARY KEY (RiffCID));
      CREATE TABLE Stems (StemCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL, Instrument INTEGER,
        PresetName TEXT, CreatorUserName TEXT, PRIMARY KEY (StemCID));
      CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);
      CREATE INDEX Riff_IndexUser ON Riffs (UserName);`)
    db.close()
    add(path, 0, N)
    return path
  }

  /** Riffs i in [from, to), each holding its own stem; every 10th is elling's
   * (Instrument 2 = drums), the rest belong to 'other'. */
  function add(path: string, from: number, to: number): void {
    const db = new Database(path)
    const riff = db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, UserName, StemCID_1)
       VALUES (?, 'jam0', ?, 120, ?, ?)`
    )
    const stem = db.prepare(`INSERT INTO Stems VALUES (?, 'jam0', 2, 'p', ?)`)
    db.transaction(() => {
      for (let i = from; i < to; i++) {
        const user = i % 10 === 0 ? 'elling' : 'other'
        const cid = `${(i * 7919).toString(16).padStart(6, '0')}x${i}`
        riff.run(`r${cid}`, i, user, `s${cid}`)
        stem.run(`s${cid}`, user)
      }
    })()
    db.close()
  }

  const stemOf = (i: number): string => `s${(i * 7919).toString(16).padStart(6, '0')}x${i}`
  const launch = (path: string): Database.Database => new Database(path, { readonly: true })

  it('extend: the gate opens on the loaded copy, rolls are served from it while the walk runs, and see the new stems after', async () => {
    const path = archive()
    const own = freshDb()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: launch(path) }], own)
    add(path, N, N + 3_000)

    const src = launch(path)
    let complete = false
    let atUsable: { hasOld: boolean; hasNew: boolean; complete: boolean } | null = null
    let rollAtUsable: Promise<string[]> | null = null
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own, undefined, {
      ownUsername: () => 'elling',
      onUsable: () => {
        void getRiffIndexForDb(src).then((index) => {
          atUsable = { hasOld: index.has(stemOf(5)), hasNew: index.has(stemOf(N + 5)), complete }
        })
        rollAtUsable = getDiscoverCandidates({
          ownDb: own,
          jams: [{ jamCID: 'jam0', dbForJam: src }],
          kinds: ['drums']
        }).then((pool) => pool.map((c) => c.stemCID))
      }
    })
    complete = true
    expect(atUsable).toEqual({ hasOld: true, hasNew: false, complete: false })
    // Drawn from the loaded rows: had it waited for the walk, a 1,000-stem
    // sample of 7,500 would hold some of the 3,000 new ones.
    const rolled = await rollAtUsable!
    expect(rolled.length).toBe(1000)
    expect(rolled.every((cid) => Number(cid.split('x')[1]) < N)).toBe(true)
    const after = await getRiffIndexForDb(src)
    expect(after.has(stemOf(N + 5))).toBe(true)
    expect(after.size).toBe(N + 3_000)
  })

  it('rebuild: "only my stems" rolls from the own index before the walk ends; everything else waits for it', async () => {
    const path = archive()
    const own = freshDb()
    const src = launch(path)
    let complete = false
    let ownAtUsable: Promise<{ size: number; complete: boolean }> | null = null
    let allAtUsable: Promise<{ size: number; complete: boolean }> | null = null
    let mineRoll: Promise<string[]> | null = null
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own, undefined, {
      ownUsername: () => 'elling',
      onUsable: () => {
        ownAtUsable = getRiffIndexForDb(src, { ownStemsOf: 'elling' }).then((i) => ({
          size: i.size,
          complete
        }))
        allAtUsable = getRiffIndexForDb(src).then((i) => ({ size: i.size, complete }))
        mineRoll = getDiscoverCandidates({
          ownDb: own,
          jams: [{ jamCID: 'jam0', dbForJam: src }],
          kinds: ['drums'],
          onlyOwnStems: true,
          targetUser: 'elling',
          ownStemsOf: 'elling'
        }).then((pool) => {
          expect(complete).toBe(false)
          return pool.map((c) => c.creatorUserName)
        })
      }
    })
    complete = true
    expect(await ownAtUsable!).toEqual({ size: N / 10, complete: false })
    const mine = await mineRoll!
    expect(mine.length).toBe(N / 10)
    expect(new Set(mine)).toEqual(new Set(['elling']))
    // The all-stems read waited for the full walk.
    expect((await allAtUsable!).size).toBe(N)
    // Another user's "own" never gets elling's index.
    expect((await getRiffIndexForDb(src, { ownStemsOf: 'other' })).size).toBe(N)
  })

  it('a saved copy below whose watermark a row was deleted is rebuilt, and never served', async () => {
    const path = archive()
    const own = freshDb()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: launch(path) }], own)
    const w = new Database(path)
    w.prepare(`DELETE FROM Riffs WHERE StemCID_1 = ?`).run(stemOf(7))
    w.prepare(`DELETE FROM Stems WHERE StemCID = ?`).run(stemOf(7))
    w.close()
    add(path, N, N + 1)

    const src = launch(path)
    let sawDeleted: Promise<boolean> | null = null
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own, undefined, {
      ownUsername: () => 'elling',
      onUsable: () => {
        sawDeleted = getRiffIndexForDb(src).then((i) => i.has(stemOf(7)))
      }
    })
    expect(await sawDeleted!).toBe(false)
  })

  it('a point lookup that asks for the complete index waits for the walk', async () => {
    const path = archive()
    const own = freshDb()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: launch(path) }], own)
    add(path, N, N + 3_000)
    const src = launch(path)
    let complete: Promise<boolean> | null = null
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own, undefined, {
      onUsable: () => {
        complete = getRiffIndexForDb(src, { complete: true }).then((i) => i.has(stemOf(N + 5)))
      }
    })
    expect(await complete!).toBe(true)
  })

  it('no username: a rebuild serves nothing early, and usable still comes before complete', async () => {
    const path = archive()
    const own = freshDb()
    const src = launch(path)
    const order: string[] = []
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: src }], own, undefined, {
      ownUsername: () => null,
      onUsable: () => order.push('usable')
    })
    order.push('complete')
    expect(order).toEqual(['usable', 'complete'])
    expect((await getRiffIndexForDb(src, { ownStemsOf: 'elling' })).size).toBe(N)
  })
})
