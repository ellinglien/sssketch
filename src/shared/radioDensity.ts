// src/shared/radioDensity.ts
//
// THE DENSITY ARC (Elling, 2026-10-01: "sometimes minimal, grow into
// maximal", then "5 as the top"). While radio runs, the number of rows
// grows toward a drawn peak and thins back to a drawn trough, one row per
// step, each leg 96-192 bars long. First built in the web radio
// (ell.ing/radio src/radio/step.ts); these are the pure rules, shared.
//
// Discover is not the web radio: Elling adds, removes and padlocks rows by
// hand. So in Discover (decided 2026-10-01):
//   - HIS rows count toward the total, but the arc only ever REMOVES rows
//     radio added itself, never a padlocked, soloed or held one, and never
//     the last drums or bass;
//   - a growing leg never removes and a thinning one never adds, so rows
//     he added above the peak simply turn the arc round rather than being
//     fought;
//   - with the arc on, an empty panel starts at DENSITY_MIN rows (drums,
//     bass) instead of `channels`.

import type { DiscoverSlotKind } from './discoverSlotKind'
import { pickDropOutBeats } from './radioDropOut'
import {
  RADIO_CHANNELS_MAX,
  nextRadioIntervalBarsInWindow,
  radioStarterKinds
} from './radioSchedule'
import { pickTransition, type RadioTransitionKind, type RadioTransitions } from './radioTransition'
import { radioGestureBeats } from './radioManualChanges'

// The setting itself lives with the rest of RadioSettings (radioSchedule),
// re-exported here so the arc's rules read in one place.
export {
  DEFAULT_RADIO_DENSITY,
  RADIO_DENSITY_OPTIONS,
  normalizeRadioDensity,
  type RadioDensity
} from './radioSchedule'

/** Fewest and most rows the arc aims for; an empty panel starts at MIN. */
export const DENSITY_MIN = 2 // Elling: slow arc 2→5
export const DENSITY_MAX = 5 // Elling: slow arc 2→5 ("5 as the top")
/** Each leg's top and bottom, drawn (whole rows, both inclusive). */
export const DENSITY_PEAK = { min: 4, max: 5 } as const
export const DENSITY_TROUGH = { min: 2, max: 3 } as const
/** Bars a leg (up, or down) takes, drawn. */
export const DENSITY_LEG_BARS: readonly [number, number] = [96, 192]

export interface DensityLeg {
  phase: 'growing' | 'thinning'
  /** The row count this leg heads for. */
  target: number
  /** Bars since the leg began or its last step, counted lap by lap. */
  bars: number
  /** Bars between steps: the leg's length over the steps it needs. */
  stepBars: number
}

/** A new leg from `count` rows: up to a drawn peak, or down to a drawn trough. */
export function newDensityLeg(
  phase: DensityLeg['phase'],
  count: number,
  random: () => number = Math.random
): DensityLeg {
  const window = phase === 'growing' ? DENSITY_PEAK : DENSITY_TROUGH
  const target = Math.min(
    DENSITY_MAX,
    Math.max(DENSITY_MIN, nextRadioIntervalBarsInWindow(window, random))
  )
  const legBars = nextRadioIntervalBarsInWindow(
    { min: DENSITY_LEG_BARS[0], max: DENSITY_LEG_BARS[1] },
    random
  )
  return { phase, target, bars: 0, stepBars: legBars / Math.max(1, Math.abs(target - count)) }
}

/** One loop top. The leg's bars add up; once a step's worth is in (and no
 * step is still on its way), the arc adds or removes one row -- or, when
 * it is at its target, cannot take its step, or the rows are on the wrong
 * side of it, it turns round instead. */
export function advanceDensityLeg(
  leg: DensityLeg,
  input: {
    count: number
    loopBars: number
    /** A row joining or leaving is still on its way. */
    busy: boolean
    canAdd: boolean
    canRemove: boolean
    random?: () => number
    /** Sized builds (radioBuildSize's radioArcStepWaits): a step that is ready waits for a phrase
     * start -- its bars keep counting, nothing turns. Absent: today. */
    waits?: boolean
  }
): { leg: DensityLeg; step: 'add' | 'remove' | null } {
  const bars = leg.bars + (input.loopBars > 0 ? input.loopBars : 0)
  const counted = { ...leg, bars }
  if (input.busy || bars < leg.stepBars) return { leg: counted, step: null }
  const turn = (): { leg: DensityLeg; step: null } => ({
    leg: newDensityLeg(leg.phase === 'growing' ? 'thinning' : 'growing', input.count, input.random),
    step: null
  })
  if (leg.phase === 'growing') {
    if (input.count >= leg.target || !input.canAdd) return turn()
    if (input.waits === true) return { leg: counted, step: null }
    return { leg: { ...counted, bars: 0 }, step: 'add' }
  }
  if (input.count <= leg.target || !input.canRemove) return turn()
  if (input.waits === true) return { leg: counted, step: null }
  return { leg: { ...counted, bars: 0 }, step: 'remove' }
}

