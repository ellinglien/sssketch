import type { AppState } from '../state/store'
import { getPeaks, getBrightness } from './peakCache'
import { getBandEnergy } from './bandEnergyCache'
import { getPitchContour } from './pitchCache'
import { getStemFeatures } from './stemFeaturesCache'

function allStemPaths(state: AppState): string[] {
  const paths = new Set<string>()
  for (const rifff of Object.values(state.rifffs)) {
    for (const stem of rifff.stems) paths.add(stem.path)
  }
  return Array.from(paths)
}

/** Pre-warms every per-stem analysis cache (waveform peaks/brightness,
 * band energy, pitch contour, and the richer StemFeatures vector used by
 * Tidy Up/Auto-Arrange/Discover -- see the "Analysis caches" section of
 * this project's own CLAUDE.md) for every stem in a project, so the first
 * paint after loading already has real data instead of blank waveforms/
 * radial glyphs that visibly pop in one at a time as each mounted
 * component's own decode happens to finish. Covers every rifff in the
 * project (shelf and placed alike), not just whatever the current arranger
 * mode happens to show right away -- switching modes or scrolling shouldn't
 * re-trigger a visible "still loading" pop-in either.
 *
 * Complementary to BackgroundFeatureScan.tsx (a separate ambient mechanism
 * that runs continuously after load to warm stems placed or imported AFTER
 * project load). Together they mean a stem is rarely, if ever, scanned live
 * inside a screen the user is actually looking at.
 *
 * Errors on any one stem are swallowed (Promise.allSettled) -- one bad or
 * missing file shouldn't hold up the rest, and every consumer of these
 * caches already has its own fallback handling for a rejected decode. */
export async function warmStemCaches(state: AppState): Promise<void> {
  const paths = allStemPaths(state)
  await Promise.allSettled(
    paths.flatMap((path) => [
      getPeaks(path),
      getBrightness(path),
      getBandEnergy(path),
      getPitchContour(path),
      getStemFeatures(path)
    ])
  )
}
