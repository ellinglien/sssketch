// src/shared/radioPace.ts
//
// THE PACE SLIDER (docs/superpowers/specs/2026-10-03-radio-pace-slider-design.md). One number,
// 0..100, replaces the slow / mid / fast chips in both radios. radioPaceProfile maps it to
// everything that sets how often radio changes something:
//
//   window    the bars drawn for each interval (geometric between knots, whole bars)
//   phrase    a cap on the phrase grid a change may land on (16 -> 8 -> 4 -> every loop top)
//   barEvery  in the top band, a change may land MID-LOOP on a bar line this many bars apart,
//             whatever the stems' lengths (Elling, 2026-10-03: "extreme should be extreme ... yes
//             mid loop is fine")
//   rows      how many rows one change turns over (fractional: the remainder is a chance)
//
// The three old chips are fixed positions and reproduce today exactly: slow 0, mid 25, fast 50.
// Pure numbers: this module imports nothing at runtime, so radioSchedule can import it.

import type { RadioPace } from './radioSchedule'

export const RADIO_PACE_LEVEL_MIN = 0
export const RADIO_PACE_LEVEL_MAX = 100

/** The words the readout uses at their positions. */
export type RadioPaceWord = 'slow' | 'mid' | 'fast' | 'ludicrous'

/** Where today's chips sit, and where `ludicrous` starts. slow/mid/fast reproduce
 * RADIO_PACE_BARS exactly (window, phrase, one row); half the slider is above today's fast,
 * because that is the territory Elling is asking to explore. */
export const RADIO_PACE_ANCHORS: Readonly<Record<RadioPaceWord, number>> = Object.freeze({
  slow: 0,
  mid: 25,
  fast: 50,
  ludicrous: 90
})

/** The desktop's default (its old default chip, mid). The web's is its own (ell.ing/radio's
 * DEFAULT_WEB_PACE_LEVEL, 60). */
export const DEFAULT_RADIO_PACE_LEVEL = RADIO_PACE_ANCHORS.mid

/** The drawn window at each knot: [level, min bars, max bars]. Between knots each edge is
 * interpolated geometrically (bars are a ratio scale: 3 -> 6 is as big a step as 24 -> 48) and
 * rounded to whole bars. The first three knots are RADIO_PACE_BARS' slow, mid and fast. */
export const RADIO_PACE_WINDOW_KNOTS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [0, 24, 48],
    [25, 8, 16],
    [50, 3, 6],
    [60, 2, 4],
    [70, 1, 2],
    [100, 1, 1]
  ] as const)

/** The phrase cap above fast: at or below each level, the phrase is at most that many bars
 * (0 = no phrase grid: every loop top). The runtime's own phrase (the web's 16, the desktop's
 * `phrase` chip) applies at fast and below. */
export const RADIO_PACE_PHRASE_CAPS: readonly (readonly [number, number])[] = Object.freeze([
  [60, 8],
  [70, 4]
] as const)

/** From this level up, changes may land mid-loop on bar lines: every 4 bars, then 2, then 1. */
export const RADIO_PACE_BAR_BANDS: readonly (readonly [number, number])[] = Object.freeze([
  [80, 4],
  [87, 2],
  [94, 1]
] as const)

/** Rows per change: 1 up to this level, then rising linearly to RADIO_PACE_ROWS_MAX at 100. */
export const RADIO_PACE_ROWS_FROM = 70
export const RADIO_PACE_ROWS_MAX = 4

export interface RadioPaceProfile {
  level: number
  /** The interval window, whole bars, min <= max. */
  window: { min: number; max: number }
  /** The phrase cap, in bars: null = the runtime's own phrase; 0 = every loop top. */
  phraseCap: number | null
  /** Mid-loop landings on bar lines this many bars apart, or null (loop tops / own cycles). */
  barEvery: number | null
  /** Rows per change, 1..RADIO_PACE_ROWS_MAX; the fraction is the chance of one more. */
  rows: number
}

