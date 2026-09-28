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
 * RETUNED 2026-09-28. The old windows (24-48 / 12-24 / 6-12) were chosen
 * while advanceRadioClock was silently rounding every one of them UP to
 * the next whole multiple of the loop length -- at 120bpm with an 8-bar
 * loop, `mid` could only ever produce 32s or 48s, and `fast` could only
 * produce 16s or 32s. Elling, 2026-09-28: "radio mode seems quite slow to
 * me". Now that radioGridBars below lets a change land on the changing
 * slot's own cycle, the numbers finally describe the behaviour, so the
 * whole ladder moves down one notch and gains a genuinely fast bottom
 * rung. A clean 3x ladder with a 2:1 window at every step.
 *
 * At 120bpm in 4/4 (2s a bar): slow = 36-72s, mid = 12-24s, fast = 4-8s. */
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

/** Where a change is ALLOWED to land -- not how often one happens. The five
 * options and their exact words are the phone's (remotePage.ts's
 * SWAP_GRIDS, commit e0abb0e); two surfaces doing the same thing should
 * say it the same way, and re-labelling shipped copy is churn.
 *
 * Literal values double as their own UI text, the same convention
 * RadioPace and DISCOVER_SLOT_KIND_OPTIONS use, so there is no label
 * table. */
export type RadioGrid = 'own loop' | 'loop end' | '8 bars' | '4 bars' | '2 bars'

export const RADIO_GRID_OPTIONS: RadioGrid[] = [
  'own loop',
  'loop end',
  '8 bars',
  '4 bars',
  '2 bars'
]

/** `loop end`. This was briefly `own loop` on 2026-09-28 and came back
 * within the hour, because listening found the thing the arithmetic had
 * missed.
 *
 * `own loop` was reasoned about entirely from the OUTGOING stem: let a
 * layer turn over on its own cycle and you never cut it mid-phrase. True,
 * and beside the point. The transport does not stop for a change --
 * `load-project` deliberately never resets position (IpcServer.cpp) -- so
 * the INCOMING stem does not start at its own beginning. It drops in at
 * whatever phase the transport happens to be at. A change landing at bar 4
 * of an 8-bar loop puts an 8-bar stem in halfway through itself.
 *
 * That is a worse cut than the one `own loop` prevents, and no fade on the
 * outgoing layer would hide it. Elling, listening: "so two things need to
 * happen: transition on the proper bar, and transition on the loop end"
 * -- and then, on why: "so it feels in time".
 *
 * At the loop top those two stop being separate requirements. The
 * transport wraps there, so every stem is simultaneously at its own zero:
 * the outgoing one has finished a whole cycle and the incoming one starts
 * at its beginning. One rule buys both, which is why it is the default
 * rather than the cautious option.
 *
 * The grid itself stays -- it is tested, and the menu can offer the
 * restless version to anyone who wants a layer flicking over mid-loop.
 * What it stops being is the default.
 *
 * The cost, stated so nobody "fixes" it later: an interval again rounds up
 * to the next loop top, so a pace is "at least N bars, then the next loop
 * top" rather than exactly N. That is honest and explicable, and it is
 * worth it. The pace retune of the same day is what keeps this from being
 * slow again -- on an 8-bar loop `mid` now lands at 16s or 32s, averaging
 * about 30s, against the 32-48s that started this. */
export const DEFAULT_RADIO_GRID: RadioGrid = 'loop end'

export function normalizeRadioGrid(value: unknown): RadioGrid {
  return RADIO_GRID_OPTIONS.includes(value as RadioGrid) ? (value as RadioGrid) : DEFAULT_RADIO_GRID
}

/** Longer than this and a stem changes only at the top of the whole loop,
 * never on its own shorter cycle. Eight bars is the boundary he named, and
 * it matches the material: Endlesss loops are commonly 1, 2, 4 or 8 bars,
 * so this leaves every ordinary layer free to turn over on its own cycle
 * and catches only the long phrases -- the ones with a shape the ear is
 * still following when the change lands. */
export const GRID_LONG_PHRASE_BARS = 8

