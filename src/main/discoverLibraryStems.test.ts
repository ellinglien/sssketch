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
  it('only includes stems whose resolved path exists locally', () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1', 's2'])

    const targets = listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], (path) =>
      path.endsWith('s1')
    )
    expect(targets.map((t) => t.key)).toEqual(['s1'])
  })

  it('dedupes a StemCID that appears in more than one riff', () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1'])
    seedRiff(db, 'r2', 'jam1', ['s1'])

    const targets = listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], () => true)
    expect(targets).toHaveLength(1)
  })

  it('aggregates across multiple jams', () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1'])
    seedRiff(db, 'r2', 'jam2', ['s2'])

    const targets = listLibraryScanTargets(
      [
        { jamCID: 'jam1', dbForJam: db },
        { jamCID: 'jam2', dbForJam: db }
      ],
      () => true
    )
    expect(targets.map((t) => t.key).sort()).toEqual(['s1', 's2'])
  })

  it("does not throw when a jam's own db lacks Riffs entirely", () => {
    const empty = new Database(':memory:')
    expect(() =>
      listLibraryScanTargets([{ jamCID: 'jamExt', dbForJam: empty }], () => true)
    ).not.toThrow()
    expect(listLibraryScanTargets([{ jamCID: 'jamExt', dbForJam: empty }], () => true)).toEqual([])
  })
})