/** The kind a growing arc adds: the first place in radio's starter order
 * (drums, bass, lead, warm, drums) the rows do not already fill -- his rows
 * included, and a combination row counting for each of its kinds. Null
 * once the first DENSITY_MAX places are all filled. */
export function nextArcKind(
  rows: readonly (readonly DiscoverSlotKind[])[]
): DiscoverSlotKind | null {
  const order = radioStarterKinds(RADIO_CHANNELS_MAX).slice(0, DENSITY_MAX)
  const have = new Map<DiscoverSlotKind, number>()
  for (const kinds of rows) for (const k of new Set(kinds)) have.set(k, (have.get(k) ?? 0) + 1)
  const wanted = new Map<DiscoverSlotKind, number>()
  for (const k of order) {
    wanted.set(k, (wanted.get(k) ?? 0) + 1)
    if ((have.get(k) ?? 0) < wanted.get(k)!) return k
  }
  return null
}

/** What pickArcRemoval needs to know about a row. */
export interface ArcRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  /** Radio laid it down or the arc added it -- the only rows it removes. */
  radioAdded: boolean
  locked: boolean
  soloed: boolean
  /** Reserved by a hook (radioHooks' radioHookReservesRow: in, away or resting): the arc never
   * takes a hook's home row. */
  held: boolean
  /** Heard now (absent: true). A hook resting leaves its row unheard: it does not count as the
   * last of its kind, so the remaining drums or bass row stays protected. */
  heard?: boolean
  /** A change waiting, radio's decided change, or a stem still resolving. */
  busy: boolean
  /** It is the only row as long as the loop: removing it would shorten
   * the loop mid-lap. */
  shrinksLoop: boolean
  /** Turns since it last changed (higher is staler). */
  staleness: number
}

/** A thinning arc's row on its way out (sssketch's arcExitRef): waiting for its drop-out to be
 * armed, or fading in the lap `lap`. */
export interface ArcExit {
  slotId: string
  phase: 'waiting' | 'fading'
  lap: number
}

/** The row the arc is taking out before the next top, which a decision for the lap after it
 * treats as unheard (the turnaround's roll, the fold step): one fading in this lap, or one
 * waiting whose exit is not held back (a stage out, a drop-out or lead-in armed), since it will
 * arm and go silent this lap. Null for none. */
export function arcExitingRow(exit: ArcExit | null, lap: number, heldBack: boolean): string | null {
  if (exit === null) return null
  if (exit.phase === 'fading') return exit.lap === lap ? exit.slotId : null
  return heldBack ? null : exit.slotId
}

/** Which row a thinning arc removes: the stalest it is allowed to, or null. */
export function pickArcRemoval(rows: readonly ArcRow[]): string | null {
  const lastOfItsKind = (r: ArcRow): boolean =>
    r.kinds.some(
      (k) =>
        (k === 'drums' || k === 'bass') &&
        !rows.some((o) => o.id !== r.id && o.heard !== false && o.kinds.includes(k))
    )
  let best: ArcRow | null = null
  for (const r of rows) {
    if (!r.radioAdded || r.locked || r.soloed || r.held || r.busy || r.shrinksLoop) continue
    if (lastOfItsKind(r)) continue
    if (best === null || r.staleness > best.staleness) best = r
  }
  return best?.id ?? null
}

/** How a row the arc adds arrives: a filter in or a bloom (the two that
 * bring a layer in from nothing), drawn from the transitions temperament
 * and the row's kinds -- `subtle` when transitions are off, since a row
 * the arc adds always arrives with one. */
export function densityArrival(
  transitions: RadioTransitions,
  kinds: readonly DiscoverSlotKind[],
  random: () => number = Math.random
): { kind: RadioTransitionKind; beats: number } {
  const temperament = transitions === 'off' ? 'subtle' : transitions
  let kind: RadioTransitionKind = 'filter in'
  for (let i = 0; i < 16; i++) {
    const k = pickTransition(temperament, kinds, random)
    if (k === 'filter in' || k === 'bloom') {
      kind = k
      break
    }
  }
  return { kind, beats: radioGestureBeats(kind, () => pickDropOutBeats(random)) }
}
