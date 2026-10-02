// src/shared/timelineThrows.ts -- the timeline's dub throws (native radio sound plan, Task 12).
//
// On the timeline a throw cannot be a live random draw, as it is in Discover (discoverThrows.ts):
// a bounce would then differ from the pass Elling just heard. So the throws are PLANNED FROM THE
// PROJECT -- a pure function of the arrangement and the project's seed -- and every render of the
// project (live playback, the mixdown, stem/bus exports, per-clip bakes) is built with the same
// plan and hears the same throws.
//
// The rule is the web's (stepThrows in radioThrows.ts): a throw comes round every `everyBars`
// (the rate), on a beat; a due throw waits while the last one's echo still rings (`busyUntil`);
// it is skipped over a lead-in (here: a riser) or with nothing to throw; it picks one audible row
// that is not drums or bass, evenly; it holds the send for one or two beats. What differs is how
// the randomness is laid out, so that the plan is STABLE ACROSS EDITS ELSEWHERE:
//
// - **Where throws fall** is a sequence of candidate bars drawn from the seed and the rate alone
//   (`|throws|<rate>`), never from the arrangement. stepThrows' single sequential stream would
//   shift every later throw whenever one earlier draw changed (a row muted at bar 10 would move
//   the throw at bar 90); here the candidates stay where they are whatever is edited.
// - **Each candidate draws from its own stream** (`|throw|<rate>|<k>`): its length in beats.
// - **The row** is picked by rendezvous hashing: each row eligible at candidate k scores
//   hash(seed, rate, k, stemKey), and the lowest wins. That is an even pick among the eligible
//   rows (as stepThrows' is), and adding, removing or muting a row changes the pick only at the
//   candidates where that row wins (or won).
// - **The echo** (dotted eighth or quarter, feedback 0.45..0.6) is drawn ONCE per project
//   (`|echo`, not the rate): the engine's dub bus carries one `sound.dub` (Task 10), and a
//   per-throw list would be a wire and engine change. The web draws it per throw; see the plan's
//   Task 12 notes.
//
// So an edit changes only the throws at the candidates whose eligible rows it touches, plus,
// rarely, the one after (a throw that moved can push the next one's wait for its echo). The
// seed is the project's own (`AppState.projectSeed`, random per new project, derived from its
// rifffs for a project saved before it existed); with none it is ''.
//
// "Audible at that bar" (Task 12's eligibility, decided here):
// - the stem's clip is placed, and the WHOLE throw lies inside the clip as drawn (its left edge,
//   `clipOriginBar`, to its right edge, `clipLengthBars`) -- a throw near a clip's end is
//   dropped, never cut -- and inside the arrangement (`loopLengthBars`);
// - a one-shot: the whole throw also lies inside the span its sample sounds (trimmed length at
//   the project tempo, from the rifff's start, as the engine fires it);
// - its SoundType is neither drums nor bass;
// - not muted (`state.mute`, which is also what the timeline's solo writes), its gain dial above
//   0 (`state.vol`; the committed value, not a drag preview), no mute region overlapping the
//   throw, and its drawn volume curve not 0 over the whole throw.
// A riser overlapping the throw is the timeline's lead-in: the candidate is skipped, as
// stepThrows skips over an armed riser or hole.

import type { AppState } from '../renderer/src/state/store'
import { SNAP_DIVS } from '../renderer/src/state/store'
import { loopLengthBars, resolvePlayedBars } from '../renderer/src/state/selectors'
import { clipLengthBars } from './automationEdit'
import { clipOriginBar, type BuildEngineProjectOptions } from './buildEngineProject'
import {
  drawThrowBeats,
  drawThrowEcho,
  throwCurveFor,
  throwTailSec,
  type ThrowTiming
} from './radioThrows'
import { normalizeSoundSettings, throwEveryBars, type SoundSettings } from './radioSound'
import { audibleRisers } from './riser'
import { evaluateAutomation, normaliseAutomationCurve, type AutomationPoint } from './toolkit'
import { stemKey, type SoundType } from './types'
import { hash32, hashText, seededRandom } from './seededRandom'

/** Rows a throw never picks (stepThrows' NEVER, by SoundType): the floor of the mix stays dry. */
const NEVER: readonly SoundType[] = ['drums', 'bass']

/** Float slack for "inside" comparisons on bars that went through a JSON round trip. */
const EPS = 1e-9

/** One planned throw, in ABSOLUTE arrangement bars. */
export interface TimelineThrow {
  groupId: string
  stemKey: string
  /** A beat of the arrangement (4/4 from bar 0). */
  atBar: number
  beats: number
}

/** The plan for a whole arrangement: the one echo every throw opens into, and the throws in
 * order (never two at once). */
export interface ArrangementThrowPlan {
  echo: { timing: ThrowTiming; feedback: number }
  throws: TimelineThrow[]
}

