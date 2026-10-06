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
import { buildDropOutCurve, DROP_OUT_BEAT_WEIGHTS, pickDropOutBeats } from './radioDropOut'
import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'
import type { RadioBuildSize, RadioPayoff } from './radioBuildSize'
import { seededRandom } from './seededRandom'
import {
  evaluateAutomation,
  type AutomationParam,
  type AutomationPoint,
  type FilterMode
} from './toolkit'

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

/** Float slack for the cap checks below: a move exactly at the cap fits. */
const CAP_SLACK = 1e-9

/** A curve as CLIP-RELATIVE bars of the lap that ends on the wrap -- what a Discover preview
 * stem's automation lane takes (sssketch). The resting value sits at bar 0, the move's points
 * at `loopBars - beats / 4`, and the step back to rest on the one is dropped: a lane repeats
 * every lap, so the lap wrapping IS that step. For a drop this gives back buildDropOutCurve
 * exactly. [] for no points or no loop, and for a curve longer than the cap of THIS loop
 * (turnaroundCapBeats): a plan capped against another loop (one a landing changed) would run
 * past half of this one, or start before its bar 0 -- a drop silent for the whole lap. */
export function turnaroundToLoopBars(
  points: readonly TurnaroundPoint[],
  loopBars: number
): AutomationPoint[] {
  if (points.length === 0 || !(loopBars > 0)) return []
  const cap = turnaroundCapBeats(loopBars)
  if (points.some((p) => !(p.beats >= 0) || p.beats > cap + CAP_SLACK)) return []
  const rest = points[points.length - 1].value
  return [
    { bar: 0, value: rest },
    ...points.slice(0, -1).map((p) => ({ bar: loopBars - p.beats / BEATS_PER_BAR, value: p.value }))
  ]
}

/** Whether a plan fits the loop it is about to play in: its length and every curve point within
 * min(half the loop, 4 bars) (turnaroundCapBeats). The roll caps against the loop it saw; a
 * runtime whose loop has since changed drops a plan that no longer fits rather than play it. */
export function turnaroundFitsLoop(
  plan: Pick<TurnaroundPlan, 'beats' | 'rows'>,
  loopBars: number
): boolean {
  const cap = turnaroundCapBeats(loopBars)
  if (!(cap > 0) || !(plan.beats > 0) || plan.beats > cap + CAP_SLACK) return false
  const fits = (points: readonly TurnaroundPoint[] | undefined): boolean =>
    points === undefined || points.every((p) => p.beats >= 0 && p.beats <= cap + CAP_SLACK)
  return plan.rows.every(
    (r) => fits(r.volume) && fits(r.filter?.cutoff) && fits(r.reverbSend?.points)
  )
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
  /** A hook leaving on this wrap (radioHooks.ts) with its echo throw: no drop, stop or gap
   * silences it before the wrap, so the throw is heard, and it is the wash's row when a wash is
   * drawn (a reverb swell on a part going out is dub too). Absent: false. */
  exiting?: boolean
}

/** What a plan does to one row. Every curve is in beats before the wrap (see the curves). */
export interface TurnaroundRowCurves {
  rowId: string
  volume?: TurnaroundPoint[]
  filter?: TurnaroundFilter
  reverbSend?: TurnaroundWash
}

/** One move of a combined turnaround (spec 2026-10-03-radio-turnaround-combos-design): its
 * length in beats before the wrap and the rows it acts on ([] for the riser, its own voice). */
export interface TurnaroundPart {
  move: TurnaroundMove
  beats: number
  rowIds: string[]
}

export interface TurnaroundPlan {
  /** The LEAD move: the one drawn first (a phrase end's draw, or a turn's chip). */
  move: TurnaroundMove
  /** The whole turnaround's length in beats, ending on the wrap: its longest part. */
  beats: number
  /** 0 for a fresh move; 1 or 2 for a diminution (the same move at half the length). */
  halvings: number
  /** Every row's curves, merged across the parts and the gap: one entry per row. */
  rows: TurnaroundRowCurves[]
  /** The riser's SOUNDING length in bars (its own voice). With a gap it ends `gapBeats` before
   * the wrap. */
  riserBars?: number
  /** Combined plans only (TurnaroundInput.combine): every move, the lead first. */
  parts?: TurnaroundPart[]
  /** Combined plans only: the silence before the one after a riser, in beats (0 for none). */
  gapBeats?: number
  /** The melodic row that keeps playing through the gap, when one does. */
  keeperId?: string
}

