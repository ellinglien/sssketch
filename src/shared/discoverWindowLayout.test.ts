import { describe, expect, it } from 'vitest'
import {
  DISCOVER_MAX_TILES,
  DISCOVER_WINDOW_BARS,
  discoverPlayheadPcts,
  discoverWindowLayout
} from './discoverWindowLayout'

describe('discoverWindowLayout', () => {
  it('is 32 bars wide whatever the stem, while the loop fits', () => {
    expect(DISCOVER_WINDOW_BARS).toBe(32)
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 16 }).windowBars).toBe(32)
    expect(discoverWindowLayout({ stemBars: 1, loopBars: 4 }).windowBars).toBe(32)
  })

  it('grows to a loop longer than the window', () => {
    expect(discoverWindowLayout({ stemBars: 48, loopBars: 48 }).windowBars).toBe(48)
  })

  it('tiles the stem from bar 0 across the window', () => {
    const { tiles } = discoverWindowLayout({ stemBars: 4, loopBars: 16 })
    expect(tiles).toHaveLength(8)
    expect(tiles[0]).toEqual({ leftPct: 0, widthPct: 12.5 })
    expect(tiles[7]).toEqual({ leftPct: 87.5, widthPct: 12.5 })
  })

  it('cuts the last tile at the window edge rather than dropping it', () => {
    // 32 / 12 = 2.67 -- three tiles, the third overhanging.
    const { tiles } = discoverWindowLayout({ stemBars: 12, loopBars: 12 })
    expect(tiles.map((t) => t.leftPct)).toEqual([0, 37.5, 75])
  })

  it('draws a loop-top line at every multiple of the loop inside the window', () => {
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 16 }).loopTopLinePcts).toEqual([50])
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 8 }).loopTopLinePcts).toEqual([25, 50, 75])
    expect(discoverWindowLayout({ stemBars: 32, loopBars: 32 }).loopTopLinePcts).toEqual([])
  })

  it('draws a restart line at every repeat except the left edge and any loop top', () => {
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 16 }).restartLinePcts).toEqual([
      12.5, 25, 37.5, 62.5, 75, 87.5
    ])
  })

  it('draws no restart lines for a stem as long as the window', () => {
    expect(discoverWindowLayout({ stemBars: 32, loopBars: 32 }).restartLinePcts).toEqual([])
  })

  it('never draws more than DISCOVER_MAX_TILES tiles', () => {
    expect(DISCOVER_MAX_TILES).toBe(32)
    const { tiles } = discoverWindowLayout({ stemBars: 0.25, loopBars: 4 })
    expect(tiles).toHaveLength(32)
    expect(tiles[1].leftPct).toBeCloseTo(100 / 32)
  })

  it('treats a missing stem or loop length safely', () => {
    expect(discoverWindowLayout({ stemBars: 0, loopBars: 8 }).tiles).toHaveLength(4)
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 0 }).windowBars).toBe(32)
    expect(discoverWindowLayout({ stemBars: 0, loopBars: 0 }).tiles.length).toBeGreaterThan(0)
  })
})

describe('discoverPlayheadPcts', () => {
  it('puts one playhead in each lap, all at the same place in their lap', () => {
    expect(discoverPlayheadPcts(3, 16, 32)).toEqual([9.375, 59.375])
  })

  it('drops a lap copy that would fall past the window', () => {
    expect(discoverPlayheadPcts(10, 12, 32)).toEqual([31.25, 68.75])
    expect(discoverPlayheadPcts(2, 12, 32)).toEqual([6.25, 43.75, 81.25])
  })

  it('is a single playhead when the loop fills the window', () => {
    expect(discoverPlayheadPcts(8, 32, 32)).toEqual([25])
  })

  it('wraps a position at or past the loop length', () => {
    expect(discoverPlayheadPcts(16, 16, 32)).toEqual([0, 50])
  })

  it('draws nothing it cannot place', () => {
    expect(discoverPlayheadPcts(Number.NaN, 16, 32)).toEqual([])
    expect(discoverPlayheadPcts(1, 0, 32)).toEqual([])
    expect(discoverPlayheadPcts(1, 16, 0)).toEqual([])
  })
})
