import { describe, expect, it } from 'vitest'
import { analyzeStemSamples, assembleStemFeatures } from './stemAnalysis'
import { computePitchContour, voicedPitchFeatures } from './pitchContour'

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

describe('assembleStemFeatures', () => {
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
