// src/main/discoverCandidates.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getDiscoverCandidates,
  getRandomLibraryCandidate,
  prewarmDiscoverCandidateCaches,
  getRiffIndexForDb
} from './discoverCandidates'
import { saveRiffIndexCache, saveInstrumentRowsCache } from './discoverIndexCache'

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
  `)
  return db
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
    const riffsQueries = prepareSpy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))
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
    const riffsQueries = prepareSpy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))
    expect(riffsQueries.length).toBe(2)
    // Neither query has a WHERE clause -- a plain sequential
    // COUNT/LIMIT-OFFSET scan, not a per-row-predicate evaluation.
    expect(riffsQueries[0][0]).not.toMatch(/WHERE/)
    expect(riffsQueries[1][0]).not.toMatch(/WHERE/)
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
    const riffsQueries = prepareSpy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))
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
    expect(stemsInstrumentQueries[0][0]).not.toMatch(/WHERE/)
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

    // 3, not 2 -- prewarmDiscoverCandidateCaches now runs its own cheap
    // `SELECT COUNT(*) FROM Riffs` cache-freshness check (tryCountRows)
    // BEFORE buildRiffIndex's own COUNT(*) + one LIMIT/OFFSET page (see
    // the "single query per chunk" test above for why THAT part is 2, not
    // 1) -- own is passed as both the source db AND the cache-storage
    // ownDb here, a realistic case (no external archive configured), and
    // there's no pre-existing cache yet, so this always takes the live-
    // scan path.
    const riffsQueries = prepareSpy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))
    expect(riffsQueries.length).toBe(3)
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
    const riffsQueries = prepareSpy.mock.calls.filter(([sql]) => sql.includes('FROM Riffs'))
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
})
