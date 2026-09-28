// src/shared/radioDropOut.ts
//
// Radio's standalone drop-out -- docs/superpowers/specs/2026-09-28-radio-
// controls-design.md section 4. Elling, 2026-09-28: "yep, holes = good.
// drop out the drums for a few beats or something", and then "drums drop
// out rarely... rarely i think. since it's working quite well currently."
//
// A drop-out is NOT a stem change. Radio occasionally mutes one layer for
// a few beats and brings it back at the top of the loop, and that is the
// whole feature. It is pure arrangement: nothing is chosen, fetched or
// rendered.
//
// Everything here is pure and takes its randomness injected, both so it
// can be tested deterministically and because this repo's
// react-hooks/purity rule rejects a bare Math.random() inside a
// component-scoped function.
import type { DiscoverSlotKind } from './discoverSlotKind'

export type RadioDropOuts = 'off' | 'rare' | 'often'

export const RADIO_DROP_OUT_OPTIONS: RadioDropOuts[] = ['off', 'rare', 'often']

/** `rare`, not `off`. He asked for the feature, and a feature that ships
 * switched off is one he never hears -- so it ships ON at its rarest
 * setting, with `off` sitting right beside it in the menu for the day it
 * gets in the way. "Optional" is about being able to turn it off, not
 * about having to turn it on. */
export const DEFAULT_RADIO_DROP_OUTS: RadioDropOuts = 'rare'

/** Chance that the coming interval contains a drop-out. Rolled ONCE per
 * interval, right where radio already picks its next stem -- no second
 * clock.
 *
 * `rare` is the default and it is deliberately sparse. `mid` draws 8-16
 * bars (retuned 0eab8b4), mean 12, so 12 / 0.15 = a drop-out every 80
 * bars on average -- getting on for three minutes at 120bpm, and rarer
 * still in practice because the `loop end` grid rounds every interval up
 * to the next loop top. `often` gives about 30 bars, a minute or so. If
 * it happened every lap it would be a rhythm rather than a gesture, and
 * the point of the feature would be gone. */
export const RADIO_DROP_OUT_CHANCE: Record<RadioDropOuts, number> = {
  off: 0,
  rare: 0.15,
  often: 0.4
}

export function normalizeRadioDropOuts(value: unknown): RadioDropOuts {
  return RADIO_DROP_OUT_OPTIONS.includes(value as RadioDropOuts)
    ? (value as RadioDropOuts)
    : DEFAULT_RADIO_DROP_OUTS
}

export function shouldScheduleDropOut(
  rate: RadioDropOuts,
  random: () => number = Math.random
): boolean {
  const chance = RADIO_DROP_OUT_CHANCE[rate]
  if (chance <= 0) return false
  return random() < chance
}

/** Only a drums or a bass layer. Dropping a pad or a texture is close to
 * inaudible and reads as a bug rather than a gesture: the move works
 * because the ear is COUNTING on the thing that disappears.
 *
 * `lead` is deliberately out -- dropping the melody for two beats is a
 * real move and also exactly what a mistake sounds like, and the
 * difference depends on material this cannot see. Trait-only slots
 * (chonky/rhythmic/sparkly/buttery) have no instrument identity at all.
 * Both are named on the spec's "not now" list rather than forgotten. */
export const DROP_OUT_ELIGIBLE_KINDS: DiscoverSlotKind[] = ['drums', 'bass']

/** Drums three to one over bass. Drums is the classic; bass is the other
 * one, because its absence sets up a return. */
const DROP_OUT_KIND_WEIGHT: Record<string, number> = { drums: 3, bass: 1 }

export interface DropOutCandidate {
  id: string
  kinds: DiscoverSlotKind[]
}

/** Which layer drops out, or null for "not this time".
 *
 * Null rather than an error for every legitimate reason: nothing eligible,
 * or only ONE audible layer -- a drop-out that leaves silence is a
 * different and much riskier move (the breakdown, spec 4.7, explicitly not
 * now). The caller passes only the slots that are currently audible, so
 * `candidates.length < 2` is exactly the "would leave silence" test.
 *
 * A combination slot counts as its strongest eligible kind, so a
 * drums+rhythmic slot is drums. */
export function pickDropOutSlotId(
  candidates: readonly DropOutCandidate[],
  random: () => number = Math.random
): string | null {
  if (candidates.length < 2) return null
  const weighted = candidates
    .map((c) => ({
      id: c.id,
      weight: Math.max(0, ...c.kinds.map((k) => DROP_OUT_KIND_WEIGHT[k] ?? 0))
    }))
    .filter((c) => c.weight > 0)
  if (weighted.length === 0) return null
  const total = weighted.reduce((sum, c) => sum + c.weight, 0)
  let draw = random() * total
  for (const c of weighted) {
    draw -= c.weight
    if (draw < 0) return c.id
  }
  return weighted[weighted.length - 1].id
}

/** How long, in beats. Weighted rather than fixed for the same reason the
 * pace is a window rather than a number: a fixed length is a rhythm, a
 * varied length is a gesture. Two beats is the safe and common one; a full
 * bar is the dramatic one. */
const DROP_OUT_BEAT_WEIGHTS: { beats: number; weight: number }[] = [
  { beats: 1, weight: 0.2 },
  { beats: 2, weight: 0.5 },
  { beats: 4, weight: 0.3 }
]

export function pickDropOutBeats(random: () => number = Math.random): number {
  let draw = random()
  for (const { beats, weight } of DROP_OUT_BEAT_WEIGHTS) {
    draw -= weight
    if (draw < 0) return beats
  }
  return DROP_OUT_BEAT_WEIGHTS[DROP_OUT_BEAT_WEIGHTS.length - 1].beats
}
