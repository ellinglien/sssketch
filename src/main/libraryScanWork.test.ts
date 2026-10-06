// src/main/libraryScanWork.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { STEM_FEATURE_VERSION } from '@shared/stemFeatures'
import { STEM_LEVEL_VERSION } from '@shared/stemLevel'
import { needsAnyAnalysis } from '@shared/stemAnalysisNeeds'
import { createDirListingExists, listLibraryScanTargets } from './discoverLibraryStems'
import { getStemAnalysisNeeds } from './stemAnalysisNeeds'
import { listLibraryScanWork } from './libraryScanWork'
import { countWork } from './workCounters'

const fsSpies = vi.hoisted(() => ({ readdirSync: vi.fn() }))

let userDataDir = ''
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))
// discoverLibraryStems.ts imports readdirSync from 'fs' (the same builtin):
// wrapped once, so a call shows (ESM namespaces can't be spied per test).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  fsSpies.readdirSync.mockImplementation(actual.readdirSync)
  return { ...actual, readdirSync: fsSpies.readdirSync }
})
vi.mock('./workCounters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workCounters')>()
  return { ...actual, countWork: vi.fn() }
})

let dir: string
let archive: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'library-scan-work-'))
  userDataDir = join(dir, 'userData')
  archive = join(dir, 'archive')
  const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
  setRiffLibraryRootForTests(archive)
  vi.mocked(countWork).mockClear()
  fsSpies.readdirSync.mockClear()
})

afterEach(async () => {
  const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
  setRiffLibraryRootForTests(null)
  rmSync(dir, { recursive: true, force: true })
})

/** Where resolveStemPath puts `stemCID` of `jamCID` under the test archive. */
function stemPath(jamCID: string, stemCID: string): string {
  return join(archive, 'cache', 'common', 'stem_v2', jamCID, stemCID[0], stemCID)
}

function putFile(jamCID: string, stemCID: string, bytes = 4): void {
  const path = stemPath(jamCID, stemCID)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 1))
}

function sourceDb(name: string | null): Database.Database {
  const db = new Database(name === null ? ':memory:' : join(dir, name))
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  return db
}

function seedRiff(db: Database.Database, riffCID: string, jamCID: string, stems: string[]): void {
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)
  db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`
  ).run(riffCID, jamCID, ...cols.map((_, i) => stems[i] ?? null))
}

function ownDb(): Database.Database {
  const db = new Database(join(dir, 'own.db'))
  db.exec(`
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemPeaksCache (
      StemCID TEXT PRIMARY KEY, PeaksJSON TEXT NOT NULL, BrightnessJSON TEXT NOT NULL,
      ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Instrument INTEGER);
    CREATE TABLE StemYamnetZeroShotAttempted (StemCID TEXT PRIMARY KEY, AttemptedAt INTEGER NOT NULL);
    CREATE TABLE StemCategories (StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, UpdatedAt INTEGER);
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

const CURRENT = JSON.stringify({
  featureVersion: STEM_FEATURE_VERSION,
  levelVersion: STEM_LEVEL_VERSION
})
const NO_LEVEL = JSON.stringify({ featureVersion: STEM_FEATURE_VERSION })
const V1 = JSON.stringify({ mfcc: [] })

function analyse(
  db: Database.Database,
  stemCID: string,
  rows: { peaks?: boolean; embedding?: boolean; features?: string | null }
): void {
  if (rows.peaks !== false) {
    db.prepare(`INSERT INTO StemPeaksCache VALUES (?, '[]', '[]', 0)`).run(stemCID)
  }
  if (rows.embedding !== false) {
    db.prepare(`INSERT INTO StemEmbeddingCache VALUES (?, '[1]', 0)`).run(stemCID)
  }
  if (rows.features !== null) {
    db.prepare(`INSERT INTO StemFeatureCache VALUES (?, ?, 0)`).run(
      stemCID,
      rows.features ?? CURRENT
    )
  }
}

type Jams = { jamCID: string; dbForJam: Database.Database }[]

/** Today's answer: every target listLibraryScanTargets finds, kept when the
 * needs say it needs anything, minus 0-byte placeholders with no feature row. */
async function oracle(jams: Jams, own: Database.Database): Promise<Map<string, string>> {
  const targets = await listLibraryScanTargets(jams, createDirListingExists(), own)
  const needs = await getStemAnalysisNeeds(
    own,
    targets.map((t) => t.path)
  )
  const hasFeatureRow = (cid: string): boolean =>
    own.prepare(`SELECT 1 FROM StemFeatureCache WHERE StemCID = ?`).get(cid) !== undefined
  return new Map(
    targets
      .filter((_t, i) => needsAnyAnalysis(needs[i]))
      .filter((t) => hasFeatureRow(t.key) || statSync(t.path).size > 0)
      .map((t) => [t.key, t.path])
  )
}

