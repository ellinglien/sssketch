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
 * A clip's per-stem display color, given the stem's OWN bus assignment or
 * undefined if it's never been through Tidy Up (the caller resolves that
 * via selectors.ts's busIfAssignedFromBusOf, since that needs state.busOf,
 * which this file has no access to and shouldn't -- this function only
 * owns the color mapping, not the state lookup). Same recordedInApp
 * override as stemColorVar above (a recorded take stays its own distinct
 * category regardless of bus/type). Falls back to stemColorVar (the raw
 * Endlesss-derived SoundType color) when `bus` is undefined, rather than
 * always resolving to the aux bus color -- per direct feedback
 * (2026-09-01): most people are looking at freshly-imported, never-tidied
 * content most of the time, and that content already carries real
 * category information (drum/note/bass/mic flags) from Endlesss itself,
 * which a flat neutral color was throwing away for no benefit. Once a
 * stem genuinely goes through Tidy Up -- including landing in aux on
 * purpose -- it switches over to the bus palette, which is the whole
 * visual payoff of having tidied it. Use this instead of stemColorVar at
 * every call site that decides a CLIP'S OWN rendered color
 * (CollapsedRifffRow.tsx, StemWaveformRow.tsx, RifffBlockRow.tsx) -- NOT
 * at selectors.ts's busForRifff, which needs a bus that's always resolved
 * (defaulting unassigned stems to aux) for its own row-grouping tie-break.
 */
export function stemDisplayColorVar(stem: Stem | undefined, bus: BusId | undefined): string {
  if (stem?.recordedInApp) return 'var(--ra-recording-live)'
  return bus !== undefined ? busColorHex(bus) : typeColorVar(stem?.type ?? 'fx')
}

/**
 * Swatch per bus, for tidied-view's row coloring. lead here is sampled
 * directly off a real exported .als reopened in actual Ableton (a
 * screenshot Elling shared 2026-08-10) -- not a guess, and not a generic
 * swatch: this IS what that bus index renders as. drums/bass are
 * deliberately swapped from that same sample (Elling's own preference,
 * 2026-08-21) -- so unlike lead, they no longer match what Ableton itself
 * shows for those two bus indices; the in-app preview and a real Ableton
 * export will disagree on drums/bass specifically. backing doesn't appear
 * in that sampled project (nothing was assigned to it), so there's still
 * no real sample for it -- rather than another arbitrary guess, it falls
 * back to the closest-hued existing app token (--ra-type-ext-fx's green)
 * so an unavoidable guess at least stays inside this app's own palette
 * instead of introducing a new hue from nowhere.
 *
 * aux was ORIGINALLY a neutral cool grey (#8a97a3, "the app's own
 * border/ink family") -- per direct feedback this read as visually
 * indistinguishable from a fully-muted clip's own grey (StemWaveformRow's
 * always-visible `--ra-text-3` layer, revealed once the full-color layer
 * on top is suppressed by mute), making it genuinely hard to tell "is
 * this just an untidied/aux stem, or is it muted?" at a glance. Replaced
 * (2026-09-01) with a warm taupe/sand instead -- still reads as "neutral,
 * no strong category" (unlike the other four bus colors, which are all
 * clearly saturated hues), but its warm cast keeps it visually distinct
 * from every grey already in use (both --ra-text-3's muted-state grey and
 * the app's own cool near-black chrome).
 *
 * Literal hex, not a tokens.css var -- unlike typeColorVar's stem-type
 * palette, this is a narrow, single-purpose mapping with no other
 * consumer to keep in sync.
 */
const BUS_COLOR_HEX: Record<BusId, string> = {
  drums: '#e8929b',
  bass: '#4a56ad',
  lead: '#c7a4d2',
  backing: '#7fc98a',
  aux: '#a3937a'
}

export function busColorHex(bus: BusId): string {
  return BUS_COLOR_HEX[bus]
}
