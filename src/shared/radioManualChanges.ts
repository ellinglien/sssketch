// src/shared/radioManualChanges.ts
//
// While radio runs, a MANUAL change -- a reroll, a nearby-jam pick, an
// added or duplicated row -- waits for the next loop top and lands with a
// transition, together with radio's own change, in one staged swap
// (docs/superpowers/specs/2026-09-29-radio-manual-changes-land-on-the-top-
// design.md). These are the two rules that decide what that swap carries.

import type { DiscoverSlotKind } from './discoverSlotKind'
import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'

export interface ManualArrival {
  kind: RadioTransitionKind
  beats: number
}

/** How long each gesture takes, in beats -- the table radio's own two
 * decision branches already use: a hole is a drop-out of the drawn length,
 * a riser two bars, everything else one bar. */
function beatsFor(kind: RadioTransitionKind, dropOutBeats: () => number): number {
  if (kind === 'hole') return dropOutBeats()
  if (kind === 'riser') return 8
  return 4
}

/** A transition for every row changing at this wrap.
 *
 * Arrival gestures (filter in, bloom, duck) ride their own stem and may
 * land on several rows at once. A LEADING gesture (hole, riser) plays on
 * the outgoing stem over the bars BEFORE the wrap, so at most one can be
 * live in a lap -- radio's own rule -- and only when there is room for it
 * before the wrap. Any leading gesture that cannot be granted becomes a
 * cut, which is what radio's due branch does when a gesture is already
 * armed. */
export function drawManualTransitions(
  rows: readonly { slotId: string; kinds: readonly DiscoverSlotKind[] }[],
  options: {
    pick: (kinds: readonly DiscoverSlotKind[]) => RadioTransitionKind
    dropOutBeats: () => number
    /** A hole, riser or standalone drop-out is already armed this lap. */
    leadingArmed: boolean
    barsToWrap: number
  }
): Map<string, ManualArrival> {
  const out = new Map<string, ManualArrival>()
  let leadingTaken = options.leadingArmed
  for (const row of rows) {
    let kind = options.pick(row.kinds)
    let beats = beatsFor(kind, options.dropOutBeats)
    if (radioGestureLeadsChange(kind)) {
      if (leadingTaken || beats / 4 > options.barsToWrap) {
        kind = 'cut'
        beats = 4
      } else {
        leadingTaken = true
      }
    }
    out.set(row.slotId, { kind, beats })
  }
  return out
}

/** Radio's held change and the manual queue, as one staged swap.
 *
 * A manual change on the row radio was about to turn over wins: the user
 * pointed at that row, radio only drew it. Generic over the stem type so
 * this stays free of the renderer's own stem shape. */
export function mergeStageChanges<S>(
  radioLed: { slotId: string; stem: S; arrival?: ManualArrival } | null,
  manual: ReadonlyMap<string, { stem: S; joining: boolean; arrival: ManualArrival | null }>
): {
  changes: { slotId: string; stem: S }[]
  joining: string[]
  arrivals: ({ slotId: string } & ManualArrival)[]
} {
  const changes: { slotId: string; stem: S }[] = []
  const joining: string[] = []
  const arrivals: ({ slotId: string } & ManualArrival)[] = []
  if (radioLed !== null && !manual.has(radioLed.slotId)) {
    changes.push({ slotId: radioLed.slotId, stem: radioLed.stem })
    if (radioLed.arrival) arrivals.push({ slotId: radioLed.slotId, ...radioLed.arrival })
  }
  for (const [slotId, change] of manual) {
    changes.push({ slotId, stem: change.stem })
    if (change.joining) joining.push(slotId)
    if (change.arrival !== null && change.arrival.kind !== 'cut') {
      arrivals.push({ slotId, ...change.arrival })
    }
  }
  return { changes, joining, arrivals }
}
