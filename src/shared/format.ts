/** Rounds to 2 decimal places for display, dropping trailing zeros (150 stays
 * "150", not "150.00") — LORE's own BPMrnd column carries floating-point
 * representation noise (e.g. 89.9000015258789 for what's really just 89.9),
 * which reads as broken/imprecise shown raw anywhere a tempo is displayed. */
export function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 100) / 100)
}