/** How many bars apart the boundaries a change may land on are.
 *
 * `loopBars` is the preview loop's own length (DiscoverPanel's
 * maxBarLength, which is what went to the engine as loopLengthBars).
 * `slotBars` is the CHANGING slot's own bar length, or null when nothing
 * has resolved it yet.
 *
 * Two edges, both settled on the phone (remotePage.ts:995-1007) and not
 * re-litigated here:
 *   - a grid longer than the loop is capped to the loop;
 *   - a grid that does not divide the loop steps DOWN to the largest
 *     divisor, so every boundary is the same place in the phrase on every
 *     cycle and the downbeats stay where they were. It can never step
 *     below 1, which divides everything.
 *
 * Anything without a whole positive bar count falls back to the whole
 * loop -- which is exactly the behaviour that shipped 2026-09-26, so the
 * fallback can never be worse than what is already out there. A
 * fractional slot length (2.5 bars) is one of those: flooring it to 2
 * would invent a boundary the stem does not actually have. */
export function radioGridBars(grid: RadioGrid, loopBars: number, slotBars: number | null): number {
  if (!(loopBars > 0)) return loopBars
  if (grid === 'loop end') return loopBars
  const requested = grid === 'own loop' ? slotBars : Number.parseInt(grid, 10)
  if (requested === null || !Number.isInteger(requested) || requested < 1) return loopBars
  if (!Number.isInteger(loopBars)) return loopBars
  // Reported while listening (2026-09-28): "it cut off just now... can the
  // transitions for the stems longer than 8 bars be the complete loop
  // only?"
  //
  // A short layer turning over on its own cycle is unremarkable -- a
  // two-bar hat changing at bar 2 of 8 reads as a variation, which is the
  // whole point of the grid. A long phrase is a musical statement, and
  // replacing one partway through the loop is audible however cleanly the
  // boundary is hit: the ear is still following the phrase, so the change
  // lands as an interruption rather than an arrival.
  //
  // So anything longer than this gets the whole loop, which is where the
  // ear expects a section to end anyway. Note this is deliberately about
  // the LENGTH asked for, not about where it came from -- he asked it of
  // "the transitions", so an explicitly chosen long grid gets it too.
  if (requested > GRID_LONG_PHRASE_BARS) return loopBars
  let step = requested
  if (step > loopBars) step = loopBars
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
  /** Bars of real playback since the last change landed. Fractional. */
  barsElapsed: number
  /** The freshly-drawn target for THIS interval (nextRadioIntervalBars). */
  intervalBars: number
  /** The previous tick's position, so a wrap can be spotted as a decrease
   * -- the engine emits no loop-wrap event of any kind. */
  lastPos: number
}

export function createRadioClock(intervalBars: number, startPos = 0): RadioClock {
  return { barsElapsed: 0, intervalBars, lastPos: startPos }
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
}

/** One position tick. `loopBars` is the preview loop's own length --
 * DiscoverPanel's `maxBarLength`, which is exactly what went to the engine
 * as loopLengthBars, so the wrap this spots and the wrap the engine
 * performed are the same event. `gridBars` is radioGridBars' answer for
 * the slot that is about to change; passing loopBars reproduces the
 * pre-2026-09-28 behaviour exactly. */
export function advanceRadioClock(
  clock: RadioClock,
  pos: number,
  loopBars: number,
  gridBars: number = loopBars
): RadioClockStep {
  if (!(loopBars > 0) || !Number.isFinite(pos)) {
    return { clock, wrapped: false, due: false }
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
  return {
    clock: { ...clock, barsElapsed, lastPos: pos },
    wrapped,
    due: crossed && barsElapsed >= clock.intervalBars
  }
}

/** Which single layer turns over next.
 *
 * ONE at a time is the whole point (spec 3.1): everything changing
 * together is just a new loop on a timer, while one at a time lets a bed
 * you recognise evolve under you.
 *
 * `eligible` is decided by the caller -- unlocked, audible, already
 * holding a candidate, not mid-reroll. The only rule here is "not the same
 * one twice running", which is enough variety without a rotation nobody
 * asked for (a least-recently-changed order is an explicit "not now").
 * Returns null only for an empty list, which is radio idling rather than
 * an error: everything locked is a legitimate state and radio simply
 * retries at the next boundary. */
export function pickRadioSlotId(
  eligible: readonly string[],
  lastChangedId: string | null,
  random: () => number = Math.random
): string | null {
  if (eligible.length === 0) return null
  const pool = eligible.length > 1 ? eligible.filter((id) => id !== lastChangedId) : eligible
  const choices = pool.length > 0 ? pool : eligible
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length))
  return choices[index]
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
