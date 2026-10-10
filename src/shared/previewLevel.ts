// The preview level: one volume for every Web Audio preview (import riffs, shelf tiles, loop
// folders, the project browser, the re-one picker), set by the "preview level" dial in the import
// view (the 2026-10-08 call, F2: Ben wanted to turn previews down to talk over them on a call).
// It never touches the arrangement, which plays through the engine. Remembered per machine
// (src/main/previewLevelStore.ts).

/** 0 to 100, the dial's own scale. 100 is unity: previews as loud as they always were. */
export const DEFAULT_PREVIEW_LEVEL = 100

function clampLevel(level: number): number {
  return Math.min(100, Math.max(0, level))
}

/** A stored or dialled level, cleaned: whole, in 0..100, and the default for anything that
 * isn't a finite number (a missing or hand-edited settings file). */
export function normalizePreviewLevel(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_PREVIEW_LEVEL
  return Math.round(clampLevel(raw))
}

/** The gain for a level. Squared, so the dial turns down evenly by ear rather than doing
 * nothing for most of its travel and everything at the bottom: 50 is a quarter (-12 dB).
 * Never above unity: the dial only turns previews down. */
export function previewLevelGain(level: number): number {
  const fraction = clampLevel(level) / 100
  return fraction * fraction
}

/** The level as the dial's tooltip says it: what it does to the sound, in plain terms. The knob
 * position would mislead, since 50 on the dial is a quarter of the gain. Whole dB, with one
 * decimal near the top so a slightly turned-down dial never reads as full. */
export function previewLevelLabel(level: number): string {
  const gain = previewLevelGain(level)
  if (gain >= 1) return 'full level'
  if (gain <= 0) return 'silent'
  const db = 20 * Math.log10(gain)
  const shown = db > -1 ? db.toFixed(1) : Math.round(db).toString()
  return `${shown.replace('-', '−')} dB`
}
