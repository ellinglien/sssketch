// src/main/discoverLibraryStems.test.ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { listLibraryScanTargets } from './discoverLibraryStems'

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
})
