import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { jamNamesFor, stemJamsForPaths } from './stemJams'

// The riff index's answer (findRiffForStemPath in main): the jam of the riff a stem plays from,
// the same notion every Discover candidate's jamCID carries.
const index =
  (jams: Record<string, string>) =>
  async (path: string): Promise<string | null> =>
    jams[path.slice(path.lastIndexOf('/') + 1)] ?? null

describe('stemJamsForPaths', () => {
  it("names each library stem file's jam, by the StemCID its file is named after", async () => {
    expect(
      await stemJamsForPaths(
        ['/lib/endlesss-cache/stems/s/s1', '/lore/cache/common/stem_v2/jamB/s/s2'],
        index({ s1: 'jamA', s2: 'jamB' })
      )
    ).toEqual({
      '/lib/endlesss-cache/stems/s/s1': 'jamA',
      '/lore/cache/common/stem_v2/jamB/s/s2': 'jamB'
    })
  })

  it('leaves out a file no library knows, and anything with an extension (a wav, a copy)', async () => {
    const asked: string[] = []
    const jams = await stemJamsForPaths(
      ['/x/unknown', '/music/s1.wav', '/lib/.bakes/abc.baked.wav'],
      async (path) => {
        asked.push(path)
        return path.endsWith('/s1.wav') ? 'jamA' : null
      }
    )
    expect(jams).toEqual({})
    expect(asked).toEqual(['/x/unknown'])
  })

  it('asks once per StemCID, and answers every path that names it', async () => {
    let asks = 0
    const jams = await stemJamsForPaths(['/a/s1', '/b/s1'], async () => {
      asks++
      return 'jamA'
    })
    expect(jams).toEqual({ '/a/s1': 'jamA', '/b/s1': 'jamA' })
    expect(asks).toBe(1)
  })

  it('is empty for no paths', async () => {
    expect(await stemJamsForPaths([], index({}))).toEqual({})
  })
})

const opened: Database.Database[] = []
function db(rows: [jamCID: string, name: string][]): Database.Database {
  const d = new Database(':memory:')
  opened.push(d)
  d.exec('CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT)')
  const insert = d.prepare('INSERT INTO Jams (JamCID, PublicName) VALUES (?, ?)')
  for (const [jamCID, name] of rows) insert.run(jamCID, name)
  return d
}

afterEach(() => {
  for (const d of opened.splice(0)) d.close()
})

describe('jamNamesFor', () => {
  it('names each jam from the first db that knows it', () => {
    const archive = db([['jamA', 'night bus']])
    const own = db([
      ['jamA', 'stale name'],
      ['jamB', 'harbour']
    ])
    expect(jamNamesFor([archive, own], ['jamA', 'jamB', 'jamZ'])).toEqual({
      jamA: 'night bus',
      jamB: 'harbour'
    })
  })

  it('skips a db without a Jams table, and asks nothing for no jams', () => {
    const broken = new Database(':memory:')
    opened.push(broken)
    expect(jamNamesFor([broken, db([['jamA', 'night bus']])], ['jamA'])).toEqual({
      jamA: 'night bus'
    })
    expect(jamNamesFor([db([])], [])).toEqual({})
  })
})
