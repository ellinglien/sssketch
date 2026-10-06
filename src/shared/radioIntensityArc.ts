// src/shared/radioIntensityArc.ts
//
// THE INTENSITY ARC: build, breakdown, drop (docs/superpowers/specs/2026-10-05-radio-intensity-
// arc-design.md sections 3-6). While radio runs with density `intensity`, the bed moves through
// cycles: a BUILD over 2-4 phrases (the picks for drums and bass lean busier and heavier, rows are
// added one per phrase start), a BREAKDOWN on the one for 1-2 phrases (drums thin or drop, the
// bass leaves, pads and leads carry it), then THE DROP: drums and bass back with the full riser and
// gap, and a ride at the top. Every few cycles a bigger peak: higher, longer, a deeper breakdown.
//
// Two dials: `energy` moves where the time goes (gentle with long breakdowns to driving with long
// rides), `drama` how far the targets and rows swing (a subtle swell to the full breakdown).
//
// The machine is pure and seeded: the runtime steps it at every loop top (after the lap
// bookkeeping, before hooks, the fold step and the turnaround roll: section 3.1) and does what it
// says -- removes a row (the strip-back), adds one, rests rows, brings them back. Like hooks, an
// event is DECIDED at the wrap starting a phrase's last lap (binding) and lands on the phrase start
// after it; what needs warming is PREPARED a phrase ahead.
//
// THE CLOCK is the turnaround phrase (16 bars at every pace): `lap` is the clock's turnaroundLap
// starting at this wrap, `phraseLaps` turnaroundPhraseLaps. A phrase start is a wrap with lap 0;
// the decide wrap has lap phraseLaps - 1 (with a one-lap phrase every wrap is both, and an event
// is prepared two wraps ahead). Held: the clock stops and nothing is decided; a decided event
// still lands.
//
// DRAWS (section 3.5), from the caller's one random, in this order and nowhere else. A phase's
// length is drawn when the phase is DECIDED (so a one-lap phrase can prepare two wraps ahead):
//   1. radio's start (radioIntensityStarted): the first cycle's countdown, then its build's length;
//   2. a cycle's decide wrap: the bigger-peak countdown when it is due (it reaches 0), then the
//      build's length;
//   3. the breakdown's decide wrap: the echo throw's three (beats, timing, feedback) when a drums
//      row rests -- the hook exit's own draws (radioThrows' drawThrowBeats, drawThrowEcho) --
//      then the breakdown's length;
//   4. the drop's decide wrap: one renewal draw per returning drums or bass row whose fresh pick
//      is warm, in row order, then the ride's length.
// A one-value length menu draws nothing. A button's event is decided without a draw; its phase's
// length (and a cycle's countdown) is drawn where it lands.

import type { DiscoverSlotKind } from './discoverSlotKind'
import type { RadioHookThrow } from './radioHooks'
import { drawThrowBeats, drawThrowEcho } from './radioThrows'
import type { TurnaroundArc } from './radioTurnaround'

export type RadioIntensityPhase = 'build' | 'breakdown' | 'drop'
export type RadioBreakdownDepth = 'swell' | 'thin' | 'full'
export type RadioIntensityAction = 'build' | 'drop'

/** The phase an event begins, worked out (and drawn) when it is decided. Absent on a button's
 * event: drawn where it lands. */
export interface RadioIntensityNext {
  phrases: number
  /** A cycle's: this cycle is a bigger peak, the countdown after it, its build's peak. */
  big?: boolean
  untilBig?: number | null
  peakRows?: number
}

/** An event decided at a decide wrap (or by a button), landing at the NEXT wrap: binding. */
export type RadioIntensityDecided =
  | {
      /** A new cycle's build begins: `strip` -- one row leaves first (pickArcRemoval). */
      event: 'cycle'
      strip: boolean
      next?: RadioIntensityNext
      forced?: true
    }
  | { event: 'add'; forced?: true }
  | {
      event: 'breakdown'
      depth: RadioBreakdownDepth
      /** Rows that go silent on the one (rested, not removed), in row order. */
      rest: string[]
      /** The one drums row that leaves with an echo throw ending on the one, and its shape. */
      throwRowId: string | null
      throw: RadioHookThrow | null
      /** The prepared carry row joins on the one (no carrier would sound otherwise). */
      carry: boolean
      next?: RadioIntensityNext
    }
  | {
      event: 'drop'
      /** Rows the breakdown rested, back on the one. */
      returning: string[]
      /** The returning (or, at swell depth, playing) drums and bass rows that come back on their
       * fresh, heavier pick instead of their own stem. */
      renew: string[]
      /** A button's quick drop (pressed while building or riding): the planner's low drop in the
       * lap before, no rests, no renewals, then a fresh ride. */
      quick?: true
      next?: RadioIntensityNext
      forced?: true
    }

