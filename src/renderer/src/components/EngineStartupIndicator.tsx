import { useEffect, useState } from 'react'
import { LoadingLoader } from './LoadingLoader'

/** A small, non-blocking status pill shown while the main process is still
 * starting the native playback engine subprocess (see main/index.ts's own
 * doc comment on engineStartupDone) -- direct report, 2026-09-17: "startup
 * is quite sluggish... could we show welcome first to indicate it's
 * loading?... otherwise the user thinks the app didn't start." The window
 * itself now appears immediately regardless of how long the engine takes
 * to spawn (main/index.ts no longer blocks createWindow() on it) -- this
 * gives the user something honest to look at during that gap instead of
 * silent, unexplained sluggishness right after launch.
 *
 * Same query-once-on-mount-plus-push-when-done pattern as
 * LibraryWarmupIndicator.tsx (see that component's own doc comment for why
 * both a query AND a push exist) -- covers both "the engine already
 * finished starting before this component mounted" and "it hasn't yet."
 *
 * (LibraryWarmupIndicator has since been folded into BackgroundWorkIndicator,
 * bottom-right.)
 *
 * First in the top-right column (TopRightNotices, which starts at top: 40),
 * where it always sat. */
export function EngineStartupIndicator(): React.JSX.Element | null {
  const [done, setDone] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getEngineStartupStatus()
      .then((status) => {
        if (!cancelled) setDone(status)
      })
      .catch((err) => {
        console.error('EngineStartupIndicator: getEngineStartupStatus failed:', err)
      })
    const unsubscribe = window.rifffApi.onEngineStartupComplete(() => {
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
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        fontSize: 9,
        color: 'var(--ra-text-3)'
      }}
      title="starting audio engine"
    >
      <LoadingLoader size={11} />
      starting engine…
    </div>
  )
}
