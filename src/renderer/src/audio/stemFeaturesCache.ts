import { assembleStemFeatures } from '@shared/stemAnalysis'
import type { StemFeatures } from '@shared/stemFeatures'
import { getAudioContext, getBrightness } from './peakCache'
import { primePitchContour } from './pitchCache'
import { analyzeStemSamplesOffThread } from './stemAnalysisClient'

const cache = new Map<string, Promise<StemFeatures>>()

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
 */
export function getStemFeatures(path: string): Promise<StemFeatures> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      // Persistent, cross-session cache first (stemFeatureCacheStore.ts,
      // via IPC) -- a stem the background scan (BackgroundFeatureScan.tsx)
      // or any prior session already extracted needs no decode at all.
      // Returns null both for "never scanned" and "not a real library
      // stem" (see stemFeatureCacheStore.ts's own doc comment) -- either
      // way, fall through to computing fresh below.
      const persisted = await window.rifffApi.getStemFeatureCache(path)
      if (persisted) return persisted

      const [brightness, bytes] = await Promise.all([
        getBrightness(path),
        window.rifffApi.readAudioFile(path)
      ])
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
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
      void window.rifffApi.setStemFeatureCache(path, features)
      return features
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}