export interface RadioIntensityArc {
  /** False until the first phrase start the machine sees (a switch from `arc` mid-run waits for
   * one); radioIntensityStarted begins it at radio's own start. */
  begun: boolean
  phase: RadioIntensityPhase
  /** The phase's length in phrases, drawn at its start. */
  phrases: number
  /** Phrase starts passed in this phase. */
  done: number
  /** This cycle is a bigger peak. */
  big: boolean
  /** Cycles until the next bigger peak; null before the first cycle. */
  untilBig: number | null
  /** The row count this cycle's build heads for. */
  peakRows: number
  /** The first build after radio starts: it grows from DENSITY_MIN and strips nothing. */
  first: boolean
  /** The breakdown's depth (decided at its decide wrap), null outside one. */
  depth: RadioBreakdownDepth | null
  /** Rows the breakdown rested. */
  rests: string[]
  /** A button's press waiting for a top whose wrap is free. */
  forced: RadioIntensityAction | null
  /** The event landing at the next wrap, or null. */
  decided: RadioIntensityDecided | null
  /** The phase whose ending the runtime was asked to prepare for (once per change), null since
   * the last phase change. A phase, not a flag: with a one-lap phrase the build's prepare and the
   * coming breakdown's fall on consecutive wraps of the same build (review, 2026-10-05). */
  prepared: RadioIntensityPhase | null
}

export const NO_RADIO_INTENSITY_ARC: RadioIntensityArc = Object.freeze({
  begun: false,
  phase: 'build',
  phrases: 0,
  done: 0,
  big: false,
  untilBig: null,
  peakRows: 0,
  first: true,
  depth: null,
  rests: Object.freeze([]) as unknown as string[],
  forced: null,
  decided: null,
  prepared: null
}) as RadioIntensityArc

// ---- the numbers (section 3; every one [INF], to tune by ear) ----

/** Cycles between bigger peaks, drawn evenly. */
export const INTENSITY_UNTIL_BIG: readonly number[] = [3, 4]
/** A bigger peak's lift on the top target. */
export const INTENSITY_BIG_LIFT = 0.15
/** Energy thresholds for the length menus (e < LOW; e <= HIGH; above). */
export const INTENSITY_ENERGY_LOW = 0.34
export const INTENSITY_ENERGY_HIGH = 0.66
/** Drama thresholds for the breakdown's depth: under SWELL, swell; under FULL, thin; else full. */
export const INTENSITY_DRAMA_THIN = 25
export const INTENSITY_DRAMA_FULL = 60
/** A renewal's chance is BASE + SPAN * drama / 100 (Elling, 2026-10-05: as proposed). */
export const INTENSITY_RENEW_BASE = 0.25
export const INTENSITY_RENEW_SPAN = 0.5
/** A breakdown ends after `phrases` + this many phrase starts in any case. */
export const INTENSITY_BREAKDOWN_OVERRUN = 1
/** The fold bend's swing at full drama: bend + SWING * d * (2 tau - 1). */
export const INTENSITY_BEND_SWING = 25

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const pickEven = <T>(items: readonly T[], random: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))]
/** A length menu draws only when it has a choice. */
const drawLength = (menu: readonly number[], random: () => number): number =>
  menu.length === 1 ? menu[0] : pickEven(menu, random)

type Band = 'low' | 'mid' | 'high'
function energyBand(energy: number): Band {
  const e = clamp01(energy / 100)
  return e < INTENSITY_ENERGY_LOW ? 'low' : e <= INTENSITY_ENERGY_HIGH ? 'mid' : 'high'
}

/** Each phase's length menu, in phrases, by energy (section 3.2; before a big cycle's +1). */
export const INTENSITY_PHRASES: Readonly<
  Record<RadioIntensityPhase, Record<Band, readonly number[]>>
> = {
  build: { low: [3, 4], mid: [2, 3, 4], high: [2, 3] },
  breakdown: { low: [2], mid: [1, 2], high: [1] },
  drop: { low: [1], mid: [1, 2], high: [2, 3] }
}

/** The targets (section 3.2): mid = 0.35 + 0.30 e, swing = 0.15 + 0.35 d; hi = min(1, mid +
 * swing) (+0.15 on a big cycle), lo = max(0, mid - swing). */
export function radioIntensityTargets(
  energy: number,
  drama: number,
  big: boolean
): { lo: number; hi: number } {
  const e = clamp01(energy / 100)
  const d = clamp01(drama / 100)
  const mid = 0.35 + 0.3 * e
  const swing = 0.15 + 0.35 * d
  const hi = Math.min(1, mid + swing)
  return { lo: Math.max(0, mid - swing), hi: big ? Math.min(1, hi + INTENSITY_BIG_LIFT) : hi }
}

/** The target for picks now: rising by phrase through the build (phrase k of n: lo + (hi - lo)
 * (k + 1) / n), lo in the breakdown, hi in the drop. Before the machine has begun: lo. */
