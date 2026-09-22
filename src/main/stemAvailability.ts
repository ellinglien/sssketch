// src/main/stemAvailability.ts
import type Database from 'better-sqlite3'
import {
  classifyDownloadFailure,
  createDeniedHostTracker,
  createRetryBudget,
  describeDownloadFailure,
  hostOfDownloadUrl,
  type StemAvailabilityNotice,
  type StemDownloadFailure
} from '@shared/stemAvailability'
import { countWork } from './workCounters'
import {
  clearStemUnavailable,
  isStemUnavailable,
  markStemUnavailable
} from './stemUnavailableStore'

/** Session state tying @shared/stemAvailability's pure rules to the durable
 * StemUnavailable table and to what the user gets told.
 *
 * The shape of the problem this solves (real, 2026-09-22): a roll or a
 * library browse would hit the same dead-bucket stems over and over,
 * printing hundreds of identical `downloadOneStem: download failed ... HTTP
 * 403` lines, and Discover kept offering stems that could never resolve. So:
 * remember permanent failures per stem (durable), learn the refusing host
 * from evidence (session), and say it once instead of once per stem.
 */

let deniedHosts = createDeniedHostTracker()
let retryBudget = createRetryBudget()
let skippedThisSession = 0
const listeners = new Set<(notice: StemAvailabilityNotice) => void>()
// One notice is pushed for the FIRST skip of the session and then only when
// a NEW host is learned -- "tell the user once," not a running commentary.
let noticeSent = false

function notice(): StemAvailabilityNotice {
  return { skipped: skippedThisSession, deniedHosts: deniedHosts.deniedHosts() }
}

function emit(): void {
  const payload = notice()
  for (const listener of listeners) listener(payload)
}

/** The renderer's indicator subscribes through main/index.ts. Returns its
 * own unsubscribe, matching this codebase's own push-event convention. */
export function onStemAvailabilityNotice(
  listener: (notice: StemAvailabilityNotice) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Queried once on mount by the indicator, for the case where skips already
 * happened before the renderer was listening -- same
 * query-once-plus-subscribe pattern as get-library-warmup-status. */
export function getStemAvailabilityReport(): StemAvailabilityNotice {
  return notice()
}

function countSkip(): void {
  skippedThisSession += 1
  countWork('stem-download:skipped-unavailable')
  if (noticeSent) return
  noticeSent = true
  emit()
}

/** Whether a download should even be attempted. Three reasons not to: the
 * stem is already known unfetchable, its host is refusing everything this
 * session (in which case this stem is marked lazily, right here, so the
 * knowledge survives a restart without ever bulk-writing ~97k rows), or it
 * has already burned its bounded in-session retries on soft failures.
 *
 * Callers MUST check local presence first -- a stem whose audio is already
 * on disk never reaches this function (see downloadOneStem). */
export function shouldAttemptStemDownload(
  db: Database.Database,
  stemCID: string,
  downloadUrl: string
): boolean {
  if (isStemUnavailable(db, stemCID)) {
    countSkip()
    return false
  }
  const host = hostOfDownloadUrl(downloadUrl)
  if (host && deniedHosts.isDenied(host)) {
    markStemUnavailable(db, stemCID, 'host denied', Date.now())
    countSkip()
    return false
  }
  if (!retryBudget.shouldAttempt(stemCID)) {
    countWork('stem-download:retries-exhausted')
    return false
  }
  return true
}

/** Records one failed attempt. A permanent failure (403/404/410 -- see
 * classifyDownloadFailure) is written to the StemUnavailable table and
 * counted against its host; a retryable one only spends retry budget, so a
 * bad connection can never poison a library. Logs exactly one line per host,
 * on the attempt that crosses the threshold -- everything else goes to the
 * dev work counters' own once-a-minute summary. */
export function recordStemDownloadFailure(
  db: Database.Database,
  stemCID: string,
  downloadUrl: string,
  failure: StemDownloadFailure
): void {
  retryBudget.recordFailedAttempt(stemCID)
  const verdict = classifyDownloadFailure(failure)
  if (verdict === 'retryable') {
    countWork(`stem-download:retryable-${describeDownloadFailure(failure).replace(/\s/g, '-')}`)
    return
  }
  const reason = describeDownloadFailure(failure)
  countWork(`stem-download:permanent-${reason.replace(/\s/g, '-')}`)
  markStemUnavailable(db, stemCID, reason, Date.now())
  skippedThisSession += 1
  const host = hostOfDownloadUrl(downloadUrl)
  const newlyDenied = host ? deniedHosts.recordPermanentFailure(host, stemCID) : false
  if (newlyDenied) {
    console.warn(
      `stem downloads: host ${host} is refusing anonymous downloads (${reason}); its stems will be skipped from here on`
    )
    noticeSent = true
    emit()
    return
  }
  if (!noticeSent) {
    noticeSent = true
    emit()
  }
}

/** The stem's audio landed -- forget both the retry budget and any stale
 * unavailable row, so a host that comes back heals with no intervention. */
export function recordStemDownloadSuccess(db: Database.Database, stemCID: string): void {
  retryBudget.clear(stemCID)
  clearStemUnavailable(db, stemCID)
}

/** Test-only seam: the trackers above are deliberately session-scoped
 * module state (that's the point -- "learned this session"), which makes
 * them leak between tests in one file without this. */
export function resetStemAvailabilitySessionStateForTests(): void {
  deniedHosts = createDeniedHostTracker()
  retryBudget = createRetryBudget()
  skippedThisSession = 0
  noticeSent = false
  listeners.clear()
}
