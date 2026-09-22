// src/renderer/src/audio/stemEmbeddingCache.ts
import { countWork } from '../perf/workCounters'
import { decodeStemFile } from './decodeStemFile'
import { resampleTo16kMono } from './resampleTo16kMono'
import { extractEmbeddingAndTopClass } from './yamnetClient'

const cache = new Map<string, Promise<number[] | null>>()

/** Decode chain for a fresh extraction below -- read the raw bytes over
 * IPC, decode, resample to YAMNet's own required 16kHz mono. */
async function decodeAndResample(path: string): Promise<Float32Array> {
  return resampleTo16kMono(await decodeStemFile(path))
}

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
      countWork('ipc:get-stem-embedding-cache')
      const persisted = await window.rifffApi.getStemEmbeddingCache(path)
      if (persisted) return persisted

      return await embedAndPersist(path, await decodeAndResample(path))
    } catch (err) {
      console.error('getOrExtractStemEmbedding: extraction failed for stem', path, err)
      cache.delete(path)
      return null
    }
  })()

  cache.set(path, promise)
  return promise
}

/** YAMNet inference on already-resampled 16 kHz mono PCM, then the same
 * persistence + zero-shot side effects for every fresh extraction (shared
 * by getOrExtractStemEmbedding and adoptStemEmbeddingFromBuffer). Null for
 * no result or an all-zero embedding -- see getOrExtractStemEmbedding. */
async function embedAndPersist(path: string, pcm: Float32Array): Promise<number[] | null> {
  const result = await extractEmbeddingAndTopClass(pcm)
  if (!result || result.embedding.every((v) => v === 0)) return null

  // Fire-and-forget, matching getStemFeatures' own setStemFeatureCache
  // call -- a real library stem's path persists for next time; a
  // non-library path is silently skipped main-process-side.
  countWork('ipc:set-stem-embedding-cache')
  void window.rifffApi.setStemEmbeddingCache(path, result.embedding)
  // Marks the attempt regardless of topClassIndex -- see
  // markYamnetZeroShotAttempted's own doc comment (main process) for
  // why "tried, found nothing mappable" still needs recording.
  countWork('ipc:mark-yamnet-zeroshot-attempted')
  void window.rifffApi.markYamnetZeroShotAttempted(path)
  if (result.topClassIndex !== null) {
    countWork('ipc:set-yamnet-zeroshot-category')
    void window.rifffApi.setYamnetZeroShotCategory(path, result.topClassIndex)
  }
  return result.embedding
}

/** True when this path already has an in-memory entry (settled or in
 * flight). */
export function hasStemEmbeddingEntry(path: string): boolean {
  return cache.has(path)
}

/** Extracts from an already-decoding buffer (analyzeStemOnce.ts) -- same
 * resample, inference, persistence and zero-shot writes as
 * getOrExtractStemEmbedding, minus that function's own read+decode.
 * Installed as this path's entry so getOrExtractStemEmbedding shares it
 * mid-flight. Returns null (nothing installed) when the path already has
 * an entry. Never rejects, same contract as getOrExtractStemEmbedding. */
export function adoptStemEmbeddingFromBuffer(
  path: string,
  audioBuffer: Promise<AudioBuffer>
): Promise<number[] | null> | null {
  if (cache.has(path)) return null
  const promise = (async (): Promise<number[] | null> => {
    try {
      return await embedAndPersist(path, await resampleTo16kMono(await audioBuffer))
    } catch (err) {
      console.error('adoptStemEmbeddingFromBuffer: extraction failed for stem', path, err)
      // Unguarded, same as getOrExtractStemEmbedding: only this entry can be
      // installed for the path while it's in flight.
      cache.delete(path)
      return null
    }
  })()
  cache.set(path, promise)
  return promise
}

const zeroShotEntries = new Map<string, Promise<boolean>>()

/** True when this path's zero-shot step is in flight or already succeeded
 * this session. */
export function hasZeroShotEntry(path: string): boolean {
  return zeroShotEntries.has(path)
}

/** Zero-shot classification for a stem whose embedding is ALREADY cached --
 * one embedded before the zero-shot code existed (background efficiency B5;
 * main's get-stem-analysis-needs reports it as `zeroShot`).
 * getOrExtractStemEmbedding is cache-hit-first, so such a stem never
 * reaches extractEmbeddingAndTopClass again on its own; this re-runs
 * inference on the stem's already-decoding buffer (analyzeStemOnce.ts --
 * the same decode as any other output it needs) purely to recover
 * topClassIndex. Replaces the old separate retroactive scan
 * (YamnetZeroShotRetroactiveScan.tsx), which decoded each target itself.
 *
 * Does NOT re-write the embedding (already correct, cached) and does NOT
 * touch the embedding `cache` above. Marks the stem "attempted" on any
 * successful inference, even when topClassIndex is null or maps to no
 * ArrangeRole -- a real result is deterministic for the same audio, so
 * retrying would waste the same work (see markYamnetZeroShotAttempted,
 * main process). Does NOT mark on an outright failure (decode error, model
 * unavailable) -- plausibly transient, so the entry is dropped and a later
 * pass retries it. Resolves true on success; never rejects. Returns null
 * (nothing started) when the path already has an entry. */
export function adoptZeroShotFromBuffer(
  path: string,
  audioBuffer: Promise<AudioBuffer>
): Promise<boolean> | null {
  if (zeroShotEntries.has(path)) return null
  const promise = (async (): Promise<boolean> => {
    try {
      const result = await extractEmbeddingAndTopClass(await resampleTo16kMono(await audioBuffer))
      if (!result) {
        zeroShotEntries.delete(path)
        return false
      }
      countWork('ipc:mark-yamnet-zeroshot-attempted')
      void window.rifffApi.markYamnetZeroShotAttempted(path)
      if (result.topClassIndex !== null) {
        countWork('ipc:set-yamnet-zeroshot-category')
        void window.rifffApi.setYamnetZeroShotCategory(path, result.topClassIndex)
      }
      return true
    } catch (err) {
      console.error('adoptZeroShotFromBuffer: failed for stem', path, err)
      zeroShotEntries.delete(path)
      return false
    }
  })()
  zeroShotEntries.set(path, promise)
  return promise
}