/** Every class of stem the scan meets, across two source dbs. */
function fixture(): { own: Database.Database; jams: Jams; src1: Database.Database } {
  const own = ownDb()
  const src1 = sourceDb('src1.db')
  const src2 = sourceDb('src2.db')

  // analysed and current, on disk: nothing to do
  analyse(own, 'a1current', {})
  putFile('jamA', 'a1current')
  // analysed, current features without the level pass
  analyse(own, 'a2nolevel', { features: NO_LEVEL })
  putFile('jamA', 'a2nolevel')
  // v1 features
  analyse(own, 'a3v1', { features: V1 })
  putFile('jamA', 'a3v1')
  // a corrupt feature row
  analyse(own, 'a4corrupt', { features: '{not json' })
  putFile('jamA', 'a4corrupt')
  // peaks only
  analyse(own, 'b1peaks', { embedding: false, features: null })
  putFile('jamA', 'b1peaks')
  // never analysed, on disk
  putFile('jamA', 'b2never')
  // never analysed, not on disk: b3absent
  // a 0-byte placeholder, never analysed
  putFile('jamA', 'b4placeholder', 0)
  // a 0-byte file with a stale feature row: analysed before, never stat-ed
  analyse(own, 'b5zerostale', { features: V1 })
  putFile('jamA', 'b5zerostale', 0)
  // zero-shot pending: every row current, own Stems row, never attempted
  analyse(own, 'c1zeroshot', {})
  own.prepare(`INSERT INTO Stems VALUES ('c1zeroshot', 'jamA', NULL)`).run()
  putFile('jamA', 'c1zeroshot')
  // in two jams: the first allowed pair (jamB, riff r0...) is absent on disk
  putFile('jamA', 'c2twojams')
  // in a jam nobody listed (jamX), on disk there
  putFile('jamX', 'c3notallowed')
  // in both dbs: src1 (first) decides, and its file is absent
  putFile('jamC', 'd1bothdbs')
  // in src1 only under jamX (not allowed): src2 decides
  putFile('jamC', 'd2laterdb')
  // only in src2, never analysed
  putFile('jamC', 'd3src2only')
  // a folder of analysed, current stems only
  analyse(own, 'e1done', {})
  putFile('jamD', 'e1done')

  seedRiff(src1, 'r1', 'jamA', [
    'a1current',
    'a2nolevel',
    'a3v1',
    'a4corrupt',
    'b1peaks',
    'b2never',
    'b3absent',
    'b4placeholder'
  ])
  seedRiff(src1, 'r2', 'jamA', ['b5zerostale', 'c1zeroshot', 'c2twojams', 'd1bothdbs'])
  seedRiff(src1, 'r0', 'jamB', ['c2twojams'])
  seedRiff(src1, 'r3', 'jamX', ['c3notallowed', 'd2laterdb'])
  seedRiff(src1, 'r4', 'jamD', ['e1done'])
  seedRiff(src2, 'q1', 'jamC', ['d1bothdbs', 'd2laterdb', 'd3src2only'])

  const jams: Jams = [
    { jamCID: 'jamA', dbForJam: src1 },
    { jamCID: 'jamB', dbForJam: src1 },
    { jamCID: 'jamD', dbForJam: src1 },
    { jamCID: 'jamC', dbForJam: src2 }
  ]
  return { own, jams, src1 }
}

function asMap(work: { key: string; path: string }[]): Map<string, string> {
  return new Map(work.map((t) => [t.key, t.path]))
}

