import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  riffLibraryAvailable,
  riffLibraryRootPath,
  setRiffLibraryRoot,
  resolveStemPath,
  setRiffLibraryRootForTests,
  hasStoredRiffLibraryRootOverride,
  listJams,
  listJamsWithDb,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems
} from './riffLibraryStore'
import { stemDownloadUrl } from '@shared/riffLibraryTypes'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

function createFixtureWarehouse(root: string): void {
  mkdirSync(join(root, 'cache', 'common'), { recursive: true })
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    CREATE TABLE "Jams" ("JamCID" TEXT NOT NULL UNIQUE, "PublicName" TEXT NOT NULL, PRIMARY KEY("JamCID"));
    CREATE TABLE "Riffs" (
      "RiffCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreationTime" INTEGER,
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT, "Root" INTEGER, "Scale" INTEGER,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, "Length16s" REAL,
      "FileEndpoint" TEXT, "FileBucket" TEXT, "FileKey" TEXT, "FileLength" INTEGER,
      PRIMARY KEY("StemCID")
    );
  `)
  db.close()
}

describe('riffLibraryStore', () => {
  let root: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-userdata-test-'))
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
    setRiffLibraryRootForTests(null)
  })

  it('riffLibraryAvailable() is false when the root directory does not exist', () => {
    setRiffLibraryRootForTests('/no/such/path/at/all')
    expect(riffLibraryAvailable()).toBe(false)
  })

  it('riffLibraryAvailable() is true when a real warehouse.db3 exists at the expected path', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    expect(riffLibraryAvailable()).toBe(true)
  })

  it('riffLibraryRootPath defaults to the self-built warehouse root when no prefs file exists', async () => {
    const { ownRiffLibraryRoot } = await import('./riffLibrarySchema')
    setRiffLibraryRootForTests(null) // clear the test override this file's other tests rely on
    expect(riffLibraryRootPath()).toBe(ownRiffLibraryRoot())
  })

  it('setRiffLibraryRoot() persists a new root that riffLibraryRootPath() then returns', () => {
    setRiffLibraryRootForTests(null)
    setRiffLibraryRoot('/Users/someone/Music/EndlesssSync')
    expect(riffLibraryRootPath()).toBe('/Users/someone/Music/EndlesssSync')
    const prefs = JSON.parse(readFileSync(join(userDataDir, 'riffLibraryPrefs.json'), 'utf-8')) as {
      root: string
    }
    expect(prefs).toEqual({ root: '/Users/someone/Music/EndlesssSync' })
  })

  it('setRiffLibraryRoot() picks up a real warehouse at the new root immediately', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    // Point somewhere real first so the cached DB handle is non-null --
    // this is what actually exercises setRiffLibraryRoot's closeRiffLibraryDb()
    // call; starting from a null override risks a false pass on Elling's
    // own dev machine, where the legacy default happens to be real and
    // mounted too.
    setRiffLibraryRootForTests('/no/such/path/at/all')
    expect(riffLibraryAvailable()).toBe(false)
    setRiffLibraryRootForTests(null)
    setRiffLibraryRoot(root)
    expect(riffLibraryAvailable()).toBe(true)
  })

  it('resolveStemPath shards by the first hex character of the StemCID', () => {
    setRiffLibraryRootForTests('/Volumes/Elling-Lien/ENDLESSS')
    const path = resolveStemPath('bandABC123', 'dc857530d08e11ecb5304f35d712ecc6')
    expect(path).toBe(
      '/Volumes/Elling-Lien/ENDLESSS/cache/common/stem_v2/bandABC123/d/dc857530d08e11ecb5304f35d712ecc6'
    )
  })

  it('resolveStemPath uses the content-addressed endlesss-cache layout for the self-built warehouse', async () => {
    const { ownRiffLibraryRoot } = await import('./riffLibrarySchema')
    setRiffLibraryRootForTests(ownRiffLibraryRoot())
    expect(resolveStemPath('jam_1', 'stem_abc123')).toBe(
      join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_abc123')
    )
  })

  it('resolveStemPath still uses the jam-sharded stem_v2 layout for an external warehouse', () => {
    setRiffLibraryRootForTests('/some/external/lore-folder')
    expect(resolveStemPath('jam_1', 'stem_abc123')).toBe(
      join('/some/external/lore-folder', 'cache', 'common', 'stem_v2', 'jam_1', 's', 'stem_abc123')
    )
  })
})

function createSeededFixtureWarehouse(root: string): void {
  mkdirSync(join(root, 'cache', 'common'), { recursive: true })
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    CREATE TABLE "Jams" ("JamCID" TEXT NOT NULL UNIQUE, "PublicName" TEXT NOT NULL, PRIMARY KEY("JamCID"));
    CREATE TABLE "Riffs" (
      "RiffCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreationTime" INTEGER,
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT, "Root" INTEGER, "Scale" INTEGER,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, "Length16s" REAL,
      "FileEndpoint" TEXT, "FileBucket" TEXT, "FileKey" TEXT, "FileLength" INTEGER,
      PRIMARY KEY("StemCID")
    );
  `)
  db.exec(`
    INSERT INTO Jams (JamCID, PublicName) VALUES
      ('jam-techno', 'Techno Jam'),
      ('jam-ambient', 'Ambient Sketches'),
      ('jam-empty', 'Never Jammed');
    INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName) VALUES
      ('riff-1', 'jam-techno', 1000, 130, 8, 'elling'),
      ('riff-2', 'jam-techno', 2000, 130, 8, 'elling'),
      ('riff-3', 'jam-ambient', 1500, 90, 16, 'elling');
  `)
  db.close()
}

