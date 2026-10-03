// src/shared/radioFoldLanes.ts
//
// What a runtime does with a fold step (@shared/radioFold) besides the cycles themselves: the
// engine's cycle rows, which rows' stems name their row, the drift as lane curves over one lap,
// the echo a drift's dub send opens into, and the clash's lean on the master. Pure, and shared by
// sssketch's Discover panel and the web radio, so the two cannot read a step differently.

import type { AutomationPoint } from './toolkit'
import {
  radioFoldCanFold,
  type FoldDriftLap,
  type RadioFoldRow,
  type RadioFoldStep
} from './radioFold'
import { radioClashLean, radioClashLeaned } from './radioClash'
import type { SoundSettings } from './radioSound'
import type { ThrowTiming } from './radioThrows'

/** One row of the engine's cycle table (native `stage-cycles`; CycleTable.h), in bars. */
export interface RadioFoldEngineRow {
  row: string
  id: string
  bars: number
  phaseBars: number
}

/** A step's cycles as the engine takes them; none for no step. */
export function radioFoldEngineRows(step: RadioFoldStep | null): RadioFoldEngineRow[] {
  return (step?.cycles ?? []).map((c) => ({
    row: c.rowId,
    id: c.cycleId,
    bars: c.cycleBeats / 4,
    phaseBars: c.phaseBeats / 4
  }))
}

/** The rows whose stems should name their row (EngineStem.cycleRow): every member whose stem is
 * the one a fold in any of `steps` was decided for. A row in `changing` (its stem is about to be
 * replaced by a staged swap) never does: a fold decided for the old stem must not fold the new.
 * A row in `carried` (its change carries the fold, radioFoldCanCarry) is named for its incoming
 * stem. */
export function radioFoldCycleRows(
  steps: readonly (RadioFoldStep | null)[],
  members: readonly { id: string; stemId: string | null }[],
  changing: ReadonlySet<string> = new Set(),
  carried: ReadonlySet<string> = new Set()
): Set<string> {
  const out = new Set<string>()
  for (const m of members) {
    if (m.stemId === null) continue
    // a change carrying the row's fold (radioFoldCanCarry): its incoming stem takes the running
    // cycle, so the row is named whatever stem the steps were decided for
    if (carried.has(m.id) && steps.some((s) => s?.cycles.some((c) => c.rowId === m.id))) {
      out.add(m.id)
      continue
    }
    if (changing.has(m.id)) continue
    if (steps.some((s) => s?.cycles.some((c) => c.rowId === m.id && c.stemId === m.stemId))) {
      out.add(m.id)
    }
  }
  return out
}

/** One row's drift over one lap as lane curves (clip-relative bars, 0 .. loopBars): the cutoff as
 * is, the reverb send as the row's own send plus the drift (never past 1), the dub send as is.
 * Each is held FLAT at the lap's own (start) value, not ramped across it: a runtime pushes a lap's
 * lanes a little after its top, and until they land the engine replays the previous lap's from
 * bar 0. A ramp would step back to the previous lap's start and then forward again, twice a lap;
 * flat lanes leave one step per top, at most an eighth of a range (FOLD_DRIFT_MIN_SWEEP_LAPS). */
export function radioFoldDriftCurves(
  lap: FoldDriftLap,
  loopBars: number,
  ownSend: number
): { cutoff: AutomationPoint[]; send: AutomationPoint[]; dub: AutomationPoint[] } {
  const flat = ([a]: readonly [number, number], f: (v: number) => number): AutomationPoint[] => [
    { bar: 0, value: f(a) },
    { bar: loopBars, value: f(a) }
  ]
  return {
    cutoff: flat(lap.cutoff, (v) => v),
    send: flat(lap.send, (v) => Math.min(1, ownSend + v)),
    dub: flat(lap.dub, (v) => v)
  }
}

/** The echo a drift's dub send opens into when no throw has set one: a dotted eighth, a short
 * tail -- the throws' own gentlest draw (radioThrows' ranges). */
export const FOLD_DRIFT_ECHO: Readonly<{ timing: ThrowTiming; feedback: number }> = Object.freeze({
  timing: 'dotted-eighth',
  feedback: 0.35
})

/** The listener's sound with the clash's lean on the master glue and saturation (radioClashLean):
 * the same object when there is no lean. */
export function radioFoldSound(
  sound: SoundSettings,
  foldMode: boolean,
  clash: number
): SoundSettings {
  const lean = radioClashLean(foldMode, clash)
  if (!(lean > 0)) return sound
  return {
    ...sound,
    glue: { ...sound.glue, amount: radioClashLeaned(sound.glue.amount, lean) },
    saturation: { ...sound.saturation, amount: radioClashLeaned(sound.saturation.amount, lean) }
  }
}

/** A row as a runtime knows it at a wrap, before that wrap's landings have reached it: its stem,
 * and its length while resolved (null otherwise). `previewing`: in the mix. */
export interface RadioFoldRowNow extends Omit<RadioFoldRow, 'barLength' | 'audible'> {
  barLength: number | null
  previewing: boolean
}

/** A change landing on a row at this wrap: the stem it brings, and that stem's length and type
 * when it has resolved (barLength null while it has not). */
export interface RadioFoldLanding {
  stemId: string | null
  barLength: number | null
  percussive: boolean
}

/** The rows as the machine should see them for the lap after a wrap (sssketch's Discover, which
 * steps after that wrap's landings and the density arc's decision; the web's foldRows): every
 * landing's stem over the row's old one, and `exitingId` -- the row the arc is taking out before
 * the next top -- unheard. A row is heard while it is in the mix with a known length. */
export function radioFoldRowsAt(
  rows: readonly RadioFoldRowNow[],
  landed: ReadonlyMap<string, RadioFoldLanding>,
  exitingId: string | null
): RadioFoldRow[] {
  return rows.map((r) => {
    const l = landed.get(r.id)
    const barLength = l ? l.barLength : r.barLength
    return {
      id: r.id,
      stemId: l ? l.stemId : r.stemId,
      kinds: r.kinds,
      barLength: barLength ?? 0,
      hooked: r.hooked,
      audible: r.previewing && barLength !== null && r.id !== exitingId,
      percussive: l ? l.percussive : r.percussive
    }
  })
}

/** One line per fold step for a dev log, so a walkthrough can tell "nothing qualifies" (no
 * anchor, no row foldable) from a machine that should be folding and is not: the lap, the anchor,
 * the stretch, a realignment top, how many of the heard rows could fold, and every row the
 * machine holds with its cycle now, its target and its full length, in beats. */
export function radioFoldStepLine(step: RadioFoldStep, rows: readonly RadioFoldRow[]): string {
  const heard = rows.filter((r) => r.audible && r.barLength > 0).length
  const foldable = rows.filter((r) => radioFoldCanFold(r, step.anchorId)).length
  const folds = step.state.rows.map(
    (r) => `${r.rowId} ${r.cycleBeats}->${r.targetBeats}/${r.fullBeats}b ${r.mode}`
  )
  return [
    `[radio-fold] lap ${step.lap}`,
    `anchor ${step.anchorId ?? 'none'}`,
    `stretch ${step.stretch}`,
    ...(step.marked ? ['marked'] : []),
    `foldable ${foldable}/${heard} heard`,
    `folds ${folds.length > 0 ? folds.join(', ') : 'none'}`
  ].join(' · ')
}
