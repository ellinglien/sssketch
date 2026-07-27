import { TYPE_CSS_VAR, type SoundType } from '@shared/types'

/**
 * A CSS `var(...)` reference for a sound type's color, sourced from the single
 * design-token definition in tokens.css (via TYPE_CSS_VAR) rather than a second,
 * hand-maintained hex table — avoids two color sources drifting out of sync.
 * Works anywhere a CSS color is valid, including inside color-mix().
 */
export function typeColorVar(type: SoundType): string {
  return `var(${TYPE_CSS_VAR[type]})`
}
