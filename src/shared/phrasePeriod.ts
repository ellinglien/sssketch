/**
 * How long a stem's musical phrase really is, measured against itself.
 *
 * A loop's NOMINAL length is not necessarily its phrase: an 8-bar loop can
 * be the same 4 bars twice. Comparing a stem against itself at candidate
 * periods finds the smallest period that explains it (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "The phrase
 * pass, and who decides").
 *
 * THE RULE THIS FILE SERVES: **this is a measurement, and it is REPORTED,
 * never applied.** Nothing here resizes, halves or trims anything. It
 * returns a verdict; a person decides what to do about it. That is a direct
 * instruction from Elling ("loop in the user in those decisions though
 * about the loop length"), and it is why 'inconclusive' is a first-class
 * answer rather than an error: when the measurement is a coin flip, the
 * honest output is nothing at all.
 *
 * Per STEM, not per loop, because the two say different things: a kick
 * repeating every bar is fine, while a lead repeating every 2 bars in an
 * 8-bar loop is what makes a track feel stuck. ./coachPhrase.ts combines
 * the per-stem verdicts into the loop's own answer.
 *
 * ---
 *
 * THE TUNING CONSTANTS ARE ALL IN THIS BLOCK, deliberately. Every number
 * below was tuned against SYNTHETIC signals in phrasePeriod.test.ts and has
 * never heard a real Endlesss loop. They are the honest starting point, not
 * a claim of accuracy -- only a person listening can say whether they are
 * right, and when that happens this block is the one place to edit.
 */

/** How many frames the whole stem is reduced to, whatever its length. A
 * fixed total (rather than a fixed frames-per-bar) is what lets the
 * renderer cache one PhraseFrames per PATH -- exactly like peakCache.ts's
 * own 128 buckets -- while the bar-relative resolution is worked out at
 * read time from the nominal bar count. 512 gives 64 frames per bar on an
 * 8-bar loop and 128 on a 4-bar one, which is far finer than any of the
 * periods below. */
export const PHRASE_FRAME_COUNT = 512

/** The periods worth testing. Deliberately just powers of two: Endlesss
 * rifffs and loop packs are authored that way, the same assumption
 * loopBarGuess.ts's LOOP_BAR_CANDIDATES already makes. */
export const PHRASE_PERIOD_CANDIDATES: readonly number[] = [1, 2, 4, 8]

/** How alike two passes have to be before one is called a repeat of the
 * other. A first pass, expected to be retuned after Elling's own
 * walkthrough on real loops -- kept here as the one place to look when
 * tuning, the same convention autoArrangeEngine.ts's own
 * ENTER_SPARSITY_WEIGHT follows. */
export const PHRASE_MATCH_THRESHOLD = 0.88

/** How close to the threshold counts as "could go either way". A candidate
 * SHORTER than the answer that lands inside this band makes the whole
 * measurement inconclusive, because reporting one of two near-equal answers
 * as a fact would be exactly the overreach this feature avoids. */
export const PHRASE_AMBIGUITY_MARGIN = 0.03

/** Below this peak level the stem is treated as silence, and silence has no
 * phrase. Note what this really catches: the envelope is normalised to the
 * stem's OWN loudest frame, so its peak is 1 for anything with signal in it
 * and 0 for a file that is all zeroes. This is therefore an all-silent
 * check rather than a quietness check, which is the right one to have here
 * -- a quiet stem still has a phrase. */
export const PHRASE_SILENCE_FLOOR = 0.02

/** How far past the threshold a similarity has to sit to read as fully
 * confident. Display only -- nothing branches on `confidence`. */
const PHRASE_CONFIDENCE_SPAN = 0.08

/** The fewest frames a segment can have and still be worth comparing. */
const MIN_SEGMENT_FRAMES = 4

/** How much each series counts toward a segment comparison. The envelope
 * carries the rhythm, which is what a repeat mostly is; brightness catches
 * a lead that plays the same rhythm with different notes. Another
 * tune-after-a-walkthrough pair. */
