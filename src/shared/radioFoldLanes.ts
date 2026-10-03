// src/shared/radioFoldLanes.ts
//
// What a runtime does with a fold step (@shared/radioFold) besides the cycles themselves: the
// engine's cycle rows, which rows' stems name their row, the drift as lane curves over one lap,
// the echo a drift's dub send opens into, and the clash's lean on the master. Pure, and shared by
// sssketch's Discover panel and the web radio, so the two cannot read a step differently.

import type { AutomationPoint } from './toolkit'
import type { RadioFoldStep, FoldDriftLap } from './radioFold'
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
 * replaced by a staged swap) never does: a fold decided for the old stem must not fold the new. */
export function radioFoldCycleRows(
  steps: readonly (RadioFoldStep | null)[],
  members: readonly { id: string; stemId: string | null }[],
  changing: ReadonlySet<string> = new Set()
): Set<string> {
  const out = new Set<string>()
  for (const m of members) {
    if (m.stemId === null || changing.has(m.id)) continue
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
