// src/shared/radioPan.ts -- where each row sits in the stereo field (Elling, 2026-10-01: drums and
// bass in the middle, the other channels slightly left or right). Moved here from ell.ing/radio's
// src/radio/pan.ts (native radio sound plan, Task 0), which now re-exports it: one copy for the
// web radio and sssketch.
//
// Decided once, when the rows are made (step.ts play), and kept on the row for life: a stem
// swap never moves a row. A slot carrying a drums or bass mask kind (even alongside others) is
// centred; the rest alternate right, left, right... in slot order.
//
// The width is the sound settings' (radioSound.ts, `panning.width`); ROW_PAN when none is given.
import type { DiscoverSlotKind } from './discoverSlotKind'
import { stemKey, type SoundType } from './types'

export const ROW_PAN = 0.25 // Elling: subtle

const CENTRED: readonly DiscoverSlotKind[] = ['drums', 'bass']

/** Each slot's pan, in slot order: 0 for drums/bass, else +width, -width, ... */
export function panForSlots(
  slots: readonly { kinds: readonly DiscoverSlotKind[] }[],
  width: number = ROW_PAN
): number[] {
  let side = 1
  return slots.map((s) => {
    if (s.kinds.some((k) => CENTRED.includes(k))) return 0
    const pan = side * width
    side = -side
    return pan
  })
}

/** The timeline's twin of panForSlots: a rifff clip's stems, keyed by slot. A `drums` or `bass`
 * SoundType is centred; the rest alternate +width, -width, ... in slot order (whatever order the
 * stems are given in). */
export function stemPansForRifff(
  stems: readonly { slot: number; type: SoundType }[],
  width: number = ROW_PAN
): Map<number, number> {
  const ordered = [...stems].sort((a, b) => a.slot - b.slot)
  const pans = panForSlots(
    ordered.map((s) => ({ kinds: s.type === 'drums' || s.type === 'bass' ? [s.type] : [] })),
    width
  )
  return new Map(ordered.map((s, i) => [s.slot, pans[i]]))
}

/** Discover's row pans, by the PREVIEW stem's key (native radio sound plan, Task 4).
 *
 * panForSlots runs over ALL the panel's slots in slot order -- muted, unresolved and locked ones
 * included -- and each slot keeps its pan by its id. So muting a row, soloing one or swapping the
 * stem in one never moves any row: only adding, removing or re-kinding a slot can. The preview
 * rifff numbers its stems by member order (stem i + 1 is `memberSlotIds[i]`, the way
 * DiscoverPanel's gestures address them), so each member's key takes its slot's pan. A member
 * whose slot is not in `slots` is centred. */
export function discoverStemPans(
  slots: readonly { id: string; kinds: readonly DiscoverSlotKind[] }[],
  memberSlotIds: readonly string[],
  groupId: string,
  width: number = ROW_PAN
): Map<string, number> {
  const pans = panForSlots(slots, width)
  const bySlot = new Map(slots.map((s, i) => [s.id, pans[i]]))
  return new Map(memberSlotIds.map((id, i) => [stemKey(groupId, i + 1), bySlot.get(id) ?? 0]))
}

/** Web Audio's StereoPannerNode law on one stereo frame, the TS twin of the engine's
 * applyStemPan (native-engine/Source/StemPan.h), for audio rendered outside the engine (the
 * phone's per-stem files, loopSewPCM16.ts). A mono source is L = R.
 *
 * p <= 0, x = p + 1: L' = L + R cos(x pi/2), R' = R sin(x pi/2);
 * p > 0,  x = p:     L' = L cos(x pi/2),     R' = R + L sin(x pi/2).
 *
 * Pan 0 returns the frame as it is. Out-of-range pans clamp to [-1, 1]; a non-finite one is 0. */
export function stereoPanFrame(left: number, right: number, pan: number): [number, number] {
  if (!Number.isFinite(pan) || pan === 0) return [left, right]
  const p = Math.min(1, Math.max(-1, pan))
  const x = ((p <= 0 ? p + 1 : p) * Math.PI) / 2
  const gainL = Math.cos(x)
  const gainR = Math.sin(x)
  return p <= 0 ? [left + right * gainL, right * gainR] : [left * gainL, right + left * gainR]
}
