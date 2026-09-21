// src/shared/stemAnalysis.ts
//
// The CPU-heavy half of per-stem feature extraction, as one pure function
// over already-decoded samples -- so it can run inside a Web Worker
// (renderer/src/audio/stemAnalysisWorker.ts) instead of on the renderer's
// main thread. Direct report, 2026-09-21: the ambient library scans ran
// this (pitch tracking, MFCC, band energy, transients) on the UI thread
// every half second, freezing typing/clicks. Decoding stays on the main
// thread (Web Audio's decodeAudioData isn't available in workers and is
// already async); only this analysis moves.
import { transientDensity, bassEnergyRatio } from './typeGuess'
import { computeBandEnergy } from './bandEnergy'
import { computePitchContour, voicedPitchFeatures, type PitchContour } from './pitchContour'
import { computeMfcc } from './mfcc'
import type { StemFeatures } from './stemFeatures'

export interface StemAnalysis {
  /** Also handed to pitchCache.ts, so Waveform/PolarGlyph never need a
   * second decode + pitch pass for a stem the scan already analyzed. */
  pitchContour: PitchContour
  transientDensity: number
  bassEnergyRatio: number
  spectralCentroidHz: number
  mfcc: number[]
}

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

export function analyzeStemSamples(samples: Float32Array, sampleRate: number): StemAnalysis {
  const bandEnergy = computeBandEnergy(samples, sampleRate)
  return {
    pitchContour: computePitchContour(samples, sampleRate),
    transientDensity: transientDensity(samples, sampleRate),
    bassEnergyRatio: bassEnergyRatio(samples, sampleRate),
    spectralCentroidHz: spectralCentroidFromBandEnergy(
      bandEnergy.bass,
      bandEnergy.mid,
      bandEnergy.treble
    ),
    mfcc: computeMfcc(samples, sampleRate)
  }
}

/** Cheap final step, on whichever thread: brightness comes from
 * peakCache.ts's own (usually persisted) zero-crossing pass. */
export function assembleStemFeatures(analysis: StemAnalysis, brightness: number[]): StemFeatures {
  const pitch = voicedPitchFeatures(analysis.pitchContour)
  return {
    transientDensity: analysis.transientDensity,
    bassEnergyRatio: analysis.bassEnergyRatio,
    spectralCentroidHz: analysis.spectralCentroidHz,
    zcrBrightness: averageArray(brightness),
    voicedFraction: pitch.voicedFraction,
    pitchVarianceCents: pitch.pitchVarianceCents,
    mfcc: analysis.mfcc
  }
}
