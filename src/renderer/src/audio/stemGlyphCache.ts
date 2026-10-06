// src/renderer/src/audio/stemGlyphCache.ts
//
// The renderer side of main's persisted glyph cache (stemGlyphCacheStore.ts):
// a stem's glyph rings (bandEnergyCache.ts) and pitch line (pitchCache.ts),
// stored at the resolution they are drawn at. Both caches read it before
// decoding, and both are usually asked for the same path in the same tick
// (PolarGlyph, warmStemCaches), so the read is ONE in-flight IPC per path,
// shared, and forgotten once settled (the two caches memoise the results).
import type { StemGlyphCacheEntry, StemGlyphCacheWrite } from '@shared/glyphBands'
import { countWork } from '../perf/workCounters'

const inFlight = new Map<string, Promise<StemGlyphCacheEntry | null>>()

/** The persisted entry for `path`, or null on a miss. Never rejects: a
 * failed read is a miss, and the caller computes as before. */
export function readPersistedStemGlyph(path: string): Promise<StemGlyphCacheEntry | null> {
  const pending = inFlight.get(path)
  if (pending) return pending
  countWork('ipc:get-stem-glyph-cache')
  const promise = (async () => {
    try {
      return await window.rifffApi.getStemGlyphCache(path)
    } catch {
      return null
    }
  })()
  inFlight.set(path, promise)
  void promise.then(() => {
    if (inFlight.get(path) === promise) inFlight.delete(path)
  })
  return promise
}

/** Fire-and-forget: persists a freshly COMPUTED half (never a primed one --
 * the library scan primes every stem it analyses, and storage is meant to
 * be bounded by the stems actually shown). A failed write only costs a
 * recompute next session. */
export function writePersistedStemGlyph(path: string, write: StemGlyphCacheWrite): void {
  countWork('ipc:set-stem-glyph-cache')
  try {
    void window.rifffApi.setStemGlyphCache(path, write).catch(() => {})
  } catch {
    // no bridge (tests) -- nothing to persist to
  }
}
