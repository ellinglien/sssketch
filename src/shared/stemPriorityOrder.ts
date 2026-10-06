// src/shared/stemPriorityOrder.ts
//
// The one order every per-stem background pass uses (Elling, 2026-10-06:
// "reduces the start time for most use cases by A LOT"): his own stems
// first (CreatorUserName = the app's username), then his favourites (stars,
// which radio hearts and likes land in, and the stems of favourite riffs),
// then everything else -- each group in the pass's own order, so with no
// username and no favourites nothing moves.
//
// The sets come from main (stemPriority.ts, built once per username and
// cached); this file is only the rule, pure, for main and renderer alike.

export const STEM_PRIORITY_OWN = 0
export const STEM_PRIORITY_FAVOURITE = 1
export const STEM_PRIORITY_REST = 2
export type StemPriorityRank =
  typeof STEM_PRIORITY_OWN | typeof STEM_PRIORITY_FAVOURITE | typeof STEM_PRIORITY_REST

export interface StemPrioritySets {
  /** StemCIDs whose CreatorUserName is the app's username. */
  own: ReadonlySet<string>
  /** Starred stems and the stems of favourite riffs. */
  favourites: ReadonlySet<string>
  /** Moves whenever either set's contents change (stemPriority.ts's cache),
   * so a consumer can tell "same sets" without comparing them. Absent (a
   * hand-made priority): compare by contents. */
  version?: number
}

export function stemPriorityRank(priority: StemPrioritySets, stemCID: string): StemPriorityRank {
  if (priority.own.has(stemCID)) return STEM_PRIORITY_OWN
  if (priority.favourites.has(stemCID)) return STEM_PRIORITY_FAVOURITE
  return STEM_PRIORITY_REST
}

/** A stable partition of `items` by rank: own, favourites, the rest, each in
 * the order given. One pass, a new array (a 125k-item work list: a few ms). */
export function orderByStemPriority<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  priority: StemPrioritySets
): T[] {
  if (priority.own.size === 0 && priority.favourites.size === 0) return items.slice()
  const groups: [T[], T[], T[]] = [[], [], []]
  for (const item of items) groups[stemPriorityRank(priority, keyOf(item))].push(item)
  return groups[0].concat(groups[1], groups[2])
}
