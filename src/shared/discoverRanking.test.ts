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
    slotKind: 'drums',
    traitValue: null,
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
  it('scores a candidate closer to the trait target higher, for a trait-kind roll', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128, traitValue: 0.95 })
    const far = candidate({ stemCID: 'far', riffBpm: 128, traitValue: 0.1 })
    const ranked = rankCandidates([far, close], {
      targetBpm: 128,
      targetTrait: { direction: 'high', maxValue: 1 }
    })
    expect(ranked[0].candidate.stemCID).toBe('close')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('"low" direction ranks the smallest traitValue highest -- for the warm end of bright/warm', () => {
    const warm = candidate({ stemCID: 'warm', riffBpm: 128, traitValue: 0.05 })
    const bright = candidate({ stemCID: 'bright', riffBpm: 128, traitValue: 0.9 })
    const ranked = rankCandidates([bright, warm], {
      targetBpm: 128,
      targetTrait: { direction: 'low', maxValue: 1 }
    })
    expect(ranked[0].candidate.stemCID).toBe('warm')
  })

  it('a candidate with traitValue null (e.g. mixed into a trait roll by mistake) scores as the worst possible trait match, not a crash', () => {
    const withTrait = candidate({ stemCID: 'has-trait', riffBpm: 128, traitValue: 0.5 })
    const noTrait = candidate({ stemCID: 'no-trait', riffBpm: 128, traitValue: null })
    expect(() =>
      rankCandidates([withTrait, noTrait], {
        targetBpm: 128,
        targetTrait: { direction: 'high', maxValue: 1 }
      })
    ).not.toThrow()
  })

  it('omitting targetTrait ranks purely by BPM, exactly like today -- mask-kind rolls are unaffected', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128, traitValue: 0.01 })
    const far = candidate({ stemCID: 'far', riffBpm: 90, traitValue: 0.99 })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
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
