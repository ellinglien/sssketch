import { useEffect, useRef } from 'react'
import { MISSING_COPY_TEXT, missingCopiesTitle } from '@shared/reonedCleanup'
import { evictStemAnalysis } from '../audio/evictStemAnalysis'
import { getStateSnapshot, useDispatch, useFlushEngineSyncNow } from '../state/StoreContext'
import {
  clearReonedMissing,
  retryableReonedMissingPaths,
  updateReonedMissingReasons,
  useReonedMissing
} from '../state/reonedMissing'
import { retryReonedMissing } from '../state/reonedRepairOnOpen'

/** How often a copy whose original (or library drive) was away is tried again. Main fails fast
 * while it is still away, so a retry costs a few file checks. */
const RETRY_MS = 15_000

/** While the open project names a re-oned copy that couldn't be rebuilt: a persistent pill with
 * the spec's words (the Inspector repeats them under each affected stem), and a retry every 15 s
 * of the copies whose original was unreachable, so plugging the drive back in brings the audio
 * back without reopening (spec part 1). A failed render is shown but not retried. One row below
 * PluginsHeldNotice, styled the same. */
export function ReonedCopyMissingNotice(): React.JSX.Element | null {
  const missing = useReonedMissing()
  const dispatch = useDispatch()
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const inFlight = useRef(false)
  const retrying = missing.some((m) => m.reason === 'unreachable')

  useEffect(() => {
    if (!retrying) return
    const timer = setInterval(() => {
      // A slow rebuild (an engine spawn for a LORE stem) is never re-entered.
      if (inFlight.current) return
      inFlight.current = true
      void (async () => {
        try {
          const result = await retryReonedMissing(getStateSnapshot(), retryableReonedMissingPaths())
          if (!result) return
          if (result.moved.length > 0) {
            dispatch({ type: 'REPAIR_REONED_PATHS', results: result.moved })
          }
          if (result.inPlace.length > 0) {
            // Same path, so nothing in the project changes: drop the failed decodes and send the
            // project again (the engine doesn't cache a failed load).
            evictStemAnalysis(result.inPlace)
            await flushEngineSyncNow()
          }
          clearReonedMissing([...result.inPlace, ...result.moved.map((m) => m.path)])
          updateReonedMissingReasons(result.stillMissing)
        } catch (err) {
          console.error('ReonedCopyMissingNotice: retry failed:', err)
        } finally {
          inFlight.current = false
        }
      })()
    }, RETRY_MS)
    return () => clearInterval(timer)
  }, [retrying, dispatch, flushEngineSyncNow])

  if (missing.length === 0) return null
  return (
    <div
      role="status"
      title={missingCopiesTitle(missing.length)}
      style={{
        position: 'fixed',
        top: 156,
        right: 10,
        zIndex: 2000,
        padding: '5px 10px',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-3)'
      }}
    >
      {MISSING_COPY_TEXT}
    </div>
  )
}
