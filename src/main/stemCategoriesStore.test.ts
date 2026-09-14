import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => musicDir
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
  `)
  return db
}

describe('stemCategoriesStore', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-stemcategories-test-'))
  })

  afterEach(() => {
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('resolveSourceProjectPath', () => {
    it('resolves a library-kind project ref to its real .sssketchproj path', async () => {
      const { resolveSourceProjectPath } = await import('./stemCategoriesStore')
      const result = resolveSourceProjectPath({ kind: 'library', name: 'my-sketch' })
      expect(result).toBe(
        join(musicDir, 'sssketch', 'projects', 'my-sketch', 'my-sketch.sssketchproj')
      )
    })

    it('passes an external-kind project ref straight through', async () => {
      const { resolveSourceProjectPath } = await import('./stemCategoriesStore')
      expect(resolveSourceProjectPath({ kind: 'external', path: '/tmp/foo.sssketchproj' })).toBe(
        '/tmp/foo.sssketchproj'
      )
    })

    it('resolves null to null', async () => {
      const { resolveSourceProjectPath } = await import('./stemCategoriesStore')
      expect(resolveSourceProjectPath(null)).toBe(null)
    })
  })

  describe('upsertStemCategoryBus', () => {
    it('writes a BusId row for a stem whose path basename matches a real StemCID', async () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, getStemCategory } = await import('./stemCategoriesStore')
      upsertStemCategoryBus(
        db,
        [{ path: '/library/stems/cid-1', busId: 'drums' }],
        'tidyup',
        null,
        1000
      )
      const row = getStemCategory(db, 'cid-1')
      expect(row).toEqual({
        stemCID: 'cid-1',
        arrangeRole: null,
        drumSubRole: null,
        busId: 'drums',
        source: 'tidyup',
        sourceProject: null,
        updatedAt: 1000
      })
    })

    it('skips a stem whose path basename does not match any real StemCID', async () => {
      const db = freshDb()
      const { upsertStemCategoryBus, getStemCategory } = await import('./stemCategoriesStore')
      upsertStemCategoryBus(
        db,
        [{ path: '/some/local/one-shot.wav', busId: 'drums' }],
        'tidyup',
        null,
        1000
      )
      expect(getStemCategory(db, 'one-shot.wav')).toBe(null)
    })

    it('a newer write overwrites BusId, but an older write does not', async () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, getStemCategory } = await import('./stemCategoriesStore')
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'drums' }], 'tidyup', null, 2000)
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'bass' }], 'backfill', null, 1000)
      expect(getStemCategory(db, 'cid-1')?.busId).toBe('drums')
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'lead' }], 'tidyup', null, 3000)
      expect(getStemCategory(db, 'cid-1')?.busId).toBe('lead')
    })

    it('a bus write never touches an existing ArrangeRole/DrumSubRole on the same row', async () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, upsertStemCategoryRole, getStemCategory } =
        await import('./stemCategoriesStore')
      upsertStemCategoryRole(
        db,
        [{ path: '/x/cid-1', arrangeRole: 'lead', drumSubRole: undefined }],
        'autoarrange',
        null,
        1000
      )
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'drums' }], 'tidyup', null, 2000)
      const row = getStemCategory(db, 'cid-1')
      expect(row?.arrangeRole).toBe('lead')
      expect(row?.busId).toBe('drums')
    })
  })

  describe('upsertStemCategoryRole', () => {
    it('writes ArrangeRole/DrumSubRole without touching an existing BusId', async () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryBus, upsertStemCategoryRole, getStemCategory } =
        await import('./stemCategoriesStore')
      upsertStemCategoryBus(db, [{ path: '/x/cid-1', busId: 'drums' }], 'tidyup', null, 1000)
      upsertStemCategoryRole(
        db,
        [{ path: '/x/cid-1', arrangeRole: 'drums', drumSubRole: 'kick' }],
        'autoarrange',
        '/some/project.sssketchproj',
        2000
      )
      const row = getStemCategory(db, 'cid-1')
      expect(row).toEqual({
        stemCID: 'cid-1',
        arrangeRole: 'drums',
        drumSubRole: 'kick',
        busId: 'drums',
        source: 'autoarrange',
        sourceProject: '/some/project.sssketchproj',
        updatedAt: 2000
      })
    })

    it('an omitted drumSubRole is stored as null, not undefined/absent', async () => {
      const db = freshDb()
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
      const { upsertStemCategoryRole, getStemCategory } = await import('./stemCategoriesStore')
      upsertStemCategoryRole(
        db,
        [{ path: '/x/cid-1', arrangeRole: 'bass', drumSubRole: undefined }],
        'drawarrange',
        null,
        1000
      )
      expect(getStemCategory(db, 'cid-1')?.drumSubRole).toBe(null)
    })
  })

  describe('getStemCategory', () => {
    it('returns null for a StemCID with no row', async () => {
      const db = freshDb()
      const { getStemCategory } = await import('./stemCategoriesStore')
      expect(getStemCategory(db, 'nonexistent')).toBe(null)
    })
  })

  describe('extraCandidateDbs', () => {
    it('validates a stem via an extra candidate db when the primary db does not have it', async () => {
      const db = freshDb()
      const externalDb = freshDb()
      externalDb.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-external')
      const { upsertStemCategoryBus, getStemCategory } = await import('./stemCategoriesStore')
      upsertStemCategoryBus(
        db,
        [{ path: '/lore-archive/cid-external', busId: 'drums' }],
        'tidyup',
        null,
        1000,
        [externalDb]
      )
      // The row is written into `db` (the primary/own warehouse), even
      // though the StemCID was only validated against `externalDb`.
      expect(getStemCategory(db, 'cid-external')?.busId).toBe('drums')
    })

    it('skips a stem not found in the primary db or any extra candidate db', async () => {
      const db = freshDb()
      const externalDb = freshDb()
      const { upsertStemCategoryBus, getStemCategory } = await import('./stemCategoriesStore')
      upsertStemCategoryBus(
        db,
        [{ path: '/local/one-shot.wav', busId: 'drums' }],
        'tidyup',
        null,
        1000,
        [externalDb]
      )
      expect(getStemCategory(db, 'one-shot.wav')).toBe(null)
    })
  })
})
