import { fftInPlace, nextPowerOfTwo } from './fft'

export interface SpectrogramOptions {
  /** Rounded up to the nearest power of two. Default 1024 — at a typical
   * 44.1kHz stem, ~23ms per window, a reasonable time/frequency tradeoff
   * for spotting note onsets without smearing them across many frames. */
  fftSize?: number
  /** Default fftSize/2 (50% overlap). */
  hopSize?: number
  /** Log-frequency display range — default 40Hz (below typical sub-bass
   * fundamentals) to 8kHz (covers bass through most melodic/harmonic
   * content and cymbal shimmer; LORE/Endlesss stems are rarely hi-fi
   * enough for meaningful energy above this anyway). Clamped to the
   * source's own Nyquist frequency regardless of what's requested. */
  minFreqHz?: number
  maxFreqHz?: number
  /** Output row count — log-spaced across [minFreqHz, maxFreqHz], NOT the
   * raw linear FFT bin count, since musical pitch perception (and so
   * "where does the melody repeat") is logarithmic in frequency: without
   * this, all the harmonically interesting midrange/treble content would
   * be crushed into a handful of pixel rows at the top of a linear plot.
   * Default 48. */
  numFreqBins?: number
  /** dB below the loudest frame in the whole signal that maps to
   * intensity 0 — everything louder scales linearly (in dB) up to 1 at
   * the loudest point. A smaller (less negative) value gives a
   * punchier/higher-contrast image; a larger one keeps more low-level
   * detail visible. Default 60. */
  dynamicRangeDb?: number
}

export interface Spectrogram {
  numFrames: number
  numFreqBins: number
  /** Row-major [frame * numFreqBins + freqBin], each value normalized to
   * [0, 1] — 0 is silence-or-below-the-dynamic-range-floor, 1 is the
   * loudest point anywhere in the whole spectrogram. freqBin 0 is the
   * LOWEST frequency (minFreqHz), freqBin numFreqBins-1 the highest. */
  data: Float32Array
}

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size)
  const denom = Math.max(1, size - 1)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
  }
  return w
}

/**
 * STFT-based spectrogram of a mono PCM signal, binned to a small number of
 * LOG-frequency rows suitable for a compact on-screen display — see
 * BeatPicker.tsx, where this replaces (well, supplements) a plain waveform
 * so note onsets and melodic phrasing are visible directly, not just
 * overall amplitude.
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  opts: SpectrogramOptions = {}
): Spectrogram {
  const numFreqBins = opts.numFreqBins ?? 48
  if (samples.length === 0 || sampleRate <= 0) {
    return { numFrames: 0, numFreqBins, data: new Float32Array(0) }
  }

  const fftSize = nextPowerOfTwo(opts.fftSize ?? 1024)
  const hopSize = opts.hopSize ?? fftSize / 2
  const minFreqHz = Math.max(1, opts.minFreqHz ?? 40)
  const nyquist = sampleRate / 2
  const maxFreqHz = Math.min(opts.maxFreqHz ?? 8000, nyquist)
  const dynamicRangeDb = opts.dynamicRangeDb ?? 60

  const window = hannWindow(fftSize)
  const numFrames = Math.max(1, Math.ceil(samples.length / hopSize))
  const numLinearBins = fftSize / 2 + 1
  const freqPerLinearBin = sampleRate / fftSize

  // Log-spaced frequency bin edges, mapped to linear FFT bin indices once
  // up front (shared by every frame) rather than recomputed per frame.
  const logMin = Math.log2(minFreqHz)
  const logMax = Math.log2(Math.max(minFreqHz * 2, maxFreqHz))
  const binEdges: number[] = []
  for (let b = 0; b <= numFreqBins; b++) {
    const freq = 2 ** (logMin + ((logMax - logMin) * b) / numFreqBins)
    const linearBin = Math.round(freq / freqPerLinearBin)
    binEdges.push(Math.min(numLinearBins - 1, Math.max(0, linearBin)))
  }

  const dbFrames: Float64Array[] = new Array(numFrames)
  let maxDb = -Infinity
  const real = new Float64Array(fftSize)
  const imag = new Float64Array(fftSize)

  for (let t = 0; t < numFrames; t++) {
    const start = t * hopSize
    real.fill(0)
    imag.fill(0)
    const available = Math.min(fftSize, Math.max(0, samples.length - start))
    for (let i = 0; i < available; i++) {
      real[i] = samples[start + i] * window[i]
    }

    fftInPlace(real, imag)

    const frameDb = new Float64Array(numFreqBins)
    for (let b = 0; b < numFreqBins; b++) {
      const lo = binEdges[b]
      const hi = Math.max(lo + 1, binEdges[b + 1])
      // Peak (not average) magnitude within this log-bin's underlying
      // linear FFT bins — keeps sharp harmonics visible instead of
      // smearing them out, which matters more here than the wider bins at
      // the top of the log range being slightly less "faithful."
      let peak = 0
      for (let i = lo; i < hi && i < numLinearBins; i++) {
        const mag = Math.hypot(real[i], imag[i])
        if (mag > peak) peak = mag
      }
      const db = 20 * Math.log10(peak + 1e-9)
      frameDb[b] = db
      if (db > maxDb) maxDb = db
    }
    dbFrames[t] = frameDb
  }

  const data = new Float32Array(numFrames * numFreqBins)
  // True digital silence (every sample exactly 0, e.g. an empty/muted stem)
  // has no real "loudest point" to normalize against — every bin lands on
  // the same -180dB noise floor from the `+ 1e-9` guard above, which would
  // otherwise normalize to a false, uniform 1.0 rather than 0. Below this
  // absolute floor, skip normalization entirely and report flat silence.
  const ABSOLUTE_SILENCE_DB = -100
  if (maxDb < ABSOLUTE_SILENCE_DB) return { numFrames, numFreqBins, data }

  const floor = maxDb - dynamicRangeDb
  const range = maxDb - floor || 1
  for (let t = 0; t < numFrames; t++) {
    const frameDb = dbFrames[t]
    for (let b = 0; b < numFreqBins; b++) {
      const normalized = (frameDb[b] - floor) / range
      data[t * numFreqBins + b] = Math.max(0, Math.min(1, normalized))
    }
  }

  return { numFrames, numFreqBins, data }
}
