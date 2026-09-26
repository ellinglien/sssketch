// src/shared/discoveredRoom.ts

/** The one jamCID for sssketch's own "groups of stems that sound good
 * together" room. A real Jams row in sssketch's OWN writable warehouse,
 * never in an external LORE archive -- exactly the same routing the Shared
 * Feed's "shared:" prefix already gets (see riffLibraryStore.ts's dbForJam
 * and listJams). Shared, rather than a main-process constant, because the
 * renderer has to name the room too: LibraryBrowser pins it to the top of
 * the sidebar and suppresses the two controls that mean nothing for a room
 * the app built itself. */
export const DISCOVERED_JAM_CID = 'discovered'

/** Riffs.UserName for a kept group. Not a real Endlesss account -- the room
 * has no author but the app itself. */
export const DISCOVERED_USER_NAME = 'discovered'

/** A kept group's identity: the SET of its StemCIDs, unordered, ignoring
 * gain. The same five stems balanced differently are the same discovery,
 * so keeping twice must not litter the room. Duplicates within one group
 * collapse -- the same stem in two slots is still one member of the set. */
export function discoveredGroupKey(stemCIDs: readonly string[]): string {
  return [...new Set(stemCIDs)].sort().join('|')
}

/** The riffCID of an already-kept group with this exact stem set, or null.
 * `existing` comes from ONE query over the whole room (see
 * discoveredLibrary.ts's listDiscoveredGroups) -- never a per-stem lookup.
 * An empty candidate set never matches anything: there is nothing to keep. */
export function findDuplicateDiscoveredGroup(
  existing: readonly { riffCID: string; stemCIDs: readonly string[] }[],
  stemCIDs: readonly string[]
): string | null {
  if (stemCIDs.length === 0) return null
  const key = discoveredGroupKey(stemCIDs)
  for (const group of existing) {
    if (group.stemCIDs.length > 0 && discoveredGroupKey(group.stemCIDs) === key) {
      return group.riffCID
    }
  }
  return null
}
