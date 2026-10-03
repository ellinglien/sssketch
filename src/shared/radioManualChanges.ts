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

/** How long each gesture takes, in beats -- the one table for radio's
 * decision branches and the manual queue: a hole is a drop-out of the drawn
 * length, a riser two bars, everything else one bar. */
export function radioGestureBeats(kind: RadioTransitionKind, dropOutBeats: () => number): number {
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
 * armed.
 *
 * A row with `canLead: false` (a JOINING row, which has no outgoing stem
 * for a hole or a riser to play on) turns a drawn leading gesture into a
 * cut WITHOUT taking the lap's one leading slot, so the next row may still
 * lead. `canLead` defaults to true. */
export function drawManualTransitions(
  rows: readonly { slotId: string; kinds: readonly DiscoverSlotKind[]; canLead?: boolean }[],
  options: {
    pick: (kinds: readonly DiscoverSlotKind[]) => RadioTransitionKind
    dropOutBeats: () => number
    /** The lap's leading slot is taken: a hole, a riser or the density arc's exit drop-out is
     * armed, or a phrase turnaround is (it is the lap's lead-in). */
    leadingArmed: boolean
    /** Bars from now to the wrap. Not a finite positive number means the
     * position is unknown, and no leading gesture is granted. */
    barsToWrap: number
    /** The loop's length in bars. Same rule for an unusable value. */
    loopBars: number
  }
): Map<string, ManualArrival> {
  const out = new Map<string, ManualArrival>()
  let leadingTaken = options.leadingArmed
  for (const row of rows) {
    let kind = options.pick(row.kinds)
    let beats = radioGestureBeats(kind, options.dropOutBeats)
    if (radioGestureLeadsChange(kind)) {
      // The curve is clamped to half the loop (clampToHalfLoop in
      // radioTransition.ts, private there), so a riser on a short loop is
      // shorter than its nominal length and may still fit.
      const usable =
        Number.isFinite(options.barsToWrap) &&
        options.barsToWrap > 0 &&
        Number.isFinite(options.loopBars) &&
        options.loopBars > 0
      const bars = Math.min(beats / 4, options.loopBars / 2)
      if (row.canLead === false || leadingTaken || !usable || bars > options.barsToWrap) {
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

function carriesAsArrival(kind: RadioTransitionKind): boolean {
  return kind !== 'cut' && !radioGestureLeadsChange(kind)
}

/** Radio's held change and the manual queue, as one staged swap.
 *
 * Only ARRIVAL gestures are carried. A hole or riser plays on the OUTGOING
 * stem in the lap BEFORE the swap, so the caller arms it live and it is
 * never part of a stage; a cut is no gesture at all. Both are dropped from
 * `arrivals`, on the radio side and the manual side alike.
 *
 * A manual change on the row radio was about to turn over wins: the user
 * pointed at that row, radio only drew it. Generic over the stem type so
 * this stays free of the renderer's own stem shape.
 *
 * `companions` (the pace slider's rows per change) ride radio's change as cuts in the same
 * stage, so they land or are taken back with it. A manual change on a companion's row wins it. */
export function mergeStageChanges<S>(
  radioLed: {
    slotId: string
    stem: S
    arrival: ManualArrival | null
    companions?: readonly { slotId: string; stem: S }[]
  } | null,
  manual: ReadonlyMap<string, { stem: S; joining: boolean; arrival: ManualArrival | null }>
): {
  changes: { slotId: string; stem: S }[]
  joining: string[]
  arrivals: ({ slotId: string } & ManualArrival)[]
} {
  const changes: { slotId: string; stem: S }[] = []
  const joining: string[] = []
  const arrivals: ({ slotId: string } & ManualArrival)[] = []
  // A manual change on the led row withdraws radio's change, companions with it: they ride
  // radio's change, so no radio change means none. Which rows may ride (held, locked, muted) is
  // the caller's call at decision time.
  if (radioLed !== null && !manual.has(radioLed.slotId)) {
    changes.push({ slotId: radioLed.slotId, stem: radioLed.stem })
    if (radioLed.arrival !== null && carriesAsArrival(radioLed.arrival.kind)) {
      arrivals.push({ slotId: radioLed.slotId, ...radioLed.arrival })
    }
    const seen = new Set([radioLed.slotId])
    for (const k of radioLed.companions ?? []) {
      if (seen.has(k.slotId) || manual.has(k.slotId)) continue
      seen.add(k.slotId)
      changes.push({ slotId: k.slotId, stem: k.stem })
    }
  }
  for (const [slotId, change] of manual) {
    changes.push({ slotId, stem: change.stem })
    if (change.joining) joining.push(slotId)
    if (change.arrival !== null && carriesAsArrival(change.arrival.kind)) {
      arrivals.push({ slotId, ...change.arrival })
    }
  }
  return { changes, joining, arrivals }
}
