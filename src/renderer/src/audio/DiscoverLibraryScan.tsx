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
 * gotten), not a live re-query of the persistent cache's real hit count --
 * re-querying actual StemFeatureCache/StemEmbeddingCache row counts against
 * a 50k+-row target list on every batch tick would itself be wasteful. Now
 * that this mounts once at the app's top level (see above), it resets to 0
 * only when consent is toggled off then back on, or the app restarts --
 * NOT on reopening the Discover tab or the Import modal, since neither of
 * those remounts this component anymore. Even across one of those genuine
 * remounts, a prior pass's own progress is still real, persisted work
 * underneath (getStemFeatures/getOrExtractStemEmbedding's own caches make
 * a re-attempt on an already-cached stem cheap, not wasted) -- this
 * display just doesn't claim credit for it, rather than inventing a
 * persisted cursor this v1 doesn't have. */
export function DiscoverLibraryScan(): React.JSX.Element | null {
  const [total, setTotal] = useState<number | null>(null)
  const [completed, setCompleted] = useState(0)
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void window.rifffApi
      .getDiscoverLibraryScanTargets()
      .then((targets) => {
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
