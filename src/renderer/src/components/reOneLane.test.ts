import { describe, expect, it } from 'vitest'
import { RE_ONE_BUCKETS_PER_BAR, reOneLaneLayout } from './reOneLane'

describe('reOneLaneLayout', () => {
  it('tiles a short stem across the whole riff, one loop mark per restart', () => {
    expect(reOneLaneLayout(4, 16)).toEqual({
      tileWidthPct: 25,
      loopMarkPcts: [25, 50, 75],
      buckets: 4 * RE_ONE_BUCKETS_PER_BAR
    })
  })

  it('draws a stem as long as the riff once, with no loop marks', () => {
    const lane = reOneLaneLayout(8, 8)
    expect(lane.tileWidthPct).toBe(100)
    expect(lane.loopMarkPcts).toEqual([])
  })

  it('cuts off a last repeat that overhangs the riff without marking past its end', () => {
    // A 3-bar stem in an 8-bar riff restarts at bars 3 and 6.
    const lane = reOneLaneLayout(3, 8)
    expect(lane.tileWidthPct).toBe(37.5)
    expect(lane.loopMarkPcts).toEqual([37.5, 75])
  })

  it('does not mark the riff end when float steps land a hair short of it', () => {
    // 1/3-bar steps sum to 0.9999… of the riff, not 1.
    expect(reOneLaneLayout(1 / 3, 1).loopMarkPcts).toHaveLength(2)
  })

  it('gives enough buckets per bar that a sixteenth note spans several', () => {
    expect(RE_ONE_BUCKETS_PER_BAR / 16).toBeGreaterThanOrEqual(4)
  })

  it('keeps a very short or very long stem within sane bucket bounds', () => {
    expect(reOneLaneLayout(0.25, 4).buckets).toBe(128)
    expect(reOneLaneLayout(256, 256).buckets).toBe(8192)
  })

  it('falls back to one untiled lane for a missing or invalid bar length', () => {
    expect(reOneLaneLayout(0, 16)).toEqual({ tileWidthPct: 100, loopMarkPcts: [], buckets: 128 })
    expect(reOneLaneLayout(4, 0)).toEqual({ tileWidthPct: 100, loopMarkPcts: [], buckets: 128 })
  })
})