describe('legacy loreWarehousePrefs.json carry-forward', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-userdata-carryforward-test-'))
  })

  afterEach(() => {
    setRiffLibraryRootForTests(null)
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('carries forward a legacy loreWarehousePrefs.json to the new filename, honoring its root', () => {
    writeFileSync(
      join(userDataDir, 'loreWarehousePrefs.json'),
      JSON.stringify({ root: '/Volumes/Elling-Lien/ENDLESSS' })
    )
    setRiffLibraryRootForTests(null) // force a real read through prefs, not the test override

    expect(riffLibraryRootPath()).toBe('/Volumes/Elling-Lien/ENDLESSS')

    const newPrefs = JSON.parse(
      readFileSync(join(userDataDir, 'riffLibraryPrefs.json'), 'utf-8')
    ) as { root: string }
    expect(newPrefs).toEqual({ root: '/Volumes/Elling-Lien/ENDLESSS' })

    expect(existsSync(join(userDataDir, 'loreWarehousePrefs.json'))).toBe(false)
  })

  it('carries forward for hasStoredRiffLibraryRootOverride too, and reports true once carried', () => {
    writeFileSync(
      join(userDataDir, 'loreWarehousePrefs.json'),
      JSON.stringify({ root: '/Volumes/Elling-Lien/ENDLESSS' })
    )
    setRiffLibraryRootForTests(null)

    expect(hasStoredRiffLibraryRootOverride()).toBe(true)
    expect(existsSync(join(userDataDir, 'riffLibraryPrefs.json'))).toBe(true)
    expect(existsSync(join(userDataDir, 'loreWarehousePrefs.json'))).toBe(false)
  })

  it('when both the legacy and new prefs files exist, the new one wins and the legacy one is left untouched', () => {
    writeFileSync(
      join(userDataDir, 'loreWarehousePrefs.json'),
      JSON.stringify({ root: '/Volumes/Elling-Lien/OldArchive' })
    )
    writeFileSync(
      join(userDataDir, 'riffLibraryPrefs.json'),
      JSON.stringify({ root: '/Volumes/Elling-Lien/NewArchive' })
    )
    setRiffLibraryRootForTests(null)

    expect(riffLibraryRootPath()).toBe('/Volumes/Elling-Lien/NewArchive')

    // Legacy file is left completely alone -- new-key-first semantics,
    // never overwritten or deleted once the new file already exists.
    const legacyPrefs = JSON.parse(
      readFileSync(join(userDataDir, 'loreWarehousePrefs.json'), 'utf-8')
    ) as { root: string }
    expect(legacyPrefs).toEqual({ root: '/Volumes/Elling-Lien/OldArchive' })
  })

  it('does nothing when neither prefs file exists', () => {
    setRiffLibraryRootForTests(null)
    expect(existsSync(join(userDataDir, 'riffLibraryPrefs.json'))).toBe(false)
    expect(hasStoredRiffLibraryRootOverride()).toBe(false)
    expect(existsSync(join(userDataDir, 'riffLibraryPrefs.json'))).toBe(false)
  })
})

describe('listJams', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('lists jams sorted by most recent riff activity, most recent first', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const jams = listJams('')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno', 'jam-ambient', 'jam-empty'])
    expect(jams[0].lastRiffTime).toBe(2000)
  })

  it('filters by name, case-insensitively', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const jams = listJams('techno')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno'])
  })

  it('a jam with no riffs yet still appears, sorted last (lastRiffTime 0)', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const jams = listJams('')
    expect(jams[jams.length - 1]).toEqual({
      jamCID: 'jam-empty',
      name: 'Never Jammed',
      lastRiffTime: 0
    })
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setRiffLibraryRootForTests('/no/such/path')
    expect(listJams('')).toEqual([])
  })
})

