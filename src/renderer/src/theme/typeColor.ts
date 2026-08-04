import { TYPE_CSS_VAR, type SoundType, type Stem } from '@shared/types'

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
