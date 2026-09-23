import { useEffect, useState } from 'react'
import type { StemAvailabilityNotice } from '@shared/stemAvailability'

/** How long the pill stays up before hiding itself. Long enough to read
 * twice at fontSize 9, short enough that it never becomes furniture. */
const VISIBLE_MS = 14_000

/** A small, non-blocking pill saying -- once -- that some stems can no
 * longer be downloaded.
 *
 * Diagnosed 2026-09-22: one of Endlesss's storage buckets now answers
 * anonymous GETs with 403 AccessDenied (see @shared/stemAvailability), so a
 * large slice of a real library is simply gone as far as fetching goes. The
 * main process remembers and skips those stems -- which is the right
 * behavior, but on its own it is also a SILENT one: a Discover roll or a
 * riff import just quietly comes back short, or a slot reads "no match"
 * with no reason given. That silence was the actual reported experience.
 *
 * One surface, not two, and deliberately app-global rather than inside
 * DiscoverPanel: the skipping happens in the same main-process download path
 * for BOTH a Discover roll and a library import, so a pill driven by that
 * path covers both cases without either screen having to know about any of
 * this. Same query-once-on-mount-plus-subscribe pattern as
 * LibraryWarmupIndicator/EngineStartupIndicator (the mount query covers
 * skips that already happened before the renderer was listening), and
 * positioned below both of those (top: 70 vs 10 and 40) for the same
 * reason EngineStartupIndicator gives about its own 40.
 *
 * Main sends a notice for the FIRST skip of a session and then only when a
 * new refusing host is learned -- "tell the user once," not a running
 * commentary -- and this hides itself after VISIBLE_MS regardless. Clicking
 * it dismisses it early. */
export function StemsUnavailableIndicator(): React.JSX.Element | null {
  const [notice, setNotice] = useState<StemAvailabilityNotice | null>(null)

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getStemAvailabilityReport()
      .then((report) => {
        if (!cancelled && report.skipped > 0) setNotice(report)
      })
      .catch((err) => {
        console.error('StemsUnavailableIndicator: getStemAvailabilityReport failed:', err)
      })
    const unsubscribe = window.rifffApi.onStemAvailabilityNotice((update) => {
      if (!cancelled) setNotice(update)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // Restarted whenever a NEW notice arrives (keyed on the object identity of
  // the notice itself), so a second, later notice gets its own full window
  // rather than inheriting whatever was left of the first one's.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  if (!notice) return null

  return (
    <button
      onClick={() => setNotice(null)}
      title="some stems unavailable"
      style={{
        position: 'fixed',
        top: 70,
        right: 10,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        fontFamily: 'inherit',
        textAlign: 'left',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-3)',
        cursor: 'pointer'
      }}
    >
      {describeNotice(notice)}
    </button>
  )
}

function describeNotice(notice: StemAvailabilityNotice): string {
  const skipped = `${notice.skipped.toLocaleString()} skipped so far`
  return notice.deniedHosts.length > 0
    ? `endlesss is no longer handing out some stems · ${skipped}`
    : `some stems can't be downloaded any more · ${skipped}`
}
