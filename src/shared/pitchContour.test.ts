import { describe, expect, it } from 'vitest'
import { computePitchContour, voicedPitchFeatures } from './pitchContour'

describe('computePitchContour', () => {
  it('returns zero frames for empty input', () => {
    const result = computePitchContour(new Float32Array(0), 44100)
    expect(result.numFrames).toBe(0)
    expect(result.freqHz.length).toBe(0)
  })

  it('produces numFrames = ceil(numSamples / hopSize)', () => {
    const sampleRate = 44100
    const hopSize = 1024
    const samples = new Float32Array(hopSize * 6)
    const result = computePitchContour(samples, sampleRate, { hopSize })
    expect(result.numFrames).toBe(6)
  })

  it('reports no pitch (0) throughout true silence', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate) // 1s of silence
    const result = computePitchContour(samples, sampleRate)
    for (const f of result.freqHz) expect(f).toBe(0)
  })

  it('estimates the fundamental of a steady pure tone within 5%', () => {
    const sampleRate = 44100
    const freqHz = 220 // A3
    const samples = new Float32Array(sampleRate) // 1s
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
    }
    const result = computePitchContour(samples, sampleRate)
    const midFrame = Math.floor(result.numFrames / 2)
    const estimated = result.freqHz[midFrame]
    expect(estimated).toBeGreaterThan(0)
    expect(Math.abs(estimated - freqHz) / freqHz).toBeLessThan(0.05)
  })
})

describe('voicedPitchFeatures', () => {
  it('returns voicedFraction 0 and pitchVarianceCents 0 for an entirely unvoiced contour', () => {
    const contour = { numFrames: 4, freqHz: new Float32Array([0, 0, 0, 0]) }
    const result = voicedPitchFeatures(contour)
    expect(result.voicedFraction).toBe(0)
    expect(result.pitchVarianceCents).toBe(0)
  })

  it('returns voicedFraction 1 for an entirely voiced, constant-pitch contour', () => {
    const contour = { numFrames: 4, freqHz: new Float32Array([440, 440, 440, 440]) }
    const result = voicedPitchFeatures(contour)
    expect(result.voicedFraction).toBe(1)
    expect(result.pitchVarianceCents).toBe(0)
  })

  it('computes voicedFraction as the fraction of non-zero frames', () => {
    const contour = { numFrames: 4, freqHz: new Float32Array([440, 0, 440, 0]) }
    const result = voicedPitchFeatures(contour)
    expect(result.voicedFraction).toBeCloseTo(0.5, 10)
  })

  it('reports nonzero pitch variance for a contour that moves between two pitches', () => {
    // 220Hz and 440Hz are exactly one octave (1200 cents) apart -- variance
    // in cent-space should be large and definitely nonzero, unlike raw-Hz
    // variance which would also be nonzero but on a totally different,
    // non-comparable scale across registers.
    const contour = {
      numFrames: 4,
      freqHz: new Float32Array([220, 440, 220, 440])
    }
    const result = voicedPitchFeatures(contour)
    expect(result.pitchVarianceCents).toBeGreaterThan(0)
  })

  it('ignores unvoiced frames entirely when computing pitch variance (not counted as 0 Hz)', () => {
    // If unvoiced (0Hz) frames were naively included in the variance
    // calculation, a mix of "silence" and "constant 440Hz" would read as
    // wildly varying pitch, when really there's only ever one true pitch
    // whenever anything voiced is happening at all.
    const contour = {
      numFrames: 4,
      freqHz: new Float32Array([440, 0, 440, 0])
    }
    const result = voicedPitchFeatures(contour)
    expect(result.pitchVarianceCents).toBe(0)
  })
})
