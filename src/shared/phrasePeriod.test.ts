import { describe, expect, it } from 'vitest'
import {
  PHRASE_FRAME_COUNT,
  PHRASE_MATCH_THRESHOLD,
  PHRASE_PERIOD_CANDIDATES,
  measurePhrasePeriod,
  periodSimilarity,
  phraseFramesFromChannel,
  type PhraseFrames
} from './phrasePeriod'

/** A frame series that repeats `pattern` end to end, filling PHRASE_FRAME_COUNT
 * frames. `pattern` is one period's worth of values, 0..1. */
function framesRepeating(pattern: number[]): PhraseFrames {
  const envelope = new Float32Array(PHRASE_FRAME_COUNT)
  const brightness = new Float32Array(PHRASE_FRAME_COUNT)
  for (let i = 0; i < PHRASE_FRAME_COUNT; i += 1) {
    envelope[i] = pattern[i % pattern.length]
    brightness[i] = pattern[i % pattern.length] * 0.5
  }
  return { envelope, brightness }
}

/** One period's worth of values for a `bars`-bar pattern inside an
 * 8-bar loop, at PHRASE_FRAME_COUNT/8 frames per bar. */
function periodPattern(bars: number, values: number[]): number[] {
  const framesPerBar = PHRASE_FRAME_COUNT / 8
  const out: number[] = []
  for (let bar = 0; bar < bars; bar += 1) {
    for (let f = 0; f < framesPerBar; f += 1) out.push(values[bar % values.length])
  }
  return out
}

describe('phraseFramesFromChannel', () => {
  it('produces both series from one pass over the samples', () => {
    const samples = new Float32Array(PHRASE_FRAME_COUNT * 10)
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 3)
    const frames = phraseFramesFromChannel(samples)
    expect(frames.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(frames.brightness).toHaveLength(PHRASE_FRAME_COUNT)
  })

  it('reports a loud half and a quiet half as such', () => {
    const samples = new Float32Array(PHRASE_FRAME_COUNT * 10)
    for (let i = 0; i < samples.length / 2; i += 1) samples[i] = 1
    const frames = phraseFramesFromChannel(samples)
    expect(frames.envelope[0]).toBeGreaterThan(0.9)
    expect(frames.envelope[PHRASE_FRAME_COUNT - 1]).toBeLessThan(0.1)
  })

  it('survives an empty buffer rather than throwing', () => {
    const frames = phraseFramesFromChannel(new Float32Array(0))
    expect(frames.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(frames.envelope[0]).toBe(0)
  })
})

describe('periodSimilarity', () => {
  it('is ~1 for a signal that really does repeat at that period', () => {
    const frames = framesRepeating(periodPattern(2, [1, 0.2]))
    expect(periodSimilarity(frames, 8, 2)!).toBeGreaterThan(PHRASE_MATCH_THRESHOLD)
  })

  it('is well below the threshold when it does not', () => {
    const frames = framesRepeating(periodPattern(8, [1, 0.2, 0.4, 0.9, 0.1, 0.7, 0.3, 0.6]))
    expect(periodSimilarity(frames, 8, 2)!).toBeLessThan(PHRASE_MATCH_THRESHOLD)
  })

  it('returns null for a period that does not divide the loop', () => {
    expect(periodSimilarity(framesRepeating([1, 0]), 6, 4)).toBeNull()
  })

  it('does NOT call the same shape at a different level a repeat', () => {
    // This was a real bug: windowSimilarity was cosine similarity, which is
    // scale-invariant, so a bar held at 1.0 and a bar held at 0.2 scored a
    // flat 1.0. An intro that ducks the same loop would have read as an
    // exact repeat. If this test goes red because someone reached for
    // cosine again, read windowSimilarity's own comment.
    const loudThenQuiet = framesRepeating(periodPattern(2, [1, 0.2]))
    expect(periodSimilarity(loudThenQuiet, 8, 1)!).toBeLessThan(PHRASE_MATCH_THRESHOLD)
  })

  it('answers the WEAKEST pass, not the average of them', () => {
    // bars 5-6 repeat bars 1-2 exactly while 3-4 and 7-8 do not. A mean
    // would let the one exact repeat carry the other two over the line.
    const uneven = framesRepeating(periodPattern(8, [1, 0.2, 0.5, 0.6, 1, 0.2, 0.5, 0.6]))
    expect(periodSimilarity(uneven, 8, 2)!).toBeLessThan(PHRASE_MATCH_THRESHOLD)
  })
})

describe('measurePhrasePeriod', () => {
  it('finds the SMALLEST period that explains the stem', () => {
    // Repeats every bar, so it also repeats every 2, 4 and 8 -- 1 wins.
    const frames = framesRepeating(periodPattern(1, [1]))
    expect(measurePhrasePeriod(frames, 8)).toEqual({ kind: 'period', bars: 1, confidence: 1 })
  })

  it('calls an 8-bar loop that is the same 4 bars twice a 4-bar phrase', () => {
    const frames = framesRepeating(periodPattern(4, [1, 0.2, 0.7, 0.3]))
    const verdict = measurePhrasePeriod(frames, 8)
    expect(verdict.kind).toBe('period')
    expect(verdict.kind === 'period' && verdict.bars).toBe(4)
  })

  it('reports the nominal length when nothing shorter explains it', () => {
    const frames = framesRepeating(periodPattern(8, [1, 0.2, 0.4, 0.9, 0.1, 0.7, 0.3, 0.6]))
    const verdict = measurePhrasePeriod(frames, 8)
    expect(verdict.kind).toBe('period')
    expect(verdict.kind === 'period' && verdict.bars).toBe(8)
  })

  it('says nothing about a one-bar loop -- there is no shorter period to find', () => {
    expect(measurePhrasePeriod(framesRepeating([1, 0.5]), 1)).toEqual({ kind: 'inconclusive' })
  })

  it('says nothing about silence rather than calling it a one-bar phrase', () => {
    const frames: PhraseFrames = {
      envelope: new Float32Array(PHRASE_FRAME_COUNT),
      brightness: new Float32Array(PHRASE_FRAME_COUNT)
    }
    expect(measurePhrasePeriod(frames, 8)).toEqual({ kind: 'inconclusive' })
  })

  it('says nothing when a shorter period sits right on the fence', () => {
    // Two bar-pairs that are ALMOST the same: the 2-bar answer and the
    // 4-bar answer are a coin flip, so there is no honest report to make.
    // The values are picked to land the 2-bar similarity inside
    // PHRASE_AMBIGUITY_MARGIN below the threshold -- the constant is the
    // product decision, this fixture is not.
    const pattern = periodPattern(4, [1, 0.2, 0.85, 0.35])
    const verdict = measurePhrasePeriod(framesRepeating(pattern), 8)
    expect(verdict).toEqual({ kind: 'inconclusive' })
  })

  it('only ever considers 1, 2, 4 and 8 bars', () => {
    expect([...PHRASE_PERIOD_CANDIDATES]).toEqual([1, 2, 4, 8])
  })
})