/** 0..100, whole numbers. Anything that is not a finite number: `fallback`. */
export function normalizeRadioPaceLevel(
  value: unknown,
  fallback = DEFAULT_RADIO_PACE_LEVEL
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(RADIO_PACE_LEVEL_MAX, Math.max(RADIO_PACE_LEVEL_MIN, value)))
}

function geo(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t)
}

function windowAt(
  level: number,
  knots: readonly (readonly [number, number, number])[] = RADIO_PACE_WINDOW_KNOTS
): { min: number; max: number } {
  let i = 0
  while (i < knots.length - 2 && level > knots[i + 1][0]) i++
  const [l0, min0, max0] = knots[i]
  const [l1, min1, max1] = knots[i + 1]
  const t = Math.min(1, Math.max(0, (level - l0) / (l1 - l0)))
  const min = Math.max(1, Math.round(geo(min0, min1, t)))
  return { min, max: Math.max(min, Math.round(geo(max0, max1, t))) }
}

/** Everything the slider sets, at `level` (normalised first). Pure, no randomness. */
export function radioPaceProfile(level: number): RadioPaceProfile {
  const p = normalizeRadioPaceLevel(level)
  let phraseCap: number | null = null
  if (p > RADIO_PACE_ANCHORS.fast) {
    phraseCap = 0
    for (const [upTo, bars] of RADIO_PACE_PHRASE_CAPS) {
      if (p <= upTo) {
        phraseCap = bars
        break
      }
    }
  }
  let barEvery: number | null = null
  for (const [from, bars] of RADIO_PACE_BAR_BANDS) if (p >= from) barEvery = bars
  const rows =
    p <= RADIO_PACE_ROWS_FROM
      ? 1
      : 1 +
        ((RADIO_PACE_ROWS_MAX - 1) * (p - RADIO_PACE_ROWS_FROM)) /
          (RADIO_PACE_LEVEL_MAX - RADIO_PACE_ROWS_FROM)
  return { level: p, window: windowAt(p), phraseCap, barEvery, rows }
}

/** The phrase a change may land on: the runtime's own `basePhraseBars` (0 = none) under the
 * profile's cap. A base of 0 stays 0 -- there is nothing to shorten -- and a cap of 0 removes the
 * grid. Turnarounds never read this: they keep the base (radioCadence's turnaroundPhraseBars). */
export function radioPacePhraseBars(profile: RadioPaceProfile, basePhraseBars: number): number {
  if (!(basePhraseBars > 0)) return 0
  if (profile.phraseCap === null) return basePhraseBars
  if (profile.phraseCap === 0) return 0
  return Math.min(basePhraseBars, profile.phraseCap)
}

/** How many rows THIS change turns over: floor(rows), plus one with the fraction's chance.
 * Never calls `random` when rows is whole, so at every level up to RADIO_PACE_ROWS_FROM a seeded
 * radio's random stream is exactly what it was before the slider. */
export function radioPaceRowsThisChange(
  profile: Pick<RadioPaceProfile, 'rows'>,
  random: () => number
): number {
  const whole = Math.floor(profile.rows)
  const frac = profile.rows - whole
  if (frac <= 0) return whole
  return whole + (random() < frac ? 1 : 0)
}

/** The readout: the word at its position (slow, mid, fast) and through the ludicrous band; the
 * bar line cadence in the mid-loop band; the drawn window otherwise. Lowercase, short enough for
 * a phone. */
