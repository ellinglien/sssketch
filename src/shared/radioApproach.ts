// src/shared/radioApproach.ts
//
// WHAT A ROW SAYS WHILE RADIO IS ABOUT TO CHANGE IT.
//
// Direct report, 2026-09-29, listening on radio: "i don't see any
// preparatory blinking on the channels about to transition... it seems to
// make sense to have that in the ui... like, 'this one is about to change
// and is getting ready to transition'. right now it just drops when the
// loop ends and everything seems cramped for time."
//
// Nothing here is new information. DiscoverPanel has held all of it for a
// whole interval already and simply never drew it:
//
//   - radioPendingRef names the slot whose next pick is chosen and warmed,
//     from the moment the LAST change landed. That is 3 to 48 bars of
//     advance notice, depending on pace. This module calls it ARMED.
//   - radioLedChangeRef names the slot whose change is already decided and
//     is only waiting for the next loop top -- either because a hole or a
//     riser is playing out over the closing bars, because an arrival
//     gesture's curve can only be anchored at bar 0
//     (radioChangeWaitsForLoopTop), or because stepRadioStage saw the
//     landing coming and brought the whole decision forward so the engine
//     could swap on the top itself. This module calls it HELD.
//
// ONE CLOCK, START TO FINISH -- the 2026-09-29 correction, and the reason
// this file was rewritten rather than reworded. It used to measure an
// armed slot against radio's INTERVAL and a held one against the LOOP:
// same rule, same place on screen, two different quantities, with nothing
// marking the switch. Elling, on the result: "this bar... what does that
// mean? i find that confusing a bit..." / "this one says 'this bar' but
// continues to loop for a few more times?" / "yes generally confusing.."
//
// Two separate faults were doing that, and both are gone:
//
//   1. THE NUMBER WAS NOT TRUE. The interval is only the EARLIEST a change
//      may happen -- advanceRadioClock also needs a change-grid boundary
//      crossed and the phrase gate open -- so a countdown of the interval
//      reached zero and then sat at zero for however many laps the real
//      wait still had to run. Callers now hand in bars until the change
//      actually LANDS (radioBarsUntilChange, which derives the boundary
//      from advanceRadioClock's own arithmetic). Zero means zero.
//   2. THE RULE RE-BASED. armed -> held may change APPEARANCE and nothing
//      else. Both states are measured from the same RadioApproachWait, so
//      the transition cannot move the number: at the instant a change is
//      decided early, the predicted boundary IS the coming wrap, so the
//      two readings are the same reading.
//
// HONEST WHEN THE PREDICTION IS OVERRUN. Nothing is remembered between
// ticks, so nothing can go stale. A change blocked by a gesture already in
// flight, dropped by a late eligibility re-check, or waiting on a pick
// that never resolved simply gets re-measured to the next real boundary on
// the next tick -- never frozen at zero, which is the original bug in a
// new costume.
//
// Pure and here, rather than inline in DiscoverPanel, for the ordinary
// reason: DiscoverPanel is a React component and React components are not
// unit-tested in this codebase, so anything worth pinning has to live in
// @shared.
//
// WHAT DRAWS THIS TODAY IS ONLY `state`. The visual is now the row's own
// fade plus the red playhead already sweeping it -- Elling, 2026-09-29:
// "i think the fade in and out indication is clear enough that 'something
// is going to happen on this one soon'" and "can't it be the red playhead
// indicator instead of a progress bar? that would streamline the ui".
// `progress` and `barsLeft` are kept and kept tested anyway: they are how
// anyone checks that radio's own idea of when a change lands agrees with
// when it lands, they are the first thing a future readout or a phone
// mirror would want, and the property tests over them are the only place
// the countdown and advanceRadioClock are pinned to each other.
//
// COLOUR IS DELIBERATELY ABSENT from everything this module produces. A
// pending change is chrome, not audio information, and tokens.css spends
// colour only on things that carry audio. Callers express these states in
// luminance and in a slow fade -- never a hue, and never a hard blink at a
// fixed rate, which competes with the playhead and reads as an error.

/** Radio's two waiting states, in the order they happen. */
export type RadioApproachState = 'armed' | 'held'

export interface RadioApproach {
  state: RadioApproachState
  /** 0..1, how far this wait has run toward the change LANDING. The same
   * quantity in both states. */
  progress: number
  /** Whole bars until the change lands, or null when the landing is not
   * knowable (nothing resolved yet, no loop). Rounded up, so a non-zero
   * count always means the change has not happened. */
  barsLeft: number | null
}

