// src/shared/radioCover.ts
//
// NO LONG SILENCE (the owner, 2026-11-22: "sometimes it's played one stem for a bit and most of
// it is silent"). A stem's cover is its activeFraction (stemLevel.ts: the share of its 100 ms
// hops that sound); the mix's cover is how much of the time anything sounds. A pick
// (rankCandidates' `cover`), the density arc's removal (pickArcRemoval) and a breakdown's rests
// (radioBreakdownRests) each leave the mix covered. An estimate from stored numbers: nothing
// listens to the output.

/** The least a mix may cover: at 0.75 no more than a beat in a bar of 4 is empty, on average. */
export const MIN_MIX_COVER = 0.75

/** An unmeasured stem's cover: just enough to carry the mix alone, so the rule acts only on what
 * was measured (unknown is neutral, as an unknown key is). */
export const UNKNOWN_COVER = MIN_MIX_COVER

/** A row's cover as it comes: a candidate's `cover`, null or absent when unknown. */
export type Cover = number | null | undefined

/** A cover in [0, 1]; unknown: UNKNOWN_COVER. */
export function coverOf(cover: Cover): number {
  return typeof cover === 'number' && Number.isFinite(cover)
    ? Math.min(1, Math.max(0, cover))
    : UNKNOWN_COVER
}

/** How much of the time a mix of rows with these covers sounds: 1 - the product of each row's
 * silence, as if the rows' gaps fell independently. Stems that rest in the same places (two
 * parts both leaving beat 4 empty) cover less than this says, interlocking ones more. Empty: 0. */
export function mixCover(covers: readonly Cover[]): number {
  let silence = 1
  for (const c of covers) silence *= 1 - coverOf(c)
  return covers.length === 0 ? 0 : 1 - silence
}

/** These rows, sounding together, cover enough. Each caller passes the mix as it would be: with
 * a candidate in, or with a row out. */
export function mixCovered(covers: readonly Cover[]): boolean {
  return mixCover(covers) >= MIN_MIX_COVER
}