export function radioPaceLabel(level: number, options: { fold?: boolean } = {}): string {
  const profile = radioPaceProfile(level)
  const p = profile.level
  // Fold mode (2026-10-03 fold follows pace): fold's own window up to where it joins the slider,
  // so the readout never names a word (slow / mid / fast) fold does not play.
  if (options.fold === true && p < RADIO_FOLD_PACE_JOINS) {
    const { min, max } = radioFoldPaceProfile(p).window
    return min === max ? `${min} bar${min === 1 ? '' : 's'}` : `${min}-${max} bars`
  }
  if (p >= RADIO_PACE_ANCHORS.ludicrous) return 'ludicrous'
  if (p === RADIO_PACE_ANCHORS.slow) return 'slow'
  if (p === RADIO_PACE_ANCHORS.mid) return 'mid'
  if (p === RADIO_PACE_ANCHORS.fast) return 'fast'
  // The 'every bar' branch is unreachable while ludicrous starts at 90 and the one-bar grid at 94;
  // it is reserved in case the ludicrous threshold moves (spec flag 13).
  if (profile.barEvery !== null)
    return profile.barEvery === 1 ? 'every bar' : `every ${profile.barEvery} bars`
  const { min, max } = profile.window
  return min === max ? `${min} bar${min === 1 ? '' : 's'}` : `${min}-${max} bars`
}

export const RADIO_PACE_LABEL = 'pace'
export const RADIO_PACE_TOOLTIP = 'how often radio changes something'

/** The level a pre-slider setting means. A preset word is its anchor. A window (the desktop's
 * hand-tuned min/max steppers) is the level whose window is nearest in log space -- the same
 * ratio scale the knots interpolate on -- searched only up to fast, where the window is the only
 * thing that differs, so a migrated window never quietly turns on a shorter phrase, mid-loop
 * landings or extra rows. A window equal to any preset's is that preset; no usable window is the
 * word's own anchor. */
export function radioPaceLevelFromLegacy(pace: unknown, legacyWindow?: unknown): number {
  const word: RadioPace | null =
    pace === 'slow' || pace === 'mid' || pace === 'fast' ? (pace as RadioPace) : null
  const anchor = word === null ? DEFAULT_RADIO_PACE_LEVEL : RADIO_PACE_ANCHORS[word]
  const raw = (typeof legacyWindow === 'object' && legacyWindow !== null ? legacyWindow : {}) as {
    min?: unknown
    max?: unknown
  }
  const min = Number(raw.min)
  const max = Number(raw.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) return anchor
  // A window that IS a preset's (his own chip's, or one he stepped back onto) is that preset.
  for (const w of ['slow', 'mid', 'fast'] as const) {
    const at = radioPaceProfile(RADIO_PACE_ANCHORS[w]).window
    if (at.min === min && at.max === max) return RADIO_PACE_ANCHORS[w]
  }
  // Otherwise the nearest. Rounding makes neighbouring levels share a window, so a tie is
  // common: an anchor among the tied levels wins (a window past fast's is fast, not 48), else the
  // slowest of them.
  const anchors: readonly number[] = [
    RADIO_PACE_ANCHORS.slow,
    RADIO_PACE_ANCHORS.mid,
    RADIO_PACE_ANCHORS.fast
  ]
  let best = anchor
  let bestDistance = Number.POSITIVE_INFINITY
  for (let p = RADIO_PACE_LEVEL_MIN; p <= RADIO_PACE_ANCHORS.fast; p++) {
    const w = radioPaceProfile(p).window
    const d = Math.abs(Math.log(w.min / min)) + Math.abs(Math.log(w.max / max))
    const tie = Math.abs(d - bestDistance) <= 1e-12
    if (d < bestDistance - 1e-12 || (tie && anchors.includes(p) && !anchors.includes(best))) {
      best = p
      bestDistance = Math.min(d, bestDistance)
    }
  }
  return best
}

/** The web's simple-mode cycle (controlsModel's `pace` control): slow -> mid -> fast ->
 * ludicrous -> slow, from the first anchor above the level. A non-finite level normalises to the
 * default (25) first, so it steps to fast. */