/** What a phrase end fired, kept for the next one: never twice in a row, except diminution. */
export interface TurnaroundMemory {
  move: TurnaroundMove
  beats: number
  halvings: number
  /** A combined turnaround's moves (two or more), the lead first: diminution repeats the ones
   * that can diminish, together. Absent for a single move. */
  parts?: { move: TurnaroundMove; beats: number }[]
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
  /** The move families switched on (RadioSettings.turnaroundMoves); all when absent. None is
   * off. */
  moves?: readonly TurnaroundFamily[]
  /** How far the moves go (RadioSettings.turnaroundDepth); bold when absent. */
  depth?: TurnaroundDepth
  /** A TURN, not a phrase end (TurnaroundForce): it always fires when a move can sound. */
  force?: TurnaroundForce
  /** Layer compatible moves onto the lead and put a gap after a riser (spec
   * 2026-10-03-radio-turnaround-combos-design). Absent: one move, exactly as before, draw for
   * draw. On, a fired fresh roll draws ONE more number after all of today's, which seeds every
   * layering choice (turnaroundLayerRandom); a roll that does not fire draws nothing more. */
  combine?: boolean
  /** The build the change on this wrap earns (spec 2026-10-03-radio-anointed-stems-design 4.4,
   * radioBuildSize.ts). Absent: today, draw for draw. A phrase end only; a turn ignores it.
   *   - `none`, `small`: the riser at TURNAROUND_RISER_FACTOR's weight, at most 4 beats, no gap,
   *     at most two moves layered;
   *   - `medium`: the riser as today, at most 8 beats, no gap;
   *   - `large`: the phrase end fires at every rate but `off`, rolls fresh (the memory --
   *     diminution, never two in a row -- is skipped), the riser at twice its weight, the gap as
   *     today.
   * At `none` and `small` a diminution keeps at most two moves too.
   * Every tier only reweights, clamps or skips a draw of the layering's own random: none adds a
   * draw to `random`. */
  size?: RadioBuildSize
  /** The largest payoff the runtime can land on this wrap (radioBuildSize.ts radioPayoffOf, with
   * its spare rows). A gap promises a large one, so a gap is drawn only when this is `large`.
   * Absent: no limit (today). Applies to turns too. */
  payoff?: RadioPayoff
  /** The intensity arc's drop lands on this wrap (spec 2026-10-05-radio-intensity-arc-design 4.4,
   * 6). Absent: today, draw for draw. With it:
   *   - a phrase end rolled at `large`: the riser is the lead whenever its family is on and it
   *     fits -- no move draw, and the longest the planner allows (the cap: min(half the loop, 4
   *     bars)), no length draw;
   *   - the gap is drawn with `gapChance` instead of TURNAROUND_GAP_CHANCE (one draw either way),
   *     and needs only one row to silence (the rows coming back make the one);
   *   - a turn (the drop button) keeps its own move and length (`force`), and takes the gap
   *     chance. */
  drop?: { gapChance: number }
}

/** The drop's gap chance (spec 4.4): certain from drama 50, else today's. */
export function turnaroundDropGapChance(drama: number): number {
  return Number.isFinite(drama) && drama >= 50 ? 1 : TURNAROUND_GAP_CHANCE
}

/** The riser's weight factor in a phrase end's draw, and its longest, by build size (spec 4.4). */
export const TURNAROUND_RISER_FACTOR: Readonly<Record<RadioBuildSize, number>> = {
  none: 0.15,
  small: 0.15,
  medium: 1,
  large: 2
}
export const TURNAROUND_RISER_CAP_BEATS: Readonly<Record<RadioBuildSize, number>> = {
  none: 4,
  small: 4,
  medium: 8,
  large: Number.POSITIVE_INFINITY
}
/** The most moves a phrase end layers at `none` and `small`. */
export const TURNAROUND_SMALL_MAX_MOVES = 2

/** What a size does to a roll, worked out once. Absent size: all neutral (factor 1, no cap). */
interface Sizing {
  riserFactor: number
  riserCap: number
  maxMoves: number
  gap: boolean
}

function sizingOf(input: Pick<TurnaroundInput, 'size' | 'payoff' | 'force'>): Sizing {
  const size = input.force !== undefined ? undefined : input.size
  const gapPayoff = input.payoff === undefined || input.payoff === 'large'
  if (size === undefined) {
    return { riserFactor: 1, riserCap: Number.POSITIVE_INFINITY, maxMoves: 3, gap: gapPayoff }
  }
  return {
    riserFactor: TURNAROUND_RISER_FACTOR[size],
    riserCap: TURNAROUND_RISER_CAP_BEATS[size],
    maxMoves: size === 'none' || size === 'small' ? TURNAROUND_SMALL_MAX_MOVES : 3,
    gap: size === 'large' && gapPayoff
  }
}

/** A move's weight in a phrase end's draw: the arc's, the riser's scaled by the size. */
function moveWeight(arc: TurnaroundArc, m: TurnaroundMove, sizing: Sizing): number {
  const w = TURNAROUND_WEIGHTS[arc][m]
  return m === 'riser' && sizing.riserFactor !== 1 ? w * sizing.riserFactor : w
}

/** A turn: a turnaround on demand, at the next loop top
 * (docs/superpowers/specs/2026-10-02-radio-turn-button-design.md). It skips the rate, the
 * never-two-in-a-row rule and diminution; the guards and the cap still apply. */
export interface TurnaroundForce {
  /** A chip's move, drawn whatever `moves` and the arc say. Absent: the planner draws by the arc,
   * within `moves`, as a phrase end does. */
  move?: TurnaroundMove
  /** The beats left before the top (turnaroundTurnBeats): the move is never longer, nor shorter
   * than 1 beat. */
  maxBeats?: number
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
  /** Rows a hook leaves on at this wrap (TurnaroundRow.exiting). */
  exiting: TurnaroundRow[]
}

function bedOf(rows: readonly TurnaroundRow[], leavingRowId: string | null): Bed {
  const audible = rows.filter((r) => r.audible)
  const leaving = leavingRowId === null ? undefined : audible.find((r) => r.id === leavingRowId)
  // a hook leaving on this wrap throws its echo before it: never dropped, stopped or gapped
  const exiting = audible.filter((r) => r.exiting === true)
  const droppable = exiting.length === 0 ? audible : audible.filter((r) => r.exiting !== true)
  return {
    audible,
    drums: droppable.filter(isDrums),
    low: droppable.filter(isLow),
    keeper: turnaroundStopKeeper(audible),
    washed:
      leaving !== undefined
        ? [leaving]
        : exiting.length > 0
          ? exiting
          : audible.filter((r) => !isDrums(r)),
    filtered: audible.filter((r) => !isDrums(r) && !r.inFilterIn),
    exiting
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
      // something to stop besides the kept row and a hook leaving here (always, with none leaving)
      return (
        n >= 2 &&
        bed.keeper !== null &&
        bed.keeper.barLength * BEATS_PER_BAR >= 1 &&
        bed.audible.some((r) => r !== bed.keeper && r.exiting !== true)
      )
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

/** A move can sound and its shortest length fits the cap: the guards, with no randomness. */
function fits(move: TurnaroundMove, bed: Bed, capBeats: number): boolean {
  return SHORTEST_BEATS[move] <= capBeats && canSound(move, bed)
}

function drawOf(
  bed: Bed,
  arc: TurnaroundArc,
  capBeats: number,
  moves: readonly TurnaroundFamily[]
): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) => weights[m] > 0 && moves.includes(TURNAROUND_FAMILY_OF[m]) && fits(m, bed, capBeats)
  )
}

