import { describe, expect, it } from 'vitest'
import { fftInPlace, magnitudeSpectrum, nextPowerOfTwo } from './fft'

describe('fftInPlace', () => {
  it('throws on a non-power-of-two length', () => {
    expect(() => fftInPlace(new Float64Array(6), new Float64Array(6))).toThrow()
  })

  it('throws when real and imag lengths differ', () => {
    expect(() => fftInPlace(new Float64Array(8), new Float64Array(4))).toThrow()
  })

  it('is a no-op on an empty array', () => {
    expect(() => fftInPlace(new Float64Array(0), new Float64Array(0))).not.toThrow()
  })

  it('puts all energy in bin 0 for a constant (DC) signal', () => {
    const n = 64
    const real = new Float64Array(n).fill(1)
    const imag = new Float64Array(n)
    fftInPlace(real, imag)
    expect(real[0]).toBeCloseTo(n, 5) // sum of all samples
    for (let i = 1; i < n; i++) {
      expect(Math.hypot(real[i], imag[i])).toBeCloseTo(0, 5)
    }
  })

  it('puts a single sharp peak at bin k for a pure sine at exactly k cycles per window', () => {
    const n = 64
    const k = 5 // exactly 5 full cycles across the window -> energy only at bin 5 (and its mirror, n-5)
    const real = new Float64Array(n)
    const imag = new Float64Array(n)
    for (let i = 0; i < n; i++) real[i] = Math.sin((2 * Math.PI * k * i) / n)
    fftInPlace(real, imag)

    const magnitude = (i: number): number => Math.hypot(real[i], imag[i])
    expect(magnitude(k)).toBeGreaterThan(n / 4) // strong peak
    expect(magnitude(n - k)).toBeGreaterThan(n / 4) // mirror image (real input)
    // Everywhere else should be near zero.
    for (let i = 0; i < n; i++) {
      if (i === k || i === n - k) continue
      expect(magnitude(i)).toBeLessThan(1e-9)
    }
  })

  it('recovers the original signal via its own inverse (conjugate-FFT-conjugate/N trick)', () => {
    const n = 32
    const original = new Float64Array(n)
    for (let i = 0; i < n; i++) original[i] = Math.sin((2 * Math.PI * 3 * i) / n) + 0.5
    const real = Float64Array.from(original)
    const imag = new Float64Array(n)
    fftInPlace(real, imag)
    // Inverse FFT = conjugate, forward FFT, conjugate, divide by N.
    for (let i = 0; i < n; i++) imag[i] = -imag[i]
    fftInPlace(real, imag)
    for (let i = 0; i < n; i++) {
      expect(real[i] / n).toBeCloseTo(original[i], 6)
    }
  })
})

describe('nextPowerOfTwo', () => {
  it('returns 1 for 0 or 1', () => {
    expect(nextPowerOfTwo(0)).toBe(1)
    expect(nextPowerOfTwo(1)).toBe(1)
  })

  it('returns the value unchanged when already a power of two', () => {
    expect(nextPowerOfTwo(64)).toBe(64)
  })

  it('rounds up to the next power of two otherwise', () => {
    expect(nextPowerOfTwo(65)).toBe(128)
    expect(nextPowerOfTwo(1000)).toBe(1024)
  })
})

describe('magnitudeSpectrum', () => {
  it('returns fftSize/2 + 1 bins (DC through Nyquist)', () => {
    const windowed = new Float64Array(64)
    expect(magnitudeSpectrum(windowed).length).toBe(33)
  })

  it('shows a peak at the bin nearest a pure tone’s frequency', () => {
    const n = 512
    const sampleRate = 44100
    const freqHz = 1000
    const windowed = new Float64Array(n)
    for (let i = 0; i < n; i++) windowed[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
    const spectrum = magnitudeSpectrum(windowed)

    const expectedBin = Math.round((freqHz * n) / sampleRate)
    let peakBin = 0
    for (let i = 1; i < spectrum.length; i++) {
      if (spectrum[i] > spectrum[peakBin]) peakBin = i
    }
    expect(peakBin).toBe(expectedBin)
  })
})
