import { useEffect, useState } from 'react'
import { LoadingLoader } from './LoadingLoader'
import type { PrewarmScanProgress } from '../../../main/discoverCandidates'

/** Human-friendly label for a PrewarmScanProgress phase -- 'riffIndex'/
 * 'instrumentRows' are the two real table scans (see discoverCandidates.ts's
 * own PrewarmScanProgress doc comment), neither of which means anything to
 * a non-technical user on its own. */
const PHASE_LABEL: Record<PrewarmScanProgress['phase'], string> = {
  riffIndex: 'riffs',
  instrumentRows: 'stems'
}

/** A small, non-blocking status pill shown while the main process is still
 * doing its own real startup work (prewarmDiscoverCandidateCaches's own
 * table scan, see main/index.ts's own doc comment on that call site) --
 * direct report, 2026-09-16: "the app takes a long time to be
 * responsive... is there a lot going on? maybe a loader until it's ready?",
 * then again, 2026-09-18, after a real freeze investigation on this same
 * scan: "we need to tell the user what's on the go when it's happening",
 * and "ideally it would also show a progress bar or meter, or something
 * telling details about what is happening and how long to expect."
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
 * both the completion push event and the new per-chunk progress push event
 * for the case where it hasn't yet -- see getLibraryWarmupStatus/
 * onLibraryWarmupComplete/onLibraryWarmupProgress's own preload doc
 * comments for why all three exist.
 *
 * The ETA is a simple linear extrapolation from elapsed-time-so-far
 * (`elapsed / (completed / total)`), scoped to the CURRENT phase+db only --
 * matches PrewarmScanProgress's own deliberate choice not to unify phases
 * into a single 0-100% (see that interface's doc comment for why: the two
 * phases have genuinely different real per-row costs, so a combined
 * percentage would be misleading about how much time is actually left). */
export function LibraryWarmupIndicator(): React.JSX.Element | null {
  const [done, setDone] = useState(true)
  const [progress, setProgress] = useState<PrewarmScanProgress | null>(null)
  // Keyed by `${phase}:${dbIndex}` -- reset whenever the scan moves to a
  // new phase or a new db, since elapsed-time-so-far only means something
  // relative to when THIS specific phase+db scan actually started. Lives in
  // state (not a ref) since describeEta below needs it during render.
  const [phaseStartedAt, setPhaseStartedAt] = useState<{ key: string; startedAt: number } | null>(
    null
  )

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
    const unsubscribeComplete = window.rifffApi.onLibraryWarmupComplete(() => {
      if (!cancelled) {
        setDone(true)
        setProgress(null)
      }
    })
    const unsubscribeProgress = window.rifffApi.onLibraryWarmupProgress((update) => {
      if (cancelled) return
      const key = `${update.phase}:${update.dbIndex}`
      setPhaseStartedAt((prev) => (prev?.key === key ? prev : { key, startedAt: Date.now() }))
      setProgress(update)
    })
    return () => {
      cancelled = true
      unsubscribeComplete()
      unsubscribeProgress()
    }
  }, [])

  if (done) return null

  const etaText = describeEta(progress, phaseStartedAt?.startedAt ?? null)

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
      title="indexing your library"
    >
      <LoadingLoader size={11} />
      {describeProgress(progress)}
      {etaText ? <span>{` · ${etaText}`}</span> : null}
    </div>
  )
}

function describeProgress(progress: PrewarmScanProgress | null): string {
  if (!progress) return 'indexing library…'
  const dbSuffix = progress.dbCount > 1 ? `, db ${progress.dbIndex + 1}/${progress.dbCount}` : ''
  return `indexing ${PHASE_LABEL[progress.phase]}: ${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}${dbSuffix}`
}

function describeEta(
  progress: PrewarmScanProgress | null,
  startedAt: number | null
): string | null {
  if (!progress || !startedAt || progress.completed <= 0 || progress.total <= 0) return null
  const elapsedMs = Date.now() - startedAt
  const fractionDone = progress.completed / progress.total
  const remainingMs = elapsedMs / fractionDone - elapsedMs
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null
  const remainingSec = Math.round(remainingMs / 1000)
  if (remainingSec < 1) return null
  if (remainingSec < 60) return `~${remainingSec}s left`
  return `~${Math.round(remainingSec / 60)}m left`
}