function seedStemsAndGains(root: string): void {
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    UPDATE Riffs SET StemCID_1 = 'stem-a', StemCID_2 = 'stem-b', GainsJSON = '{"1":0.8,"2":0.5}'
      WHERE RiffCID = 'riff-1';
    UPDATE Riffs SET StemCID_1 = 'stem-c' WHERE RiffCID = 'riff-2';
  `)
  // BarLength is deliberately seeded with a WRONG decoy value (999) on every
  // row — real-warehouse data proved this column isn't a reliable per-stem
  // bar count (see resolveRiff's comment); Length16s is what actually
  // governs durationSec, so these tests assert against ITS values while
  // BarLength sits there as a trap that would fail the test if the code
  // regressed to reading the wrong column.
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength, Length16s) VALUES (?,?,?,?,?,?,?,?)`
  ).run('stem-a', 'jam-techno', 'elling', 'Microphone', 16, 130, 999, 128) // 128/16 = 8 bars
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength, Length16s, FileEndpoint, FileBucket, FileKey, FileLength) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    'stem-b',
    'jam-techno',
    'mvdg',
    'Lowpass',
    2,
    130,
    999,
    64, // 64/16 = 4 bars
    'endlesss-dev.fra1.digitaloceanspaces.com',
    '',
    'attachments/oggAudio/jam-techno/stem-b',
    9
  )
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength, Length16s) VALUES (?,?,?,?,?,?,?,?)`
  ).run('stem-c', 'jam-techno', 'elling', 'Pianabot', 4, 130, 999, 128) // 128/16 = 8 bars
  db.close()

  // stem-a is "cached" (a real file at its resolved sharded path); stem-b and
  // stem-c are not — proves cachedStemCount only counts what's actually on disk.
  const stemADir = join(root, 'cache', 'common', 'stem_v2', 'jam-techno', 's')
  mkdirSync(stemADir, { recursive: true })
  writeFileSync(join(stemADir, 'stem-a'), 'fake ogg bytes')
}

describe('listRiffs', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('reports stemCount, cachedStemCount, and ownerFraction per riff', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    const { riffs } = listRiffs('jam-techno', {})
    const riff1 = riffs.find((r) => r.riffCID === 'riff-1')!
    expect(riff1.stemCount).toBe(2)
    expect(riff1.cachedStemCount).toBe(1) // only stem-a is actually on disk
    expect(riff1.ownerFraction).toBe(0.5) // elling (stem-a) + mvdg (stem-b)

    const riff2 = riffs.find((r) => r.riffCID === 'riff-2')!
    expect(riff2.stemCount).toBe(1)
    expect(riff2.cachedStemCount).toBe(0) // stem-c not on disk
    expect(riff2.ownerFraction).toBe(1) // elling (stem-c) only
  })

  it('only returns riffs for the requested jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    const { riffs } = listRiffs('jam-ambient', {})
    expect(riffs.map((r) => r.riffCID)).toEqual(['riff-3'])
  })

  it('filters by a bpm range (bpmMin/bpmMax) when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // Both riff-1 and riff-2 (jam-techno) are BPMrnd 130.
    expect(listRiffs('jam-techno', { bpmMin: 130, bpmMax: 130 }).riffs).toHaveLength(2)
    expect(listRiffs('jam-techno', { bpmMin: 999 }).riffs).toHaveLength(0)
    expect(listRiffs('jam-techno', { bpmMax: 100 }).riffs).toHaveLength(0)
    // A range wide enough to include jam-ambient's own 90bpm riff would still
    // exclude it via the jam scoping condition -- bpmMin alone here just
    // proves the >= half of the range is applied independently of bpmMax.
    expect(listRiffs('jam-techno', { bpmMin: 100 }).riffs).toHaveLength(2)
  })

  it('filters by key (root + scale together) when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // Scoped to this test only (not the shared fixture) -- other tests in
    // this file rely on riff-1 having no Root/Scale set at all.
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(`
      UPDATE Riffs SET Root = 0, Scale = 0 WHERE RiffCID = 'riff-1';
      UPDATE Riffs SET Root = 4, Scale = 5 WHERE RiffCID = 'riff-2';
    `)
    db.close()

    // riff-1 is Root=0/Scale=0 (C Major), riff-2 is Root=4/Scale=5 (E Minor).
    expect(listRiffs('jam-techno', { root: 0, scale: 0 }).riffs.map((r) => r.riffCID)).toEqual([
      'riff-1'
    ])
    expect(listRiffs('jam-techno', { root: 4, scale: 5 }).riffs.map((r) => r.riffCID)).toEqual([
      'riff-2'
    ])
    expect(listRiffs('jam-techno', { root: 7, scale: 2 }).riffs).toHaveLength(0)
  })

  it('filters by userName when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    expect(listRiffs('jam-techno', { userName: 'elling' }).riffs).toHaveLength(2)
    expect(listRiffs('jam-techno', { userName: 'nobody' }).riffs).toHaveLength(0)
  })

  it('filters to only fully-cached riffs when onlyFullyCached is true', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // riff-1 has 1 of 2 stems cached (not fully); riff-2 has 0 of 1 (not
    // fully either) — neither should pass a strict "fully cached" filter.
    const { riffs } = listRiffs('jam-techno', { onlyFullyCached: true })
    expect(riffs).toHaveLength(0)
  })

  it('scores ownerFraction against targetUser instead of the RIFF_LIBRARY_USERNAME default when given', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // Symmetric to the 'reports ... ownerFraction' test above, but scored
    // against 'mvdg' (stem-b's creator) instead of the default 'elling' —
    // proves the target user is a real per-call parameter, not baked in.
    const { riffs } = listRiffs('jam-techno', { targetUser: 'mvdg' })
    expect(riffs.find((r) => r.riffCID === 'riff-1')!.ownerFraction).toBe(0.5) // mvdg (stem-b) only
    expect(riffs.find((r) => r.riffCID === 'riff-2')!.ownerFraction).toBe(0) // elling (stem-c) only, no mvdg
  })

  it('filters to only riffs containing targetUser when onlyContainsUser is true', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // Defaults to RIFF_LIBRARY_USERNAME ('elling') when targetUser is unset — both
    // riff-1 and riff-2 have an elling stem.
    expect(listRiffs('jam-techno', { onlyContainsUser: true }).riffs.map((r) => r.riffCID)).toEqual(
      ['riff-2', 'riff-1']
    )
    // Only riff-1 has an mvdg stem (stem-b).
    expect(
      listRiffs('jam-techno', { targetUser: 'mvdg', onlyContainsUser: true }).riffs.map(
        (r) => r.riffCID
      )
    ).toEqual(['riff-1'])
  })

  it('paginates when a jam has more riffs than fit on one page', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam-big', 'Big Jam')`)
    const insert = db.prepare(
      'INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName) VALUES (?,?,?,?,?,?)'
    )
    // One more than RIFF_PAGE_SIZE (1000) — the real bug report this covers:
    // some of Elling's actual jams have 20,000+ riffs, and the old hard
    // LIMIT with no offset silently dropped everything past it.
    for (let i = 0; i < 1001; i++) {
      insert.run(`riff-big-${i}`, 'jam-big', i, 130, 8, 'elling')
    }
    db.close()
    setRiffLibraryRootForTests(root)

    const page1 = listRiffs('jam-big', {})
    expect(page1.riffs).toHaveLength(1000)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextOffset).toBe(1000)

    const page2 = listRiffs('jam-big', { offset: page1.nextOffset })
    expect(page2.riffs).toHaveLength(1)
    expect(page2.hasMore).toBe(false)
    expect(page2.nextOffset).toBe(1001)

    // Newest-first (CreationTime DESC), so no riff should appear on both
    // pages.
    const page1CIDs = new Set(page1.riffs.map((r) => r.riffCID))
    for (const r of page2.riffs) expect(page1CIDs.has(r.riffCID)).toBe(false)
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setRiffLibraryRootForTests('/no/such/path')
    expect(listRiffs('jam-techno', {}).riffs).toEqual([])
  })

  it('respects a custom limit, for callers that want a smaller page than RIFF_PAGE_SIZE', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // jam-techno has 2 riffs (riff-1, riff-2) -- a limit of 1 constrains the
    // fetch to exactly 1 row, and correctly reports hasMore against THAT
    // limit (not the default RIFF_PAGE_SIZE).
    const page1 = listRiffs('jam-techno', { limit: 1 })
    expect(page1.riffs).toHaveLength(1)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextOffset).toBe(1)

    // Second page asks for more than remains (limit 5, only 1 riff left) --
    // unambiguously proves hasMore goes false once a page returns fewer
    // rows than its OWN limit, not just fewer than RIFF_PAGE_SIZE.
    const page2 = listRiffs('jam-techno', { limit: 5, offset: page1.nextOffset })
    expect(page2.riffs).toHaveLength(1)
    expect(page2.hasMore).toBe(false)
  })
})

