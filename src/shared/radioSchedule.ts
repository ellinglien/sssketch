// src/shared/radioSchedule.ts
//
// Radio mode's whole schedule -- docs/superpowers/specs/2026-09-26-radio-
// mode-design.md. Radio is Discover with a clock: every so often one
// unlocked layer rerolls on its own. Everything here is pure and injected
// with its own randomness, both so it can be tested deterministically and
// because this codebase's react-hooks/purity lint rule rejects a bare
// Math.random() inside a component-scoped function (see DiscoverPanel's
// own freshSlotId/pickRandomKind, which live at module scope for the same
// reason).

import type { DiscoverSlotKind } from './discoverSlotKind'
import { radioSlotFlagWeightFactor, type RadioSlotFlags } from './radioSlotFlags'
import type { RadioDropOuts } from './radioDropOut'
import {
  DEFAULT_RADIO_TURNAROUNDS,
  normalizeRadioTurnarounds,
  turnaroundPhraseLaps,
  type RadioTurnarounds
} from './radioTurnaround'
import {
  DEFAULT_RADIO_TRANSITIONS,
  normalizeRadioTransitions,
  type RadioTransitions
} from './radioTransition'

/** The three speeds radio can run at. Literal values double as their own
 * UI text (the same convention DISCOVER_SLOT_KIND_OPTIONS uses for its
 * non-camelCase kinds), so there is no label table. */
export type RadioPace = 'slow' | 'mid' | 'fast'

export const RADIO_PACE_OPTIONS: RadioPace[] = ['slow', 'mid', 'fast']

export const DEFAULT_RADIO_PACE: RadioPace = 'mid'

/** Each pace is a WINDOW of bars, not a number. Exactly every N bars reads
 * as mechanical; a change landing somewhere in a range feels like
 * something is making decisions (spec 3.3).
 *
 * The 2:1 ratio is the decision; the absolute numbers are taste. 2:1 is
 * wide enough that you cannot count along with it and narrow enough that
 * it never feels stalled at the top or frantic at the bottom. A 4:1 range
 * would give a change at 6 bars and then nothing for 24, which reads as
 * broken rather than loose.
 *
 * RETUNED TWICE on 2026-09-28, and the second retune is the one that
 * stands. The original windows (24-48 / 12-24 / 6-12) were chosen while
 * advanceRadioClock silently rounded every one of them UP to the next
 * whole multiple of the loop length, so at 120bpm on an 8-bar loop `mid`
 * could only ever produce 32s or 48s. Elling: "radio mode seems quite slow
 * to me". The first retune dropped the whole ladder a notch; he listened
 * and called it "a little too frenetic", so `mid` came back up to the
 * numbers below. See the comment on the constant itself for why, and note
 * the clean 3x ladder did NOT survive: `mid` is the one window that has
 * been judged by ear, so its neighbours are spaced around it rather than
 * the other way round.
 *
 * These are only the DRAWN windows. What is realised depends on where a
 * change is allowed to land, which is now DEFAULT_RADIO_LOOP_END_BARS --
 * four bars, so a layer of four bars or less turns over on its own cycle
 * and a longer one rounds up to the next loop top. A pace is "at least N
 * bars, then the next boundary the changing layer has". On an 8-bar loop
 * at 120bpm `mid` lands between 16s and 32s either way; what changed is
 * `fast`, which could only ever produce a whole loop before. */
// Reported after listening to the first retune (2026-09-28): "the
// transitions are a little too frenetic by default now". Realised mid had
// gone from ~44s to ~21s between changes -- a bigger jump than the numbers
// alone suggest, because it compounded with faa3f24. That fix meant radio
// had been doing NOTHING on a loop seeded by hand, so he went from no
// changes at all to one every twenty seconds, and judged the pair
// together.
//
// So mid steps back to 8-16 (~28s realised), which is the number Phase A's
// own simulation named as the retreat if it came out too busy. The GRID is
// deliberately left alone: that is the correctness fix -- it is what makes
// the pace mean a number of bars again rather than a number rounded up to
// the loop -- and walking it back would hide the thing that was actually
// wrong. Pace is taste; the grid was a bug.
export const RADIO_PACE_BARS: Record<RadioPace, { min: number; max: number }> = {
  slow: { min: 24, max: 48 },
  mid: { min: 8, max: 16 },
  fast: { min: 3, max: 6 }
}

/** Anything unrecognised (an older settings file, a hand-edited JSON)
 * becomes the default rather than throwing -- same shape as
 * normalizeTraitMatchBar (traitBar.ts). */
export function normalizeRadioPace(value: unknown): RadioPace {
  return RADIO_PACE_OPTIONS.includes(value as RadioPace) ? (value as RadioPace) : DEFAULT_RADIO_PACE
}

/** A fresh whole number of bars to wait, drawn uniformly across the pace's
 * own window (both ends inclusive). Drawn again after every change, which
 * is what stops radio being a metronome. */
export function nextRadioIntervalBars(pace: RadioPace, random: () => number = Math.random): number {
  const { min, max } = RADIO_PACE_BARS[pace]
  const span = max - min + 1
  const offset = Math.min(span - 1, Math.floor(random() * span))
  return min + offset
}

/** How long a stem may be and still turn over on its OWN cycle. At or
 * under this many bars a change lands on the changing stem's own
 * boundary; over it, the change waits for the top of the whole loop.
 *
 * `0` is `always`: no stem is shorter than zero bars, so every change
 * waits for the loop top. That is exactly what the old `change on: loop
 * end` did, and it is why this one setting REPLACES that row rather than
 * sitting beside it -- two controls for where a change lands is two
 * answers to one question.
 *
 * The numbers double as their own UI text (`${n} bars`, or `always` for
 * 0), the same convention RadioPace and DISCOVER_SLOT_KIND_OPTIONS use.
 *
 * No `never` chip, deliberately. Infinity here means every stem on its
 * own cycle whatever its length, which is the restless version 687641a
 * removed after listening -- "it cut off just now... can the transitions
 * for the stems longer than 8 bars be the complete loop only?". Eight
 * bars is already longer than any ordinary Endlesss layer, so `never`
 * would differ from `8 bars` only on the material the ear complained
 * about. */
export const RADIO_LOOP_END_OPTIONS: number[] = [2, 4, 8, 0]

