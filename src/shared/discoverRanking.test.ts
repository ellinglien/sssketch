// src/shared/discoverRanking.test.ts
import { describe, expect, it, vi } from 'vitest'
import { rankCandidates, pickReroll } from './discoverRanking'
import type { DiscoverCandidate } from '../main/discoverCandidates'

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
    riffBpm: 128,
    ...overrides
  }
}

describe('rankCandidates', () => {
  it('scores a candidate at the target BPM higher than one far from it', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128 })
    const far = candidate({ stemCID: 'far', riffBpm: 90 })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('returns an empty ranking for an empty candidate list, never throwing', () => {
    expect(() => rankCandidates([], { targetBpm: 128 })).not.toThrow()
    expect(rankCandidates([], { targetBpm: 128 })).toEqual([])
  })

  it('scores every candidate identically when BPM is equidistant and nothing else differs', () => {
    const a = candidate({ stemCID: 'a', riffBpm: 120 })
    const b = candidate({ stemCID: 'b', riffBpm: 136 })
    const ranked = rankCandidates([a, b], { targetBpm: 128 })
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 5)
  })

  it('ranks a favourited stem above a closer-BPM non-favourite -- a soft boost, not a hard filter', () => {
    const favourited = candidate({ stemCID: 'fav', riffBpm: 90 }) // far from target
    const nonFavourite = candidate({ stemCID: 'plain', riffBpm: 128 }) // exact target
    const ranked = rankCandidates([nonFavourite, favourited], {
      targetBpm: 128,
      favouriteStemCIDs: new Set(['fav'])
    })
    expect(ranked[0].candidate.stemCID).toBe('fav')
    // The non-favourite still scores above zero -- never fully excluded,
    // matching this feature's own soft-boost design (see FAVOURITE_BOOST's
    // own doc comment).
    expect(ranked[1].score).toBeGreaterThan(0)
  })

  it('favouriteStemCIDs is optional -- omitting it ranks purely by BPM, unchanged', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128 })
    const far = candidate({ stemCID: 'far', riffBpm: 90 })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
  })
})

describe('rankCandidates (trait scoring)', () => {
  it('ranks the candidate at the "high" end of the pool first', () => {
    const high = candidate({ stemCID: 'high', traitValues: { bassHeavy: 0.9 } })
    const low = candidate({ stemCID: 'low', traitValues: { bassHeavy: 0.1 } })
    const ranked = rankCandidates([low, high], { targetBpm: 128, targetTraits: ['bassHeavy'] })
    expect(ranked[0].candidate.stemCID).toBe('high')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('warm ("low" direction) ranks the smallest centroid first, in real Hz', () => {
    const warm = candidate({ stemCID: 'warm', traitValues: { warm: 300 } })
    const bright = candidate({ stemCID: 'bright', traitValues: { warm: 4200 } })
    const ranked = rankCandidates([bright, warm], { targetBpm: 128, targetTraits: ['warm'] })
    expect(ranked[0].candidate.stemCID).toBe('warm')
  })

  it('sums scores across traits -- good at both beats great at one', () => {
    const both = candidate({ stemCID: 'both', traitValues: { warm: 300, rhythmic: 0.9 } })
    const onlyWarm = candidate({ stemCID: 'onlyWarm', traitValues: { warm: 300, rhythmic: 0.1 } })
    const onlyRhythm = candidate({
      stemCID: 'onlyRhythm',
      traitValues: { warm: 4000, rhythmic: 0.9 }
    })
    const ranked = rankCandidates([onlyWarm, onlyRhythm, both], {
      targetBpm: 128,
      targetTraits: ['warm', 'rhythmic']
    })
    expect(ranked[0].candidate.stemCID).toBe('both')
  })

  it('a null/missing trait value scores no better than the worst real one', () => {
    const top = candidate({ stemCID: 'top', traitValues: { bright: 0.8 } })
    const bottom = candidate({ stemCID: 'bottom', traitValues: { bright: 0.2 } })
    const unknown = candidate({ stemCID: 'unknown', traitValues: {} })
    const ranked = rankCandidates([unknown, bottom, top], {
      targetBpm: 128,
      targetTraits: ['bright']
    })
    const scoreOf = (id: string): number => ranked.find((r) => r.candidate.stemCID === id)!.score
    expect(ranked[0].candidate.stemCID).toBe('top')
    expect(scoreOf('unknown')).toBeLessThanOrEqual(scoreOf('bottom'))
  })

  it('a non-finite trait value scores 0 instead of poisoning the sort with NaN', () => {
    const top = candidate({ stemCID: 'top', traitValues: { bright: 0.8 } })
    const bottom = candidate({ stemCID: 'bottom', traitValues: { bright: 0.2 } })
    const broken = candidate({ stemCID: 'broken', traitValues: { bright: Number.NaN } })
    const ranked = rankCandidates([broken, bottom, top], {
      targetBpm: 128,
      targetTraits: ['bright']
    })
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true)
    expect(ranked[0].candidate.stemCID).toBe('top')
  })

  it('a trait with no spread across the pool adds nothing', () => {
    const a = candidate({ stemCID: 'a', traitValues: { rhythmic: 0.5 } })
    const b = candidate({ stemCID: 'b', traitValues: { rhythmic: 0.5 } })
    const ranked = rankCandidates([a, b], { targetBpm: 128, targetTraits: ['rhythmic'] })
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 5)
  })

  it('omitting targetTraits ranks purely by BPM', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128, traitValues: { bright: 0.01 } })
    const far = candidate({ stemCID: 'far', riffBpm: 90, traitValues: { bright: 0.99 } })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
  })
})

