// src/renderer/src/audio/DiscoverLibraryScan.tsx
import { backgroundScanGate } from './backgroundScanGate'
import { countWork } from '../perf/workCounters'
import { useEffect, useRef, useState } from 'react'
import { needsAnyAnalysis, type StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import type { LibraryScanTarget } from '../../../main/discoverLibraryStems'
import { analyzeStemOnce, fetchStemAnalysisNeeds } from './analyzeStemOnce'

// Mirrors BackgroundFeatureScan.tsx's own throttle constants exactly --
// deliberately NOT imported from there. This is genuinely separate,
// wider-scope code (this plan's own Architecture section): duplicating two
// small constants is cheaper than coupling two independently-scoped scan
// mechanisms together.
const BATCH_SIZE = 3
const BATCH_DELAY_MS = 500
// Targets per get-stem-analysis-needs call, fetched ahead of processing
// (background-efficiency spec, A3) -- matches main's own SQL chunk size.
const NEEDS_PAGE_SIZE = 500

/** The real whole-library background scan Task 9's own consent prompt
 * gates -- mounted ONCE, at the app's own top level (App.tsx's Frame(),
 * right alongside BackgroundFeatureScan.tsx, its own conceptual model),
 * gated on the SAME `discoverConsented` state DiscoverPanel.tsx's consent
 * prompt writes to via `setDiscoverSettings`. Deliberately NOT mounted
 * inside DiscoverPanel itself -- DiscoverPanel unmounts/remounts every
 * time LibraryBrowser.tsx's `libraryMode` tab flips between 'browse' and
 * 'discover', and mounting the scan there meant every tab switch restarted
 * this whole throttled batch loop from scratch (no persisted cursor),
 * re-walking the entire previously-scanned prefix before reaching new
 * ground, plus re-running the full target enumeration (a real filesystem
 * check per unique stem) on the main process on every remount. A
 * top-level mount, gated on the same boolean the settings-menu toggle
 * flips, only ever (re)mounts when consent itself actually changes --
 * never on a tab switch or the Import modal opening/closing -- and also
 * means toggling consent off while Discover is open now genuinely stops
 * the scan (React unmounts this), and toggling it on genuinely starts it,
 * rather than that toggle only taking effect on DiscoverPanel's next
 * remount. Enumerates every synced stem whose audio is already
 * downloaded locally (get-discover-library-scan-targets,
 * discoverLibraryStems.ts -- never triggers a fresh download) ONCE on
 * mount, then runs the exact same throttled batch/extract loop
 * BackgroundFeatureScan.tsx already established for placed stems, over
 * this much larger target list.
 *
 * Its progress readout below is rendered fixed-position (rather than
 * inline in some particular screen's layout) precisely because this now
 * mounts independent of any screen being open -- see the style comment
 * on the returned <p> below.
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
 * gotten). Stems main's needs list (get-stem-analysis-needs, fetched a
 * page at a time) reports as fully analysed count as completed as soon as
 * their page arrives, so a mostly-analysed library's bar jumps ahead
 * quickly and then tracks the real remaining work. Now
 * that this mounts once at the app's top level (see above), it resets to 0
 * only when consent is toggled off then back on, or the app restarts --
 * NOT on reopening the Discover tab or the Import modal, since neither of
 * those remounts this component anymore. Even across one of those genuine
 * remounts, a prior pass's own progress is still real, persisted work
 * underneath (the needs list skips it without decoding).
 *
 * Feature versions (2026-09-22, Phase 3): stems whose persisted features
 * predate STEM_FEATURE_VERSION are re-extracted by this same loop, so the
 * first pass after a version bump is a real re-analysis of every old row
 * (same hours-long throttled scale as the very first pass), not a series
 * of cache hits. Old rows stay usable by Discover until replaced. */
export function DiscoverLibraryScan(): React.JSX.Element | null {
  const [total, setTotal] = useState<number | null>(null)
  const [completed, setCompleted] = useState(0)
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    countWork('ipc:get-discover-library-scan-targets')
    void window.rifffApi
      .getDiscoverLibraryScanTargets()
      .then((targets) => {
        if (cancelled) return
        setTotal(targets.length)
        const toScan = targets.filter((t) => !attemptedRef.current.has(t.key))

        // Background-efficiency spec, A2/A3: main answers "what does each
        // stem still need" a page at a time (one batched call per
        // NEEDS_PAGE_SIZE targets, fetched ahead of processing), stems
        // needing nothing count as completed straight away -- no decode
        // and no per-stem "do you have it?" round trips -- and the rest get
        // exactly one decode via analyzeStemOnce, for only what's missing.
        // A fully analysed library makes a session's pass ~one IPC call
        // per page.
        let nextPageStart = 0
        let work: { target: LibraryScanTarget; needs: StemAnalysisNeeds }[] = []
        let workIndex = 0

        // Loads the next page of needs into `work`; stems needing nothing
        // are marked done right away (progress reflects them). Resolves
        // false when the target list is exhausted.
        async function loadNextPage(): Promise<boolean> {
          if (nextPageStart >= toScan.length) return false
          const page = toScan.slice(nextPageStart, nextPageStart + NEEDS_PAGE_SIZE)
          const needs = await fetchStemAnalysisNeeds(page.map((t) => t.path))
          if (cancelled) return false
          nextPageStart += page.length
          work = []
          workIndex = 0
          let alreadyDone = 0
          page.forEach((target, i) => {
            const targetNeeds = needs[i]
            if (targetNeeds && needsAnyAnalysis(targetNeeds)) {
              work.push({ target, needs: targetNeeds })
            } else {
              attemptedRef.current.add(target.key)
              alreadyDone += 1
            }
          })
          if (alreadyDone > 0) setCompleted((c) => c + alreadyDone)
          return true
        }

        // Real regression, found live 2026-09-18 (direct report: "very
        // sluggish buttons... click similar and loader running for about
        // 3 minutes") -- see YamnetZeroShotRetroactiveScan.tsx's own
        // matching fix for the full root-cause writeup. Each batch's real
        // work (an IPC file read, a Web Audio decode, Worker round-trips
        // for analysis and embedding inference) is awaited before the next
        // step is scheduled, capping real concurrency at BATCH_SIZE and
        // making BATCH_DELAY_MS a genuine gap after real work finishes.
        function step(): void {
          if (cancelled) return
          // Yield to the user -- see backgroundScanGate.ts (2026-09-21):
          // wait while a modal is open or input just happened. Deferred,
          // never skipped -- applies to fetching a needs page too.
          if (!backgroundScanGate.mayRun(performance.now())) {
            window.setTimeout(step, BATCH_DELAY_MS)
            return
          }
          if (workIndex >= work.length) {
            void loadNextPage()
              .then((more) => {
                if (more && !cancelled) window.setTimeout(step, BATCH_DELAY_MS)
              })
              .catch((err: unknown) => {
                // Stops this session's pass (nothing is lost -- the next
                // mount starts over from main's persisted state).
                console.error('DiscoverLibraryScan: failed to load analysis needs:', err)
              })
            return
          }
          const batch = work.slice(workIndex, workIndex + BATCH_SIZE)
          workIndex += batch.length
          void (async () => {
            await Promise.allSettled(
              batch.map(({ target, needs }) => {
                attemptedRef.current.add(target.key)
                // Never rejects; logs its own failures. Features older than
                // STEM_FEATURE_VERSION come back as needed (Phase 3
                // re-extraction), alongside anything missing outright.
                return analyzeStemOnce(target.path, needs)
              })
            )
            if (cancelled) return
            setCompleted((c) => c + batch.length)
            window.setTimeout(step, BATCH_DELAY_MS)
          })()
        }
        step()
      })
      .catch((err: unknown) => {
        // A real main-process rejection (e.g. the IPC call itself
        // throwing) used to leave this permanently showing nothing, with
        // no error logged -- the same bug class already hardened once
        // this session in resolveCandidateStem (DiscoverPanel.tsx).
        // `total` stays null here, so the component keeps rendering
        // nothing rather than getting stuck on a stale/misleading
        // progress readout.
        console.error('DiscoverLibraryScan: failed to load scan targets:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (total === null) return null

  // total === 0 (a library with nothing locally cached yet) would otherwise
  // divide by zero -- reads as "done" rather than NaN%, which is the
  // correct display for "nothing to scan" anyway.
  const fraction = total > 0 ? Math.min(1, completed / total) : 1

  return (
    // Fixed position -- this component now mounts once at the app's own
    // top level (App.tsx's Frame()), independent of whether the Discover
    // tab happens to be open, so it can no longer rely on some ancestor
    // screen's own layout/scroll container to place it sensibly.
    //
    // Direct feedback: the original readout (a small boxed text+bar, bottom
    // LEFT) was easy to miss entirely -- Elling could see the scan working
    // in Activity Monitor with no visible confirmation in the app itself.
    // Asked for "somewhere subtle, maybe a line on the bottom right." This
    // is now just the line -- no box, no background, no persistent text --
    // bottom RIGHT, with the "X / Y this session" detail on hover (title)
    // rather than always on screen, still clear of the transport bar/
    // titlebar chrome and every modal's own z-index (every modal/menu in
    // this app sits at 20-1000; this stays well under that).
    <div
      title={`analyzing library: ${completed} / ${total} this session`}
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 10,
        width: 120,
        height: 3,
        background: 'var(--ra-border)',
        overflow: 'hidden'
      }}
    >
      {/* Sharp corners, no border-radius, matching this app's own design
          system throughout -- bright fill on a dim track is the same
          "brightness = live/active" convention buttonStyle's own 'confirmed'
          state already uses elsewhere (ClusterStemsBrowser.tsx), reused here
          since a moving fill is itself a live-activity signal. */}
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