/** Four bars. The descendant of GRID_LONG_PHRASE_BARS, which was a hard
 * 8 and is now this setting's default instead.
 *
 * Elling, listening at `fast` (3-6 bars) with the old `loop end` default:
 * "even fast feels quite slow now.. i think it's the transition rules".
 * The arithmetic backs him: every drawn interval rounded up to the next
 * whole loop top, so on an 8-bar loop `fast` could only ever produce 8
 * bars. The grid silently overruled the pace, and no pace setting could
 * get underneath it.
 *
 * Four is the number that fixes that without giving back what 687641a
 * bought. Endlesss loops are commonly 1, 2, 4 or 8 bars, so at four every
 * ordinary layer -- the hats and percussion that make a pace feel fast --
 * turns over on its own cycle, while the 8-bar phrases that sound like
 * statements still wait for the loop top.
 *
 * Why this is safe, which is the part not to break: the transport does
 * not reset for a change (`load-project` deliberately never calls
 * setPosition), so a stem enters at whatever phase the transport is at,
 * and the engine tiles each stem at its OWN barLength inside the loop
 * (see buildEngineProject's loopLengthBars doc comment). A change on a
 * boundary of an N-bar cycle therefore lands at a position that is a
 * multiple of N -- so an N-bar stem is at its own zero at that instant,
 * which is the same guarantee the loop top gives, just more often. The
 * step-down below is what keeps that true: a cycle that does not divide
 * the loop is stepped down to one that does, so every boundary is the
 * same place in the phrase on every lap. radioChangeBars is the other
 * half -- the guarantee has to hold for the INCOMING stem too, so both
 * lengths go in. */
export const DEFAULT_RADIO_LOOP_END_BARS = 4

/** What the 1.3.x `change on` words mean as a threshold. `loop end` is
 * `always`; the three explicit grids keep their number, since a hand-
 * picked 4-bar grid and a 4-bar threshold do the same thing to every
 * ordinary layer. `own loop` has no threshold that means it -- it was
 * "every stem on its own cycle, ceiling 8" -- so it takes the default,
 * which is the nearest honest reading and is never louder than what it
 * replaces. */
const LEGACY_RADIO_GRID_BARS: Record<string, number> = {
  'loop end': 0,
  'own loop': DEFAULT_RADIO_LOOP_END_BARS,
  '8 bars': 8,
  '4 bars': 4,
  '2 bars': 2
}

/** Anything unrecognised becomes the default rather than throwing -- same
 * shape as normalizeRadioPace. `legacyGrid` is the migration: a settings
 * file written before this field existed has a `grid` word instead, and
 * it has to keep meaning what it meant. A stored threshold always wins
 * over it. */
export function normalizeRadioLoopEndBars(value: unknown, legacyGrid?: unknown): number {
  if (typeof value === 'number' && RADIO_LOOP_END_OPTIONS.includes(value)) return value
  return LEGACY_RADIO_GRID_BARS[legacyGrid as string] ?? DEFAULT_RADIO_LOOP_END_BARS
}

/** The PHRASE grid: how far apart the boundaries a change may land on
 * are, counted in bars, above and beyond whatever the loop-end threshold
 * already allows. `0` is `loop` -- no phrase grid at all, which is
 * everything that shipped before 2026-09-28.
 *
 * Elling: "any way to keep track of the beat and to make sure it
 * transitions on 16 or 32". Sections turn over on 16s and 32s, not on
 * whatever length a loop happens to be.
 *
 * NOT the same axis as loopEndOverBars, and deliberately not merged with
 * it. The threshold is a FLOOR -- the smallest boundary a change may land
 * on -- and radioGridBars caps it at the loop, so nothing there can ever
 * express "wait for bar 16 of a phrase that spans two 8-bar loops". This
 * is the CEILING: however eager the pace and however short the layer, a
 * change may only land on a 16 or a 32. The threshold still says how fine
 * a boundary can be inside the phrase; the phrase says which boundaries
 * exist at all.
 *
 * The numbers double as their own UI text (`${n} bars`, or `loop` for 0),
 * the same convention RadioPace and RADIO_LOOP_END_OPTIONS use. */
export const RADIO_PHRASE_OPTIONS: number[] = [0, 16, 32]

/** Off. At 120bpm a 16-bar phrase is 32 seconds and a 32-bar one is over
 * a minute, so a phrase grid plus `fast` means `fast` does nothing -- the
 * pace stops being "how often" and becomes "which 16 it picks". That is
 * arguably right for sectional music and it is the exact opposite of the
 * complaint that drove the same day's pace work ("radio mode seems quite
 * slow to me"), so it ships opt-in. */
export const DEFAULT_RADIO_PHRASE_BARS = 0

/** Absent or unrecognised becomes `loop`, never throws -- the same shape
 * as normalizeRadioLoopEndBars. No legacy word maps onto this one: the
 * setting is new, so every older file simply keeps today's behaviour. */
export function normalizeRadioPhraseBars(value: unknown): number {
  return typeof value === 'number' && RADIO_PHRASE_OPTIONS.includes(value)
    ? value
    : DEFAULT_RADIO_PHRASE_BARS
}

/** One phrase, counted in whole LAPS of the loop rather than in bars.
 * `0` means no phrase grid is running.
 *
 * Laps, not bars, and this is the load-bearing decision of the whole
 * feature:
 *
 *   - A lap is an integer the clock already spots exactly (pos went
 *     down). Bars are a float sum of ~30Hz deltas, and a phrase boundary
 *     tested as `total % 16` would sooner or later miss its tick by a
 *     float hair and skip a whole phrase. Counting laps cannot drift, for
 *     any listening length.
 *   - It makes every phrase boundary a LOOP TOP, which is the boundary
 *     that is actually safe to change on. The transport never resets for
 *     a change, and the engine tiles each stem at its own barLength
 *     inside the loop, so at a loop top every stem is at its own zero --
 *     the guarantee DEFAULT_RADIO_LOOP_END_BARS' comment spells out. A
 *     boundary 16 bars after some arbitrary moment has no such guarantee.
 *
 * A loop that does not divide the phrase takes the NEAREST whole number
 * of laps (a 3-bar loop against a 16-bar phrase is five laps, fifteen
 * bars). There is no 16-bar boundary that is also a loop top there, and a
 * boundary that is not a loop top is not one radio may use, so the
 * nearest lap is the honest answer rather than a special case.
 *
 * Never below one lap: a loop longer than the phrase already changes less
 * often than the phrase asks for, and the loop top is the floor. */
export function radioPhraseLaps(phraseBars: number, loopBars: number): number {
  if (!(phraseBars > 0) || !(loopBars > 0) || !Number.isFinite(loopBars)) return 0
  return Math.max(1, Math.round(phraseBars / loopBars))
}

/** The cycle a change has to sit on, given the OUTGOING layer's bar
 * length and the INCOMING one's.
 *
 * The outgoing length on its own is not enough, and this is the hole the
 * threshold would otherwise leave open. 687641a's bad case is an 8-bar
 * stem ENTERING at bar 4 of an 8-bar loop -- "puts an 8-bar stem in
 * halfway through itself" -- and the entering stem is not the one being
 * replaced. A slot holding a 2-bar hat can perfectly well draw an 8-bar
 * pad next, and a boundary chosen from the hat alone would drop that pad
 * in at its own bar two, four or six. That is the cut he heard, not the
 * one the threshold is meant to allow.
 *
 * So both lengths go in and the LONGER one wins. At a multiple of the
 * longer cycle a shorter one that divides it is at its own zero as well,
 * which is the ordinary case here -- Endlesss layers are 1, 2, 4 or 8
 * bars. Where the shorter does not divide the longer (a 3 against a 4)
 * the outgoing layer is cut mid-phrase, which is the lesser of the two
 * faults and the one a fade could hide.
 *
 * Null when either side is unknown -- the incoming stem resolves
 * asynchronously (DiscoverPanel's armRadioPick warms it a whole interval
 * ahead), and until it has, radioGridBars' own null fallback holds the
 * change to the loop top. That is today's behaviour, so waiting can
 * never be worse than what is already out there. */
