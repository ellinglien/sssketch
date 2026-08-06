import { describe, expect, it, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  warehouseAvailable,
  resolveStemPath,
  setWarehouseRootForTests,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems
} from './loreWarehouse'
import { stemDownloadUrl } from '@shared/loreLibrary'

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

describe('loreWarehouse', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('warehouseAvailable() is false when the root directory does not exist', () => {
    setWarehouseRootForTests('/no/such/path/at/all')
    expect(warehouseAvailable()).toBe(false)
  })

  it('warehouseAvailable() is true when a real warehouse.db3 exists at the expected path', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    expect(warehouseAvailable()).toBe(true)
  })

  it('resolveStemPath shards by the first hex character of the StemCID', () => {
    setWarehouseRootForTests('/Volumes/Elling-Lien/ENDLESSS')
    const path = resolveStemPath('bandABC123', 'dc857530d08e11ecb5304f35d712ecc6')
    expect(path).toBe(
      '/Volumes/Elling-Lien/ENDLESSS/cache/common/stem_v2/bandABC123/d/dc857530d08e11ecb5304f35d712ecc6'
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

describe('listJams', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('lists jams sorted by most recent riff activity, most recent first', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno', 'jam-ambient', 'jam-empty'])
    expect(jams[0].lastRiffTime).toBe(2000)
  })

  it('filters by name, case-insensitively', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('techno')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno'])
  })

  it('a jam with no riffs yet still appears, sorted last (lastRiffTime 0)', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('')
    expect(jams[jams.length - 1]).toEqual({
      jamCID: 'jam-empty',
      name: 'Never Jammed',
      lastRiffTime: 0
    })
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
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
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)

    const { riffs } = listRiffs('jam-ambient', {})
    expect(riffs.map((r) => r.riffCID)).toEqual(['riff-3'])
  })

  it('filters by bpm when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const { riffs } = listRiffs('jam-techno', { bpm: 130 })
    expect(riffs).toHaveLength(2)
    expect(listRiffs('jam-techno', { bpm: 999 }).riffs).toHaveLength(0)
  })

  it('filters by userName when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    expect(listRiffs('jam-techno', { userName: 'elling' }).riffs).toHaveLength(2)
    expect(listRiffs('jam-techno', { userName: 'nobody' }).riffs).toHaveLength(0)
  })

  it('filters to only fully-cached riffs when onlyFullyCached is true', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    // riff-1 has 1 of 2 stems cached (not fully); riff-2 has 0 of 1 (not
    // fully either) — neither should pass a strict "fully cached" filter.
    const { riffs } = listRiffs('jam-techno', { onlyFullyCached: true })
    expect(riffs).toHaveLength(0)
  })

  it('scores ownerFraction against targetUser instead of the LORE_USERNAME default when given', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)

    // Defaults to LORE_USERNAME ('elling') when targetUser is unset — both
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
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests('/no/such/path')
    expect(listRiffs('jam-techno', {}).riffs).toEqual([])
  })

  it('respects a custom limit, for callers that want a smaller page than RIFF_PAGE_SIZE', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)

    const resolved = resolveRiff('riff-2') // riff-2 has no GainsJSON at all
    expect(resolved!.stems[0].gain).toBe(1.0)
  })

  it('returns null for a nonexistent RiffCID', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
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
      setWarehouseRootForTests(root)

      const resolved = resolveRiff('riff-keyed')
      expect(resolved!.key).toBe('E Minor (Aeolian)')
    }
  )

  it('leaves key undefined for a riff with no Root/Scale set, rather than a bogus string', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    // riff-1 (from createFixtureWarehouse's own seed data) never set Root/
    // Scale -- both are NULL, the normal case for riffs predating this
    // metadata being tracked at all.
    const resolved = resolveRiff('riff-1')
    expect(resolved!.key).toBeUndefined()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
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
    setWarehouseRootForTests(root)

    const result = resolveRiffWithContext('riff-20')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-big')
    expect(result!.matchedRiffCID).toBe('riff-20')
    expect(result!.offset).toBe(10)
  })

  it('clamps the offset to 0 for a riff at (or near) the very start of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)
    expect(resolveRiffWithContext('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
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
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)

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
    setWarehouseRootForTests(root)
    expect(await downloadMissingStems('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', async () => {
    setWarehouseRootForTests('/no/such/path')
    expect(await downloadMissingStems('riff-1')).toBeNull()
  })
})