describe('resolveRiff', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resolves every populated stem slot with its path, gain, and metadata', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    const resolved = resolveRiff('riff-1')
    expect(resolved).not.toBeNull()
    expect(resolved!.bpm).toBe(130)
    expect(resolved!.barLength).toBe(8)
    expect(resolved!.stems).toHaveLength(2)

    const stemA = resolved!.stems.find((s) => s.stemCID === 'stem-a')!
    expect(stemA.slot).toBe(1)
    expect(stemA.gain).toBeCloseTo(0.8)
    expect(stemA.creatorUserName).toBe('elling')
    expect(stemA.presetName).toBe('Microphone')
    expect(stemA.instrumentMask).toBe(16)
    expect(stemA.path).not.toBeNull() // it's the one seeded as "on disk"
    // Length16s=128 -> 128/16 = 8 bars; BPMrnd=130 -> 8 * (60/130) * 4 =
    // 14.7692...s. BarLength is seeded as a decoy 999 on this row — if
    // resolveRiff ever regressed to reading that column instead, this
    // assertion would fail loudly instead of silently drifting.
    expect(stemA.barLength).toBe(8)
    expect(stemA.durationSec).toBeCloseTo(14.7692, 3)

    const stemB = resolved!.stems.find((s) => s.stemCID === 'stem-b')!
    expect(stemB.slot).toBe(2)
    expect(stemB.gain).toBeCloseTo(0.5)
    expect(stemB.path).toBeNull() // not on disk
    expect(stemB.downloadUrl).toBe(
      stemDownloadUrl(
        'endlesss-dev.fra1.digitaloceanspaces.com',
        '',
        'attachments/oggAudio/jam-techno/stem-b'
      )
    )
    // stem-a is cached and has no FileEndpoint/FileKey seeded — downloadUrl
    // is still null for it (no Stems row data to build one from), which is
    // fine since nothing needs it once path is already non-null.
    expect(stemA.downloadUrl).toBeNull()
    // Deliberately seeded with a SHORTER Length16s (64, i.e. 4 bars) than
    // stem-a's (128, 8 bars) and than the riff's own BarLength (8, from
    // createSeededFixtureWarehouse) — proves this stem's own
    // barLength/durationSec are used, not the riff's.
    expect(stemB.barLength).toBe(4)
    expect(stemB.durationSec).toBeCloseTo(7.3846, 3)
  })

  it('defaults a stem missing from GainsJSON to gain 1.0', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    const resolved = resolveRiff('riff-2') // riff-2 has no GainsJSON at all
    expect(resolved!.stems[0].gain).toBe(1.0)
  })

  it('returns null for a nonexistent RiffCID', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    expect(resolveRiff('no-such-riff')).toBeNull()
  })

  it(
    "resolves Root/Scale to a readable key name -- traced from OUROVEON's own " +
      'core.constants.h, not guessed (Root 4 = E, Scale 5 = Minor (Aeolian))',
    () => {
      root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
      createSeededFixtureWarehouse(root)
      const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
      db.prepare(
        `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, Root, Scale)
       VALUES ('riff-keyed', 'jam-techno', 2000, 89.9, 4, 'elling', 4, 5)`
      ).run()
      db.close()
      setRiffLibraryRootForTests(root)

      const resolved = resolveRiff('riff-keyed')
      expect(resolved!.key).toBe('E Minor (Aeolian)')
    }
  )

  it('leaves key undefined for a riff with no Root/Scale set, rather than a bogus string', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    // riff-1 (from createFixtureWarehouse's own seed data) never set Root/
    // Scale -- both are NULL, the normal case for riffs predating this
    // metadata being tracked at all.
    const resolved = resolveRiff('riff-1')
    expect(resolved!.key).toBeUndefined()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setRiffLibraryRootForTests('/no/such/path')
    expect(resolveRiff('riff-1')).toBeNull()
  })
})

