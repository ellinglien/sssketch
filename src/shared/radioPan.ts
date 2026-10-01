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
import type { SoundType } from './types'

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
