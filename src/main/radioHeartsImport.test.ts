import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredMemberInput } from './discoveredLibrary'
import type { FetchLike } from './radioHeartsImport'
import { RADIO_HEARTS_URL, type RadioHeartCombo } from '@shared/radioHearts'

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
function fakeFetch(hearts: RadioHeartCombo[], status = 200): FetchLike & { calls: unknown[] } {
  const calls: unknown[] = []
  const fn = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (status === 200 ? { generated: 'x', hearts } : { ok: false })
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
      resolveStem: member,
      save
    })
    expect(saved).toEqual([{ stems: ['a', 'b'], bpm: 96, bars: 8 }])
    expect(result).toMatchObject({ ok: true, kept: 1, favourited: 2 })
    expect(db.prepare(`SELECT Combo, RiffCID, Name FROM RadioHeartImport`).all()).toEqual([
      { Combo: 'a,b', RiffCID: 'discovered-10000000', Name: '♥ 3 · misty kestrel' }
    ])
  })

  it('skips combos it already fetched, and never writes a duplicate favourite', async () => {
    const { fetchRadioHearts } = await import('./radioHeartsImport')
    const db = freshOwnDb()
    const { save, saved } = fakeSave()
    const deps = { key: 'k', ownDb: db, resolveStem: member, save }

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
    const deps = { key: 'k', ownDb: db, resolveStem: member, save: fakeSave().save }
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
