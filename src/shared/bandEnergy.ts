import { computeSpectrogram } from './spectrogram'

export interface BandEnergyOptions {
  /** Forwarded to computeSpectrogram — default 40Hz-8kHz/32 bins is plenty
   * of resolution to bucket into 3 bands; no need for the wider 48-bin
   * range the on-screen spectrogram display itself uses. */
  minFreqHz?: number
  maxFreqHz?: number
  numFreqBins?: number
  fftSize?: number
  hopSize?: number
}

export interface BandEnergy {
  numFrames: number
  /** Per-frame energy in [0, 1], one array per band — same "loudest point
   * anywhere in the signal maps to 1" normalization computeSpectrogram
   * itself uses (see its own doc comment), since these are read straight
   * off its output rather than re-normalized independently per band. */
  bass: Float32Array
  mid: Float32Array
  treble: Float32Array
}

// Bucket boundaries, in Hz — bass/mid/treble is a coarser, non-negotiable
// split for this feature (see the spectral-visualization mockup this
// implements), independent of whatever minFreqHz/maxFreqHz range the
// caller requests the underlying spectrogram computed over.
const BASS_MAX_HZ = 250
const MID_MAX_HZ = 2000

/**
 * Buckets computeSpectrogram's log-frequency bins into three energy bands
 * (bass/mid/treble) per time frame — for the radial glyph's "banded rings"
 * and the waveform's "brightness by treble" treatments (see
 * docs/superpowers/specs — spectral visualization mockup). Reuses
 * computeSpectrogram's own FFT pass rather than a second, parallel
 * frequency analysis: no new DSP here, just a different read of the same
 * data BeatPicker.tsx already computes for its spectrogram lane.
 */
export function computeBandEnergy(
  samples: Float32Array,
  sampleRate: number,
  opts: BandEnergyOptions = {}
): BandEnergy {
  const numFreqBins = opts.numFreqBins ?? 32
  const minFreqHz = Math.max(1, opts.minFreqHz ?? 40)
  const nyquist = sampleRate / 2
  const maxFreqHz = Math.min(opts.maxFreqHz ?? 8000, nyquist || 8000)

  const spectrogram = computeSpectrogram(samples, sampleRate, {
    minFreqHz,
    maxFreqHz,
    numFreqBins,
    fftSize: opts.fftSize,
    hopSize: opts.hopSize
  })

  const { numFrames } = spectrogram
  const bass = new Float32Array(numFrames)
  const mid = new Float32Array(numFrames)
  const treble = new Float32Array(numFrames)
  if (numFrames === 0) return { numFrames, bass, mid, treble }

  // Same log-bin-center formula computeSpectrogram uses internally to lay
  // out its own bin edges — duplicated here (not exported/shared) since
  // it's a few lines and this is the only other place that needs it. Each
  // bin's CENTER frequency (not its edge) decides which band it belongs
  // to, matching how a human would read "this bin represents roughly this
  // pitch."
  const logMin = Math.log2(minFreqHz)
  const logMax = Math.log2(Math.max(minFreqHz * 2, maxFreqHz))
  const band = new Array<'bass' | 'mid' | 'treble'>(numFreqBins)
  for (let b = 0; b < numFreqBins; b++) {
    const centerFreq = 2 ** (logMin + ((logMax - logMin) * (b + 0.5)) / numFreqBins)
    band[b] = centerFreq < BASS_MAX_HZ ? 'bass' : centerFreq < MID_MAX_HZ ? 'mid' : 'treble'
  }

  // Peak (not average) within each band per frame — consistent with
  // computeSpectrogram's own peak-within-log-bin choice (see its doc
  // comment): a single sharp harmonic in a band should light that band up,
  // not get diluted by averaging against mostly-quiet neighboring bins.
  for (let t = 0; t < numFrames; t++) {
    let bassPeak = 0
    let midPeak = 0
    let treblePeak = 0
    for (let b = 0; b < numFreqBins; b++) {
      const v = spectrogram.data[t * numFreqBins + b]
      if (band[b] === 'bass') {
        if (v > bassPeak) bassPeak = v
      } else if (band[b] === 'mid') {
        if (v > midPeak) midPeak = v
      } else {
        if (v > treblePeak) treblePeak = v
      }
    }
    bass[t] = bassPeak
    mid[t] = midPeak
    treble[t] = treblePeak
  }

  return { numFrames, bass, mid, treble }
}