export function radioIntensityTarget(
  arc: RadioIntensityArc,
  energy: number,
  drama: number
): number {
  const { lo, hi } = radioIntensityTargets(energy, drama, arc.big)
  if (!arc.begun) return lo
  switch (arc.phase) {
    case 'build': {
      const n = Math.max(1, arc.phrases)
      // never past hi (so never past 1): the last phrase's sum can round an ulp over
      return Math.min(hi, lo + ((hi - lo) * (Math.min(arc.done, n - 1) + 1)) / n)
    }
    case 'breakdown':
      return lo
    case 'drop':
      return hi
  }
}

/** The breakdown's depth from drama, a big cycle one level deeper (`full` stays `full`). */
export function radioBreakdownDepth(drama: number, big: boolean): RadioBreakdownDepth {
  const base: RadioBreakdownDepth =
    drama < INTENSITY_DRAMA_THIN ? 'swell' : drama < INTENSITY_DRAMA_FULL ? 'thin' : 'full'
  if (!big) return base
  return base === 'swell' ? 'thin' : 'full'
}

/** A bigger peak's countdown, drawn. */
function drawUntilBig(random: () => number): number {
  return pickEven(INTENSITY_UNTIL_BIG, random)
}

// ---- which rows go silent (section 4.1) ----

/** One row as the breakdown sees it, in row order. */
export interface RadioIntensityRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  /** Its stem's intensity score (null: unscored, read as 0.5). */
  score: number | null
  /** Turns since it last changed (higher is staler). */
  staleness: number
  /** Heard now, and not resting (for a hook or the arc). */
  sounding: boolean
  /** The arc may rest it: not locked, not soloed or outside the solo, not muted by the user, no
   * manual change or swap-now for the line, not resting for a hook. */
  restable: boolean
}

const isLow = (kinds: readonly DiscoverSlotKind[]): boolean =>
  kinds.includes('drums') || kinds.includes('bass')

/** A row that carries a breakdown: not drums or bass, and sounding. */
export function radioBreakdownCarrier(r: RadioIntensityRow): boolean {
  return r.sounding && !isLow(r.kinds)
}

/** The kind of a carry row (section 4.1 rule 2): a lead, or a warm row when a lead is already on
 * the bed. */
export function radioCarryKind(
  rows: readonly { kinds: readonly DiscoverSlotKind[] }[]
): DiscoverSlotKind {
  return rows.some((r) => r.kinds.includes('lead')) ? 'warm' : 'lead'
}

/**
 * The rows a breakdown rests (section 4.1), a SEPARATE rule from the arc's removal: it breaks the
 * last-drums-and-bass rule on purpose, bounded in time (the breakdown) and in reach (something
 * always sounds).
 *   - swell: nothing;
 *   - thin: every bass row; every drums row but one -- the kept one is a sounding drums row the
 *     arc may not rest (it stays anyway), else the lowest-scored (unknown 0.5, ties to the
 *     stalest);
 *   - full: every drums and every bass row.
 * A row is low when its kinds include drums or bass (a combination row counts; bassHeavy and
 * rhythmic do not). With no carrier, a carry row joins when `carryReady`; else `full` falls to
 * `thin`. Last: if nothing would sound, the lowest-scored low row keeps sounding. An empty rest
 * reads as `swell`. The throw goes on the first resting drums row in row order.
 */
export function radioBreakdownRests(
  rows: readonly RadioIntensityRow[],
  depth: RadioBreakdownDepth,
  carryReady: boolean
): { depth: RadioBreakdownDepth; rest: string[]; carry: boolean; throwRowId: string | null } {
  const none = { depth: 'swell' as const, rest: [], carry: false, throwRowId: null }
  if (depth === 'swell') return none
  const carriers = rows.filter(radioBreakdownCarrier)
  let carry = false
  let d = depth
  if (carriers.length === 0) {
    if (carryReady) carry = true
    else if (d === 'full') d = 'thin'
  }
  const score = (r: RadioIntensityRow): number =>
    typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0.5
  const sparsest = (rs: readonly RadioIntensityRow[]): RadioIntensityRow | null =>
    rs.reduce<RadioIntensityRow | null>(
      (best, r) =>
        best === null ||
        score(r) < score(best) ||
        (score(r) === score(best) && r.staleness > best.staleness)
          ? r
          : best,
      null
    )
  const candidates = rows.filter((r) => r.sounding && r.restable && isLow(r.kinds))
  let rest: RadioIntensityRow[]
  if (d === 'full') rest = candidates
  else {
    const drums = rows.filter((r) => r.sounding && r.kinds.includes('drums'))
    const stays = drums.find((r) => !r.restable) ?? sparsest(drums)
    rest = candidates.filter((r) => r !== stays)
  }
  // never silence: something keeps sounding
  const stillSounding = rows.some((r) => r.sounding && !rest.includes(r))
  if (!stillSounding && !carry && rest.length > 0) {
    const keep = sparsest(rest)
    rest = rest.filter((r) => r !== keep)
  }
  if (rest.length === 0) return { ...none, carry: false }
  const thrown = rest.find((r) => r.kinds.includes('drums'))
  return { depth: d, rest: rest.map((r) => r.id), carry, throwRowId: thrown?.id ?? null }
}

