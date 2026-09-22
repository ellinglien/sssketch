import { describe, expect, it } from 'vitest'
import { bassEnergyRatio, transientDensity, detectOnsetTimes, guessSoundType } from './typeGuess'

const SAMPLE_RATE = 44100

function sineWave(freqHz: number, seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
  }
  return out
}

/** A click every `intervalSec`, simulating drum hits: a short burst of noise
 * followed by near silence. */
function impulseTrain(
  intervalSec: number,
  seconds: number,
  sampleRate = SAMPLE_RATE
): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const intervalSamples = Math.round(intervalSec * sampleRate)
  const burstLen = Math.round(sampleRate * 0.01) // 10ms burst
  for (let i = 0; i < n; i++) {
    const posInCycle = i % intervalSamples
    out[i] = posInCycle < burstLen ? (Math.random() * 2 - 1) * 0.9 : 0
  }
  return out
}

describe('bassEnergyRatio', () => {
  it('is high for a low-frequency sine (sub-bass)', () => {
    const samples = sineWave(60, 2)
    expect(bassEnergyRatio(samples, SAMPLE_RATE)).toBeGreaterThan(0.9)
  })

  it('is low for a high-frequency sine', () => {
    const samples = sineWave(4000, 2)
    expect(bassEnergyRatio(samples, SAMPLE_RATE)).toBeLessThan(0.2)
  })

  it('is zero for silence rather than dividing by zero', () => {
    expect(bassEnergyRatio(new Float32Array(1000), SAMPLE_RATE)).toBe(0)
  })
})

describe('transientDensity', () => {
  it('is high for a train of sharp impulses', () => {
    const samples = impulseTrain(0.25, 2) // 4 hits/sec
    expect(transientDensity(samples, SAMPLE_RATE)).toBeGreaterThan(3)
  })

  it('is near zero for a smooth sustained tone', () => {
    const samples = sineWave(220, 2)
    expect(transientDensity(samples, SAMPLE_RATE)).toBeLessThan(1)
  })
})

describe('guessSoundType', () => {
  it('guesses bass for a low sustained tone', () => {
    expect(guessSoundType(sineWave(55, 2), SAMPLE_RATE)).toBe('bass')
  })

  it('guesses drums for a rapid impulse train', () => {
    expect(guessSoundType(impulseTrain(0.2, 2), SAMPLE_RATE)).toBe('drums')
  })

  it('declines to guess for a sustained mid-range tone', () => {
    expect(guessSoundType(sineWave(440, 2), SAMPLE_RATE)).toBeNull()
  })
})

describe('detectOnsetTimes', () => {
  it('finds one onset per hit, in seconds, in order', () => {
    const samples = impulseTrain(0.25, 2) // hits at 0, 0.25, ... 1.75
    const times = detectOnsetTimes(samples, SAMPLE_RATE)
    // The very first hit starts at t=0 -- window 0 has no previous window to
    // jump from, so it's never counted (same as transientDensity always did).
    expect(times).toHaveLength(7)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
    expect(times[0]).toBeCloseTo(0.25, 1)
  })

  it('transientDensity is exactly onset count / duration', () => {
    const samples = impulseTrain(0.3, 2)
    expect(transientDensity(samples, SAMPLE_RATE)).toBe(
      detectOnsetTimes(samples, SAMPLE_RATE).length / 2
    )
  })

  it('no onsets for silence or a too-short input', () => {
    expect(detectOnsetTimes(new Float32Array(44100), SAMPLE_RATE)).toEqual([])
    expect(detectOnsetTimes(new Float32Array(10), SAMPLE_RATE)).toEqual([])
  })
})