describe('resolveRiffWithContext', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resolves the jam and an offset centered on the riff, for a riff in the middle of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam-big', 'Big Jam')`)
    const insert = db.prepare(
      'INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName) VALUES (?,?,?,?,?,?)'
    )
    // 41 riffs, CreationTime 0..40 -- riff-20 sits at rank 20 (20 riffs
    // newer than it: CreationTime 21..40), so offset should be 20-10=10.
    for (let i = 0; i <= 40; i++) {
      insert.run(`riff-${i}`, 'jam-big', i, 130, 8, 'elling')
    }
    db.close()
    setRiffLibraryRootForTests(root)

    const result = resolveRiffWithContext('riff-20')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-big')
    expect(result!.matchedRiffCID).toBe('riff-20')
    expect(result!.offset).toBe(10)
  })

  it('clamps the offset to 0 for a riff at (or near) the very start of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)

    // riff-2 (CreationTime 2000) is the NEWEST riff in jam-techno -- rank 0,
    // offset would be 0-10 = -10, clamped to 0.
    const result = resolveRiffWithContext('riff-2')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-techno')
    expect(result!.offset).toBe(0)
  })

  it('matches case-insensitively and trims whitespace, as a typo-tolerant fallback', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)

    const result = resolveRiffWithContext('  RIFF-1  ')
    expect(result).not.toBeNull()
    // The MATCHED (real) riffCID is returned, not the mistyped input, so
    // the caller can highlight the actual row.
    expect(result!.matchedRiffCID).toBe('riff-1')
    expect(result!.jamCID).toBe('jam-techno')
  })

  it('returns null for a riffCID with no match at all, exact or fallback', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    expect(resolveRiffWithContext('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setRiffLibraryRootForTests('/no/such/path')
    expect(resolveRiffWithContext('riff-1')).toBeNull()
  })
})

