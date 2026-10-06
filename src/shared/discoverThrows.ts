// src/shared/discoverThrows.ts -- dub throws in Discover's radio (native radio sound plan,
// Task 11). The rules are the web radio's own (radioThrows.ts stepThrows: when, on which row, for
// how long, at what echo); this is the part that only Discover needs, kept pure so the panel only
// wires it:
//
// - THE CLOCK. stepThrows counts time in seconds that only go forward. Discover's playhead is a
//   position in a loop that wraps (and changes length when a longer layer lands), so the panel's
//   ticks are unrolled here into bars and seconds played.
// - WHERE A THROW MAY START. A throw goes out as a `dubSend` curve anchored at the loop top
//   (throwCurveFor), like every radio gesture, and a load-project lands 0.02-0.22 bar late. So it
//   starts on a beat at least THROW_LEAD_BARS ahead; at its FIRST pass after the curve arrives
//   (the whole throw within a loop's length of the playhead, or the curve would play earlier than
//   planned); and never across the loop top (throwStartAhead).
// - HOW LONG IT IS ARMED. From the plan until the throw has closed; then the panel clears the
//   curve, which lands long before the lap comes back round to it (a loop is at least
//   THROW_LEAD_BARS + THROW_MAX_BARS long, or nothing is planned).
//
// The echo itself rings on after the curve is cleared: the engine's dub bus keeps ringing while
// it has a tail (Task 10), whatever the project says.

import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  THROW_BEATS,
  turnaroundSilencedRowIds,
  initialThrowState,
  noteRadioExitThrow,
  stepThrows,
  throwDelaySec,
  throwTailSec,
  throwCurveFor,
  turnaroundThrowAim,
  type ThrowState,
  type ThrowTiming
} from './radioThrows'
import { turnaroundGapLateRowIds } from './radioTurnaround'
import { stemKey } from './types'

/** A throw starts at least this far ahead of the playhead: load-project lands 0.02-0.22 bar
 * late, and the curve has to be in the engine before the throw opens. */
export const THROW_LEAD_BARS = 1
/** The longest throw, in bars (THROW_BEATS' longer draw, 4/4). */
export const THROW_MAX_BARS = THROW_BEATS[1] / 4
const BEAT_BARS = 1 / 4
const EPS = 1e-9
/** A playhead that moved back counts as a WRAP only when the lap it skipped plus the new
 * position is at most this much: the last tick near the loop's end, this one near its top.
 * A 30 Hz tick covers ~0.025 bar at 180 bpm; the slack is for a late tick (a GC pause). */
export const THROW_WRAP_WINDOW_BARS = 0.5
/** A step back at most this long, mid-lap, is jitter in the position stream: no bars go by,
 * and an armed throw stays. Anything longer back (and not a wrap) is a SEEK. */
export const THROW_JITTER_BARS = 0.05
/** A throw that starts at least this far ahead can still be taken back by a push without
 * cutting into it (load-project lands within 0.22 bar). */
export const THROW_RECALL_BARS = 0.25

/** The first beat at or after `bars`, on the loop's own beat grid (4/4 from the loop top). */
function ceilBeat(bars: number): number {
  return Math.ceil(bars / BEAT_BARS - EPS) * BEAT_BARS + 0 // + 0: never -0
}

/**
 * Where a throw due now may start: `ahead` bars from the playhead, at `atBar` in the loop -- or
 * null when nowhere fits yet (the throw waits for a later tick).
 *
 * The start is a beat, at least `leadBars` ahead, chosen as if the throw were the longest one
 * (`maxBars`) so whatever stepThrows draws fits:
 * - in the lap that is playing, ending by the loop top; else
 * - in the next lap, ending before the playhead's own position comes round again (so this is the
 *   curve's first pass after it lands, and nothing of it is behind the playhead now).
 * Never across the loop top (throwCurveFor refuses that). A loop shorter than
 * `leadBars + maxBars` never fits.
 */
