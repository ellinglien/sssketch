// src/main/discoverCandidates.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { getDiscoverCandidates, getRandomLibraryCandidate } from './discoverCandidates'
import * as categoryCentroidStore from './categoryCentroidStore'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from '@shared/categoryCentroids'
import type { StemFeatures } from '@shared/stemFeatures'

// getCentroidGuessedStemCIDs's own dedicated test below spies on
// loadCategoryCentroidStore to supply a real trained store (the real one
// reads app.getPath('userData'), mocked to empty above) -- restored after
// every test so the spy never leaks into a LATER test that expects the
// real "nothing trained yet" behavior.
afterEach(() => {
  vi.restoreAllMocks()
})

// getCentroidGuessedStemCIDs (via loadCategoryCentroidStore) reads
// app.getPath('userData') on every call -- mock just that narrow surface,
// same established convention as discoverLibraryStems.test.ts (this
// codebase avoids mocking the `electron` module wholesale, see CLAUDE.md's
// Testing conventions section). Pointed at a path that won't exist, so
// loadCategoryCentroidStore falls back to its own documented "empty store"
// behavior rather than reading a real file from a real user's machine.
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/discoverCandidates-test-userdata'
  }
}))

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
  `)
  return db
}

function seedEmbedding(db: Database.Database, stemCID: string, embedding: number[]): void {
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, JSON.stringify(embedding))
}

function seedFeatures(
  db: Database.Database,
  stemCID: string,
  overrides: Partial<StemFeatures> = {}
): void {
  const features: StemFeatures = {
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 0,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, JSON.stringify(features))
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
  // confirmed pool should still surface stems the embedding classifier is
  // confident about, even without human confirmation.
  it('includes an UNCONFIRMED stem whose own embedding confidently classifies as the requested role', async () => {
    const own = freshDb()
    // Real training data: 3 confirmed 'drums' embeddings clustered near
    // (1,0,0), 3 confirmed 'bass' near (0,1,0) -- the minimum
    // suggestCategoryFromEmbedding needs per category (MIN_SAMPLES_PER_CATEGORY=3)
    // with 2 categories trained (MIN_CATEGORIES_FOR_SUGGESTION=2).
    seedRiff(own, 'rd1', 'jam1', 128, ['d1'])
    seedRiff(own, 'rd2', 'jam1', 128, ['d2'])
    seedRiff(own, 'rd3', 'jam1', 128, ['d3'])
    seedRiff(own, 'rb1', 'jam1', 128, ['b1'])
    seedRiff(own, 'rb2', 'jam1', 128, ['b2'])
    seedRiff(own, 'rb3', 'jam1', 128, ['b3'])
    for (const cid of ['d1', 'd2', 'd3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'drums', busId: 'drums' })
      seedEmbedding(own, cid, [1, 0, 0])
    }
    for (const cid of ['b1', 'b2', 'b3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'bass', busId: 'bass' })
      seedEmbedding(own, cid, [0, 1, 0])
    }
    // The real subject: an UNCONFIRMED stem (no StemCategories row at all)
    // whose own embedding sits right next to the confirmed 'drums' cluster.
    seedRiff(own, 'rg', 'jam1', 128, ['guessed-1'])
    seedStem(own, 'guessed-1', 'jam1', { presetName: 'maybe a kick' })
    seedEmbedding(own, 'guessed-1', [0.9, 0.1, 0])

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })

    const stemCIDs = candidates.map((c) => c.stemCID).sort()
    expect(stemCIDs).toEqual(['d1', 'd2', 'd3', 'guessed-1'])
    const guessed = candidates.find((c) => c.stemCID === 'guessed-1')
    expect(guessed).toMatchObject({
      arrangeRole: 'drums',
      drumSubRole: null,
      presetName: 'maybe a kick'
    })
  })

  it('never adds a guessed stem that is ALSO confirmed for a different role (confirmed always wins)', async () => {
    const own = freshDb()
    // Same training setup as above, but the "guessed-1" stem here is
    // actually confirmed as 'bass' despite embedding near the drums
    // cluster -- getEmbeddingGuessedStemCIDs excludes anything already in
    // categoryByStemCID (built from StemCategories first), so a real human
    // confirmation is never second-guessed by the classifier.
    seedRiff(own, 'rd1', 'jam1', 128, ['d1'])
    seedRiff(own, 'rd2', 'jam1', 128, ['d2'])
    seedRiff(own, 'rd3', 'jam1', 128, ['d3'])
    seedRiff(own, 'rb1', 'jam1', 128, ['b1'])
    seedRiff(own, 'rb2', 'jam1', 128, ['b2'])
    seedRiff(own, 'rb3', 'jam1', 128, ['b3'])
    for (const cid of ['d1', 'd2', 'd3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'drums', busId: 'drums' })
      seedEmbedding(own, cid, [1, 0, 0])
    }
    for (const cid of ['b1', 'b2', 'b3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'bass', busId: 'bass' })
      seedEmbedding(own, cid, [0, 1, 0])
    }
    seedRiff(own, 'rconfirmed', 'jam1', 128, ['confirmed-bass'])
    seedStem(own, 'confirmed-bass', 'jam1')
    seedCategory(own, 'confirmed-bass', { arrangeRole: 'bass', busId: 'bass' })
    seedEmbedding(own, 'confirmed-bass', [0.9, 0.1, 0]) // embeds near drums, but confirmed bass

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })

    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('does not throw and returns only confirmed candidates when nothing is trained on the embedding axis yet', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    // A cached embedding exists for some OTHER, unconfirmed stem, but
    // fewer than 2 categories are trained (drums has samples, nothing else
    // does) -- suggestCategoryFromEmbedding always returns null here, so
    // this stem is never guessed.
    seedRiff(own, 'r2', 'jam1', 128, ['s2'])
    seedStem(own, 's2', 'jam1')
    seedEmbedding(own, 's1', [1, 0, 0])
    seedEmbedding(own, 's2', [1, 0, 0])

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  // Speed fix (2026-09-15, real user report): a full StemEmbeddingCache
  // classify pass took ~20 real seconds against a real library. Cached per
  // (db instance, role) for GUESSED_CACHE_TTL_MS so repeated rolls within
  // that window don't re-pay it.
  it('reuses the embedding-guessed pool on a second call for the same db+role within the TTL, even if new data would otherwise change the result', async () => {
    const own = freshDb()
    seedRiff(own, 'rd1', 'jam1', 128, ['d1'])
    seedRiff(own, 'rd2', 'jam1', 128, ['d2'])
    seedRiff(own, 'rd3', 'jam1', 128, ['d3'])
    seedRiff(own, 'rb1', 'jam1', 128, ['b1'])
    seedRiff(own, 'rb2', 'jam1', 128, ['b2'])
    seedRiff(own, 'rb3', 'jam1', 128, ['b3'])
    for (const cid of ['d1', 'd2', 'd3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'drums', busId: 'drums' })
      seedEmbedding(own, cid, [1, 0, 0])
    }
    for (const cid of ['b1', 'b2', 'b3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'bass', busId: 'bass' })
      seedEmbedding(own, cid, [0, 1, 0])
    }

    const first = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    expect(first.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2', 'd3'])

    // A new stem that WOULD classify as 'drums' lands after the first call.
    seedRiff(own, 'rg', 'jam1', 128, ['guessed-late'])
    seedStem(own, 'guessed-late', 'jam1')
    seedEmbedding(own, 'guessed-late', [0.9, 0.1, 0])

    const second = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    // Still the cached (stale) result -- the newly-added stem does not
    // appear because it landed within the TTL window.
    expect(second.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('does not share the embedding-guessed cache across DIFFERENT db instances', async () => {
    const dbA = freshDb()
    const dbB = freshDb()
    for (const db of [dbA, dbB]) {
      seedRiff(db, 'rd1', 'jam1', 128, ['d1'])
      seedRiff(db, 'rd2', 'jam1', 128, ['d2'])
      seedRiff(db, 'rd3', 'jam1', 128, ['d3'])
      seedRiff(db, 'rb1', 'jam1', 128, ['b1'])
      seedRiff(db, 'rb2', 'jam1', 128, ['b2'])
      seedRiff(db, 'rb3', 'jam1', 128, ['b3'])
      for (const cid of ['d1', 'd2', 'd3']) {
        seedStem(db, cid, 'jam1')
        seedCategory(db, cid, { arrangeRole: 'drums', busId: 'drums' })
        seedEmbedding(db, cid, [1, 0, 0])
      }
      for (const cid of ['b1', 'b2', 'b3']) {
        seedStem(db, cid, 'jam1')
        seedCategory(db, cid, { arrangeRole: 'bass', busId: 'bass' })
        seedEmbedding(db, cid, [0, 1, 0])
      }
    }
    // Only dbB gets the extra guessed stem.
    seedRiff(dbB, 'rg', 'jam1', 128, ['guessed-only-in-b'])
    seedStem(dbB, 'guessed-only-in-b', 'jam1')
    seedEmbedding(dbB, 'guessed-only-in-b', [0.9, 0.1, 0])

    const fromA = await getDiscoverCandidates({
      ownDb: dbA,
      jams: [{ jamCID: 'jam1', dbForJam: dbA }],
      arrangeRole: 'drums'
    })
    const fromB = await getDiscoverCandidates({
      ownDb: dbB,
      jams: [{ jamCID: 'jam1', dbForJam: dbB }],
      arrangeRole: 'drums'
    })
    expect(fromA.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2', 'd3'])
    expect(fromB.map((c) => c.stemCID).sort()).toEqual(['d1', 'd2', 'd3', 'guessed-only-in-b'])
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

  it('combines all three sources (confirmed, embedding-guessed, instrument-matched) in one pool', async () => {
    const own = freshDb()
    // Confirmed 'drums', with a real embedding (also doubles as classifier
    // training data).
    seedRiff(own, 'rd1', 'jam1', 128, ['d1'])
    seedRiff(own, 'rd2', 'jam1', 128, ['d2'])
    seedRiff(own, 'rd3', 'jam1', 128, ['d3'])
    seedRiff(own, 'rb1', 'jam1', 128, ['b1'])
    seedRiff(own, 'rb2', 'jam1', 128, ['b2'])
    seedRiff(own, 'rb3', 'jam1', 128, ['b3'])
    for (const cid of ['d1', 'd2', 'd3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'drums', busId: 'drums' })
      seedEmbedding(own, cid, [1, 0, 0])
    }
    for (const cid of ['b1', 'b2', 'b3']) {
      seedStem(own, cid, 'jam1')
      seedCategory(own, cid, { arrangeRole: 'bass', busId: 'bass' })
      seedEmbedding(own, cid, [0, 1, 0])
    }
    // Embedding-guessed: unconfirmed, embeds near the drums cluster.
    seedRiff(own, 'rg', 'jam1', 128, ['guessed-1'])
    seedStem(own, 'guessed-1', 'jam1')
    seedEmbedding(own, 'guessed-1', [0.9, 0.1, 0])
    // Instrument-matched: unconfirmed, no embedding at all, just the bit.
    seedRiff(own, 'ri', 'jam1', 128, ['instrument-1'])
    seedStem(own, 'instrument-1', 'jam1', { instrument: 2 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual([
      'd1',
      'd2',
      'd3',
      'guessed-1',
      'instrument-1'
    ])
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

  // Direct point, 2026-09-15: "you have lots of data from saved tidied up
  // stems, right? it should be straightforward to run a generic DSP/
  // audio-feature classifier similar to that" -- the classifier already
  // existed (categoryCentroids.ts, trained by every real StemCategories
  // write); this proves getCentroidGuessedStemCIDs actually wires it into
  // Discover's own pool. Spies on loadCategoryCentroidStore to supply a
  // real trained store (the real one reads app.getPath, mocked to an
  // empty/nonexistent path at the top of this file) -- restored by the
  // top-level afterEach.
  it('includes an UNCONFIRMED stem whose own DSP feature vector (StemFeatureCache) confidently classifies via the centroid classifier', async () => {
    const own = freshDb()
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    // 3 confirmed 'drums' samples (high transientDensity), 3 confirmed
    // 'bass' samples (high bassEnergyRatio) -- the minimum
    // suggestCategory needs per category, with 2 categories trained.
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)

    seedRiff(own, 'r1', 'jam1', 128, ['unconfirmed-1'])
    seedStem(own, 'unconfirmed-1', 'jam1', { presetName: 'maybe a kick' })
    // Close to the drums cluster (high transientDensity, low
    // bassEnergyRatio), no StemCategories row at all.
    seedFeatures(own, 'unconfirmed-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['unconfirmed-1'])
    expect(candidates[0]).toMatchObject({ arrangeRole: 'drums', drumSubRole: null })
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
