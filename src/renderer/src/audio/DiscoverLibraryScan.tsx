// src/renderer/src/audio/DiscoverLibraryScan.tsx
import { ARTIST_SCAN_QUEUED_EVENT } from './artistScanQueueEvent'
import { backgroundWorkRegistry } from './backgroundWorkRegistry'
import { countWork } from '../perf/workCounters'
import { useEffect, useRef, useState } from 'react'
import { needsAnyAnalysis } from '@shared/stemAnalysisNeeds'
import { fetchStemAnalysisNeeds } from './analyzeStemOnce'
import {
  IDLE_REST_MS,
  backgroundAnalysisQueue,
  type AnalysisSource,
  type AnalysisWorkItem
} from './backgroundAnalysisQueue'

/** After a failed or partly-failed artist batch, the artist queue rests
 * this long rather than being retried (and logged) on every step. */
const PRIORITY_IDLE_POLL_MS = IDLE_REST_MS
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
 * remount. Asks main ONCE on mount for the work list -- every synced stem
 * whose audio is already downloaded locally AND that still needs some
 * analysis (get-discover-library-scan-work, libraryScanWork.ts: what needs
 * work is worked out first, in SQL and from the trait value table, and only
 * that is checked against the disk, asynchronously, with 0-byte
 * placeholders dropped -- background scan audit 3; never triggers a fresh
 * download) -- and hands it to the one analysis queue
 * (backgroundAnalysisQueue.ts, background scan audit 7) as its library
 * source, beside the artist "analyse overnight" queue as its artist source.
 * The queue runs placed stems first, then the artist queue, then this walk,
 * 3 analyses at a time across all of them. Needs are still asked a page at
 * a time, so the per-stem answer stays the needs function's. Unmounting
 * (consent off) removes both sources: only placed stems remain.
 *
 * It renders nothing: its progress is reported to backgroundWorkRegistry
 * and shown by the app-wide BackgroundWorkIndicator (see the reporting
 * effect at the bottom).
 *
 * HONEST ABOUT SCALE: for a real library the size of Elling's own (52,493
 * total stems, some smaller-but-still-large fraction already downloaded
 * locally), one full pass at the queue's 3 at a time / 500 ms gap is a
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

    // The artist "analyse overnight" queue (main's DiscoverArtistScanQueue):
    // the queue's artist tier, ahead of the library walk. Installed at once
    // -- it doesn't wait for the work list.
    let priorityPausedUntil = 0
    const artist: AnalysisSource = {
      async next(n) {
        if (performance.now() < priorityPausedUntil) return 'idle'
        let batch: Awaited<ReturnType<typeof window.rifffApi.takeArtistScanBatch>>
        try {
          batch = await window.rifffApi.takeArtistScanBatch(n)
        } catch (err) {
          console.error('DiscoverLibraryScan: priority batch failed:', err)
          priorityPausedUntil = performance.now() + PRIORITY_IDLE_POLL_MS
          return 'idle'
        }
        if (cancelled) return 'done'
        setPriorityLeft(batch.remaining)
        // Paused (the archive drive is not mounted), an empty queue, or
        // nothing but temporary failures: rest instead of asking again on
        // every step. A new enqueue ends the rest (the event below).
        if (batch.status === 'paused' || batch.targets.length === 0) return 'idle'
        // Temporary download failures were kept in the queue by main, and
        // rest the queue a while after this batch.
        if (batch.transient > 0) priorityPausedUntil = performance.now() + PRIORITY_IDLE_POLL_MS
        return batch.targets
      },
      // Downloaded and attempted: finished either way -- a failed analysis
      // must not loop.
      done: (keys) => window.rifffApi.finishArtistScanBatch(keys)
    }
    backgroundAnalysisQueue.setSource('artist', artist)

    // "analyse overnight" just queued stems: show the new size and stop
    // resting, so the queue starts at the next step.
    function onQueued(e: Event): void {
      const size = (e as CustomEvent<{ size: number }>).detail?.size
      if (typeof size === 'number') setPriorityLeft(size)
      priorityPausedUntil = 0
      backgroundAnalysisQueue.wake('artist')
    }
    window.addEventListener(ARTIST_SCAN_QUEUED_EVENT, onQueued)

    countWork('ipc:get-discover-library-scan-work')
    void window.rifffApi
      .getDiscoverLibraryScanWork()
      .then(({ work: targets }) => {
        if (cancelled) return
        // What is left to look at: already-analysed stems are no longer in
        // the list, so this starts lower than the library's size.
        setTotal(targets.length)
        const toScan = targets.filter((t) => !attemptedRef.current.has(t.key))

        // Background-efficiency spec, A2/A3: main answers "what does each
        // stem still need" a page at a time (one batched call per
        // NEEDS_PAGE_SIZE targets, fetched when the queue asks for more),
        // stems needing nothing count as completed straight away -- no
        // decode and no per-stem "do you have it?" round trips -- and the
        // rest go to the queue with their needs, so it asks none itself.
        let nextPageStart = 0
        let buffer: AnalysisWorkItem[] = []
        const library: AnalysisSource = {
          async next(n) {
            while (buffer.length === 0) {
              if (cancelled || nextPageStart >= toScan.length) return 'done'
              const page = toScan.slice(nextPageStart, nextPageStart + NEEDS_PAGE_SIZE)
              let needs: Awaited<ReturnType<typeof fetchStemAnalysisNeeds>>
              try {
                needs = await fetchStemAnalysisNeeds(page.map((t) => t.path))
              } catch (err) {
                // Stops this session's pass (nothing is lost -- the next
                // mount starts over from main's persisted state).
                console.error('DiscoverLibraryScan: failed to load analysis needs:', err)
                if (!cancelled) setStopped(true)
                return 'done'
              }
              if (cancelled) return 'done'
              nextPageStart += page.length
              let alreadyDone = 0
              page.forEach((target, i) => {
                const targetNeeds = needs[i]
                if (targetNeeds && needsAnyAnalysis(targetNeeds)) {
                  buffer.push({ key: target.key, path: target.path, needs: targetNeeds })
                } else {
                  attemptedRef.current.add(target.key)
                  alreadyDone += 1
                }
              })
              if (alreadyDone > 0) setCompleted((c) => c + alreadyDone)
            }
            const taken = buffer.slice(0, n)
            buffer = buffer.slice(n)
            return taken
          },
          // Features older than STEM_FEATURE_VERSION come back as needed
          // (Phase 3 re-extraction), alongside anything missing outright --
          // and `zeroShot` for stems embedded before the YAMNet zero-shot
          // step existed (B5: this used to be a second, separate scan).
          done(keys) {
            for (const key of keys) attemptedRef.current.add(key)
            if (!cancelled) setCompleted((c) => c + keys.length)
          }
        }
        backgroundAnalysisQueue.setSource('library', library)
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
      window.removeEventListener(ARTIST_SCAN_QUEUED_EVENT, onQueued)
      // Consent off: both tiers go; a batch in flight finishes.
      backgroundAnalysisQueue.setSource('artist', null)
      backgroundAnalysisQueue.setSource('library', null)
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
