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

import type { DiscoverSlotKind } from './discoverSlotKind'
import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'
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

// ---- the moves and the draw ----

export type TurnaroundMove = 'drum drop' | 'low drop' | 'stop' | 'wash' | 'lift' | 'dip' | 'riser'

/** Every move, in the order the draw walks them. */
export const TURNAROUND_MOVES: readonly TurnaroundMove[] = [
  'drum drop',
  'low drop',
  'stop',
  'wash',
  'lift',
  'dip',
  'riser'
]

/** Where the density arc is heading. An INPUT: the caller reads its own arc (turnaroundArc). */
export type TurnaroundArc = 'growing' | 'thinning' | 'steady'

/** Spec section 2. Thinning drops nothing (rows that come back on the one read as growth); the
 * stop, the biggest move here, is the rarest everywhere. */
export const TURNAROUND_WEIGHTS: Readonly<
  Record<TurnaroundArc, Readonly<Record<TurnaroundMove, number>>>
> = {
  growing: { 'drum drop': 2, 'low drop': 3, stop: 1, wash: 0, lift: 3, dip: 0, riser: 3 },
  thinning: { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 3, lift: 0, dip: 3, riser: 0 },
  steady: { 'drum drop': 2, 'low drop': 2, stop: 1, wash: 1, lift: 2, dip: 1, riser: 1 }
}

/** One row as the planner sees it. `id` is opaque (a radio slot, a timeline channel). */
export interface TurnaroundRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  /** The row is held longer (radio's hook): the stop keeps it first, when it is melodic. */
  hooked: boolean
  /** Heard right now. A row that is not is never touched and does not count. */
  audible: boolean
  /** A change's filter in is sweeping it this lap: filter moves skip it. */
  inFilterIn: boolean
  /** Its own loop, in bars: a stop is never longer. */
  barLength: number
}

/** What a plan does to one row. Every curve is in beats before the wrap (see the curves). */
export interface TurnaroundRowCurves {
  rowId: string
  volume?: TurnaroundPoint[]
  filter?: TurnaroundFilter
  reverbSend?: TurnaroundWash
}

export interface TurnaroundPlan {
  move: TurnaroundMove
  /** The move's length in beats, ending on the wrap. */
  beats: number
  /** 0 for a fresh move; 1 or 2 for a diminution (the same move at half the length). */
  halvings: number
  rows: TurnaroundRowCurves[]
  /** The riser's length in bars (its own voice; `rows` is empty). */
  riserBars?: number
}

/** What a phrase end fired, kept for the next one: never twice in a row, except diminution. */
export interface TurnaroundMemory {
  move: TurnaroundMove
  beats: number
  halvings: number
}

export interface TurnaroundInput {
  rate: RadioTurnarounds
  random: () => number
  /** The loop the move plays in (its lap ends on the wrap). */
  loopBars: number
  /** rememberTurnaround of the previous phrase end, or null when nothing fired there. */
  lastPhrase: TurnaroundMemory | null
  rows: readonly TurnaroundRow[]
  arc: TurnaroundArc
  /** The row the arc removes at this wrap, if any: the wash's target. */
  leavingRowId: string | null
}

/** Length menus, in beats unless named bars. The spec weights only the stop's. */
const LOW_DROP_BEATS: readonly number[] = [2, 4, 8]
const STOP_BEATS: readonly { item: number; weight: number }[] = [
  { item: 1, weight: 2 },
  { item: 2, weight: 2 },
  { item: 4, weight: 1 }
]
const LIFT_BEATS: readonly number[] = [4, 8]
const RISER_BARS: readonly number[] = [1, 2, 4]
const WASH_BEATS = 4
const DIP_BEATS = 4

/** Each move's shortest length: a move whose shortest does not fit the cap is out of the draw. */
const SHORTEST_BEATS: Readonly<Record<TurnaroundMove, number>> = {
  'drum drop': 1,
  'low drop': 2,
  stop: 1,
  wash: 4,
  lift: 4,
  dip: 4,
  riser: 4
}

/** The moves a diminution may repeat (spec section 1). */
const DIMINISHING: readonly TurnaroundMove[] = ['drum drop', 'low drop', 'lift']
export const TURNAROUND_MAX_HALVINGS = 2

/** How far the filter and wash moves go. */
interface TurnaroundLooks {
  liftTop: number
  dipFloor: number
  washPeak: number
}