/** min(half the loop, 4 bars), and never longer than the depth allows. */
function capOf(input: Pick<TurnaroundInput, 'loopBars' | 'depth'>): number {
  const depth = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
  return Math.min(turnaroundCapBeats(input.loopBars), depth.maxBeats)
}

/** The moves a phrase end could draw right now, with no randomness: the guards, the cap, the
 * families switched on and the arc's weights. rollTurnaround draws from exactly this. */
export function turnaroundDraw(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'arc' | 'moves' | 'depth'>
): TurnaroundMove[] {
  const capBeats = capOf(input)
  if (!(capBeats > 0)) return []
  return drawOf(
    bedOf(input.rows, input.leavingRowId),
    input.arc,
    capBeats,
    input.moves ?? TURNAROUND_FAMILIES
  )
}

/** Whether a turn's chip could play `move` now: its guards and the cap, nothing else -- not the
 * arc, not the families switched on (a chip ignores them), no randomness. rollTurnaround with
 * `force.move` returns a plan exactly when this is true. */
export function turnaroundMoveCanSound(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'depth'>,
  move: TurnaroundMove
): boolean {
  const capBeats = capOf(input)
  return capBeats > 0 && fits(move, bedOf(input.rows, input.leavingRowId), capBeats)
}

/** The longest a turn pressed now may be, in whole beats: the beats left before the top less the
 * runtime's lead (the time a plan needs to reach the engine), rounded down so the move starts on
 * a beat. Null when that is under 1 beat: the turn waits for the following top. */
export function turnaroundTurnBeats(remainingBeats: number, leadBeats: number): number | null {
  if (!Number.isFinite(remainingBeats) || !Number.isFinite(leadBeats)) return null
  const left = Math.floor(remainingBeats - Math.max(0, leadBeats) + 1e-9)
  return left >= 1 ? left : null
}

/** Each move's chip, lowercase, at most two words. */
export const TURNAROUND_MOVE_LABEL: Readonly<Record<TurnaroundMove, string>> = {
  'drum drop': 'drop',
  'low drop': 'low drop',
  stop: 'stop',
  wash: 'wash',
  lift: 'lift',
  dip: 'dip',
  riser: 'riser'
}

function drawBeats(
  move: TurnaroundMove,
  bed: Bed,
  capBeats: number,
  random: () => number,
  riserCap: number = Number.POSITIVE_INFINITY
): number {
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
      return Math.min(pickEven(RISER_BARS, random) * BEATS_PER_BAR, capBeats, riserCap)
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
      const dropped =
        move === 'low drop'
          ? bed.low
          : bed.audible.filter((r) => r !== bed.keeper && r.exiting !== true)
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
 *   its guards pass. A `size` of `large` skips this rule and rolls fresh.
 * - Otherwise: the rate, then a move weighted by the arc among those that can sound and fit
 *   min(half the loop, 4 bars), then its length, then (a drum drop) its row.
 *
 * Guards are checked before any draw, so a phrase end that cannot have one costs no randomness.
 * Every move ends exactly on the one; only WHEN a phrase end gets one is rolled.
 * - The families switched off (`moves`) are never drawn; none switched on is off.
 * - `force` is a TURN (rollForced): it always fires when a move can sound.
 */
export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
  if (input.force !== undefined) return rollForced(input, input.force)
  const { random, loopBars, lastPhrase, arc } = input
  const moves = input.moves ?? TURNAROUND_FAMILIES
  const looks = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
  const rateChance = TURNAROUND_CHANCE[input.rate] ?? 0
  // a large change makes its phrase end fire, at every rate but `off`
  const chance = input.size === 'large' && rateChance > 0 ? 1 : rateChance
  const sizing = sizingOf(input)
  const capBeats = capOf(input)
  if (!(chance > 0) || !(capBeats > 0) || moves.length === 0) return null
  const bed = bedOf(input.rows, input.leavingRowId)
  // a large change rolls fresh: no diminution, and not the "never two in a row" rule (a riser,
  // stop, wash or dip last phrase would otherwise leave the biggest moment with nothing, or a
  // halved repeat with no riser and no gap). Only with a size passed: absent, today.
  if (lastPhrase !== null && input.size !== 'large') {
    if (lastPhrase.parts !== undefined && lastPhrase.parts.length > 1) {
      return diminishParts(input, lastPhrase, bed, capBeats, chance, looks, sizing)
    }
    const { move } = lastPhrase
    if (!DIMINISHING.includes(move) || lastPhrase.halvings >= TURNAROUND_MAX_HALVINGS) return null
    if (!moves.includes(TURNAROUND_FAMILY_OF[move])) return null
    const beats = Math.min(lastPhrase.beats / 2, capBeats)
    if (beats < 1 || !(TURNAROUND_WEIGHTS[arc][move] > 0) || !canSound(move, bed)) return null
    if (!(random() < chance)) return null
    return build(move, beats, lastPhrase.halvings + 1, bed, loopBars, random, looks)
  }
  const drawn = drawOf(bed, arc, capBeats, moves)
  // the drop's build: the riser leads, at its longest, with no draw for either (spec 4.4)
  const dropRiser =
    input.drop !== undefined &&
    input.size === 'large' &&
    moves.includes('riser') &&
    fits('riser', bed, capBeats)
  if (!dropRiser && drawn.length === 0) return null
  if (!(random() < chance)) return null
  const move: TurnaroundMove = dropRiser
    ? 'riser'
    : pickWeighted(
        drawn.map((m) => ({ item: m, weight: moveWeight(arc, m, sizing) })),
        random
      )
  const beats = dropRiser
    ? Math.min(capBeats, sizing.riserCap)
    : drawBeats(move, bed, capBeats, random, sizing.riserCap)
  const lead = build(move, beats, 0, bed, loopBars, random, looks)
  return lead !== null && input.combine === true
    ? layerTurnaround(lead, input, bed, capBeats, capBeats, looks, sizing)
    : lead
}