describe('rankCandidates (library-percentile trait scoring)', () => {
  it('uses the library percentile as the trait score, not the pool range', () => {
    // Pool-relative, 0.31 would be the pool's max and score a full 1; in
    // library terms it's only the 45th percentile.
    const a = candidate({
      stemCID: 'a',
      traitValues: { bright: 0.31 },
      traitPercentiles: { bright: 0.45 }
    })
    const b = candidate({
      stemCID: 'b',
      traitValues: { bright: 0.3 },
      traitPercentiles: { bright: 0.4 }
    })
    const ranked = rankCandidates([b, a], { targetBpm: 128, targetTraits: ['bright'] })
    const scoreOf = (id: string): number => ranked.find((r) => r.candidate.stemCID === id)!.score
    expect(scoreOf('a')).toBeCloseTo(1 + 0.45)
    expect(scoreOf('b')).toBeCloseTo(1 + 0.4)
  })

  it('percentiles are already direction-adjusted -- warm is not flipped again', () => {
    const warm = candidate({
      stemCID: 'warm',
      traitValues: { warm: 300 },
      traitPercentiles: { warm: 0.9 }
    })
    const ranked = rankCandidates([warm], { targetBpm: 128, targetTraits: ['warm'] })
    expect(ranked[0].score).toBeCloseTo(1 + 0.9)
  })

  it('sums percentiles across requested traits', () => {
    const c = candidate({
      traitValues: { bright: 1, rhythmic: 1 },
      traitPercentiles: { bright: 0.7, rhythmic: 0.8 }
    })
    const ranked = rankCandidates([c], { targetBpm: 128, targetTraits: ['bright', 'rhythmic'] })
    expect(ranked[0].score).toBeCloseTo(1 + 0.7 + 0.8)
  })

  it('falls back to pool-relative min-max only for a candidate lacking a percentile', () => {
    const withP = candidate({
      stemCID: 'withP',
      traitValues: { bright: 0.2 },
      traitPercentiles: { bright: 0.65 }
    })
    const noP = candidate({
      stemCID: 'noP',
      traitValues: { bright: 0.8 },
      traitPercentiles: { bright: null }
    })
    const low = candidate({ stemCID: 'low', traitValues: { bright: 0.2 } })
    const ranked = rankCandidates([withP, noP, low], {
      targetBpm: 128,
      targetTraits: ['bright']
    })
    const scoreOf = (id: string): number => ranked.find((r) => r.candidate.stemCID === id)!.score
    expect(scoreOf('withP')).toBeCloseTo(1.65)
    expect(scoreOf('noP')).toBeCloseTo(2) // max of the pool's raw range
    expect(scoreOf('low')).toBeCloseTo(1) // min of the pool's raw range
  })
})

