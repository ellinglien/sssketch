// src/main/tableCountSeed.test.ts
//
// The archive's row counts known at startup without one long COUNT (faster
// startup plan, docs/superpowers/plans/2026-10-06-faster-startup.md). Opens
// databases, so it is on vitest.config.ts's CI exclusion list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTableSignal } from './tableChangeSignal'
import { readFileFingerprint, seedTableCounts, slicedKeyRangeCount } from './tableCountSeed'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'table-count-seed-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function hex(i: number): string {
  return (i * 2654435761).toString(16).padStart(8, '0').slice(-8) + 'abcdef0123456789abcdef01'
}

/** A LORE-shaped archive (rollback journal, as his is) with `stems` Stems and
 * `riffs` Riffs rows. */
function archive(stems: number, riffs: number): string {
  const path = join(dir, 'archive.db')
  const db = new Database(path)
  db.pragma('journal_mode = DELETE')
  db.exec(`CREATE TABLE Stems (StemCID TEXT NOT NULL UNIQUE, Note TEXT, PRIMARY KEY(StemCID));
           CREATE TABLE Riffs (RiffCID TEXT NOT NULL UNIQUE, Note TEXT, PRIMARY KEY(RiffCID))`)
  const s = db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`)
  const r = db.prepare(`INSERT INTO Riffs (RiffCID) VALUES (?)`)
  db.transaction(() => {
    for (let i = 0; i < stems; i++) s.run(hex(i))
    for (let i = 0; i < riffs; i++) r.run(`r${hex(i)}`)
  })()
  db.close()
  return path
}

function ownDb(): Database.Database {
  return new Database(join(dir, 'own.db'))
}

/** How many full-table counts `db` has run since the spy went on. */
function fullCounts(db: Database.Database): () => number {
  const spy = vi.spyOn(db, 'prepare')
  return () =>
    spy.mock.calls.filter(([sql]) => /COUNT\(\*\) AS n FROM (Stems|Riffs)$/.test(String(sql)))
      .length
}

describe('slicedKeyRangeCount', () => {
  it('equals COUNT(*) for keys of any shape: hex, upper case, numbers, blobs, NULL', async () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE Stems (StemCID TEXT, Note TEXT)`)
    const insert = db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`)
    for (let i = 0; i < 500; i++) insert.run(hex(i))
    for (const odd of [
      '',
      '0',
      'fff',
      'ffff',
      'FFFF',
      'Zebra',
      '~',
      'g',
      '000',
      '0000',
      '9ff',
      'a00'
    ]) {
      insert.run(odd)
    }
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(42)
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(Buffer.from([1, 2, 3]))
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (NULL)`).run()
    const exact = (db.prepare(`SELECT COUNT(*) AS n FROM Stems`).get() as { n: number }).n
    expect(await slicedKeyRangeCount(db, 'Stems')).toBe(exact)
    expect(await slicedKeyRangeCount(db, 'Stems', { hexDigits: 1 })).toBe(exact)
  })
})

describe('readFileFingerprint', () => {
  it('moves with a commit, stays put for reads, and is null for a db with no file', () => {
    const path = archive(10, 10)
    const before = readFileFingerprint(path)
    expect(before).not.toBeNull()
    const ro = new Database(path, { readonly: true })
    ro.prepare(`SELECT COUNT(*) FROM Stems`).get()
    expect(readFileFingerprint(path)).toBe(before)
    const rw = new Database(path)
    rw.prepare(`INSERT INTO Stems (StemCID) VALUES ('x')`).run()
    expect(readFileFingerprint(path)).not.toBe(before)
    expect(readFileFingerprint('')).toBeNull()
    expect(readFileFingerprint(':memory:')).toBeNull()
    expect(readFileFingerprint(join(dir, 'missing.db'))).toBeNull()
  })
})

describe('seedTableCounts', () => {
  it('counts in slices the first time, then reuses the saved count while the file is unchanged', async () => {
    const path = archive(300, 200)
    const own = ownDb()
    const first = new Database(path, { readonly: true })
    const firstCounts = fullCounts(first)
    await seedTableCounts(first, own)
    expect(readTableSignal(first, 'Stems')?.count).toBe(300)
    expect(readTableSignal(first, 'Riffs')?.count).toBe(200)
    expect(firstCounts()).toBe(0)
    first.close()

    // Next launch: a new connection, nothing in memory.
    const second = new Database(path, { readonly: true })
    const prepare = vi.spyOn(second, 'prepare')
    await seedTableCounts(second, own)
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('COUNT(*)'))).toBe(false)
    expect(readTableSignal(second, 'Stems')?.count).toBe(300)
    expect(readTableSignal(second, 'Riffs')?.count).toBe(200)
  })

  it('counts again when the file changed since the saved count (a sync)', async () => {
    const path = archive(300, 200)
    const own = ownDb()
    const first = new Database(path, { readonly: true })
    await seedTableCounts(first, own)
    first.close()
    const rw = new Database(path)
    // A delete below the top and an insert: same MAX(rowid) shape is not enough.
    rw.prepare(`DELETE FROM Stems WHERE rowid = 10`).run()
    rw.prepare(`INSERT INTO Stems (StemCID) VALUES ('zz-new')`).run()
    rw.close()
    const second = new Database(path, { readonly: true })
    const counted = fullCounts(second)
    await seedTableCounts(second, own)
    expect(readTableSignal(second, 'Stems')?.count).toBe(300)
    expect(counted()).toBe(0)
  })

  it('a commit landing during the slices is not primed from a torn count', async () => {
    const path = archive(300, 0)
    const own = ownDb()
    const ro = new Database(path, { readonly: true })
    const rw = new Database(path)
    let committed = 0
    const real = ro.prepare.bind(ro)
    vi.spyOn(ro, 'prepare').mockImplementation(((sql: string) => {
      const stmt = real(sql)
      if (!/WHERE StemCID >= \?/.test(sql) || committed >= 3) return stmt
      // Every slice statement in the first passes is followed by a foreign commit.
      return {
        get: (...args: unknown[]) => {
          const out = stmt.get(...args)
          if (committed < 3) {
            rw.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(`0late${committed++}`)
          }
          return out
        }
      } as unknown as Database.Statement
    }) as typeof ro.prepare)
    await seedTableCounts(ro, own, { tables: ['Stems'], hexDigits: 1 })
    vi.restoreAllMocks()
    // Whatever was primed (or not), the signal is the live truth.
    expect(readTableSignal(ro, 'Stems')?.count).toBe(303)
  })

  it('leaves a read-write connection (the own db) to readTableSignal', async () => {
    const path = archive(5, 5)
    const rw = new Database(path)
    const own = ownDb()
    const prepare = vi.spyOn(rw, 'prepare')
    await seedTableCounts(rw, own)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('a db missing a table seeds the others and never throws', async () => {
    const path = join(dir, 'stems-only.db')
    const db = new Database(path)
    db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY); INSERT INTO Stems VALUES ('a'), ('b')`)
    db.close()
    const ro = new Database(path, { readonly: true })
    await expect(seedTableCounts(ro, ownDb())).resolves.toBeUndefined()
    const counted = fullCounts(ro)
    expect(readTableSignal(ro, 'Stems')?.count).toBe(2)
    expect(counted()).toBe(0)
  })
})
