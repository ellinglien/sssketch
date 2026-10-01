// src/renderer/src/audio/DiscoverLibraryScan.tsx
import { backgroundScanGate } from './backgroundScanGate'
import { ARTIST_SCAN_QUEUED_EVENT } from './artistScanQueueEvent'
import { backgroundWorkRegistry } from './backgroundWorkRegistry'
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
/** Once the local walk is done, how often the scan looks at the artist
 * analysis queue (Discover artist mode's "analyse overnight"). */
const PRIORITY_IDLE_POLL_MS = 30_000
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
 * It renders nothing: its progress is reported to backgroundWorkRegistry
 * and shown by the app-wide BackgroundWorkIndicator (see the reporting
 * effect at the bottom).
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
export function DiscoverLibraryScan(): null {
  const [total, setTotal] = useState<number | null>(null)
  const [completed, setCompleted] = useState(0)
  // Set when a needs page fails to load, which ends this session's pass --
  // so the indicator stops saying "analysing" for a loop that has stopped.
  const [stopped, setStopped] = useState(false)
  // Stems still in the artist analysis queue (main's DiscoverArtistScanQueue).
  const [priorityLeft, setPriorityLeft] = useState(0)
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    let removeQueuedListener = (): void => {}
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

        // After a failed priority batch, the queue rests this long rather
        // than being retried (and logged) on every step.
        let priorityPausedUntil = 0

        /** One priority batch (artist "analyse overnight"). True when it did work. */
        async function runPriorityBatch(): Promise<boolean> {
          if (performance.now() < priorityPausedUntil) return false
          const batch = await window.rifffApi.takeArtistScanBatch(BATCH_SIZE)
          if (cancelled) return false
          setPriorityLeft(batch.remaining)
          // Paused (the archive drive is not mounted), an empty queue, or
          // nothing but temporary failures: rest instead of asking again on
          // every step. A new enqueue ends the rest (the event below).
          if (batch.status === 'paused' || batch.targets.length === 0) {
            priorityPausedUntil = performance.now() + PRIORITY_IDLE_POLL_MS
            return false
          }
          const ready = batch.targets
          const needs = await fetchStemAnalysisNeeds(ready.map((t) => t.path))
          await Promise.allSettled(
            ready.map((t, i) =>
              needs[i] && needsAnyAnalysis(needs[i]) ? analyzeStemOnce(t.path, needs[i]) : undefined
            )
          )
          // Downloaded and attempted: finished either way -- a failed
          // analysis must not loop. Temporary download failures were kept
          // in the queue by main, and rest the queue a while.
          await window.rifffApi.finishArtistScanBatch(ready.map((t) => t.key))
          if (batch.transient > 0) priorityPausedUntil = performance.now() + PRIORITY_IDLE_POLL_MS
          return true
        }

        // "analyse overnight" just queued stems: show the new size and stop
        // resting, so the queue starts at the next step.
        function onQueued(e: Event): void {
          const size = (e as CustomEvent<{ size: number }>).detail?.size
          if (typeof size === 'number') setPriorityLeft(size)
          priorityPausedUntil = 0
        }
        window.addEventListener(ARTIST_SCAN_QUEUED_EVENT, onQueued)
        removeQueuedListener = () => window.removeEventListener(ARTIST_SCAN_QUEUED_EVENT, onQueued)

        // Real regression, found live 2026-09-18 (direct report: "very
        // sluggish buttons... click similar and loader running for about
        // 3 minutes"): batches used to be fired without awaiting the
        // previous one's work, so after a few seconds dozens of
        // decode+inference jobs were in flight at once. Each batch's real
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
          // The artist analysis queue goes first, one batch per step.
          void runPriorityBatch()
            .then((didWork) => {
              if (cancelled) return
              if (didWork) {
                window.setTimeout(step, BATCH_DELAY_MS)
                return
              }
              stepLocal()
            })
            .catch((err: unknown) => {
              console.error('DiscoverLibraryScan: priority batch failed:', err)
              priorityPausedUntil = performance.now() + PRIORITY_IDLE_POLL_MS
              if (!cancelled) stepLocal()
            })
        }

        function stepLocal(): void {
          if (cancelled) return
          if (workIndex >= work.length) {
            void loadNextPage()
              .then((more) => {
                // The local walk done, keep idling for the artist queue.
                if (!cancelled)
                  window.setTimeout(step, more ? BATCH_DELAY_MS : PRIORITY_IDLE_POLL_MS)
              })
              .catch((err: unknown) => {
                // Stops this session's pass (nothing is lost -- the next
                // mount starts over from main's persisted state).
                console.error('DiscoverLibraryScan: failed to load analysis needs:', err)
                if (!cancelled) setStopped(true)
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
                // re-extraction), alongside anything missing outright --
                // and `zeroShot` for stems embedded before the YAMNet
                // zero-shot step existed (B5: this used to be a second,
                // separate scan that re-listed and decoded those stems).
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
      removeQueuedListener()
    }
  }, [])

  // Progress goes to the one app-wide background-work indicator
  // (BackgroundWorkIndicator.tsx) rather than a readout of its own: this
  // component used to draw a thin progress line in the bottom-right
  // corner, which sat under the Library Browser's opaque full-screen layer
  // -- invisible in exactly the screen (Discover) where this scan's cost
  // was felt. Pausable: it yields to backgroundScanGate, whose hold is what
  // the indicator's pause control takes.
  useEffect(() => {
    if (total === null || stopped || (completed >= total && priorityLeft === 0)) {
      backgroundWorkRegistry.report('stemAnalysis', null)
      return
    }
    backgroundWorkRegistry.report('stemAnalysis', {
      kind: 'stemAnalysis',
      left: Math.max(0, total - completed) + priorityLeft,
      pausable: true
    })
  }, [total, completed, stopped, priorityLeft])
  useEffect(() => () => backgroundWorkRegistry.report('stemAnalysis', null), [])

  return null
}
