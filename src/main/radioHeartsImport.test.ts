import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredMemberInput } from './discoveredLibrary'
import type { FetchLike } from './radioHeartsImport'
import {
  RADIO_HEARTS_URL,
  heartRiffName,
  type RadioHeartCombo,
  type RadioStemLike
} from '@shared/radioHearts'
import { friendlyRiffName } from '@shared/friendlyRiffName'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

/** The two tables this module writes, copied from riffLibrarySchema.ts --
 * the same "paste the DDL" convention as discoveredLibrary.test.ts. */
function freshOwnDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemFavourite (StemCID TEXT PRIMARY KEY, FavouritedAt INTEGER NOT NULL);
    CREATE TABLE RadioHeartImport (
      Combo TEXT PRIMARY KEY, RiffCID TEXT NOT NULL, Name TEXT NOT NULL, ImportedAt INTEGER NOT NULL
    );
    CREATE TABLE RadioLikeImport (Stem TEXT PRIMARY KEY, ImportedAt INTEGER NOT NULL);
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL, Instrument INTEGER,
      Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
  `)
  return db
}

function heart(stems: string[], count = 2): RadioHeartCombo {
  const sorted = [...stems].sort()
  return { combo: sorted.join(','), stems: sorted, bpm: 120, loopBars: 4, count, first: 1, last: 2 }
}

/** A fake hearts.json that records what it was asked. */
function fakeFetch(
  hearts: RadioHeartCombo[],
  status = 200,
  likes?: RadioStemLike[]
): FetchLike & { calls: unknown[] } {
  const calls: unknown[] = []
  const fn = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      // No `likes` key at all unless a test passes some -- the older
      // server's exact shape.
      json: async () =>
        status === 200 ? { generated: 'x', hearts, ...(likes ? { likes } : {}) } : { ok: false }
    }
  }) as FetchLike & { calls: unknown[] }
  fn.calls = calls
  return fn
}

function member(stemCID: string): DiscoveredMemberInput {
  return {
    path: `/x/${stemCID}`,
    gain: 1,
    name: stemCID,
    author: 'elling',
    barLength: 4,
    durationSec: 8
  }
}

/** A save that behaves like saveDiscoveredRifff: a new riff per new stem set. */
function fakeSave(): {
  save: (
    m: DiscoveredMemberInput[],
    bpm: number,
    bars: number
  ) => {
    riffCID: string
    name: string
    duplicate: boolean
  }
  saved: { stems: string[]; bpm: number; bars: number }[]
} {
  const saved: { stems: string[]; bpm: number; bars: number }[] = []
  return {
    saved,
    save: (members, bpm, bars) => {
      saved.push({ stems: members.map((m) => m.name), bpm, bars })
      const riffCID = `discovered-${saved.length}0000000`
      return { riffCID, name: `misty kestrel ${riffCID.slice(0, 8)} library`, duplicate: false }
    }
  }
}

describe('fetchRadioHearts', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-radio-hearts-test-'))
  })

  afterEach(async () => {
    const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
    setRiffLibraryRootForTests(null)
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('sends the key as a bearer token to the private endpoint', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const fetch = fakeFetch([])
    await fetchRadioHearts({
      key: 'sekrit',
      fetch,
      ownDb: freshOwnDb(),
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save
    })
    expect(fetch.calls).toEqual([
      { url: RADIO_HEARTS_URL, init: { headers: { authorization: 'Bearer sekrit' } } }
    ])
  })

  it('does not call out at all without a key', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const fetch = fakeFetch([])
    const result = await fetchRadioHearts({
      key: null,
      fetch,
      ownDb: freshOwnDb(),
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save
    })
    expect(result).toEqual({ ok: false, reason: 'no key' })
    expect(fetch.calls).toEqual([])
  })

  it('reports a 401 as a refused key and writes nothing', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const result = await fetchRadioHearts({
      key: 'wrong',
      fetch: fakeFetch([heart(['a', 'b'])], 401),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save
    })
    expect(result).toEqual({ ok: false, reason: 'key refused' })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM RadioHeartImport`).get()).toEqual({ n: 0 })
  })

  it('reports a network failure as unreachable', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: async () => {
        throw new Error('ENOTFOUND')
      },
      ownDb: freshOwnDb(),
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save,
      log: () => {}
    })
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('keeps each new combo at its own bpm and loop bars, named for its hearts', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save, saved } = fakeSave()
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([{ ...heart(['a', 'b'], 3), bpm: 96, loopBars: 8 }]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save
    })
    expect(saved).toEqual([{ stems: ['a', 'b'], bpm: 96, bars: 8 }])
    expect(result).toMatchObject({ ok: true, kept: 1, favourited: 2 })
    expect(db.prepare(`SELECT Combo, RiffCID, Name FROM RadioHeartImport`).all()).toEqual([
      {
        Combo: 'a,b',
        RiffCID: 'discovered-10000000',
        Name: heartRiffName(3, friendlyRiffName('discovered-10000000'))
      }
    ])
  })

  it('skips combos it already fetched, and never writes a duplicate favourite', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save, saved } = fakeSave()
    const deps = { key: 'k', ownDb: db, archiveReachable: () => true, resolveStem: member, save }

    await fetchRadioHearts({ ...deps, fetch: fakeFetch([heart(['a', 'b'])]) })
    const second = await fetchRadioHearts({
      ...deps,
      fetch: fakeFetch([heart(['a', 'b']), heart(['b', 'c'])])
    })

    expect(saved.map((s) => s.stems)).toEqual([
      ['a', 'b'],
      ['b', 'c']
    ])
    expect(second).toMatchObject({ ok: true, kept: 1, skipped: 1, favourited: 1 })
    const favs = db.prepare(`SELECT StemCID FROM StemFavourite ORDER BY StemCID`).all()
    expect(favs).toEqual([{ StemCID: 'a' }, { StemCID: 'b' }, { StemCID: 'c' }])

    const third = await fetchRadioHearts({
      ...deps,
      fetch: fakeFetch([heart(['a', 'b']), heart(['b', 'c'])])
    })
    expect(third).toMatchObject({ ok: true, kept: 0, skipped: 2, favourited: 0 })
    expect(saved).toHaveLength(2)
  })

  it('does not re-star a stem he un-starred, from a combo already fetched', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const { toggleStemFavourite } = await import('./stemFavouriteStore')
    const db = freshOwnDb()
    const deps = {
      key: 'k',
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save
    }
    await fetchRadioHearts({ ...deps, fetch: fakeFetch([heart(['a', 'b'])]) })
    toggleStemFavourite(db, 'a')
    await fetchRadioHearts({ ...deps, fetch: fakeFetch([heart(['a', 'b'])]) })
    expect(db.prepare(`SELECT StemCID FROM StemFavourite`).all()).toEqual([{ StemCID: 'b' }])
  })

  it('records a combo whose stem set was already kept, so it is not tried again', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: () => ({
        riffCID: 'discovered-old',
        name: 'pale ibis discove library',
        duplicate: true
      })
    })
    expect(result).toMatchObject({ ok: true, kept: 0, alreadyKept: 1 })
    expect(db.prepare(`SELECT Combo, RiffCID FROM RadioHeartImport`).all()).toEqual([
      { Combo: 'a,b', RiffCID: 'discovered-old' }
    ])
  })

  it('leaves a combo with too few local stems unsaved and unrecorded, and logs the missing', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save, saved } = fakeSave()
    const lines: string[] = []
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'gone'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: (id) => (id === 'gone' ? null : member(id)),
      save,
      log: (line) => lines.push(line)
    })
    expect(saved).toEqual([])
    expect(result).toMatchObject({ ok: true, kept: 0, tooFew: 1, missingStems: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM RadioHeartImport`).get()).toEqual({ n: 0 })
    expect(lines.join('\n')).toContain('gone')
  })

  it('carries on past a combo whose save throws, without recording it', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save } = fakeSave()
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b']), heart(['c', 'd'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: (m, bpm, bars) => {
        if (m[0].name === 'a') throw new Error('disk full')
        return save(m, bpm, bars)
      },
      log: () => {}
    })
    expect(result).toMatchObject({ ok: true, kept: 1 })
    expect(db.prepare(`SELECT Combo FROM RadioHeartImport`).all()).toEqual([{ Combo: 'c,d' }])
  })

  it('refreshes the heart count of a combo already fetched, without keeping it again', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save, saved } = fakeSave()
    const deps = { key: 'k', ownDb: db, archiveReachable: () => true, resolveStem: member, save }
    await fetchRadioHearts({ ...deps, fetch: fakeFetch([heart(['a', 'b'], 2)]) })
    const again = await fetchRadioHearts({ ...deps, fetch: fakeFetch([heart(['a', 'b'], 7)]) })
    expect(saved).toHaveLength(1)
    expect(again).toMatchObject({ ok: true, kept: 0, skipped: 1 })
    expect(db.prepare(`SELECT Name FROM RadioHeartImport`).get()).toEqual({
      Name: heartRiffName(7, friendlyRiffName('discovered-10000000'))
    })
  })

  it('rolls a combo back whole when starring fails partway -- no record, no stars', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    // 'a' goes in, then 'b' blows up: the transaction must take 'a' AND
    // the combo's record back out with it.
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON StemFavourite WHEN NEW.StemCID = 'b'
             BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    const lines: string[] = []
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b']), heart(['c', 'd'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save,
      log: (line) => lines.push(line)
    })
    expect(result).toMatchObject({ ok: true, kept: 1, favourited: 2 })
    expect(db.prepare(`SELECT Combo FROM RadioHeartImport`).all()).toEqual([{ Combo: 'c,d' }])
    expect(db.prepare(`SELECT StemCID FROM StemFavourite ORDER BY StemCID`).all()).toEqual([
      { StemCID: 'c' },
      { StemCID: 'd' }
    ])
    expect(lines.join('\n')).toContain('boom')
  })

  it('rolls a combo back whole when recording it fails -- its stars never land', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON RadioHeartImport WHEN NEW.Combo = 'a,b'
             BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save,
      log: () => {}
    })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM RadioHeartImport`).get()).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemFavourite`).get()).toEqual({ n: 0 })
  })

  it('does not star the stems of a combo whose save fails', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: () => {
        throw new Error('disk full')
      },
      log: () => {}
    })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemFavourite`).get()).toEqual({ n: 0 })
  })

  it('refuses the whole import, before any call, when the archive is not mounted', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const fetch = fakeFetch([heart(['a', 'b'])])
    const { save, saved } = fakeSave()
    const result = await fetchRadioHearts({
      key: 'k',
      fetch,
      ownDb: db,
      archiveReachable: () => false,
      resolveStem: member,
      save
    })
    expect(result).toEqual({ ok: false, reason: 'archive not mounted' })
    expect(fetch.calls).toEqual([])
    expect(saved).toEqual([])
    expect(db.prepare(`SELECT COUNT(*) AS n FROM RadioHeartImport`).get()).toEqual({ n: 0 })
  })

  it('reports a body that is not JSON as a bad response', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        }
      }),
      ownDb: freshOwnDb(),
      archiveReachable: () => true,
      resolveStem: member,
      save: fakeSave().save
    })
    expect(result).toEqual({ ok: false, reason: 'bad response' })
  })

  it('turns anything unexpected into import failed, never a throw', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b'])]),
      ownDb: freshOwnDb(),
      archiveReachable: () => true,
      resolveStem: () => {
        throw new Error('db closed')
      },
      save: fakeSave().save,
      log: () => {}
    })
    expect(result).toEqual({ ok: false, reason: 'import failed' })
  })

  it('leaves a combo whose save returns nothing unrecorded', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: member,
      save: () => null,
      log: () => {}
    })
    expect(result).toMatchObject({ ok: true, kept: 0, favourited: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM RadioHeartImport`).get()).toEqual({ n: 0 })
  })

  it('keeps and records a combo short a stem, when 2 or more remain', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save, saved } = fakeSave()
    const result = await fetchRadioHearts({
      key: 'k',
      fetch: fakeFetch([heart(['a', 'b', 'gone'])]),
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: (id) => (id === 'gone' ? null : member(id)),
      save,
      log: () => {}
    })
    expect(saved.map((s) => s.stems)).toEqual([['a', 'b']])
    expect(result).toMatchObject({ ok: true, kept: 1, favourited: 2, missingStems: 1 })
    expect(db.prepare(`SELECT Combo FROM RadioHeartImport`).all()).toEqual([{ Combo: 'a,b,gone' }])
  })

  describe('likes', () => {
    const like = (stem: string): RadioStemLike => ({ stem, count: 2, first: 1, last: 2 })
    const deps = (db: Database.Database) => ({
      key: 'k',
      ownDb: db,
      archiveReachable: () => true,
      resolveStem: (id: string) => (id === 'gone' ? null : member(id)),
      save: fakeSave().save,
      log: () => {}
    })
    const starred = (db: Database.Database): string[] =>
      (
        db.prepare(`SELECT StemCID FROM StemFavourite ORDER BY StemCID`).all() as {
          StemCID: string
        }[]
      ).map((r) => r.StemCID)

    it('stars each liked stem once, and counts it with the rest', async () => {
      const { fetchRadioHearts } = await import('./radioHeartsImport')
      const db = freshOwnDb()
      const result = await fetchRadioHearts({
        ...deps(db),
        fetch: fakeFetch([heart(['a', 'b'])], 200, [like('x'), like('y')])
      })
      expect(result).toMatchObject({ ok: true, kept: 1, favourited: 4, likes: 2 })
      expect(starred(db)).toEqual(['a', 'b', 'x', 'y'])
      const again = await fetchRadioHearts({
        ...deps(db),
        fetch: fakeFetch([], 200, [like('x'), like('y')])
      })
      expect(again).toMatchObject({ ok: true, favourited: 0, likes: 0 })
    })

    it('never re-stars a liked stem he un-starred', async () => {
      const { fetchRadioHearts } = await import('./radioHeartsImport')
      const { toggleStemFavourite } = await import('./stemFavouriteStore')
      const db = freshOwnDb()
      await fetchRadioHearts({ ...deps(db), fetch: fakeFetch([], 200, [like('x')]) })
      toggleStemFavourite(db, 'x')
      await fetchRadioHearts({ ...deps(db), fetch: fakeFetch([], 200, [like('x')]) })
      expect(starred(db)).toEqual([])
    })

    it('tolerates a response with no likes field at all', async () => {
      const { fetchRadioHearts } = await import('./radioHeartsImport')
      const db = freshOwnDb()
      const result = await fetchRadioHearts({ ...deps(db), fetch: fakeFetch([heart(['a', 'b'])]) })
      expect(result).toMatchObject({ ok: true, kept: 1, likes: 0 })
    })

    it('skips a liked stem without local audio, leaving it unrecorded for next time', async () => {
      const { fetchRadioHearts } = await import('./radioHeartsImport')
      const db = freshOwnDb()
      const result = await fetchRadioHearts({
        ...deps(db),
        fetch: fakeFetch([], 200, [like('x'), like('gone')])
      })
      expect(result).toMatchObject({ ok: true, favourited: 1, likes: 1, missingStems: 1 })
      expect(starred(db)).toEqual(['x'])
      expect(db.prepare(`SELECT Stem FROM RadioLikeImport`).all()).toEqual([{ Stem: 'x' }])
    })

    it('records a like for a stem already starred, so a later un-star is final', async () => {
      const { fetchRadioHearts } = await import('./radioHeartsImport')
      const { toggleStemFavourite } = await import('./stemFavouriteStore')
      const db = freshOwnDb()
      toggleStemFavourite(db, 'x')
      const result = await fetchRadioHearts({ ...deps(db), fetch: fakeFetch([], 200, [like('x')]) })
      expect(result).toMatchObject({ ok: true, favourited: 0, likes: 1 })
      toggleStemFavourite(db, 'x')
      await fetchRadioHearts({ ...deps(db), fetch: fakeFetch([], 200, [like('x')]) })
      expect(starred(db)).toEqual([])
    })

    it('rolls the likes back whole if starring them fails partway', async () => {
      const { fetchRadioHearts } = await import('./radioHeartsImport')
      const db = freshOwnDb()
      db.exec(`CREATE TRIGGER boom BEFORE INSERT ON StemFavourite WHEN NEW.StemCID = 'y'
               BEGIN SELECT RAISE(ABORT, 'boom'); END`)
      const result = await fetchRadioHearts({
        ...deps(db),
        fetch: fakeFetch([], 200, [like('x'), like('y')])
      })
      expect(result).toMatchObject({ ok: true, favourited: 0, likes: 0 })
      expect(starred(db)).toEqual([])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM RadioLikeImport`).get()).toEqual({ n: 0 })
    })
  })

  it('resolveHeartStem finds local audio and the stem’s own loop length', async () => {
    const { resolveHeartStem } = await import('./radioHeartsImport')
    const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
    const { ownRiffLibraryRoot } = await import('./riffLibrarySchema')
    setRiffLibraryRootForTests(ownRiffLibraryRoot())
    const db = freshOwnDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, BPMrnd, Length16s, PresetName, CreatorUserName)
       VALUES ('abc123', 'j1', 120, 32, 'thud', 'elling'), ('def456', 'j1', 120, 16, 'hiss', 'elling')`
    ).run()
    const dir = join(userDataDir, 'endlesss-cache', 'stems', 'a')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'abc123'), Buffer.from([1]))

    expect(resolveHeartStem('abc123', [db])).toEqual({
      path: join(dir, 'abc123'),
      gain: 1,
      name: 'thud',
      author: 'elling',
      barLength: 2,
      durationSec: 4
    })
    // Row, but no audio on disk.
    expect(resolveHeartStem('def456', [db])).toBeNull()
    // No row at all.
    expect(resolveHeartStem('nope', [db])).toBeNull()
  })
})
