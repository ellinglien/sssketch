// src/renderer/src/audio/YamnetZeroShotRetroactiveScan.tsx
import { backgroundScanGate } from './backgroundScanGate'
import { useEffect, useRef, useState } from 'react'
import { ensureYamnetZeroShotClassified } from './stemEmbeddingCache'

// Mirrors DiscoverLibraryScan.tsx's own throttle constants exactly --
// deliberately NOT imported from there, same "duplicating two small
// constants is cheaper than coupling two independently-scoped scan
// mechanisms together" reasoning that file's own top comment already
// gives for not sharing with BackgroundFeatureScan.tsx.
const BATCH_SIZE = 3
const BATCH_DELAY_MS = 500

/** One-time-in-spirit migration pass closing a real gap found live,
 * 2026-09-17 ("in discover it wasn't really as accurate honestly"):
 * getOrExtractStemEmbedding (stemEmbeddingCache.ts) is cache-hit-first,
 * so a stem whose YAMNet embedding was already cached BEFORE the
 * zero-shot classification code existed never got a chance to run it --
 * DiscoverLibraryScan.tsx's own loop calls that same function for every
 * synced-and-downloaded stem, but a cache hit returns immediately without
 * ever reaching the code that computes/persists topClassIndex. Against
 * Elling's real library (52,493 stems, ~37,000 already-cached embeddings)
 * this meant StemAutoCategory's 'yamnet-zeroshot' source had ZERO rows,
 * despite the feature shipping and running successfully for every NEW
 * stem going forward.
 *
 * Mounted at the app's own top level (App.tsx, right alongside
 * DiscoverLibraryScan/BackgroundFeatureScan), gated on the SAME
 * `discoverConsented` state those two already share -- this is real
 * per-stem audio decode + model inference, the same cost category the
 * existing scan consent already covers, not a separate consent flow.
 *
 * Enumerates its own targets ONCE on mount via
 * get-yamnet-zeroshot-retroactive-targets (yamnetZeroShotRetroactiveScan.ts,
 * main process) -- every stem with a cached embedding but no recorded
 * classification attempt (StemYamnetZeroShotAttempted) and not already
 * confirmed/auto-categorized by anything else. Genuinely ONE-TIME, unlike
 * DiscoverLibraryScan's own perpetually-rerunnable loop: once a stem is
 * processed, ensureYamnetZeroShotClassified always marks it attempted
 * (success or a genuinely unmapped class), so it drops out of the target
 * list for good -- a future remount (next app launch) re-queries a
 * shrinking, eventually-empty target list rather than redoing the same
 * work. A transient extraction FAILURE (decode error, model unavailable)
 * is the one case left un-marked, so it's naturally retried on the next
 * pass -- see ensureYamnetZeroShotClassified's own doc comment.
 *
 * Same throttled batch-loop shape as DiscoverLibraryScan.tsx (BATCH_SIZE=3,
 * BATCH_DELAY_MS=500) -- this never meaningfully competes with real
 * playback/interaction, at the cost of how long one full pass takes for a
 * large already-embedded backlog. Progress readout stacks directly above
 * DiscoverLibraryScan's own fixed bottom-right bar (bottom: 14, that one's
 * own bottom: 8 + its own 3px height + a 3px gap) rather than overlapping
 * it -- both can legitimately be visible/active at once (a brand new
 * stem needs BOTH a fresh embedding from one AND, if genuinely new, needs
 * no retroactive catch-up at all; an old, already-embedded stem needs
 * only this one). */
export function YamnetZeroShotRetroactiveScan(): React.JSX.Element | null {
  const [total, setTotal] = useState<number | null>(null)
  const [completed, setCompleted] = useState(0)
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void window.rifffApi
      .getYamnetZeroShotRetroactiveTargets()
      .then((targets) => {
        if (cancelled) return
        setTotal(targets.length)
        const toScan = targets.filter((t) => !attemptedRef.current.has(t.path))

        // Real regression, found live 2026-09-18 (direct report: "very
        // sluggish buttons... click similar and loader running for about
        // 3 minutes"): this used to fire every batch member with `void`
        // (fire-and-forget) and schedule the NEXT batch's setTimeout
        // unconditionally, never waiting for the current batch's real
        // work (an IPC file read + Web Audio decode + a real Worker
        // round-trip for inference) to actually finish. Since a single
        // stem's decode+inference routinely takes longer than
        // BATCH_DELAY_MS=500, batches piled up UNBOUNDED over time --
        // after a few seconds, dozens of concurrent decode+inference
        // operations were in flight at once, well past the "small batch,
        // real delay between them" throttle this loop's own doc comment
        // promises. Adding this SECOND always-on scanner (against a
        // ~37,000-stem backlog) alongside the pre-existing
        // DiscoverLibraryScan/BackgroundFeatureScan, which share this
        // exact same bug, tripled the effective unthrottled load -- see
        // those two files' own matching fixes, same day. Awaiting the
        // batch's own work before scheduling the next one caps real
        // concurrency at BATCH_SIZE and makes BATCH_DELAY_MS a genuine
        // gap after real work finishes, not just after it's fired.
        function runBatch(startIndex: number): void {
          if (cancelled) return
          // Yield to the user -- see backgroundScanGate.ts (2026-09-21): this
          // batch's decode/analysis runs on the UI thread, so wait while a
          // modal is open or input just happened. Deferred, never skipped.
          if (!backgroundScanGate.mayRun(performance.now())) {
            window.setTimeout(() => runBatch(startIndex), BATCH_DELAY_MS)
            return
          }
          const batch = toScan.slice(startIndex, startIndex + BATCH_SIZE)
          if (batch.length === 0) return
          void (async () => {
            await Promise.allSettled(
              batch.map((target) => {
                attemptedRef.current.add(target.path)
                return ensureYamnetZeroShotClassified(target.path)
              })
            )
            if (cancelled) return
            setCompleted((c) => c + batch.length)
            const nextIndex = startIndex + BATCH_SIZE
            if (nextIndex < toScan.length) {
              window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
            }
          })()
        }
        runBatch(0)
      })
      .catch((err: unknown) => {
        // Same "don't get stuck on a stale/misleading readout" guard as
        // DiscoverLibraryScan.tsx's own identical catch -- total stays
        // null, so this keeps rendering nothing rather than a frozen bar.
        console.error('YamnetZeroShotRetroactiveScan: failed to load scan targets:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // total === 0 covers both "nothing left to catch up" (the common case
  // once this has run once) and a library with no cached embeddings yet
  // at all -- either way, nothing to show.
  if (total === null || total === 0) return null

  const fraction = Math.min(1, completed / total)

  return (
    <div
      title={`classifying existing stems: ${completed} / ${total} this session`}
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 14,
        zIndex: 10,
        width: 120,
        height: 3,
        background: 'var(--ra-border)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${fraction * 100}%`,
          background: 'var(--ra-stretch-on)',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}
