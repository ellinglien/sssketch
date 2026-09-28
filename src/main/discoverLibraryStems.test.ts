// src/main/discoverLibraryStems.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { listLibraryScanTargets } from './discoverLibraryStems'
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'

// listLibraryScanTargets calls resolveStemPath (riffLibraryStore.ts), which
// reads app.getPath('userData') on every call (via riffLibraryRootPath) --
// mock just that narrow surface, matching riffLibraryStore.test.ts's own
// established convention (this codebase avoids mocking `electron` wholesale
// -- see CLAUDE.md's Testing conventions section) rather than pulling in a
// real Electron app instance for a pure-logic test.
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/discoverLibraryStems-test-userdata'
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  return db
}

function seedRiff(
  db: Database.Database,
  riffCID: string,
  jamCID: string,
  stemCIDs: string[]
): void {
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)
  const values: Record<string, unknown> = { riffCID, jamCID }
  cols.forEach((c, i) => {
    values[c] = stemCIDs[i] ?? null
  })
  db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, ${cols.join(', ')})
     VALUES (@riffCID, @jamCID, ${cols.map((c) => '@' + c).join(', ')})`
  ).run(values)
}

describe('listLibraryScanTargets', () => {
  it('only includes stems whose resolved path exists locally', async () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1', 's2'])

    const targets = await listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], (path) =>
      path.endsWith('s1')
    )
    expect(targets.map((t) => t.key)).toEqual(['s1'])
  })

  it('dedupes a StemCID that appears in more than one riff', async () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1'])
    seedRiff(db, 'r2', 'jam1', ['s1'])

    const targets = await listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], () => true)
    expect(targets).toHaveLength(1)
  })

  it('aggregates across multiple jams', async () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1'])
    seedRiff(db, 'r2', 'jam2', ['s2'])

    const targets = await listLibraryScanTargets(
      [
        { jamCID: 'jam1', dbForJam: db },
        { jamCID: 'jam2', dbForJam: db }
      ],
      () => true
    )
    expect(targets.map((t) => t.key).sort()).toEqual(['s1', 's2'])
  })

  it("does not throw when a jam's own db lacks Riffs entirely", async () => {
    const empty = new Database(':memory:')
    await expect(
      listLibraryScanTargets([{ jamCID: 'jamExt', dbForJam: empty }], () => true)
    ).resolves.toEqual([])
  })

  it('yields back to the event loop periodically on a large scan instead of blocking it end to end', async () => {
    // Real bug this guards against: the main process is single-threaded --
    // ipcMain.handle callbacks that never yield block every OTHER IPC call
    // (menus, "new project", everything) for the whole scan's duration.
    // Seeding enough distinct stems to force multiple yield batches and
    // asserting a real setImmediate-driven macrotask can interleave proves
    // this doesn't regress back into one unbroken synchronous loop.
    const db = freshDb()
    for (let i = 0; i < 450; i++) {
      seedRiff(db, `r${i}`, 'jam1', [`s${i}`])
    }
    let interleaved = false
    setImmediate(() => {
      interleaved = true
    })
    await listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], () => true)
    expect(interleaved).toBe(true)
  })

  it('yields on an elapsed-time budget, not a row count, so slow stem checks cannot hold the process', async () => {
    // The yield policy was "every 200 stems" until 2026-09-28, which is a
    // guess about how long 200 stems take -- right only on the machine
    // that made it. Replayed against Elling's own library (425,813 cached
    // pairs, an external archive on a USB/ExFAT volume) it gave a p50 of
    // 0.26ms and a max slice of 102ms: mostly yielding far too eagerly,
    // and occasionally not nearly eagerly enough. A budget in milliseconds
    // bounds the slice on hardware this code has never seen; the same
    // replay measured a 9.8ms max afterwards, with 15x fewer yields.
    //
    // Only Date is faked -- yieldToEventLoop's own setImmediate has to
    // stay real, since a real macrotask interleaving is exactly what is
    // being asserted.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const db = freshDb()
      // Twenty stems: far FEWER than the old 200-row batch, so the old
      // policy would not have yielded inside the stem loop even once, and
      // `firstInterleaveAtStem` below would stay empty.
      for (let i = 0; i < 20; i++) {
        seedRiff(db, `r${i}`, 'jam1', [`s${i}`])
      }

      let interleaved = false
      setImmediate(() => {
        interleaved = true
      })

      // 3ms per existence check -- a slow volume, in other words. The 8ms
      // budget is therefore spent after three of them.
      const firstInterleaveAtStem: number[] = []
      let stemsChecked = 0
      const slowExists = (): boolean => {
        stemsChecked += 1
        if (interleaved && firstInterleaveAtStem.length === 0) {
          firstInterleaveAtStem.push(stemsChecked)
        }
        vi.advanceTimersByTime(3)
        return true
      }

      await listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], slowExists)

      expect(stemsChecked).toBe(20)
      // It yielded partway through the stems, not only at the end of the
      // page -- and early, within the first handful, because that is when
      // the budget actually ran out.
      expect(firstInterleaveAtStem).toHaveLength(1)
      expect(firstInterleaveAtStem[0]).toBeLessThanOrEqual(8)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('listLibraryScanTargets beyond the eight slot columns', () => {
  it('lists a stem that only appears past the eighth slot as a scan target', async () => {
    const db = freshDb()
    db.exec(RIFF_STEMS_EXTRA_DDL)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam1', 'a')`
    ).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()

    const targets = await listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], () => true)
    expect(targets.map((t) => t.key).sort()).toEqual(['a', 'only_extra'])
  })
})

describe('listLibraryScanTargets (jams sharing one db)', () => {
  it('reads Riffs in a few ordered pages per db, not once per jam, and still filters to the given jams', async () => {
    // Real live freeze, profiled 2026-09-21: ~5,000 jams sharing one
    // external archive db meant ~5,000 separate unindexed Riffs scans.
    const db = freshDb()
    const jams: { jamCID: string; dbForJam: Database.Database }[] = []
    for (let j = 0; j < 100; j++) {
      seedRiff(db, `r${j}`, `jam${j}`, [`s${j}`])
      jams.push({ jamCID: `jam${j}`, dbForJam: db })
    }
    seedRiff(db, 'r-outside', 'jam-not-listed', ['s-outside'])
    const prepareSpy = vi.spyOn(db, 'prepare')
    const targets = await listLibraryScanTargets(jams, () => true)
    expect(targets).toHaveLength(100)
    expect(targets.some((t) => t.key === 's-outside')).toBe(false)
    expect(prepareSpy.mock.calls.length).toBeLessThan(10)
  })
})

describe('createDirListingExists', () => {
  it('answers from one directory listing per folder, matching the real filesystem', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createDirListingExists } = await import('./discoverLibraryStems')
    const root = mkdtempSync(join(tmpdir(), 'sssketch-dirlist-'))
    try {
      mkdirSync(join(root, 'a'))
      writeFileSync(join(root, 'a', 'stem1'), '')
      const exists = createDirListingExists()
      expect(exists(join(root, 'a', 'stem1'))).toBe(true)
      expect(exists(join(root, 'a', 'missing'))).toBe(false)
      expect(exists(join(root, 'no-such-dir', 'stem1'))).toBe(false)
      // Listing is taken once per folder -- a file created afterwards in an
      // already-listed folder isn't seen (acceptable: the scan list is built
      // once per session, same as before).
      writeFileSync(join(root, 'a', 'stem2'), '')
      expect(exists(join(root, 'a', 'stem2'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
