// src/shared/radioTurnaround.ts
//
// THE PHRASE TURNAROUND -- docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md.
// Radio decorates a layer change well, but nothing marked the STRUCTURE: when no layer
// happened to change, a phrase ended like any other bar. At the end of a phrase, arranged loop
// music drops the drums for a beat, the low end for a bar, washes, lifts or dips a filter, or
// rises into the one. This is that, as one pure planner shared by both radios (sssketch's
// Discover radio and ell.ing/radio); each radio writes its own playback.
//
// What the planner promises its callers (spec section 7), so auto-arrange can be a third:
//   - all randomness comes from the injected `random`;
//   - rows are opaque ids (a radio slot or a timeline channel, it does not care which);
//   - a plan is in BEATS BEFORE THE WRAP it ends on (0 = the one), never in a runtime's clock;
//   - the density arc is an input; this file never reads radioDensity.
//
// It must not import radioSchedule: radioSchedule imports it.

/** How often a phrase end gets a turnaround. Absorbed the old `dropOuts` row (2026-10-02). */
export type RadioTurnarounds = 'off' | 'rare' | 'often'

export const RADIO_TURNAROUNDS_OPTIONS: RadioTurnarounds[] = ['off', 'rare', 'often']

/** sssketch's default, as drop-outs' was. The web radio's is `often` (WEB_RADIO_DEFAULTS),
 * Elling's drop-outs choice there. */
export const DEFAULT_RADIO_TURNAROUNDS: RadioTurnarounds = 'rare'

/** The rate, falling back to an old `dropOuts` value (the setting this one absorbs) when
 * `value` is missing or unreadable, then to the default. */
export function normalizeRadioTurnarounds(
  value: unknown,
  legacyDropOuts?: unknown
): RadioTurnarounds {
  const known = (v: unknown): v is RadioTurnarounds =>
    RADIO_TURNAROUNDS_OPTIONS.includes(v as RadioTurnarounds)
  if (known(value)) return value
  if (known(legacyDropOuts)) return legacyDropOuts
  return DEFAULT_RADIO_TURNAROUNDS
}

/** Chance a phrase end gets one. No source gives a frequency for phrase-end moves (spec
 * section 0): one in three and two in three are a guess, to tune by ear. */
export const TURNAROUND_CHANCE: Readonly<Record<RadioTurnarounds, number>> = {
  off: 0,
  rare: 1 / 3,
  often: 2 / 3
}

/** The phrase when `phraseBars` is 0 (no phrase grid): the turnaround still counts 16 bars. */
export const TURNAROUND_DEFAULT_PHRASE_BARS = 16

/** 4/4, as everywhere else in Discover. */
const BEATS_PER_BAR = 4

/** One hypermeasure: no move is longer (spec section 0, "Hypermeter"). */
export const TURNAROUND_MAX_BARS = 4

/** Laps of a `loopBars` loop in one turnaround phrase: the phrase is `phraseBars` (16 when it
 * is 0), rounded UP to whole laps, so a phrase is never shorter than its bar count and a loop
 * of 16 bars or more makes every wrap a phrase end (a 32-bar loop is one 32-bar phrase). 0 for
 * a loop it cannot count. The float slack keeps 16 / (16 / 3) at three laps. */
export function turnaroundPhraseLaps(phraseBars: number, loopBars: number): number {
  if (!(loopBars > 0) || !Number.isFinite(loopBars)) return 0
  const phrase = phraseBars > 0 ? phraseBars : TURNAROUND_DEFAULT_PHRASE_BARS
  return Math.max(1, Math.ceil(phrase / loopBars - 1e-9))
}

/** The longest any move may be, in beats: min(half the loop, 4 bars). Half the loop is the
 * rule every curve in radioTransition.ts already keeps (a gesture never runs into the wrap it
 * is anchored to); 4 bars is the hypermeasure. 0 for a loop it cannot place a move in. */
export function turnaroundCapBeats(loopBars: number): number {
  if (!(loopBars > 0) || !Number.isFinite(loopBars)) return 0
  return Math.min(loopBars / 2, TURNAROUND_MAX_BARS) * BEATS_PER_BAR
}
