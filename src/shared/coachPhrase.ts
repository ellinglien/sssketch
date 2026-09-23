/**
 * The loop's own phrase length, read off its stems' individual periods --
 * and the one line that reports it.
 *
 * THE RULE (spec, "The phrase pass, and who decides", and a direct
 * instruction from Elling): **the finding is REPORTED, once. Nothing is
 * halved, trimmed or resized automatically. He answers what the phrase
 * actually is, and section sizing follows HIS answer.** Nothing in this
 * file writes CoachState.phrase; only the COACH_SET_PHRASE reducer case
 * does, and only from a click.
 *
 * "The real phrase length is the LONGEST true period across the loop's
 * stems" (spec). A kick repeating every bar does not make the loop a
 * one-bar phrase -- the lead that takes four bars to say its piece does.
 */

import { COACH_PHRASE_LINE_TEMPLATES, pickLineVariant } from './coachLines'
import type { PhrasePeriodVerdict } from './phrasePeriod'

/** One stem's measurement, as ./phrasePeriod.ts produced it. */
export interface StemPhraseReading {
  path: string
  /** The bar count this stem was read AGAINST -- its own barLength. */
  nominalBars: number
  verdict: PhrasePeriodVerdict
}

/** Where a phrase length came from. 'measured' is the app's reading,
 * 'nominal' is the loop's stated length -- and the user picked between
 * them. There is no third value: a number nobody chose has no business
 * sizing anybody's arrangement. */
export type CoachPhraseSource = 'measured' | 'nominal'

/** The user's ANSWER. The only number section sizing ever reads. */
export interface CoachPhrase {
  bars: number
  source: CoachPhraseSource
}

/** What the app measured, which is a different thing from what the user
 * chose. Kept so the offer survives a reload: he can change his answer
 * later and the map re-sizes. */
export interface LoopPhraseReading {
  /** The loop's own nominal length -- the longest stem's barLength, the
   * same rule LockedClimax.barLength already uses. */
  nominalBars: number
  /** The measurement, or null when there is not an honest one to give. */
  phraseBars: number | null
  measuredStems: number
  inconclusiveStems: number
}

export function readLoopPhrase(
  readings: readonly StemPhraseReading[],
  nominalBars: number
): LoopPhraseReading {
  let phraseBars: number | null = null
  let measuredStems = 0
  let inconclusiveStems = 0
  for (const reading of readings) {
    if (reading.verdict.kind !== 'period') {
      inconclusiveStems += 1
      continue
    }
    measuredStems += 1
    // The LONGEST true period wins -- see this module's own doc comment.
    if (phraseBars === null || reading.verdict.bars > phraseBars) {
      phraseBars = reading.verdict.bars
    }
  }
  return { nominalBars, phraseBars, measuredStems, inconclusiveStems }
}

/** Whether there is anything worth saying. False when the measurement is
 * inconclusive AND false when it simply agrees with the nominal length:
 * "your 8-bar loop is 8 bars" is not a finding, it is noise. */
export function loopPhraseIsWorthSaying(reading: LoopPhraseReading): boolean {
  return reading.phraseBars !== null && reading.phraseBars < reading.nominalBars
}

/** The answers the user gets to choose between -- the measured value and
 * the nominal one, measured first because it is the one he has not already
 * seen. One option when there is nothing to compare. */
export function phraseAnswerOptions(reading: LoopPhraseReading): readonly CoachPhrase[] {
  const nominal: CoachPhrase = { bars: reading.nominalBars, source: 'nominal' }
  if (!loopPhraseIsWorthSaying(reading) || reading.phraseBars === null) return [nominal]
  return [{ bars: reading.phraseBars, source: 'measured' }, nominal]
}

/** The report, or null -- "if the measurement is inconclusive, sssketchy
 * says nothing rather than guessing" (spec). Deterministic on the seed; see
 * ./coachLines.ts for why this is never Math.random. */
export function coachPhraseLine(reading: LoopPhraseReading, seed: number): string | null {
  if (!loopPhraseIsWorthSaying(reading) || reading.phraseBars === null) return null
  return pickLineVariant(COACH_PHRASE_LINE_TEMPLATES, seed)
    .replace('{nominal}', String(reading.nominalBars))
    .replace('{phrase}', String(reading.phraseBars))
}

function positiveBars(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.round(value))
}

function wholeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.round(value)
}

/** Repair-rather-than-trust, like every other loader in this layer: a
 * `.sssketchproj` is plain JSON people can and do hand-edit, and a load
 * must never throw. A reading with no usable nominal length is dropped
 * entirely; an unusable measurement becomes null, which reads as
 * "inconclusive" everywhere downstream. */
export function sanitiseLoopPhraseReading(value: unknown): LoopPhraseReading | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  const nominalBars = positiveBars(loose.nominalBars)
  if (nominalBars === null) return null
  return {
    nominalBars,
    phraseBars: positiveBars(loose.phraseBars),
    measuredStems: wholeCount(loose.measuredStems),
    inconclusiveStems: wholeCount(loose.inconclusiveStems)
  }
}

/** The user's answer, repaired. An answer with no usable bar count, or one
 * claiming a source this build does not know, is dropped rather than
 * guessed at -- the map then simply has no phrase yet, which is a state it
 * already handles. */
export function sanitiseCoachPhrase(value: unknown): CoachPhrase | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  const bars = positiveBars(loose.bars)
  if (bars === null) return null
  if (loose.source !== 'measured' && loose.source !== 'nominal') return null
  return { bars, source: loose.source }
}
