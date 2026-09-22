// src/main/scanTargetCache.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listLibraryScanTargets } from './discoverLibraryStems'
import { getCachedStemJamPairs } from './scanTargetCache'

// resolveStemPath reads app.getPath('userData') -- mock just that, as
// discoverLibraryStems.test.ts does.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/scanTargetCache-test-userdata' }
}))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scan-target-cache-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A file-backed source db (a cache key needs a real path). */
function sourceDb(name = 'source.db'): Database.Database {
  const db = new Database(join(dir, name))
  db.exec(`
    CREATE TABLE IF NOT EXISTS Riffs (
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

/** Deterministic pseudo-random ids, so inserts land all over RiffCID order. */
function ids(prefix: string, n: number, seed: number): string[] {
  let x = seed
  return Array.from({ length: n }, (_, i) => {
    x = (x * 1103515245 + 12345) % 2147483648
    return `${x.toString(16).padStart(8, '0')}-${prefix}-${i}`
  })
}

function seedLibrary(db: Database.Database, prefix: string, riffs: number, seed: number): void {
  const riffCIDs = ids(`${prefix}r`, riffs, seed)
  riffCIDs.forEach((riffCID, i) => {
    const jam = `jam${i % 3}`
    // Stems shared across riffs (and a few across jams) to exercise dedupe.
    seedRiff(db, riffCID, jam, [`${prefix}s${i}`, `${prefix}s${i % 7}`, `shared-${i % 5}`])
  })
}

const JAMS = ['jam0', 'jam1', 'jam2']
const allExist = (): boolean => true
// Drops some paths, so existence filtering is part of what's compared.
const someExist = (path: string): boolean => !path.endsWith('3')

function jamsFor(
  db: Database.Database,
  jamCIDs = JAMS
): { jamCID: string; dbForJam: Database.Database }[] {
  return jamCIDs.map((jamCID) => ({ jamCID, dbForJam: db }))
}

function riffWalks(db: Database.Database): () => number {
  const spy = vi.spyOn(db, 'prepare')
  return () => spy.mock.calls.filter(([sql]) => String(sql).includes('ORDER BY RiffCID')).length
}

describe('listLibraryScanTargets with the scan-target cache (B6)', () => {
  it('first launch builds the cache and returns exactly the uncached walk', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 300, 1)
    const own = new Database(':memory:')

    const uncached = await listLibraryScanTargets(jamsFor(src), someExist)
    const cached = await listLibraryScanTargets(jamsFor(src), someExist, own)
    expect(cached).toEqual(uncached)
    expect(cached.length).toBeGreaterThan(0)
  })

  it('an unchanged source is not walked again on the next launch', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 300, 1)
    const own = new Database(':memory:')
    const first = await listLibraryScanTargets(jamsFor(src), allExist, own)

    const walks = riffWalks(src)
    const second = await listLibraryScanTargets(jamsFor(src), allExist, own)
    expect(second).toEqual(first)
    expect(walks()).toBe(0)
  })

  it("persists across reopening sssketch's own db (a real relaunch)", async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 100, 1)
    const ownPath = join(dir, 'own.db')
    let own = new Database(ownPath)
    const first = await listLibraryScanTargets(jamsFor(src), allExist, own)
    own.close()

    own = new Database(ownPath)
    const walks = riffWalks(src)
    expect(await listLibraryScanTargets(jamsFor(src), allExist, own)).toEqual(first)
    expect(walks()).toBe(0)
  })

  it('extends with riffs added since the watermark -- identical to a fresh walk, no full walk', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 300, 1)
    const own = new Database(':memory:')
    await listLibraryScanTargets(jamsFor(src), someExist, own)

    // New riffs with RiffCIDs scattered before/after existing ones, some
    // re-referencing old stems from an earlier position.
    seedLibrary(src, 'b', 120, 99)
    seedRiff(src, '00000000-early', 'jam2', ['as5', 'new-stem'])

    const walks = riffWalks(src)
    const extended = await listLibraryScanTargets(jamsFor(src), someExist, own)
    expect(walks()).toBe(0)
    expect(extended).toEqual(await listLibraryScanTargets(jamsFor(src), someExist))
  })

  it('picks up a skeleton riff whose stems were filled in place later', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 50, 1)
    src.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('skeleton', 'jam1')`).run()
    const own = new Database(':memory:')
    await listLibraryScanTargets(jamsFor(src), allExist, own)

    // What riffLibraryWriter.ts's writeRiffDetail does: an in-place UPDATE,
    // rowid unchanged, count unchanged.
    src
      .prepare(
        `UPDATE Riffs SET StemCID_1 = 'filled-1', StemCID_2 = 'filled-2' WHERE RiffCID = 'skeleton'`
      )
      .run()
    const after = await listLibraryScanTargets(jamsFor(src), allExist, own)
    expect(after.map((t) => t.key)).toEqual(expect.arrayContaining(['filled-1', 'filled-2']))
    expect(after).toEqual(await listLibraryScanTargets(jamsFor(src), allExist))

    // Filled -> no longer re-checked.
    const openRows = own.prepare(`SELECT COUNT(*) AS n FROM DiscoverScanTargetOpenRiffs`).get() as {
      n: number
    }
    expect(openRows.n).toBe(0)
  })

  it('rebuilds when riffs were deleted', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 100, 1)
    const own = new Database(':memory:')
    await listLibraryScanTargets(jamsFor(src), allExist, own)

    src.prepare(`DELETE FROM Riffs WHERE rowid % 4 = 0`).run()
    const walks = riffWalks(src)
    const after = await listLibraryScanTargets(jamsFor(src), allExist, own)
    expect(walks()).toBe(1)
    expect(after).toEqual(await listLibraryScanTargets(jamsFor(src), allExist))
  })

  it('rebuilds when a delete and an insert leave the count unchanged', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 100, 1)
    const own = new Database(':memory:')
    await listLibraryScanTargets(jamsFor(src), allExist, own)

    src.prepare(`DELETE FROM Riffs WHERE rowid = 10`).run()
    seedRiff(src, 'replacement', 'jam0', ['replacement-stem'])
    const walks = riffWalks(src)
    const after = await listLibraryScanTargets(jamsFor(src), allExist, own)
    expect(walks()).toBe(1)
    expect(after).toEqual(await listLibraryScanTargets(jamsFor(src), allExist))
  })

  it('rebuilds when the source file was replaced by a different db of the same size', async () => {
    let src = sourceDb()
    seedLibrary(src, 'a', 60, 1)
    const own = new Database(':memory:')
    await listLibraryScanTargets(jamsFor(src), allExist, own)
    src.close()
    rmSync(join(dir, 'source.db'))

    src = sourceDb()
    seedLibrary(src, 'z', 60, 7)
    const after = await listLibraryScanTargets(jamsFor(src), allExist, own)
    expect(after).toEqual(await listLibraryScanTargets(jamsFor(src), allExist))
    expect(after.some((t) => t.key.startsWith('as'))).toBe(false)
  })

  it('keys the cache per source db, and dedupes stems across dbs as the walk does', async () => {
    const first = sourceDb('first.db')
    const second = sourceDb('second.db')
    seedLibrary(first, 'a', 40, 1)
    seedLibrary(second, 'b', 40, 2)
    const jams = [...jamsFor(first), { jamCID: 'jam9', dbForJam: second }, ...jamsFor(second)]
    const own = new Database(':memory:')
    await listLibraryScanTargets(jams, someExist, own)
    const again = await listLibraryScanTargets(jams, someExist, own)
    expect(again).toEqual(await listLibraryScanTargets(jams, someExist))
  })

  it('filters by the jams asked for at call time, not at cache time', async () => {
    const src = sourceDb()
    seedLibrary(src, 'a', 60, 1)
    const own = new Database(':memory:')
    await listLibraryScanTargets(jamsFor(src), allExist, own)
    const onlyJam1 = await listLibraryScanTargets(jamsFor(src, ['jam1']), allExist, own)
    expect(onlyJam1).toEqual(await listLibraryScanTargets(jamsFor(src, ['jam1']), allExist))
  })

  it('does not cache an in-memory source db (no stable identity) -- walks it as before', async () => {
    const src = new Database(':memory:')
    src.exec(`CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT)`)
    seedRiff(src, 'r1', 'jam0', ['s1'])
    const own = new Database(':memory:')
    expect(await getCachedStemJamPairs(own, src)).toBeNull()
    expect((await listLibraryScanTargets(jamsFor(src), allExist, own)).map((t) => t.key)).toEqual([
      's1'
    ])
  })
})