export function nextRadioPaceAnchor(level: number): number {
  const p = normalizeRadioPaceLevel(level)
  const order = [
    RADIO_PACE_ANCHORS.slow,
    RADIO_PACE_ANCHORS.mid,
    RADIO_PACE_ANCHORS.fast,
    RADIO_PACE_ANCHORS.ludicrous
  ]
  return order.find((a) => a > p) ?? order[0]
}

// ---- fold mode follows the slider (docs/superpowers/specs/2026-10-03-radio-fold-follows-pace-design.md)

/** At or below this level fold mode keeps its own cadence exactly: FOLD_PACE_BARS (8-32), the
 * runtime's phrase, the realignment preference, one row, the fold machine unhurried. */
export const RADIO_FOLD_PACE_FROM = RADIO_PACE_ANCHORS.fast
/** At or above this level fold mode's change cadence IS the slider's (window, phrase, bar band,
 * rows); only the folded rows themselves differ (radioCadenceBarEvery). */
export const RADIO_FOLD_PACE_JOINS = 80
/** Fold's window above RADIO_FOLD_PACE_FROM: [level, min, max], geometric between knots like the
 * slider's. The first is FOLD_PACE_BARS (radioFold.ts; pinned equal by test, since this module
 * imports nothing at runtime); the last is the slider's own window at RADIO_FOLD_PACE_JOINS. */
export const RADIO_FOLD_PACE_WINDOW_KNOTS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [50, 8, 32],
    [60, 4, 12],
    [70, 2, 4],
    [80, 1, 2]
  ] as const)
/** The laps a change may wait past its draw for a realignment top (radioFoldIntervalBars): fold's
 * FOLD_PREFER_WAIT_LAPS (2) up to 60, 1 up to 70, none above -- "impolite" from the band where
 * every loop top is a landing. */
export const RADIO_FOLD_PREFER_WAIT_BANDS: readonly (readonly [number, number])[] = Object.freeze([
  [60, 2],
  [70, 1]
] as const)
/** The fold machine hurries above this level (radioFold's `hurry`, 0 here, 1 at 100). */
export const RADIO_FOLD_HURRY_FROM = 70

export interface RadioFoldPaceProfile extends RadioPaceProfile {
  /** Laps a change may wait for a realignment top. */
  preferWaitLaps: number
  /** 0..1: how much the fold machine's own timers shorten (stepRadioFold's `hurry`). */
  hurry: number
}

/** Fold mode's cadence at `level`. At or below RADIO_FOLD_PACE_FROM, fold's own exactly (8-32 bars,
 * no phrase cap, one row, a 2-lap realignment preference, no hurry) whatever the level, as before
 * the slider reached fold. Above, the window shrinks along RADIO_FOLD_PACE_WINDOW_KNOTS, the phrase
 * cap and rows are the slider's, the preference fades out by 71; from RADIO_FOLD_PACE_JOINS
 * everything but the hurry is the slider's profile, bar band included. Pure, no randomness. */
export function radioFoldPaceProfile(level: number): RadioFoldPaceProfile {
  const pace = radioPaceProfile(level)
  const p = pace.level
  if (p <= RADIO_FOLD_PACE_FROM) {
    return {
      level: p,
      window: { min: 8, max: 32 },
      phraseCap: null,
      barEvery: null,
      rows: 1,
      preferWaitLaps: 2,
      hurry: 0
    }
  }
  let preferWaitLaps = 0
  for (const [upTo, laps] of RADIO_FOLD_PREFER_WAIT_BANDS) {
    if (p <= upTo) {
      preferWaitLaps = laps
      break
    }
  }
  const hurry = Math.max(
    0,
    (p - RADIO_FOLD_HURRY_FROM) / (RADIO_PACE_LEVEL_MAX - RADIO_FOLD_HURRY_FROM)
  )
  const window =
    p >= RADIO_FOLD_PACE_JOINS ? pace.window : windowAt(p, RADIO_FOLD_PACE_WINDOW_KNOTS)
  return { ...pace, window: { ...window }, preferWaitLaps, hurry }
}
