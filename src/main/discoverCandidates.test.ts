// src/main/discoverCandidates.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { getDiscoverCandidates, getRandomLibraryCandidate } from './discoverCandidates'

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
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
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
  `)
  return db
}

/** Writes directly to StemAutoCategory -- the background classify scan's
 * (stemAutoClassify.ts) own precomputed-results table -- rather than
 * seeding embeddings/features and letting a live classifier run. The
 * classification logic itself (embedding vs. centroid, confidence
 * thresholds) is stemAutoClassify's own concern and is tested there;
 * this file only needs to prove getDiscoverCandidates reads this table's
 * rows correctly. */
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
      arrangeRole: 'drums'
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
        arrangeRole: 'drums'
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
      arrangeRole: 'drums'
    })
    expect(c).toMatchObject({
      stemCID: 's1',
      riffCID: 'r1',
      jamCID: 'jam1',
      riffBpm: 140,
      presetName: '808 kick',
      creatorUserName: 'elling',
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums',
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
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['s1', 's2'])
  })

  // Widening (2026-09-15, direct request): a role with a too-small
  // confirmed pool should still surface stems the background classify scan
  // (stemAutoClassify.ts) has already precomputed. The scan's own
  // embedding-vs-centroid classification logic is tested in
  // stemAutoClassify.test.ts; this file only needs to prove
  // getDiscoverCandidates reads StemAutoCategory's rows correctly, so
  // these tests write directly to that table via seedAutoCategory.
  it('includes an UNCONFIRMED stem precomputed as the requested role via StemAutoCategory (background scan)', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { presetName: 'maybe a kick' })
    // No StemCategories row at all -- this stem was never human-confirmed,
    // only auto-classified by the background scan.
    seedAutoCategory(own, 's1', 'drums')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
    expect(candidates[0]).toMatchObject({
      arrangeRole: 'drums',
      drumSubRole: null,
      presetName: 'maybe a kick'
    })
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
    expect(candidates[0]).toMatchObject({ arrangeRole: 'drums', drumSubRole: null })
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
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
    })
    expect(candidates).toEqual([])
  })

  it('combines all three sources (confirmed, StemAutoCategory-precomputed, instrument-matched) in one pool', async () => {
    const own = freshDb()
    // Confirmed 'drums'.
    seedRiff(own, 'rd1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1')
    seedCategory(own, 'd1', { arrangeRole: 'drums', busId: 'drums' })
    // Precomputed via the background scan: unconfirmed, in StemAutoCategory.
    seedRiff(own, 'rg', 'jam1', 128, ['guessed-1'])
    seedStem(own, 'guessed-1', 'jam1')
    seedAutoCategory(own, 'guessed-1', 'drums')
    // Instrument-matched: unconfirmed, no auto-category at all, just the bit.
    seedRiff(own, 'ri', 'jam1', 128, ['instrument-1'])
    seedStem(own, 'instrument-1', 'jam1', { instrument: 2 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
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
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual([...stemCIDs].sort())
  })

  // Speed fix, real user report: rolling took ~2 minutes with no
  // improvement, because getInstrumentMatchedStemCIDs (unlike the
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
      arrangeRole: 'drums'
    })
    expect(first.map((c) => c.stemCID)).toEqual(['d1'])

    // A new instrument-matched stem lands after the first call.
    seedRiff(own, 'r2', 'jam1', 128, ['d2'])
    seedStem(own, 'd2', 'jam1', { instrument: 2 })

    const second = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    // Still the cached (stale) result.
    expect(second.map((c) => c.stemCID)).toEqual(['d1'])
  })

  // Real perf bug, found live (root cause of a "stuck rolling" report that
  // survived the TTL cache above -- the cache only helps a SECOND call
  // within 60s, not the cold first one): listJamsWithDb() (main/
  // riffLibraryStore.ts) pairs every non-"shared:" jam with the SAME
  // shared archive db connection, not a separate db per jam -- so without
  // a WHERE OwnerJamCID filter, the instrument-matched Stems query
  // re-scanned the library's ENTIRE Stems table once per jam in the loop
  // (O(jamCount x totalStemCount) instead of O(totalStemCount)). This test
  // seeds two jams SHARING one db (the real-world shape) and asserts the
  // query is actually scoped per jam.
  it('scopes the instrument-matched Stems query to each jam via WHERE OwnerJamCID, not a full-table scan repeated per jam', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d1'])
    seedStem(own, 'd1', 'jam1', { instrument: 2 }) // bit 1: drum
    seedRiff(own, 'r2', 'jam2', 128, ['d2'])
    seedStem(own, 'd2', 'jam2', { instrument: 2 })

    const prepareSpy = vi.spyOn(own, 'prepare')

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own }
      ],
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2'])

    const stemsInstrumentQueries = prepareSpy.mock.calls.filter(
      ([sql]) => sql.includes('FROM Stems') && sql.includes('Instrument')
    )
    expect(stemsInstrumentQueries.length).toBeGreaterThan(0)
    for (const [sql] of stemsInstrumentQueries) {
      expect(sql).toMatch(/WHERE\s+OwnerJamCID\s*=\s*\?/)
    }
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
      arrangeRole: 'drums'
    })
    expect(candidate).toMatchObject({
      stemCID: 's1',
      riffCID: 'r1',
      jamCID: 'jam1',
      riffBpm: 140,
      presetName: 'anything',
      creatorUserName: 'elling',
      arrangeRole: 'drums',
      drumSubRole: null
    })
  })

  it('returns null when no jam has any stem at all', async () => {
    const own = freshDb()
    const candidate = await getRandomLibraryCandidate({
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    expect(candidate).toBeNull()
  })

  it('filters by ownership when onlyOwnStems is true', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1', { creatorUserName: 'someone-else' })

    const candidate = await getRandomLibraryCandidate({
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums',
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
      arrangeRole: 'bass',
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
      arrangeRole: 'drums'
    })
    expect(candidate?.stemCID).toBe('s1')
  })
})