export function radioChangeBars(
  outgoingBars: number | null,
  incomingBars: number | null
): number | null {
  if (outgoingBars === null || incomingBars === null) return null
  return Math.max(outgoingBars, incomingBars)
}

/** How many bars apart the boundaries a change may land on are.
 *
 * `loopEndOverBars` is the threshold above. `loopBars` is the preview
 * loop's own length (DiscoverPanel's maxBarLength, which is what went to
 * the engine as loopLengthBars). `slotBars` is the bar length of the
 * stems involved in THIS change -- radioChangeBars' answer -- or null
 * when nothing has resolved it yet.
 *
 * Two edges, both settled on the phone (remotePage.ts:995-1007) and not
 * re-litigated here:
 *   - a cycle longer than the loop is capped to the loop;
 *   - a cycle that does not divide the loop steps DOWN to the largest
 *     divisor, so every boundary is the same place in the phrase on every
 *     lap and the downbeats stay where they were. It can never step below
 *     1, which divides everything.
 *
 * Anything without a whole positive bar count falls back to the whole
 * loop -- which is exactly the behaviour that shipped 2026-09-26, so the
 * fallback can never be worse than what is already out there. A
 * fractional length (2.5 bars) is one of those: flooring it to 2 would
 * invent a boundary the stem does not actually have. */
export function radioGridBars(
  loopEndOverBars: number,
  loopBars: number,
  slotBars: number | null
): number {
  if (!(loopBars > 0)) return loopBars
  if (!Number.isInteger(loopBars)) return loopBars
  if (slotBars === null || !Number.isInteger(slotBars) || slotBars < 1) return loopBars
  // Over the threshold: the whole loop, which is where the ear expects a
  // section to end. Reported while listening (2026-09-28): "it cut off
  // just now... can the transitions for the stems longer than 8 bars be
  // the complete loop only?"
  //
  // A short layer turning over on its own cycle is unremarkable -- a
  // two-bar hat changing at bar 2 of 8 reads as a variation, which is the
  // whole point. A long phrase is a musical statement, and replacing one
  // partway through the loop is audible however cleanly the boundary is
  // hit: the ear is still following the phrase, so the change lands as an
  // interruption rather than an arrival.
  if (slotBars > loopEndOverBars) return loopBars
  let step = Math.min(slotBars, loopBars)
  while (step > 1 && loopBars % step !== 0) step -= 1
  return step
}

/** Radio's own sense of time. Fed ONLY by the engine's existing ~30Hz
 * position-update stream (IpcServer.cpp's 33ms kPositionTimerId ->
 * main's subscribeToPositionUpdates -> preload's onEnginePositionUpdate ->
 * StoreContext's SET_POS -> DiscoverPanel's usePos()). There is no
 * setInterval anywhere in radio, on purpose: the engine stops its timer on
 * "pause", so this clock stops with the transport and resumes exactly
 * where it was, for free. */
export interface RadioClock {
  /** Bars of real playback since the last change landed. Fractional.
   * RESET every time a change lands -- it is a duration, not a position. */
  barsElapsed: number
  /** The freshly-drawn target for THIS interval (nextRadioIntervalBars). */
  intervalBars: number
  /** The previous tick's position, so a wrap can be spotted as a decrease
   * -- the engine emits no loop-wrap event of any kind. */
  lastPos: number
  /** Whole laps of the loop since the last PHRASE boundary -- radio's
   * position in the phrase, as opposed to barsElapsed' duration since the
   * last change. NOT reset when a change lands (restartRadioInterval
   * carries it over); reset only when a new phrase starts, which is radio
   * starting or a course change.
   *
   * A second field here rather than a separate accumulator in the panel,
   * because it is advanced by exactly the wrap detection advanceRadioClock
   * already does. A ref beside radioClockRef would be a second thing that
   * has to be kept in step with the same event, one tick at 30Hz, and the
   * first time the two disagreed the phrase grid would silently walk. */
  lapsSincePhrase: number
  /** The lap playing, counted within the TURNAROUND's phrase (radioTurnaround.ts):
   * 0 .. turnaroundPhraseLaps - 1, advanced at every wrap. The same origin as
   * lapsSincePhrase -- the loop top radio started inside -- so on a loop that divides the
   * phrase a turnaround ends on the change grid's phrase wrap. Unlike lapsSincePhrase it runs
   * whatever phraseBars is (0 counts 16 bars): the spec's "the turnaround count must not be"
   * reset. Optional only so a clock written before it reads as lap 0; every function here
   * sets it. */
  turnaroundLap?: number
}

export function createRadioClock(intervalBars: number, startPos = 0): RadioClock {
  return { barsElapsed: 0, intervalBars, lastPos: startPos, lapsSincePhrase: 0, turnaroundLap: 0 }
}

/** A fresh interval INSIDE the phrase that is already running. What the
 * clock does when a change lands: the duration resets, the position in
 * the phrase does not.
 *
 * The distinction is the whole reason lapsSincePhrase lives on the clock.
 * createRadioClock starts a new PHRASE as well as a new interval, and is
 * therefore only correct where radio itself starts over -- switch-on, and
 * a course change (which seeks the transport to 0, so bar 0 of the new
 * phrase and bar 0 of the transport are the same instant). Every other
 * restart is this one.
 *
 * COUNTED FROM THE BOUNDARY, NOT THE TICK. `boundaryBars` is where the
 * change actually landed -- 0 for a wrap, the bar for a held mid-lap cut,
 * the grid line the due branch crossed -- and `pos` the tick that noticed
 * it, some fraction of a tick later. The new interval has already been
 * running for that difference, and it goes into barsElapsed.
 *
 * Starting it at 0 from the tick (as this did until 2026-09-30) slid every
 * interval up to a tick late. An interval that then ended exactly on a
 * boundary -- a whole-bar interval from a whole-bar landing, the ordinary
 * case -- fell on either side of it by a tick's worth of luck: when it fell
 * just past, advanceRadioClock still fired `due` there (the crossing tick
 * is past it too) while radioChangeDueAtNextWrap and radioChangeLandsAtBar,
 * reading the elapse point as past the boundary, had said the change was a
 * boundary later. Nothing had decided it early, so it went down the late
 * path: 5-15% of changes on 4- and 8-bar loops. Anchored at the boundary,
 * the elapse point is the boundary and all three agree. */
