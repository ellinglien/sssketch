// src/main/tidyUpLibraryStems.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FolderListing } from './tidyUpLibraryStems'

const fsSpies = vi.hoisted(() => ({ readdirSync: vi.fn() }))
// discoverLibraryStems.ts imports readdirSync from 'fs' (the same builtin):
// wrapped once, so a call shows (ESM namespaces can't be spied per test).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  fsSpies.readdirSync.mockImplementation(actual.readdirSync)
  return { ...actual, readdirSync: fsSpies.readdirSync }
})

// listTidyUpLibraryStems calls resolveStemPath (riffLibraryStore.ts), which
// reads app.getPath('userData')/app.getPath('music') on every call (via
// riffLibraryRootPath) -- mock just that narrow surface, matching
// discoverLibraryStems.test.ts / riffLibraryStore.test.ts's own established
// convention (this codebase avoids mocking `electron` wholesale -- see
// CLAUDE.md's Testing conventions section).
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/tidyUpLibraryStems-test-userdata'
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      BPMrnd REAL, Instrument INTEGER, Length16s REAL, PresetName TEXT,
      CreatorUserName TEXT
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

interface SeedOptions {
  creationTime?: number
  bpm?: number
  length16s?: number
  presetName?: string
  instrument?: number
  scanned?: boolean
}

function seedStem(db: Database.Database, stemCID: string, options: SeedOptions = {}): void {
  db.prepare(
    `INSERT INTO Stems
       (StemCID, OwnerJamCID, CreationTime, BPMrnd, Instrument, Length16s, PresetName,
        CreatorUserName)
     VALUES (?, 'jam', ?, ?, ?, ?, ?, 'someone')`
  ).run(
    stemCID,
    options.creationTime ?? 1000,
    options.bpm ?? 120,
    options.instrument ?? 0,
    options.length16s ?? 64,
    options.presetName ?? ''
  )
  if (options.scanned !== false) {
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, '{}', 1)`
    ).run(stemCID)
  }
}

function confirm(db: Database.Database, stemCID: string, role: string): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, Source, UpdatedAt) VALUES (?, ?, 'tidyup', 1)`
  ).run(stemCID, role)
}

function autoClassify(db: Database.Database, stemCID: string, role: string): void {
  db.prepare(
    `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
     VALUES (?, ?, 'zeroshot', 1)`
  ).run(stemCID, role)
}

/** A folder listing that holds every name asked about. */
const allExist = async (): Promise<FolderListing> => ({ has: () => true })

