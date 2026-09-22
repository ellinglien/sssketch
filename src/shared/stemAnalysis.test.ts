import { describe, expect, it } from 'vitest'
import { analyzeStemSamples, assembleStemFeatures } from './stemAnalysis'
import { computePitchContour, voicedPitchFeatures } from './pitchContour'
import { transientDensity } from './typeGuess'
import { computeMfcc } from './mfcc'
import { STEM_FEATURE_VERSION } from './stemFeatures'

function sine(freqHz: number, seconds = 0.5, sampleRate = 44100): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 0.5
  return out
}

describe('analyzeStemSamples', () => {
  it('returns finite scalar features and a 13-coefficient MFCC', () => {
    const a = analyzeStemSamples(sine(220), 44100)
    expect(Number.isFinite(a.transientDensity)).toBe(true)
    expect(Number.isFinite(a.bassEnergyRatio)).toBe(true)
    expect(Number.isFinite(a.spectralCentroidHz)).toBe(true)
    expect(a.mfcc).toHaveLength(13)
  })

  it('pitch contour is identical to computePitchContour on the same samples', () => {
    const samples = sine(220)
    const a = analyzeStemSamples(samples, 44100)
    const direct = computePitchContour(samples, 44100)
    expect(a.pitchContour.numFrames).toBe(direct.numFrames)
    expect(Array.from(a.pitchContour.freqHz)).toEqual(Array.from(direct.freqHz))
  })

  it('a higher tone has a higher spectral centroid', () => {
    const low = analyzeStemSamples(sine(100), 44100)
    const high = analyzeStemSamples(sine(4000), 44100)
    expect(high.spectralCentroidHz).toBeGreaterThan(low.spectralCentroidHz)
  })

  it('silence yields a 0 centroid, never NaN', () => {
    const a = analyzeStemSamples(new Float32Array(4410), 44100)
    expect(a.spectralCentroidHz).toBe(0)
  })
})

// Deterministic white noise (LCG), so the test never flakes.
function whiteNoise(seconds = 0.5, sampleRate = 44100): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  let state = 12345
  for (let i = 0; i < n; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[i] = (state / 2 ** 32) * 2 - 1
  }
  return out
}

/** Short clicks (200 samples of a 3 kHz burst) starting on 20 ms window
 * boundaries (882 samples at 44.1 kHz, typeGuess's own onset window), so
 * each click is exactly one onset. `windowIndices` = where each click
 * starts, in windows. */
function clickTrain(windowIndices: number[], totalWindows: number): Float32Array {
  const win = 882
  const out = new Float32Array(totalWindows * win)
  for (const w of windowIndices) {
    for (let i = 0; i < 200; i++)
      out[w * win + i] = Math.sin((2 * Math.PI * 3000 * i) / 44100) * 0.8
  }
  return out
}

describe('analyzeStemSamples -- Phase 3 measurements', () => {
  it('existing fields keep their exact meaning (transientDensity, mfcc)', () => {
    const samples = sine(220)
    const a = analyzeStemSamples(samples, 44100)
    expect(a.transientDensity).toBe(transientDensity(samples, 44100))
    expect(a.mfcc).toEqual(computeMfcc(samples, 44100))
  })

  it('FFT centroid: a 4 kHz tone sits far above a 150 Hz tone, each near its own pitch', () => {
    const low = analyzeStemSamples(sine(150), 44100).spectralCentroidFftHz
    const high = analyzeStemSamples(sine(4000), 44100).spectralCentroidFftHz
    expect(high).toBeGreaterThan(low * 10)
    expect(low).toBeGreaterThan(100)
    expect(low).toBeLessThan(400)
    expect(high).toBeGreaterThan(3500)
    expect(high).toBeLessThan(4500)
  })

  it('FFT centroid: white noise sits high (around a quarter of the sample rate)', () => {
    const noise = analyzeStemSamples(whiteNoise(), 44100).spectralCentroidFftHz
    const low = analyzeStemSamples(sine(150), 44100).spectralCentroidFftHz
    expect(noise).toBeGreaterThan(low)
    expect(noise).toBeGreaterThan(8000)
    expect(noise).toBeLessThan(14000)
  })

  it('silence: FFT centroid, regularity and rhythmic strength are 0, never NaN', () => {
    const a = analyzeStemSamples(new Float32Array(44100), 44100)
    expect(a.spectralCentroidFftHz).toBe(0)
    expect(a.onsetRegularity).toBe(0)
    expect(a.rhythmicStrength).toBe(0)
  })

  it('a regular click train is more rhythmic than an irregular one with the same click count', () => {
    // 8 clicks each, across the same 200 windows (4 s).
    const regular = analyzeStemSamples(clickTrain([10, 30, 50, 70, 90, 110, 130, 150], 200), 44100)
    const irregular = analyzeStemSamples(
      clickTrain([10, 13, 40, 44, 95, 120, 123, 190], 200),
      44100
    )
    expect(regular.transientDensity).toBeCloseTo(irregular.transientDensity)
    expect(regular.onsetRegularity).toBeGreaterThan(0.95)
    expect(irregular.onsetRegularity).toBeLessThan(0.5)
    expect(regular.rhythmicStrength).toBeGreaterThan(irregular.rhythmicStrength * 2)
  })
})

describe('assembleStemFeatures', () => {
  it('carries the Phase 3 fields and stamps the current feature version', () => {
    const a = analyzeStemSamples(sine(220), 44100)
    const f = assembleStemFeatures(a, [0.5])
    expect(f.spectralCentroidFftHz).toBe(a.spectralCentroidFftHz)
    expect(f.onsetRegularity).toBe(a.onsetRegularity)
    expect(f.rhythmicStrength).toBe(a.rhythmicStrength)
    expect(f.featureVersion).toBe(STEM_FEATURE_VERSION)
    expect(STEM_FEATURE_VERSION).toBe(2)
  })

  it('averages brightness and derives voiced-pitch fields from the contour', () => {
    const a = analyzeStemSamples(sine(220), 44100)
    const f = assembleStemFeatures(a, [0.2, 0.4])
    expect(f.zcrBrightness).toBeCloseTo(0.3)
    const pitch = voicedPitchFeatures(a.pitchContour)
    expect(f.voicedFraction).toBe(pitch.voicedFraction)
    expect(f.pitchVarianceCents).toBe(pitch.pitchVarianceCents)
    expect(f.transientDensity).toBe(a.transientDensity)
    expect(f.mfcc).toEqual(a.mfcc)
  })

  it('empty brightness averages to 0', () => {
    const a = analyzeStemSamples(sine(220), 44100)
    expect(assembleStemFeatures(a, []).zcrBrightness).toBe(0)
  })
})