export function throwStartAhead(
  pos: number,
  loopBars: number,
  leadBars: number = THROW_LEAD_BARS,
  maxBars: number = THROW_MAX_BARS
): { ahead: number; atBar: number } | null {
  if (!(loopBars > 0) || !Number.isFinite(pos) || pos < 0) return null
  const here = ceilBeat(pos + leadBars)
  if (here + maxBars <= loopBars + EPS) return { ahead: here - pos, atBar: here }
  const next = ceilBeat(Math.max(0, pos + leadBars - loopBars))
  if (next + maxBars <= loopBars + EPS && next + maxBars <= pos + EPS)
    return { ahead: loopBars - pos + next, atBar: next }
  return null
}

/** How the playhead got from `lastPos` (in a loop of `lastLoopBars`) to `pos`, and the bars
 * played on the way. See stepDiscoverThrows. */
export function playheadStep(
  lastPos: number,
  lastLoopBars: number,
  pos: number
): { kind: 'forward' | 'wrap' | 'jitter' | 'seek'; played: number } {
  if (pos >= lastPos) return { kind: 'forward', played: pos - lastPos }
  const wrapped = Math.max(0, lastLoopBars - lastPos) + pos
  if (wrapped <= THROW_WRAP_WINDOW_BARS + EPS) return { kind: 'wrap', played: wrapped }
  if (lastPos - pos <= THROW_JITTER_BARS + EPS) return { kind: 'jitter', played: 0 }
  return { kind: 'seek', played: 0 }
}

/** A throw as Discover arms it. */
export interface DiscoverThrow {
  slotId: string
  /** Where it starts, bars from the loop top. */
  atBar: number
  beats: number
  timing: ThrowTiming
  feedback: number
  /** Where it starts and closes, in bars played (DiscoverThrowState.elapsedBars). */
  startBars: number
  endBars: number
  /** Aimed at a transition (DiscoverThrowTick.changeInBars): it ends on that downbeat. */
  aimed?: boolean
  /** A hook's exit throw (armDiscoverExitThrow): taken back with its exit
   * (withdrawDiscoverExitThrow). */
  exit?: true
}

export interface DiscoverThrowState {
  throws: ThrowState
  /** Bars and seconds played since the radio started, unrolled across wraps. */
  elapsedBars: number
  elapsedSec: number
  /** The last tick's playhead and loop length; null before the first tick. */
  lastPos: number | null
  lastLoopBars: number
  /** The throw whose curve is in the project, or null. */
  armed: DiscoverThrow | null
}

export const initialDiscoverThrowState = (): DiscoverThrowState => ({
  throws: initialThrowState(),
  elapsedBars: 0,
  elapsedSec: 0,
  lastPos: null,
  lastLoopBars: 0,
  armed: null
})

export interface DiscoverThrowTick {
  /** The playhead, bars from the loop top. */
  pos: number
  loopBars: number
  bpm: number
  /** The transport is running. Stopped, no bars go by and no throw is planned (stepThrows' held). */
  playing: boolean
  /** Nothing stands in the way of pushing a project now (no staged swap the push would
   * withdraw, the preview loaded). False: the throw clock runs, but nothing is planned. */
  canArm: boolean
  /** A hole, riser or drop-out is armed (stepThrows' leadingArmed). */
  leadingArmed: boolean
  /** Bars from the playhead to the transition a throw may aim at (stepThrows' changeAt): the
   * armed phrase turnaround's wrap. Absent or null for none. */
  changeInBars?: number | null
  /** Rows the build-up before it silences (stepThrows' silenced). */
  silenced?: readonly string[]
  /** Bars from the playhead to the intensity arc's drop, in the breakdown's last phrase
   * (stepThrows' dropAt). Absent or null: today. */
  dropInBars?: number | null
  /** Every row in the panel: its slot, kinds, and whether it is heard. */
  rows: readonly { slot: string; kinds: readonly DiscoverSlotKind[]; audible: boolean }[]
  /** The spacing, from the sound settings' rate (radioSound.ts throwEveryBars). */
  everyBars: readonly [number, number]
}

/**
 * One radio tick. Advances the clock; ends an armed throw once it has closed, or when the
 * transport has stopped ('ended': the panel clears the curve); otherwise, with nothing armed and somewhere to start, asks stepThrows
 * ('armed': the panel puts the curve in). Ticks that cannot plan (canArm false, nowhere to start)
 * do not call stepThrows at all; the bars they cover still count at its next call (it measures
 * from its own last `now`), so a due throw just waits.
 *
 * The clock (playheadStep): forward is bars played (a seek forward included); back across the
 * loop top from its last stretch is a wrap (the rest of the last lap plus the new position);
 * a tiny step back mid-lap is jitter (nothing played); any other step back is a seek --
 * nothing played, and an armed throw ends (the playhead and the throw's bars no longer agree).
 */
