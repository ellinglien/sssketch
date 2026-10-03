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
  /** Bars still to play before the next throw is due; null until the first tick. Negative: due
   * that long ago (a throw waiting for a transition). The clock keeps its schedule: each next
   * spacing is drawn on top of what is left (or overdue), so a throw pulled forward or held back
   * to meet a transition never changes the long-run rate. */
  barsUntil: number | null
  lastNow: number | null
  /** The last throw's echoes are still ringing until then. */
  busyUntil: number
  /** Bars played since the last throw was planned; null before the first. */
  barsSince: number | null
}

export interface ThrowTick {
  now: number
  bpm: number
  /** The next beat boundary far enough ahead to schedule on. */
  nextBeat: number
  held: boolean
  /** A hole, riser or drop-out is armed: its wrap is spoken for. */
  leadingArmed: boolean
  /** The next transition already decided or armed within reach (a change's landing, a mid-loop
   * bar landing too, or an armed turnaround's wrap), on the beat grid; absent or null for none.
   * A throw near it is AIMED: it ends on that downbeat, its echoes ringing over the change. */
  changeAt?: number | null
  /** Rows the build-up before `changeAt` silences (a hole's outgoing row, the rows a turnaround
   * drops before the one): the send is post-fader, so a throw there would be heard as nothing. */
  silenced?: readonly string[]
  rows: readonly { slot: string; kinds: readonly DiscoverSlotKind[]; audible: boolean }[]
}

export const initialThrowState = (): ThrowState => ({
  barsUntil: null,
  lastNow: null,
  busyUntil: Number.NEGATIVE_INFINITY,
  barsSince: null
})

/** How far a throw may move to meet a transition, as a share of the shortest spacing (8 bars at
 * THROW_EVERY_BARS, 4 at the busiest rate): pulled forward up to that much -- and only once that
 * many bars have gone by since the last throw, so two never come closer than it -- or, due, held
 * back up to that much waiting for one (up to twice it for a transition already in sight). Half
 * the shortest spacing keeps the throws' own rhythm recognisable (a 16-32 bar spacing becomes at
 * worst 8-48) while a change every ~25 bars (the pace slider at 50) is in reach of most throws. */
export const THROW_PREFER_SHARE = 0.5
/** An aimed throw is planned once its transition is at most this many beats past the next beat
 * the caller can schedule on: late enough that a change taken back has mostly already been,
 * early enough that the longest throw (THROW_BEATS) fits before it. */
export const THROW_AIM_REACH_BEATS = 4

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

const EPS = 1e-9

/**
 * One tick of the throw clock. A throw comes round every `everyBars` (drawn per throw), on a
 * beat, on one heard row that is neither drums nor bass, never while the last one still rings.
 *
 * AIMED (Elling, 2026-10-03: a throw belongs right before a transition). With a transition in
 * `changeAt`, a throw due within THROW_PREFER_SHARE of the shortest spacing (either way, and no
 * sooner than that long after the last throw), the change coming before the throw would be
 * twice that overdue, waits for it to come within
 * THROW_AIM_REACH_BEATS, then starts `beats` before it: `at = changeAt - beats * 60 / bpm`, so it
 * ENDS on the downbeat. A two-beat throw that no longer fits becomes a one-beat one; with no beat
 * left at all it is not aimed. An armed lead-in does not stop an aimed throw (it is what the
 * lead-in leads to). No throw, aimed or not, is ever on a `silenced` row.
 *
 * UNAIMED. A throw with no transition in reach waits up to that same share for one, then goes on
 * the next beat as it always has: skipped while held, over an armed lead-in, or with nothing to
 * throw. Every throw (or skip) draws the next spacing on top of what was left of the last, so the
 * rate is the clock's: one in 24 bars at THROW_EVERY_BARS.
 *
 * The random stream: one draw for the first spacing, then per throw the next spacing, the row,
 * the beats and the echo (two), in that order; a skip draws only the spacing.
 */
