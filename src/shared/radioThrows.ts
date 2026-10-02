// src/shared/radioThrows.ts -- occasional dub throws (Elling, 2026-10-01): now and then one row's
// send to the tempo-synced echo (the radio's Engine.throwDelay) opens for a beat or two and
// closes; the echoes ring out. Pure and seeded: the controller feeds it a tick, it answers with a
// throw or nothing.
//
// Moved here from ell.ing/radio's src/radio/throws.ts, with the pure echo timing
// (throwDelaySec, throwTailSec, ThrowTiming) from its src/audio/dubDelay.ts, by the native radio
// sound plan, Task 0; the radio re-exports them. The spacing between throws can now be given
// (the sound settings' rate, radioSound.ts throwEveryBars); THROW_EVERY_BARS when it is not.

import type { DiscoverSlotKind } from './discoverSlotKind'

export type ThrowTiming = 'dotted-eighth' | 'quarter'

/** The echo's time at a tempo: a dotted eighth is three quarters of a beat. */
export function throwDelaySec(bpm: number, timing: ThrowTiming): number {
  return (timing === 'quarter' ? 1 : 0.75) * (60 / bpm)
}

/** How long a throw's echoes take to fall 60 dB: repeats of `delay` each `feedback` as loud. */
export function throwTailSec(delaySec: number, feedback: number): number {
  return (Math.log(1000) / -Math.log(feedback)) * delaySec
}

/** A throw comes round this often, drawn uniformly per throw, in bars. */
export const THROW_EVERY_BARS = [16, 32] as const
export const THROW_BEATS = [1, 2] as const
export const THROW_FEEDBACK = [0.45, 0.6] as const
/** Rows a throw never picks: the floor of the mix stays dry. */
const NEVER: readonly DiscoverSlotKind[] = ['drums', 'bass']

export interface ThrowPlan {
  slot: string
  /** A beat boundary, AudioContext time. */
  at: number
  beats: number
  timing: ThrowTiming
  feedback: number
}

export interface ThrowState {
  /** Bars still to play before the next throw is due; null until the first tick. */
  barsUntil: number | null
  lastNow: number | null
  /** The last throw's echoes are still ringing until then. */
  busyUntil: number
}

export interface ThrowTick {
  now: number
  bpm: number
  /** The next beat boundary far enough ahead to schedule on. */
  nextBeat: number
  held: boolean
  /** A hole, riser or drop-out is armed: its wrap is spoken for. */
  leadingArmed: boolean
  rows: readonly { slot: string; kinds: readonly DiscoverSlotKind[]; audible: boolean }[]
}

export const initialThrowState = (): ThrowState => ({
  barsUntil: null,
  lastNow: null,
  busyUntil: Number.NEGATIVE_INFINITY
})

const between = (r: number, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * r

/** How long a throw holds the send open, in beats: one or two, evenly (one draw). Shared by
 * stepThrows and the timeline's plan (timelineThrows.ts), so the two cannot drift. */
export function drawThrowBeats(random: () => number): number {
  return random() < 0.5 ? THROW_BEATS[0] : THROW_BEATS[1]
}

/** A throw's echo: a dotted eighth or a quarter, evenly, and a feedback in THROW_FEEDBACK (two
 * draws, in that order). Shared by stepThrows and the timeline's plan (timelineThrows.ts). */
export function drawThrowEcho(random: () => number): { timing: ThrowTiming; feedback: number } {
  const timing: ThrowTiming = random() < 0.5 ? 'dotted-eighth' : 'quarter'
  return { timing, feedback: between(random(), THROW_FEEDBACK) }
}

export function stepThrows(
  state: ThrowState,
  tick: ThrowTick,
  random: () => number,
  everyBars: readonly [number, number] = THROW_EVERY_BARS
): { state: ThrowState; plan: ThrowPlan | null } {
  const barSec = (4 * 60) / tick.bpm
  let barsUntil = state.barsUntil ?? between(random(), everyBars)
  // bars go by only while the radio plays on its own
  if (state.lastNow !== null && !tick.held)
    barsUntil -= Math.max(0, tick.now - state.lastNow) / barSec
  const next: ThrowState = { barsUntil, lastNow: tick.now, busyUntil: state.busyUntil }
  if (barsUntil > 0 || tick.nextBeat < state.busyUntil) return { state: next, plan: null }
  // due: skipped (and the next drawn) while held, over an armed lead-in, or with nothing to throw
  next.barsUntil = between(random(), everyBars)
  const eligible = tick.rows.filter((r) => r.audible && !r.kinds.some((k) => NEVER.includes(k)))
  if (tick.held || tick.leadingArmed || eligible.length === 0) return { state: next, plan: null }
  const slot = eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))].slot
  const beats = drawThrowBeats(random)
  const { timing, feedback } = drawThrowEcho(random)
  const plan: ThrowPlan = { slot, at: tick.nextBeat, beats, timing, feedback }
  next.busyUntil =
    plan.at + (beats * 60) / tick.bpm + throwTailSec(throwDelaySec(tick.bpm, timing), feedback)
  return { state: next, plan }
}

/** The send's ramps in and out, as the web's Engine.throwDelay draws them: 5 ms each. */
export const THROW_RAMP_SEC = 0.005

/** One throw as a `dubSend` curve (native radio sound plan, Task 11): the row's send into the
 * echo, opened from 0 to full over 5 ms at `atBar`, held, and closed over the last 5 ms of its
 * `beats` (4/4) -- the web's Engine.throwDelay (setValueAtTime 0, a linear ramp to the level,
 * setValueAtTime at end - 5 ms, a linear ramp to 0 at the end), at full level (buildEngineProject
 * scales it by `sound.throws.level`).
 *
 * The curve is anchored at the loop top, like every radio gesture: `atBar` is a position in the
 * loop, and it repeats every lap until it is cleared. A throw that would cross the loop top is
 * REFUSED (null), not split in two: the half after the top would sit at the start of the curve,
 * and the lap that is playing when the curve arrives could already be inside it -- a fragment of
 * the throw before the throw. The caller picks a start the whole throw fits after
 * (discoverThrows.ts throwStartAhead), so a refusal there is a bug, not a redraw. Also null for
 * nonsense (no loop, no tempo, no beats, a start before the top). */
export function throwCurveFor(
  plan: { atBar: number; beats: number },
  loopBars: number,
  secPerBar: number
): { bar: number; value: number }[] | null {
  if (!(loopBars > 0) || !(secPerBar > 0) || !(plan.beats > 0) || !(plan.atBar >= 0)) return null
  const end = plan.atBar + plan.beats / 4
  // a hair of float slack: a throw ending exactly on the top is inside the loop
  if (end > loopBars + 1e-9) return null
  // never more than half the throw, so a (theoretical) very short throw still opens and closes
  const ramp = Math.min(THROW_RAMP_SEC / secPerBar, (end - plan.atBar) / 2)
  return [
    { bar: plan.atBar, value: 0 },
    { bar: plan.atBar + ramp, value: 1 },
    { bar: end - ramp, value: 1 },
    { bar: Math.min(end, loopBars), value: 0 }
  ]
}