describe('listLibraryScanWork (background scan audit 3)', () => {
  it('equals the oracle: listLibraryScanTargets filtered by needsAnyAnalysis, minus placeholders', async () => {
    const { own, jams } = fixture()
    const result = await listLibraryScanWork(jams, own)
    const expected = await oracle(jams, own)
    expect(asMap(result.work)).toEqual(expected)
    // spelled out, so the oracle itself is pinned too
    expect([...expected.keys()].sort()).toEqual(
      [
        'a2nolevel',
        'a3v1',
        'a4corrupt',
        'b1peaks',
        'b2never',
        'b5zerostale',
        'c1zeroshot',
        'd2laterdb',
        'd3src2only'
      ].sort()
    )
    expect(expected.get('d2laterdb')).toBe(stemPath('jamC', 'd2laterdb'))
    expect(result.work).toHaveLength(expected.size)
    expect(result.placeholdersSkipped).toBe(1)
  })

  it('agrees with the oracle again once the pair cache only extends', async () => {
    const { own, jams, src1 } = fixture()
    await listLibraryScanWork(jams, own)
    seedRiff(src1, 'r5', 'jamA', ['f1late'])
    putFile('jamA', 'f1late')
    const result = await listLibraryScanWork(jams, own)
    expect(asMap(result.work)).toEqual(await oracle(jams, own))
    expect(asMap(result.work).has('f1late')).toBe(true)
  })

  it('never lists a folder whose stems are all analysed and current', async () => {
    const { own, jams } = fixture()
    const listed: string[] = []
    await listLibraryScanWork(jams, own, {
      readdirFn: (folder) => {
        listed.push(folder)
        return readdir(folder)
      }
    })
    expect(listed).not.toContain(dirname(stemPath('jamD', 'e1done')))
    expect(listed).toContain(dirname(stemPath('jamA', 'b2never')))
    // each folder at most once
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('never calls readdirSync', async () => {
    const { own, jams } = fixture()
    fsSpies.readdirSync.mockClear()
    await listLibraryScanWork(jams, own)
    expect(fsSpies.readdirSync).not.toHaveBeenCalled()
    // the spy does see the old sync listing (the oracle's)
    await oracle(jams, own)
    expect(fsSpies.readdirSync).toHaveBeenCalled()
  })

  it('never loads the whole pair list', async () => {
    const { own, jams } = fixture()
    const prepare = vi.spyOn(own, 'prepare')
    await listLibraryScanWork(jams, own)
    const reads = prepare.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, ' '))
      .filter((sql) => /^SELECT/i.test(sql.trim()) && /FROM DiscoverScanTargetCache\b/.test(sql))
    prepare.mockRestore()
    expect(reads.length).toBeGreaterThan(0)
    for (const sql of reads) {
      // the anti-join window, an IN-list, or the window's one-row boundary probe
      expect(/NOT EXISTS/.test(sql) || /IN \(/.test(sql) || /LIMIT 1 OFFSET/.test(sql), sql).toBe(
        true
      )
    }
    const kinds = vi.mocked(countWork).mock.calls.map(([kind]) => kind)
    expect(kinds).not.toContain('sql:scan-targets.load')
    expect(kinds).not.toContain('scan-targets.cached-pairs')
  })

  it('a placeholder is dropped; an analysed stem is never stat-ed', async () => {
    const { own, jams } = fixture()
    const statted: string[] = []
    const result = await listLibraryScanWork(jams, own, {
      statFn: (path) => {
        statted.push(path)
        return stat(path)
      }
    })
    expect(asMap(result.work).has('b4placeholder')).toBe(false)
    expect(result.placeholdersSkipped).toBe(1)
    expect(statted.map((p) => p.split('/').pop()).sort()).toEqual(
      ['b1peaks', 'b2never', 'b4placeholder', 'd2laterdb', 'd3src2only'].sort()
    )
    // a 0-byte file with a feature row is kept: it was decoded before
    expect(asMap(result.work).has('b5zerostale')).toBe(true)
  })

  it('the first allowed pair decides the path, across window boundaries (window 3)', async () => {
    const own = ownDb()
    const src = sourceDb('src.db')
    // m0multi's pairs by key: jamA (riff z9), jamB (riff a1), jamX (riff a0, not allowed);
    // stems before it push its pairs across a window boundary.
    seedRiff(src, 'z9', 'jamA', ['m0multi', 'k1'])
    seedRiff(src, 'a1', 'jamB', ['m0multi'])
    seedRiff(src, 'a0', 'jamX', ['m0multi'])
    seedRiff(src, 'b1', 'jamA', ['k0', 'n1'])
    // windows of 3 by (StemCID, jam): [k0, k1, m0multi/jamA], [m0multi/jamB, m0multi/jamX, n1]
    for (const cid of ['k0', 'k1', 'n1']) putFile('jamA', cid)
    putFile('jamA', 'm0multi')
    putFile('jamB', 'm0multi')
    const jams: Jams = [
      { jamCID: 'jamA', dbForJam: src },
      { jamCID: 'jamB', dbForJam: src }
    ]
    const result = await listLibraryScanWork(jams, own, { windowSize: 3 })
    expect(asMap(result.work)).toEqual(await oracle(jams, own))
    expect(asMap(result.work).get('m0multi')).toBe(stemPath('jamB', 'm0multi'))
  })

  it('an uncacheable db (in-memory) falls back to the walk', async () => {
    const own = ownDb()
    const mem = sourceDb(null)
    const file = sourceDb('src.db')
    seedRiff(mem, 'r1', 'jamA', ['u1', 'u2', 'shared1'])
    seedRiff(file, 'r1', 'jamC', ['shared1', 'v1'])
    analyse(own, 'u2', {})
    for (const cid of ['u1', 'u2']) putFile('jamA', cid)
    for (const cid of ['shared1', 'v1']) putFile('jamC', cid)
    const jams: Jams = [
      { jamCID: 'jamA', dbForJam: mem },
      { jamCID: 'jamC', dbForJam: file }
    ]
    const result = await listLibraryScanWork(jams, own)
    expect(asMap(result.work)).toEqual(await oracle(jams, own))
    // shared1 was decided by the in-memory db (absent there), so not by the file db
    expect([...asMap(result.work).keys()].sort()).toEqual(['u1', 'v1'])
  })
})
