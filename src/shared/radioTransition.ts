// src/shared/radioTransition.ts
//
// Radio's transitions -- docs/superpowers/specs/2026-09-28-radio-controls-
// design.md section 5. Only the SETTING's shape exists so far: the
// temperament weighting and the curve builders are phase E, and nothing
// reads `RadioSettings.transitions` until they land.
//
// The shape ships early on purpose. It is the one field whose absence
// would force a second settings migration later, and a migration is the
// part of this that touches a real file on a real user's disk.
//
// Phase E (2026-09-28) made it real: the temperament below now picks a
// weighted gesture per change, and the curve builders at the bottom of
// this file are what the engine actually performs.
import type { DiscoverSlotKind } from './discoverSlotKind'

export type RadioTransitions = 'off' | 'subtle' | 'bold'

export const RADIO_TRANSITIONS_OPTIONS: RadioTransitions[] = ['off', 'subtle', 'bold']

export const DEFAULT_RADIO_TRANSITIONS: RadioTransitions = 'subtle'

export function normalizeRadioTransitions(value: unknown): RadioTransitions {
  return RADIO_TRANSITIONS_OPTIONS.includes(value as RadioTransitions)
    ? (value as RadioTransitions)
    : DEFAULT_RADIO_TRANSITIONS
}

/** The one-stem palette. Every one of these acts on stems that are ALREADY
 * in the project when the gesture is armed, which is what keeps them clear
 * of the three renderer-side 1:1 assumptions a crossfade would hit (spec
 * 5.4: slotIndexById's Map<string, number>, setRemoteLoop's positional id
 * pairing, and the "no unrelated load-project mid-transition" rule).
 *
 * Two of them run BEFORE the change they decorate and three run WITH it.
 * `hole` and `riser` announce a change -- the layer leaves a gap, or a
 * noise sweep builds -- so the change they belong to is held back to the
 * loop top they end on. `filter in`, `bloom` and `duck` are how the new
 * layer ARRIVES, so they are armed on the change itself. DiscoverPanel's
 * radioGestureLeadsChange owns that split; nothing here needs to know it
 * except that the two halves exist. */
export type RadioTransitionKind = 'cut' | 'hole' | 'filter in' | 'bloom' | 'duck' | 'riser'

/** THE TEMPERAMENT CHOOSES THE MOOD, THE KIND CHOOSES THE WEIGHTS.
 *
 * A single fixed transition is a rhythm -- the same failure the pace
 * windows exist to avoid; it would be perverse to randomise WHEN a change
 * happens and then make HOW it happens perfectly predictable. And a
 * per-kind matrix is musically right (a drum layer cutting while a pad
 * blooms is obviously correct) but it is a grid the user has to fill in,
 * which is a lot of UI for a control that should be pressed and listened
 * to.
 *
 * So the menu picks a temperament and the changing slot's kind picks the
 * weights inside it. Per-kind musicality, zero per-kind UI, and the whole
 * table is a pure value so it can be argued with and adjusted without
 * touching a component. */
type WeightTable = Partial<Record<RadioTransitionKind, number>>

const DRUMMY: { subtle: WeightTable; bold: WeightTable } = {
  // A drum layer wants a cut or a hole. A bloom on drums is a wash.
  subtle: { cut: 0.6, hole: 0.3, 'filter in': 0.1 },
  bold: { cut: 0.35, hole: 0.35, 'filter in': 0.1, duck: 0.1, riser: 0.1 }
}

const PADDY: { subtle: WeightTable; bold: WeightTable } = {
  // A pad or a texture is where a filter sweep and a reverb bloom belong.
  subtle: { cut: 0.4, 'filter in': 0.4, bloom: 0.2 },
  bold: { cut: 0.2, 'filter in': 0.3, bloom: 0.25, duck: 0.15, riser: 0.1 }
}

const MELODIC: { subtle: WeightTable; bold: WeightTable } = {
  subtle: { cut: 0.5, hole: 0.2, 'filter in': 0.3 },
  bold: { cut: 0.3, hole: 0.15, 'filter in': 0.25, bloom: 0.1, duck: 0.1, riser: 0.1 }
}

/** `drums` first, because a combination slot carrying it is a drum layer
 * for this purpose whatever else it also carries -- the same "strongest
 * eligible kind wins" reading radioDropOut's own weighting uses. The four
 * trait kinds (bassHeavy/rhythmic/bright/warm) have no instrument identity
 * and fall to PADDY, which is where a sweep and a bloom belong. */
function tableFor(temperament: 'subtle' | 'bold', kinds: readonly DiscoverSlotKind[]): WeightTable {
  if (kinds.includes('drums')) return DRUMMY[temperament]
  if (kinds.includes('bass') || kinds.includes('lead')) return MELODIC[temperament]
  if (kinds.length > 0) return PADDY[temperament]
  return { cut: 1 }
}

/** Which transition this change gets. `off` is always `cut`, which is
 * exactly what shipped 2026-09-26 -- and `cut` arms nothing at all, so a
 * cut project is byte-identical to a pre-transition one. */
export function pickTransition(
  temperament: RadioTransitions,
  kinds: readonly DiscoverSlotKind[],
  random: () => number = Math.random
): RadioTransitionKind {
  if (temperament === 'off') return 'cut'
  const table = tableFor(temperament, kinds)
  const entries = Object.entries(table) as [RadioTransitionKind, number][]
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  if (!(total > 0)) return 'cut'
  let draw = random() * total
  for (const [kind, weight] of entries) {
    draw -= weight
    if (draw < 0) return kind
  }
  return 'cut'
}