const BOLD_LOOKS: TurnaroundLooks = {
  liftTop: TURNAROUND_LIFT_TOP,
  dipFloor: TURNAROUND_DIP_FLOOR,
  washPeak: TURNAROUND_WASH_PEAK
}

const isDrums = (r: TurnaroundRow): boolean => r.kinds.includes('drums')
const isLow = (r: TurnaroundRow): boolean => isDrums(r) || r.kinds.includes('bass')
const isMelodic = (r: TurnaroundRow): boolean => !isLow(r)

/** The row a stop keeps playing: melodic, never drums or bass (the rest measure keeps a hook
 * line). The hook row if it is melodic, else a lead, else any melodic row; null for none. */
export function turnaroundStopKeeper(audible: readonly TurnaroundRow[]): TurnaroundRow | null {
  return (
    audible.find((r) => r.hooked && isMelodic(r)) ??
    audible.find((r) => isMelodic(r) && r.kinds.includes('lead')) ??
    audible.find(isMelodic) ??
    null
  )
}

/** The rows each move would act on, worked out once per roll, with no randomness. */
interface Bed {
  audible: TurnaroundRow[]
  drums: TurnaroundRow[]
  low: TurnaroundRow[]
  keeper: TurnaroundRow | null
  washed: TurnaroundRow[]
  filtered: TurnaroundRow[]
}

function bedOf(rows: readonly TurnaroundRow[], leavingRowId: string | null): Bed {
  const audible = rows.filter((r) => r.audible)
  const leaving = leavingRowId === null ? undefined : audible.find((r) => r.id === leavingRowId)
  return {
    audible,
    drums: audible.filter(isDrums),
    low: audible.filter(isLow),
    keeper: turnaroundStopKeeper(audible),
    washed: leaving !== undefined ? [leaving] : audible.filter((r) => !isDrums(r)),
    filtered: audible.filter((r) => !isDrums(r) && !r.inFilterIn)
  }
}

/** The guards (spec section 2): a move is in the draw only when it can sound and leaves music
 * playing. */
function canSound(move: TurnaroundMove, bed: Bed): boolean {
  const n = bed.audible.length
  switch (move) {
    case 'drum drop':
      return n >= 2 && bed.drums.length > 0
    case 'low drop':
      return n >= 2 && bed.low.length > 0 && bed.low.length < n
    case 'stop':
      return n >= 2 && bed.keeper !== null && bed.keeper.barLength * BEATS_PER_BAR >= 1
    case 'wash':
      return bed.washed.length > 0
    case 'lift':
    case 'dip':
      return bed.filtered.length > 0
    case 'riser':
      return n > 0
  }
}

function pickWeighted<T>(items: readonly { item: T; weight: number }[], random: () => number): T {
  const total = items.reduce((sum, x) => sum + x.weight, 0)
  let draw = random() * total
  for (const x of items) {
    draw -= x.weight
    if (draw < 0) return x.item
  }
  return items[items.length - 1].item
}

function pickEven<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

function drawOf(bed: Bed, arc: TurnaroundArc, capBeats: number): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) => weights[m] > 0 && SHORTEST_BEATS[m] <= capBeats && canSound(m, bed)
  )
}

/** The moves a phrase end could draw right now, with no randomness: the guards, the cap and the
 * arc's weights. rollTurnaround draws from exactly this. */
export function turnaroundDraw(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'arc'>
): TurnaroundMove[] {
  const capBeats = turnaroundCapBeats(input.loopBars)
  if (!(capBeats > 0)) return []
  return drawOf(bedOf(input.rows, input.leavingRowId), input.arc, capBeats)
}

function drawBeats(move: TurnaroundMove, bed: Bed, capBeats: number, random: () => number): number {
  switch (move) {
    case 'drum drop':
      return Math.min(pickDropOutBeats(random), capBeats)
    case 'low drop':
      return Math.min(pickEven(LOW_DROP_BEATS, random), capBeats)
    case 'stop': {
      // never longer than the kept row's own loop (canSound saw that 1 beat fits)
      const most = (bed.keeper?.barLength ?? 0) * BEATS_PER_BAR
      return Math.min(
        pickWeighted(
          STOP_BEATS.filter((o) => o.item <= most),
          random
        ),
        capBeats
      )
    }
    case 'lift':
      return Math.min(pickEven(LIFT_BEATS, random), capBeats)
    case 'riser':
      return Math.min(pickEven(RISER_BARS, random) * BEATS_PER_BAR, capBeats)
    case 'wash':
      return Math.min(WASH_BEATS, capBeats)
    case 'dip':
      return Math.min(DIP_BEATS, capBeats)
  }
}