export function restartRadioInterval(
  clock: RadioClock,
  intervalBars: number,
  pos: number,
  boundaryBars: number
): RadioClock {
  const overshoot = Number.isFinite(pos - boundaryBars) ? Math.max(0, pos - boundaryBars) : 0
  return {
    barsElapsed: overshoot,
    intervalBars,
    lastPos: pos,
    lapsSincePhrase: clock.lapsSincePhrase,
    turnaroundLap: clock.turnaroundLap
  }
}

export interface RadioClockStep {
  clock: RadioClock
  /** The loop restarted between the previous tick and this one. Still
   * reported separately from `due` because gestures (drop-outs,
   * transitions) are anchored to the loop top even when a CHANGE is not --
   * see the 2026-09-28 spec's 0A.5. */
  wrapped: boolean
  /** Commit a change NOW: the interval has elapsed AND we have just
   * crossed a boundary on the change grid.
   *
   * Until 2026-09-28 this was `wrapped && ...`, i.e. the grid was always
   * the whole loop, which made the effective interval
   * ceil(intervalBars / loopBars) * loopBars -- usually a DOUBLING rather
   * than a rounding, and the cause of "radio mode seems quite slow to me".
   * The grid is a GATE, not a trigger: the interval still has to elapse
   * first, so a finer grid can never make changes more frequent than the
   * pace asked for. It only stops the pace being silently rounded up. */
  due: boolean
  /** The lap that STARTS at this wrap is the last lap of a turnaround phrase: roll the phrase
   * end's turnaround now (radioTurnaround.ts rollTurnaround). Only ever true on a wrap. */
  turnaroundLapStarts: boolean
}

/** One position tick. `loopBars` is the preview loop's own length --
 * DiscoverPanel's `maxBarLength`, which is exactly what went to the engine
 * as loopLengthBars, so the wrap this spots and the wrap the engine
 * performed are the same event. `gridBars` is radioGridBars' answer for
 * the slot that is about to change; passing loopBars reproduces the
 * pre-2026-09-28 behaviour exactly. `phraseBars` is the phrase ceiling
 * (RadioSettings.phraseBars); 0 is no phrase grid, which is the default
 * and changes nothing. */
export function advanceRadioClock(
  clock: RadioClock,
  pos: number,
  loopBars: number,
  gridBars: number = loopBars,
  phraseBars: number = 0
): RadioClockStep {
  if (!(loopBars > 0) || !Number.isFinite(pos)) {
    return { clock, wrapped: false, due: false, turnaroundLapStarts: false }
  }
  const wrapped = pos < clock.lastPos
  // Across a wrap, count the tail of the old pass as well as the head of
  // the new one -- otherwise every wrap silently loses up to a full bar.
  const delta = wrapped ? loopBars - clock.lastPos + pos : pos - clock.lastPos
  const barsElapsed = clock.barsElapsed + Math.max(0, delta)
  // A wrap is ALWAYS a boundary, because 0 is always on the grid. Between
  // wraps, a boundary is crossed when the cell index goes up.
  const step = gridBars > 0 ? gridBars : loopBars
  const crossed = wrapped || Math.floor(pos / step) > Math.floor(clock.lastPos / step)
  // The phrase, counted in laps. A phrase boundary is a LOOP TOP that is
  // a whole phrase after the last one, so the grid is a strict subset of
  // the loop tops and every phrase boundary is already a grid boundary --
  // which is why adding this gate can only ever REMOVE landings, never
  // invent one, and can never starve (there is no pair of settings where
  // the two gates miss each other forever).
  //
  // Counted whether or not a change is due: a grid is a grid. A change
  // that misses one WAITS for the next rather than being dropped --
  // dropping would make `slow` plus `32 bars` nearly silent, and a change
  // arriving a phrase late is still a change on the beat.
  const perPhrase = radioPhraseLaps(phraseBars, loopBars)
  let lapsSincePhrase = clock.lapsSincePhrase + (wrapped ? 1 : 0)
  let onPhrase = true
  if (perPhrase > 0) {
    // `wrapped &&` is not redundant: perPhrase can shrink mid-listen (a
    // longer stem resolves and the loop grows, or he changes the chip),
    // and without it a counter left above the new phrase length would
    // open a boundary in the middle of a lap.
    onPhrase = wrapped && lapsSincePhrase >= perPhrase
    if (onPhrase) lapsSincePhrase = 0
  } else {
    lapsSincePhrase = 0
  }
  // The turnaround's own count: every wrap, whatever phraseBars is, folding back to 0 at the
  // phrase end (and from anywhere above the phrase, should the loop have grown under it).
  const perTurnaround = turnaroundPhraseLaps(phraseBars, loopBars)
  let turnaroundLap = clock.turnaroundLap ?? 0
  if (wrapped) {
    turnaroundLap += 1
    if (turnaroundLap >= perTurnaround) turnaroundLap = 0
  }
  return {
    clock: { ...clock, barsElapsed, lastPos: pos, lapsSincePhrase, turnaroundLap },
    wrapped,
    due: crossed && onPhrase && barsElapsed >= clock.intervalBars,
    turnaroundLapStarts: wrapped && turnaroundLap === perTurnaround - 1
  }
}

/** Floating-point slack for the boundary arithmetic below. `pos` is a
 * float sum of ~30Hz deltas coming off a wall clock, so a boundary the
 * transport is about to cross can read as a hair short of it; a bar is
 * two seconds at 120bpm, so a thousandth of a bar is well under a
 * millisecond and cannot move a decision that matters. */
const BOUNDARY_EPSILON = 1e-9

/** Will the next change come due at the wrap that ends THIS lap, and at no
 * boundary before it?
 *
 * The predicate the staged swap is built on, and the reason a scheduled
 * swap is worth anything at all. `stage-project` makes the engine apply a
 * project at the next loop top, so the renderer has to push it DURING the
 * lap that ends at that loop top: a push a whole interval early would be
 * taken by the wrong wrap, and a push at the wrap itself is the late-by-
 * construction chain this whole feature exists to get off the critical
 * path (see the 2026-09-29 radio-staged-swap spec, and the measurement in
 * `radio-swap-is-late-by-construction`).
 *
 * WHY A PREDICTION RATHER THAN A HOLD. Radio already knows a lap in
 * advance about the changes it deliberately holds back for a gesture
 * (radioLedChangeRef). Those are the minority: on Elling's own archive's
 * bar-length distribution, simulated against these very functions, only
 * about 23% of changes are held that way, while about 63% come due AT a
 * wrap and are decided on the tick that discovers it -- zero lead time,
 * nothing to stage. Predicting the wrap is what turns "a quarter of
 * changes get better" into "six in seven do".
 *
 * Mirrors advanceRadioClock's own arithmetic exactly, and there is a
 * property test pinning the two together over a grid of starting
 * positions: whenever this says yes, running the clock forward at 30Hz
 * really does produce `due` on the wrap tick and on no tick before it.
 * They must not be able to drift apart -- a yes that turns out to be a
 * mid-loop landing would fire a staged project a whole lap late, which is
 * worse than the lateness it is replacing.
 *
 * `clock` is the clock as of THIS tick (advanceRadioClock's own answer),
 * `pos` the position it was stepped to. The other three are the same
 * arguments advanceRadioClock takes and mean the same things. */