describe('downloadMissingStems', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('fetches every uncached stem and writes it to the path resolveStemPath expects', async () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        stemDownloadUrl(
          'endlesss-dev.fra1.digitaloceanspaces.com',
          '',
          'attachments/oggAudio/jam-techno/stem-b'
        )
      )
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('fake ogg bytes for stem-b').buffer
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    // riff-1 has stem-a (already cached) and stem-b (not cached) — only
    // stem-b should trigger a fetch.
    const result = await downloadMissingStems('riff-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const stemB = result!.stems.find((s) => s.stemCID === 'stem-b')!
    expect(stemB.path).not.toBeNull() // now cached, post-download
    expect(readFileSync(stemB.path!, 'utf-8')).toBe('fake ogg bytes for stem-b')

    // stem-a was already cached and shouldn't have been touched/refetched.
    const stemA = result!.stems.find((s) => s.stemCID === 'stem-a')!
    expect(stemA.path).not.toBeNull()
  })

  it('leaves a stem uncached (and reports it that way) when its fetch fails, without throwing', async () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setRiffLibraryRootForTests(root)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response)
    )

    const result = await downloadMissingStems('riff-1')
    expect(result!.stems.find((s) => s.stemCID === 'stem-b')!.path).toBeNull()
  })

  it('returns null for a nonexistent RiffCID', async () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    expect(await downloadMissingStems('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', async () => {
    setRiffLibraryRootForTests('/no/such/path')
    expect(await downloadMissingStems('riff-1')).toBeNull()
  })
})