// ---- the step (sections 3.1-3.4, 4.3-4.4) ----

export interface RadioIntensityStepInput {
  energy: number
  drama: number
  loopBars: number
  /** The turnaroundLap starting at this wrap. */
  lap: number
  /** The turnaround phrase in laps (turnaroundPhraseLaps). */
  phraseLaps: number
  held: boolean
  /** Rows on the bed (the arc's count), before anything landing at this wrap. */
  count: number
  /** The arc's fewest and most rows (DENSITY_MIN, DENSITY_MAX; the web's densityArc). */
  min: number
  max: number
  /** In row order. */
  rows: readonly RadioIntensityRow[]
  /** The arc can add a row (nextArcKind has a kind, a place is free, no add on its way). */
  canAdd: boolean
  /** The arc can strip one back (pickArcRemoval has a row). */
  canStrip: boolean
  /** The carry row prepared for this breakdown is warm and has a place. */
  carryReady: boolean
  /** A returning drums or bass row's fresh pick is warm. */
  renewReady: (rowId: string) => boolean
  random: () => number
}

export interface RadioIntensityStepResult {
  state: RadioIntensityArc
  /** The event that landed at THIS wrap (decided at the last), now applied to the state. */
  applied: RadioIntensityDecided | null
  /** Decided now, landing at the next wrap: binding. */
  decided: RadioIntensityDecided | null
  /** Warm what the coming phase change needs: a carry row for the breakdown, fresh picks for
   * the returning drums and bass rows at the drop (leaned to the top target at full weight). */
  prepare: { carry: boolean; renew: string[] } | null
  /** A breakdown ran past its time and is ended now (logged `[radio-intensity] breakdown
   * overran`). */
  overran: boolean
}

/** A machine waiting for its first phrase start. */
export function newRadioIntensityArc(): RadioIntensityArc {
  return { ...NO_RADIO_INTENSITY_ARC, rests: [] }
}

/** A cycle's build, worked out: the bigger-peak countdown (drawn when due), the peak, the length
 * (drawn, raised to fit its adds: one per phrase start after the first). `count`: the rows it
 * starts from. */
function nextBuild(
  arc: RadioIntensityArc,
  input: Pick<RadioIntensityStepInput, 'energy' | 'min' | 'max' | 'random'>,
  count: number,
  first: boolean
): Required<RadioIntensityNext> {
  let untilBig = arc.untilBig
  let big = false
  if (first || untilBig === null) untilBig = drawUntilBig(input.random)
  else {
    untilBig -= 1
    if (untilBig <= 0) {
      big = true
      untilBig = drawUntilBig(input.random)
    }
  }
  const lo = Math.max(1, input.min)
  const peak = big ? input.max : clamp01(input.energy / 100) < 0.5 ? 4 : 5
  const peakRows = Math.min(input.max, Math.max(lo, peak))
  const adds = Math.max(0, peakRows - count)
  const drawn = drawLength(INTENSITY_PHRASES.build[energyBand(input.energy)], input.random)
  return { phrases: Math.max(drawn + (big ? 1 : 0), adds + 1), big, untilBig, peakRows }
}

function applyBuild(
  arc: RadioIntensityArc,
  next: Required<RadioIntensityNext>,
  first: boolean
): RadioIntensityArc {
  return {
    ...arc,
    begun: true,
    phase: 'build',
    phrases: next.phrases,
    done: 0,
    big: next.big,
    untilBig: next.untilBig,
    peakRows: next.peakRows,
    first,
    depth: null,
    rests: [],
    prepared: null
  }
}

/** A breakdown's or a ride's length, drawn. */
function nextLength(
  phase: 'breakdown' | 'drop',
  arc: RadioIntensityArc,
  input: Pick<RadioIntensityStepInput, 'energy' | 'random'>
): RadioIntensityNext {
  const drawn = drawLength(INTENSITY_PHRASES[phase][energyBand(input.energy)], input.random)
  return { phrases: drawn + (phase === 'drop' && arc.big ? 1 : 0) }
}

/** Radio started (or density turned to `intensity` at a phrase start): the first build begins
 * now, from the rows as they are. Its draws (section 3.5's first) come from `random`. */
export function radioIntensityStarted(
  input: Pick<RadioIntensityStepInput, 'energy' | 'min' | 'max' | 'random' | 'count'>
): RadioIntensityArc {
  const arc = newRadioIntensityArc()
  return applyBuild(arc, nextBuild(arc, input, input.count, true), true)
}

