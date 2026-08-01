import { describe, expect, it } from 'vitest'
import { computeBandEnergy } from './bandEnergy'

describe('computeBandEnergy', () => {
  it('returns zero frames for empty input', () => {
    const result = computeBandEnergy(new Float32Array(0), 44100)
    expect(result.numFrames).toBe(0)
    expect(result.bass.length).toBe(0)
    expect(result.mid.length).toBe(0)
    expect(result.treble.length).toBe(0)
  })

  it('produces bass/mid/treble arrays the same length as numFrames', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate) // 1 second
    const result = computeBandEnergy(samples, sampleRate)
    expect(result.bass.length).toBe(result.numFrames)
    expect(result.mid.length).toBe(result.numFrames)
    expect(result.treble.length).toBe(result.numFrames)
  })

  it('is entirely at or near 0 in every band for a silent signal', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate)
    const result = computeBandEnergy(samples, sampleRate)
    for (const v of result.bass) expect(v).toBeCloseTo(0, 5)
    for (const v of result.mid) expect(v).toBeCloseTo(0, 5)
    for (const v of result.treble) expect(v).toBeCloseTo(0, 5)
  })

  it('lights up the bass band (not treble) for a low-frequency tone', () => {
    const sampleRate = 44100
    const freqHz = 80 // sub-bass, well under the bass/mid boundary
    const samples = new Float32Array(sampleRate)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
    }
    const result = computeBandEnergy(samples, sampleRate)
    const midFrame = Math.floor(result.numFrames / 2)
    expect(result.bass[midFrame]).toBeGreaterThan(0.9)
    expect(result.treble[midFrame]).toBeLessThan(0.3)
  })

  it('lights up the treble band (not bass) for a high-frequency tone', () => {
    const sampleRate = 44100
    const freqHz = 6000 // clearly above the mid/treble boundary
    const samples = new Float32Array(sampleRate)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
    }
    const result = computeBandEnergy(samples, sampleRate)
    const midFrame = Math.floor(result.numFrames / 2)
    expect(result.treble[midFrame]).toBeGreaterThan(0.9)
    expect(result.bass[midFrame]).toBeLessThan(0.3)
  })

  it('every value stays within [0, 1]', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 300 * i) / sampleRate) * 0.8
    }
    const result = computeBandEnergy(samples, sampleRate)
    for (const arr of [result.bass, result.mid, result.treble]) {
      for (const v of arr) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
