import type { SoundType } from './types'

/**
 * Heuristic sound-type detection from raw PCM samples, run once at import so a
 * rifff doesn't land with every stem defaulted to 'fx'. Deliberately narrow: only
 * bass and drums are guessed confidently enough to be worth it — everything else
 * stays 'fx' (still user-editable via the existing click-to-cycle control), since
 * guessing wrong across 6+ other categories from raw audio alone would be more
 * often wrong than right.
 */

function fullRMS(samples: Float32Array): number {
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  return Math.sqrt(sumSq / samples.length)
}

/** One-pole low-pass filter, RMS of the filtered signal. Cheap substitute for an
 * FFT-based spectral measure — good enough to tell "mostly sub-bass" from "not". */
function lowPassRMS(samples: Float32Array, sampleRate: number, cutoffHz: number): number {
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const dt = 1 / sampleRate
  const alpha = dt / (rc + dt)
  let prev = 0
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev)
    sumSq += prev * prev
  }
  return Math.sqrt(sumSq / samples.length)
}

/** Fraction of the signal's energy that survives a ~200Hz low-pass — close to 1
 * for something that's essentially all sub-bass, much lower once there's real
 * midrange/high content mixed in. */
export function bassEnergyRatio(samples: Float32Array, sampleRate: number): number {
  const full = fullRMS(samples)
  if (full < 1e-6) return 0
  return lowPassRMS(samples, sampleRate, 200) / full
}

/** Onset times, in seconds (each onset window's start), via short-window
 * (20ms) RMS jumps -- the one onset detector behind both transientDensity
 * below and onsetRhythm.ts's regularity measure. Window 0 is never an onset
 * (nothing before it to jump from). Empty for fewer than 2 windows. */
export function detectOnsetTimes(samples: Float32Array, sampleRate: number): number[] {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02))
  const numWindows = Math.floor(samples.length / windowSize)
  if (numWindows < 2) return []

  const rms: number[] = []
  for (let w = 0; w < numWindows; w++) {
    let sumSq = 0
    const start = w * windowSize
    for (let i = start; i < start + windowSize; i++) sumSq += samples[i] * samples[i]
    rms.push(Math.sqrt(sumSq / windowSize))
  }

  const onsets: number[] = []
  for (let w = 1; w < rms.length; w++) {
    // Both a relative jump (nearly doubling in one window) and an absolute floor
    // (0.02) so near-silence between hits doesn't count as an "attack" purely
    // from its own noise floor jittering.
    if (rms[w] > rms[w - 1] * 1.8 && rms[w] > 0.02) onsets.push((w * windowSize) / sampleRate)
  }
  return onsets
}

/** Sharp attacks per second (detectOnsetTimes above, per second of audio) --
 * drums have frequent, sudden transients; sustained/melodic material
 * doesn't. Its meaning and scale are fixed: it feeds the overnight
 * classifier's trained centroids via toFeatureArray. */
export function transientDensity(samples: Float32Array, sampleRate: number): number {
  const onsets = detectOnsetTimes(samples, sampleRate)
  if (onsets.length === 0) {
    // Same result the pre-refactor version gave for < 2 windows (0) and for
    // no attacks (0 / duration).
    return 0
  }
  return onsets.length / (samples.length / sampleRate)
}

export function guessSoundType(samples: Float32Array, sampleRate: number): SoundType | null {
  const bassRatio = bassEnergyRatio(samples, sampleRate)
  const density = transientDensity(samples, sampleRate)
  if (bassRatio > 0.75 && density < 2) return 'bass'
  if (density > 3) return 'drums'
  return null
}
