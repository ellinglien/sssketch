// src/shared/discoverFaves.ts
//
// The faves dial (docs/superpowers/specs/2026-10-03-radio-faves-dial-design.md): 0..100, how much
// a pick sticks to favourites. With probability faves/100 a pick is drawn ONLY from favourites
// (same slot rules as any pick), falling back to a normal pick when none fits; every other pick
// is normal, with favourites ranked up by faves/100 of the boost. Replaces the `prefer faves`
// switch. Shared by Discover/radio (desktop: 👍-starred stems) and ell.ing/radio (the visitor's
// 👍 likes and ♥ hearted stems).

export const FAVES_MIN = 0
export const FAVES_MAX = 100
/** Where the dial starts, and where a double-click puts it back: nothing changes until moved. */
export const DEFAULT_FAVES = 0
/** What a saved `prefer faves: on` becomes. */
export const LEGACY_PREFER_FAVES = 50

export const FAVES_LABEL = 'faves'
export const FAVES_TOOLTIP = 'how much to stick to liked stems'
/** The readout's word on a row whose favourites-only pick found nothing that fits. */
export const NO_FAVE_FITS = 'no fave fits'

/** 0..100, whole numbers. Not a number: the legacy switch if it was on (50), else the default. */
export function normalizeFaves(value: unknown, legacyPreferFaves?: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.round(Math.min(FAVES_MAX, Math.max(FAVES_MIN, value)))
  return legacyPreferFaves === true ? LEGACY_PREFER_FAVES : DEFAULT_FAVES
}

export type FavesWay = 'only' | 'normal'

/** Which way ONE pick goes. The ends never call `random` -- so at 0 a seeded picker's stream,
 * and every pick it makes, is exactly what it was before the dial existed. */
export function favesDraw(faves: number, random: () => number = Math.random): FavesWay {
  const f = normalizeFaves(faves)
  if (f <= FAVES_MIN) return 'normal'
  if (f >= FAVES_MAX) return 'only'
  return random() < f / 100 ? 'only' : 'normal'
}

/** How much of rankCandidates' favourites boost a normal pick gets: faves/100. */
export function favesBoostScale(faves: number): number {
  return normalizeFaves(faves) / 100
}

/** The stems a pool may draw from: one restriction, the other, or both intersected (artist mode
 * and the favourites-only draw); undefined is no restriction. */
export function restrictStems(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return new Set([...a].filter((id) => b.has(id)))
}
