import type { PitchContour } from '@shared/pitchContour'
import { pitchContourFromBytes, pitchContourToBytes } from '@shared/glyphBands'
import { decodeStemFile } from './decodeStemFile'
import { computePitchContourOffThread } from './stemAnalysisClient'
import { countWork } from '../perf/workCounters'
import { readPersistedStemGlyph, writePersistedStemGlyph } from './stemGlyphCache'
import { createPrimedEntries } from './primedEntries'

const cache = new Map<string, Promise<PitchContour>>()
/** Primed contours are bounded (primedEntries.ts); requested ones are not. */
const primed = createPrimedEntries((path) => cache.delete(path))

/** Per-path pitch-contour cache, mirroring peakCache.ts's own shape and
 * eviction-on-rejection behavior. Kept separate from bandEnergyCache.ts
 * (a different real FFT-based analysis, computePitchContour's own
 * autocorrelation pass rather than computeSpectrogram's) even though both
 * are "new cost" tiers. */
export function getPitchContour(path: string): Promise<PitchContour> {
  const cached = cache.get(path)
  if (cached) {
    primed.promote(path)
    return cached
  }

  const promise = (async () => {
    // Persisted first (plan 2026-10-05-merge-background-scans T9): one IPC
    // shared with bandEnergyCache.ts's glyph read for the same path.
    const persisted = await readPersistedStemGlyph(path)
    const fromDb = persisted?.pitch
      ? pitchContourFromBytes(persisted.pitch.bytes, persisted.pitch.numFrames)
      : null
    if (fromDb) return fromDb
    const audioBuffer = await decodeStemFile(path)
    countWork('analysis:pitch-contour')
    // Off the main thread (stemAnalysisClient.ts, 2026-09-21).
    const contour = await computePitchContourOffThread(
      audioBuffer.getChannelData(0),
      audioBuffer.sampleRate
    )
    // Every frame, Float32: both pitch lines draw every frame.
    writePersistedStemGlyph(path, {
      pitch: { numFrames: contour.freqHz.length, bytes: pitchContourToBytes(contour.freqHz) }
    })
    return contour
  })()

  cache.set(path, promise)
  promise.catch(() => {
    if (cache.get(path) === promise) {
      cache.delete(path)
      primed.forget(path)
    }
  })
  return promise
}

/** Seeds the cache with a contour computed elsewhere -- stemFeaturesCache.ts
 * gets one for free from its own full analysis, so a stem the background
 * scan already analyzed never pays a second decode + pitch pass here. Not
 * persisted (stemGlyphCache.ts's writePersistedStemGlyph says why), and
 * bounded: only the newest PRIMED_ENTRY_CAP primed paths are kept until a
 * caller asks for one (primedEntries.ts). A path that's already cached (or
 * in flight) is left alone. */
export function primePitchContour(path: string, contour: PitchContour): void {
  if (cache.has(path)) return
  cache.set(path, Promise.resolve(contour))
  primed.add(path)
}

/** Forgets this path's pitch contour -- see peakCache.ts's evictWaveform for
 * why an in-place rewrite is the one case that needs this. */
export function evictPitchContour(path: string): void {
  cache.delete(path)
  primed.forget(path)
}
