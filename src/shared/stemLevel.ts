// src/shared/stemLevel.ts
//
// THE LOUDNESS MEASUREMENT (spec 2026-10-05-radio-intensity-arc-design section 7): three numbers
// per stem from ALL channels of the buffer the analysis already decoded -- the radio's intensity
// score (radioIntensity.ts) reads them as library percentiles. Pure, no allocation beyond one
// block-power array; runs in the analysis worker (stemAnalysisWorker.ts).
//
// - loudnessLufs: integrated loudness, ITU-R BS.1770-4 (as EBU R 128 uses it): K-weighting (the
//   pre-filter shelf and the RLB high-pass, designed for the buffer's own sample rate by the
//   bilinear transform, so 44.1 and 48 kHz agree), 400 ms blocks every 100 ms, channel energies
//   summed (weight 1 each), an absolute gate at -70 LUFS and a relative gate 10 LU under the
//   absolute-gated loudness. Null when no block passes (silence).
// - lowLevelDb: the level under ~150 Hz in dBFS -- the mean square over the whole stem, ungated,
//   after a 2nd-order Butterworth low-pass, averaged over the channels (an identical-channel
//   stereo stem reads as its mono). How much low end a loop puts down over its length: a sparse
//   kick weighs less than a rolling bassline. Null for silence.
// - activeFraction: the share of the 100 ms hops whose block is within ACTIVE_WINDOW_LU of
//   loudnessLufs and above the absolute gate. How much of the loop sounds. In [0, 1]; 0 for
//   silence.

/** The level pass's version, stored as StemFeatures.levelVersion. Bump to re-measure every stem
 * (the backfill re-runs only this pass, on the one decode). */
export const STEM_LEVEL_VERSION = 1

export interface StemLevel {
  loudnessLufs: number | null
  lowLevelDb: number | null
  activeFraction: number
}

/** BS.1770's block and hop, in seconds. */
export const LOUDNESS_BLOCK_SEC = 0.4
export const LOUDNESS_HOP_SEC = 0.1
export const LOUDNESS_ABSOLUTE_GATE = -70
export const LOUDNESS_RELATIVE_GATE_LU = -10
/** A hop is "active" when its block is within this many LU of the stem's loudness. */
export const ACTIVE_WINDOW_LU = 20
/** The low band's corner. */
export const LOW_LEVEL_CUTOFF_HZ = 150
/** Below this mean square (-140 dBFS) a stem has no low end to speak of: null. */
const SILENT_MEAN_SQUARE = 1e-14

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** BS.1770's stage 1 (the head's high shelf), for `fs` -- the bilinear design libebur128 and
 * pyloudnorm use; at 48 kHz it is the standard's own table. */
