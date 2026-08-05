import { transientDensity, bassEnergyRatio } from '@shared/typeGuess'
import { computeBandEnergy } from '@shared/bandEnergy'
import { voicedPitchFeatures } from '@shared/pitchContour'
import { computeMfcc } from '@shared/mfcc'
import type { StemFeatures } from '@shared/stemFeatures'
import { getAudioContext, getBrightness } from './peakCache'
import { getPitchContour } from './pitchCache'

const cache = new Map<string, Promise<StemFeatures>>()

// Geometric-mean center frequency of each of computeBandEnergy's own fixed
// bass/mid/treble bands (bass: [40,250), mid: [250,2000), treble:
// [2000,8000]) -- used to turn its per-frame band-energy arrays into one
// weighted-average scalar spectral centroid, in Hz.
const BAND_CENTER_HZ = {
  bass: Math.sqrt(40 * 250),
  mid: Math.sqrt(250 * 2000),
  treble: Math.sqrt(2000 * 8000)
}

function averageArray(values: ArrayLike<number>): number {
  if (values.length === 0) return 0
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  return sum / values.length
}

function spectralCentroidFromBandEnergy(
  bass: Float32Array,
  mid: Float32Array,
  treble: Float32Array
): number {
  let weightedSum = 0
  let totalEnergy = 0
  for (let t = 0; t < bass.length; t++) {
    const energy = bass[t] + mid[t] + treble[t]
    weightedSum +=
      bass[t] * BAND_CENTER_HZ.bass +
      mid[t] * BAND_CENTER_HZ.mid +
      treble[t] * BAND_CENTER_HZ.treble
    totalEnergy += energy
  }
  return totalEnergy > 1e-10 ? weightedSum / totalEnergy : 0
}

function computeFeatures(
  samples: Float32Array,
  sampleRate: number,
  brightness: number[],
  pitchFeatures: ReturnType<typeof voicedPitchFeatures>
): StemFeatures {
  const bandEnergy = computeBandEnergy(samples, sampleRate)
  return {
    transientDensity: transientDensity(samples, sampleRate),
    bassEnergyRatio: bassEnergyRatio(samples, sampleRate),
    spectralCentroidHz: spectralCentroidFromBandEnergy(
      bandEnergy.bass,
      bandEnergy.mid,
      bandEnergy.treble
    ),
    zcrBrightness: averageArray(brightness),
    voicedFraction: pitchFeatures.voicedFraction,
    pitchVarianceCents: pitchFeatures.pitchVarianceCents,
    mfcc: computeMfcc(samples, sampleRate)
  }
}

/**
 * Per-path cached feature vector for clustering -- mirrors peakCache.ts's
 * own shape (Map<string, Promise<T>>, evict on rejection). Reuses
 * getBrightness (peakCache.ts) and getPitchContour (pitchCache.ts) for
 * the two features those already compute; does its OWN separate decode
 * for the remaining features (transientDensity, bassEnergyRatio, spectral
 * centroid, MFCC), none of which either existing cache exposes the raw
 * sample buffer for. Shares peakCache.ts's own AudioContext singleton
 * (via its exported getAudioContext()) rather than constructing a second
 * one.
 */
export function getStemFeatures(path: string): Promise<StemFeatures> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const [brightness, pitchContour, bytes] = await Promise.all([
        getBrightness(path),
        getPitchContour(path),
        window.rifffApi.readAudioFile(path)
      ])
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const samples = audioBuffer.getChannelData(0)
      const pitchFeatures = voicedPitchFeatures(pitchContour)
      return computeFeatures(samples, audioBuffer.sampleRate, brightness, pitchFeatures)
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}
