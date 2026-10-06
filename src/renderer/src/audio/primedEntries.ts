// src/renderer/src/audio/primedEntries.ts
//
// A bound on the entries the background scans PRIME into the per-path
// analysis caches (pitchCache.ts, bandEnergyCache.ts, stemFeaturesCache.ts).
// Every stem the library scan analyses primes its pitch contour (~2.8 KB for
// a 16 s stem), glyph bands and StemFeatures, so a session over a 146k-stem
// library kept ~400 MB of contours alone, forever (review of plan
// 2026-10-05-merge-background-scans T9). Priming stays -- a stem just
// analysed must not decode again for its pitch line -- but only the newest
// PRIMED_ENTRY_CAP primed paths per cache are kept. A path a screen asked
// for is promoted out of this set and never evicted by it; an evicted path
// asked for later is computed again (persisted first, where the cache has a
// persisted row), once.

export const PRIMED_ENTRY_CAP = 2000

export interface PrimedEntries {
  /** `path`'s cache entry is now a primed one (newest). Evicts the oldest
   * primed paths past the cap. */
  add(path: string): void
  /** A caller asked for `path`: it is no longer evictable from here. */
  promote(path: string): void
  /** `path`'s entry left the cache another way (evicted, rejected). */
  forget(path: string): void
  size(): number
}

/** `evict(path)` must remove that path's (primed) entry from its cache. */
export function createPrimedEntries(
  evict: (path: string) => void,
  cap: number = PRIMED_ENTRY_CAP
): PrimedEntries {
  // A Set iterates in insertion order: its first element is the oldest.
  const paths = new Set<string>()
  return {
    add(path) {
      paths.delete(path)
      paths.add(path)
      while (paths.size > cap) {
        const oldest = paths.values().next().value as string
        paths.delete(oldest)
        evict(oldest)
      }
    },
    promote(path) {
      paths.delete(path)
    },
    forget(path) {
      paths.delete(path)
    },
    size: () => paths.size
  }
}
