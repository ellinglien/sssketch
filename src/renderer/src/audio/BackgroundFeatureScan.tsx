// src/renderer/src/audio/BackgroundFeatureScan.tsx
import { useEffect, useRef } from 'react'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { getOrExtractStemEmbedding } from './stemEmbeddingCache'
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

    // Real regression, found live 2026-09-18 -- see
    // YamnetZeroShotRetroactiveScan.tsx's own matching fix for the full
    // root-cause writeup. This loop used to fire every batch member with
    // `void` (fire-and-forget) and schedule the NEXT batch's setTimeout
    // unconditionally, never waiting for the current batch's real work
    // (an IPC file read, a Web Audio decode, and a real Worker round-trip
    // for embedding inference) to actually finish -- so batches piled up
    // unbounded well past this loop's own BATCH_SIZE=3 intent. Awaiting
    // the batch before scheduling the next one caps real concurrency at
    // BATCH_SIZE and makes BATCH_DELAY_MS a genuine gap after real work
    // finishes, not just after it's fired.
    function runBatch(startIndex: number): void {
      if (cancelled) return
      const batch = toScan.slice(startIndex, startIndex + BATCH_SIZE)
      if (batch.length === 0) return
      void (async () => {
        await Promise.allSettled(
          batch.flatMap((fs) => {
            attemptedRef.current.add(fs.stem.path)
            return [
              getStemFeatures(fs.stem.path).catch((err: unknown) => {
                console.error(
                  'BackgroundFeatureScan: feature extraction failed for stem',
                  fs.stem.path,
                  err
                )
              }),
              // Embedding extraction (Plan B2) rides the exact same batch/
              // throttle loop as the hand-crafted feature extraction above,
              // rather than a second parallel scan -- getOrExtractStemEmbedding
              // never throws (see its own doc comment), so a rejection here
              // would be a genuine bug, not an expected failure mode.
              getOrExtractStemEmbedding(fs.stem.path)
            ]
          })
        )
        if (cancelled) return
        const nextIndex = startIndex + BATCH_SIZE
        if (nextIndex < toScan.length) {
          window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
        }
      })()
    }
    runBatch(0)

    return () => {
      cancelled = true
    }
  }, [flatStems])

  return null
}