export function radioChangeDueAtNextWrap(
  clock: RadioClock,
  pos: number,
  loopBars: number,
  gridBars: number,
  phraseBars: number
): boolean {
  if (!(loopBars > 0) || !Number.isFinite(pos) || pos < 0 || pos >= loopBars) return false
  const barsToWrap = loopBars - pos
  // How much of the interval is still to run. Already negative (the
  // interval elapsed while something else was holding the change) counts
  // as zero -- it is due at the very next boundary either way.
  const barsToElapse = Math.max(0, clock.intervalBars - clock.barsElapsed)
  // The interval has to run out before the wrap, or this lap is not the
  // one. Equality counts: a change whose interval ends exactly at the
  // wrap comes due on the wrap tick.
  if (barsToElapse > barsToWrap + BOUNDARY_EPSILON) return false
  // A phrase grid makes every landing a loop top -- advanceRadioClock's
  // `onPhrase` is gated on `wrapped` -- so the change grid cannot pull
  // this change any earlier, and the only remaining question is whether
  // the coming wrap is the phrase boundary. A lap that is not one holds
  // the change over, and the next lap asks again.
  const perPhrase = radioPhraseLaps(phraseBars, loopBars)
  if (perPhrase > 0) return clock.lapsSincePhrase + 1 >= perPhrase
  // Where in the lap the interval runs out, and then the first boundary
  // the clock will CROSS at or after that -- `crossed` fires on the tick
  // that carries the position over a multiple of the grid, so a boundary
  // sitting exactly on the elapse point still counts as ahead of us.
  const step = gridBars > 0 ? gridBars : loopBars
  const elapseAt = pos + barsToElapse
  // Two floors, because a crossing has to be ahead of BOTH: ahead of the
  // playhead (a boundary we are standing on was crossed on some earlier
  // tick and will not be crossed again), and at or past the point the
  // interval runs out.
  const afterPos = (Math.floor(pos / step + BOUNDARY_EPSILON) + 1) * step
  const afterElapse = Math.ceil(elapseAt / step - BOUNDARY_EPSILON) * step
  const nextBoundary = Math.max(afterPos, afterElapse)
  // The wrap is the only boundary at or past the end of the lap.
  return nextBoundary >= loopBars - BOUNDARY_EPSILON
}

/** How many bars from NOW until the next change actually LANDS, or null
 * when that is not knowable yet (no loop length, no position).
 *
 * THE COUNTDOWN THAT CANNOT DISAGREE WITH THE CLOCK. Radio's own interval
 * (`intervalBars`) is the EARLIEST a change may happen, never when it
 * happens: advanceRadioClock fires `due` only when the interval has
 * elapsed AND a boundary on the change grid is crossed AND the phrase
 * gate is open. Counting down the interval therefore reaches zero and
 * then sits there for however many bars the real wait still has to run --
 * reported 2026-09-29, on the row indicator built from exactly that
 * number: "this one says 'this bar' but continues to loop for a few more
 * times? it's not clear to me."
 *
 * So this counts to the BOUNDARY, derived from the same four inputs
 * advanceRadioClock uses, in the same arithmetic, with the same epsilon.
 * radioChangeDueAtNextWrap is the yes/no special case of it -- "is that
 * boundary the wrap ending this lap" -- and the two are pinned to each
 * other and to advanceRadioClock by property tests.
 *
 * ALWAYS GREATER THAN ZERO while a change is still to come: every
 * candidate boundary is strictly ahead of `pos`, because a boundary the
 * playhead is standing on was crossed on an earlier tick and will not be
 * crossed again. Zero means zero, and a caller that rounds up
 * (radioApproachBarsLeft) can say "1 bar" knowing the change really is
 * still ahead of it.
 *
 * HONEST WHEN IT IS OVERRUN. Nothing here remembers a prediction, so
 * there is nothing to go stale: the moment the playhead passes a boundary
 * the change did not land on -- a gesture was holding one
 * (radioLedChangeRef), a late eligibility re-check dropped the pick, the
 * pick never resolved -- the next call simply answers with the next real
 * boundary. */
export function radioBarsUntilChange(
  clock: RadioClock,
  pos: number,
  loopBars: number,
  gridBars: number,
  phraseBars: number
): number | null {
  if (!(loopBars > 0) || !Number.isFinite(pos) || pos < 0 || pos >= loopBars) return null
  // How much of the interval is still to run. Already negative (it ran out
  // while something else was holding the change) counts as zero -- the
  // change is due at the very next boundary either way.
  const barsToElapse = Math.max(0, clock.intervalBars - clock.barsElapsed)
  if (!Number.isFinite(barsToElapse)) return null
  const elapseAt = pos + barsToElapse
  const perPhrase = radioPhraseLaps(phraseBars, loopBars)
  if (perPhrase > 0) {
    // A phrase grid makes every landing a loop top, so the only question
    // is WHICH loop top: the next one that is a whole phrase after the
    // last, and then every phrase after that until the interval has had
    // room to run out. advanceRadioClock increments lapsSincePhrase and
    // THEN tests it, so the wrap ending this lap is lap 1.
    let laps = Math.max(1, perPhrase - clock.lapsSincePhrase)
    if (laps * loopBars < elapseAt - BOUNDARY_EPSILON) {
      laps += Math.ceil((elapseAt / loopBars - laps) / perPhrase - BOUNDARY_EPSILON) * perPhrase
    }
    return laps * loopBars - pos
  }
  // Two floors, the same pair radioChangeDueAtNextWrap takes: a crossing
  // has to be ahead of the playhead AND at or past the point the interval
  // runs out.
  //
  // NO EPSILON ON THE FIRST ONE, and that is not an oversight -- it is
  // the exact mirror of advanceRadioClock's `Math.floor(pos / step) >
  // Math.floor(clock.lastPos / step)`, which has none either. Nudging it
  // by a billionth reads a boundary the clock has NOT yet crossed as
  // already behind us, and a `pos` that arrives as 3.999999999998 instead
  // of 4 (it does -- it is an accumulated sum of 30Hz deltas) would then
  // count a whole grid cell that the very next tick is about to spend.
  // Measured: that put the countdown a full two bars out for one tick,
  // immediately before the landing. radioChangeDueAtNextWrap can afford
  // the slack because it only answers yes or no about the wrap; a number
  // on screen cannot.
  const step = gridBars > 0 ? gridBars : loopBars
  const grid = Math.max(
    (Math.floor(pos / step) + 1) * step,
    Math.ceil(elapseAt / step - BOUNDARY_EPSILON) * step
  )
  // A wrap is ALWAYS a boundary, whether or not the grid divides the loop
  // -- advanceRadioClock's `crossed` starts with `wrapped ||`. radioGridBars
  // steps a cycle down to a divisor precisely so the two agree, but this
  // must not depend on it: a grid that did not divide the loop would put a
  // wrap ahead of the grid's own next multiple, and the wrap is the one
  // that would fire.
  const wrap = Math.max(loopBars, Math.ceil(elapseAt / loopBars - BOUNDARY_EPSILON) * loopBars)
  return Math.min(grid, wrap) - pos
}

