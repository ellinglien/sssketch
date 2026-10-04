// src/shared/radioLanding.ts -- the radio view's landing flicker (spec
// 2026-10-03-sssketch-radio-view-design section 2): the strip's `skip` flickers in the playhead
// colour when radio's change is heard, as the web's `next` does (ell.ing/radio src/main.ts's
// onLanding: several rows landing on one wrap are one flicker). Pure; the panel keeps the last
// flicker's time and calls this from the places a change lands at a loop top or a held bar.
//
// It answers "did radio's change just happen", so a manual change made with Cmd (landing at once,
// not on radio's clock) never flickers. A manual change that WAITED for the top did happen on
// radio's clock and does.

/** Where a landing came from: radio's own change (with its companions), a course change (`new
 * bed`, an artist change), the density arc's row joining, a manual change that waited for the top,
 * a hook's exit or return, or a manual change landed at once (Cmd). */
export type RadioLandingSource = 'radio' | 'course' | 'arc' | 'manual-wait' | 'hook' | 'manual-now'

/** Landings closer together than this are one moment: one flicker (the web's 0.05 s). */
export const RADIO_LANDING_COALESCE_MS = 50

/** The flicker's length (the web's `full-flicker`, 600 ms). */
export const RADIO_LANDING_FLICKER_MS = 600

/** True when this landing should flicker. `prevAtMs` is the time of the last landing that did
 * (null before any); the caller records `atMs` only when this returns true, as the web does. */
export function shouldFlickerLanding(
  prevAtMs: number | null,
  atMs: number,
  source: RadioLandingSource
): boolean {
  if (source === 'manual-now') return false
  if (!Number.isFinite(atMs)) return false
  return prevAtMs === null || Math.abs(atMs - prevAtMs) >= RADIO_LANDING_COALESCE_MS
}
