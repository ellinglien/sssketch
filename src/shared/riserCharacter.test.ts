import { describe, expect, it } from 'vitest'
import { RISER_BEFORE, RISER_RANGES, drawRiserCharacter } from './riserCharacter'

// moved from ell.ing/radio src/audio/riserCharacter.test.ts (2026-10-01). Its seeded random came
// from the radio's audio/noise.ts; this is the same mulberry32.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('drawRiserCharacter', () => {
  const rnd = seededRandom(7)
  const draws = Array.from({ length: 4000 }, () => drawRiserCharacter(rnd))

  it('stays inside every range', () => {
    for (const c of draws) {
      expect(['white', 'pink']).toContain(c.colour)
      expect(c.q).toBeGreaterThanOrEqual(1)
      expect(c.q).toBeLessThanOrEqual(6)
      expect(c.startCutoff).toBeGreaterThanOrEqual(0.1)
      expect(c.startCutoff).toBeLessThanOrEqual(0.3)
      expect(c.endCutoff).toBeGreaterThanOrEqual(0.85)
      expect(c.endCutoff).toBeLessThanOrEqual(1)
      expect(c.curve).toBeGreaterThanOrEqual(RISER_RANGES.curve[0])
      expect(c.curve).toBeLessThanOrEqual(RISER_RANGES.curve[1])
      expect(['wide', 'mono']).toContain(c.stereo)
      expect(c.levelDb).toBeGreaterThanOrEqual(1)
      expect(c.levelDb).toBeLessThanOrEqual(5)
      expect(c.send).toBeGreaterThanOrEqual(0.2)
      expect(c.send).toBeLessThanOrEqual(0.4)
    }
  })

  it('pink about half the time, mono and resonant (Q over 3) only occasionally, +3 dB on average', () => {
    const share = (f: (c: (typeof draws)[0]) => boolean): number =>
      draws.filter(f).length / draws.length
    expect(share((c) => c.colour === 'pink')).toBeCloseTo(0.5, 1)
    expect(share((c) => c.stereo === 'mono')).toBeCloseTo(RISER_RANGES.monoShare, 1)
    expect(share((c) => c.q > 3)).toBeCloseTo(RISER_RANGES.resonantShare, 1)
    const meanDb = draws.reduce((s, c) => s + c.levelDb, 0) / draws.length
    expect(meanDb).toBeCloseTo(3, 1)
  })

  it('the curve exponent is a slight variation around 1', () => {
    expect(RISER_RANGES.curve[0]).toBeGreaterThanOrEqual(0.75)
    expect(RISER_RANGES.curve[1]).toBeLessThanOrEqual(1.35)
  })

  it('RISER_BEFORE is the riser as it was: white, Q 2, 0.2 -> 0.95, linear, wide, 0 dB, no send', () => {
    expect(RISER_BEFORE).toEqual({
      colour: 'white',
      q: 2,
      startCutoff: 0.2,
      endCutoff: 0.95,
      curve: 1,
      stereo: 'wide',
      levelDb: 0,
      send: 0
    })
  })
})
