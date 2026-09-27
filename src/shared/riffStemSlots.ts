// src/shared/riffStemSlots.ts

/** How many literal StemCID_N columns the `Riffs` table has --
 * Riffs.StemCID_1..8 (src/main/riffLibrarySchema.ts). This is OUROVEON's
 * shape, not ours: sssketch's own riff library is deliberately
 * schema-compatible with a real LORE warehouse, and the app can open an
 * external one read-only (README, acknowledgments). It stays 8 forever.
 * Stems past the eighth live in the sssketch-exclusive RiffStemsExtra side
 * table instead -- see src/main/riffStemsExtra.ts. */
export const LORE_STEM_COLUMN_COUNT = 8

/** The most stems one rifff can carry in sssketch: the 8 LORE columns plus
 * 12 rows in RiffStemsExtra. sssketch's own extension -- a real Endlesss
 * rifff is 8 stems, and this number has no meaning outside this app.
 *
 * This is the ONLY place the ceiling is written down. Raising it is free
 * (the side table's own CHECK constrains only the LOWER bound, so no
 * migration is needed); lowering it below 9 would be a real migration. */
export const MAX_RIFFF_STEM_SLOTS = 20

/** The eight column names, in slot order. Was defined separately in
 * riffLibraryWriter.ts and discoveredLibrary.ts and inlined as a SQL
 * string in four more places before this. */
export const STEM_SLOT_COLUMNS: readonly string[] = Array.from(
  { length: LORE_STEM_COLUMN_COUNT },
  (_, i) => `StemCID_${i + 1}`
)

export interface StemSlotRef {
  slot: number
  stemCID: string
}

/** The non-null StemCID_1..8 columns of a Riffs row, as 1-indexed slots.
 * Takes a plain record so it works for every row shape in the codebase
 * (RiffRow, FullRiffRow, RiffCandidateRow, RiffPageRow) without any of
 * them needing a common type. */
export function columnStemSlots(row: Record<string, unknown>): StemSlotRef[] {
  const out: StemSlotRef[] = []
  for (let slot = 1; slot <= LORE_STEM_COLUMN_COUNT; slot++) {
    const stemCID = row[`StemCID_${slot}`]
    if (typeof stemCID === 'string' && stemCID.length > 0) out.push({ slot, stemCID })
  }
  return out
}

/** Splits a rifff's stems into what the eight columns hold and what the
 * side table holds. `dropped` is anything outside 1..MAX_RIFFF_STEM_SLOTS:
 * returned rather than silently discarded so the writer can say so out
 * loud instead of losing a stem the way this whole feature's original bug
 * did. Order within each half is the given order, untouched. */
export function splitStemSlots<T extends { slot: number }>(
  stems: readonly T[]
): { columnStems: T[]; extraStems: T[]; dropped: T[] } {
  const columnStems: T[] = []
  const extraStems: T[] = []
  const dropped: T[] = []
  for (const stem of stems) {
    if (stem.slot >= 1 && stem.slot <= LORE_STEM_COLUMN_COUNT) columnStems.push(stem)
    else if (stem.slot > LORE_STEM_COLUMN_COUNT && stem.slot <= MAX_RIFFF_STEM_SLOTS)
      extraStems.push(stem)
    else dropped.push(stem)
  }
  return { columnStems, extraStems, dropped }
}

/** One ascending slot list from the two halves. An extra claiming a slot
 * the columns own is ignored: the columns are the only source of truth for
 * 1..8, which is the whole reason the side table starts at 9. With no
 * extras -- an external LORE warehouse, which has no side table and cannot
 * be given one -- this is just the columns, which is the correct answer
 * there and not a degraded one. */
export function mergeStemSlots(
  columnSlots: readonly StemSlotRef[],
  extraSlots: readonly StemSlotRef[]
): StemSlotRef[] {
  const merged = [...columnSlots, ...extraSlots.filter((s) => s.slot > LORE_STEM_COLUMN_COUNT)]
  return merged.sort((a, b) => a.slot - b.slot)
}
