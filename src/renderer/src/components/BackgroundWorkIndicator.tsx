import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  summarizeBackgroundWork,
  type BackgroundWork,
  type BackgroundWorkKind
} from '@shared/backgroundWork'
import type { PrewarmScanProgress } from '../../../main/discoverCandidates'
import type { AutoClassifyStatus } from '../../../main/stemAutoClassifyScheduler'
import { backgroundScanGate } from '../audio/backgroundScanGate'
import { backgroundWorkRegistry } from '../audio/backgroundWorkRegistry'
import { usePluginScanState } from '../state/StoreContext'

/** One small, calm line saying what the app is doing in the background --
 * direct request, 2026-09-30: "give a warning to the user when there is a
 * background process in the app." Discover had felt sluggish while the
 * whole-library stem analysis decoded audio on the renderer's own thread,
 * and nothing on screen said so.
 *
 * Gathers every long-running process into one line
 * (@shared/backgroundWork decides the wording and which one leads):
 * - stem analysis, library-wide and placed stems -- backgroundWorkRegistry
 *   (DiscoverLibraryScan / BackgroundFeatureScan report there);
 * - the startup library index -- the library-warmup IPC pair (this folds
 *   in what LibraryWarmupIndicator used to show on its own);
 * - auto-classify -- auto-classify-status;
 * - plugin scan -- usePluginScanState;
 * - riff library sync -- riff-library-sync-active plus the existing
 *   per-riff progress events.
 * Renders nothing when none of them is running.
 *
 * Pause: only the two analysis scans can pause, because they already
 * yield to backgroundScanGate (radio and the startup modals hold it the
 * same way). "pause" takes one more hold; "resume" releases only that
 * one, so a scan radio is holding stays paused until radio stops.
 *
 * Bottom-right, fixed, just above the full-screen tier: always on screen,
 * the Library Browser (Discover) included -- its panel leaves a margin
 * around the viewport edge, so the line sits beside it, not over it. */
export function BackgroundWorkIndicator(): React.JSX.Element | null {
  const reported = useSyncExternalStore(
    backgroundWorkRegistry.subscribe,
    backgroundWorkRegistry.snapshot
  )
  const gateHeld = useSyncExternalStore(backgroundScanGate.subscribe, backgroundScanGate.isHeld)
  const { scanning: pluginScanning, progress: pluginProgress } = usePluginScanState()
  const libraryIndex = useLibraryIndexWork()
  const autoClassify = useAutoClassifyWork()
  const librarySync = useLibrarySyncWork()

  // The user's own hold, if they pressed pause.
  const userHoldRef = useRef<(() => void) | null>(null)
  const [userPaused, setUserPaused] = useState(false)

  const works: (BackgroundWork | null)[] = [
    ...reported.map((w) => (w.pausable ? { ...w, paused: gateHeld } : w)),
    libraryIndex,
    autoClassify,
    pluginScanning
      ? {
          kind: 'pluginScan' as BackgroundWorkKind,
          done: pluginProgress?.done,
          total: pluginProgress?.total
        }
      : null,
    librarySync
  ]
  const summary = summarizeBackgroundWork(works)
  const anyPausable = summary?.pausable === true

  // Nothing left to pause (a scan finished, or consent was turned off):
  // drop the user's hold, so a scan that starts later is not silently
  // held by a pause nobody can see anymore.
  useEffect(() => {
    if (anyPausable || !userHoldRef.current) return
    userHoldRef.current()
    userHoldRef.current = null
    setUserPaused(false)
  }, [anyPausable])

  useEffect(
    () => () => {
      userHoldRef.current?.()
      userHoldRef.current = null
    },
    []
  )

  if (!summary) return null

  function togglePause(): void {
    if (userHoldRef.current) {
      userHoldRef.current()
      userHoldRef.current = null
      setUserPaused(false)
    } else {
      userHoldRef.current = backgroundScanGate.hold()
      setUserPaused(true)
    }
  }

  // Held by something else (radio, a startup modal): the line already says
  // paused, and there is no hold of ours to release.
  const showControl = anyPausable && (userPaused || !gateHeld)

  return (
    <div
      role="status"
      title={summary.title}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 'calc(var(--ra-z-fullscreen) + 1)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 'calc(100vw - 16px)',
        padding: '3px 8px',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        fontSize: 'var(--ra-fs-9)',
        color: 'var(--ra-text-3)',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary.label}</span>
      {summary.more ? <span style={{ color: 'var(--ra-text-4)' }}>{summary.more}</span> : null}
      {showControl ? (
        <button
          onClick={togglePause}
          title={userPaused ? 'resume analysis' : 'pause analysis'}
          style={{
            height: 16,
            borderRadius: 0,
            padding: '0 6px',
            fontSize: 'var(--ra-fs-9)',
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          {userPaused ? 'resume' : 'pause'}
        </button>
      ) : null}
    </div>
  )
}

/** The startup library index (prewarmDiscoverCandidateCaches) -- the same
 * query-once-plus-push plumbing LibraryWarmupIndicator used: the query
 * covers a warmup that finished before this mounted, the pushes cover one
 * that hasn't. Usually hidden behind StartupGate; this covers the rare
 * case of warmup still running once the gate has closed. */
function useLibraryIndexWork(): BackgroundWork | null {
  const [done, setDone] = useState(true)
  const [progress, setProgress] = useState<PrewarmScanProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getLibraryWarmupStatus()
      .then((status) => {
        if (!cancelled) setDone(status)
      })
      .catch((err) => {
        console.error('BackgroundWorkIndicator: getLibraryWarmupStatus failed:', err)
      })
    const unsubscribeComplete = window.rifffApi.onLibraryWarmupComplete(() => {
      if (!cancelled) {
        setDone(true)
        setProgress(null)
      }
    })
    const unsubscribeProgress = window.rifffApi.onLibraryWarmupProgress((update) => {
      if (!cancelled) setProgress(update)
    })
    return () => {
      cancelled = true
      unsubscribeComplete()
      unsubscribeProgress()
    }
  }, [])

  if (done) return null
  return progress
    ? { kind: 'libraryIndex', done: progress.completed, total: progress.total }
    : { kind: 'libraryIndex' }
}