export function kWeightingShelf(fs: number): Biquad {
  const f0 = 1681.974450955533
  const G = 3.999843853973347
  const Q = 0.7071752369554196
  const K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/** BS.1770's stage 2 (the RLB high-pass), for `fs`. */
export function kWeightingHighPass(fs: number): Biquad {
  const f0 = 38.13547087602444
  const Q = 0.5003270373238773
  const K = Math.tan((Math.PI * f0) / fs)
  const a0 = 1 + K / Q + K * K
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/** A 2nd-order Butterworth low-pass at `fc` (Q = 1/sqrt 2), by the bilinear transform. */
export function butterworthLowPass(fc: number, fs: number): Biquad {
  const K = Math.tan((Math.PI * Math.min(fc, fs * 0.49)) / fs)
  const Q = Math.SQRT1_2
  const a0 = 1 + K / Q + K * K
  return {
    b0: (K * K) / a0,
    b1: (2 * K * K) / a0,
    b2: (K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/** Runs `x` through the biquads in series (direct form II transposed), returning the squared
 * output per sample through `sink`. */
function filterSquares(
  x: Float32Array,
  stages: readonly Biquad[],
  sink: (i: number, y2: number) => void
): void {
  const z1 = new Float64Array(stages.length)
  const z2 = new Float64Array(stages.length)
  for (let i = 0; i < x.length; i++) {
    let v = x[i]
    for (let s = 0; s < stages.length; s++) {
      const f = stages[s]
      const y = f.b0 * v + z1[s]
      z1[s] = f.b1 * v - f.a1 * y + z2[s]
      z2[s] = f.b2 * v - f.a2 * y
      v = y
    }
    sink(i, v * v)
  }
}

const lufsOf = (power: number): number => -0.691 + 10 * Math.log10(power)
const round = (v: number, places: number): number => {
  const k = Math.pow(10, places)
  return Math.round(v * k) / k
}

/** The three numbers for a decoded stem (`channels`: one Float32Array per channel, equal
 * lengths; a shorter one counts as silent past its end). Rounded to 0.01 dB and 0.001. */
export function stemLevelFeatures(
  channels: readonly Float32Array[],
  sampleRate: number
): StemLevel {
  const silent: StemLevel = { loudnessLufs: null, lowLevelDb: null, activeFraction: 0 }
  const n = channels.reduce((m, c) => Math.max(m, c.length), 0)
  if (channels.length === 0 || n === 0 || !(sampleRate > 0)) return silent

  // K-weighted energy per 100 ms hop, summed over channels (G = 1 each)
  const hop = Math.max(1, Math.round(LOUDNESS_HOP_SEC * sampleRate))
  const hops = Math.floor(n / hop)
  const hopEnergy = new Float64Array(Math.max(1, hops))
  const k = [kWeightingShelf(sampleRate), kWeightingHighPass(sampleRate)]
  const lp = [butterworthLowPass(LOW_LEVEL_CUTOFF_HZ, sampleRate)]
  let lowSum = 0
  for (const ch of channels) {
    filterSquares(ch, k, (i, y2) => {
      const h = Math.floor(i / hop)
      if (h < hops) hopEnergy[h] += y2
    })
    filterSquares(ch, lp, (_i, y2) => {
      lowSum += y2
    })
  }
  const lowMeanSquare = lowSum / (n * channels.length)
  const lowLevelDb =
    lowMeanSquare > SILENT_MEAN_SQUARE ? round(10 * Math.log10(lowMeanSquare), 2) : null

  // 400 ms blocks = 4 hops, every hop (75% overlap). A stem under one block is one short block.
  const perBlock = Math.round(LOUDNESS_BLOCK_SEC / LOUDNESS_HOP_SEC)
  const blockSamples = perBlock * hop
  const blocks: number[] = []
  if (hops >= perBlock) {
    let run = 0
    for (let h = 0; h < hops; h++) {
      run += hopEnergy[h]
      if (h >= perBlock) run -= hopEnergy[h - perBlock]
      if (h >= perBlock - 1) blocks.push(run / blockSamples)
    }
  } else if (hops > 0) {
    let run = 0
    for (let h = 0; h < hops; h++) run += hopEnergy[h]
    blocks.push(run / (hops * hop))
  }
  const absolute = blocks.filter((p) => p > 0 && lufsOf(p) > LOUDNESS_ABSOLUTE_GATE)
  if (absolute.length === 0) return { ...silent, lowLevelDb }
  const absMean = absolute.reduce((a, b) => a + b, 0) / absolute.length
  const relGate = lufsOf(absMean) + LOUDNESS_RELATIVE_GATE_LU
  const gated = absolute.filter((p) => lufsOf(p) > relGate)
  const power = gated.reduce((a, b) => a + b, 0) / gated.length
  const loudness = lufsOf(power)
  const active = blocks.filter((p) => {
    if (!(p > 0)) return false
    const l = lufsOf(p)
    return l > LOUDNESS_ABSOLUTE_GATE && l >= loudness - ACTIVE_WINDOW_LU
  }).length
  return {
    loudnessLufs: round(loudness, 2),
    lowLevelDb,
    activeFraction: round(active / blocks.length, 3)
  }
}
