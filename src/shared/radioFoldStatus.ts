// src/shared/radioFoldStatus.ts
//
// What fold mode is doing, said plainly (spec 2026-10-03-radio-fold-v2-design.md section 2): the
// status line both radios show while the mode is on, and each folded row's readout (`7 / 16`, its
// cycle against the loop in beats) with a phase dot that travels round the cycle and sits on the
// downbeat at realignment. Pure, and shared, so sssketch's Discover and the web radio say the same.

import {
  DEFAULT_RADIO_FOLD,
  normalizeFoldAmount,
  radioFoldRowRealignsAt,
  type RadioFoldRowState,
  type RadioFoldState,
  type RadioFoldStep
} from './radioFold'

/** How far ahead the status looks for a realignment, in laps. */
export const FOLD_STATUS_HORIZON_LAPS = 32

export interface RadioFoldStatusRow {
  rowId: string
  cycleBeats: number
  fullBeats: number
  phaseBeats: number
  mode: RadioFoldRowState['mode']
  /** Whole laps from the cycle's origin top to the top of the lap playing (0 on its first). */
  lapsIn: number
}

export interface RadioFoldStatus {
  stretch: 'folded' | 'straight'
  /** The rows folded in the lap playing. */
  rows: RadioFoldStatusRow[]
  /** Laps until the next realignment top, counted from the top of the lap playing; null for
   * none within FOLD_STATUS_HORIZON_LAPS. */
  realignsInLaps: number | null
  /** Bars until radio's next change, as the runtime counts it; null when it does not know. */
  nextChangeBars: number | null
  /** The one line: `folded · 2 rows · realigns in 3 laps · next change ~20 bars`. */
  summary: string
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The status for the lap playing. `state`: the machine's latest (it decided the lap after the
 * one playing, or the one playing until that step has run); `step`: the step that decided the
 * lap playing, null before there is one. `bend` is the `fold` fader (0 never folds again);
 * `intervalBarsLeft` the runtime's own count to the next change. Null without a machine. */
export function radioFoldStatus(
  state: RadioFoldState | null,
  step: RadioFoldStep | null,
  loopBars: number,
  bend: number,
  intervalBarsLeft: number | null
): RadioFoldStatus | null {
  if (state === null || state.lap < 0) return null
  const playing = step?.lap ?? state.lap - 1
  const stretch = step?.stretch ?? 'straight'
  const rows: RadioFoldStatusRow[] = (step?.state.rows ?? []).map((r) => ({
    rowId: r.rowId,
    cycleBeats: r.cycleBeats,
    fullBeats: r.fullBeats,
    phaseBeats: r.phaseBeats,
    mode: r.mode,
    lapsIn: Math.max(0, playing - r.originLap)
  }))
  const loopBeats = loopBars * 4
  let realignsInLaps: number | null = state.lap === playing + 1 && state.marked ? 1 : null
  if (loopBeats > 0) {
    for (let k = 1; k <= FOLD_STATUS_HORIZON_LAPS && realignsInLaps === null; k++) {
      const lap = playing + k
      const hit = state.rows.some(
        (r) =>
          r.mode === 'settled' &&
          r.unfoldSince === null &&
          radioFoldRowRealignsAt(r, lap, loopBeats)
      )
      if (hit) realignsInLaps = k
    }
  }
  const nextChangeBars =
    intervalBarsLeft !== null && Number.isFinite(intervalBarsLeft)
      ? Math.max(0, Math.round(intervalBarsLeft))
      : null
  const parts: string[] = [stretch]
  if (stretch === 'folded') {
    parts.push(rows.length === 0 ? 'nothing to fold' : plural(rows.length, 'row'))
    if (realignsInLaps !== null) parts.push(`realigns in ${plural(realignsInLaps, 'lap')}`)
    if (nextChangeBars !== null) parts.push(`next change ~${plural(nextChangeBars, 'bar')}`)
  } else if (rows.length > 0) {
    parts.push('unfolding')
  } else if (normalizeFoldAmount(bend, DEFAULT_RADIO_FOLD) > 0) {
    parts.push(`folding in ${plural(Math.max(1, state.stretchEndsLap - playing), 'lap')}`)
  }
  return { stretch, rows, realignsInLaps, nextChangeBars, summary: parts.join(' · ') }
}

/** Beats as the readout writes them: whole, or with a half as ½ (3.5 is `3½`). */
export function radioFoldBeatsLabel(beats: number): string {
  const whole = Math.floor(beats + 1e-9)
  const half = beats - whole >= 0.5 - 1e-9
  return half ? `${whole === 0 ? '' : whole}½` : String(whole)
}

/** A folded row's readout: its cycle against the loop, in beats (`7 / 16`, `3½ / 16`). */
export function radioFoldRowLabel(cycleBeats: number, loopBeats: number): string {
  return `${radioFoldBeatsLabel(cycleBeats)} / ${radioFoldBeatsLabel(loopBeats)}`
}

/** The phase dot, 0..1 round the cycle: ((beats since the cycle's origin - phase) mod cycle) /
 * cycle. 0 is the cycle's downbeat, where it sits when the row realigns with the loop. */
export function radioFoldPhaseDot(cycleBeats: number, phaseBeats: number, beatsIn: number): number {
  if (!(cycleBeats > 0) || !Number.isFinite(beatsIn)) return 0
  const x = (beatsIn - phaseBeats) % cycleBeats
  return (x < 0 ? x + cycleBeats : x) / cycleBeats
}

/** Beats since a status row's cycle began, at `posBars` into the lap playing. */
export function radioFoldBeatsIn(
  row: RadioFoldStatusRow,
  loopBars: number,
  posBars: number
): number {
  return (row.lapsIn * loopBars + posBars) * 4
}
