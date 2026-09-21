// Direct report, 2026-09-21: "when the name this project modal shows it
// takes a moment to be able to change the number or text." Root cause: the
// ambient background scans (BackgroundFeatureScan, DiscoverLibraryScan,
// YamnetZeroShotRetroactiveScan) start at app mount and run a batch every
// BATCH_DELAY_MS for the whole session -- and getStemFeatures' decode +
// MFCC/transient/pitch extraction runs synchronously on the renderer's own
// main thread, so every batch briefly freezes typing and clicks. The
// startup modal opens exactly while those first batches run.
//
// This gate lets those scans yield to the user: a batch only starts while
// no hold is active (a modal is open) and no key/pointer/wheel input has
// happened for `quietMs`. A scan that finds the gate closed just reschedules
// the same batch -- nothing is skipped, only deferred.

export interface BackgroundScanGate {
  noteInteraction: (at: number) => void
  /** Keeps every scan paused until the returned release is called
   * (idempotent -- a second call is a no-op). */
  hold: () => () => void
  mayRun: (at: number) => boolean
}

export function createBackgroundScanGate({
  quietMs,
  now
}: {
  quietMs: number
  now: () => number
}): BackgroundScanGate {
  // Seeded at creation, so the first quietMs after launch counts as
  // "just interacted" -- a startup grace before the first batch.
  let lastInteractionAt = now()
  let holds = 0
  return {
    noteInteraction(at) {
      lastInteractionAt = at
    },
    hold() {
      holds += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holds -= 1
      }
    },
    mayRun(at) {
      return holds === 0 && at - lastInteractionAt >= quietMs
    }
  }
}

const QUIET_MS = 1500

/** The app-wide instance every background scan consults. */
export const backgroundScanGate = createBackgroundScanGate({
  quietMs: QUIET_MS,
  now: () => performance.now()
})

/** Installed once (App.tsx) -- capture phase so nothing downstream can
 * swallow the event before the gate sees it. Returns an uninstall. */
export function installBackgroundScanInteractionListeners(): () => void {
  const note = (): void => backgroundScanGate.noteInteraction(performance.now())
  const events = ['keydown', 'pointerdown', 'wheel'] as const
  for (const type of events) window.addEventListener(type, note, { capture: true, passive: true })
  return () => {
    for (const type of events) window.removeEventListener(type, note, { capture: true })
  }
}
