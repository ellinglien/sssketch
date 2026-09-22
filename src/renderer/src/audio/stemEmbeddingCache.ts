// src/renderer/src/audio/stemEmbeddingCache.ts
import { countWork } from '../perf/workCounters'
import { decodeStemFile } from './decodeStemFile'
import { resampleTo16kMono } from './resampleTo16kMono'
import { extractEmbeddingAndTopClass } from './yamnetClient'

const cache = new Map<string, Promise<number[] | null>>()

/** Shared decode chain used both by a fresh extraction below and by
 * ensureYamnetZeroShotClassified's own retroactive re-run -- read the raw
 * bytes over IPC, decode, resample to YAMNet's own required 16kHz mono. */
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

/** Retroactive counterpart to getOrExtractStemEmbedding's own zero-shot
 * write, for a stem whose embedding was already cached BEFORE the
 * zero-shot classification path existed -- see
 * yamnetZeroShotRetroactiveScan.ts's own doc comment (main process) for
 * the real, one-time migration gap this closes: getOrExtractStemEmbedding
 * is cache-hit-first and returns the persisted embedding immediately,
 * without ever reaching extractEmbeddingAndTopClass again, so a stem
 * embedded before this classification path existed would otherwise never
 * get a chance to run it.
 *
 * ONLY ever called from YamnetZeroShotRetroactiveScan.tsx's own one-time
 * scan, for a target that component's own IPC query has already confirmed
 * has a cached embedding and no recorded attempt -- re-decodes and re-runs
 * inference specifically to recover topClassIndex, which the ORIGINAL
 * extraction never computed/persisted. Does NOT re-write the embedding
 * itself (already correct, cached) and does NOT consult/populate the
 * module-level `cache` above -- this is a one-off classification pass for
 * a specific stem, not something any other caller would ever ask this
 * module for again.
 *
 * Always marks the stem "attempted" on a SUCCESSFUL extraction, even if
 * topClassIndex itself ends up null or doesn't map to any ArrangeRole --
 * a real inference result, however unhelpful, is deterministic for the
 * same audio file, so retrying it later would just waste the same
 * decode+inference cost for the same answer (see
 * markYamnetZeroShotAttempted's own doc comment, main process). Does NOT
 * mark "attempted" on an outright extraction failure (decode error, model
 * unavailable) -- those ARE worth retrying, since they're plausibly
 * transient, matching getOrExtractStemEmbedding's own error handling. */
export async function ensureYamnetZeroShotClassified(path: string): Promise<void> {
  try {
    const pcm = await decodeAndResample(path)
    const result = await extractEmbeddingAndTopClass(pcm)
    if (!result) return
    void window.rifffApi.markYamnetZeroShotAttempted(path)
    if (result.topClassIndex !== null) {
      void window.rifffApi.setYamnetZeroShotCategory(path, result.topClassIndex)
    }
  } catch (err) {
    console.error('ensureYamnetZeroShotClassified: failed for stem', path, err)
  }
}