/** WHICH BAR of this lap the next change lands on, when that is not the
 * wrap -- or null when it is the wrap, when it is in some later lap, or
 * when it is not knowable at all.
 *
 * The other half of radioChangeDueAtNextWrap, and the last gap in radio's
 * scheduled swap. That predicate covers every change that lands on a loop
 * top, which measured out at nineteen in twenty. The twentieth is a bare
 * `cut` on a layer of DEFAULT_RADIO_LOOP_END_BARS bars or fewer, turning
 * over on its own 2- or 4-bar boundary (radioGridBars) -- the eagerness
 * Elling asked for, and the only population that could not be staged at
 * all, because the engine could only ever apply a staged project at a
 * wrap. Those still went out as an ordinary load-project and still landed
 * 20-65ms past the boundary they were aimed at.
 *
 * The engine can now be asked for a bar (stage-project's `atBars`, and
 * Transport::setStagedApplyAtBars behind it), so the renderer needs to be
 * able to name one, and this is that. Deliberately NOT new arithmetic:
 * radioBarsUntilChange already counts to the real landing boundary from
 * the same four inputs advanceRadioClock uses, with the same epsilons and
 * pinned to it by property test. This is that answer read as an absolute
 * bar, and then only kept when it falls strictly inside the lap.
 *
 * NEVER TRUE AT THE SAME TIME AS radioChangeDueAtNextWrap -- a tick where
 * both answered would stage one project at two different instants. The
 * two are pinned to each other by test, and the caller asks the wrap
 * first anyway, so the nineteen in twenty keep exactly the path they
 * already had.
 *
 * A bar it names is strictly ahead of `pos`: every candidate boundary
 * radioBarsUntilChange can return is (see its own "ALWAYS GREATER THAN
 * ZERO" note), which is also what the engine requires -- a bar already
 * behind the playhead is refused there (Transport::barsUntilBar) and
 * falls back to an immediate load-project rather than being read as the
 * same bar one lap later. */
export function radioChangeLandsAtBar(
  clock: RadioClock,
  pos: number,
  loopBars: number,
  gridBars: number,
  phraseBars: number
): number | null {
  const until = radioBarsUntilChange(clock, pos, loopBars, gridBars, phraseBars)
  if (until === null) return null
  const landsAt = pos + until
  // The wrap, or beyond it. The wrap belongs to radioChangeDueAtNextWrap
  // and the engine lands it exactly without being told a bar; anything
  // past it is a later lap, which the renderer cannot aim at yet because
  // a staged project is taken by the first boundary that comes.
  if (landsAt >= loopBars - BOUNDARY_EPSILON) return null
  return landsAt
}

export interface RadioPickOptions {
  /** `even` biases toward the least-recently-changed; `random` is the
   * memoryless draw that shipped 2026-09-26. Omitted behaves as `random`,
   * which is what keeps every pre-existing caller unchanged. */
  turnover?: RadioTurnover
  /** The logical turn at which each slot last changed. NOT wall time -- it
   * increments once per committed change, so it stops with the transport
   * for free, exactly like the clock does. */
  changedAt?: ReadonlyMap<string, number>
  /** The current turn number. */
  turn?: number
  /** The row's two radio controls, hold longer (hook) and change next
   * (replace-soon). See
   * radioSlotFlags.ts, which owns both factors and the arguments for
   * them. */
  flags?: RadioSlotFlags
  random?: () => number
}

/** Which single layer turns over next.
 *
 * ONE at a time is the whole point (spec 3.1): everything changing
 * together is just a new loop on a timer, while one at a time lets a bed
 * you recognise evolve under you.
 *
 * `eligible` is decided by the caller through isRadioEligibleSlot --
 * unlocked, audible, already holding a candidate, not mid-reroll. NOTHING
 * HERE ADDS OR REMOVES AN ELIGIBILITY CONDITION; it only weights WITHIN
 * that set, which is also why the padlock beats both flags without a line
 * of code saying so: a locked slot never reaches this function.
 *
 * Under `even` the draw is weighted by STALENESS rather than rotated
 * (spec 6.3). Strict round-robin is audible -- four layers turning over in
 * the same order forever is a pattern, and a pattern is exactly what the
 * pace windows exist to avoid -- so:
 *
 *     staleness(id) = turn - (changedAt.get(id) ?? turn)
 *     weight(id)    = (staleness(id) + 1) * factor(flags[id])
 *
 * A slot that just changed weighs 1; one that has waited six turns weighs
 * 7. The longer a drought runs the harder it works against itself, so
 * droughts get short without any single turn ever becoming certain.
 * `random` is the same machinery with every base weight pinned to 1 -- one
 * code path, one set of tests.
 *
 * An UNKNOWN id counts as "just changed" (`?? turn`, weight 1). That is
 * correct rather than convenient: addSlot performs a new slot's own first
 * roll, so a slot radio has never touched has in fact just changed. The
 * map needs no seeding and a cold start falls back to a uniform draw.
 *
 * "Never the same one twice running" survives from the shipped version.
 * Under `even` the last-changed slot already carries the lowest weight,
 * but the hard exclusion is free, removing it is a change nobody asked
 * for, and it is what stops a `replace-soon` layer from strobing in the
 * one turn before its flag is cleared.
 *
 * Returns null only for an empty list, which is radio idling rather than
 * an error: everything locked is a legitimate state and radio simply
 * retries at the next boundary. Never mutates its arguments. */
export function pickRadioSlotId(
  eligible: readonly string[],
  lastChangedId: string | null,
  options: RadioPickOptions | (() => number) = {}
): string | null {
  // The shipped signature took `random` as the third argument. Accepting
  // both keeps every existing caller and test working unchanged.
  const opts: RadioPickOptions = typeof options === 'function' ? { random: options } : options
  const random = opts.random ?? Math.random
  const turnover = opts.turnover ?? 'random'
  const turn = opts.turn ?? 0

  if (eligible.length === 0) return null
  const pool = eligible.length > 1 ? eligible.filter((id) => id !== lastChangedId) : eligible
  const choices = pool.length > 0 ? pool : eligible
  if (choices.length === 1) return choices[0]

  const weights = choices.map((id) => {
    const base = turnover === 'even' ? Math.max(0, turn - (opts.changedAt?.get(id) ?? turn)) + 1 : 1
    return base * radioSlotFlagWeightFactor(opts.flags ? (opts.flags[id] ?? null) : null)
  })
  const total = weights.reduce((sum, w) => sum + w, 0)
  // Defensive: every factor is positive and every base is at least 1, so
  // this cannot be reached today. It costs one branch and it means a
  // future factor of zero degrades to a uniform draw rather than to an
  // undefined return.
  if (!(total > 0)) {
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]
  }
  let draw = random() * total
  for (let i = 0; i < choices.length; i++) {
    draw -= weights[i]
    if (draw < 0) return choices[i]
  }
  return choices[choices.length - 1]
}

