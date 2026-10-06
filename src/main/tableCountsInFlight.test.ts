// src/main/tableCountsInFlight.test.ts
//
// While the archive's row count is being taken on a worker thread at startup
// (tableCountSeed.ts), no reader may take its own COUNT(*) on the main
// thread: the 1.7-2.3 s statement the worker is there to avoid (review of
// the faster-startup commits, 2026-10-06). The readers wait for the worker,
// or (a cached scan's 30-second check) put the check off until it is back.
// Opens databases, so it is on vitest.config.ts's CI exclusion list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isScanCacheCurrent,
  isTableCountInFlight,
  readTableSignal,
  readTableSignalSettled,
  whenAllTableCountsSettled,
  type ScanCacheState
} from './tableChangeSignal'
import { countRowsInWorker, seedTableCounts } from './tableCountSeed'
import { refreshStemJamPairs } from './scanTargetCache'
import { getArtistIndex, resetArtistIndexForTests } from './discoverArtistIndex'
import { getArtistStemRows } from './discoverArtistStems'
import { getRiffIndexForDb } from './discoverCandidates'
import { buildOwnStemIndex } from './ownStemIndex'
import { DISCOVER_JAM_USER_PAIRS_DDL } from './discoverJamUserPairsStore'
import { countWork } from './workCounters'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/table-counts-in-flight-userdata' } }))

// Pass-through spy: countWork is a no-op in tests (counters never enabled).
vi.mock('./workCounters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workCounters')>()
  return { ...actual, countWork: vi.fn() }
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'table-counts-in-flight-'))
})
afterEach(() => {
  resetArtistIndexForTests()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** A LORE-shaped archive, rollback journal like his: `n` riffs of one stem
 * each, half of them 'elling's. */
function archive(n: number): string {
  const path = join(dir, 'archive.db')
  const db = new Database(path)
  db.pragma('journal_mode = DELETE')
  const slots = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `StemCID_${i} TEXT`).join(', ')
  db.exec(`
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      CreatorUserName TEXT, Instrument INTEGER);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);
    CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, UserName TEXT,
      BPMrnd REAL, CreationTime INTEGER, ${slots});
    CREATE INDEX Riff_IndexUser ON Riffs (UserName);`)
  const stem = db.prepare(`INSERT INTO Stems VALUES (?, 'jam', ?, 1)`)
  const riff = db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, UserName, BPMrnd, StemCID_1) VALUES (?, 'jam', ?, 120, ?)`
  )
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const user = i % 2 === 0 ? 'elling' : 'other'
      stem.run(`s${i}`, user)
      riff.run(`r${i}`, user, `s${i}`)
    }
  })()
  db.close()
  return path
}

function ownDb(): Database.Database {
  const db = new Database(join(dir, 'own.db'))
  db.exec(`CREATE TABLE IF NOT EXISTS StemFeatureCache (StemCID TEXT PRIMARY KEY,
    FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL);`)
  db.exec(DISCOVER_JAM_USER_PAIRS_DDL)
  return db
}

/** Full-table counts `db` has run on this (the main) thread since the spy
 * went on -- readTableSignal's COUNT. The worker has its own connection. */
function mainThreadCounts(db: Database.Database): () => number {
  const spy = vi.spyOn(db, 'prepare')
  return () =>
    spy.mock.calls.filter(([sql]) => /COUNT\(\*\) AS n FROM (Stems|Riffs)$/.test(String(sql)))
      .length
}

/** A seed whose worker count is held until `release()`. */
function heldSeed(
  ro: Database.Database,
  own: Database.Database
): { seeded: Promise<void>; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const seeded = seedTableCounts(ro, own, {
    countRows: async (file, table) => {
      await held
      return countRowsInWorker(file, table)
    }
  })
  return { seeded, release }
}

/** Resolves `promise` and reports whether it settled within a few turns. */
async function settledSoon(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(
    () => (done = true),
    () => (done = true)
  )
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5))
  return done
}

describe('while the archive count is taken on a worker', () => {
  it('a cached scan puts its check off instead of counting, and checks once the count is in', async () => {
    const ro = new Database(archive(40), { readonly: true })
    const counts = mainThreadCounts(ro)
    const { seeded, release } = heldSeed(ro, ownDb())
    expect(isTableCountInFlight(ro, 'Stems')).toBe(true)
    const state: ScanCacheState = { builtAt: 0, checkedAt: 0, signal: null }
    expect(isScanCacheCurrent(ro, 'Stems', state)).toBe(true)
    // Not marked checked: the next call, after the count, really checks.
    expect(state.checkedAt).toBe(0)
    release()
    await seeded
    expect(isTableCountInFlight(ro, 'Stems')).toBe(false)
    expect(isScanCacheCurrent(ro, 'Stems', state)).toBe(false)
    expect(counts()).toBe(0)
  })

  it('readTableSignalSettled waits for the worker and runs no COUNT of its own', async () => {
    const ro = new Database(archive(40), { readonly: true })
    const counts = mainThreadCounts(ro)
    const { seeded, release } = heldSeed(ro, ownDb())
    const read = readTableSignalSettled(ro, 'Riffs')
    const all = whenAllTableCountsSettled()
    expect(await settledSoon(read)).toBe(false)
    expect(await settledSoon(all)).toBe(false)
    release()
    expect((await read)?.count).toBe(40)
    await all
    await seeded
    expect(counts()).toBe(0)
  })

  it('a reader that does not wait still gets the right count, and is noted', async () => {
    const ro = new Database(archive(40), { readonly: true })
    const { seeded, release } = heldSeed(ro, ownDb())
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(readTableSignal(ro, 'Stems')?.count).toBe(40)
    expect(vi.mocked(countWork)).toHaveBeenCalledWith('sql:signal-count-during-seed.Stems')
    release()
    await seeded
  })

  it('the readers behind the renderer and the background passes wait for it', async () => {
    const path = archive(40)
    const own = ownDb()
    const ro = new Database(path, { readonly: true })
    const counts = mainThreadCounts(ro)
    const { seeded, release } = heldSeed(ro, own)
    // get-discover-library-scan-work's pairs, discover-artist-index, artist
    // mode's stems, a roll's riff index, the startup own-only index.
    const pairs = refreshStemJamPairs(own, ro)
    const artists = getArtistIndex(own, [ro], 'elling')
    const artistStems = getArtistStemRows([ro], 'elling')
    const riffIndex = getRiffIndexForDb(ro)
    const ownIndex = buildOwnStemIndex(ro, 'elling')
    const all = Promise.all([pairs, artists, artistStems, riffIndex, ownIndex])
    expect(await settledSoon(all)).toBe(false)
    expect(counts()).toBe(0)
    release()
    const [cached, index, stems, riffs, mine] = await all
    await seeded
    expect(cached).toBe(true)
    expect(index.counts.find((c) => c.user === 'elling')?.stems).toBe(20)
    expect(stems).toHaveLength(20)
    expect(riffs.size).toBe(40)
    expect(mine.rows).toHaveLength(20)
    expect(counts()).toBe(0)
  })
})
