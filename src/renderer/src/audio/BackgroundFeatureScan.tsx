// src/renderer/src/audio/BackgroundFeatureScan.tsx
import { useEffect, useRef } from 'react'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { getStemFeatures } from './stemFeaturesCache'

// Small batches with a real delay between them, rather than firing every
// currently-placed stem's extraction at once -- a large project's worth of
// never-before-scanned stems shouldn't compete heavily with real playback/
// interaction. getStemFeatures' own two-tier cache (renderer memory, then
// the persistent store) means calling it here for a stem some OTHER path
// (a screen's own useStemFeatureScan, or an earlier batch) already
// resolved is a cheap no-op, not redundant work.
const BATCH_SIZE = 3
const BATCH_DELAY_MS = 500

/** Ambient, always-on background scan -- proactively warms getStemFeatures'
 * cache for every stem currently placed on the timeline, independent of
 * whether Tidy Up or Auto-Arrange happen to be open. Mounted once at the
 * top level (Frame(), alongside SketchModeAutoFollow) rather than
 * triggered by any one screen opening -- per the design spec's own §9,
 * the whole point is that opening a screen should typically find its
 * stems already scanned rather than triggering a visible wait of its own.
 * Scoped to PLACED stems only, not the whole synced library (which can run
 * to thousands of stems nobody has placed anywhere) -- scanning the entire
 * library ahead of time is the discover screen's own concern (§8), since
 * that's the first feature that needs features for stems nobody has
 * placed anywhere yet. Renders nothing (mirrors SketchModeAutoFollow's own
 * `(): null` shape). */
export function BackgroundFeatureScan(): null {
  const { flatStems } = usePlacedFlatStems()
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    const toScan = flatStems.filter((fs) => !attemptedRef.current.has(fs.stemKey))
    if (toScan.length === 0) return
    let cancelled = false

    function runBatch(startIndex: number): void {
      if (cancelled) return
      const batch = toScan.slice(startIndex, startIndex + BATCH_SIZE)
      if (batch.length === 0) return
      for (const fs of batch) {
        attemptedRef.current.add(fs.stemKey)
        void getStemFeatures(fs.stem.path).catch((err: unknown) => {
          console.error('BackgroundFeatureScan: extraction failed for stem', fs.stem.path, err)
        })
      }
      const nextIndex = startIndex + BATCH_SIZE
      if (nextIndex < toScan.length) {
        window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
      }
    }
    runBatch(0)

    return () => {
      cancelled = true
    }
  }, [flatStems])

  return null
}
