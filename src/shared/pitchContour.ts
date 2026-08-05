import { fftInPlace, nextPowerOfTwo } from './fft'

export interface PitchContourOptions {
  /** Analysis window length, in the ORIGINAL (pre-decimation) sample domain
   * — larger windows resolve lower fundamentals more reliably (need ~2+
   * periods to autocorrelate against) at the cost of time resolution.
   * Default 2048. */
  windowSize?: number
  /** Frame spacing, in the ORIGINAL sample domain — independent of
   * windowSize, so overlapping windows are normal. Should match whatever
   * x-axis timing the caller is positioning frames against (BeatPicker
   * computes each frame's x position as `t * hopSize / totalSamples`).
   * Default 1024. */
  hopSize?: number
  /** Fundamental frequency search range. Default 60-2000Hz covers typical
   * bass through lead-melody range; wider ranges cost autocorrelation
   * accuracy at both ends for content Endlesss/LORE stems rarely have
   * meaningful fundamentals in anyway. */
  minFreqHz?: number
  maxFreqHz?: number
  /** Normalized autocorrelation value (0-1) the best lag must clear to be
   * reported as a confident pitch — below this, the frame is treated as
   * unpitched (percussive/noisy/silent) rather than guessing. A wrong pitch
   * drawn on screen is worse than a gap. Default 0.6. */
  confidenceThreshold?: number
}

export interface PitchContour {
  numFrames: number
  /** Estimated fundamental frequency per frame, in Hz — 0 where no
   * confident pitch was found (silence, noise, percussive transient). */
  freqHz: Float32Array
}

// Fundamental-frequency detection only needs enough sample rate to resolve
// up to maxFreqHz (Nyquist) with headroom for autocorrelation to behave
// well — running the FFT-based autocorrelation below at a stem's full
// 44.1kHz+ rate would cost several times more per frame for no benefit at
// these frequencies, so everything is decimated down to roughly this rate
// first (naive nearest-sample decimation — anti-aliasing quality doesn't
// matter for a rough visual pitch guide the way it would for audio output).
const ANALYSIS_RATE_HZ = 6000

/**
 * Per-frame fundamental frequency estimate via normalized autocorrelation
 * (computed the fast way, through the power spectrum — see the
 * Wiener-Khinchin comment below — rather than a direct O(window*lagRange)
 * loop, which was too slow to run synchronously across every stem in a
 * rifff). A simplified YIN-style pitch tracker: good enough as a "where's
 * the melody" visual aid, not lab-grade pitch detection.
 */
export function computePitchContour(
  samples: Float32Array,
  sampleRate: number,
  opts: PitchContourOptions = {}
): PitchContour {
  const windowSize = opts.windowSize ?? 2048
  const hopSize = opts.hopSize ?? 1024
  const minFreqHz = opts.minFreqHz ?? 60
  const maxFreqHz = opts.maxFreqHz ?? 2000
  const confidenceThreshold = opts.confidenceThreshold ?? 0.6

  if (samples.length === 0 || sampleRate <= 0) {
    return { numFrames: 0, freqHz: new Float32Array(0) }
  }

  const numFrames = Math.max(1, Math.ceil(samples.length / hopSize))
  const freqHz = new Float32Array(numFrames)

  const decimation = Math.max(1, Math.floor(sampleRate / ANALYSIS_RATE_HZ))
  const effectiveRate = sampleRate / decimation
  const decimated = new Float32Array(Math.ceil(samples.length / decimation))
  for (let i = 0; i < decimated.length; i++) decimated[i] = samples[i * decimation]

  const decWindowSize = Math.max(32, Math.round(windowSize / decimation))
  const paddedSize = nextPowerOfTwo(decWindowSize * 2)
  const minLag = Math.max(1, Math.round(effectiveRate / maxFreqHz))
  const maxLag = Math.min(decWindowSize - 1, Math.round(effectiveRate / minFreqHz))

  const real = new Float64Array(paddedSize)
  const imag = new Float64Array(paddedSize)

  for (let t = 0; t < numFrames; t++) {
    const decStart = Math.floor((t * hopSize) / decimation)
    real.fill(0)
    imag.fill(0)
    let energy = 0
    const available = Math.min(decWindowSize, Math.max(0, decimated.length - decStart))
    for (let i = 0; i < available; i++) {
      const v = decimated[decStart + i]
      real[i] = v
      energy += v * v
    }
    // Silence guard (no periodicity to find) and a "mostly padding" guard
    // (a window that ran off the end of the signal isn't a meaningful frame).
    if (energy < 1e-9 || available < decWindowSize / 2) continue

    // Autocorrelation via Wiener-Khinchin: the power spectrum |FFT(x)|^2 is
    // itself real and symmetric (since x is real), so a second forward FFT
    // of it lands directly on (paddedSize times) the real autocorrelation —
    // no separate inverse-FFT step or conjugate trick needed, unlike a
    // general complex signal. Zero-padding to 2x the window length beforehand
    // keeps that circularity from wrapping real lags back around into the
    // range read below.
    fftInPlace(real, imag)
    for (let i = 0; i < paddedSize; i++) {
      const mag2 = real[i] * real[i] + imag[i] * imag[i]
      real[i] = mag2
      imag[i] = 0
    }
    fftInPlace(real, imag)
    const zeroLag = real[0]
    if (zeroLag <= 0) continue

    let bestLag = -1
    let bestScore = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      const score = real[lag] / zeroLag
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }

    if (bestLag > 0 && bestScore >= confidenceThreshold) {
      freqHz[t] = effectiveRate / bestLag
    }
  }

  return { numFrames, freqHz }
}

export interface VoicedPitchFeatures {
  /** Fraction of frames (0-1) with a confident pitch estimate -- see
   * PitchContour.freqHz's own doc comment: 0 means unvoiced. Splits
   * pitched material (lead/backing melodies) from unpitched (drums,
   * noise, most percussive one-shots) for clustering purposes. */
  voicedFraction: number
  /** Variance of the VOICED frames' own pitch, in cents (log-frequency
   * space) around their mean -- NOT raw Hz variance, which isn't
   * musically comparable across registers (an octave spans a vastly
   * different Hz range depending on how high/low the pitch already is).
   * Unvoiced frames are excluded entirely, not treated as 0 Hz -- a mix
   * of silence and one constant pitch has zero real pitch variance, not
   * enormous variance from spuriously including the silent gaps. */
  pitchVarianceCents: number
}

export function voicedPitchFeatures(contour: PitchContour): VoicedPitchFeatures {
  const voiced: number[] = []
  for (let i = 0; i < contour.freqHz.length; i++) {
    if (contour.freqHz[i] > 0) voiced.push(contour.freqHz[i])
  }

  const voicedFraction = contour.numFrames > 0 ? voiced.length / contour.numFrames : 0
  if (voiced.length === 0) return { voicedFraction, pitchVarianceCents: 0 }

  const cents = voiced.map((hz) => 1200 * Math.log2(hz))
  const mean = cents.reduce((sum, c) => sum + c, 0) / cents.length
  const variance = cents.reduce((sum, c) => sum + (c - mean) ** 2, 0) / cents.length

  return { voicedFraction, pitchVarianceCents: variance }
}