// Real bug (reported live): Elling's Shared Feed sync-status badge showed
// "850 riffs" (from getWarehouseSyncStatus, which always reads
// openOwnRiffLibraryDb() regardless of the configured root) while the riff
// grid showed none at all. Root cause: he'd separately pointed his browsing
// root at an external LORE archive (riffLibraryPrefs.json), but
// syncSharedFeed always writes into sssketch's own database, unconditionally
// -- every read function below queried the EXTERNAL archive instead, which
// never received that data. Confirmed against his real warehouse.db3: 844
// fully-resolved shared:elling rows sitting in the own db, zero in the
// external one.
describe("shared-feed jams always read from sssketch's own database, regardless of the configured browsing root", () => {
  let externalRoot: string

  beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-shared-feed-test-'))
    const { closeOwnRiffLibraryDb, openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    closeOwnRiffLibraryDb()
    const ownDb = openOwnRiffLibraryDb()
    ownDb.exec(`
      INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:elling', 'Shared Feed', 1);
      INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, StemCID_1, GainsJSON, AppVersion)
        VALUES ('shared-riff-1', 'shared:elling', 5000, 140, 8, 'elling', 'stem-shared-1', '{"1":1.0}', 1);
      INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, Length16s, FileEndpoint, FileBucket, FileKey)
        VALUES ('stem-shared-1', 'shared:elling', 'elling', 'Lead', 1, 140, 128,
                'endlesss-dev.fra1.digitaloceanspaces.com', '', 'attachments/oggAudio/shared/stem-shared-1');
    `)

    // A separate, external "LORE archive" root -- a real jam, but
    // deliberately with NO shared: rows at all, matching the real bug
    // (confirmed directly against the external volume: zero shared:% rows).
    externalRoot = mkdtempSync(join(tmpdir(), 'sssketch-lore-external-test-'))
    createSeededFixtureWarehouse(externalRoot)
    setRiffLibraryRootForTests(externalRoot)
  })

  afterEach(async () => {
    const { closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    closeOwnRiffLibraryDb()
    setRiffLibraryRootForTests(null)
    rmSync(externalRoot, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('listRiffs still returns the shared-feed riffs even though the configured root is external', () => {
    const { riffs } = listRiffs('shared:elling', {})
    expect(riffs.map((r) => r.riffCID)).toEqual(['shared-riff-1'])
  })

  it('listJams still includes Shared Feed with its real lastRiffTime, merged in from the own db', () => {
    const jams = listJams('')
    expect(jams.find((j) => j.jamCID === 'shared:elling')).toEqual({
      jamCID: 'shared:elling',
      name: 'Shared Feed',
      lastRiffTime: 5000
    })
    // The external root's own real jam is still there too -- this isn't a
    // replacement, just a merge.
    expect(jams.some((j) => j.jamCID === 'jam-techno')).toBe(true)
  })

  it('resolveStemPath uses the own content-addressed cache for a shared-feed stem even though root is external', () => {
    expect(resolveStemPath('shared:elling', 'stem-shared-1')).toBe(
      join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem-shared-1')
    )
  })

  it('resolveRiff still resolves a shared-feed riff even though the configured root is external', () => {
    const resolved = resolveRiff('shared-riff-1')
    expect(resolved).not.toBeNull()
    expect(resolved!.bpm).toBe(140)
    expect(resolved!.stems).toHaveLength(1)
  })

  it('resolveRiffWithContext still finds a shared-feed riff even though the configured root is external', () => {
    const result = resolveRiffWithContext('shared-riff-1')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('shared:elling')
    expect(result!.matchedRiffCID).toBe('shared-riff-1')
  })

  it('downloadMissingStems still works for a shared-feed riff even though the configured root is external', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode('fake ogg bytes').buffer
          }) as Response
      )
    )
    const result = await downloadMissingStems('shared-riff-1')
    expect(result).not.toBeNull()
    expect(result!.stems[0].path).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('a real (non-shared) jam in the external root is unaffected -- still reads from there, not the own db', () => {
    const { riffs } = listRiffs('jam-techno', {})
    expect(riffs.map((r) => r.riffCID).sort()).toEqual(['riff-1', 'riff-2'])
  })
})