/** One layer's state, as far as radio's eligibility cares. */
export interface RadioSlotEligibility {
  locked: boolean
  /** In the preview mix -- a muted layer is not part of what he is
   * listening to, so changing it would be a change he cannot hear. */
  audible: boolean
  hasCandidate: boolean
  /** A slot seeded from a rifff or the shelf carries a resolved stem and
   * NO candidate until it is first rerolled. */
  hasSeedStem: boolean
  rerolling: boolean
}

/** Whether radio may turn this layer over.
 *
 * Live report, 2026-09-28: "if i start radio with stems already there..
 * it seems to not transition". Radio's own filter tested
 * `s.candidate !== null`, which is false for every slot seeded from a
 * rifff or the shelf and never since rerolled -- so starting radio on a
 * loop he had already built made every layer ineligible and radio idled
 * forever, doing nothing, with no way to tell it apart from a long
 * interval.
 *
 * A seedStem IS a fully resolved stem; it is simply held in a different
 * field. resolveDiscoverRifff hit this exact bug on 2026-09-16 (see its
 * own comment) and fixed it the same way. Living here, in shared, rather
 * than as a filter inline in the component, is so the next thing that
 * needs to ask "may radio touch this layer" cannot get a third answer. */
export function isRadioEligibleSlot(slot: RadioSlotEligibility): boolean {
  if (slot.locked) return false
  if (!slot.audible) return false
  if (slot.rerolling) return false
  return slot.hasCandidate || slot.hasSeedStem
}

/** A pace as a pair of numbers rather than a word -- Elling, 2026-09-28:
 * "maybe allow for a specific range selection instead of just slow mid
 * and fast?". The three presets stay as the starting points (and as what
 * the start prompt offers); this is where he settles once one of them is
 * nearly right. */
export interface RadioPaceWindow {
  min: number
  max: number
}

/** One bar at the tightest -- below that a change lands before the last
 * one has finished arriving. Sixty-four at the loosest: over two minutes
 * at 120bpm, further out than `slow` goes and further than anything he
 * has asked for. */
export const RADIO_PACE_WINDOW_MIN = 1
export const RADIO_PACE_WINDOW_MAX = 64

function clampPaceBar(value: number): number {
  return Math.min(RADIO_PACE_WINDOW_MAX, Math.max(RADIO_PACE_WINDOW_MIN, Math.floor(value)))
}

/** Anything unusable falls back to the named preset's own window, so a
 * settings file written before this field existed (or hand-edited into
 * nonsense) still describes a pace rather than throwing. A crossed-over
 * window collapses onto its min. */
export function normalizeRadioPaceWindow(value: unknown, pace: RadioPace): RadioPaceWindow {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<RadioPaceWindow>
  const min = Number(raw.min)
  const max = Number(raw.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ...RADIO_PACE_BARS[pace] }
  const lo = clampPaceBar(min)
  return { min: lo, max: Math.max(lo, clampPaceBar(max)) }
}

/** Which preset a window IS, or null for one he tuned by hand. The menu
 * lights a pace chip from this rather than from the stored `pace`, so a
 * hand-tuned window does not keep claiming to be `mid`. */
export function radioPaceWindowPreset(window: RadioPaceWindow): RadioPace | null {
  return (
    RADIO_PACE_OPTIONS.find(
      (p) => RADIO_PACE_BARS[p].min === window.min && RADIO_PACE_BARS[p].max === window.max
    ) ?? null
  )
}

/** One stepper press. Pushing an edge past the other drags the other with
 * it rather than inverting the window -- an inverted window draws no
 * interval at all, and there is no reading of the gesture where that is
 * what he meant. */
export function adjustRadioPaceWindow(
  window: RadioPaceWindow,
  edge: 'min' | 'max',
  delta: number
): RadioPaceWindow {
  if (edge === 'min') {
    const min = clampPaceBar(window.min + delta)
    return { min, max: Math.max(min, window.max) }
  }
  const max = clampPaceBar(window.max + delta)
  return { min: Math.min(window.min, max), max }
}

/** A fresh whole number of bars to wait, drawn uniformly across a window
 * (both ends inclusive). nextRadioIntervalBars is this with a preset's own
 * numbers -- one draw, two ways of naming the window. */
export function nextRadioIntervalBarsInWindow(
  window: RadioPaceWindow,
  random: () => number = Math.random
): number {
  const span = Math.max(1, window.max - window.min + 1)
  const offset = Math.min(span - 1, Math.floor(random() * span))
  return window.min + offset
}

/** How radio chooses WHICH layer turns over. `even` biases toward the
 * least-recently-changed; `random` is the memoryless draw that shipped
 * 2026-09-26. Elling hit a ~4.7-minute drought with the latter on
 * 2026-09-28 -- "this is good for consistency but i'd love to have some
 * control" -- so `random` is kept as a choice rather than removed.
 *
 * NOTHING READS THIS YET. The weighting is phase D; only the field and
 * its migration ship here, so the settings file is written once. */
export type RadioTurnover = 'even' | 'random'

export const RADIO_TURNOVER_OPTIONS: RadioTurnover[] = ['even', 'random']

/** `even`. A five-minute hold nobody asked for reads as broken, and the
 * deliberate way to hold a layer is the hook. More channels makes the
 * drought worse (one change per interval across six layers is half the
 * rate of three), which is the strongest argument for this default. */
export const DEFAULT_RADIO_TURNOVER: RadioTurnover = 'even'

export function normalizeRadioTurnover(value: unknown): RadioTurnover {
  return RADIO_TURNOVER_OPTIONS.includes(value as RadioTurnover)
    ? (value as RadioTurnover)
    : DEFAULT_RADIO_TURNOVER
}

/** How many layers radio lays down when started on an EMPTY panel.
 * Elling, 2026-09-28: "see if more channels are feasible.. lots ideally...
 * but maybe slider up to 8?".
 *
 * This is NOT a cap on Discover. addSlot has no cap and never has -- he
 * ran twelve slots the same day -- and nothing here adds one. It is only
 * the size of the starting bed.
 *
 * Lowered to 2 later the same day: "can we adjust settings to include 2
 * and 3 stems only". The starter order already makes both musical without
 * a special case -- 2 is drums and bass, 3 adds the lead -- which is why
 * that order's own comment insists every PREFIX has to sound like a band.
 *
 * One consequence worth knowing rather than discovering: at 2 channels a
 * drop-out leaves a single layer playing. pickDropOutSlotId already
 * refuses below two audible slots, so it cannot make silence, but a
 * two-channel bed is the one place the gesture is as likely to sound
 * like a fault as a decision. */
export const RADIO_CHANNELS_MIN = 2
export const RADIO_CHANNELS_MAX = 8

/** Four, NOT the minimum. These were the same constant until the floor
 * dropped to 2, at which point reusing it would have quietly changed the
 * starting bed from a band to a duo -- a default nobody asked to move,
 * changed as a side effect of adding an option. Four is still "the
 * smallest thing that sounds like a band"; 2 and 3 are choices. */
