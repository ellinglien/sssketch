import { describe, expect, it } from 'vitest'
import { computeSpectrogram } from './spectrogram'

describe('computeSpectrogram', () => {
  it('returns zero frames for empty input', () => {
    const result = computeSpectrogram(new Float32Array(0), 44100)
    expect(result.numFrames).toBe(0)
    expect(result.data.length).toBe(0)
  })

  it('returns data.length === numFrames * numFreqBins', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate) // 1 second
    const result = computeSpectrogram(samples, sampleRate, { numFreqBins: 32 })
    expect(result.numFreqBins).toBe(32)
    expect(result.data.length).toBe(result.numFrames * 32)
    expect(result.numFrames).toBeGreaterThan(1)
  })

  it('produces roughly numFrames = ceil(numSamples / hopSize)', () => {
    const sampleRate = 44100
    const fftSize = 512
    const hopSize = 256
    const samples = new Float32Array(hopSize * 10) // exactly 10 hops worth
    const result = computeSpectrogram(samples, sampleRate, { fftSize, hopSize })
    expect(result.numFrames).toBe(10)
  })

  it('is entirely at or near the silence floor (0) for a silent signal', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate)
    const result = computeSpectrogram(samples, sampleRate, { numFreqBins: 24 })
    for (const v of result.data) {
      expect(v).toBeCloseTo(0, 5)
    }
  })

  it('lights up the log-frequency bin nearest a pure tone, and stays near 0 well away from it', () => {
    const sampleRate = 44100
    const freqHz = 440 // A4 — comfortably inside the default 40Hz-8kHz range
    const durationSec = 1
    const samples = new Float32Array(sampleRate * durationSec)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
    }
    const numFreqBins = 48
    const minFreqHz = 40
    const maxFreqHz = 8000
    const result = computeSpectrogram(samples, sampleRate, { numFreqBins, minFreqHz, maxFreqHz })

    // Which output row 440Hz should land in, via the same log-spacing
    // computeSpectrogram itself uses.
    const logMin = Math.log2(minFreqHz)
    const logMax = Math.log2(maxFreqHz)
    const expectedBin = Math.round((numFreqBins * (Math.log2(freqHz) - logMin)) / (logMax - logMin))

    // Check a frame comfortably inside the signal (skip the very first/last,
    // which can be a partially-windowed edge frame).
    const midFrame = Math.floor(result.numFrames / 2)
    const rowAt = (bin: number): number => result.data[midFrame * numFreqBins + bin]

    expect(rowAt(expectedBin)).toBeGreaterThan(0.9) // the loudest point overall, so ~1
    // Bins several steps away (well outside a single log-bin's width) should
    // be much quieter.
    expect(rowAt(0)).toBeLessThan(0.3)
    expect(rowAt(numFreqBins - 1)).toBeLessThan(0.3)
  })

  it('clamps maxFreqHz to the signal’s own Nyquist frequency', () => {
    // Should not throw or produce NaN/garbage when maxFreqHz is requested
    // above what a low sample rate can represent.
    const sampleRate = 8000
    const samples = new Float32Array(sampleRate)
    const result = computeSpectrogram(samples, sampleRate, { maxFreqHz: 20000, numFreqBins: 16 })
    for (const v of result.data) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})
