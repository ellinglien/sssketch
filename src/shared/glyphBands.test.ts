import { describe, expect, it } from 'vitest'
import { polarGlyph } from './visuals'
import type { BandEnergy } from './bandEnergy'
import {
  GLYPH_BAND_POINTS,
  glyphBandsFrom,
  pitchContourFromBytes,
  pitchContourToBytes
} from './glyphBands'

/** Deterministic pseudo-random [0, 1) values (mulberry32), as Float32 like computeBandEnergy's. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomBandEnergy(numFrames: number, next: () => number): BandEnergy {
  const band = (): Float32Array => {
    const out = new Float32Array(numFrames)
    for (let i = 0; i < numFrames; i++) out[i] = next()
    return out
  }
  return { numFrames, bass: band(), mid: band(), treble: band() }
}

describe('glyphBandsFrom', () => {
  it('draws exactly the glyph the full band energy draws, for lengths 1..3000', () => {
    const next = rng(42)
    const lengths = [1, 2, 3, 7, 15, 16, 17, 31, 32, 33, 100, 255, 256, 257, 1000, 2047, 3000]
    for (let i = 0; i < 40; i++) lengths.push(1 + Math.floor(next() * 3000))
    for (const n of lengths) {
      const be = randomBandEnergy(n, next)
      const bands = glyphBandsFrom(be)
      for (const key of ['bass', 'mid', 'treble'] as const) {
        expect(bands[key]).toHaveLength(GLYPH_BAND_POINTS)
        const r0 = 5 + next() * 20
        const amp = 5 + next() * 20
        expect(polarGlyph(bands[key], r0, amp, 16)).toBe(
          polarGlyph(Array.from(be[key]), r0, amp, 16)
        )
      }
    }
  })

  it('an empty band energy draws the same glyph as before', () => {
    const be = randomBandEnergy(0, rng(1))
    const bands = glyphBandsFrom(be)
    expect(polarGlyph(bands.bass, 17, 20, 16)).toBe(polarGlyph(Array.from(be.bass), 17, 20, 16))
  })

  it('survives a JSON round trip unchanged', () => {
    const bands = glyphBandsFrom(randomBandEnergy(500, rng(7)))
    expect(JSON.parse(JSON.stringify(bands))).toEqual(bands)
  })
})

describe('pitch contour bytes', () => {
  it('round-trips Float32 -> Buffer -> Float32 identically', () => {
    const next = rng(3)
    const freqHz = new Float32Array(689)
    for (let i = 0; i < freqHz.length; i++) freqHz[i] = next() < 0.3 ? 0 : 40 + next() * 1500
    const bytes = pitchContourToBytes(freqHz)
    // As the db hands it back: a Node Buffer, possibly at an unaligned offset in a bigger pool.
    const pool = Buffer.alloc(bytes.byteLength + 3)
    pool.set(bytes, 3)
    const fromDb = pool.subarray(3)
    const back = pitchContourFromBytes(fromDb, freqHz.length)
    expect(back).not.toBeNull()
    expect(back!.numFrames).toBe(freqHz.length)
    expect(Array.from(back!.freqHz)).toEqual(Array.from(freqHz))
  })

  it('does not alias the contour it was given', () => {
    const freqHz = new Float32Array([100, 200])
    const bytes = pitchContourToBytes(freqHz)
    freqHz[0] = 0
    expect(Array.from(pitchContourFromBytes(bytes, 2)!.freqHz)).toEqual([100, 200])
  })

  it('a length that does not match the frame count is null', () => {
    expect(pitchContourFromBytes(new Uint8Array(7), 2)).toBeNull()
  })

  it('zero frames round-trip', () => {
    const back = pitchContourFromBytes(pitchContourToBytes(new Float32Array(0)), 0)
    expect(back).toEqual({ numFrames: 0, freqHz: new Float32Array(0) })
  })
})
