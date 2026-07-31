/**
 * In-place radix-2 Cooley-Tukey FFT, iterative (bit-reversal permutation +
 * butterfly passes) rather than recursive — standard textbook algorithm,
 * no external dependency. `real`/`imag` must be the same power-of-two
 * length; `imag` is typically all zeros for real-valued audio input.
 * Operates on the arrays directly (no allocation beyond a couple of
 * scratch scalars), since this runs once per FFT window in a spectrogram
 * and gets called many times per stem.
 */
export function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const n = real.length
  if (n !== imag.length) throw new Error('fftInPlace: real and imag must be the same length')
  if (n === 0) return
  if ((n & (n - 1)) !== 0) throw new Error('fftInPlace: length must be a power of two')

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = real[i]
      real[i] = real[j]
      real[j] = tr
      const ti = imag[i]
      imag[i] = imag[j]
      imag[j] = ti
    }
  }

  // Butterfly passes.
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1
    const angleStep = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < halfSize; k++) {
        const angle = angleStep * k
        const wr = Math.cos(angle)
        const wi = Math.sin(angle)
        const evenIdx = start + k
        const oddIdx = start + k + halfSize
        const evenR = real[evenIdx]
        const evenI = imag[evenIdx]
        const oddR = real[oddIdx]
        const oddI = imag[oddIdx]
        const twiddledR = oddR * wr - oddI * wi
        const twiddledI = oddR * wi + oddI * wr
        real[evenIdx] = evenR + twiddledR
        imag[evenIdx] = evenI + twiddledI
        real[oddIdx] = evenR - twiddledR
        imag[oddIdx] = evenI - twiddledI
      }
    }
  }
}

/** Next power of two >= n (n=0 returns 1). */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1
  return 2 ** Math.ceil(Math.log2(n))
}

/**
 * Magnitude spectrum (length fftSize/2 + 1, DC through Nyquist) of one
 * windowed frame — `windowed` must already have any window function (Hann,
 * etc.) applied and be padded/truncated to exactly `fftSize` samples.
 * Allocates fresh real/imag scratch arrays per call — fine at the frame
 * rate a spectrogram calls this at (tens to low hundreds of times per
 * stem), not a hot per-sample path.
 */
export function magnitudeSpectrum(windowed: Float64Array): Float64Array {
  const n = windowed.length
  const real = Float64Array.from(windowed)
  const imag = new Float64Array(n)
  fftInPlace(real, imag)
  const numBins = n / 2 + 1
  const magnitudes = new Float64Array(numBins)
  for (let i = 0; i < numBins; i++) {
    magnitudes[i] = Math.hypot(real[i], imag[i])
  }
  return magnitudes
}