function useAutoClassifyWork(): BackgroundWork | null {
  const [status, setStatus] = useState<AutoClassifyStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getAutoClassifyStatus()
      // A push can land before this reply; the push is the newer answer.
      .then((initial) => {
        if (!cancelled) setStatus((prev) => prev ?? initial)
      })
      .catch((err) => {
        console.error('BackgroundWorkIndicator: getAutoClassifyStatus failed:', err)
      })
    const unsubscribe = window.rifffApi.onAutoClassifyStatus((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (!status?.active) return null
  return { kind: 'autoClassify', left: status.remaining }
}

/** Running riff library syncs. The riff count sums each running sync's own
 * latest progress (riff-library-sync-progress reports a running count per
 * sync, never a total -- see riffLibrarySync's SyncProgress). */
function useLibrarySyncWork(): BackgroundWork | null {
  const [count, setCount] = useState<number | null>(null)
  const [doneByKey, setDoneByKey] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getRiffLibrarySyncActive()
      .then((initial) => {
        if (!cancelled) setCount((prev) => prev ?? initial)
      })
      .catch((err) => {
        console.error('BackgroundWorkIndicator: getRiffLibrarySyncActive failed:', err)
      })
    const unsubscribeActive = window.rifffApi.onRiffLibrarySyncActive((next) => {
      if (cancelled) return
      setCount(next)
      if (next === 0) setDoneByKey({})
    })
    const unsubscribeProgress = window.rifffApi.onRiffLibrarySyncProgress((progress) => {
      if (!cancelled) setDoneByKey((prev) => ({ ...prev, [progress.key]: progress.done }))
    })
    return () => {
      cancelled = true
      unsubscribeActive()
      unsubscribeProgress()
    }
  }, [])

  if (!count) return null
  const riffs = Object.values(doneByKey).reduce((sum, n) => sum + n, 0)
  return riffs > 0 ? { kind: 'librarySync', done: riffs } : { kind: 'librarySync' }
}
