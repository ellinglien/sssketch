import type { PitchContour } from '@shared/pitchContour'
import { decodeStemFile } from './decodeStemFile'
import { computePitchContourOffThread } from './stemAnalysisClient'

const cache = new Map<string, Promise<PitchContour>>()

/** Per-path pitch-contour cache, mirroring peakCache.ts's own shape and
 * eviction-on-rejection behavior. Kept separate from bandEnergyCache.ts
 * (a different real FFT-based analysis, computePitchContour's own
 * autocorrelation pass rather than computeSpectrogram's) even though both
 * are "new cost" tiers — same reasoning as keeping BeatPicker.tsx's own
 * spectrogram and pitch computations as two separate calls rather than one
 * merged pass. */
export function getPitchContour(path: string): Promise<PitchContour> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const audioBuffer = await decodeStemFile(path)
      // Off the main thread (stemAnalysisClient.ts, 2026-09-21).
      return await computePitchContourOffThread(
        audioBuffer.getChannelData(0),
        audioBuffer.sampleRate
      )
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}

/** Seeds the cache with a contour computed elsewhere -- stemFeaturesCache.ts
 * gets one for free from its own full analysis, so a stem the background
 * scan already analyzed never pays a second decode + pitch pass here. A
 * path that's already cached (or in flight) is left alone. */
export function primePitchContour(path: string, contour: PitchContour): void {
  if (!cache.has(path)) cache.set(path, Promise.resolve(contour))
}
