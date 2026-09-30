import { describe, expect, it } from 'vitest'
import {
  heartFetchLabel,
  heartRiffName,
  parseHeartsResponse,
  planHeartImport,
  type RadioHeartCombo
} from './radioHearts'

function heart(stems: string[], count = 1): RadioHeartCombo {
  const sorted = [...stems].sort()
  return {
    combo: sorted.join(','),
    stems: sorted,
    bpm: 120,
    loopBars: 4,
    count,
    first: 1,
    last: 2
  }
}

/** Every stem resolves to itself unless it is named in `missing`. */
function resolver(missing: string[] = []): (stemCID: string) => string | null {
  return (stemCID) => (missing.includes(stemCID) ? null : stemCID)
}

describe('planHeartImport', () => {
  it('keeps a new combo with all its stems resolved', () => {
    const plan = planHeartImport([heart(['a', 'b'])], new Set(), new Set(), resolver())
    expect(plan.combosToKeep).toHaveLength(1)
    expect(plan.combosToKeep[0].members).toEqual(['a', 'b'])
    expect(plan.combosToKeep[0].stars).toEqual(['a', 'b'])
    expect(plan.favouritesToAdd).toEqual(['a', 'b'])
  })

  it('skips combos already imported, and takes no favourites from them', () => {
    const plan = planHeartImport(
      [heart(['a', 'b']), heart(['c', 'd'])],
      new Set(['a,b']),
      new Set(),
      resolver()
    )
    expect(plan.combosToKeep.map((c) => c.heart.combo)).toEqual(['c,d'])
    expect(plan.alreadyImported.map((h) => h.combo)).toEqual(['a,b'])
    // A stem he has since un-starred stays un-starred.
    expect(plan.favouritesToAdd).toEqual(['c', 'd'])
  })

  it('does not re-add favourites that already exist, nor add one twice', () => {
    const plan = planHeartImport(
      [heart(['a', 'b']), heart(['b', 'c'])],
      new Set(),
      new Set(['a']),
      resolver()
    )
    expect(plan.combosToKeep.map((c) => c.stars)).toEqual([['b'], ['b', 'c']])
    expect(plan.favouritesToAdd).toEqual(['b', 'c'])
  })

  it('drops a combo left with fewer than 2 resolvable stems', () => {
    const plan = planHeartImport(
      [heart(['a', 'b']), heart(['c', 'd', 'e'])],
      new Set(),
      new Set(),
      resolver(['b', 'd'])
    )
    expect(plan.combosToKeep.map((c) => c.heart.combo)).toEqual(['c,d,e'])
    expect(plan.combosToKeep[0].members).toEqual(['c', 'e'])
    expect(plan.combosToKeep[0].missing).toEqual(['d'])
    expect(plan.tooFew.map((c) => c.heart.combo)).toEqual(['a,b'])
    expect(plan.missingStems).toEqual(['b', 'd'])
  })

  it('never favourites a stem without local audio', () => {
    const plan = planHeartImport([heart(['a', 'b', 'c'])], new Set(), new Set(), resolver(['c']))
    expect(plan.favouritesToAdd).toEqual(['a', 'b'])
  })

  it('does not star the stem of a combo too small to keep', () => {
    const plan = planHeartImport([heart(['a', 'b'])], new Set(), new Set(), resolver(['b']))
    expect(plan.combosToKeep).toEqual([])
    expect(plan.tooFew[0].stars).toEqual([])
    expect(plan.favouritesToAdd).toEqual([])
  })

  it('resolves each stem once, however many combos share it', () => {
    const calls: string[] = []
    planHeartImport([heart(['a', 'b']), heart(['a', 'c'])], new Set(), new Set(), (id) => {
      calls.push(id)
      return id
    })
    expect(calls.sort()).toEqual(['a', 'b', 'c'])
  })

  it('treats a combo repeated in one response as one', () => {
    const plan = planHeartImport(
      [heart(['a', 'b']), heart(['a', 'b'])],
      new Set(),
      new Set(),
      resolver()
    )
    expect(plan.combosToKeep).toHaveLength(1)
  })
})

describe('parseHeartsResponse', () => {
  it('reads the server shape', () => {
    const body = {
      generated: '2026-09-30T00:00:00.000Z',
      hearts: [
        { combo: 'a,b', stems: ['a', 'b'], bpm: 120, loopBars: 4, count: 3, first: 1, last: 2 }
      ]
    }
    expect(parseHeartsResponse(body)).toEqual(body.hearts)
  })

  it('returns null for something that is not a hearts response', () => {
    expect(parseHeartsResponse(null)).toBeNull()
    expect(parseHeartsResponse({ ok: false })).toBeNull()
  })

  it('drops malformed rows rather than the whole response', () => {
    const good = {
      combo: 'a,b',
      stems: ['a', 'b'],
      bpm: 120,
      loopBars: 4,
      count: 1,
      first: 1,
      last: 1
    }
    const parsed = parseHeartsResponse({
      hearts: [good, { combo: 'x', stems: 'nope' }, { ...good, bpm: 0 }, { ...good, loopBars: -1 }]
    })
    expect(parsed).toEqual([good])
  })
})

describe('heartRiffName', () => {
  it('leads with the heart count, then the friendly pair', () => {
    expect(heartRiffName(3, 'misty kestrel 1a2b3c4d library')).toBe('♥ 3 · misty kestrel')
  })
})

describe('heartFetchLabel', () => {
  const zero = { kept: 0, alreadyKept: 0, skipped: 0, tooFew: 0, favourited: 0, missingStems: 0 }
  it('says what happened, tersely and in lowercase', () => {
    expect(heartFetchLabel({ ok: true, ...zero, kept: 2, favourited: 5 })).toBe(
      '♥ 2 kept · 5 starred'
    )
    expect(heartFetchLabel({ ok: true, ...zero, skipped: 4 })).toBe('nothing new')
    expect(heartFetchLabel({ ok: false, reason: 'no key' })).toBe('no key · see settings')
    expect(heartFetchLabel({ ok: false, reason: 'archive not mounted' })).toBe(
      'archive not mounted'
    )
    expect(heartFetchLabel({ ok: false, reason: 'bad response' })).toBe('bad response')
    expect(heartFetchLabel({ ok: false, reason: 'import failed' })).toBe('import failed')
    expect(heartFetchLabel({ ok: false, reason: 'key refused' })).toBe('key refused')
    expect(heartFetchLabel({ ok: false, reason: 'unreachable' })).toBe('radio unreachable')
  })
})