export const DEFAULT_RADIO_CHANNELS = 4

/** The bed, in the order it grows. Every PREFIX has to sound like a band
 * on its own, because the chip row grows it from the left:
 *   1-4  the shipped set -- the smallest thing that sounds like a band
 *   5    a SECOND drum layer: a groove gets its top end from hats and
 *        perc over the kick-and-snare bed. Biggest gain per slot.
 *   6    bright -- the counterweight to warm; a high end that is not the
 *        lead
 *   7    rhythmic -- a texture chosen for MOVEMENT rather than instrument,
 *        filling the space between the bed and the lead
 *   8    a second lead -- a counter-line. Two melodic voices, not two
 *        basses: two basses fight, two leads converse. The dedupe pass in
 *        pickForSlot keeps it from drawing the same stem. */
const RADIO_STARTER_ORDER: DiscoverSlotKind[] = [
  'drums',
  'bass',
  'lead',
  'warm',
  'drums',
  'bright',
  'rhythmic',
  'lead'
]

export function radioStarterKinds(channels: number): DiscoverSlotKind[] {
  const n = Math.min(
    RADIO_CHANNELS_MAX,
    Math.max(RADIO_CHANNELS_MIN, Math.floor(Number(channels) || 0))
  )
  return RADIO_STARTER_ORDER.slice(0, n)
}

/** Everything the radio menu sets, in one object rather than seven flat
 * fields on DiscoverSettings.
 *
 * Nested because the alternative is threading seven pairs of props through
 * App.tsx -> LibraryBrowser.tsx -> DiscoverPanel.tsx, which is fourteen
 * props for what is one concept. `reach` and `character` are deliberately
 * absent: they ship in their own plans (spec 10, phases F and G) and a
 * field nothing reads is a lie.
 *
 * `pace` and `paceBars` are not a duplicate pair. `pace` is the preset he
 * last chose -- what the start prompt offers and what a course change
 * resets to. `paceBars` is the window the clock actually draws from, which
 * starts life as that preset's own numbers and diverges only if he steps
 * an edge. radioPaceWindowPreset reconciles the two for display. */
/** The density arc (radioDensity.ts): `arc` grows and thins the rows while
 * radio runs; `off` keeps the count where it is. Elling likes it on. */
export type RadioDensity = 'off' | 'arc'
export const RADIO_DENSITY_OPTIONS: RadioDensity[] = ['off', 'arc']
export const DEFAULT_RADIO_DENSITY: RadioDensity = 'arc'
export function normalizeRadioDensity(value: unknown): RadioDensity {
  return value === 'off' || value === 'arc' ? value : DEFAULT_RADIO_DENSITY
}

export interface RadioSettings {
  pace: RadioPace
  paceBars: RadioPaceWindow
  loopEndOverBars: number
  phraseBars: number
  channels: number
  transitions: RadioTransitions
  /** How often a phrase end gets a turnaround (radioTurnaround.ts). Absorbed the old
   * `dropOuts` row (2026-10-02). */
  turnarounds: RadioTurnarounds
  /** DEPRECATED: equal to `turnarounds` (normalizeRadioSettings keeps it so). Kept only while
   * the shipped DiscoverRadioMenu and DiscoverPanel still read and write it -- the radio
   * turnarounds plan's Task 14 moves them over, and its Task 16 deletes this field. */
  dropOuts: RadioDropOuts
  turnover: RadioTurnover
  /** Optional only because the web radio builds its own RadioSettings and
   * has its own arc; normalizeRadioSettings always sets it, and absent
   * reads as the default (radioDensityOf). */
  density?: RadioDensity
}

export function radioDensityOf(settings: RadioSettings): RadioDensity {
  return settings.density ?? DEFAULT_RADIO_DENSITY
}

export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
  pace: DEFAULT_RADIO_PACE,
  paceBars: { ...RADIO_PACE_BARS[DEFAULT_RADIO_PACE] },
  loopEndOverBars: DEFAULT_RADIO_LOOP_END_BARS,
  phraseBars: DEFAULT_RADIO_PHRASE_BARS,
  channels: DEFAULT_RADIO_CHANNELS,
  transitions: DEFAULT_RADIO_TRANSITIONS,
  turnarounds: DEFAULT_RADIO_TURNAROUNDS,
  dropOuts: DEFAULT_RADIO_TURNAROUNDS,
  turnover: DEFAULT_RADIO_TURNOVER,
  density: DEFAULT_RADIO_DENSITY
}

/** Field by field, never throwing -- the same shape loadDiscoverSettings
 * already uses for traitMatchBar and radioPace.
 *
 * `legacyPace` is the MIGRATION. Anyone running 1.3.0 has a flat
 * `radioPace` on disk and no `radio` object, and their chosen pace must
 * survive the move rather than silently resetting to mid -- and it has to
 * bring a window with it, since the window is what the clock draws from.
 * An explicit `radio.pace` always wins over it.
 *
 * `grid` is the other migration, and it lives inline below because it is
 * a field of THIS object rather than a flat sibling: anyone running 1.3.x
 * has a `change on` word where the threshold now goes, and it has to keep
 * meaning what it meant. See LEGACY_RADIO_GRID_BARS. */
export function normalizeRadioSettings(value: unknown, legacyPace?: unknown): RadioSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<RadioSettings>
  const pace =
    raw.pace !== undefined ? normalizeRadioPace(raw.pace) : normalizeRadioPace(legacyPace)
  const channels = Number(raw.channels)
  // Turnarounds absorbed drop-outs. Until the plan's Task 16 the shipped menu writes only
  // `dropOuts`, so it is read FIRST -- whenever the two differ it is the newer -- and
  // `turnarounds` is the fallback. Task 16 flips this to the spec's order.
  const turnarounds = normalizeRadioTurnarounds(raw.dropOuts, raw.turnarounds)
  return {
    pace,
    paceBars: normalizeRadioPaceWindow(raw.paceBars, pace),
    loopEndOverBars: normalizeRadioLoopEndBars(
      raw.loopEndOverBars,
      (value as { grid?: unknown } | null)?.grid
    ),
    phraseBars: normalizeRadioPhraseBars(raw.phraseBars),
    // A number out of range is a clamp; something that is not a number at
    // all is no answer, so it takes the default rather than the floor.
    // Those were the same constant until 2026-09-28 and the difference did
    // not matter; it does now that the floor is 2.
    channels: Number.isFinite(channels)
      ? Math.min(RADIO_CHANNELS_MAX, Math.max(RADIO_CHANNELS_MIN, Math.floor(channels)))
      : DEFAULT_RADIO_CHANNELS,
    transitions: normalizeRadioTransitions(raw.transitions),
    turnarounds,
    dropOuts: turnarounds,
    turnover: normalizeRadioTurnover(raw.turnover),
    density: normalizeRadioDensity(raw.density)
  }
}