function build(
  move: TurnaroundMove,
  beats: number,
  halvings: number,
  bed: Bed,
  loopBars: number,
  random: () => number,
  looks: TurnaroundLooks
): TurnaroundPlan | null {
  const plan = (rows: TurnaroundRowCurves[]): TurnaroundPlan => ({ move, beats, halvings, rows })
  switch (move) {
    case 'drum drop': {
      const volume = turnaroundDropCurve(loopBars, beats)
      if (volume.length === 0) return null
      return plan([{ rowId: pickEven(bed.drums, random).id, volume }])
    }
    case 'low drop':
    case 'stop': {
      const volume = turnaroundDropCurve(loopBars, beats)
      if (volume.length === 0) return null
      const dropped = move === 'low drop' ? bed.low : bed.audible.filter((r) => r !== bed.keeper)
      return plan(dropped.map((r) => ({ rowId: r.id, volume: volume.map((p) => ({ ...p })) })))
    }
    case 'wash':
      return plan(
        bed.washed.map((r) => ({
          rowId: r.id,
          reverbSend: turnaroundWashCurve(beats, looks.washPeak)
        }))
      )
    case 'lift':
      return plan(
        bed.filtered.map((r) => ({
          rowId: r.id,
          filter: turnaroundLiftCurve(beats, looks.liftTop)
        }))
      )
    case 'dip':
      return plan(
        bed.filtered.map((r) => ({
          rowId: r.id,
          filter: turnaroundDipCurve(beats, looks.dipFloor)
        }))
      )
    case 'riser':
      return { ...plan([]), riserBars: beats / BEATS_PER_BAR }
  }
}

/**
 * THE phrase end's roll -- once, at the start of the lap that ends a phrase (RadioClockStep's
 * turnaroundLapStarts). Null for "nothing this phrase end".
 *
 * - Never at two phrase ends in a row, except DIMINUTION: after a drum drop, a low drop or a
 *   lift, the next phrase end may repeat the same move at half its length -- two halvings at
 *   most, at the same rate, never below one beat, and only while the arc still weights it and
 *   its guards pass.
 * - Otherwise: the rate, then a move weighted by the arc among those that can sound and fit
 *   min(half the loop, 4 bars), then its length, then (a drum drop) its row.
 *
 * Guards are checked before any draw, so a phrase end that cannot have one costs no randomness.
 * Every move ends exactly on the one; only WHEN a phrase end gets one is rolled.
 */
export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
  const { random, loopBars, lastPhrase, arc } = input
  const chance = TURNAROUND_CHANCE[input.rate] ?? 0
  const capBeats = turnaroundCapBeats(loopBars)
  if (!(chance > 0) || !(capBeats > 0)) return null
  const bed = bedOf(input.rows, input.leavingRowId)
  if (lastPhrase !== null) {
    const { move } = lastPhrase
    if (!DIMINISHING.includes(move) || lastPhrase.halvings >= TURNAROUND_MAX_HALVINGS) return null
    const beats = Math.min(lastPhrase.beats / 2, capBeats)
    if (beats < 1 || !(TURNAROUND_WEIGHTS[arc][move] > 0) || !canSound(move, bed)) return null
    if (!(random() < chance)) return null
    return build(move, beats, lastPhrase.halvings + 1, bed, loopBars, random, BOLD_LOOKS)
  }
  const moves = drawOf(bed, arc, capBeats)
  if (moves.length === 0 || !(random() < chance)) return null
  const move = pickWeighted(
    moves.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
    random
  )
  return build(move, drawBeats(move, bed, capBeats, random), 0, bed, loopBars, random, BOLD_LOOKS)
}

/** What to remember of a phrase end for the next one. */
export function rememberTurnaround(plan: TurnaroundPlan | null): TurnaroundMemory | null {
  return plan === null ? null : { move: plan.move, beats: plan.beats, halvings: plan.halvings }
}

/** The arc's direction from a density leg (radioDensity's DensityLeg, or the web radio's
 * RadioDensity): steady with no leg, and at or past its target (it is about to turn round --
 * radioDensity has no hold); otherwise its phase. The caller passes `steady` with density off. */
export function turnaroundArc(
  leg: { phase: 'growing' | 'thinning'; target: number } | null,
  count: number
): TurnaroundArc {
  if (leg === null) return 'steady'
  if (leg.phase === 'growing') return count < leg.target ? 'growing' : 'steady'
  return count > leg.target ? 'thinning' : 'steady'
}