/** A turn's roll: no rate, no memory (a fresh move, `halvings` 0), the guards and the cap as
 * ever. A chip's move is drawn whatever the arc and the families say; the planner's choice draws
 * by the arc within the families. The draws, in order: which move (the planner's choice only),
 * how long, which drums row (a drum drop). */
function rollForced(input: TurnaroundInput, force: TurnaroundForce): TurnaroundPlan | null {
  const { random, loopBars, arc } = input
  const looks = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
  const capBeats = capOf(input)
  if (!(capBeats > 0)) return null
  const bed = bedOf(input.rows, input.leavingRowId)
  let move: TurnaroundMove
  if (force.move !== undefined) {
    if (!fits(force.move, bed, capBeats)) return null
    move = force.move
  } else {
    const drawn = drawOf(bed, arc, capBeats, input.moves ?? TURNAROUND_FAMILIES)
    if (drawn.length === 0) return null
    move = pickWeighted(
      drawn.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
      random
    )
  }
  const most =
    force.maxBeats !== undefined && Number.isFinite(force.maxBeats)
      ? Math.max(1, force.maxBeats)
      : capBeats
  const beats = Math.min(drawBeats(move, bed, capBeats, random), most)
  const lead = build(move, beats, 0, bed, loopBars, random, looks)
  return lead !== null && input.combine === true
    ? layerTurnaround(lead, input, bed, capBeats, most, looks, sizingOf(input))
    : lead
}