/** Applies a landed event: phases change here (a button's event draws its length here). */
function land(
  arc: RadioIntensityArc,
  d: RadioIntensityDecided,
  input: RadioIntensityStepInput
): RadioIntensityArc {
  const base = { ...arc, decided: null }
  switch (d.event) {
    case 'cycle': {
      const next = d.next ?? nextBuild(base, input, input.count - (d.strip ? 1 : 0), false)
      return applyBuild(base, next as Required<RadioIntensityNext>, false)
    }
    case 'add':
      return base
    case 'breakdown':
      return {
        ...base,
        phase: 'breakdown',
        phrases: (d.next ?? nextLength('breakdown', base, input)).phrases,
        done: 0,
        depth: d.depth,
        rests: [...d.rest],
        prepared: null
      }
    case 'drop':
      return {
        ...base,
        phase: 'drop',
        phrases: (d.next ?? nextLength('drop', base, input)).phrases,
        done: 0,
        depth: null,
        rests: [],
        prepared: null
      }
  }
}

/** What the phase change at the coming phrase start (or a pending press) is, decided now. */
function decide(
  arc: RadioIntensityArc,
  input: RadioIntensityStepInput
): RadioIntensityDecided | null {
  const ending = arc.done + 1 >= arc.phrases
  switch (arc.phase) {
    case 'build': {
      if (ending) return breakdownEvent(arc, input)
      if (addFits(arc, input)) return { event: 'add' }
      return null
    }
    case 'breakdown':
      return ending ? dropEvent(arc, input) : null
    case 'drop':
      if (!ending) return null
      return {
        event: 'cycle',
        strip: input.canStrip,
        next: nextBuild(arc, input, input.count - (input.canStrip ? 1 : 0), false)
      }
  }
}

function breakdownEvent(
  arc: RadioIntensityArc,
  input: RadioIntensityStepInput
): RadioIntensityDecided {
  const r = radioBreakdownRests(
    input.rows,
    radioBreakdownDepth(input.drama, arc.big),
    input.carryReady
  )
  const shape: RadioHookThrow | null =
    r.throwRowId === null
      ? null
      : { beats: drawThrowBeats(input.random), ...drawThrowEcho(input.random) }
  return {
    event: 'breakdown',
    depth: r.depth,
    rest: r.rest,
    throwRowId: r.throwRowId,
    throw: shape,
    carry: r.carry,
    next: nextLength('breakdown', arc, input)
  }
}

/** The rows a drop renews from (section 4.4): the rested drums and bass rows, or -- at swell
 * depth, nothing rested -- the sounding ones. */
function renewalRows(arc: RadioIntensityArc, rows: readonly RadioIntensityRow[]): string[] {
  if (arc.rests.length > 0) {
    return rows.filter((r) => arc.rests.includes(r.id) && isLow(r.kinds)).map((r) => r.id)
  }
  return rows.filter((r) => r.sounding && isLow(r.kinds)).map((r) => r.id)
}

function dropEvent(arc: RadioIntensityArc, input: RadioIntensityStepInput): RadioIntensityDecided {
  const chance = INTENSITY_RENEW_BASE + INTENSITY_RENEW_SPAN * clamp01(input.drama / 100)
  const renew: string[] = []
  for (const id of renewalRows(arc, input.rows)) {
    if (!input.renewReady(id)) continue
    if (input.random() < chance) renew.push(id)
  }
  return { event: 'drop', returning: [...arc.rests], renew, next: nextLength('drop', arc, input) }
}

/** What a button's event may do with the rows at its top (RadioIntensityStepInput's fields).
 * Unknown (a press without them): it adds and strips, the runtime's own pick deciding. */
export type RadioIntensityRoom = Pick<
  RadioIntensityStepInput,
  'count' | 'max' | 'canAdd' | 'canStrip'
>

/** An add fits: the arc can add one, under the build's peak and the most rows. */
function addFits(arc: RadioIntensityArc, room: RadioIntensityRoom): boolean {
  return room.canAdd && room.count < arc.peakRows && room.count < room.max
}

/** The decided event already does what the button asks (review, 2026-10-05): a drop for `drop`, a
 * cycle or an add for `build`. The press changes nothing then. */
function answers(d: RadioIntensityDecided | null, action: RadioIntensityAction): boolean {
  if (d === null) return false
  return action === 'drop' ? d.event === 'drop' : d.event === 'cycle' || d.event === 'add'
}

/** A button's event (section 6), landing at the next top. `room`: the rows there (null: unknown;
 * see RadioIntensityRoom). */
