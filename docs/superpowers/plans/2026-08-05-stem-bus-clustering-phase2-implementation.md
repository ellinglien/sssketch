# Stem Bus Clustering Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user cluster a project's stems by audio similarity (not just time-overlap), audition
each cluster visually and by ear, and assign it to one of phase 1's 5 fixed buses — replacing
"everything defaults to aux" with real, judged grouping.

**Architecture:** New pure DSP/algorithm functions in `src/shared/` (MFCC, voiced-pitch features,
feature-vector assembly, agglomerative clustering) — all TDD, all framework-agnostic. A new
renderer-side cache (`stemFeaturesCache.ts`, mirroring `peakCache.ts`'s exact shape) does the actual
audio decode and wires the pure functions together, reusing `getBrightness`/`getPitchContour` where
those already compute what's needed. A new modal UI (`ClusterStemsBrowser.tsx`) drives the whole
flow and dispatches phase 1's already-built `ASSIGN_TO_BUS` once per confirmed cluster.

**Tech Stack:** TypeScript (pure DSP/algorithm code + React UI). No new dependencies, no native
engine changes, no IPC.

**Spec:** `docs/superpowers/specs/2026-08-05-stem-bus-clustering-phase2-design.md`

---

### Task 1: MFCC — pure mel-filterbank + DCT pipeline

**Files:**
- Create: `src/shared/mfcc.ts`
- Test: `src/shared/mfcc.test.ts`

Builds on the existing `magnitudeSpectrum()` (`src/shared/fft.ts`) — this task adds the two pieces
that don't exist yet: a mel filterbank and a DCT, plus the frame-loop/averaging glue that turns
one stem's raw samples into one fixed-length 13-number timbre vector.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/mfcc.test.ts
import { describe, it, expect } from 'vitest'
import { computeMfcc } from './mfcc'

function sineWave(freqHz: number, durationSec: number, sampleRate: number): Float32Array {
  const n = Math.round(durationSec * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
  return out
}

describe('computeMfcc', () => {
  it('returns exactly 13 coefficients', () => {
    const samples = sineWave(440, 1.0, 44100)
    const result = computeMfcc(samples, 44100)
    expect(result).toHaveLength(13)
  })

  it('returns all finite numbers, never NaN/Infinity, for real audio-like input', () => {
    const samples = sineWave(220, 0.5, 44100)
    const result = computeMfcc(samples, 44100)
    for (const v of result) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('returns a flat/near-zero vector (after the first coefficient) for silence', () => {
    const samples = new Float32Array(44100 * 0.5) // all zeros
    const result = computeMfcc(samples, 44100)
    // Coefficient 0 (roughly overall log-energy) will be very negative for
    // silence, not zero -- but every OTHER coefficient (which capture
    // spectral SHAPE, not overall level) should be at/near zero when
    // there's no signal to have any shape at all.
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i])).toBeLessThan(1e-6)
    }
  })

  it('produces a genuinely different vector for a low tone vs a high tone', () => {
    const low = computeMfcc(sineWave(110, 0.5, 44100), 44100)
    const high = computeMfcc(sineWave(3520, 0.5, 44100), 44100)
    let sumSqDiff = 0
    for (let i = 0; i < 13; i++) sumSqDiff += (low[i] - high[i]) ** 2
    expect(Math.sqrt(sumSqDiff)).toBeGreaterThan(1)
  })

  it('handles input shorter than one analysis window without throwing', () => {
    const samples = new Float32Array(100).fill(0.1)
    const result = computeMfcc(samples, 44100)
    expect(result).toHaveLength(13)
    for (const v of result) expect(Number.isFinite(v)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/mfcc.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `computeMfcc`**

```ts
// src/shared/mfcc.ts
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
      if (bin >= 0 && bin < numBins && right > center) filter[bin] = (right - bin) / (right - center)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/mfcc.test.ts`
Expected: PASS (5 tests). If the "silence" test fails because coefficient 0 isn't actually very
negative in practice (the log-floor `1e-10` may dominate identically for every band), that's fine
— that specific assertion only checks coefficients 1..12, not coefficient 0, so this should pass
as written; if it doesn't, re-read the failure message before changing anything (per
`superpowers:systematic-debugging` — don't guess).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/mfcc.ts src/shared/mfcc.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/mfcc.ts src/shared/mfcc.test.ts
git commit -m "Add computeMfcc: mel-filterbank + DCT timbre descriptor"
```

---

### Task 2: Voiced fraction + pitch variance

**Files:**
- Modify: `src/shared/pitchContour.ts`
- Test: `src/shared/pitchContour.test.ts` (add to existing file — check it exists first; if not,
  create it following this file's own doc-comment conventions)

Derives two scalar features from an already-computed `PitchContour` (no new audio analysis, no new
decode — pure post-processing of `pitchCache.ts`'s existing cached output).

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/pitchContour.test.ts`:

```ts
import { voicedPitchFeatures } from './pitchContour'

describe('voicedPitchFeatures', () => {
  it('returns voicedFraction 0 and pitchVarianceCents 0 for an entirely unvoiced contour', () => {
    const contour = { numFrames: 4, freqHz: new Float32Array([0, 0, 0, 0]) }
    const result = voicedPitchFeatures(contour)
    expect(result.voicedFraction).toBe(0)
    expect(result.pitchVarianceCents).toBe(0)
  })

  it('returns voicedFraction 1 for an entirely voiced, constant-pitch contour', () => {
    const contour = { numFrames: 4, freqHz: new Float32Array([440, 440, 440, 440]) }
    const result = voicedPitchFeatures(contour)
    expect(result.voicedFraction).toBe(1)
    expect(result.pitchVarianceCents).toBe(0)
  })

  it('computes voicedFraction as the fraction of non-zero frames', () => {
    const contour = { numFrames: 4, freqHz: new Float32Array([440, 0, 440, 0]) }
    const result = voicedPitchFeatures(contour)
    expect(result.voicedFraction).toBeCloseTo(0.5, 10)
  })

  it('reports nonzero pitch variance for a contour that moves between two pitches', () => {
    // 220Hz and 440Hz are exactly one octave (1200 cents) apart -- variance
    // in cent-space should be large and definitely nonzero, unlike raw-Hz
    // variance which would also be nonzero but on a totally different,
    // non-comparable scale across registers.
    const contour = {
      numFrames: 4,
      freqHz: new Float32Array([220, 440, 220, 440])
    }
    const result = voicedPitchFeatures(contour)
    expect(result.pitchVarianceCents).toBeGreaterThan(0)
  })

  it('ignores unvoiced frames entirely when computing pitch variance (not counted as 0 Hz)', () => {
    // If unvoiced (0Hz) frames were naively included in the variance
    // calculation, a mix of "silence" and "constant 440Hz" would read as
    // wildly varying pitch, when really there's only ever one true pitch
    // whenever anything voiced is happening at all.
    const contour = {
      numFrames: 4,
      freqHz: new Float32Array([440, 0, 440, 0])
    }
    const result = voicedPitchFeatures(contour)
    expect(result.pitchVarianceCents).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/pitchContour.test.ts -t "voicedPitchFeatures"`
Expected: FAIL — `voicedPitchFeatures` isn't exported yet.

- [ ] **Step 3: Implement `voicedPitchFeatures`**

Add to `src/shared/pitchContour.ts`, after the existing `computePitchContour` function:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/pitchContour.test.ts`
Expected: PASS — all new tests plus every pre-existing test in this file.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/pitchContour.ts src/shared/pitchContour.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/pitchContour.ts src/shared/pitchContour.test.ts
git commit -m "Add voicedPitchFeatures: voiced fraction + pitch variance in cents"
```

---

### Task 3: `StemFeatures` assembly + standardization

**Files:**
- Create: `src/shared/stemFeatures.ts`
- Test: `src/shared/stemFeatures.test.ts`

Pure functions: the shape of a stem's full feature vector, flattening it to a plain number array
for clustering, and z-score standardizing a whole population of vectors before clustering runs
(raw feature scales differ wildly — `transientDensity` is roughly 0-1, MFCC coefficients can be
tens in either direction).

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/stemFeatures.test.ts
import { describe, it, expect } from 'vitest'
import { toFeatureArray, standardizeFeatures, type StemFeatures } from './stemFeatures'

function makeFeatures(overrides: Partial<StemFeatures> = {}): StemFeatures {
  return {
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 0,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
}

describe('toFeatureArray', () => {
  it('flattens every field into a single array in a fixed order', () => {
    const f = makeFeatures({
      transientDensity: 1,
      bassEnergyRatio: 2,
      spectralCentroidHz: 3,
      zcrBrightness: 4,
      voicedFraction: 5,
      pitchVarianceCents: 6,
      mfcc: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    })
    expect(toFeatureArray(f)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })
})

describe('standardizeFeatures', () => {
  it('z-scores each dimension independently to mean 0, unit variance', () => {
    const vectors = [
      [0, 10],
      [2, 10],
      [4, 10]
    ]
    const result = standardizeFeatures(vectors)
    // Dimension 0 has real spread (0,2,4) -> should end up mean-0, unit-variance.
    const dim0 = result.map((v) => v[0])
    const mean0 = dim0.reduce((s, v) => s + v, 0) / dim0.length
    expect(mean0).toBeCloseTo(0, 10)
    const variance0 = dim0.reduce((s, v) => s + v ** 2, 0) / dim0.length
    expect(variance0).toBeCloseTo(1, 5)
  })

  it('does not divide by zero for a dimension with no spread at all (constant across every stem)', () => {
    const vectors = [
      [5, 1],
      [5, 2],
      [5, 3]
    ]
    const result = standardizeFeatures(vectors)
    // Dimension 0 is identical (5) for every input -- stddev is 0. Must not
    // produce NaN/Infinity; every stem's own value there should just
    // collapse to 0 (no information in a dimension with zero spread).
    for (const v of result) {
      expect(Number.isFinite(v[0])).toBe(true)
      expect(v[0]).toBe(0)
    }
  })

  it('preserves vector count and dimensionality', () => {
    const vectors = [
      [1, 2, 3],
      [4, 5, 6]
    ]
    const result = standardizeFeatures(vectors)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(3)
  })

  it('returns an empty array for empty input', () => {
    expect(standardizeFeatures([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/stemFeatures.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/shared/stemFeatures.ts

export interface StemFeatures {
  transientDensity: number
  bassEnergyRatio: number
  /** Weighted-average spectral centroid, in Hz -- derived from
   * computeBandEnergy's per-frame bass/mid/treble energies (see
   * stemFeaturesCache.ts for the exact derivation) using each band's own
   * geometric-mean center frequency as its representative Hz value. */
  spectralCentroidHz: number
  /** Mean zero-crossing-rate brightness across the stem, in [0, 1] --
   * averaged from peakCache.ts's own getBrightness (128 per-bucket
   * values), not recomputed independently. */
  zcrBrightness: number
  voicedFraction: number
  pitchVarianceCents: number
  /** 13 MFCC coefficients -- see mfcc.ts's computeMfcc. */
  mfcc: number[]
}

/** Flattens a StemFeatures into a single plain number array, in a FIXED
 * order every caller must agree on (used identically by
 * standardizeFeatures below and by the clustering algorithm that
 * consumes its output) -- 6 scalar features followed by all 13 MFCC
 * coefficients, 19 numbers total. */
export function toFeatureArray(f: StemFeatures): number[] {
  return [
    f.transientDensity,
    f.bassEnergyRatio,
    f.spectralCentroidHz,
    f.zcrBrightness,
    f.voicedFraction,
    f.pitchVarianceCents,
    ...f.mfcc
  ]
}

/**
 * Z-score standardizes each feature DIMENSION independently across the
 * whole population of vectors -- raw feature scales differ wildly
 * (transientDensity is roughly 0-1, MFCC coefficients can be tens in
 * either direction), and clustering on unstandardized features would let
 * the largest-magnitude feature dominate the Euclidean distance metric.
 * A dimension with zero spread (identical value across every input, or a
 * single-vector population) standardizes to a flat 0 for every vector
 * rather than dividing by a zero stddev -- there's no information in a
 * dimension nothing varies along anyway.
 */
export function standardizeFeatures(vectors: number[][]): number[][] {
  if (vectors.length === 0) return []
  const numDims = vectors[0].length

  const means = new Array<number>(numDims).fill(0)
  for (const v of vectors) for (let d = 0; d < numDims; d++) means[d] += v[d]
  for (let d = 0; d < numDims; d++) means[d] /= vectors.length

  const stddevs = new Array<number>(numDims).fill(0)
  for (const v of vectors) for (let d = 0; d < numDims; d++) stddevs[d] += (v[d] - means[d]) ** 2
  for (let d = 0; d < numDims; d++) stddevs[d] = Math.sqrt(stddevs[d] / vectors.length)

  return vectors.map((v) =>
    v.map((value, d) => (stddevs[d] > 1e-10 ? (value - means[d]) / stddevs[d] : 0))
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/stemFeatures.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/stemFeatures.ts src/shared/stemFeatures.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/stemFeatures.ts src/shared/stemFeatures.test.ts
git commit -m "Add StemFeatures assembly + z-score standardization"
```

---

### Task 4: Agglomerative clustering

**Files:**
- Create: `src/shared/agglomerativeCluster.ts`
- Test: `src/shared/agglomerativeCluster.test.ts`

Average-linkage agglomerative clustering, Euclidean distance. Computes the FULL merge sequence
once (N singleton clusters down to 1), so the labelling UI's cluster-count slider can "cut" that
sequence at any K instantly without re-running the algorithm on every drag.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/agglomerativeCluster.test.ts
import { describe, it, expect } from 'vitest'
import { computeMergeSequence, cutAtK } from './agglomerativeCluster'

describe('computeMergeSequence', () => {
  it('produces exactly n-1 merges for n input vectors', () => {
    const vectors = [[0, 0], [1, 0], [10, 0], [11, 0]]
    const merges = computeMergeSequence(vectors)
    expect(merges).toHaveLength(3)
  })

  it('merges the two closest points first', () => {
    const vectors = [[0, 0], [0.1, 0], [10, 0]]
    const merges = computeMergeSequence(vectors)
    // The first merge should combine indices 0 and 1 (0.1 apart), not
    // either with index 2 (10 apart).
    const firstMerge = merges[0]
    expect(new Set([firstMerge.a, firstMerge.b])).toEqual(new Set([0, 1]))
  })

  it('returns merges in non-decreasing distance order', () => {
    const vectors = [[0, 0], [0.1, 0], [5, 0], [5.05, 0], [20, 0]]
    const merges = computeMergeSequence(vectors)
    for (let i = 1; i < merges.length; i++) {
      expect(merges[i].distance).toBeGreaterThanOrEqual(merges[i - 1].distance - 1e-9)
    }
  })

  it('handles a single input vector with zero merges', () => {
    expect(computeMergeSequence([[1, 2, 3]])).toEqual([])
  })

  it('handles empty input', () => {
    expect(computeMergeSequence([])).toEqual([])
  })
})

describe('cutAtK', () => {
  it('returns one cluster containing everything when k=1', () => {
    const vectors = [[0, 0], [0.1, 0], [10, 0], [10.1, 0]]
    const merges = computeMergeSequence(vectors)
    const clusters = cutAtK(merges, vectors.length, 1)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sort()).toEqual([0, 1, 2, 3])
  })

  it('returns n singleton clusters when k=n (no merges applied)', () => {
    const vectors = [[0, 0], [0.1, 0], [10, 0]]
    const merges = computeMergeSequence(vectors)
    const clusters = cutAtK(merges, vectors.length, 3)
    expect(clusters).toHaveLength(3)
    expect(clusters.flat().sort()).toEqual([0, 1, 2])
  })

  it('groups two obviously-close points together before an obviously-far one, at an intermediate k', () => {
    const vectors = [[0, 0], [0.1, 0], [50, 0]]
    const merges = computeMergeSequence(vectors)
    const clusters = cutAtK(merges, vectors.length, 2)
    expect(clusters).toHaveLength(2)
    const clusterContaining = (idx: number): number[] =>
      clusters.find((c) => c.includes(idx))!
    expect(clusterContaining(0)).toEqual(clusterContaining(1))
    expect(clusterContaining(2)).not.toEqual(clusterContaining(0))
  })

  it('every original index appears in exactly one resulting cluster, for any k', () => {
    const vectors = [[0, 0], [1, 1], [5, 5], [6, 6], [20, 20]]
    const merges = computeMergeSequence(vectors)
    for (let k = 1; k <= vectors.length; k++) {
      const clusters = cutAtK(merges, vectors.length, k)
      const allIndices = clusters.flat().sort((a, b) => a - b)
      expect(allIndices).toEqual([0, 1, 2, 3, 4])
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/agglomerativeCluster.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/shared/agglomerativeCluster.ts

export interface MergeStep {
  /** The two cluster ids merged at this step -- for the first N-1... wait,
   * simplified: ids 0..n-1 are the original singleton vectors; each merge
   * produces a NEW id (n, n+1, n+2, ...) representing the combined
   * cluster, so later merges can reference earlier merges' own results.
   * Standard agglomerative-clustering dendrogram encoding. */
  a: number
  b: number
  distance: number
}

function euclideanDistance(x: number[], y: number[]): number {
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += (x[i] - y[i]) ** 2
  return Math.sqrt(sum)
}

/**
 * Agglomerative hierarchical clustering, average linkage, Euclidean
 * distance -- computes the FULL merge sequence (n singleton clusters
 * merging pairwise down to 1), so a caller can "cut" it at any cluster
 * count via cutAtK below without re-running this expensive part per cut.
 * O(n^3) (naive: n-1 merge rounds, each scanning all current cluster
 * pairs) -- fine for the realistic stem counts here (a few hundred at
 * most), not something that needs a faster algorithm.
 */
export function computeMergeSequence(vectors: number[][]): MergeStep[] {
  const n = vectors.length
  if (n <= 1) return []

  // clusterMembers[id] = original vector indices currently in that
  // cluster. Ids 0..n-1 start as singletons; each merge allocates a new
  // id for the combined result and RETIRES its two inputs (their own
  // members lists are left in place for cutAtK to still read, but they
  // stop being separately "active").
  const clusterMembers: number[][] = vectors.map((_, i) => [i])
  const active = new Set<number>(vectors.map((_, i) => i))
  const merges: MergeStep[] = []
  let nextId = n

  while (active.size > 1) {
    let bestA = -1
    let bestB = -1
    let bestDist = Infinity

    const ids = [...active]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const membersA = clusterMembers[ids[i]]
        const membersB = clusterMembers[ids[j]]
        let sum = 0
        for (const ai of membersA) {
          for (const bi of membersB) {
            sum += euclideanDistance(vectors[ai], vectors[bi])
          }
        }
        const avgDist = sum / (membersA.length * membersB.length)
        if (avgDist < bestDist) {
          bestDist = avgDist
          bestA = ids[i]
          bestB = ids[j]
        }
      }
    }

    const newId = nextId++
    clusterMembers[newId] = [...clusterMembers[bestA], ...clusterMembers[bestB]]
    active.delete(bestA)
    active.delete(bestB)
    active.add(newId)
    merges.push({ a: bestA, b: bestB, distance: bestDist })
  }

  return merges
}

/**
 * "Cuts" an already-computed merge sequence at cluster count `k`, without
 * re-running clustering -- replays the first (n - k) merges (the
 * CLOSEST/earliest ones) and stops, leaving k active clusters. k=1
 * replays every merge (everything ends up together); k=n replays none
 * (every original vector stays its own singleton).
 */
export function cutAtK(merges: MergeStep[], n: number, k: number): number[][] {
  const clusterMembers = new Map<number, number[]>()
  for (let i = 0; i < n; i++) clusterMembers.set(i, [i])
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i))

  const mergesToApply = Math.max(0, Math.min(merges.length, n - k))
  let nextId = n
  for (let i = 0; i < mergesToApply; i++) {
    const { a, b } = merges[i]
    const newId = nextId++
    clusterMembers.set(newId, [...clusterMembers.get(a)!, ...clusterMembers.get(b)!])
    active.delete(a)
    active.delete(b)
    active.add(newId)
  }

  return [...active].map((id) => clusterMembers.get(id)!)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/agglomerativeCluster.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/agglomerativeCluster.ts src/shared/agglomerativeCluster.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agglomerativeCluster.ts src/shared/agglomerativeCluster.test.ts
git commit -m "Add agglomerative clustering with a precomputed, cheaply-cuttable merge sequence"
```

---

### Task 5: `stemFeaturesCache.ts` — renderer decode + cache orchestration

**Files:**
- Create: `src/renderer/src/audio/stemFeaturesCache.ts`
- Test: `src/renderer/src/audio/stemFeaturesCache.test.ts`

Wires the pure functions from Tasks 1-3 together against real (decoded) audio, mirroring
`peakCache.ts`'s exact caching shape (`Map<string, Promise<T>>`, evict on rejection). Reuses
`getBrightness` (`peakCache.ts`) and `getPitchContour` (`pitchCache.ts`) for the two features they
already compute, rather than re-decoding/re-analyzing — this file's own decode is only for the
remaining features (`transientDensity`, `bassEnergyRatio`, spectral centroid, MFCC), all of which
need the raw sample buffer neither existing cache exposes. This mirrors this codebase's own
established precedent of keeping genuinely different analyses as separate cached calls rather than
merging every consumer into one shared decode (see `pitchCache.ts`'s own doc comment on exactly
this point).

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/src/audio/stemFeaturesCache.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4])
}

function fakeAudioBuffer(): { getChannelData: () => Float32Array; sampleRate: number } {
  const n = 4410
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5
  return { getChannelData: () => data, sampleRate: 44100 }
}

describe('stemFeaturesCache', () => {
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()

    vi.stubGlobal('window', { rifffApi: { readAudioFile: readAudioFileMock } })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a StemFeatures object with every expected field populated', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const features = await getStemFeatures('/some/stem.wav')

    expect(typeof features.transientDensity).toBe('number')
    expect(typeof features.bassEnergyRatio).toBe('number')
    expect(typeof features.spectralCentroidHz).toBe('number')
    expect(typeof features.zcrBrightness).toBe('number')
    expect(typeof features.voicedFraction).toBe('number')
    expect(typeof features.pitchVarianceCents).toBe('number')
    expect(features.mfcc).toHaveLength(13)
  })

  it('reuses the same in-flight promise across concurrent callers for the same path', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const [a, b] = await Promise.all([
      getStemFeatures('/some/stem.wav'),
      getStemFeatures('/some/stem.wav')
    ])
    expect(a).toEqual(b)
  })

  it('evicts a rejected computation from the cache so a later call retries', async () => {
    readAudioFileMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')

    await expect(getStemFeatures('/some/stem.wav')).rejects.toThrow('permission denied')
    const features = await getStemFeatures('/some/stem.wav')
    expect(features.mfcc).toHaveLength(13)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/audio/stemFeaturesCache.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/audio/stemFeaturesCache.ts
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
const BAND_CENTER_HZ = { bass: Math.sqrt(40 * 250), mid: Math.sqrt(250 * 2000), treble: Math.sqrt(2000 * 8000) }

function averageArray(values: ArrayLike<number>): number {
  if (values.length === 0) return 0
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  return sum / values.length
}

function spectralCentroidFromBandEnergy(bass: Float32Array, mid: Float32Array, treble: Float32Array): number {
  let weightedSum = 0
  let totalEnergy = 0
  for (let t = 0; t < bass.length; t++) {
    const energy = bass[t] + mid[t] + treble[t]
    weightedSum +=
      bass[t] * BAND_CENTER_HZ.bass + mid[t] * BAND_CENTER_HZ.mid + treble[t] * BAND_CENTER_HZ.treble
    totalEnergy += energy
  }
  return totalEnergy > 1e-10 ? weightedSum / totalEnergy : 0
}

function computeFeatures(samples: Float32Array, sampleRate: number, brightness: number[], pitchFeatures: ReturnType<typeof voicedPitchFeatures>): StemFeatures {
  const bandEnergy = computeBandEnergy(samples, sampleRate)
  return {
    transientDensity: transientDensity(samples, sampleRate),
    bassEnergyRatio: bassEnergyRatio(samples, sampleRate),
    spectralCentroidHz: spectralCentroidFromBandEnergy(bandEnergy.bass, bandEnergy.mid, bandEnergy.treble),
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
 * sample buffer for. See this file's own module doc comment in the plan
 * for why this isn't merged into one shared decode across all three
 * caches.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/audio/stemFeaturesCache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/audio/stemFeaturesCache.ts src/renderer/src/audio/stemFeaturesCache.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/audio/stemFeaturesCache.ts src/renderer/src/audio/stemFeaturesCache.test.ts
git commit -m "Add stemFeaturesCache: per-path cached feature vector for clustering"
```

---

### Task 6: Provenance — where a bus suggestion comes from

**Files:**
- Create: `src/shared/busProvenance.ts`
- Test: `src/shared/busProvenance.test.ts`

A small, pure helper the labelling UI uses to show *why* a cluster looks the way it does — plain
text ("clustered" / "from preset name" / "unknown"), not a confidence score, per the design spec.
Reuses the existing `guessSoundTypeFromPresetName` (a signal completely independent of DSP
clustering) as a secondary hint.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/busProvenance.test.ts
import { describe, it, expect } from 'vitest'
import { clusterProvenance } from './busProvenance'

describe('clusterProvenance', () => {
  it("returns 'clustered' for a cluster with more than one member stem", () => {
    expect(clusterProvenance(['Kick', 'Snare'], 5)).toBe('clustered')
  })

  it("returns 'from preset name' for a singleton cluster whose one stem has a recognizable preset name", () => {
    expect(clusterProvenance(['Kick'], 1)).toBe('from preset name')
  })

  it("returns 'unknown' for a singleton cluster with no recognizable preset name", () => {
    expect(clusterProvenance(['Microphone'], 1)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/busProvenance.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/shared/busProvenance.ts
import { guessSoundTypeFromPresetName } from './presetNames'

export type BusProvenance = 'clustered' | 'from preset name' | 'unknown'

/**
 * Plain-text explanation of why a cluster looks the way it does, shown in
 * the labelling UI instead of a fake confidence percentage -- different
 * provenance sources are trusted differently by the user, which a single
 * number can't convey. A cluster with more than one member stem is, by
 * definition, a real DSP-clustering result ("clustered"). A SINGLETON
 * cluster (one stem, nothing else grouped with it) is less a clustering
 * result than an outlier -- for those, fall back to whether the stem's
 * own name is a recognizable Endlesss preset name (a completely
 * independent, non-DSP signal), or 'unknown' if not.
 */
export function clusterProvenance(memberStemNames: string[], clusterCount: number): BusProvenance {
  if (memberStemNames.length > 1) return 'clustered'
  const [onlyName] = memberStemNames
  if (onlyName && guessSoundTypeFromPresetName(onlyName) !== null) return 'from preset name'
  return 'unknown'
}
```

Note: `clusterCount` (total number of clusters in the current cut) is accepted as a parameter for
API-shape consistency with how the labelling UI will call this per-row, but isn't used in the logic
above — the design doc's own provenance categories only depend on this cluster's own membership,
not the overall cluster count. If lint flags the unused parameter, prefix it `_clusterCount` rather
than removing it from the signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/busProvenance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/busProvenance.ts src/shared/busProvenance.test.ts`
Expected: PASS. If eslint's `no-unused-vars` flags the `clusterCount` parameter even when prefixed,
remove it from the signature entirely and update the call site in Task 7 to match — don't fight the
linter over an intentionally-unused parameter that isn't actually needed.

- [ ] **Step 6: Commit**

```bash
git add src/shared/busProvenance.ts src/shared/busProvenance.test.ts
git commit -m "Add clusterProvenance: plain-text explanation for a cluster's bus suggestion"
```

---

### Task 7: `ClusterStemsBrowser.tsx` — the labelling UI

**Files:**
- Create: `src/renderer/src/components/ClusterStemsBrowser.tsx`

Read `src/renderer/src/components/ProjectLibraryBrowser.tsx` in full first — this component follows
the exact same modal-overlay/click-outside-to-close/`buttonStyle()` pattern already established
there (and in `LoreLibraryBrowser.tsx`). Also read `src/renderer/src/components/Waveform.tsx`'s
props (`{path, color, opacity?, showPitchLine?}`) — reused directly for the per-stem thumbnails,
no new waveform-rendering code needed.

This is the biggest, most UI-heavy task in this plan. Since this codebase's own convention is that
React components aren't directly unit-tested (verified via typecheck + lint + the underlying pure
logic's own tests, which Tasks 1-6 already cover), there's no test file for this task — but read
the "Testing" step at the end carefully; it's not skipped, just different in kind.

- [ ] **Step 1: Compute the clustering pipeline for a set of stems (component-local, not a new shared function)**

Inside the component, on mount (or when the modal opens), gather every placed stem's `stemKey`
and `path`, call `getStemFeatures(path)` for each (from Task 5), build feature arrays via
`toFeatureArray` (Task 3), standardize the whole population via `standardizeFeatures` (Task 3),
then run `computeMergeSequence` (Task 4) once. Store the merge sequence, the stems list, and the
current slider value (default 8) in component state; `cutAtK(mergeSequence, stems.length,
sliderValue)` is recomputed (cheaply — see Task 4's own doc comment) whenever the slider moves,
via `useMemo`.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { stemKey, type BusId } from '@shared/types'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { toFeatureArray, standardizeFeatures } from '@shared/stemFeatures'
import { computeMergeSequence, cutAtK } from '@shared/agglomerativeCluster'
import { clusterProvenance } from '@shared/busProvenance'
import { soloState } from '../../../main/nativeExport'
import { Waveform } from './Waveform'
import { stemColorVar } from '../theme/typeColor'

const DEFAULT_CLUSTER_COUNT = 8
const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']

interface ClusterableStem {
  key: string
  groupId: string
  slot: number
  name: string
  path: string
  color: string
}
```

**Important correction before implementing further:** `soloState` lives in `src/main/nativeExport.ts`
— a **main-process** file (it's imported by `nativeExportStems`, which spawns the native engine
subprocess). It is **not** importable from a renderer component; the import path shown above is
wrong and must not be used as written. Re-read `src/main/nativeExport.ts`'s `soloState` signature
(`soloState(state: AppState, targetKeys: Set<string>, allKeys: string[]): AppState`) and
`src/renderer/src/App.tsx`'s existing playback-control code (`usePlaying`, `SET_POS`,
`engineSetPosition`, `markManualSeek` — the same pattern `StemWaveformRow.tsx`'s
`handleRegionMouseDown` already uses for scrub-to-position) to work out the renderer-side
equivalent: soloing a cluster from this component means dispatching a real reducer action that
mutes every OTHER stem (there's already a `TOGGLE_MUTE`/`SET_GROUP_MUTE`-style pattern in
`store.ts` — read it), not calling the main-process `soloState` helper directly. This is a genuine
gap in the plan's own research — the person implementing this task should read `store.ts`'s
existing mute actions, pick the right one(s) to reuse or extend, and note the deviation when
reporting back rather than guessing silently.

- [ ] **Step 2: Feature extraction + clustering effect**

```tsx
export function ClusterStemsBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dispatch = useDispatch()
  const rifffs = useAppSelector((s) => s.rifffs)
  const playing = usePlaying()

  const stems = useMemo<ClusterableStem[]>(() => {
    const out: ClusterableStem[] = []
    for (const rifff of Object.values(rifffs)) {
      if (rifff.startBar === undefined) continue
      for (const stem of rifff.stems) {
        out.push({
          key: stemKey(rifff.groupId, stem.slot),
          groupId: rifff.groupId,
          slot: stem.slot,
          name: `${rifff.name} - ${stem.name}`,
          path: stem.path,
          color: stemColorVar(stem)
        })
      }
    }
    return out
  }, [rifffs])

  const [mergeSequence, setMergeSequence] = useState<
    ReturnType<typeof computeMergeSequence> | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [clusterCount, setClusterCount] = useState(DEFAULT_CLUSTER_COUNT)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const rawVectors = await Promise.all(
        stems.map(async (s) => {
          const features = await getStemFeatures(s.path)
          return toFeatureArray(features)
        })
      )
      if (cancelled) return
      const standardized = standardizeFeatures(rawVectors)
      setMergeSequence(computeMergeSequence(standardized))
      setLoading(false)
    })().catch((err) => {
      if (!cancelled) {
        console.error('ClusterStemsBrowser: feature extraction/clustering failed', err)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-run only when the stem SET changes (stems is itself already memoized on rifffs)
  }, [stems])

  const clusters = useMemo(() => {
    if (!mergeSequence) return []
    const indexGroups = cutAtK(mergeSequence, stems.length, Math.min(clusterCount, stems.length))
    return indexGroups
      .map((indices) => indices.map((i) => stems[i]))
      .sort((a, b) => b.length - a.length)
  }, [mergeSequence, stems, clusterCount])

  const [focusedRow, setFocusedRow] = useState(0)
  useEffect(() => {
    // Re-populating the row list (slider moved) can leave a stale focus
    // index pointing past the new, usually-shorter list -- clamp rather
    // than leave it dangling.
    if (focusedRow >= clusters.length) setFocusedRow(Math.max(0, clusters.length - 1))
  }, [clusters.length, focusedRow])
```

- [ ] **Step 3: Bus assignment on confirm**

```tsx
  function assignCluster(members: ClusterableStem[], busId: BusId): void {
    for (const member of members) {
      dispatch({ type: 'ASSIGN_TO_BUS', stemKey: member.key, busId })
    }
  }

  // Arrow keys move focus between rows; number keys 1-5 assign the
  // focused row's cluster to the corresponding bus (BUS_IDS[0..4]) --
  // required by the design doc's own labelling-UI section, carried over
  // unchanged from phase 1's original design doc. Escape closes the
  // modal, matching this app's existing modal-dismiss convention
  // (ProjectLibraryBrowser's own click-outside-to-close is the click
  // equivalent of this).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedRow((row) => Math.min(clusters.length - 1, row + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedRow((row) => Math.max(0, row - 1))
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key >= '1' && e.key <= '5') {
        const busIndex = Number(e.key) - 1
        const busId = BUS_IDS[busIndex]
        const activeCluster = clusters[focusedRow]
        if (busId && activeCluster) assignCluster(activeCluster, busId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assignCluster/onClose are stable closures over dispatch/props each render; re-binding every render is unnecessary and would thrash the listener on every keystroke's own state update
  }, [clusters, focusedRow])
```

- [ ] **Step 4: Render — modal shell**

Follow `ProjectLibraryBrowser.tsx`'s exact modal-overlay/click-outside-to-close structure (read it
directly and mirror its top-level JSX shape — the overlay div, the modal panel, the close button).
Inside the panel:

```tsx
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          padding: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span className="ra-eyebrow">cluster stems</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10 }}>clusters: {clusterCount}</span>
            <input
              type="range"
              min={1}
              max={Math.max(1, Math.min(20, stems.length))}
              value={clusterCount}
              onChange={(e) => setClusterCount(Number(e.target.value))}
            />
          </div>
        </div>

        {loading && <div style={{ fontSize: 11, padding: 12 }}>analyzing {stems.length} stems...</div>}

        {!loading &&
          clusters.map((members, i) => (
            <ClusterRow
              key={i}
              members={members}
              onAssign={(busId) => assignCluster(members, busId)}
              playing={playing}
            />
          ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `ClusterRow` sub-component — waveform thumbnails, scrub, solo, bus chips**

```tsx
function ClusterRow({
  members,
  onAssign,
  playing,
  focused
}: {
  members: ClusterableStem[]
  onAssign: (busId: BusId) => void
  playing: boolean
  focused: boolean
}): React.JSX.Element {
  const dispatch = useDispatch()
  const busOf = useAppSelector((s) => s.busOf)
  const provenance = clusterProvenance(
    members.map((m) => m.name),
    members.length
  )

  // Derived from the REAL store state, not local component state -- so a
  // previously-confirmed assignment still shows as highlighted if the
  // modal is closed and reopened, or if the slider re-partitions clusters
  // and this exact membership recurs. Only shown as "assigned" when EVERY
  // member of this cluster already carries the same busId; a mixed
  // cluster (e.g. after a slider move merges two previously-differently-
  // assigned clusters together) shows no highlight rather than a
  // misleading single answer.
  const assignedBus = useMemo<BusId | null>(() => {
    if (members.length === 0) return null
    const first = busOf[members[0].key]
    if (!first) return null
    const allMatch = members.every((m) => busOf[m.key] === first)
    return allMatch ? first : null
  }, [members, busOf])

  function handleSolo(): void {
    // Mutes every OTHER stem in the project so only this cluster's own
    // members are audible together -- see Task 1's own "Important
    // correction" note: this dispatches whatever real mute action
    // store.ts already exposes for this purpose, fanned out per-member,
    // NOT the main-process-only soloState() helper.
    const memberKeys = new Set(members.map((m) => m.key))
    for (const key of memberKeys) {
      dispatch({ type: 'TOGGLE_MUTE', stemKey: key }) // placeholder call shape -- see store.ts's real mute actions and correct this to whatever actually solos a set of stems (mute every stem NOT in memberKeys)
    }
  }

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--ra-border-soft)',
        borderLeft: focused ? '2px solid var(--ra-accent)' : '2px solid transparent',
        paddingLeft: focused ? 10 : 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 11, width: 120 }}>cluster</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)', width: 60 }}>
          {members.length} clip{members.length === 1 ? '' : 's'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 90 }}>{provenance}</span>
        <button onClick={handleSolo} style={{ fontSize: 9 }}>
          ▶ solo all
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {BUS_IDS.map((busId, i) => (
            <button
              key={busId}
              onClick={() => onAssign(busId)}
              style={{
                fontSize: 9,
                padding: '3px 8px',
                background: assignedBus === busId ? 'var(--ra-bg-row-active)' : 'transparent',
                border: '1px solid var(--ra-border)'
              }}
              title={`press ${i + 1} while this row is focused`}
            >
              {busId}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
        {members.slice(0, 8).map((m) => (
          <div key={m.key} style={{ width: 64, height: 32, flexShrink: 0, position: 'relative' }}>
            <Waveform path={m.path} color={m.color} opacity={1} />
          </div>
        ))}
        {members.length > 8 && (
          <div
            style={{
              width: 64,
              height: 32,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              color: 'var(--ra-text-3)'
            }}
          >
            +{members.length - 8} more
          </div>
        )}
      </div>
    </div>
  )
}
```

Note the `handleSolo` placeholder above is deliberately marked, not silently guessed at — reading
`store.ts`'s real per-stem/per-group mute actions and wiring this correctly (mute every stem NOT in
this cluster, unmute afterward or leave it to the user's own existing mute controls — decide which
based on how the codebase's existing solo-adjacent features, e.g. `SOLO_GROUP`, already behave) is
part of this task, not deferred.

- [ ] **Step 6: Scrub-per-thumbnail**

Add an `onClick`/`onMouseDown` handler to each thumbnail's wrapping div (in Step 5) that scrubs the
transport to that stem's own start and plays from there — reuse the exact scrub pattern already
established in `StemWaveformRow.tsx`'s `handleRegionMouseDown` (dispatch `SELECT`, dispatch
`SET_POS`, call `window.rifffApi.engineSetPosition` if `playing`, call `markManualSeek()`). Import
`markManualSeek` from `'../state/manualSeek'`, matching that file's own import.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/components/ClusterStemsBrowser.tsx`
Expected: PASS, once the `soloState`/mute-action correction from Steps 1/5 is resolved for real
(the placeholder shown above will not typecheck cleanly against `store.ts`'s real `Action` union
until it's replaced with a real action shape).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ClusterStemsBrowser.tsx
git commit -m "Add ClusterStemsBrowser: waveform-thumbnail-first cluster labelling UI"
```

---

### Task 8: Wire up the entry point

**Files:**
- Modify: `src/renderer/src/App.tsx`

Adds a standalone "cluster stems" button (per the design's own entry-point decision — NOT folded
into the Ableton export flow) and the modal-open state to show `ClusterStemsBrowser`.

- [ ] **Step 1: Add state and the modal render**

In `Frame`'s component body (the same one holding `libraryBrowserOpen`/`ProjectLibraryBrowser`
from the earlier Project Library feature — search for that pattern and mirror it exactly), add:

```tsx
  const [clusterStemsOpen, setClusterStemsOpen] = useState(false)
```

And, alongside the existing conditionally-rendered `<ProjectLibraryBrowser ... />` block:

```tsx
      {clusterStemsOpen && (
        <ClusterStemsBrowser onClose={() => setClusterStemsOpen(false)} />
      )}
```

Add the import: `import { ClusterStemsBrowser } from './components/ClusterStemsBrowser'`.

- [ ] **Step 2: Add the button**

Find wherever the existing "library" button (opens `ProjectLibraryBrowser`) is rendered in
`ProjectMenu` (search for `onOpenLibrary`) and add a sibling button, following that file's own
existing `buttonStyle()` convention:

```tsx
          <button style={buttonStyle()} onClick={onOpenClusterStems}>
            cluster stems
          </button>
```

Thread `onOpenClusterStems: () => void` through `ProjectMenu`'s own props (matching how
`onOpenLibrary` is already threaded), and pass `() => setClusterStemsOpen(true)` from `Frame`'s
own `<ProjectMenu ... />` call site, alongside the existing `onOpenLibrary={() =>
setLibraryBrowserOpen(true)}`.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/App.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire up the cluster stems button and modal"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run:
```bash
npm test
npm run typecheck
npm run lint
```
Expected: all pass (the pre-existing, unrelated `scanOneCandidate` flaky test in
`pluginScan.test.ts` may still fail intermittently under load — not a regression to chase here).

- [ ] **Step 2: Manual walkthrough**

No native engine or main-process changes in this plan — a renderer-only reload in `npm run dev` is
enough, no full quit/relaunch needed.

1. Open a real project with a meaningful number of stems (ideally different-sounding ones —
   drums, bass, melodic material) and click "cluster stems."
2. Confirm feature extraction completes (the "analyzing N stems..." message clears) and clusters
   appear, sorted by clip count.
3. Confirm the waveform thumbnails within a cluster visually resemble each other more than
   thumbnails in a DIFFERENT cluster do — the core "does this actually group by similarity" check.
4. Click/drag a thumbnail — confirm it scrubs/plays just that one stem.
5. Click "solo all" on a cluster — confirm every member stem in it (and only those) becomes
   audible together.
6. Assign a cluster to a bus (click a chip or press a number key if wired) — confirm the chip
   highlights, and that this doesn't crash/error.
7. Move the cluster-count slider — confirm the row list re-populates without any visible re-analysis
   delay (the merge sequence should already be cached; only the "cut" should re-run).
8. Close the modal, reopen it — confirm previously-assigned buses are remembered (real,
   persisted `busOf` state from phase 1).
9. Export to Ableton — confirm stems assigned via this UI land in the correct bus's group track.

Report back if anything doesn't match — apply `superpowers:systematic-debugging` before proposing
a fix, per this project's own established convention.
