import { describe, it, expect } from 'vitest'
import {
  jamIsMine,
  jamAuthorshipIsKnown,
  filterToMyJams,
  sortJamsByOwnRiffs,
  hiddenJamCount,
  type JamOwnership
} from './jamOwnership'

/** A jam the archive knows the authorship of: every riff in it carries a
 * UserName, `own` of them the target user's. */
function known(own: number): JamOwnership {
  return { ownRiffCount: own, unknownAuthorRiffCount: 0 }
}

/** A jam whose riffs were synced without any author recorded -- the shape
 * sssketch's OWN warehouse has for every privately-synced jam, since the
 * jam listing endpoint carries no per-riff userName (riffLibrarySync.ts). */
function unknown(unknownRiffs: number, own = 0): JamOwnership {
  return { ownRiffCount: own, unknownAuthorRiffCount: unknownRiffs }
}

describe('jamIsMine', () => {
  it('is true for a jam with at least one riff by the target user', () => {
    expect(jamIsMine(known(1))).toBe(true)
  })

  it('is false for a jam the archive says has none of their riffs', () => {
    expect(jamIsMine(known(0))).toBe(false)
  })

  it('is false when no counts were asked for at all', () => {
    expect(jamIsMine({})).toBe(false)
  })
})

describe('jamAuthorshipIsKnown', () => {
  it('is true only when counts exist and every riff carries an author', () => {
    expect(jamAuthorshipIsKnown(known(0))).toBe(true)
    expect(jamAuthorshipIsKnown(known(12))).toBe(true)
  })

  it('is false when some riffs have no author recorded', () => {
    expect(jamAuthorshipIsKnown(unknown(5))).toBe(false)
  })

  it('is false when the jam carries no counts -- a live membership entry, or a list asked for without a username', () => {
    expect(jamAuthorshipIsKnown({})).toBe(false)
    expect(jamAuthorshipIsKnown({ ownRiffCount: 3 })).toBe(false)
  })
})

describe('filterToMyJams', () => {
  it('keeps jams the user has riffs in', () => {
    const jams = [known(10), known(0), known(3)]
    expect(filterToMyJams(jams)).toEqual([known(10), known(3)])
  })

  it('drops a jam only when the archive positively says none of its riffs are theirs', () => {
    expect(filterToMyJams([known(0)])).toEqual([])
  })

  it('never hides a jam whose authorship is unknown -- degrading to "show it" rather than hiding everything', () => {
    const jams = [unknown(400), known(0), known(2)]
    expect(filterToMyJams(jams)).toEqual([unknown(400), known(2)])
  })

  it('never hides a jam that carries no counts at all (a live Endlesss membership entry -- one he is a member of by definition)', () => {
    const jams = [{ jamCID: 'band1' }, { jamCID: 'band2', ...known(0) }]
    expect(filterToMyJams(jams)).toEqual([{ jamCID: 'band1' }])
  })

  it('leaves an entirely authorless library completely untouched', () => {
    const jams = [unknown(1), unknown(2), unknown(3)]
    expect(filterToMyJams(jams)).toEqual(jams)
  })
})

describe('hiddenJamCount', () => {
  it('counts what the filter would drop, so the toggle can say so honestly', () => {
    expect(hiddenJamCount([known(10), known(0), known(0), unknown(9)])).toBe(2)
  })

  it('is zero when nothing can be hidden, which is what an authorless library looks like', () => {
    expect(hiddenJamCount([unknown(9), unknown(1), {}])).toBe(0)
  })
})

describe('sortJamsByOwnRiffs', () => {
  it('puts the jams with the most of the user’s own riffs first', () => {
    const a = { lastRiffTime: 1, ...known(5) }
    const b = { lastRiffTime: 2, ...known(500) }
    const c = { lastRiffTime: 3, ...known(50) }
    expect(sortJamsByOwnRiffs([a, b, c])).toEqual([b, c, a])
  })

  it('falls back to most-recent-riff-first among jams with the same count', () => {
    const older = { lastRiffTime: 100, ...known(0) }
    const newer = { lastRiffTime: 900, ...known(0) }
    expect(sortJamsByOwnRiffs([older, newer])).toEqual([newer, older])
  })

  it('treats a jam with no counts as zero rather than dropping it to the end of time', () => {
    const uncounted = { lastRiffTime: 900 }
    const counted = { lastRiffTime: 100, ...known(0) }
    expect(sortJamsByOwnRiffs([counted, uncounted])).toEqual([uncounted, counted])
  })

  it('does not mutate the list it was given', () => {
    const jams = [
      { lastRiffTime: 1, ...known(1) },
      { lastRiffTime: 2, ...known(9) }
    ]
    const before = [...jams]
    sortJamsByOwnRiffs(jams)
    expect(jams).toEqual(before)
  })
})
