import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  warehouseAvailable,
  resolveStemPath,
  setWarehouseRootForTests,
  listJams,
  listRiffs,
  resolveRiff
} from './loreWarehouse'

function createFixtureWarehouse(root: string): void {
  mkdirSync(join(root, 'cache', 'common'), { recursive: true })
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    CREATE TABLE "Jams" ("JamCID" TEXT NOT NULL UNIQUE, "PublicName" TEXT NOT NULL, PRIMARY KEY("JamCID"));
    CREATE TABLE "Riffs" (
      "RiffCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreationTime" INTEGER,
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, PRIMARY KEY("StemCID")
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
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
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
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, PRIMARY KEY("StemCID")
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
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno', 'jam-ambient', 'jam-empty'])
    expect(jams[0].lastRiffTime).toBe(2000)
  })

  it('filters by name, case-insensitively', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('techno')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno'])
  })

  it('a jam with no riffs yet still appears, sorted last (lastRiffTime 0)', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
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
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength) VALUES (?,?,?,?,?,?,?)`
  ).run('stem-a', 'jam-techno', 'elling', 'Microphone', 16, 130, 8)
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength) VALUES (?,?,?,?,?,?,?)`
  ).run('stem-b', 'jam-techno', 'mvdg', 'Lowpass', 2, 130, 4)
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength) VALUES (?,?,?,?,?,?,?)`
  ).run('stem-c', 'jam-techno', 'elling', 'Pianabot', 4, 130, 8)
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
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const riffs = listRiffs('jam-techno', {})
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
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const riffs = listRiffs('jam-ambient', {})
    expect(riffs.map((r) => r.riffCID)).toEqual(['riff-3'])
  })

  it('filters by bpm when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const riffs = listRiffs('jam-techno', { bpm: 130 })
    expect(riffs).toHaveLength(2)
    expect(listRiffs('jam-techno', { bpm: 999 })).toHaveLength(0)
  })

  it('filters by userName when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    expect(listRiffs('jam-techno', { userName: 'elling' })).toHaveLength(2)
    expect(listRiffs('jam-techno', { userName: 'nobody' })).toHaveLength(0)
  })

  it('filters to only fully-cached riffs when onlyFullyCached is true', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    // riff-1 has 1 of 2 stems cached (not fully); riff-2 has 0 of 1 (not
    // fully either) — neither should pass a strict "fully cached" filter.
    const riffs = listRiffs('jam-techno', { onlyFullyCached: true })
    expect(riffs).toHaveLength(0)
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
    expect(listRiffs('jam-techno', {})).toEqual([])
  })
})

describe('resolveRiff', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resolves every populated stem slot with its path, gain, and metadata', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
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
    // BPMrnd=130, BarLength=8 -> 8 * (60/130) * 4 = 14.7692...s
    expect(stemA.barLength).toBe(8)
    expect(stemA.durationSec).toBeCloseTo(14.7692, 3)

    const stemB = resolved!.stems.find((s) => s.stemCID === 'stem-b')!
    expect(stemB.slot).toBe(2)
    expect(stemB.gain).toBeCloseTo(0.5)
    expect(stemB.path).toBeNull() // not on disk
    // Deliberately seeded with a SHORTER BarLength (4) than stem-a's (8) and
    // than the riff's own BarLength (8, from createSeededFixtureWarehouse) —
    // proves this stem's own barLength/durationSec are used, not the riff's.
    expect(stemB.barLength).toBe(4)
    expect(stemB.durationSec).toBeCloseTo(7.3846, 3)
  })

  it('defaults a stem missing from GainsJSON to gain 1.0', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const resolved = resolveRiff('riff-2') // riff-2 has no GainsJSON at all
    expect(resolved!.stems[0].gain).toBe(1.0)
  })

  it('returns null for a nonexistent RiffCID', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    expect(resolveRiff('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
    expect(resolveRiff('riff-1')).toBeNull()
  })
})
