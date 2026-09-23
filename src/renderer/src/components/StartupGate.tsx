import { useEffect, useState } from 'react'
import { LoadingLoader } from './LoadingLoader'
import type { PrewarmScanProgress } from '../../../main/discoverCandidates'

const WORDMARK = 'SSSKETCH'.split('')

const PHASE_LABEL: Record<PrewarmScanProgress['phase'], string> = {
  riffIndex: 'riffs',
  instrumentRows: 'stems'
}

/** Full-screen, genuinely BLOCKING gate shown from the moment the window
 * appears until both the native engine has finished starting AND the
 * library warmup scan (prewarmDiscoverCandidateCaches, main/index.ts) has
 * finished -- direct request, 2026-09-18: "have it appear on the welcome
 * thing, and prevent people from opening the app until it's complete...
 * i want to make sure the app is usable when it's usable... put as much
 * of the indexing and processing to app startup as possible."
 *
 * Supersedes EngineStartupIndicator/LibraryWarmupIndicator's own small,
 * deliberately-non-blocking corner pills for THIS window specifically --
 * those pills were built on the premise that the app stays usable while
 * they run, which turned out not to hold up in practice (direct report,
 * same day: beachballs, multi-second click delays, and one "similar"
 * click that never finished, all while those background scans were still
 * going). Rather than removing the two pill components outright (they
 * still cover a real, if now much rarer, edge case -- warmup somehow
 * re-triggering after this gate has already closed for the session), this
 * sits ABOVE them (zIndex 3000, both pills top out at 2000) and paints an
 * opaque background, so in practice a user never sees both at once.
 *
 * Deliberately does NOT wait on the renderer-side background scans
 * (BackgroundFeatureScan/DiscoverLibraryScan)
 * -- those are open-ended (DiscoverLibraryScan's own doc comment: "order
 * of HOURS, not something that finishes in one sitting" for a real large
 * library) and blocking app usage for that long would trade one bad
 * experience for a far worse one. Only the two BOUNDED, per-launch costs
 * (engine spawn, and the riff/instrument index scan -- now persisted to
 * disk, see discoverIndexCache.ts, so most launches finish this near-
 * instantly) gate this screen.
 *
 * Reuses OnboardingModal's own wordmark/black-panel visual language
 * ("the welcome thing") rather than inventing a separate splash design --
 * this IS the welcome screen for the brief window before the real one
 * (or the normal app) can show. */
export function StartupGate(): React.JSX.Element | null {
  // null = not answered yet. Direct report, 2026-09-22: these used to START
  // as `true` (optimistically "done") and only flip to false once the status
  // IPC answered -- so the welcome screen painted for a few seconds before
  // this gate covered it on every launch that actually needed indexing
  // (the main process is at its busiest right then, so the answer is slow).
  // Unknown now counts as "not done": the gate shows until main says so.
  const [engineDone, setEngineDone] = useState<boolean | null>(null)
  const [warmupDone, setWarmupDone] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<PrewarmScanProgress | null>(null)
  const [phaseStartedAt, setPhaseStartedAt] = useState<{ key: string; startedAt: number } | null>(
    null
  )

  useEffect(() => {
    let cancelled = false

    window.rifffApi
      .getEngineStartupStatus()
      .then((status) => {
        // Never un-finish: a completion push can land before this reply.
        if (!cancelled) setEngineDone((prev) => prev === true || status)
      })
      .catch((err) => {
        console.error('StartupGate: getEngineStartupStatus failed:', err)
        // Fail open -- a status query that can't answer must never lock the
        // app behind this screen for good.
        if (!cancelled) setEngineDone(true)
      })
    const unsubscribeEngine = window.rifffApi.onEngineStartupComplete(() => {
      if (!cancelled) setEngineDone(true)
    })

    window.rifffApi
      .getLibraryWarmupStatus()
      .then((status) => {
        if (!cancelled) setWarmupDone((prev) => prev === true || status)
      })
      .catch((err) => {
        console.error('StartupGate: getLibraryWarmupStatus failed:', err)
        if (!cancelled) setWarmupDone(true)
      })
    const unsubscribeWarmupComplete = window.rifffApi.onLibraryWarmupComplete(() => {
      if (!cancelled) {
        setWarmupDone(true)
        setProgress(null)
      }
    })
    const unsubscribeWarmupProgress = window.rifffApi.onLibraryWarmupProgress((update) => {
      if (cancelled) return
      const key = `${update.phase}:${update.dbIndex}`
      setPhaseStartedAt((prev) => (prev?.key === key ? prev : { key, startedAt: Date.now() }))
      setProgress(update)
    })

    return () => {
      cancelled = true
      unsubscribeEngine()
      unsubscribeWarmupComplete()
      unsubscribeWarmupProgress()
    }
  }, [])

  if (engineDone === true && warmupDone === true) return null

  const etaText = describeEta(progress, phaseStartedAt?.startedAt ?? null)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: '#000000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22
      }}
    >
      <div style={{ display: 'flex', gap: 1 }}>
        {WORDMARK.map((ch, i) => (
          <span key={i} style={{ fontSize: 28, lineHeight: 1, color: 'var(--ra-text)' }}>
            {ch}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <LoadingLoader size={13} />
        <span style={{ fontSize: 11, color: 'var(--ra-text-2)' }}>
          {describeStatus(engineDone === true, progress)}
        </span>
      </div>
      {etaText && <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{etaText}</span>}
    </div>
  )
}

function describeStatus(engineDone: boolean, progress: PrewarmScanProgress | null): string {
  if (!engineDone) return 'starting engine…'
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