export function stepDiscoverThrows(
  state: DiscoverThrowState,
  tick: DiscoverThrowTick,
  random: () => number
): { state: DiscoverThrowState; change: 'armed' | 'ended' | null } {
  const secPerBar = (4 * 60) / tick.bpm
  let delta = 0
  let seek = false
  if (state.lastPos !== null && tick.playing) {
    const moved = playheadStep(state.lastPos, state.lastLoopBars, tick.pos)
    delta = moved.played
    seek = moved.kind === 'seek'
  }
  const next: DiscoverThrowState = {
    ...state,
    elapsedBars: state.elapsedBars + delta,
    elapsedSec:
      state.elapsedSec + delta * (secPerBar > 0 && Number.isFinite(secPerBar) ? secPerBar : 0),
    lastPos: tick.pos,
    lastLoopBars: tick.loopBars
  }
  if (next.armed !== null) {
    // stopped: the playhead can come back anywhere (a stop puts it at the top), so the throw
    // is off rather than left to fire wherever the clock and the playhead now disagree
    if (!tick.playing || seek || next.elapsedBars >= next.armed.endBars - EPS) {
      next.armed = null
      return { state: next, change: 'ended' }
    }
    return { state: next, change: null }
  }
  if (!tick.canArm || !(secPerBar > 0) || !Number.isFinite(secPerBar)) {
    return { state: next, change: null }
  }
  const start = throwStartAhead(tick.pos, tick.loopBars)
  if (start === null) return { state: next, change: null }
  const changeInBars =
    tick.changeInBars !== undefined && tick.changeInBars !== null && tick.changeInBars > 0
      ? tick.changeInBars
      : null
  const dropInBars =
    tick.dropInBars !== undefined && tick.dropInBars !== null && tick.dropInBars > 0
      ? tick.dropInBars
      : null
  const r = stepThrows(
    next.throws,
    {
      now: next.elapsedSec,
      bpm: tick.bpm,
      nextBeat: next.elapsedSec + start.ahead * secPerBar,
      held: !tick.playing,
      leadingArmed: tick.leadingArmed,
      changeAt: changeInBars === null ? null : next.elapsedSec + changeInBars * secPerBar,
      silenced: tick.silenced,
      rows: tick.rows,
      ...(dropInBars !== null && { dropAt: next.elapsedSec + dropInBars * secPerBar })
    },
    random,
    tick.everyBars
  )
  next.throws = r.state
  if (r.plan === null) return { state: next, change: null }
  // where stepThrows put it: the start found above, or (aimed) its beats before the change or
  // the drop
  const ends = (r.plan.at - next.elapsedSec) / secPerBar + r.plan.beats / 4
  const aimAt = [changeInBars, dropInBars].find((t) => t !== null && Math.abs(ends - t) < 1e-6)
  const aimed = aimAt !== undefined && aimAt !== null
  let ahead = start.ahead
  let atBar = start.atBar
  if (aimed) {
    ahead = aimAt - r.plan.beats / 4
    // on the loop's beat grid (the change is a loop top or a beat of the loop)
    atBar = Math.round(((tick.pos + ahead) % tick.loopBars) / BEAT_BARS) * BEAT_BARS
    // a start that does not fit the loop (a caller's change off the grid) is not armed
    if (
      ahead < THROW_LEAD_BARS - 1e-6 ||
      atBar + r.plan.beats / 4 > tick.loopBars + 1e-6 ||
      ahead + r.plan.beats / 4 > tick.loopBars + 1e-6
    )
      return { state: next, change: null }
  }
  const startBars = next.elapsedBars + ahead
  next.armed = {
    slotId: r.plan.slot,
    atBar,
    beats: r.plan.beats,
    timing: r.plan.timing,
    feedback: r.plan.feedback,
    startBars,
    endBars: startBars + r.plan.beats / 4,
    ...(aimed ? { aimed: true } : {})
  }
  return { state: next, change: 'armed' }
}