describe('pickReroll', () => {
  it('always returns null for an empty ranked list', () => {
    expect(pickReroll([], 50)).toBeNull()
  })

  it('at chaos=0 (safest), always picks the single top-ranked candidate', () => {
    const ranked = [
      { candidate: candidate({ stemCID: 'best', riffBpm: 128 }), score: 1 },
      { candidate: candidate({ stemCID: 'worst', riffBpm: 60 }), score: 0.1 }
    ]
    // Run many times -- at chaos=0 the pool is exactly top-1, so there's
    // nothing to randomize; this must be deterministic, not "usually".
    for (let i = 0; i < 20; i++) {
      expect(pickReroll(ranked, 0)?.stemCID).toBe('best')
    }
  })

  it('at chaos=100 (loosest), can pick a candidate other than the top-ranked one', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => ({
      candidate: candidate({ stemCID: `c${i}`, riffBpm: 128 - i }),
      score: 1 - i * 0.05
    }))
    const picks = new Set<string>()
    // Seed Math.random deterministically across calls so this test isn't
    // flaky -- mock it to cycle through a fixed sequence covering the
    // full [0,1) range.
    const values = Array.from({ length: 20 }, (_, i) => i / 20)
    let call = 0
    vi.spyOn(Math, 'random').mockImplementation(() => values[call++ % values.length])
    for (let i = 0; i < 20; i++) {
      const pick = pickReroll(ranked, 100)
      if (pick) picks.add(pick.stemCID)
    }
    vi.restoreAllMocks()
    expect(picks.size).toBeGreaterThan(1)
  })

  it('never returns a candidate outside the ranked list', () => {
    const ranked = [{ candidate: candidate({ stemCID: 'only-one', riffBpm: 128 }), score: 1 }]
    for (const chaos of [0, 25, 50, 75, 100]) {
      expect(pickReroll(ranked, chaos)?.stemCID).toBe('only-one')
    }
  })

  it("weights by each candidate's own score, not its rank position: near-tied scores split much closer to evenly than far-apart scores do", () => {
    // Same deterministic-sequence approach as the chaos=100 test above --
    // 20 evenly spaced draws covering [0,1), so both scenarios see an
    // identical sampling of the RNG and only the scores differ.
    const values = Array.from({ length: 20 }, (_, i) => i / 20)

    function countPicks(scoreA: number, scoreB: number): { a: number; b: number } {
      const ranked = [
        { candidate: candidate({ stemCID: 'a' }), score: scoreA },
        { candidate: candidate({ stemCID: 'b' }), score: scoreB }
      ]
      let call = 0
      vi.spyOn(Math, 'random').mockImplementation(() => values[call++ % values.length])
      const counts = { a: 0, b: 0 }
      for (let i = 0; i < values.length; i++) {
        const pick = pickReroll(ranked, 100)
        if (pick?.stemCID === 'a') counts.a++
        else if (pick?.stemCID === 'b') counts.b++
      }
      vi.restoreAllMocks()
      return counts
    }

    // Two candidates whose scores are almost identical (e.g. ~1 BPM apart)
    // should land close to a 50/50 split.
    const nearTied = countPicks(0.51, 0.5)
    // Two candidates with a large score gap should land heavily skewed
    // toward the higher-scored one.
    const farApart = countPicks(0.9, 0.1)

    const nearTiedGap = Math.abs(nearTied.a - nearTied.b)
    const farApartGap = Math.abs(farApart.a - farApart.b)
    expect(nearTiedGap).toBeLessThan(farApartGap)
  })
})
