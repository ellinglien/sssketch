// src/renderer/src/audio/detailPeakCache.ts
//
// A finer waveform than peakCache.ts's 128 buckets, for the re-one picker
// (BeatPicker.tsx). 128 buckets suit a clip-sized waveform; spread across a
// re-one lane they smear drum hits and note onsets together, and those are
// what you look for to find the downbeat. Same shape as the other analysis
// caches here (CLAUDE.md "Analysis caches"): keyed by path, one computation
// shared by every caller, evicted on rejection, and evicted by a re-bake
// (evictStemAnalysis.ts), which rewrites a path in place.
//
// The picker already holds every stem's decoded buffer for its own preview
// playback, so a caller can hand that buffer in and nothing is decoded a
// second time. Without one, it decodes through decodeStemFile, which shares
// any decode of the same path already in flight.
//
// Not persisted: it is only drawn while a picker is open. Bounded to the
// newest DETAIL_ENTRY_CAP paths, so a long session of imports doesn't keep
// every stem it ever re-oned.

import { decodeStemFile } from './decodeStemFile'
import { waveformFromBuffer, type WaveformAnalysis } from './peakCache'

/** A batch import of a dozen riffs, six stems each, stays warm while you
 * page between them. */
export const DETAIL_ENTRY_CAP = 96

// A Map iterates in insertion order: re-inserting on use makes the first
// key the least recently used.
const cache = new Map<string, { buckets: number; promise: Promise<WaveformAnalysis> }>()

export function getDetailWaveform(
  path: string,
  buckets: number,
  decoded?: AudioBuffer
): Promise<WaveformAnalysis> {
  const hit = cache.get(path)
  if (hit && hit.buckets === buckets) {
    cache.delete(path)
    cache.set(path, hit)
    return hit.promise
  }

  const promise = (async () => {
    const buffer = decoded ?? (await decodeStemFile(path))
    return waveformFromBuffer(buffer, buckets)
  })()
  cache.delete(path)
  cache.set(path, { buckets, promise })
  while (cache.size > DETAIL_ENTRY_CAP) {
    cache.delete(cache.keys().next().value as string)
  }
  promise.catch(() => {
    if (cache.get(path)?.promise === promise) cache.delete(path)
  })
  return promise
}

/** Called by evictStemAnalysis alongside every other path-keyed cache. */
export function evictDetailWaveform(path: string): void {
  cache.delete(path)
}