describe('listTidyUpLibraryStems', () => {
  it('puts UNCONFIRMED stems before confirmed ones', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'confirmed', { creationTime: 9000 })
    confirm(db, 'confirmed', 'drums')
    seedStem(db, 'unconfirmed', { creationTime: 1 })
    const out = await listTidyUpLibraryStems(db, [], 10, allExist)
    expect(out.map((s) => s.stemCID)).toEqual(['unconfirmed', 'confirmed'])
    expect(out[0].confirmedRole).toBeNull()
    expect(out[1].confirmedRole).toBe('drums')
  })

  it('orders within each group by CreationTime, newest first', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'old', { creationTime: 100 })
    seedStem(db, 'new', { creationTime: 900 })
    seedStem(db, 'mid', { creationTime: 500 })
    const out = await listTidyUpLibraryStems(db, [], 10, allExist)
    expect(out.map((s) => s.stemCID)).toEqual(['new', 'mid', 'old'])
  })

  it('only offers stems whose features have been scanned', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'scanned')
    seedStem(db, 'unscanned', { scanned: false })
    const out = await listTidyUpLibraryStems(db, [], 10, allExist)
    expect(out.map((s) => s.stemCID)).toEqual(['scanned'])
  })

  it('only offers stems whose audio is already on disk', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'here')
    seedStem(db, 'gone')
    const out = await listTidyUpLibraryStems(db, [], 10, async () => ({
      has: (name) => name.endsWith('here')
    }))
    expect(out.map((s) => s.stemCID)).toEqual(['here'])
  })

  // Review of plan b21ea5a2 Task 13 M4: one existence promise per stem was
  // 45k-140k promises at once. The folders are listed first (one each), and
  // every stem is then answered synchronously from its folder's listing.
  it('lists each folder once, then answers every stem from the listings', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    for (const cid of ['a1', 'a2', 'a3', 'b1', 'b2']) seedStem(db, cid) // shards a and b
    const listed: string[] = []
    const out = await listTidyUpLibraryStems(db, [], 10, async (dir) => {
      listed.push(dir)
      return { has: (name) => name !== 'a2' }
    })
    expect(listed).toHaveLength(2)
    expect(new Set(listed).size).toBe(2)
    expect(out.map((s) => s.stemCID).sort()).toEqual(['a1', 'a3', 'b1', 'b2'])
  })

  it('a folder that cannot be listed holds nothing', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'a1')
    seedStem(db, 'b1')
    const out = await listTidyUpLibraryStems(db, [], 10, async (dir) =>
      dir.endsWith('/a') ? null : { has: () => true }
    )
    expect(out.map((s) => s.stemCID)).toEqual(['b1'])
  })

  // Scan plan Task 13 M4 (audit minor): the default check lists each folder
  // once with the library scan's async listing, never readdirSync.
  it('by default, checks the disk through async folder listings', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const { resolveStemPath, setRiffLibraryRootForTests } = await import('./riffLibraryStore')
    const root = mkdtempSync(join(tmpdir(), 'tidy-up-library-'))
    try {
      setRiffLibraryRootForTests(root)
      const db = freshDb()
      seedStem(db, 'ondisk')
      seedStem(db, 'absent')
      const path = resolveStemPath('jam', 'ondisk')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'audio')
      fsSpies.readdirSync.mockClear()
      const out = await listTidyUpLibraryStems(db, [], 10)
      expect(out.map((s) => s.stemCID)).toEqual(['ondisk'])
      expect(fsSpies.readdirSync).not.toHaveBeenCalled()
    } finally {
      setRiffLibraryRootForTests(null)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('carries the classifier own guess through, when there is one', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'guessed')
    autoClassify(db, 'guessed', 'bass')
    seedStem(db, 'unguessed', { creationTime: 1 })
    const out = await listTidyUpLibraryStems(db, [], 10, allExist)
    expect(out.find((s) => s.stemCID === 'guessed')?.suggestedRole).toBe('bass')
    expect(out.find((s) => s.stemCID === 'unguessed')?.suggestedRole).toBeNull()
  })

  it('derives barLength from Length16s and durationSec from that and the bpm', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'a', { length16s: 64, bpm: 120 })
    const out = await listTidyUpLibraryStems(db, [], 10, allExist)
    expect(out[0].barLength).toBe(4)
    expect(out[0].durationSec).toBe(8)
  })

  it('reads the sound type off the instrument mask, then the preset name', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    seedStem(db, 'masked', { instrument: 1 << 1 })
    seedStem(db, 'named', { instrument: 0, presetName: 'Eardrop', creationTime: 2 })
    seedStem(db, 'neither', { instrument: 0, presetName: 'zzz nothing', creationTime: 1 })
    const out = await listTidyUpLibraryStems(db, [], 10, allExist)
    const byId = new Map(out.map((s) => [s.stemCID, s]))
    expect(byId.get('masked')?.type).toBe('drums')
    expect(byId.get('named')?.type).toBe('notes')
    expect(byId.get('neither')?.type).toBe('fx')
  })

  it('honours the limit', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    for (let i = 0; i < 10; i += 1) seedStem(db, `s${i}`, { creationTime: i })
    const out = await listTidyUpLibraryStems(db, [], 3, allExist)
    expect(out.map((s) => s.stemCID)).toEqual(['s9', 's8', 's7'])
  })

  it('answers an empty list for an empty library', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    expect(await listTidyUpLibraryStems(freshDb(), [], 10, allExist)).toEqual([])
  })

  it('hydrates a stem whose Stems row lives in a read-only external archive', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const own = freshDb()
    const external = freshDb()
    // Only the FEATURE cache is sssketch's own; the stem's metadata row is
    // the external LORE archive's.
    own
      .prepare(
        `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, '{}', 1)`
      )
      .run('faraway')
    seedStem(external, 'faraway', { presetName: 'Eardrop', scanned: false })
    const out = await listTidyUpLibraryStems(own, [external], 10, allExist)
    expect(out.map((s) => s.stemCID)).toEqual(['faraway'])
    expect(out[0].presetName).toBe('Eardrop')
  })

  it('drops a scanned stem with no Stems row anywhere, rather than inventing one', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES ('orphan', '{}', 1)`
    ).run()
    expect(await listTidyUpLibraryStems(db, [], 10, allExist)).toEqual([])
  })

  it('reads past one page of the keyset-paged eligible query', async () => {
    const { listTidyUpLibraryStems } = await import('./tidyUpLibraryStems')
    const db = freshDb()
    // More than PAGE_SIZE, so the paging loop has to run more than once.
    for (let i = 0; i < 2500; i += 1) {
      seedStem(db, `s${String(i).padStart(5, '0')}`, { creationTime: i })
    }
    const out = await listTidyUpLibraryStems(db, [], 3000, allExist)
    expect(out).toHaveLength(2500)
    expect(out[0].stemCID).toBe('s02499')
  })
})