/** The first beat (a quarter of a bar, from bar 0) at or after `bar`. */
function beatAtOrAfter(bar: number): number {
  return Math.ceil(bar * 4 - EPS) / 4
}

/** Where a placed clip's lane sits: its left edge (the automation lanes' bar 0) and its length,
 * in bars -- the same numbers buildEngineProject sends as the toolkit's `originBar` and the
 * lane is drawn over. */
export function clipLane(
  state: AppState,
  groupId: string
): { originBar: number; lengthBars: number } | undefined {
  const rifff = state.rifffs[groupId]
  if (rifff?.startBar === undefined) return undefined
  const leftCropBars = state.leftCrop[groupId] ?? 0
  return {
    originBar: clipOriginBar({
      startBar: rifff.startBar,
      leftCropBars,
      offsetSteps: state.off[groupId] ?? 0,
      snapDiv: SNAP_DIVS[state.snapIdx]
    }),
    lengthBars: clipLengthBars({
      playedBars: resolvePlayedBars(state, groupId),
      leftCropBars,
      stretchOn: state.stretch[groupId] ?? true,
      rifffBpm: rifff.bpm,
      stateBpm: state.bpm
    })
  }
}

/** A row that may throw somewhere: where it can (`fromBar`..`toBar`), and what can still
 * silence it there (mute regions, a drawn volume curve). */
interface ThrowRow {
  groupId: string
  key: string
  fromBar: number
  toBar: number
  muteRegions: readonly { startBar: number; endBar: number }[]
  originBar: number
  volume: AutomationPoint[]
}

function throwRows(state: AppState): ThrowRow[] {
  const rows: ThrowRow[] = []
  const secPerBar = state.bpm > 0 ? 240 / state.bpm : 0
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const lane = clipLane(state, rifff.groupId)
    if (!lane || !(lane.lengthBars > 0)) continue
    for (const stem of rifff.stems) {
      if (NEVER.includes(stem.type)) continue
      const key = stemKey(rifff.groupId, stem.slot)
      if (state.mute[key]) continue
      if (!((state.vol[key] ?? 1) > 0)) continue
      let fromBar = lane.originBar
      let toBar = lane.originBar + lane.lengthBars
      if (stem.oneShot) {
        // the engine fires a one-shot once, at the rifff's start, for its trimmed length
        if (!(secPerBar > 0)) continue
        const trimStart = Math.max(0, stem.trimStartSec ?? 0)
        const trimEnd =
          stem.trimEndSec !== undefined && stem.trimEndSec >= 0
            ? Math.min(stem.trimEndSec, stem.durationSec)
            : stem.durationSec
        if (!(trimEnd > trimStart)) continue
        fromBar = Math.max(fromBar, rifff.startBar)
        toBar = Math.min(toBar, rifff.startBar + (trimEnd - trimStart) / secPerBar)
      }
      if (!(toBar > fromBar)) continue
      rows.push({
        groupId: rifff.groupId,
        key,
        fromBar,
        toBar,
        muteRegions: state.muteRegions[key] ?? [],
        originBar: lane.originBar,
        volume: normaliseAutomationCurve(state.stemAutomation?.[key]?.volume ?? [])
      })
    }
  }
  return rows
}

/** Whether `row` sounds through the whole of [at, end]. */
function audibleThrough(row: ThrowRow, at: number, end: number): boolean {
  if (at < row.fromBar - EPS || end > row.toBar + EPS) return false
  if (row.muteRegions.some((r) => r.startBar < end - EPS && r.endBar > at + EPS)) return false
  if (row.volume.length === 0) return true
  // the curve is clip-relative; it is linear between its points, so its largest value over the
  // throw is at an end or at one of its points inside
  const from = at - row.originBar
  const to = end - row.originBar
  if (evaluateAutomation(row.volume, from, 1) > 0 || evaluateAutomation(row.volume, to, 1) > 0)
    return true
  return row.volume.some((p) => p.bar > from && p.bar < to && p.value > 0)
}

/**
 * The arrangement's throws (see the module comment for the rule and why it is laid out this way):
 * `settings` are the project's (normalised) throw settings, `seed` the project's seed. Ignores
 * `settings.on` and `settings.level` -- whether the plan is heard is buildEngineProject's
 * business (timelineDubThrows) -- and uses only the rate.
 *
 * Cheap enough to run on every buildEngineProject: one candidate every 8..64 bars, each checking
 * the placed rows once and hashing only the eligible ones.
 */
