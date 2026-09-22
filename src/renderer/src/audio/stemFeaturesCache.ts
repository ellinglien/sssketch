import { assembleStemFeatures } from '@shared/stemAnalysis'
import { isCurrentStemFeatureVersion, type StemFeatures } from '@shared/stemFeatures'
import { countWork } from '../perf/workCounters'
import { decodeStemFile } from './decodeStemFile'
import { getBrightness } from './peakCache'
import { primePitchContour } from './pitchCache'
import { analyzeStemSamplesOffThread } from './stemAnalysisClient'

const cache = new Map<string, Promise<StemFeatures>>()

export interface GetStemFeaturesOptions {
  /** Treat a persisted/cached row older than STEM_FEATURE_VERSION as stale:
   * re-extract and re-persist it. For the ambient background scans
   * (BackgroundFeatureScan, DiscoverLibraryScan) -- docs/superpowers/specs/
   * 2026-09-22-discover-promise-vs-delivery-design.md, Phase 3. Interactive
   * callers leave it off: an old row is still perfectly usable until the
   * scan replaces it. */
  requireCurrentVersion?: boolean
}

/**
 * Per-path cached feature vector for clustering -- mirrors peakCache.ts's
 * own shape (Map<string, Promise<T>>, evict on rejection). Decodes once
 * (sharing peakCache.ts's AudioContext singleton), then hands the samples
 * to stemAnalysisClient.ts, which runs the heavy analysis -- pitch
 * tracking, MFCC, band energy, transients -- in a Web Worker, off the
 * renderer's main thread (direct report, 2026-09-21: the background
 * library scans running this inline froze typing and clicks). The pitch
 * contour that analysis produces is also primed into pitchCache.ts, so
 * this no longer costs a second, separate decode just for pitch.
 * Brightness still comes from getBrightness (peakCache.ts), usually its
 * persisted cache.
 *
 * Feature versions (Phase 3): a row below STEM_FEATURE_VERSION is served
 * as-is to interactive callers, and re-extracted only for callers passing
 * `requireCurrentVersion` (the ambient scans).
 */
export function getStemFeatures(
  path: string,
  { requireCurrentVersion = false }: GetStemFeaturesOptions = {}
): Promise<StemFeatures> {
  const cached = cache.get(path)
  if (cached) {
    if (!requireCurrentVersion) return cached
    return cached.then((features) =>
      isCurrentStemFeatureVersion(features) ? features : refreshStale(path, cached)
    )
  }

  return remember(
    path,
    (async () => {
      // Persistent, cross-session cache first (stemFeatureCacheStore.ts,
      // via IPC) -- a stem the background scan (BackgroundFeatureScan.tsx)
      // or any prior session already extracted needs no decode at all.
      // Returns null both for "never scanned" and "not a real library
      // stem" (see stemFeatureCacheStore.ts's own doc comment) -- either
      // way, fall through to computing fresh below. An old-version row
      // counts as a miss only for requireCurrentVersion callers.
      countWork('ipc:get-stem-feature-cache')
      const persisted = await window.rifffApi.getStemFeatureCache(path)
      if (persisted && (!requireCurrentVersion || isCurrentStemFeatureVersion(persisted))) {
        return persisted
      }
      return extractAndPersist(path)
    })()
  )
}

/** Caches `promise` for `path`, evicting it on rejection so a later call
 * retries (only if it's still the cached entry). */
function remember(path: string, promise: Promise<StemFeatures>): Promise<StemFeatures> {
  cache.set(path, promise)
  promise.catch(() => {
    if (cache.get(path) === promise) cache.delete(path)
  })
  return promise
}

/** Replaces a session-cached old-version entry with a fresh extraction --
 * once: concurrent callers that saw the same stale entry find the
 * replacement already in place and share it. */
function refreshStale(path: string, stale: Promise<StemFeatures>): Promise<StemFeatures> {
  if (cache.get(path) !== stale) return getStemFeatures(path, { requireCurrentVersion: true })
  return remember(path, extractAndPersist(path))
}

async function extractAndPersist(path: string): Promise<StemFeatures> {
  const [brightness, audioBuffer] = await Promise.all([getBrightness(path), decodeStemFile(path)])
  const analysis = await analyzeStemSamplesOffThread(
    audioBuffer.getChannelData(0),
    audioBuffer.sampleRate
  )
  primePitchContour(path, analysis.pitchContour)
  const features = assembleStemFeatures(analysis, brightness)
  // Fire-and-forget -- a real library stem's path persists for next
  // time (this session's own renderer-memory `cache` above already
  // covers repeat calls within THIS session regardless of whether this
  // write succeeds); a non-library path is silently skipped by the
  // main-process side (see stemFeatureCacheStore.ts).
  countWork('ipc:set-stem-feature-cache')
  void window.rifffApi.setStemFeatureCache(path, features)
  return features
}
