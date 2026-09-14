// src/renderer/src/audio/stemEmbeddingCache.ts
import { getAudioContext } from './peakCache'
import { resampleTo16kMono } from './resampleTo16kMono'
import { extractEmbedding } from './yamnetClient'

const cache = new Map<string, Promise<number[] | null>>()

/** Extracts (or returns the already-in-flight/cached extraction for) one
 * stem's YAMNet embedding -- persistent-cache-first (a stem the background
 * scan or a prior session already extracted needs no decode/inference at
 * all), same two-tier shape as stemFeaturesCache.ts's own getStemFeatures.
 *
 * ONLY ever called from BackgroundFeatureScan.tsx's own ambient extraction
 * pass (a later task) -- deliberately NOT a general-purpose "get embedding,
 * warm the cache if needed" function any screen calls directly, unlike
 * getStemFeatures. Neural-net inference is meaningfully slower than the
 * hand-crafted feature extraction it sits alongside, so forcing a screen's
 * own "analyzing stems…" step to wait on it would reintroduce exactly the
 * visible-wait problem Plan A's persistent-cache work eliminated. Screens
 * read whatever's already cached via useCachedStemEmbeddings (a later
 * task), which never triggers extraction.
 *
 * Returns null (never throws) for a stem that fails to extract for ANY
 * reason (decode failure, resample failure, model unavailable, inference
 * failure) -- logged, not propagated, matching getStemFeatures' own
 * Promise.allSettled-friendly caller conventions elsewhere in this
 * codebase, though this function itself never rejects at all (simpler for
 * a background-only caller that just wants to know "did it work").
 * Unlike getStemFeatures, which re-throws (rejects) after cache.delete on
 * failure, this always resolves -- the different, best-effort background
 * caller contract, not an oversight.
 *
 * Also treats an all-zero embedding as a failure, same as null -- YAMNet's
 * own worker (yamnetWorker.ts's meanPoolEmbedding) returns an all-zero
 * vector rather than an error when a clip is too short to produce even one
 * analysis frame (its own ~0.975s window), which is a real, non-exotic
 * case for Endlesss's typically-short one-shot/hit stem exports. Left
 * unguarded, that degenerate vector would otherwise persist to the
 * cross-session cache as if it were a genuine embedding, then silently
 * corrupt a later nearest-neighbor/cosine-similarity match against it
 * (2026-09-14 code quality review). */
export function getOrExtractStemEmbedding(path: string): Promise<number[] | null> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async (): Promise<number[] | null> => {
    try {
      const persisted = await window.rifffApi.getStemEmbeddingCache(path)
      if (persisted) return persisted

      const bytes = await window.rifffApi.readAudioFile(path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const pcm = await resampleTo16kMono(audioBuffer)
      const embedding = await extractEmbedding(pcm)
      if (!embedding || embedding.every((v) => v === 0)) return null

      // Fire-and-forget, matching getStemFeatures' own setStemFeatureCache
      // call -- a real library stem's path persists for next time; a
      // non-library path is silently skipped main-process-side.
      void window.rifffApi.setStemEmbeddingCache(path, embedding)
      return embedding
    } catch (err) {
      console.error('getOrExtractStemEmbedding: extraction failed for stem', path, err)
      cache.delete(path)
      return null
    }
  })()

  cache.set(path, promise)
  return promise
}
