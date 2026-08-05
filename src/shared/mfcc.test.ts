import { describe, it, expect } from 'vitest'
import { computeMfcc } from './mfcc'

function sineWave(freqHz: number, durationSec: number, sampleRate: number): Float32Array {
  const n = Math.round(durationSec * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
  return out
}

describe('computeMfcc', () => {
  it('returns exactly 13 coefficients', () => {
    const samples = sineWave(440, 1.0, 44100)
    const result = computeMfcc(samples, 44100)
    expect(result).toHaveLength(13)
  })

  it('returns all finite numbers, never NaN/Infinity, for real audio-like input', () => {
    const samples = sineWave(220, 0.5, 44100)
    const result = computeMfcc(samples, 44100)
    for (const v of result) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('returns a flat/near-zero vector (after the first coefficient) for silence', () => {
    const samples = new Float32Array(44100 * 0.5) // all zeros
    const result = computeMfcc(samples, 44100)
    // Coefficient 0 (roughly overall log-energy) will be very negative for
    // silence, not zero -- but every OTHER coefficient (which capture
    // spectral SHAPE, not overall level) should be at/near zero when
    // there's no signal to have any shape at all.
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i])).toBeLessThan(1e-6)
    }
  })

  it('produces a genuinely different vector for a low tone vs a high tone', () => {
    const low = computeMfcc(sineWave(110, 0.5, 44100), 44100)
    const high = computeMfcc(sineWave(3520, 0.5, 44100), 44100)
    let sumSqDiff = 0
    for (let i = 0; i < 13; i++) sumSqDiff += (low[i] - high[i]) ** 2
    expect(Math.sqrt(sumSqDiff)).toBeGreaterThan(1)
  })

  it('handles input shorter than one analysis window without throwing', () => {
    const samples = new Float32Array(100).fill(0.1)
    const result = computeMfcc(samples, 44100)
    expect(result).toHaveLength(13)
    for (const v of result) expect(Number.isFinite(v)).toBe(true)
  })
})