function forcedEvent(
  arc: RadioIntensityArc,
  action: RadioIntensityAction,
  room: RadioIntensityRoom | null
): RadioIntensityDecided | null {
  if (action === 'drop') {
    if (arc.phase === 'breakdown') {
      return { event: 'drop', returning: [...arc.rests], renew: [], forced: true }
    }
    return { event: 'drop', returning: [], renew: [], quick: true, forced: true }
  }
  // build
  if (arc.phase === 'drop') {
    return { event: 'cycle', strip: room === null || room.canStrip, forced: true }
  }
  if (arc.phase === 'build') {
    // no room: the halved build alone goes up sooner (pressRadioIntensity)
    return room === null || addFits(arc, room) ? { event: 'add', forced: true } : null
  }
  return null // in a breakdown, `build` only shortens it (pressRadioIntensity)
}

/**
 * One loop top. In order:
 *   1. the event decided at the last wrap lands (a phase change draws its length);
 *   2. unless held: at a phrase start the phase counts it (or the machine begins, at its first);
 *      a breakdown past its time is ended (overran);
 *   3. unless held: at the decide wrap, the coming phrase start's event -- or a button's press
 *      waiting for a free top -- is decided, binding;
 *   4. unless held: prepares, a phrase ahead of a breakdown (a carry row when nothing would
 *      carry it) and of a drop (fresh picks for the returning drums and bass).
 */
export function stepRadioIntensityArc(
  arc: RadioIntensityArc,
  input: RadioIntensityStepInput
): RadioIntensityStepResult {
  const P = Math.max(1, Math.floor(input.phraseLaps))
  const lap = ((Math.floor(input.lap) % P) + P) % P
  let state = arc
  let applied: RadioIntensityDecided | null = null
  // 1. land
  if (state.decided !== null) {
    applied = state.decided
    state = land(state, applied, input)
  }
  const out = (
    decided: RadioIntensityDecided | null,
    prepare: RadioIntensityStepResult['prepare'],
    overran = false
  ): RadioIntensityStepResult => ({ state, applied, decided, prepare, overran })
  if (input.held || !(input.loopBars > 0)) return out(null, null)
  // `input.count` is the rows before this wrap's event lands; the runtime applies it at this wrap,
  // so what is decided now (every wrap with a one-lap phrase) reads the rows after it (review,
  // 2026-10-05: else a one-lap build adds one past its peak)
  const grown =
    applied === null
      ? 0
      : applied.event === 'add' || (applied.event === 'breakdown' && applied.carry)
        ? 1
        : applied.event === 'cycle' && applied.strip
          ? -1
          : 0
  const now: RadioIntensityStepInput =
    grown === 0 ? input : { ...input, count: Math.max(0, input.count + grown) }
  // 2. count
  const phraseStart = lap === 0
  let overran = false
  if (!state.begun) {
    if (!phraseStart) return out(null, null)
    state = applyBuild(state, nextBuild(state, now, now.count, true), true)
  } else if (phraseStart && applied === null) {
    state = { ...state, done: state.done + 1 }
  } else if (phraseStart && applied !== null && applied.event === 'add') {
    state = { ...state, done: state.done + 1 }
  }
  if (
    state.phase === 'breakdown' &&
    state.done >= state.phrases + INTENSITY_BREAKDOWN_OVERRUN &&
    state.decided === null
  ) {
    overran = true
    const d = dropEvent(state, now)
    state = { ...state, decided: d }
    return out(d, null, overran)
  }
  // 3. decide: a press waiting for this top first (unless what just landed answered it); one
  // that comes to nothing leaves the decision to the clock
  let decided: RadioIntensityDecided | null = null
  const decideWrap = lap === P - 1
  const pending = state.forced
  if (pending !== null && state.decided === null) {
    state = { ...state, forced: null }
    if (pending === 'build' && state.phase === 'breakdown') {
      // a waiting build that meets a breakdown brings the drop forward (spec 6): this phrase is
      // its last, and the clock decides the drop at its decide wrap
      if (state.done + 1 < state.phrases) state = { ...state, phrases: state.done + 1 }
    } else if (!answers(applied, pending)) decided = forcedEvent(state, pending, now)
  }
  if (decided === null && decideWrap && state.decided === null) {
    decided = decide(state, now)
  }
  if (decided !== null) state = { ...state, decided }
  // 4. prepare: a phrase ahead (two wraps with a one-lap phrase), once per phase change
  let prepare: RadioIntensityStepResult['prepare'] = null
  const ending = (): RadioIntensityPhase | null => {
    if (P >= 2) return phraseStart && state.done + 1 >= state.phrases ? state.phase : null
    // one-lap phrase: the change two wraps on -- the phase decided to begin at the next wrap,
    // when it lasts one phrase, else this phase when it ends then
    const d = state.decided
    if (d !== null && d.event !== 'add') {
      const begins: RadioIntensityPhase =
        d.event === 'cycle' ? 'build' : d.event === 'breakdown' ? 'breakdown' : 'drop'
      return d.next !== undefined && d.next.phrases <= 1 ? begins : null
    }
    return state.done + 2 >= state.phrases ? state.phase : null
  }
  const coming = ending()
  const endingPhase = coming === state.prepared ? null : coming
  if (endingPhase === 'build') {
    const depth = radioBreakdownDepth(input.drama, state.big)
    const carriers = input.rows.filter(radioBreakdownCarrier)
    prepare = { carry: depth !== 'swell' && carriers.length === 0, renew: [] }
  } else if (endingPhase === 'breakdown') {
    const d = state.decided
    const rests = d?.event === 'breakdown' ? d.rest : state.rests
    prepare = { carry: false, renew: renewalRows({ ...state, rests }, input.rows) }
  }
  if (prepare !== null) state = { ...state, prepared: endingPhase }
  return out(decided, prepare, overran)
}

