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
//     riser is playing out over the closing bars, or because an arrival
//     gesture's curve can only be anchored at bar 0
//     (radioChangeWaitsForLoopTop). This module calls it HELD, and it is
//     the genuinely imminent one: it lands at the next wrap.
//
// The two wait for DIFFERENT clocks, which is the whole reason they are
// two states rather than one. An armed change is counted against the
// interval clock (radioSchedule's barsElapsed / intervalBars); a held one
// is counted against the LOOP, because the loop top is literally what it
// is waiting for. Callers hand both clocks in and this picks.
//
// Pure and here, rather than inline in DiscoverPanel, for the ordinary
// reason: DiscoverPanel is a React component and React components are not
// unit-tested in this codebase, so anything worth pinning has to live in
// @shared. It is also read by the phone remote (remoteState.ts), which is
// main-process code and cannot import a renderer component at all.
//
// COLOUR IS DELIBERATELY ABSENT from everything this module produces. A
// pending change is chrome, not audio information, and tokens.css spends
// colour only on things that carry audio. Callers express these states in
// luminance and in the motion of a rule filling up -- never a hue, and
// never a hard blink at a fixed rate, which competes with the playhead and
// reads as an error.

/** Radio's two waiting states, in the order they happen. */
export type RadioApproachState = 'armed' | 'held'

export interface RadioApproach {
  state: RadioApproachState
  /** 0..1, how far the wait has run: toward the change for `armed`, toward
   * the loop top for `held`. A filling rule, not a blink -- it tracks the
   * real approach, so it is calmer AND says more. */
  progress: number
  /** Whole bars still to go, or null when the length is not knowable
   * (nothing resolved yet, no interval). Rounded up, so a non-zero count
   * always means the change has not happened. */
  barsLeft: number | null
}

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
  return Math.max(0, Math.ceil(totalBars - elapsedBars))
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

export interface RadioApproachInput {
  /** The row asking. */
  slotId: string
  /** radioPendingRef's slot -- a pick is chosen and warming for it. */
  armedSlotId: string | null
  /** radioLedChangeRef's slot -- its change is decided and waits for the
   * wrap. */
  heldSlotId: string | null
  /** The interval clock, for an armed slot. */
  interval: { progress: number; barsLeft: number | null }
  /** The loop's own position, for a held slot. */
  loop: { progress: number; barsLeft: number | null }
}

/** Which of the two states this row is in, if either.
 *
 * HELD WINS. In practice a slot cannot be both -- the clock effect nulls
 * radioPendingRef in the same tick it fills radioLedChangeRef, and it
 * refuses to arm anything new while a change is held -- but the ordering
 * matters if that ever stops being true: "it lands at the next wrap" is
 * strictly more urgent and strictly more specific than "something is
 * coming", so it is the one to show. */
export function radioApproachFor(input: RadioApproachInput): RadioApproach | null {
  if (input.heldSlotId === input.slotId) {
    return { state: 'held', progress: clamp01(input.loop.progress), barsLeft: input.loop.barsLeft }
  }
  if (input.armedSlotId === input.slotId) {
    return {
      state: 'armed',
      progress: clamp01(input.interval.progress),
      barsLeft: input.interval.barsLeft
    }
  }
  return null
}

/** The row's own words for it. Lowercase, no punctuation, three words at
 * the outside -- the same budget every tooltip on this screen is held to.
 *
 * A held change says WHERE it lands rather than how long it is, because
 * that is the useful fact and the filling rule already carries the length.
 * An armed one counts bars, which is what "how long" means to someone
 * listening -- and unlike the 0..1 progress it only changes once a bar, so
 * it can be text without jittering at 30Hz. */
export function radioApproachLabel(approach: RadioApproach): string {
  if (approach.state === 'held') return 'at loop top'
  const bars = approach.barsLeft
  if (bars === null) return 'change coming'
  if (bars <= 0) return 'this bar'
  return bars === 1 ? 'in 1 bar' : `in ${bars} bars`
}