/** Floating-point slack, the same idea and the same reason as
 * radioSchedule's BOUNDARY_EPSILON: both numbers here are float sums of
 * ~30Hz deltas, so a remainder that is arithmetically 2 can arrive as
 * 2.0000000000000036 -- and an unguarded Math.ceil would turn that into
 * three bars for one tick. A bar is two seconds at 120bpm, so a
 * billionth of one cannot move a decision that matters. */
const BARS_EPSILON = 1e-9

/** Whole bars still to go.
 *
 * Rounded UP on purpose: a tick at bar 7.01 of an 8-bar wait is still
 * inside the last bar, and saying "0 bars" there would be a lie for a
 * whole bar. Clamped at 0 below because the position stream is ~30Hz and a
 * tick routinely lands a fraction of a bar PAST the boundary before
 * anything notices. */
export function radioApproachBarsLeft(elapsedBars: number, totalBars: number): number | null {
  if (!Number.isFinite(elapsedBars) || !Number.isFinite(totalBars)) return null
  if (!(totalBars > 0)) return null
  return Math.max(0, Math.ceil(totalBars - elapsedBars - BARS_EPSILON))
}

/** The same wait as a 0..1 fraction, clamped. Zero when there is no
 * interval to be a fraction of -- never NaN, which would reach a `width`
 * style and blank the rule. */
export function radioApproachProgress(elapsedBars: number, totalBars: number): number {
  if (!Number.isFinite(elapsedBars) || !Number.isFinite(totalBars)) return 0
  if (!(totalBars > 0)) return 0
  return clamp01(elapsedBars / totalBars)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/** ONE WAIT, measured once, whichever state the row is in.
 *
 * Two numbers rather than a fraction, because the fraction has to be
 * derived from the same pair the count is -- that is what stops the rule
 * and the number being able to disagree. The total is simply
 * `elapsedBars + barsUntilChange`, which is constant between boundary
 * re-predictions: the playhead adds to one exactly what it takes from the
 * other. */
export interface RadioApproachWait {
  /** Bars of playback since this wait began -- radio's own clock
   * (RadioClock.barsElapsed). */
  elapsedBars: number
  /** Bars from NOW until the change actually LANDS, fractional, or null
   * when that is not knowable. radioBarsUntilChange (@shared/radioSchedule)
   * is the one thing that answers this; a caller must not substitute
   * "bars left of the interval", which is the number that was wrong. */
  barsUntilChange: number | null
}

export interface RadioApproachInput {
  /** The row asking. */
  slotId: string
  /** radioPendingRef's slot -- a pick is chosen and warming for it. */
  armedSlotId: string | null
  /** radioLedChangeRef's slot -- its change is decided and waits for the
   * wrap. */
  heldSlotId: string | null
  /** The wait, which is the SAME wait for either state. */
  wait: RadioApproachWait
}

/** Which of the two states this row is in, if either, and how far its one
 * wait has run.
 *
 * HELD WINS. In practice a slot cannot be both -- the clock effect nulls
 * radioPendingRef in the same tick it fills radioLedChangeRef, and it
 * refuses to arm anything new while a change is held -- but the ordering
 * matters if that ever stops being true: a decided change is strictly more
 * urgent than a coming one, so it is the one to show. It reads no
 * differently in numbers, only in brightness; see the header. */
export function radioApproachFor(input: RadioApproachInput): RadioApproach | null {
  if (input.heldSlotId === input.slotId) return measure('held', input.wait)
  if (input.armedSlotId === input.slotId) return measure('armed', input.wait)
  return null
}

function measure(state: RadioApproachState, wait: RadioApproachWait): RadioApproach {
  const until = wait.barsUntilChange
  if (until === null || !Number.isFinite(until) || !Number.isFinite(wait.elapsedBars)) {
    return { state, progress: 0, barsLeft: null }
  }
  // Clamped for the same reason radioApproachBarsLeft is: the position
  // stream is ~30Hz, so a tick can land a fraction of a bar past the
  // boundary before anything notices, and a negative remainder is that
  // fraction rather than a change running backwards.
  const elapsed = Math.max(0, wait.elapsedBars)
  const total = elapsed + Math.max(0, until)
  return {
    state,
    progress: radioApproachProgress(elapsed, total),
    barsLeft: radioApproachBarsLeft(elapsed, total)
  }
}
