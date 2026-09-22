// src/renderer/src/audio/BackgroundFeatureScan.tsx
import { backgroundScanGate } from './backgroundScanGate'
import { useEffect, useRef } from 'react'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { needsAnyAnalysis, type StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { analyzeStemOnce, fetchStemAnalysisNeeds } from './analyzeStemOnce'

// Small batches with a real delay between them, rather than firing every
// currently-placed stem's extraction at once -- a large project's worth of
// never-before-scanned stems shouldn't compete heavily with real playback/
// interaction. Stems main reports as fully analysed are skipped outright,
// and analyzeStemOnce itself skips anything already in a cache module's
// memory (a screen's own useStemFeatureScan, or an earlier batch).
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
  // Track attempted stems by path (the actual file identity), not stemKey (a
  // project-local groupId:slot identifier) -- getStemFeatures and its persistent
  // cache both dedupe by path, so this ensures two different placements of the
  // same underlying stem correctly get treated as "already attempted" after the
  // first runs, rather than each triggering their own attempt.
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    const toScan = flatStems.filter((fs) => !attemptedRef.current.has(fs.stem.path))
    if (toScan.length === 0) return
    let cancelled = false

    // One decode per stem, only for what's missing (background-efficiency
    // spec, A2/A3): main answers "what does each placed stem still need"
    // in ONE batched call, stems needing nothing are dropped, and the rest
    // go through analyzeStemOnce -- instead of a getStemFeatures +
    // getOrExtractStemEmbedding pair per stem, each doing its own
    // persisted-cache round trip and (when missing) its own decode.
    // Needs come from main rather than "request all three" because most
    // placed stems are already analysed, and asking for everything would
    // re-decode each of them every session.
    let work: { path: string; needs: StemAnalysisNeeds }[] = []

    // Real regression, found live 2026-09-18 -- see
    // YamnetZeroShotRetroactiveScan.tsx's own matching fix for the full
    // root-cause writeup. The batch is awaited before the next one is
    // scheduled, capping real concurrency at BATCH_SIZE and making
    // BATCH_DELAY_MS a genuine gap after real work finishes.
    function runBatch(startIndex: number): void {
      if (cancelled) return
      // Yield to the user -- see backgroundScanGate.ts (2026-09-21): wait
      // while a modal is open or input just happened. Deferred, never
      // skipped.
      if (!backgroundScanGate.mayRun(performance.now())) {
        window.setTimeout(() => runBatch(startIndex), BATCH_DELAY_MS)
        return
      }
      const batch = work.slice(startIndex, startIndex + BATCH_SIZE)
      if (batch.length === 0) return
      for (const { path } of batch) attemptedRef.current.add(path)
      void (async () => {
        // analyzeStemOnce never rejects and logs its own failures.
        await Promise.allSettled(batch.map(({ path, needs }) => analyzeStemOnce(path, needs)))
        if (cancelled) return
        const nextIndex = startIndex + BATCH_SIZE
        if (nextIndex < work.length) {
          window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
        }
      })()
    }

    // Unique paths -- the same stem can be placed more than once.
    const paths = [...new Set(toScan.map((fs) => fs.stem.path))]
    void fetchStemAnalysisNeeds(paths)
      .then((needs) => {
        if (cancelled) return
        work = []
        paths.forEach((path, i) => {
          const pathNeeds = needs[i]
          if (pathNeeds && needsAnyAnalysis(pathNeeds)) work.push({ path, needs: pathNeeds })
          // Nothing missing -- done, no decode and no further IPC.
          else attemptedRef.current.add(path)
        })
        runBatch(0)
      })
      .catch((err: unknown) => {
        // Nothing was marked attempted, so the next flatStems change retries.
        console.error('BackgroundFeatureScan: failed to load analysis needs:', err)
      })

    return () => {
      cancelled = true
    }
  }, [flatStems])

  return null
}
