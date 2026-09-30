import { describe, expect, it } from 'vitest'
import {
  DISCOVER_MAX_TILES,
  DISCOVER_WINDOW_BARS,
  discoverSweepPct,
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

describe('discoverSweepPct', () => {
  it('sweeps an 8-bar loop across four laps of a 32-bar window, then comes back', () => {
    expect(discoverSweepPct(0, 0, 8, 32)).toBe(0)
    expect(discoverSweepPct(0, 8 - 1e-9, 8, 32)).toBeCloseTo(25)
    expect(discoverSweepPct(1, 0, 8, 32)).toBe(25)
    expect(discoverSweepPct(1, 4, 8, 32)).toBe(37.5)
    expect(discoverSweepPct(2, 0, 8, 32)).toBe(50)
    expect(discoverSweepPct(3, 0, 8, 32)).toBe(75)
    expect(discoverSweepPct(3, 8 - 1e-9, 8, 32)).toBeCloseTo(100)
    expect(discoverSweepPct(4, 0, 8, 32)).toBe(0)
    expect(discoverSweepPct(5, 4, 8, 32)).toBe(37.5)
  })

  it('sweeps only whole laps: a 12-bar loop covers 24 bars, then returns to the left edge', () => {
    expect(discoverSweepPct(0, 0, 12, 32)).toBe(0)
    expect(discoverSweepPct(0, 12 - 1e-9, 12, 32)).toBeCloseTo(37.5)
    expect(discoverSweepPct(1, 0, 12, 32)).toBe(37.5)
    expect(discoverSweepPct(1, 12 - 1e-9, 12, 32)).toBeCloseTo(75)
    expect(discoverSweepPct(2, 0, 12, 32)).toBe(0)
    expect(discoverSweepPct(2, 6, 12, 32)).toBe(18.75)
  })

  it('is a single sweep when the loop fills or exceeds the window', () => {
    expect(discoverSweepPct(0, 8, 32, 32)).toBe(25)
    expect(discoverSweepPct(7, 8, 32, 32)).toBe(25)
    expect(discoverSweepPct(3, 20, 40, 40)).toBe(50)
  })

  it('wraps a position at or past the loop length into the lap', () => {
    expect(discoverSweepPct(0, 8, 8, 32)).toBe(0)
    expect(discoverSweepPct(1, 10, 8, 32)).toBe(31.25)
    expect(discoverSweepPct(0, -2, 8, 32)).toBe(18.75)
  })

  it('returns null for input it cannot place', () => {
    expect(discoverSweepPct(0, Number.NaN, 8, 32)).toBeNull()
    expect(discoverSweepPct(Number.NaN, 1, 8, 32)).toBeNull()
    expect(discoverSweepPct(0, 1, Number.POSITIVE_INFINITY, 32)).toBeNull()
    expect(discoverSweepPct(0, 1, 8, Number.NaN)).toBeNull()
    expect(discoverSweepPct(0, 1, 0, 32)).toBeNull()
    expect(discoverSweepPct(0, 1, -8, 32)).toBeNull()
    expect(discoverSweepPct(0, 1, 8, 0)).toBeNull()
  })
})