const ENVELOPE_WEIGHT = 0.7
const BRIGHTNESS_WEIGHT = 0.3

/** One stem, reduced to two same-length series. BOTH come from ONE decode
 * and one pass over the samples -- see phraseFramesFromChannel, and see
 * peakCache.ts's own WaveformAnalysis for the pattern this follows. */
export interface PhraseFrames {
  /** Per-frame RMS, 0..1 (normalised to the stem's own loudest frame). */
  envelope: Float32Array
  /** Per-frame zero-crossing rate, 0..1 -- "how much high-frequency
   * content is here", the same cheap brightness proxy zcrFromChannel
   * computes for the waveform. */
  brightness: Float32Array
}

export type PhrasePeriodVerdict =
  { kind: 'period'; bars: number; confidence: number } | { kind: 'inconclusive' }

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Both series, from ONE pass over the samples.
 *
 * Splitting this into an RMS pass and a ZCR pass would mean two reads of
 * the same array for two cheap derived values, which is precisely what
 * peakCache.ts's own comment tells you not to do.
 *
 * Always returns exactly `frameCount` frames, zero-filled for an empty or
 * short buffer, so every caller can index it without a length check.
 */
export function phraseFramesFromChannel(
  samples: Float32Array,
  frameCount: number = PHRASE_FRAME_COUNT
): PhraseFrames {
  const envelope = new Float32Array(frameCount)
  const brightness = new Float32Array(frameCount)
  if (samples.length === 0 || frameCount <= 0) return { envelope, brightness }

  const per = samples.length / frameCount
  let loudest = 0
  for (let f = 0; f < frameCount; f += 1) {
    const from = Math.floor(f * per)
    const to = Math.max(from + 1, Math.floor((f + 1) * per))
    let sumSquares = 0
    let crossings = 0
    let previous = samples[from]
    for (let i = from; i < to && i < samples.length; i += 1) {
      const value = samples[i]
      sumSquares += value * value
      if (value >= 0 !== previous >= 0) crossings += 1
      previous = value
    }
    const count = Math.max(1, Math.min(to, samples.length) - from)
    const rms = Math.sqrt(sumSquares / count)
    envelope[f] = rms
    if (rms > loudest) loudest = rms
    // Halved because a crossing needs two samples, then clamped: a fully
    // noisy frame saturates at 1 rather than running off the scale.
    brightness[f] = clamp01(crossings / count / 0.5)
  }
  if (loudest > 0) {
    for (let f = 0; f < frameCount; f += 1) envelope[f] = envelope[f] / loudest
  }
  return { envelope, brightness }
}

/**
 * How alike two equal-length windows are, 0..1: one minus their mean
 * absolute difference. Both series are already 0..1, so the result is too.
 *
 * NOT cosine similarity, which is what this was first written as and which
 * is wrong for exactly the job this file has. Cosine is scale-INVARIANT: a
 * bar held at 1.0 and a bar held at 0.2 are parallel vectors, so cosine
 * scores them 1.0 -- verified, it really does. That would make a phrase
 * measurement call "the same rhythm, half as loud" an exact repeat, which
 * is the one mistake it cannot afford: an intro that ducks the same loop is
 * the commonest shape in the material this app handles.
 *
 * Two windows that are both silent come out as identical, which they are;
 * a whole-stem silence check upstream stops that from mattering.
 */
function windowSimilarity(
  series: Float32Array,
  aStart: number,
  bStart: number,
  length: number
): number {
  if (length <= 0) return 1
  let total = 0
  for (let i = 0; i < length; i += 1) {
    const a = series[aStart + i] ?? 0
    const b = series[bStart + i] ?? 0
    total += Math.abs(a - b)
  }
  return clamp01(1 - total / length)
}

