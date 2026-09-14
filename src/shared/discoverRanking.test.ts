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
    arrangeRole: 'drums',
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
})
