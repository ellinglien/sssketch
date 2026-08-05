import { magnitudeSpectrum, nextPowerOfTwo } from './fft'

const NUM_MEL_BANDS = 26
const NUM_COEFFICIENTS = 13

/** Hz <-> Mel, the standard (O'Shaughnessy) formula -- same one used
 * throughout speech/MIR literature and by every other MFCC implementation
 * this would need to be comparable to. */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

/** Hann window, applied in place -- smooths frame edges before the FFT so
 * spectral leakage doesn't dominate the result the way an unwindowed
 * rectangular frame would. Standard for any STFT-based analysis; this
 * codebase's own computeSpectrogram (src/shared/spectrogram.ts) applies
 * an equivalent window internally for the same reason. */
function applyHannWindow(frame: Float64Array): void {
  const n = frame.length
  for (let i = 0; i < n; i++) {
    frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }
}

/** Triangular mel filterbank -- one row per mel band, one column per FFT
 * magnitude bin. Each filter rises linearly from 0 at its left edge to 1
 * at its own center, then falls back to 0 at its right edge; edges come
 * from NUM_MEL_BANDS+2 equally-mel-spaced points across [minHz, maxHz],
 * converted to FFT bin indices. Standard MFCC filterbank construction. */
function buildMelFilterbank(
  numBins: number,
  sampleRate: number,
  fftSize: number,
  minHz: number,
  maxHz: number
): Float64Array[] {
  const melMin = hzToMel(minHz)
  const melMax = hzToMel(maxHz)
  const melPoints = new Array<number>(NUM_MEL_BANDS + 2)
  for (let i = 0; i < melPoints.length; i++) {
    melPoints[i] = melMin + ((melMax - melMin) * i) / (NUM_MEL_BANDS + 1)
  }
  const hzPoints = melPoints.map(melToHz)
  const binPoints = hzPoints.map((hz) => Math.floor(((fftSize + 1) * hz) / sampleRate))

  const filters: Float64Array[] = []
  for (let band = 1; band <= NUM_MEL_BANDS; band++) {
    const filter = new Float64Array(numBins)
    const left = binPoints[band - 1]
    const center = binPoints[band]
    const right = binPoints[band + 1]
    for (let bin = left; bin < center; bin++) {
      if (bin >= 0 && bin < numBins && center > left) filter[bin] = (bin - left) / (center - left)
    }
    for (let bin = center; bin < right; bin++) {
      if (bin >= 0 && bin < numBins && right > center)
        filter[bin] = (right - bin) / (right - center)
    }
    filters.push(filter)
  }
  return filters
}

/** Discrete Cosine Transform, Type II -- the standard final step of an
 * MFCC pipeline (decorrelates the log-mel-energies into coefficients
 * roughly ordered from "overall spectral shape" to "fine spectral
 * detail"). Direct O(N*K) computation -- N is NUM_MEL_BANDS (26), K is
 * NUM_COEFFICIENTS (13), both tiny, so there's no need for a fast DCT
 * algorithm here. */
function dct(input: number[], numCoefficients: number): number[] {
  const n = input.length
  const out = new Array<number>(numCoefficients)
  for (let k = 0; k < numCoefficients; k++) {
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += input[i] * Math.cos((Math.PI / n) * (i + 0.5) * k)
    }
    out[k] = sum
  }
  return out
}

/**
 * MFCCs (Mel-Frequency Cepstral Coefficients), averaged across every
 * analysis frame into one fixed-length 13-number vector -- the standard
 * timbre descriptor for audio similarity/clustering. Frames the input at
 * a fixed window/hop (matching pitchContour.ts's own windowSize/hopSize
 * defaults, for consistency across this codebase's analysis functions),
 * computes the mel-filtered log-magnitude spectrum per frame via a DCT,
 * then averages across all frames -- clustering needs one vector per
 * stem, not one per frame.
 */
export function computeMfcc(samples: Float32Array, sampleRate: number): number[] {
  const windowSize = 2048
  const hopSize = 1024
  const fftSize = nextPowerOfTwo(windowSize)
  const numBins = fftSize / 2 + 1
  const nyquist = sampleRate / 2
  const filterbank = buildMelFilterbank(numBins, sampleRate, fftSize, 20, Math.min(8000, nyquist))

  const numFrames = Math.max(1, Math.ceil(samples.length / hopSize))
  const sums = new Array<number>(NUM_COEFFICIENTS).fill(0)
  let framesUsed = 0

  for (let t = 0; t < numFrames; t++) {
    const start = t * hopSize
    const available = Math.min(windowSize, Math.max(0, samples.length - start))
    if (available === 0) continue

    const frame = new Float64Array(fftSize)
    for (let i = 0; i < available; i++) frame[i] = samples[start + i]
    applyHannWindow(frame)

    const spectrum = magnitudeSpectrum(frame)
    const melEnergies = filterbank.map((filter) => {
      let energy = 0
      for (let bin = 0; bin < numBins; bin++) energy += filter[bin] * spectrum[bin]
      // Floor before log -- a true-zero mel-band energy (silence, or a
      // band with no filter overlap for a very short/low-rate input) would
      // otherwise produce -Infinity and poison every downstream coefficient.
      return Math.log(Math.max(energy, 1e-10))
    })

    const coefficients = dct(melEnergies, NUM_COEFFICIENTS)
    for (let k = 0; k < NUM_COEFFICIENTS; k++) sums[k] += coefficients[k]
    framesUsed++
  }

  if (framesUsed === 0) return new Array<number>(NUM_COEFFICIENTS).fill(0)
  return sums.map((s) => s / framesUsed)
}