/**
 * How well `periodBars` explains this stem: the WEAKEST match between any
 * later pass and the first one.
 *
 * The weakest, not the mean. "This period explains the stem" is a claim
 * about all of it, and a mean lets one exact repeat paper over a pass that
 * does not match -- an 8-bar loop whose bars 5-6 repeat bars 1-2 while bars
 * 3-4 and 7-8 do not is not a 2-bar phrase, but its mean says it is by a
 * whisker. Taking the weakest pair makes the measurement say only what is
 * true of every pass, which is the same conservatism 'inconclusive' exists
 * for.
 *
 * null when the period is not a whole divisor of the nominal length (a
 * 4-bar period cannot explain a 6-bar loop) or the segments would be too
 * short to compare.
 */
export function periodSimilarity(
  frames: PhraseFrames,
  nominalBars: number,
  periodBars: number
): number | null {
  if (!Number.isFinite(nominalBars) || nominalBars <= 0) return null
  if (periodBars <= 0 || periodBars >= nominalBars) return null
  if (nominalBars % periodBars !== 0) return null
  const total = frames.envelope.length
  const segment = Math.floor((total * periodBars) / nominalBars)
  if (segment < MIN_SEGMENT_FRAMES) return null
  const repeats = nominalBars / periodBars

  let weakest = Number.POSITIVE_INFINITY
  let pairs = 0
  for (let r = 1; r < repeats; r += 1) {
    const start = r * segment
    if (start + segment > total) break
    const pair =
      ENVELOPE_WEIGHT * windowSimilarity(frames.envelope, 0, start, segment) +
      BRIGHTNESS_WEIGHT * windowSimilarity(frames.brightness, 0, start, segment)
    if (pair < weakest) weakest = pair
    pairs += 1
  }
  return pairs === 0 ? null : weakest
}

function peakOf(series: Float32Array): number {
  let peak = 0
  for (let i = 0; i < series.length; i += 1) {
    if (series[i] > peak) peak = series[i]
  }
  return peak
}

/**
 * The smallest period that explains this stem, the nominal length when
 * nothing shorter does, or 'inconclusive'.
 *
 * Inconclusive, specifically, when: the loop is too short to have a
 * shorter period at all; the stem is silent; or a candidate SHORTER than
 * the answer landed within PHRASE_AMBIGUITY_MARGIN of the threshold, which
 * makes the answer a coin flip. In every one of those cases the caller
 * says nothing (coachPhraseLine, ./coachPhrase.ts).
 */
export function measurePhrasePeriod(
  frames: PhraseFrames,
  nominalBars: number
): PhrasePeriodVerdict {
  if (!Number.isFinite(nominalBars) || nominalBars < 2) return { kind: 'inconclusive' }
  if (peakOf(frames.envelope) < PHRASE_SILENCE_FLOOR) return { kind: 'inconclusive' }

  const scored: { period: number; similarity: number }[] = []
  for (const period of PHRASE_PERIOD_CANDIDATES) {
    const similarity = periodSimilarity(frames, nominalBars, period)
    if (similarity !== null) scored.push({ period, similarity })
  }
  if (scored.length === 0) return { kind: 'inconclusive' }

  const hit = scored.find((entry) => entry.similarity >= PHRASE_MATCH_THRESHOLD)
  const answer = hit?.period ?? nominalBars
  // A shorter candidate sitting on the fence means two answers are equally
  // defensible. Report neither.
  const fenceSitter = scored.some(
    (entry) =>
      entry.period < answer &&
      entry.similarity < PHRASE_MATCH_THRESHOLD &&
      entry.similarity >= PHRASE_MATCH_THRESHOLD - PHRASE_AMBIGUITY_MARGIN
  )
  if (fenceSitter) return { kind: 'inconclusive' }

  const margin =
    hit === undefined
      ? PHRASE_MATCH_THRESHOLD - Math.max(...scored.map((entry) => entry.similarity))
      : hit.similarity - PHRASE_MATCH_THRESHOLD
  return { kind: 'period', bars: answer, confidence: clamp01(margin / PHRASE_CONFIDENCE_SPAN) }
}
