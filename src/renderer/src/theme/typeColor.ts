import { TYPE_CSS_VAR, type BusId, type SoundType, type Stem } from '@shared/types'

/**
 * A CSS `var(...)` reference for a sound type's color, sourced from the single
 * design-token definition in tokens.css (via TYPE_CSS_VAR) rather than a second,
 * hand-maintained hex table — avoids two color sources drifting out of sync.
 * Works anywhere a CSS color is valid, including inside color-mix().
 */
export function typeColorVar(type: SoundType): string {
  return `var(${TYPE_CSS_VAR[type]})`
}

/**
 * A stem's identity color -- typeColorVar(stem.type), UNLESS this stem was
 * captured via this app's own loop-record feature (stem.recordedInApp),
 * which overrides to --ra-recording-live regardless of its SoundType. Use
 * this instead of typeColorVar wherever a *stem* (not just a bare
 * SoundType) is on hand -- a recorded take should read as its own visually
 * distinct category everywhere its color is shown (arranger clip, shelf
 * card, glyph ring, Inspector), not just blend in as another audio-in-typed
 * clip. Accepts undefined so `stemColorVar(rifff.stems[0])` works at every
 * existing `typeColorVar(rifff.stems[0]?.type ?? 'fx')` call site without
 * each one re-deriving its own fallback.
 */
export function stemColorVar(stem: Stem | undefined): string {
  if (stem?.recordedInApp) return 'var(--ra-recording-live)'
  return typeColorVar(stem?.type ?? 'fx')
}

/**
 * Swatch per bus, for tidied-view's row coloring -- meant to evoke the SAME
 * bus identity buildAlsXml.ts's own ABLETON_BUS_COLORS table colors the
 * Ableton export with. drums/bass/lead here are sampled directly off a real
 * exported .als reopened in actual Ableton (a screenshot Elling shared
 * 2026-08-10) -- not a guess, and not a generic swatch: this IS what those
 * bus indices render as. backing/aux don't appear in that particular
 * project (nothing was assigned to them), so there's still no real sample
 * for those two -- rather than another arbitrary guess, these fall back to
 * the closest-hued existing app token (--ra-type-ext-fx's green for
 * backing, a neutral cool grey in the app's own border/ink family for aux)
 * so an unavoidable guess at least stays inside this app's own palette
 * instead of introducing a new hue from nowhere. Literal hex, not a
 * tokens.css var -- unlike typeColorVar's stem-type palette, this is a
 * narrow, single-purpose mapping with no other consumer to keep in sync.
 */
const BUS_COLOR_HEX: Record<BusId, string> = {
  drums: '#e8929b',
  bass: '#4a56ad',
  lead: '#c7a4d2',
  backing: '#7fc98a',
  aux: '#8a97a3'
}

export function busColorHex(bus: BusId): string {
  return BUS_COLOR_HEX[bus]
}
