const INITIAL_CROSS_DROP_SLOTS = 6
const MIN_TRAILING_CROSS_DROP_SLOTS = 2

/** Cross starts as a six-slot tray. Filled rows consume those blanks; once
 * only one blank would remain, the tray grows by one so there are two useful
 * landing positions at its end. The hard riff capacity still wins. */
export function crossEmptyDropSlotCount(centerCount: number, maxStemSlots: number): number {
  const remainingCapacity = Math.max(0, maxStemSlots - centerCount)
  const initialTrayRemainder = Math.max(0, INITIAL_CROSS_DROP_SLOTS - centerCount)
  return Math.min(remainingCapacity, Math.max(MIN_TRAILING_CROSS_DROP_SLOTS, initialTrayRemainder))
}