/**
 * A button (section 6), pressed mid-lap: it lands at the next loop top, or -- `late` (pressed in
 * the lap's last stretch, too late to arm) or with an event already decided for that top -- the
 * top after. Returns the new state; the press is null when it does nothing here:
 *   - build in the ride: the next cycle's build (its strip-back, when one can go) at the top;
 *   - build in the build: the next add at the top (when one fits), and the remaining phrases
 *     halve (at least 1);
 *   - build in the breakdown: the drop at the next phrase start whose decide wrap has not passed
 *     (the breakdown shortened; nothing lands at the top);
 *   - drop in the breakdown: the rested rows back at the top;
 *   - drop in the build or the ride: a quick drop at the top.
 * A press the decided event already answers (a drop for `drop`, a cycle or an add for `build`),
 * or one already waiting for its top, decides nothing more: it lands once (review, 2026-10-05);
 * a build in the build still halves the remaining phrases. A later press replaces an earlier one
 * still waiting; a waiting build that meets a breakdown brings its drop forward (the step). `where.can`: the rows now (RadioIntensityRoom); absent, an add and a strip are
 * left to the runtime's own pick, as before.
 */
export function pressRadioIntensity(
  arc: RadioIntensityArc,
  action: RadioIntensityAction,
  where: { lap: number; phraseLaps: number; late: boolean; can?: RadioIntensityRoom }
): RadioIntensityArc | null {
  if (!arc.begun) return null
  const P = Math.max(1, Math.floor(where.phraseLaps))
  const halved =
    action === 'build' && arc.phase === 'build'
      ? arc.done + Math.max(1, Math.floor((arc.phrases - arc.done) / 2))
      : arc.phrases
  if (answers(arc.decided, action) || arc.forced === action) {
    // nothing new lands; a build in the build still hurries (spec 6), and a different press
    // waiting for its top is replaced by this one
    const forced = arc.forced === action ? arc.forced : null
    if (halved === arc.phrases && forced === arc.forced) return arc
    return { ...arc, phrases: halved, forced }
  }
  if (action === 'build' && arc.phase === 'breakdown') {
    // the decide wrap of the next phrase start begins the last lap: passed once we are in it
    const passed = where.lap >= P - 1
    const phrases = Math.min(arc.phrases, arc.done + (passed ? 2 : 1))
    if (phrases === arc.phrases && arc.forced === null) return arc
    return { ...arc, phrases, forced: null }
  }
  // a later press replaces an earlier one still waiting
  if (where.late || arc.decided !== null) return { ...arc, phrases: halved, forced: action }
  const decided = forcedEvent(arc, action, where.can ?? null)
  if (decided === null) {
    if (halved === arc.phrases && arc.forced === null) return null
    return { ...arc, phrases: halved, forced: null }
  }
  return { ...arc, phrases: halved, decided, forced: null }
}

/** A rested row is no longer the arc's (spec 4.2): unmuted or soloed by hand (it plays at once),
 * removed, locked or changed by hand. It leaves the rests, and a decided breakdown's or drop's
 * lists; the drop still lands for the others. */
export function releaseRadioIntensityRest(
  arc: RadioIntensityArc,
  rowId: string
): RadioIntensityArc {
  const d = arc.decided
  const decided: RadioIntensityDecided | null =
    d?.event === 'breakdown'
      ? {
          ...d,
          rest: d.rest.filter((id) => id !== rowId),
          throwRowId: d.throwRowId === rowId ? null : d.throwRowId,
          throw: d.throwRowId === rowId ? null : d.throw
        }
      : d?.event === 'drop'
        ? {
            ...d,
            returning: d.returning.filter((id) => id !== rowId),
            renew: d.renew.filter((id) => id !== rowId)
          }
        : d
  if (!arc.rests.includes(rowId) && decided === d) return arc
  return { ...arc, rests: arc.rests.filter((id) => id !== rowId), decided }
}

/** Radio stopped, or density left `intensity`: the rows to put back with their own stems (rested,
 * or about to be), and a fresh machine. */