export function planArrangementThrows(
  state: AppState,
  settings: Pick<SoundSettings['throws'], 'rate'>,
  projectSeed: string
): ArrangementThrowPlan {
  // hashed once, so every label below hashes a short string whatever the project's seed is
  const seed = hashText(projectSeed)
  const echo = drawThrowEcho(seededRandom(`${seed}|echo`))
  const throws: TimelineThrow[] = []
  const endBar = loopLengthBars(state)
  const everyBars = throwEveryBars(settings.rate)
  if (!(endBar > 0) || !(everyBars[0] > 0)) return { echo, throws }

  // The candidates: from the seed and the rate alone. The first is everyBars in, as stepThrows'
  // first barsUntil is.
  const schedule = seededRandom(`${seed}|throws|${settings.rate}`)
  const gap = (): number => everyBars[0] + (everyBars[1] - everyBars[0]) * schedule()
  const candidates: number[] = []
  for (let due = gap(); due < endBar; due += gap()) candidates.push(due)
  if (candidates.length === 0) return { echo, throws }

  const rows = throwRows(state)
  const risers = audibleRisers(state.risers ?? {})
  // The echo's -60 dB tail in BARS (throwTailSec is linear in the delay: a delay in bars gives a
  // tail in bars), the web's own busyUntil measure, so the spacing does not depend on the tempo.
  const delayBars = (echo.timing === 'quarter' ? 1 : 0.75) / 4
  const tailBars = throwTailSec(delayBars, echo.feedback)
  let busyUntil = Number.NEGATIVE_INFINITY

  for (let k = 0; k < candidates.length; k += 1) {
    const beats = drawThrowBeats(seededRandom(`${seed}|throw|${settings.rate}|${k}`))
    // On a beat, and not before the last throw's echo has rung out (stepThrows waits for it).
    const at = Math.max(beatAtOrAfter(candidates[k]), beatAtOrAfter(busyUntil))
    // Waiting ran into the next candidate: stepThrows would have thrown once, so the next one
    // takes it.
    if (k + 1 < candidates.length && at >= candidates[k + 1]) continue
    const end = at + beats / 4
    if (end > endBar + EPS) break
    // over a lead-in: a riser is the timeline's
    if (risers.some((r) => r.startBar < end - EPS && r.startBar + r.lengthBars > at + EPS)) continue
    let best: ThrowRow | undefined
    let bestScore = Infinity
    for (const row of rows) {
      if (!audibleThrough(row, at, end)) continue
      const score = hash32(`${seed}|pick|${settings.rate}|${k}|${row.key}`)
      // ties (vanishingly rare) go to the smaller key, so the order of the rows never matters
      if (score < bestScore || (score === bestScore && best && row.key < best.key)) {
        best = row
        bestScore = score
      }
    }
    if (!best) continue
    throws.push({ groupId: best.groupId, stemKey: best.key, atBar: at, beats })
    busyUntil = end + tailBars
  }
  return { echo, throws }
}

/** The project's planned throws, or undefined when none would be heard: no sound settings,
 * throws off or at level 0, or no tempo. */
export function timelineThrowPlan(state: AppState): ArrangementThrowPlan | undefined {
  if (state.sound === undefined || !(state.bpm > 0)) return undefined
  const { throws } = normalizeSoundSettings(state.sound)
  if (!throws.on || !(throws.level > 0)) return undefined
  return planArrangementThrows(state, throws, state.projectSeed ?? '')
}

/**
 * The timeline's plan as buildEngineProject's `dubThrows`: each throwing stem's send curve, in
 * CLIP-RELATIVE bars (the automation lanes' convention: bar 0 is the clip's left edge, the
 * toolkit's `originBar`), at full level (buildEngineProject scales it by the throw level), and
 * the project's one echo. Undefined when nothing throws.
 *
 * EVERY render of the project passes this, computed from the FULL project: live playback
 * (StoreContext), the mixdown, and each solo render (stem/bus exports, per-clip bakes) -- a solo
 * render's own state has the other rows muted, and planning on it would pick other throws.
 *
 * A throw is drawn with throwCurveFor over the clip's lane (its 5 ms ramps at the project tempo);
 * one that would cross the clip's right edge is refused there and dropped, never cut (the plan
 * already only places whole throws inside a clip).
 */
export function timelineDubThrows(
  state: AppState,
  plan: ArrangementThrowPlan | undefined = timelineThrowPlan(state)
): BuildEngineProjectOptions['dubThrows'] {
  if (!plan || plan.throws.length === 0 || !(state.bpm > 0)) return undefined
  const secPerBar = 240 / state.bpm
  const sends = new Map<string, AutomationPoint[]>()
  for (const t of plan.throws) {
    const lane = clipLane(state, t.groupId)
    if (!lane) continue
    const curve = throwCurveFor(
      // never a hair before the lane's bar 0 from float rounding: the plan placed it inside
      { atBar: Math.max(0, t.atBar - lane.originBar), beats: t.beats },
      lane.lengthBars,
      secPerBar
    )
    if (!curve) continue
    sends.set(t.stemKey, [...(sends.get(t.stemKey) ?? []), ...curve])
  }
  return sends.size > 0 ? { echo: plan.echo, sends } : undefined
}
