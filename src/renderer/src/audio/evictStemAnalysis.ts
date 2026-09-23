import { evictWaveform } from './peakCache'
import { evictBandEnergy } from './bandEnergyCache'
import { evictPitchContour } from './pitchCache'

/**
 * Drops every path-keyed analysis this app memoizes for these files.
 *
 * Every other thing that changes a stem's audio produces a NEW path, which
 * is why the caches described in CLAUDE.md's "Analysis caches" section can
 * key on path and never think about invalidation. Baking a downbeat is the
 * one exception: re-baking an already-baked stem rewrites it in place
 * (bakedPathFor, main/bakeOffset.ts, deliberately -- so the pristine
 * original stays the only backup no matter how many times you re-pick), so
 * the path is the same and the audio behind it is not.
 *
 * Only the in-memory caches need this. A baked file's basename is not a
 * StemCID, so the persisted peaks/features tables (stemPeaksCacheStore.ts,
 * stemFeatureCacheStore.ts, both resolving through stemCIDForPath) never
 * held a row for it.
 *
 * This does NOT redraw a waveform that is already on screen: those read
 * their cache once on mount, keyed by path, and the path did not change.
 * It makes the NEXT mount honest, and it makes sure nothing later recomputes
 * a glyph or a trait from audio that no longer exists.
 */
export function evictStemAnalysis(paths: Iterable<string>): void {
  for (const path of paths) {
    evictWaveform(path)
    evictBandEnergy(path)
    evictPitchContour(path)
  }
}
