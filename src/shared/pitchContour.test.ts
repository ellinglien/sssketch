import { describe, expect, it } from 'vitest'
import { computePitchContour } from './pitchContour'

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