/**
 * Whether a staged project should carry the armed throw: when the throw is still open at the
 * moment the stage lands -- at `atBars` of the lap that is playing, or (undefined) at the next
 * loop top. A throw that closes before then belongs to the project playing now; carried, it would
 * play again in the staged project's lap. One in the next lap, or still to close at a mid-lap
 * landing, has to ride the stage or it is lost when the stage lands.
 */
export function throwOutlivesLanding(state: DiscoverThrowState, atBars?: number): boolean {
  if (state.armed === null || state.lastPos === null) return false
  const lapStart = state.elapsedBars - state.lastPos
  const landing = lapStart + (atBars ?? state.lastLoopBars)
  return state.armed.endBars > landing + EPS
}

/**
 * The armed throw as buildEngineProject's `dubThrows`: its curve (throwCurveFor, full level) on
 * the preview stem of its row -- the preview numbers its stems by member order, stem i + 1 is
 * `memberSlotIds[i]` -- and the echo it opens into. Undefined when there is nothing to send: no
 * throw, its row is not in the mix, or the curve does not fit this loop (a loop that got shorter
 * under it).
 */
export function discoverThrowSends(
  armed: DiscoverThrow | null,
  memberSlotIds: readonly string[],
  groupId: string,
  loopBars: number,
  secPerBar: number
):
  | {
      echo: { timing: ThrowTiming; feedback: number }
      sends: Map<string, { bar: number; value: number }[]>
    }
  | undefined {
  if (armed === null) return undefined
  const own = memberSlotIds.indexOf(armed.slotId) + 1
  if (own <= 0) return undefined
  const curve = throwCurveFor(armed, loopBars, secPerBar)
  if (curve === null) return undefined
  return {
    echo: { timing: armed.timing, feedback: armed.feedback },
    sends: new Map([[stemKey(groupId, own), curve]])
  }
}

/**
 * Whether a leading gesture (a hole, riser or drop-out) being armed should take the armed throw
 * back: when the throw has not started and is far enough ahead that the push carrying the
 * gesture lands before it (THROW_RECALL_BARS). stepThrows never plans a throw over an armed
 * lead-in; this covers a lead-in armed after the throw was planned (the web has that gap). A
 * throw already under way, or about to be, is left to finish: taking it back would cut it. An
 * AIMED throw never yields: it ends on the turnaround's wrap, is never on a row the turnaround
 * silences, and is what the lead-in leads to.
 */
export function throwYieldsToLeadIn(state: DiscoverThrowState): boolean {
  return (
    state.armed !== null &&
    state.armed.aimed !== true &&
    state.armed.startBars - state.elapsedBars >= THROW_RECALL_BARS
  )
}

/**
 * The rows a throw is never put on (stepThrows' silenced): those an armed turnaround drops before
 * its one, and the row of every drop-out or hole armed this lap -- an arc exit's drop-out can
 * share the lap with a turnaround, and an aimed throw goes over a lead-in, so its row has to be
 * named here too. With `liveRowIds` (the rows playing), a gapped turnaround's late rows too
 * (turnaroundGapLateRowIds): the panel silences them through the gap. The send is post-fader: a
 * throw on a silenced row is heard as nothing.
 */
export function discoverThrowSilenced(
  turnaround:
    | (NonNullable<Parameters<typeof turnaroundSilencedRowIds>[0]> & {
        gapBeats?: number
        keeperId?: string
      })
    | null
    | undefined,
  gestures: readonly { kind: string; slotId: string }[],
  liveRowIds: Iterable<string> = []
): string[] {
  const rows = new Set(turnaroundSilencedRowIds(turnaround))
  // and every live row a gapped plan never saw: the runtime silences it through the gap too
  for (const id of turnaroundGapLateRowIds(turnaround, liveRowIds)) rows.add(id)
  for (const g of gestures) if (g.kind === 'drop-out' || g.kind === 'hole') rows.add(g.slotId)
  return [...rows]
}

