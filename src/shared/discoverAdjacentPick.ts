// src/shared/discoverAdjacentPick.ts

/** One pick out of a slot's temporal-adjacency window, for the PHONE's
 * one-tap `adjacent`.
 *
 * The desktop's own `adjacent` is a browser -- DiscoverNearbyPopover draws
 * up to four thumbnails per direction and the user chooses one. That does
 * not fit a 2x2 sheet of 64px buttons on a phone, so the phone gets the
 * one-tap form of the same thing: same IPC (getAdjacentDiscoverCandidates),
 * same candidate, same commit (swapSlotFromNearby), one of them chosen
 * here. See docs/superpowers/specs/2026-09-27-stem-actions-and-phone-1a-
 * design.md §1.4.
 *
 * Generic over `{ stemCID }` so src/shared/ never imports from src/main/,
 * where AdjacentDiscoverCandidate lives. `random` is injected because this
 * repo's react-hooks/purity rule errors on Math.random() inside a
 * component-scoped function, and because a test needs it determined.
 *
 * `older` first, then `newer` -- chronological, matching the popover's own
 * older -> "earlier" / newer -> "later" labelling. Uniform, NOT
 * nearest-first: all four of these actions are randomisers (the desktop row
 * puts a dice icon beside them to say so), and adjacency's value is
 * "something else from that moment in that jam", not "the closest possible
 * thing". Never throws; nothing eligible returns null, and the caller then
 * leaves the slot exactly as it was.
 */
export function pickAdjacentCandidate<T extends { stemCID: string }>(
  older: readonly T[],
  newer: readonly T[],
  anchorStemCID: string,
  random: () => number = Math.random
): T | null {
  const pool = [...older, ...newer].filter((c) => c.stemCID !== anchorStemCID)
  if (pool.length === 0) return null
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index]
}
