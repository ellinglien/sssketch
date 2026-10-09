import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { stemJamsForPaths } from './stemJams'

const opened: Database.Database[] = []
function db(rows: [stemCID: string, jamCID: string][]): Database.Database {
  const d = new Database(':memory:')
  opened.push(d)
  d.exec('CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT)')
  const insert = d.prepare('INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, ?)')
  for (const [stemCID, jamCID] of rows) insert.run(stemCID, jamCID)
  return d
}

afterEach(() => {
  for (const d of opened.splice(0)) d.close()
})

describe('stemJamsForPaths', () => {
  it("names each library stem file's jam, by the StemCID its file is named after", () => {
    const own = db([['s1', 'jamA']])
    const archive = db([['s2', 'jamB']])
    expect(
      stemJamsForPaths(
        [own, archive],
        ['/lib/endlesss-cache/stems/s/s1', '/lore/cache/common/stem_v2/jamB/s/s2']
      )
    ).toEqual({
      '/lib/endlesss-cache/stems/s/s1': 'jamA',
      '/lore/cache/common/stem_v2/jamB/s/s2': 'jamB'
    })
  })

  it('leaves out a file no library knows, and anything with an extension (a wav, a copy)', () => {
    const own = db([['s1', 'jamA']])
    expect(
      stemJamsForPaths([own], ['/x/unknown', '/music/s1.wav', '/lib/.bakes/abc.baked.wav'])
    ).toEqual({})
  })

  it('takes the first db that knows the stem', () => {
    expect(stemJamsForPaths([db([['s1', 'jamA']]), db([['s1', 'jamZ']])], ['/a/s1'])).toEqual({
      '/a/s1': 'jamA'
    })
  })

  it('is empty for no paths', () => {
    expect(stemJamsForPaths([db([])], [])).toEqual({})
  })
})
