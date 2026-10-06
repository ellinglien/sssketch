// src/renderer/src/audio/BackgroundFeatureScan.tsx
import { backgroundWorkRegistry } from './backgroundWorkRegistry'
import { useEffect } from 'react'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { backgroundAnalysisQueue } from './backgroundAnalysisQueue'

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

  // Progress goes to BackgroundWorkIndicator.tsx: the placed paths known to
  // need analysis, plus those in flight. Pausable: the queue yields to
  // backgroundScanGate.
  useEffect(() => {
    const unsubscribe = backgroundAnalysisQueue.onProgress((_kind, left) => {
      backgroundWorkRegistry.report(
        'placedAnalysis',
        left > 0 ? { kind: 'placedAnalysis', left, pausable: true } : null
      )
    })
    return () => {
      unsubscribe()
      backgroundAnalysisQueue.setPlaced([])
      backgroundWorkRegistry.report('placedAnalysis', null)
    }
  }, [])

  // The placed tier of the one analysis queue (background scan audit 7,
  // backgroundAnalysisQueue.ts): it goes before the artist queue and the
  // library walk, 3 analyses at a time across all of them, with a real gap
  // after each batch. The queue asks main what each path still needs (one
  // batched call, each path once), never decodes a stem needing nothing,
  // and never analyses a path twice in a session -- keyed by path (the
  // file's identity), not stemKey, so two placements of one stem are one.
  useEffect(() => {
    // Unique paths -- the same stem can be placed more than once.
    backgroundAnalysisQueue.setPlaced([...new Set(flatStems.map((fs) => fs.stem.path))])
  }, [flatStems])

  return null
}