export function stepThrows(
  state: ThrowState,
  tick: ThrowTick,
  random: () => number,
  everyBars: readonly [number, number] = THROW_EVERY_BARS
): { state: ThrowState; plan: ThrowPlan | null } {
  const barSec = (4 * 60) / tick.bpm
  const beatSec = 60 / tick.bpm
  let barsUntil = state.barsUntil ?? between(random(), everyBars)
  let barsSince = state.barsSince ?? null
  // bars go by only while the radio plays on its own
  if (state.lastNow !== null && !tick.held) {
    const played = Math.max(0, tick.now - state.lastNow) / barSec
    barsUntil -= played
    if (barsSince !== null) barsSince += played
  }
  const next: ThrowState = { barsUntil, lastNow: tick.now, busyUntil: state.busyUntil, barsSince }
  if (tick.nextBeat < state.busyUntil) return { state: next, plan: null }
  /** The next spacing, drawn on top of what is left (or overdue) of this one. */
  const redraw = (): void => {
    next.barsUntil = barsUntil + between(random(), everyBars)
  }
  if (tick.held) {
    // due while held: skipped, and the next drawn
    if (barsUntil <= 0) redraw()
    return { state: next, plan: null }
  }
  const prefer = everyBars[0] * THROW_PREFER_SHARE
  const changeAt =
    tick.changeAt !== undefined &&
    tick.changeAt !== null &&
    Number.isFinite(tick.changeAt) &&
    tick.changeAt > tick.nextBeat + EPS
      ? tick.changeAt
      : null
  const silenced = tick.silenced ?? []
  // never on a row the build-up silences, aimed or not
  const audible = tick.rows.filter(
    (r) => r.audible && !r.kinds.some((k) => NEVER.includes(k)) && !silenced.includes(r.slot)
  )
  if (
    changeAt !== null &&
    barsUntil <= prefer &&
    barsUntil > -2 * prefer &&
    (barsSince === null || barsSince >= prefer - EPS) &&
    // only a change that comes before the wait would run out (a far one on a long loop is not
    // waited for: the throw goes as an unaimed one)
    (changeAt - tick.nextBeat) / barSec <= barsUntil + 2 * prefer + EPS
  ) {
    // a transition in sight: wait until it is within reach, then aim
    if (changeAt - tick.nextBeat > THROW_AIM_REACH_BEATS * beatSec + EPS)
      return { state: next, plan: null }
    redraw()
    if (audible.length === 0) return { state: next, plan: null }
    const slot = audible[Math.min(audible.length - 1, Math.floor(random() * audible.length))].slot
    let beats = drawThrowBeats(random)
    const { timing, feedback } = drawThrowEcho(random)
    // the longer throw no longer fits before the change: the shorter one
    if (changeAt - beats * beatSec < tick.nextBeat - EPS) beats = THROW_BEATS[0]
    const aimed = changeAt - beats * beatSec >= tick.nextBeat - EPS
    // nothing fits before it: as an unaimed throw (none over a lead-in)
    if (!aimed && tick.leadingArmed) return { state: next, plan: null }
    const at = aimed ? changeAt - beats * beatSec : tick.nextBeat
    return throwPlanned(next, { slot, at, beats, timing, feedback }, tick.bpm)
  }
  // not due, or due and waiting a while for a transition
  if (barsUntil > -prefer) return { state: next, plan: null }
  // due: skipped (and the next drawn) over an armed lead-in, or with nothing to throw
  redraw()
  if (tick.leadingArmed || audible.length === 0) return { state: next, plan: null }
  const slot = audible[Math.min(audible.length - 1, Math.floor(random() * audible.length))].slot
  const beats = drawThrowBeats(random)
  const { timing, feedback } = drawThrowEcho(random)
  return throwPlanned(next, { slot, at: tick.nextBeat, beats, timing, feedback }, tick.bpm)
}

function throwPlanned(
  next: ThrowState,
  plan: ThrowPlan,
  bpm: number
): { state: ThrowState; plan: ThrowPlan } {
  next.barsSince = 0
  next.busyUntil =
    plan.at + (plan.beats * 60) / bpm + throwTailSec(throwDelaySec(bpm, plan.timing), plan.feedback)
  return { state: next, plan }
}

/** A row's gain at or below this, anywhere in a build-up, counts as silenced for a throw. */
const THROW_SILENT_GAIN = 0.01

/** The rows a turnaround silences before its one (a drum drop, a low drop, a stop, a combined
 * plan's gap): those with a `volume` curve that reaches silence. A throw is never aimed at one
 * (ThrowTick.silenced): its send is post-fader. Lifts, dips, washes and the riser only filter or
 * send, and stay throwable. */
export function turnaroundSilencedRowIds(
  plan:
    { rows: readonly { rowId: string; volume?: readonly { value: number }[] }[] } | null | undefined
): string[] {
  if (!plan) return []
  return plan.rows
    .filter((r) => r.volume?.some((p) => p.value <= THROW_SILENT_GAIN) === true)
    .map((r) => r.rowId)
}

/**
 * Where a throw aims before an armed turnaround's wrap at `wrapAt`, and the rows it must not be on.
 *
 * THROW INTO THE GAP (Elling, 2026-10-03). A combined turnaround with a riser gap (`gapBeats` > 0)
 * silences every row but the keeper for its last `gapBeats` beats. The throw ends where the gap
 * STARTS (`wrapAt - gapBeats * 60 / bpm`), its echoes, already in the delay, ringing on through the
 * silence. Its send is post-fader, so it closes before its row's fader drops: a row the gap alone
 * silences (its drop starts at the gap) is fine; a row silent BEFORE the gap -- a drop longer than
 * it -- is not. With no gap: the wrap itself, and every row the turnaround silences
 * (turnaroundSilencedRowIds).
 */
export function turnaroundThrowAim(
  plan: {
    gapBeats?: number
    rows: readonly { rowId: string; volume?: readonly { beats: number; value: number }[] }[]
  },
  wrapAt: number,
  bpm: number
): { at: number; silenced: string[] } {
  const gap = plan.gapBeats ?? 0
  if (!(gap > 0)) return { at: wrapAt, silenced: turnaroundSilencedRowIds(plan) }
  return {
    at: wrapAt - (gap * 60) / bpm,
    silenced: plan.rows
      .filter(
        (r) => r.volume?.some((p) => p.beats > gap + EPS && p.value <= THROW_SILENT_GAIN) === true
      )
      .map((r) => r.rowId)
  }
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