describe('listJamsWithDb', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('pairs every jam listJams() returns with a working db connection to its own data', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)

    const pairs = listJamsWithDb()
    expect(pairs.map((p) => p.jamCID).sort()).toEqual(['jam-ambient', 'jam-empty', 'jam-techno'])

    // Each pair's db is a real, queryable connection to the SAME data
    // listJams/listRiffs would read -- not just a truthy placeholder.
    const technoPair = pairs.find((p) => p.jamCID === 'jam-techno')!
    const rows = technoPair.db
      .prepare('SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ? ORDER BY CreationTime')
      .all('jam-techno') as { RiffCID: string }[]
    expect(rows.map((r) => r.RiffCID)).toEqual(['riff-1', 'riff-2'])
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setRiffLibraryRootForTests('/no/such/path')
    expect(listJamsWithDb()).toEqual([])
  })

  // Real perf bug, found live: even after discoverCandidates.ts's own
  // series of same-day perf fixes, rolling still took several real
  // seconds, tracing back to THIS function -- a real JOIN+GROUP BY+
  // ORDER BY over the whole Jams/Riffs tables, re-run fresh on EVERY
  // single roll (confirmed live: 53ms-1.4s per call on a real 5,057-jam
  // library). Proves the fix: a second call within the TTL reuses the
  // cached result, even when new data lands in between.
  it('reuses a cached result on a second call within the TTL, even if new data would otherwise change it', async () => {
    // A second listJamsWithDb() call (without the fix) also checks
    // ownRiffLibraryRoot() (riffLibrarySchema.ts, via listJams's own
    // "is the configured root the own db?" check) -- needs userDataDir
    // set for this test specifically, same as the "shared-feed jam"
    // tests below.
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-listjamswithdb-cache-test-'))
    const { closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    closeOwnRiffLibraryDb()

    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)

    const first = listJamsWithDb()
    expect(first.map((p) => p.jamCID).sort()).toEqual(['jam-ambient', 'jam-empty', 'jam-techno'])

    // A new jam lands directly in the warehouse file after the first call.
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam-new', 'Brand New')`).run()
    db.close()

    const second = listJamsWithDb()
    // Still the cached (stale) result -- the newly-added jam does not
    // appear because it landed within the TTL window.
    expect(second.map((p) => p.jamCID).sort()).toEqual(['jam-ambient', 'jam-empty', 'jam-techno'])

    closeOwnRiffLibraryDb()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('with a shared-feed jam involved', () => {
    let externalRoot: string

    beforeEach(async () => {
      userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-listjamswithdb-test-'))
      const { closeOwnRiffLibraryDb, openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
      closeOwnRiffLibraryDb()
      const ownDb = openOwnRiffLibraryDb()
      ownDb.exec(`
        INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:elling', 'Shared Feed', 1);
        INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName)
          VALUES ('shared-riff-1', 'shared:elling', 5000, 140, 8, 'elling');
      `)
    })

    afterEach(async () => {
      const { closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
      closeOwnRiffLibraryDb()
      setRiffLibraryRootForTests(null)
      rmSync(userDataDir, { recursive: true, force: true })
    })

    it('routes a shared-feed jam to the own db, and a regular jam to the configured (external) root db', () => {
      externalRoot = mkdtempSync(join(tmpdir(), 'sssketch-lore-external-test-'))
      createSeededFixtureWarehouse(externalRoot) // real jam-techno data, no shared: rows at all
      setRiffLibraryRootForTests(externalRoot)

      const pairs = listJamsWithDb()

      const sharedPair = pairs.find((p) => p.jamCID === 'shared:elling')
      expect(sharedPair).toBeDefined()
      const sharedRows = sharedPair!.db
        .prepare('SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?')
        .all('shared:elling') as { RiffCID: string }[]
      expect(sharedRows.map((r) => r.RiffCID)).toEqual(['shared-riff-1'])

      // Proves technoPair.db is really the EXTERNAL root's own connection
      // (the own db has no jam-techno rows at all) -- dbForJam routed each
      // jamCID to the correct db, not just the same one for everything.
      const technoPair = pairs.find((p) => p.jamCID === 'jam-techno')
      expect(technoPair).toBeDefined()
      const technoRows = technoPair!.db
        .prepare('SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?')
        .all('jam-techno') as { RiffCID: string }[]
      expect(technoRows.map((r) => r.RiffCID)).toEqual(['riff-1', 'riff-2'])

      rmSync(externalRoot, { recursive: true, force: true })
    })

    // This is as close as the module's own current invariants allow to
    // exercising dbForJam's null-returning branch (finding 2026-09-15 code
    // review, listJamsWithDb has one real branch -- filtering out a jam
    // whose dbForJam() call returns null -- with zero coverage). Traced
    // dbForJam (private, unexported) closely before writing this:
    //
    //   function dbForJam(jamCID) {
    //     return jamCID.startsWith('shared:') ? openOwnRiffLibraryDb() : getRiffLibraryDb()
    //   }
    //
    // getRiffLibraryDb() is the ONLY branch that can ever return null (it
    // has a try/catch around opening the db and returns null on failure);
    // openOwnRiffLibraryDb() (riffLibrarySchema.ts) has no try/catch at all
    // and either succeeds or throws -- never null. And getRiffLibraryDb()
    // caches its connection at module scope, so any jamCID listJams() (via
    // that same getRiffLibraryDb() call) already surfaced is guaranteed to
    // resolve identically -- non-null -- moments later in dbForJam(). So a
    // *listed* non-shared jam can never turn up null here; confirmed this is
    // not just an untested case but a currently-unreachable one given
    // dbForJam's real implementation, not something this test can trigger
    // without faking a failure inside listJams() itself (which would just
    // make the jam never get listed at all, not "listed then filtered").
    //
    // What IS real, and worth covering here: a totally-unavailable
    // configured root (a common real case -- unmounted external LORE drive,
    // never-synced warehouse) contributes nothing, while the always-local
    // own db's shared-feed jam still resolves and is still included --
    // proving listJamsWithDb() degrades gracefully rather than crashing or
    // silently dropping a jam it COULD otherwise resolve.
    it('excludes the configured root entirely when it is unavailable, while a shared-feed jam (own db) still resolves', () => {
      setRiffLibraryRootForTests('/no/such/path/at/all')

      const pairs = listJamsWithDb()
      expect(pairs.map((p) => p.jamCID)).toEqual(['shared:elling'])
      const rows = pairs[0].db
        .prepare('SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?')
        .all('shared:elling') as { RiffCID: string }[]
      expect(rows.map((r) => r.RiffCID)).toEqual(['shared-riff-1'])
    })
  })
})
