import { describe, expect, it } from 'vitest'
import { rankCandidates } from './discoverRanking'
import type { DiscoverCandidate } from './discoverCandidate'
import {
  CLASH_LEAN_MAX,
  radioClashAmount,
  radioClashBed,
  radioClashBedScore,
  radioClashLean,
  radioClashLeaned,
  radioClashLowpassRow,
  radioClashTraitScore
} from './radioClash'

function candidate(overrides: Partial<DiscoverCandidate>): DiscoverCandidate {
  return {
    stemCID: 's1',
    jamCID: 'jam1',
    riffCID: 'r1',
    presetName: 'test',
    creatorUserName: 'elling',
    slotKinds: ['drums'],
    traitValues: {},
    traitPercentiles: {},
    kindSources: {},
    riffCreationTime: null,
    drumSubRole: null,
    riffBpm: 120,
    ...overrides
  }
}

describe('radioClash helpers', () => {
  it('the amount is 0..1, and 0 with the mode off', () => {
    expect(radioClashAmount(true, 25)).toBe(0.25)
    expect(radioClashAmount(true, 140)).toBe(1)
    expect(radioClashAmount(false, 80)).toBe(0)
  })

  it('the bed is the mean of the known percentiles per clash trait', () => {
    expect(radioClashBed([{ bright: 0.2, rhythmic: 0.9 }, { bright: 0.6 }, { warm: 0.5 }])).toEqual(
      {
        bright: 0.4,
        rhythmic: 0.9
      }
    )
    expect(radioClashBed([])).toEqual({})
  })

  it('turns a requested rhythmic or bright target round, and leaves bassHeavy and warm alone', () => {
    expect(radioClashTraitScore('bright', 0.9, 1)).toBeCloseTo(0.1)
    expect(radioClashTraitScore('rhythmic', 0.9, 0.5)).toBeCloseTo(0.5)
    expect(radioClashTraitScore('bassHeavy', 0.9, 1)).toBe(0.9)
    expect(radioClashTraitScore('warm', 0.9, 1)).toBe(0.9)
    expect(radioClashTraitScore('bright', 0.9, 0)).toBe(0.9)
  })

  it('rewards distance from the bed on rhythm and brightness only', () => {
    const clash = { amount: 1, bed: { bright: 0.2, rhythmic: 0.5 } }
    expect(radioClashBedScore({ bright: 0.9, rhythmic: 0.5, bassHeavy: 0.1 }, clash)).toBeCloseTo(
      0.7
    )
    expect(radioClashBedScore({ bassHeavy: 0.9, warm: 0.1 }, clash)).toBe(0)
    expect(radioClashBedScore({ bright: 0.9 }, { ...clash, amount: 0 })).toBe(0)
  })

  it('low-passes the brighter of the most mismatched pair, only past the gap', () => {
    expect(
      radioClashLowpassRow(
        [
          { id: 'a', bright: 0.2 },
          { id: 'b', bright: 0.9 },
          { id: 'c', bright: null }
        ],
        0.5
      )
    ).toBe('b')
    expect(
      radioClashLowpassRow(
        [
          { id: 'a', bright: 0.5 },
          { id: 'b', bright: 0.7 }
        ],
        1
      )
    ).toBeNull()
    expect(
      radioClashLowpassRow(
        [
          { id: 'a', bright: 0.1 },
          { id: 'b', bright: 0.9 }
        ],
        0
      )
    ).toBeNull()
  })

  it('leans the master in only above 50, by at most 0.15, never past 1', () => {
    expect(radioClashLean(true, 50)).toBe(0)
    expect(radioClashLean(true, 75)).toBeCloseTo(CLASH_LEAN_MAX / 2)
    expect(radioClashLean(true, 100)).toBeCloseTo(CLASH_LEAN_MAX)
    expect(radioClashLean(false, 100)).toBe(0)
    expect(radioClashLeaned(0.5, 0.15)).toBeCloseTo(0.65)
    expect(radioClashLeaned(0.95, 0.15)).toBe(1)
  })
})

describe('rankCandidates with a clash', () => {
  const bed = { bright: 0.2, rhythmic: 0.3 }

  it('no clash ranks exactly as before', () => {
    const pool = [
      candidate({ stemCID: 'a', traitPercentiles: { bright: 0.9 } }),
      candidate({ stemCID: 'b', traitPercentiles: { bright: 0.3 } })
    ]
    const plain = rankCandidates(pool, { targetBpm: 120, targetTraits: ['bright'] })
    const zero = rankCandidates(pool, {
      targetBpm: 120,
      targetTraits: ['bright'],
      clash: { amount: 0, bed }
    })
    expect(zero).toEqual(plain)
  })

  it('a clash prefers the stem furthest from the bed on brightness and rhythm', () => {
    const near = candidate({ stemCID: 'near', traitPercentiles: { bright: 0.25, rhythmic: 0.3 } })
    const far = candidate({ stemCID: 'far', traitPercentiles: { bright: 0.95, rhythmic: 0.9 } })
    expect(rankCandidates([far, near], { targetBpm: 120 })[0].score).toBe(
      rankCandidates([far, near], { targetBpm: 120 })[1].score
    )
    const ranked = rankCandidates([near, far], { targetBpm: 120, clash: { amount: 0.8, bed } })
    expect(ranked[0].candidate.stemCID).toBe('far')
  })

  it('bass energy and warmth stay matched: a clash does not move them', () => {
    const heavy = candidate({ stemCID: 'heavy', traitPercentiles: { bassHeavy: 0.9 } })
    const light = candidate({ stemCID: 'light', traitPercentiles: { bassHeavy: 0.2 } })
    const ranked = rankCandidates([light, heavy], {
      targetBpm: 120,
      targetTraits: ['bassHeavy'],
      clash: { amount: 1, bed }
    })
    expect(ranked[0].candidate.stemCID).toBe('heavy')
  })
})
