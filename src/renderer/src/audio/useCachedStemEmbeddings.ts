// src/renderer/src/audio/useCachedStemEmbeddings.ts
import { useEffect, useState } from 'react'
import type { StemFeatureScanItem } from './useStemFeatureScan'

/** Read-only, cache-only, NON-blocking companion to useStemFeatureScan --
 * deliberately does NOT trigger extraction itself (unlike getStemFeatures,
 * which extracts on a cache miss), only reads whatever embeddings are
 * already persisted and updates opportunistically as each read resolves.
 * No `loading` flag: a caller's own scan/render flow never waits on this,
 * it just re-renders with more embeddings filled in as they arrive --
 * neural-net extraction is real work, not a cheap cache-hit-or-decode like
 * the hand-crafted features, so nothing should block on it.
 *
 * Reuses StemFeatureScanItem's own {key, path}[] shape (useStemFeatureScan.ts)
 * rather than inventing a parallel type -- every call site already builds
 * this exact shape for the feature scan, so it's passed straight through
 * to this hook too.
 *
 * `items` must be referentially stable across renders (e.g. built via
 * useMemo), same requirement as useStemFeatureScan.ts's own -- this hook's
 * effect keys off `items`' own identity, not deep equality, so an unstable
 * array would trigger a full reset+refetch every render. */
export function useCachedStemEmbeddings(items: StemFeatureScanItem[]): Map<string, number[]> {
  const [embeddingByKey, setEmbeddingByKey] = useState<Map<string, number[]>>(new Map())

  useEffect(() => {
    let cancelled = false
    // Deferred through a microtask (not called directly) so the reset for
    // a new `items` array doesn't read as a synchronous setState-in-effect
    // -- same established workaround as BeatPicker.tsx's own
    // initialStepsRef reset effect and AutoArrangeRoleStep.tsx's own
    // role-resolution effect (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (!cancelled) setEmbeddingByKey(new Map())
    })
    for (const item of items) {
      window.rifffApi.getStemEmbeddingCache(item.path).then(
        (embedding) => {
          if (cancelled || !embedding) return
          setEmbeddingByKey((prev) => {
            const next = new Map(prev)
            next.set(item.key, embedding)
            return next
          })
        },
        (err: unknown) => {
          // A real SQLite failure (locked/corrupted DB, closed handle) in
          // the main-process handler rejects here rather than resolving
          // null -- without this rejection handler, that becomes a silent
          // unhandled promise rejection with no diagnostic (2026-09-14
          // code quality review). Matches useStemFeatureScan.ts's own
          // per-item failure logging.
          if (!cancelled) {
            console.error('useCachedStemEmbeddings: read failed for stem', item.path, err)
          }
        }
      )
    }
    return () => {
      cancelled = true
    }
  }, [items])

  return embeddingByKey
}
