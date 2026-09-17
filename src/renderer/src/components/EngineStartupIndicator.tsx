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
 * Positioned below LibraryWarmupIndicator (top: 40 vs its top: 10) rather
 * than at the same top: 10 -- both pills are plausibly visible at once
 * right after a cold launch (engine still starting AND library still
 * warming up), and identical positioning would have them overlap. 40 (not
 * 34) leaves a real, intentional-looking gap: at fontSize 9 with
 * Silkscreen's own line-height, the sibling pill's actual height works out
 * to ~23.5px, so 34 cleared it by under a pixel -- code review found the
 * two borders would read as visually flush. */
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
        position: 'fixed',
        top: 40,
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
      title="starting the native audio engine -- playback will be available once this finishes"
    >
      <LoadingLoader size={11} />
      starting engine…
    </div>
  )
}