export function radioIntensityStopped(arc: RadioIntensityArc): {
  state: RadioIntensityArc
  unrest: string[]
} {
  const soon = arc.decided?.event === 'breakdown' ? arc.decided.rest : []
  return { state: newRadioIntensityArc(), unrest: [...new Set([...arc.rests, ...soon])] }
}

// ---- what the rest of radio reads (section 5) ----

/** The forecast's arcRole for the coming phrase end (radioBuildSize): its decided event's, or
 * `hold` -- every other phrase end in an intensity cycle (capped at medium, no promotion). */
export type RadioArcRole = 'build' | 'strip' | 'breakdown' | 'drop' | 'hold'

export function radioIntensityArcRole(arc: RadioIntensityArc): RadioArcRole {
  const d = arc.decided
  if (d === null) return 'hold'
  switch (d.event) {
    case 'cycle':
      return d.strip ? 'strip' : 'build'
    case 'add':
      return 'build'
    case 'breakdown':
      return 'breakdown'
    case 'drop':
      return 'drop'
  }
}

/** An add is coming at the next decide wrap (the build's next phrase start has room for one):
 * the desktop picks and warms the row a lap early (radioWrapBeforeLastLap), as its density arc
 * does, so the add is warm by the phrase end's roll. */
export function radioIntensityAddComing(arc: RadioIntensityArc, count: number): boolean {
  return (
    arc.begun &&
    arc.phase === 'build' &&
    arc.decided === null &&
    arc.forced === null &&
    arc.done + 1 < arc.phrases &&
    count < arc.peakRows
  )
}

/** The arc a phrase end's turnaround is drawn for (section 5.6): growing through the build and
 * into the drop, thinning into and through the breakdown, steady in the ride. */
export function radioIntensityTurnaroundArc(arc: RadioIntensityArc): TurnaroundArc {
  const d = arc.decided
  if (d?.event === 'drop') return 'growing'
  if (d?.event === 'breakdown' || arc.phase === 'breakdown') return 'thinning'
  if (d?.event === 'cycle' || arc.phase === 'build') return 'growing'
  return 'steady'
}

/** Hooks' inputs (section 5.2). */
export function radioIntensityHookInputs(arc: RadioIntensityArc): {
  dropAtNextWrap: boolean
  inBreakdown: boolean
} {
  const d = arc.decided?.event
  return {
    dropAtNextWrap: d === 'drop',
    inBreakdown: d !== 'drop' && (arc.phase === 'breakdown' || d === 'breakdown')
  }
}

/** The fold step's bend under intensity (section 5.3): clamp(bend + 25 d (2 tau - 1), 0, 100). */
export function radioIntensityBend(bend: number, drama: number, target: number): number {
  const b = Number.isFinite(bend) ? bend : 0
  const v = b + INTENSITY_BEND_SWING * clamp01(drama / 100) * (2 * clamp01(target) - 1)
  return Math.min(100, Math.max(0, v))
}

/** Bars from the playhead to the drop's planned top, in a breakdown; null otherwise. `pos` is the
 * bars into the lap playing, `lap` its turnaroundLap. */
export function radioIntensityDropInBars(
  arc: RadioIntensityArc,
  at: { lap: number; phraseLaps: number; loopBars: number; pos: number }
): number | null {
  if (!arc.begun || !(at.loopBars > 0)) return null
  if (arc.decided?.event === 'drop') return Math.max(0, at.loopBars - at.pos)
  if (arc.phase !== 'breakdown') return null
  const P = Math.max(1, Math.floor(at.phraseLaps))
  const lap = ((Math.floor(at.lap) % P) + P) % P
  const phrasesLeft = Math.max(1, arc.phrases - arc.done)
  const laps = (phrasesLeft - 1) * P + (P - lap)
  return Math.max(0, laps * at.loopBars - at.pos)
}

// ---- words (section 9) ----

export const RADIO_BUILD_WORD = 'build'
export const RADIO_BUILDING_WORD = 'building'
export const RADIO_DROP_WORD = 'drop'
export const RADIO_DROPPING_WORD = 'dropping'
export const RADIO_BREAKDOWN_WORD = 'breakdown'
/** A row the breakdown rests (19 characters), and the phone's short form. */
export const RADIO_ARC_REST_WORD = 'rests till the drop'
export const RADIO_ARC_REST_SHORT = 'rests'

/** A button's label: its word, or while its press waits for the top, its -ing word. */
export function radioIntensityButtonLabel(
  action: RadioIntensityAction,
  arc: RadioIntensityArc
): string {
  const d = arc.decided
  const pressed = d !== null && 'forced' in d && d.forced === true
  const waiting =
    arc.forced === action ||
    (pressed && (action === 'drop' ? d.event === 'drop' : d.event !== 'drop'))
  if (action === 'build') return waiting ? RADIO_BUILDING_WORD : RADIO_BUILD_WORD
  return waiting ? RADIO_DROPPING_WORD : RADIO_DROP_WORD
}
