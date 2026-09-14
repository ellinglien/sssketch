// src/renderer/src/audio/DiscoverLibraryScan.tsx
import { useEffect, useRef, useState } from 'react'
import { getOrExtractStemEmbedding } from './stemEmbeddingCache'
import { getStemFeatures } from './stemFeaturesCache'

// Mirrors BackgroundFeatureScan.tsx's own throttle constants exactly --
// deliberately NOT imported from there. This is genuinely separate,
// wider-scope code (this plan's own Architecture section): duplicating two
// small constants is cheaper than coupling two independently-scoped scan
// mechanisms together.
const BATCH_SIZE = 3
const BATCH_DELAY_MS = 500

/** The real whole-library background scan Task 9's own consent prompt
 * gates -- mounted ONLY while `consentedToLibraryScan` is true
 * (DiscoverPanel.tsx). Enumerates every synced stem whose audio is already
 * downloaded locally (get-discover-library-scan-targets,
 * discoverLibraryStems.ts -- never triggers a fresh download) ONCE on
 * mount, then runs the exact same throttled batch/extract loop
 * BackgroundFeatureScan.tsx already established for placed stems, over
 * this much larger target list.
 *
 * HONEST ABOUT SCALE: for a real library the size of Elling's own (52,493
 * total stems, some smaller-but-still-large fraction already downloaded
 * locally), one full pass at BATCH_SIZE=3 / BATCH_DELAY_MS=500 is a
 * genuinely long-running background process -- order of HOURS, not
 * something that finishes in one sitting. Expected, not a bug: the
 * throttle exists specifically so this never meaningfully competes with
 * real playback/interaction, at the cost of how long one full pass takes.
 *
 * Progress is a SESSION-LOCAL count (how far THIS mount's own loop has
 * gotten), not a live re-query of the persistent cache's real hit count --
 * re-querying actual StemFeatureCache/StemEmbeddingCache row counts against
 * a 50k+-row target list on every batch tick would itself be wasteful. It
 * resets to 0 on every fresh mount (e.g. reopening Discover) even though a
 * prior session's own progress is still real, persisted work underneath
 * (getStemFeatures/getOrExtractStemEmbedding's own caches make a
 * re-attempt on an already-cached stem cheap, not wasted) -- this display
 * just doesn't claim credit for a prior session's work, rather than
 * inventing a persisted cursor this v1 doesn't have. */
export function DiscoverLibraryScan(): React.JSX.Element | null {
  const [total, setTotal] = useState<number | null>(null)
  const [completed, setCompleted] = useState(0)
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void window.rifffApi.getDiscoverLibraryScanTargets().then((targets) => {
      if (cancelled) return
      setTotal(targets.length)
      const toScan = targets.filter((t) => !attemptedRef.current.has(t.key))

      function runBatch(startIndex: number): void {
        if (cancelled) return
        const batch = toScan.slice(startIndex, startIndex + BATCH_SIZE)
        if (batch.length === 0) return
        for (const target of batch) {
          attemptedRef.current.add(target.key)
          void getStemFeatures(target.path).catch((err: unknown) => {
            console.error('DiscoverLibraryScan: feature extraction failed for', target.path, err)
          })
          // getOrExtractStemEmbedding never throws (see its own doc
          // comment) -- no .catch needed, same convention
          // BackgroundFeatureScan.tsx already established.
          void getOrExtractStemEmbedding(target.path)
        }
        setCompleted((c) => c + batch.length)
        const nextIndex = startIndex + BATCH_SIZE
        if (nextIndex < toScan.length) {
          window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
        }
      }
      runBatch(0)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (total === null) return null

  return (
    <p style={{ fontSize: 9, color: 'var(--ra-text-3)', margin: '0 0 10px' }}>
      analyzing library in background: {completed} / {total} locally-cached stems this session
    </p>
  )
}
