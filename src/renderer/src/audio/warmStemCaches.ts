import type { AppState } from '../state/store'
import { getPeaks, getBrightness } from './peakCache'
import { getGlyphBands } from './bandEnergyCache'
import { getPitchContour } from './pitchCache'
import { getStemFeatures } from './stemFeaturesCache'
import { countWork } from '../perf/workCounters'

function allStemPaths(state: AppState): string[] {
  const paths = new Set<string>()
  for (const rifff of Object.values(state.rifffs)) {
    for (const stem of rifff.stems) paths.add(stem.path)
  }
  return Array.from(paths)
}

/** How many stems a project open warms at once (plan 2026-10-05-merge-
 * background-scans T9): each is a read + decode + analysis, and a project
 * of 50 stems used to start all of them together. */
export const WARM_CONCURRENCY = 4

/** Every per-stem cache one path needs drawn: waveform peaks/brightness,
 * glyph bands, pitch contour, and the StemFeatures vector. Settled, never
 * rejected -- each consumer has its own fallback for a failed decode. */
async function warmPath(path: string): Promise<void> {
  await Promise.allSettled([
    getPeaks(path),
    getBrightness(path),
    getGlyphBands(path),
    getPitchContour(path),
    getStemFeatures(path)
  ])
}

/** Pre-warms every per-stem analysis cache (waveform peaks/brightness,
 * glyph bands, pitch contour, and the richer StemFeatures vector used by
 * Tidy Up/Auto-Arrange/Discover -- see the "Analysis caches" section of
 * this project's own CLAUDE.md) for every stem in a project, so the first
 * paint after loading already has real data instead of blank waveforms/
 * radial glyphs that visibly pop in one at a time as each mounted
 * component's own decode happens to finish. Covers every rifff in the
 * project (shelf and placed alike), not just whatever the current arranger
 * mode happens to show right away -- switching modes or scrolling shouldn't
 * re-trigger a visible "still loading" pop-in either.
 *
 * Bounded: at most WARM_CONCURRENCY paths in flight. Glyph bands and pitch
 * lines are persisted (stemGlyphCache.ts), so a second open of the same
 * project reads them instead of decoding.
 *
 * Complementary to BackgroundFeatureScan.tsx (a separate ambient mechanism
 * that runs continuously after load to warm stems placed or imported AFTER
 * project load). Together they mean a stem is rarely, if ever, scanned live
 * inside a screen the user is actually looking at.
 *
 * Errors on any one stem are swallowed -- one bad or missing file shouldn't
 * hold up the rest. `warmOne` is injectable for tests. */
export async function warmStemCaches(
  state: AppState,
  warmOne: (path: string) => Promise<void> = warmPath
): Promise<void> {
  const started = performance.now()
  const paths = allStemPaths(state)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const path = paths[next++]
      try {
        await warmOne(path)
      } catch {
        // swallowed, as above
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WARM_CONCURRENCY, paths.length) }, worker))
  countWork('warm:paths', paths.length)
  countWork('ms:warm-stem-caches', Math.round(performance.now() - started))
}