/**
 * What a throw aims at in Discover (stepDiscoverThrows' changeInBars and silenced), with a phrase
 * turnaround armed for the wrap `barsToWrap` ahead; null with none armed (nothing to aim at).
 *
 * No gap: the wrap, never on discoverThrowSilenced's rows. THROW INTO THE GAP (Elling,
 * 2026-10-03): with a riser gap the throw ends where the gap STARTS (turnaroundThrowAim), its
 * echoes ringing through the silence, so a row only the gap silences -- a gap drop, a late row
 * the runtime silences through the gap -- is still playing when it closes and may take it; a row
 * silent BEFORE the gap may not, nor the row of any drop-out or hole armed this lap (an arc exit
 * sharing the lap). The send is post-fader: a throw on a silenced row is heard as nothing.
 */
export function discoverThrowAim(
  turnaround:
    | (NonNullable<Parameters<typeof discoverThrowSilenced>[0]> &
        Parameters<typeof turnaroundThrowAim>[0])
    | null
    | undefined,
  gestures: readonly { kind: string; slotId: string }[],
  barsToWrap: number,
  liveRowIds: Iterable<string> = []
): { changeInBars: number; silenced: string[] } | null {
  if (!turnaround) return null
  if (!((turnaround.gapBeats ?? 0) > 0))
    return {
      changeInBars: barsToWrap,
      silenced: discoverThrowSilenced(turnaround, gestures, liveRowIds)
    }
  // at 240 bpm a beat is a quarter of a second: seconds are bars
  const aim = turnaroundThrowAim(turnaround, barsToWrap, 240)
  const rows = new Set(aim.silenced)
  for (const g of gestures) if (g.kind === 'drop-out' || g.kind === 'hole') rows.add(g.slotId)
  return { changeInBars: aim.at, silenced: [...rows] }
}

/**
 * A hook's exit throw (spec 2026-10-03-radio-anointed-stems-design 2.5), armed by the panel when
 * the exit is decided: on the hook's row, ENDING on the coming loop top (the exit line), so its
 * echoes ring over the line. It is armed live, as a lead-in is (a load-project now, the
 * substitute's stage on a later tick), and counts on the throw clock (noteRadioExitThrow: the
 * next regular throw waits for its echoes), drawing nothing.
 *
 * Null -- the exit goes dry -- when a throw is already armed, or the throw cannot start at least
 * THROW_LEAD_BARS ahead of the playhead (a loop too short, or a decision late in the lap).
 */
export function armDiscoverExitThrow(
  state: DiscoverThrowState,
  o: {
    slotId: string
    shape: { beats: number; timing: ThrowTiming; feedback: number }
    pos: number
    loopBars: number
    bpm: number
  }
): DiscoverThrowState | null {
  if (state.armed !== null || !(o.loopBars > 0) || !(o.bpm > 0)) return null
  const atBar = o.loopBars - o.shape.beats / 4
  const ahead = atBar - o.pos
  if (atBar < 0 || ahead < THROW_LEAD_BARS - 1e-6) return null
  const secPerBar = (4 * 60) / o.bpm
  const startBars = state.elapsedBars + ahead
  const endsAtSec = state.elapsedSec + (o.loopBars - o.pos) * secPerBar
  const tail = throwTailSec(throwDelaySec(o.bpm, o.shape.timing), o.shape.feedback)
  return {
    ...state,
    throws: noteRadioExitThrow(state.throws, endsAtSec, tail),
    armed: {
      slotId: o.slotId,
      atBar,
      ...o.shape,
      startBars,
      endBars: startBars + o.shape.beats / 4,
      aimed: true,
      exit: true
    }
  }
}

/**
 * A hook's exit withdrawn before its line (the hook released, the cap, a manual change winning the
 * row, undo): its echo throw on `slotId` is taken back with it (the web's Engine.cancelThrow), so
 * no echo rings over a row that stays. The panel clears the curve (a push). Only while the throw
 * has not started and the push lands before it (THROW_RECALL_BARS, as throwYieldsToLeadIn): one
 * under way, or about to be, is left to finish -- taking it back would cut the send mid-throw.
 * The throw clock is left as the exit noted it (the next regular throw waits as it would have).
 *
 * Null when there is nothing to take back: no exit throw armed on that row, or it is under way.
 */
export function withdrawDiscoverExitThrow(
  state: DiscoverThrowState,
  slotId: string
): DiscoverThrowState | null {
  const a = state.armed
  if (a === null || a.exit !== true || a.slotId !== slotId) return null
  if (a.startBars - state.elapsedBars < THROW_RECALL_BARS - EPS) return null
  return { ...state, armed: null }
}
