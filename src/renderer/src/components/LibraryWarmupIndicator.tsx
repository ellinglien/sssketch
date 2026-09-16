import { useEffect, useState } from 'react'
import { LoadingLoader } from './LoadingLoader'

/** A small, non-blocking status pill shown while the main process is still
 * doing its own real startup work (prewarmDiscoverCandidateCaches's own
 * table scan, see main/index.ts's own doc comment on that call site) --
 * direct report, 2026-09-16: "the app takes a long time to be
 * responsive... is there a lot going on? maybe a loader until it's ready?"
 *
 * Deliberately NOT a blocking overlay -- the app is genuinely still mostly
 * usable during this window (only IPC calls queue up behind the main
 * process's own single-threaded scan, and only until it finishes, which
 * can be many seconds on a large library); a full-screen block for that
 * whole duration would be a worse experience than the current mild
 * sluggishness, just for a different reason. This just gives the "why
 * does clicking feel slow right now" question a real, honest answer.
 *
 * Queries the current status once on mount (covers the case where warmup
 * already finished before this component mounted) and also subscribes to
 * the push event for the case where it hasn't yet -- see
 * getLibraryWarmupStatus/onLibraryWarmupComplete's own preload doc
 * comments for why both exist. */
export function LibraryWarmupIndicator(): React.JSX.Element | null {
  const [done, setDone] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getLibraryWarmupStatus()
      .then((status) => {
        if (!cancelled) setDone(status)
      })
      .catch((err) => {
        console.error('LibraryWarmupIndicator: getLibraryWarmupStatus failed:', err)
      })
    const unsubscribe = window.rifffApi.onLibraryWarmupComplete(() => {
      if (!cancelled) setDone(true)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (done) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        fontSize: 9,
        color: 'var(--ra-text-3)'
      }}
      title="still indexing your riff library in the background -- some actions may feel a little slow until this finishes"
    >
      <LoadingLoader size={11} />
      indexing library…
    </div>
  )
}
