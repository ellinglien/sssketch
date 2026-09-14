import { useEffect, useState } from 'react'
import type { StemFeatures } from '@shared/stemFeatures'
import { getStemFeatures } from './stemFeaturesCache'

export interface StemFeatureScanItem {
  key: string
  path: string
}

export interface StemFeatureScanResult {
  loading: boolean
  featuresByKey: Map<string, StemFeatures>
}

/**
 * Shared scan orchestration for "get every one of these stems' own
 * StemFeatures" -- the exact useEffect + Promise.allSettled + loading-
 * state wrapper AutoArrangeRoleStep.tsx and ClusterStemsBrowser.tsx used to
 * each reimplement independently around getStemFeatures
 * (stemFeaturesCache.ts) itself (see the design spec's own §9 consolidation
 * priority). With Task 8's persistent-cache redesign, most calls here
 * resolve near-instantly (a cache hit needs no decode) -- this hook's own
 * loading state still matters for whatever hasn't been scanned/persisted
 * yet, it just resolves fast in the common case rather than eliminating
 * the concept of "loading" entirely. A stem whose extraction genuinely
 * fails (corrupt/unreadable file) is logged and excluded from
 * featuresByKey entirely, matching both original call sites' own "don't
 * substitute a fake zero-vector entry" reasoning (a fake entry would
 * corrupt any per-population standardization a caller runs downstream --
 * see stemFeatures.ts's own standardizeFeatures).
 *
 * `items` must be a referentially-stable array across renders (e.g. built
 * via useMemo, the way ClusterStemsBrowser.tsx's own `stems` and
 * AutoArrangeRoleStep.tsx's own `flatStems` already are) -- this hook's
 * effect keys off `items`' own identity, not deep equality.
 *
 * Keyed by a caller-supplied `key` (this app's own stemKey convention), not
 * `path` -- downstream callers already key their own per-stem state by
 * stemKey elsewhere, so this hook stays consistent with that.
 *
 * `loading` is derived from comparing the last completed scan's own item-
 * array reference against the current `items`, not a separate useState --
 * same pattern ClusterStemsBrowser.tsx's own pre-extraction `computed`/
 * `loading` split already used, to avoid a synchronous setState-in-effect
 * that would trip this codebase's react-hooks/set-state-in-effect lint
 * rule (see that component's own doc comment for the same reasoning).
 */
export function useStemFeatureScan(items: StemFeatureScanItem[]): StemFeatureScanResult {
  const [scanned, setScanned] = useState<{
    forItems: StemFeatureScanItem[]
    featuresByKey: Map<string, StemFeatures>
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const results = await Promise.allSettled(
        items.map(async (item) => ({ key: item.key, features: await getStemFeatures(item.path) }))
      )
      if (cancelled) return
      const featuresByKey = new Map<string, StemFeatures>()
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          featuresByKey.set(result.value.key, result.value.features)
        } else {
          console.error(
            'useStemFeatureScan: feature extraction failed for stem',
            items[i].path,
            result.reason
          )
        }
      })
      setScanned({ forItems: items, featuresByKey })
    })().catch((err: unknown) => {
      if (!cancelled) {
        console.error('useStemFeatureScan: scan failed', err)
        setScanned({ forItems: items, featuresByKey: new Map() })
      }
    })
    return () => {
      cancelled = true
    }
  }, [items])

  const loading = scanned === null || scanned.forItems !== items
  return { loading, featuresByKey: loading ? new Map() : scanned.featuresByKey }
}
