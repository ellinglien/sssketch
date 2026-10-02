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

import { buildDropOutCurve } from './radioDropOut'
import type { AutomationPoint, FilterMode } from './toolkit'

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

// ---- the curves ----
//
// Every curve is a list of points in BEATS BEFORE THE WRAP the move ends on, in time order, so
// each runtime maps it onto its own clock (sssketch: clip-relative bars of the lap,
// turnaroundToLoopBars; ell.ing/radio: AudioContext seconds). The last two points are both on
// the one: the value held into it, then the resting value -- a step, since every move ends
// with every row back in full on the one (spec section 0, "release is return").

export interface TurnaroundPoint {
  /** Beats before the wrap (0 = the one). */
  beats: number
  value: number
}

/** A filter move: the stem's filter in `mode`, its normalised cutoff over the move. */
export interface TurnaroundFilter {
  mode: FilterMode
  cutoff: TurnaroundPoint[]
}

/** The wash, RELATIVE: each point's value is a mix from the row's own send (0) to `peak` (1).
 * Each runtime puts the row's own send in (turnaroundWashSend). */
export interface TurnaroundWash {
  peak: number
  points: TurnaroundPoint[]
}

/** The spec's numbers (section 2) -- the `bold` depth. */
export const TURNAROUND_LIFT_TOP = 0.6
export const TURNAROUND_DIP_FLOOR = 0.35
export const TURNAROUND_WASH_PEAK = 0.85

/** A drop's `volume` curve: radioDropOut's buildDropOutCurve (full, a 0.02-bar ramp to
 * silence `beats` before the wrap, silent into it), counted back from the wrap, and back to
 * full on the one. Its bar-0 point is dropped: the lap's start is the runtime's business. [] for
 * anything buildDropOutCurve cannot place. */
export function turnaroundDropCurve(loopBars: number, beats: number): TurnaroundPoint[] {
  const curve = buildDropOutCurve(loopBars, beats)
  if (curve.length === 0) return []
  return [
    ...curve.slice(1).map((p) => ({ beats: (loopBars - p.bar) * BEATS_PER_BAR, value: p.value })),
    { beats: 0, value: 1 }
  ]
}

/** The lift: a high-pass from open (0) up to `top` over `beats`, open again on the one. */
export function turnaroundLiftCurve(beats: number, top = TURNAROUND_LIFT_TOP): TurnaroundFilter {
  return {
    mode: 'highpass',
    cutoff: [
      { beats, value: 0 },
      { beats: 0, value: top },
      { beats: 0, value: 0 }
    ]
  }
}

/** The dip: the low-pass from open (1) down to `floor` over `beats`, open again on the one. */
export function turnaroundDipCurve(beats: number, floor = TURNAROUND_DIP_FLOOR): TurnaroundFilter {
  return {
    mode: 'lowpass',
    cutoff: [
      { beats, value: 1 },
      { beats: 0, value: floor },
      { beats: 0, value: 1 }
    ]
  }
}

/** The wash: the send rises from the row's own to `peak` over `beats`, its own again on the one. */
export function turnaroundWashCurve(beats: number, peak = TURNAROUND_WASH_PEAK): TurnaroundWash {
  return {
    peak,
    points: [
      { beats, value: 0 },
      { beats: 0, value: 1 },
      { beats: 0, value: 0 }
    ]
  }
}

/** A wash in absolute send values, from the row's own send. Never dips a send already above the
 * peak; an unreadable send is 0. */
export function turnaroundWashSend(wash: TurnaroundWash, ownSend: number): TurnaroundPoint[] {
  const own = Number.isFinite(ownSend) ? Math.min(1, Math.max(0, ownSend)) : 0
  const peak = Math.max(own, wash.peak)
  return wash.points.map((p) => ({ beats: p.beats, value: own + (peak - own) * p.value }))
}

/** A curve as CLIP-RELATIVE bars of the lap that ends on the wrap -- what a Discover preview
 * stem's automation lane takes (sssketch). The resting value sits at bar 0, the move's points
 * at `loopBars - beats / 4`, and the step back to rest on the one is dropped: a lane repeats
 * every lap, so the lap wrapping IS that step. For a drop this gives back buildDropOutCurve
 * exactly. [] for no points or no loop. */
export function turnaroundToLoopBars(
  points: readonly TurnaroundPoint[],
  loopBars: number
): AutomationPoint[] {
  if (points.length === 0 || !(loopBars > 0)) return []
  const rest = points[points.length - 1].value
  return [
    { bar: 0, value: rest },
    ...points.slice(0, -1).map((p) => ({ bar: loopBars - p.beats / BEATS_PER_BAR, value: p.value }))
  ]
}
