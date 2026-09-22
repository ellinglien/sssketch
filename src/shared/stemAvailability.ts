// src/shared/stemAvailability.ts
//
// Pure rules for "this stem's audio can't be fetched any more."
//
// Real, diagnosed situation (2026-09-22): Endlesss's stem blobs are spread
// across several DigitalOcean Spaces buckets, and ONE of those hosts --
// `endlesss-dev.*.digitaloceanspaces.com` -- started answering anonymous
// GETs with HTTP 403 AccessDenied, while the `ndls-att0/1/2/3.*` hosts kept
// answering 200 (verified by curl from Elling's machine, both at the same
// moment). That's ~97,636 of 367,019 stems in his external archive and
// ~16,980 of 53,674 in his own library. No login can fix it -- the stem
// URLs were never authenticated in the first place (see stemDownloadUrl's
// own doc comment) -- so the only sane behavior is to notice, remember, and
// stop asking.
//
// Everything here is deliberately pure and side-effect free: the persistence
// (src/main/stemUnavailableStore.ts) and the wiring (src/main/
// stemAvailability.ts) live on the main side, this is just the decisions.

/** What went wrong on one download attempt. `network` covers everything
 * that never produced an HTTP status at all -- DNS, connection reset,
 * timeout, an aborted fetch. */
export type StemDownloadFailure = { kind: 'http'; status: number } | { kind: 'network' }

/** `permanent` means "asking again will fail again, today and tomorrow" --
 * worth remembering in the database. `retryable` means "this might work in a
 * minute" -- never persisted, or a bad hotel wifi would permanently poison a
 * user's whole library. */
export type StemFailureVerdict = 'permanent' | 'retryable'

/** 4xx statuses that are about THIS moment rather than about the file:
 * 408 (request timeout), 425 (too early), 429 (rate limited). Everything
 * else in the 4xx range is a statement about the resource itself -- 403
 * (the real case here), 404, 410 -- and gets remembered. */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429])

export function classifyDownloadFailure(failure: StemDownloadFailure): StemFailureVerdict {
  if (failure.kind === 'network') return 'retryable'
  const { status } = failure
  if (status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)) return 'permanent'
  // 5xx, and any unexpected non-2xx (a redirect that fetch didn't follow,
  // say): retryable. Deliberately the lenient default -- wrongly retrying
  // costs one request; wrongly remembering costs a stem forever.
  return 'retryable'
}

/** The short reason string persisted alongside an unavailable stem, so a
 * row can be read back later and explained ("http 403"), not just counted. */
export function describeDownloadFailure(failure: StemDownloadFailure): string {
  return failure.kind === 'network' ? 'network' : `http ${failure.status}`
}

/** The host a stem download URL points at, INCLUDING any bucket subdomain --
 * that subdomain is precisely what distinguishes a dead bucket
 * (`endlesss-dev.fra1...`) from a live one (`ndls-att0.fra1...`), see
 * stemDownloadUrl. Returns null (never throws) for anything unparseable. */
export function hostOfDownloadUrl(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** How many DISTINCT stems have to fail permanently on one host before the
 * whole host is treated as refusing anonymous downloads. Three is enough to
 * rule out "one stem really was deleted" without being enough to sit through
 * thousands of pointless requests. */
export const DEFAULT_HOST_DENIED_THRESHOLD = 3

export interface DeniedHostTracker {
  /** True once this host has crossed the threshold this session. */
  isDenied(host: string): boolean
  /** Records one stem's permanent failure against `host`. Returns true only
   * on the single call that CROSSES the threshold -- so the caller can log
   * exactly one line per host, ever. */
  recordPermanentFailure(host: string, stemCID: string): boolean
  /** Every host denied so far, in the order they were learned. */
  deniedHosts(): string[]
  /** Distinct stems that have failed permanently on `host`. */
  countFor(host: string): number
}

/** Learns which hosts are refusing anonymous downloads, from evidence,
 * rather than hardcoding today's dead bucket -- the split could move, and a
 * hardcoded hostname would then be both wrong and invisible. Session-scoped
 * by design: the durable record is the per-stem table, this is just what
 * stops the next few thousand requests from being attempted at all. */
export function createDeniedHostTracker(
  threshold: number = DEFAULT_HOST_DENIED_THRESHOLD
): DeniedHostTracker {
  const failedStemsByHost = new Map<string, Set<string>>()
  const denied: string[] = []

  return {
    isDenied: (host) => denied.includes(host),
    countFor: (host) => failedStemsByHost.get(host)?.size ?? 0,
    deniedHosts: () => [...denied],
    recordPermanentFailure(host, stemCID) {
      let stems = failedStemsByHost.get(host)
      if (!stems) {
        stems = new Set()
        failedStemsByHost.set(host, stems)
      }
      stems.add(stemCID)
      if (stems.size < threshold || denied.includes(host)) return false
      denied.push(host)
      return true
    }
  }
}

/** Attempts a single stem gets per session after a RETRYABLE failure. Small
 * and in-memory on purpose: a stem that fails three times in one session on
 * a flaky connection is worth leaving alone until the next launch, but it
 * must never end up in the durable unavailable table. */
export const DEFAULT_SESSION_RETRY_ATTEMPTS = 3

export interface RetryBudget {
  shouldAttempt(stemCID: string): boolean
  recordFailedAttempt(stemCID: string): void
  /** Forgets a stem -- called on a successful download. */
  clear(stemCID: string): void
}

export function createRetryBudget(
  maxAttempts: number = DEFAULT_SESSION_RETRY_ATTEMPTS
): RetryBudget {
  const attempts = new Map<string, number>()
  return {
    shouldAttempt: (stemCID) => (attempts.get(stemCID) ?? 0) < maxAttempts,
    recordFailedAttempt: (stemCID) => {
      attempts.set(stemCID, (attempts.get(stemCID) ?? 0) + 1)
    },
    clear: (stemCID) => {
      attempts.delete(stemCID)
    }
  }
}

/** Whether a stem may still be offered to the user -- the one rule every
 * candidate pool filters by. A stem on the unavailable list is still fine
 * if its audio is ALREADY on disk: the list is about fetching, not about the
 * file. `isOnDisk` is only consulted for a stem actually on the list, so a
 * caller can pass a real filesystem check without paying for it per
 * candidate. */
export function stemIsUsable(
  stemCID: string,
  unavailable: ReadonlySet<string>,
  isOnDisk: (stemCID: string) => boolean = () => false
): boolean {
  if (!unavailable.has(stemCID)) return true
  return isOnDisk(stemCID)
}

/** What the renderer is told when downloads are being skipped -- see
 * StemsUnavailableIndicator.tsx. Counts are session totals, not per roll. */
export interface StemAvailabilityNotice {
  /** Stems skipped or permanently failed this session. */
  skipped: number
  /** Hosts learned to be refusing anonymous downloads this session. */
  deniedHosts: string[]
}