/** What to remember of a phrase end for the next one. */
export function rememberTurnaround(plan: TurnaroundPlan | null): TurnaroundMemory | null {
  if (plan === null) return null
  const memory: TurnaroundMemory = { move: plan.move, beats: plan.beats, halvings: plan.halvings }
  if (plan.parts !== undefined && plan.parts.length > 1) {
    memory.parts = plan.parts.map((p) => ({ move: p.move, beats: p.beats }))
  }
  return memory
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

// ---- living with layer changes and other gestures (spec section 3) ----

/** A curve's value just BEFORE `bar` (its left limit): where a stacked pair steps, the earlier
 * value. evaluateAutomation is the right limit (the later value), as the engine reads it. */
function valueBefore(points: readonly AutomationPoint[], bar: number): number {
  if (bar <= points[0].bar) return points[0].value
  for (let i = 1; i < points.length; i++) {
    const b = points[i]
    if (b.bar < bar) continue
    const a = points[i - 1]
    return a.value + (b.value - a.value) * ((bar - a.bar) / (b.bar - a.bar))
  }
  return points[points.length - 1].value
}

/**
 * Two curves on one stem's lane, as one (clip-relative bars, normalised and ascending, as
 * every builder here and in radioTransition.ts returns them):
 *   - `volume` MULTIPLIES, so a turnaround's drop never cancels a hole, a duck or the arc's
 *     exit -- it stacks on them;
 *   - `reverbSend` takes the larger value at each point;
 *   - `filterCutoff` keeps `a`, the curve already there: a row in a change's filter in is
 *     skipped by filter moves (one filter, one mode, one lap).
 * An empty side is no curve. Evaluated at every breakpoint of either, keeping both sides of any
 * step, so between breakpoints it is linear like both inputs (a product of two ramps is not,
 * exactly; the drops and ducks it meets are steps and single ramps). Inputs untouched.
 */
export function combineRadioCurves(
  a: readonly AutomationPoint[],
  b: readonly AutomationPoint[],
  lane: AutomationParam
): AutomationPoint[] {
  if (a.length === 0) return b.map((p) => ({ ...p }))
  if (b.length === 0 || lane === 'filterCutoff') return a.map((p) => ({ ...p }))
  const join = lane === 'volume' ? (x: number, y: number): number => x * y : Math.max
  const bars = [...new Set([...a, ...b].map((p) => p.bar))].sort((x, y) => x - y)
  const out: AutomationPoint[] = []
  for (const bar of bars) {
    const before = join(valueBefore(a, bar), valueBefore(b, bar))
    const after = join(evaluateAutomation([...a], bar, 1), evaluateAutomation([...b], bar, 1))
    out.push({ bar, value: before })
    if (after !== before) out.push({ bar, value: after })
  }
  return out
}

/** A change landing on the wrap a turnaround ends on keeps only its arrival (filter in, bloom,
 * duck, or a cut): the turnaround is its lead-in, so a hole or a riser becomes a cut. */
export function radioTransitionUnderTurnaround(kind: RadioTransitionKind): RadioTransitionKind {
  return radioGestureLeadsChange(kind) ? 'cut' : kind
}

/** What a change decided now may draw, against the phrase turnaround (sssketch's Discover, where
 * the roll runs after the wrap tick that starts a phrase's last lap -- after that wrap's landings,
 * and later still while it waits for a landed stem's length):
 *   - 'wait': that roll is still to come. Decide on a later tick: a hole or a riser drawn now
 *     would arm first, and the roll keeps a lead-in already armed, so the turnaround would
 *     never play on the wrap the two most often share;
 *   - 'arrival': a turnaround is armed for the lap, so the change keeps only its arrival
 *     (radioTransitionUnderTurnaround);
 *   - 'any': no turnaround. */
export type RadioTurnaroundGate = 'wait' | 'arrival' | 'any'
export function radioTurnaroundGate(rollPending: boolean, armed: boolean): RadioTurnaroundGate {
  if (rollPending) return 'wait'
  return armed ? 'arrival' : 'any'
}

// ---- the controls (spec section 4a) ----

/** The four families a listener switches: drops (drum drop, low drop, stop), wash, filters
 * (lift, dip) and the riser. */
export type TurnaroundFamily = 'drops' | 'wash' | 'filters' | 'riser'

export const TURNAROUND_FAMILIES: readonly TurnaroundFamily[] = [
  'drops',
  'wash',
  'filters',
  'riser'
]

export const TURNAROUND_FAMILY_OF: Readonly<Record<TurnaroundMove, TurnaroundFamily>> = {
  'drum drop': 'drops',
  'low drop': 'drops',
  stop: 'drops',
  wash: 'wash',
  lift: 'filters',
  dip: 'filters',
  riser: 'riser'
}

/** The families switched on, in canonical order: an unknown entry is dropped, a non-array (a
 * fresh setting) is all of them. An empty list stays empty -- none enabled behaves as off. */
export function normalizeTurnaroundMoves(value: unknown): TurnaroundFamily[] {
  if (!Array.isArray(value)) return [...TURNAROUND_FAMILIES]
  return TURNAROUND_FAMILIES.filter((f) => value.includes(f))
}

/** One family switched, the rest kept, in canonical order. */
export function toggleTurnaroundFamily(
  moves: readonly TurnaroundFamily[],
  family: TurnaroundFamily
): TurnaroundFamily[] {
  const on = moves.includes(family)
  return TURNAROUND_FAMILIES.filter((f) => (f === family ? !on : moves.includes(f)))
}

export type TurnaroundDepth = 'subtle' | 'bold'

export const TURNAROUND_DEPTH_OPTIONS: TurnaroundDepth[] = ['subtle', 'bold']

/** `bold` on both radios: it is the spec's own numbers. */
export const DEFAULT_TURNAROUND_DEPTH: TurnaroundDepth = 'bold'

export function normalizeTurnaroundDepth(value: unknown): TurnaroundDepth {
  return value === 'subtle' || value === 'bold' ? value : DEFAULT_TURNAROUND_DEPTH
}

export interface TurnaroundDepthValues {
  liftTop: number
  dipFloor: number
  washPeak: number
  /** The longest move, in beats (the loop's own cap still applies under it). */
  maxBeats: number
}

/** What each depth does to the filter and wash moves, and how long any move may be. */
export const TURNAROUND_DEPTH: Readonly<Record<TurnaroundDepth, TurnaroundDepthValues>> = {
  bold: {
    liftTop: TURNAROUND_LIFT_TOP,
    dipFloor: TURNAROUND_DIP_FLOOR,
    washPeak: TURNAROUND_WASH_PEAK,
    maxBeats: TURNAROUND_MAX_BARS * BEATS_PER_BAR
  },
  subtle: { liftTop: 0.35, dipFloor: 0.6, washPeak: 0.6, maxBeats: BEATS_PER_BAR }
}

// ---- combined turnarounds and the gap (spec 2026-10-03-radio-turnaround-combos-design) ----
//
// A real turnaround is usually two or three moves at once -- a riser over a high-pass lift with
// the kick and bass pulled, a wash on a dipping mix -- and a riser usually stops short of the
// one: the bed drops out for a beat or two while the riser's tail and the room ring, and
// everything comes back on the one. With `combine` on, the lead is drawn exactly as before, then
// compatible moves are layered on and a riser may leave a gap. Every part still ends on the one.

/** How well two moves sit together, symmetric: 0 never (they fight over one parameter, or one
 * contains the other), 1 works, 2 a classic pairing (spec section 1). */
export const TURNAROUND_AFFINITY: Readonly<
  Record<TurnaroundMove, Readonly<Record<TurnaroundMove, number>>>
> = {
  'drum drop': { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 1, lift: 1, dip: 1, riser: 1 },
  'low drop': { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 1, lift: 2, dip: 1, riser: 2 },
  stop: { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 2, lift: 1, dip: 1, riser: 0 },
  wash: { 'drum drop': 1, 'low drop': 1, stop: 2, wash: 0, lift: 2, dip: 2, riser: 2 },
  lift: { 'drum drop': 1, 'low drop': 2, stop: 1, wash: 2, lift: 0, dip: 0, riser: 2 },
  dip: { 'drum drop': 1, 'low drop': 1, stop: 1, wash: 2, lift: 0, dip: 0, riser: 1 },
  riser: { 'drum drop': 1, 'low drop': 2, stop: 0, wash: 2, lift: 2, dip: 1, riser: 0 }
}

/** How many moves a combined turnaround wants (1, 2, 3), by depth: subtle is mostly one, bold
 * mostly two. The realised count is lower when nothing compatible can sound. */
export const TURNAROUND_LAYER_ODDS: Readonly<Record<TurnaroundDepth, readonly number[]>> = {
  subtle: [0.75, 0.25, 0],
  bold: [0.3, 0.5, 0.2]
}

/** Chance a riser stops short of the one, leaving a gap (Elling: "usually there is a drop out
 * after a riser... sometimes the riser works without it"). */
export const TURNAROUND_GAP_CHANCE = 0.75

/** Chance one melodic row keeps playing through the gap (the stop's rest measure), when one can. */
export const TURNAROUND_GAP_KEEP_CHANCE = 1 / 3

export const TURNAROUND_GAP_WORD = 'gap'

/** The gap after a riser spanning `riserBeats` (its sounding length plus the gap): one beat at
 * subtle and under a 2-bar riser, half a bar (2 beats) at bold from a 2-bar riser up; 0 when the
 * riser spans under a bar (too short to stop early). */
export function turnaroundGapBeats(riserBeats: number, depth: TurnaroundDepth): number {
  if (!(riserBeats >= BEATS_PER_BAR)) return 0
  return depth === 'bold' && riserBeats >= 2 * BEATS_PER_BAR ? 2 : 1
}

/** The layering's own random, seeded from ONE draw of the caller's: every layering choice comes
 * from it, so the caller's stream moves on by exactly one number per combined roll. */
export function turnaroundLayerRandom(draw: number): () => number {
  return seededRandom(`turnaround-layers:${Math.floor(draw * 4294967296)}`)
}

/** Each drop's lengths (beats), for lengthening one past a gap: it must be heard before it. */
const DROP_MENU: Partial<Record<TurnaroundMove, readonly number[]>> = {
  'drum drop': DROP_OUT_BEAT_WEIGHTS.map((o) => o.beats),
  'low drop': LOW_DROP_BEATS
}

/** A filter or wash curve whose peak lands `hold` beats before the wrap (where the gap, or the
 * row's drop, starts) and holds from there to the one. */
function holdFrom(points: TurnaroundPoint[], hold: number): TurnaroundPoint[] {
  if (!(hold > 0) || points.length < 3) return points
  const peak = points[points.length - 2]
  return [...points.slice(0, -2), { beats: hold, value: peak.value }, ...points.slice(-2)]
}

/** Where each row goes silent, in beats before the wrap: its longest drop, the gap included. */
function silenceStarts(
  parts: readonly TurnaroundPart[],
  gap: number,
  gapRows: readonly string[]
): Map<string, number> {
  const out = new Map<string, number>()
  const silence = (id: string, beats: number): void => {
    out.set(id, Math.max(out.get(id) ?? 0, beats))
  }
  for (const p of parts) {
    if (p.move === 'drum drop' || p.move === 'low drop' || p.move === 'stop') {
      for (const id of p.rowIds) silence(id, p.beats)
    }
  }
  if (gap > 0) for (const id of gapRows) silence(id, gap)
  return out
}

/** A wash on a row that goes silent before the one: the send is post-fader, so a throw still
 * rising when the row drops out is lost. Its rise must end where the row's silence starts and its
 * peak hold from there (materialize). A row silent for the whole wash needs it to start earlier:
 * the wash then rises over its own length before the latest such silence, within `limit`; a row
 * still silent from where the wash starts is left out of it. Returns the parts with the wash
 * adjusted (removed when no row is left), or null when the lead is a wash with no row left. */
function throwWashes(
  parts: readonly TurnaroundPart[],
  gap: number,
  gapRows: readonly string[],
  limit: number
): TurnaroundPart[] | null {
  const i = parts.findIndex((p) => p.move === 'wash')
  if (i < 0) return [...parts]
  const wash = parts[i]
  const silent = silenceStarts(parts, gap, gapRows)
  const holdOf = (id: string): number => silent.get(id) ?? 0
  // only rows the wash can keep: one silent from `limit` on is left out, and must not stretch it
  const latest = Math.max(0, ...wash.rowIds.map(holdOf).filter((h) => h >= wash.beats && h < limit))
  const beats = latest > 0 ? Math.max(wash.beats, Math.min(latest + wash.beats, limit)) : wash.beats
  const rowIds = wash.rowIds.filter((id) => holdOf(id) < beats)
  const out = [...parts]
  if (rowIds.length > 0) out[i] = { move: 'wash', beats, rowIds }
  else if (i === 0) return null
  else out.splice(i, 1)
  return out
}

/** The rows' curves for a set of parts and a gap: one entry per row, in the order rows are
 * first touched. Every drop a row gets is the same shape, so its volume is the longest one. */
function materialize(
  parts: readonly TurnaroundPart[],
  gap: number,
  gapRows: readonly string[],
  loopBars: number,
  looks: TurnaroundLooks
): TurnaroundRowCurves[] | null {
  const drops = silenceStarts(parts, gap, gapRows)
  const out = new Map<string, TurnaroundRowCurves>()
  const at = (id: string): TurnaroundRowCurves => {
    let r = out.get(id)
    if (r === undefined) out.set(id, (r = { rowId: id }))
    return r
  }
  // rows in the order they are first touched: the parts', then the gap's
  for (const p of parts) for (const id of p.rowIds) at(id)
  if (gap > 0) for (const id of gapRows) at(id)
  for (const p of parts) {
    for (const id of p.rowIds) {
      switch (p.move) {
        case 'lift': {
          const f = turnaroundLiftCurve(p.beats, looks.liftTop)
          at(id).filter = { ...f, cutoff: holdFrom(f.cutoff, gap) }
          break
        }
        case 'dip': {
          const f = turnaroundDipCurve(p.beats, looks.dipFloor)
          at(id).filter = { ...f, cutoff: holdFrom(f.cutoff, gap) }
          break
        }
        case 'wash': {
          // the send is post-fader: peak where the row goes silent (throwWashes saw it rises first)
          const w = turnaroundWashCurve(p.beats, looks.washPeak)
          const hold = Math.max(gap, drops.get(id) ?? 0)
          at(id).reverbSend = { ...w, points: holdFrom(w.points, hold) }
          break
        }
        default:
          break
      }
    }
  }
  for (const [id, beats] of drops) {
    const volume = turnaroundDropCurve(loopBars, beats)
    if (volume.length === 0) return null
    at(id).volume = volume
  }
  return [...out.values()]
}

/** The lead, layered (spec section 1-2): one draw from the caller, then from the layering's own
 * random: how many moves; each added move by the arc's weight times its affinity with every
 * move already in, among those that can sound, fit and whose family is on; its length (never
 * past `most`) and rows; then, with a riser in, whether it leaves a gap and whether a melodic row
 * keeps playing through it. Drops are lengthened past the gap (or the gap is dropped). */
function layerTurnaround(
  lead: TurnaroundPlan,
  input: TurnaroundInput,
  bed: Bed,
  capBeats: number,
  most: number,
  looks: TurnaroundLooks,
  sizing: Sizing
): TurnaroundPlan | null {
  const sub = turnaroundLayerRandom(input.random())
  const depth = input.depth ?? DEFAULT_TURNAROUND_DEPTH
  const families = input.moves ?? TURNAROUND_FAMILIES
  const weights = TURNAROUND_WEIGHTS[input.arc]
  // at `none` and `small`, at most two moves: the odds truncated, renormalised by the draw
  const odds = TURNAROUND_LAYER_ODDS[depth].slice(0, sizing.maxMoves)
  const count = pickWeighted(
    odds.map((weight, i) => ({ item: i + 1, weight })),
    sub
  )
  const parts: TurnaroundPart[] = [
    { move: lead.move, beats: lead.beats, rowIds: lead.rows.map((r) => r.rowId) }
  ]
  while (parts.length < count) {
    const options = TURNAROUND_MOVES.filter(
      (m) =>
        !parts.some((p) => p.move === m) &&
        families.includes(TURNAROUND_FAMILY_OF[m]) &&
        fits(m, bed, capBeats)
    )
      .map((m) => ({
        item: m,
        weight: parts.reduce(
          (w, p) => w * TURNAROUND_AFFINITY[p.move][m],
          m === 'riser' ? weights[m] * sizing.riserFactor : weights[m]
        )
      }))
      .filter((o) => o.weight > 0)
    if (options.length === 0) break
    const move = pickWeighted(options, sub)
    const beats = Math.min(drawBeats(move, bed, capBeats, sub, sizing.riserCap), most)
    const one = build(move, beats, 0, bed, input.loopBars, sub, looks)
    if (one === null) break
    parts.push({ move, beats, rowIds: one.rows.map((r) => r.rowId) })
  }
  // the gap: a riser spanning a bar or more, with a bed of two or more to drop out
  let gap = 0
  let keeper: TurnaroundRow | null = null
  const riser = parts.find((p) => p.move === 'riser')
  // the drop's gap needs only one row to silence: the rows coming back make the one
  const gapBed = input.drop !== undefined ? 1 : 2
  if (riser !== undefined && riser.beats >= BEATS_PER_BAR && bed.audible.length >= gapBed) {
    // a gap only where the size allows one and a large payoff can follow it (no draw otherwise)
    if (sizing.gap && sub() < (input.drop?.gapChance ?? TURNAROUND_GAP_CHANCE)) {
      gap = turnaroundGapBeats(riser.beats, depth)
      // a drop no longer than the gap would be swallowed by it: the next length past it, or no gap
      const longer = parts.map((p) => {
        const menu = DROP_MENU[p.move]
        if (menu === undefined || p.beats > gap) return p.beats
        return menu.find((b) => b > gap && b <= Math.min(capBeats, most)) ?? null
      })
      if (longer.some((b) => b === null)) gap = 0
      else {
        for (let i = 0; i < parts.length; i++) parts[i].beats = longer[i] as number
      }
    }
    const kept = bed.keeper
    if (gap > 0 && kept !== null && kept.barLength * BEATS_PER_BAR >= gap) {
      if (sub() < TURNAROUND_GAP_KEEP_CHANCE) keeper = kept
    }
  }
  // a hook leaving on this wrap throws into the gap: its row is never one the gap silences
  const gapRows = bed.audible.filter((r) => r !== keeper && r.exiting !== true).map((r) => r.id)
  const thrown = throwWashes(parts, gap, gapRows, Math.min(capBeats, most))
  // the lead alone, as a combined plan, when layering can't stand: a lead wash whose every row
  // is silent from where it starts, or (never in practice: every part fits the cap, which fits the
  // loop) a drop curve that can't be placed
  const alone = (): TurnaroundPlan => ({
    ...lead,
    parts: [{ move: lead.move, beats: lead.beats, rowIds: lead.rows.map((r) => r.rowId) }],
    gapBeats: 0
  })
  if (thrown === null) return alone()
  const rows = materialize(thrown, gap, gapRows, input.loopBars, looks)
  if (rows === null) return alone()
  const plan: TurnaroundPlan = {
    move: lead.move,
    beats: Math.max(...thrown.map((p) => p.beats)),
    halvings: 0,
    rows,
    parts: thrown,
    gapBeats: gap
  }
  if (riser !== undefined) plan.riserBars = (riser.beats - gap) / BEATS_PER_BAR
  if (keeper !== null) plan.keeperId = keeper.id
  return plan
}

/** A diminution of a combined phrase end: the moves in it that can diminish (drum drop, low drop,
 * lift; the first two at a `none` or `small` size), together, each at half its length -- while the families, the arc and the guards still
 * let it, never under a beat -- at the same rate, with no layering and no gap. The rate is today's
 * one draw; then each part's rows (a drum drop's row), in order. */
function diminishParts(
  input: TurnaroundInput,
  last: TurnaroundMemory,
  bed: Bed,
  capBeats: number,
  chance: number,
  looks: TurnaroundLooks,
  sizing: Sizing
): TurnaroundPlan | null {
  if (last.halvings >= TURNAROUND_MAX_HALVINGS) return null
  const families = input.moves ?? TURNAROUND_FAMILIES
  const keep = (last.parts ?? [])
    .filter(
      (p) =>
        DIMINISHING.includes(p.move) &&
        families.includes(TURNAROUND_FAMILY_OF[p.move]) &&
        TURNAROUND_WEIGHTS[input.arc][p.move] > 0 &&
        canSound(p.move, bed)
    )
    .map((p) => ({ move: p.move, beats: Math.min(p.beats / 2, capBeats) }))
    .filter((p) => p.beats >= 1)
    // at `none` and `small`, at most two moves (no draw: the memory's own order)
    .slice(0, sizing.maxMoves)
  if (keep.length === 0) return null
  if (!(input.random() < chance)) return null
  const parts: TurnaroundPart[] = []
  for (const p of keep) {
    const one = build(p.move, p.beats, 0, bed, input.loopBars, input.random, looks)
    if (one === null) return null
    parts.push({ move: p.move, beats: p.beats, rowIds: one.rows.map((r) => r.rowId) })
  }
  const rows = materialize(parts, 0, [], input.loopBars, looks)
  if (rows === null) return null
  return {
    move: parts[0].move,
    beats: Math.max(...parts.map((p) => p.beats)),
    halvings: last.halvings + 1,
    rows,
    parts,
    gapBeats: 0
  }
}

// ---- saying it (the ruler, the flashes) ----

/** The longest a turnaround's label may be before it is shortened to its lead and a count. */
export const TURNAROUND_LABEL_MAX = 20

/** A turnaround in words, the lead first: `riser + lift → gap`, `wash + dip`, `drop`. Longer than
 * `max`: the lead and how many more, `riser +2 → gap`. */
export function turnaroundLabel(
  moves: readonly TurnaroundMove[],
  gap: boolean,
  max: number = TURNAROUND_LABEL_MAX
): string {
  if (moves.length === 0) return ''
  const tail = gap ? ` → ${TURNAROUND_GAP_WORD}` : ''
  const full = moves.map((m) => TURNAROUND_MOVE_LABEL[m]).join(' + ') + tail
  if (full.length <= max || moves.length === 1) return full
  return `${TURNAROUND_MOVE_LABEL[moves[0]]} +${moves.length - 1}${tail}`
}

/** A plan's moves, the lead first (a single move's plan is just its move). */
export function turnaroundPlanMoves(
  plan: Pick<TurnaroundPlan, 'move' | 'parts'>
): TurnaroundMove[] {
  return plan.parts !== undefined && plan.parts.length > 0
    ? plan.parts.map((p) => p.move)
    : [plan.move]
}

/** A word on a row, from `beats` before the wrap (when the move hitting it starts). */
export interface TurnaroundFlash {
  rowId: string
  word: string
  beats: number
}

/** The live rows a gapped plan never saw -- a row that joined, or resolved, after its roll -- which
 * the runtime silences through the gap with the same drop curve (`turnaroundDropCurve` of
 * `gapBeats`), so nothing but the keeper plays through it. Never the keeper, even when the plan
 * does not list it. None without a gap. A row already in the plan keeps its own curves. */
export function turnaroundGapLateRowIds(
  plan:
    | (Pick<TurnaroundPlan, 'gapBeats' | 'keeperId'> & {
        rows: readonly { rowId: string }[]
      })
    | null
    | undefined,
  liveRowIds: Iterable<string>
): string[] {
  if (!plan || !((plan.gapBeats ?? 0) > 0)) return []
  const planned = new Set(plan.rows.map((r) => r.rowId))
  const out: string[] = []
  for (const id of liveRowIds) {
    if (!planned.has(id) && id !== plan.keeperId && !out.includes(id)) out.push(id)
  }
  return out
}

/** Every word a plan flashes: each row its moves' words from where each starts, and `gap` on the
 * rows that drop out, from where the gap starts. A plan with no parts (one move, `combine` off):
 * every row its move's word from the plan's start, as before. The riser is its own voice: no row. */
export function turnaroundFlashes(plan: TurnaroundPlan): TurnaroundFlash[] {
  if (plan.parts === undefined) {
    const word = TURNAROUND_MOVE_LABEL[plan.move]
    return plan.rows.map((r) => ({ rowId: r.rowId, word, beats: plan.beats }))
  }
  const out: TurnaroundFlash[] = []
  for (const p of plan.parts) {
    for (const rowId of p.rowIds)
      out.push({ rowId, word: TURNAROUND_MOVE_LABEL[p.move], beats: p.beats })
  }
  const gap = plan.gapBeats ?? 0
  if (gap > 0) {
    for (const r of plan.rows) {
      if (r.rowId !== plan.keeperId && r.volume !== undefined) {
        out.push({ rowId: r.rowId, word: TURNAROUND_GAP_WORD, beats: gap })
      }
    }
  }
  return out
}
