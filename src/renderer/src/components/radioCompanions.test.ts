import { describe, expect, it } from 'vitest'
import {
  radioChangeLengths,
  radioCompanionCap,
  radioCompanionsRiding,
  radioUsableCompanionPicks
} from './radioCompanions'

describe('radioCompanionCap', () => {
  it('is rows less radio’s own, rounded up: a fractional row may still ride', () => {
    expect(radioCompanionCap({ rows: 1, fold: false })).toBe(0)
    expect(radioCompanionCap({ rows: 1.3, fold: false })).toBe(1)
    expect(radioCompanionCap({ rows: 4, fold: false })).toBe(3)
  })
  it('is none while fold is on', () => {
    expect(radioCompanionCap({ rows: 4, fold: true })).toBe(0)
  })
})

describe('radioCompanionsRiding', () => {
  const ks = [{ slotId: 'b' }, { slotId: 'c' }, { slotId: 'd' }]
  const base = { primarySlotId: 'a', eligible: ['a', 'b', 'c', 'd'], manual: new Set<string>() }
  it('keeps them in order, up to the cap', () => {
    expect(radioCompanionsRiding(ks, { ...base, max: 3 })).toEqual(ks)
    expect(radioCompanionsRiding(ks, { ...base, max: 1 })).toEqual([{ slotId: 'b' }])
    expect(radioCompanionsRiding(ks, { ...base, max: 0 })).toEqual([])
  })
  it('drops an ineligible row (held, locked, muted, gone) and one a manual change waits on', () => {
    expect(
      radioCompanionsRiding(ks, {
        ...base,
        eligible: ['a', 'c', 'd'],
        manual: new Set(['d']),
        max: 3
      })
    ).toEqual([{ slotId: 'c' }])
  })
  it('drops radio’s own row and a second entry for one row', () => {
    expect(
      radioCompanionsRiding([{ slotId: 'a' }, { slotId: 'b' }, { slotId: 'b' }], {
        ...base,
        max: 3
      })
    ).toEqual([{ slotId: 'b' }])
  })
  it('a dropped one frees its place under the cap', () => {
    expect(radioCompanionsRiding(ks, { ...base, eligible: ['a', 'c', 'd'], max: 1 })).toEqual([
      { slotId: 'c' }
    ])
  })
})

describe('radioUsableCompanionPicks', () => {
  const pick = (stemCID: string | null): { candidate: { stemCID: string } | null } => ({
    candidate: stemCID === null ? null : { stemCID }
  })
  it('drops an empty pick, a manual row, and a stem radio’s own pick or an earlier one drew', () => {
    const out = radioUsableCompanionPicks(
      'x',
      [
        { slotId: 'b', pick: null },
        { slotId: 'c', pick: pick(null) },
        { slotId: 'd', pick: pick('x') },
        { slotId: 'e', pick: pick('y') },
        { slotId: 'f', pick: pick('y') },
        { slotId: 'g', pick: pick('z') },
        { slotId: 'h', pick: pick('w') }
      ],
      new Set(['g'])
    )
    expect(out.map((k) => k.slotId)).toEqual(['e', 'h'])
  })
})

describe('radioChangeLengths', () => {
  const resolved = new Map([
    ['a', 4],
    ['b', 2],
    ['c', 8],
    ['d', 1]
  ])
  it('one row: its own lengths, the loop after from the others', () => {
    expect(radioChangeLengths([{ slotId: 'b', incomingBars: 4 }], resolved)).toEqual({
      outgoingBars: 2,
      incomingBars: 4,
      loopBarsAfter: 8
    })
  })
  it('several rows: the longest out and in, and the loop with every one of them swapped in', () => {
    // c (8) and a (4) both turn over to 2s: the loop after is 2 -- a shrink from 8
    expect(
      radioChangeLengths(
        [
          { slotId: 'c', incomingBars: 2 },
          { slotId: 'a', incomingBars: 2 }
        ],
        resolved
      )
    ).toEqual({ outgoingBars: 8, incomingBars: 2, loopBarsAfter: 2 })
  })
  it('a companion with a long stem is the incoming length', () => {
    expect(
      radioChangeLengths(
        [
          { slotId: 'b', incomingBars: 2 },
          { slotId: 'd', incomingBars: 16 }
        ],
        resolved
      )
    ).toEqual({ outgoingBars: 2, incomingBars: 16, loopBarsAfter: 16 })
  })
  it('any unknown incoming length is unknown, and so is the loop after', () => {
    expect(
      radioChangeLengths(
        [
          { slotId: 'b', incomingBars: 2 },
          { slotId: 'd', incomingBars: null }
        ],
        resolved
      )
    ).toEqual({ outgoingBars: 2, incomingBars: null, loopBarsAfter: null })
  })
  it('any unknown outgoing length is unknown', () => {
    expect(
      radioChangeLengths(
        [
          { slotId: 'b', incomingBars: 2 },
          { slotId: 'z', incomingBars: 2 }
        ],
        resolved
      ).outgoingBars
    ).toBeNull()
  })
})
