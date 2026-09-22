import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOST_DENIED_THRESHOLD,
  classifyDownloadFailure,
  createDeniedHostTracker,
  createRetryBudget,
  describeDownloadFailure,
  hostOfDownloadUrl,
  stemIsUsable
} from './stemAvailability'

describe('classifyDownloadFailure', () => {
  it('treats 403 as permanent -- the real case: endlesss-dev.* refuses anonymous GETs', () => {
    expect(classifyDownloadFailure({ kind: 'http', status: 403 })).toBe('permanent')
  })

  it('treats 404 as permanent', () => {
    expect(classifyDownloadFailure({ kind: 'http', status: 404 })).toBe('permanent')
  })

  it('treats 410 gone as permanent', () => {
    expect(classifyDownloadFailure({ kind: 'http', status: 410 })).toBe('permanent')
  })

  it('treats a 5xx as retryable -- the server is having a moment, the file is not gone', () => {
    expect(classifyDownloadFailure({ kind: 'http', status: 500 })).toBe('retryable')
    expect(classifyDownloadFailure({ kind: 'http', status: 503 })).toBe('retryable')
  })

  it('treats 408 and 429 as retryable even though they are 4xx', () => {
    expect(classifyDownloadFailure({ kind: 'http', status: 408 })).toBe('retryable')
    expect(classifyDownloadFailure({ kind: 'http', status: 429 })).toBe('retryable')
  })

  it('treats a network/timeout failure (no status at all) as retryable', () => {
    expect(classifyDownloadFailure({ kind: 'network' })).toBe('retryable')
  })

  it('treats an unexpected non-error status as retryable rather than poisoning the stem', () => {
    expect(classifyDownloadFailure({ kind: 'http', status: 302 })).toBe('retryable')
  })
})

describe('describeDownloadFailure', () => {
  it('names the http status, so a persisted row says why', () => {
    expect(describeDownloadFailure({ kind: 'http', status: 403 })).toBe('http 403')
  })

  it('names a network failure without inventing a status', () => {
    expect(describeDownloadFailure({ kind: 'network' })).toBe('network')
  })
})

describe('hostOfDownloadUrl', () => {
  it('pulls the real host out of a stem download url', () => {
    expect(hostOfDownloadUrl('https://endlesss-dev.fra1.digitaloceanspaces.com/a/b/c')).toBe(
      'endlesss-dev.fra1.digitaloceanspaces.com'
    )
  })

  it('keeps a bucket subdomain -- the bucket IS what differs between a dead and a live host', () => {
    expect(hostOfDownloadUrl('https://ndls-att0.ams3.digitaloceanspaces.com/x')).toBe(
      'ndls-att0.ams3.digitaloceanspaces.com'
    )
  })

  it('returns null for something that is not a url, rather than throwing', () => {
    expect(hostOfDownloadUrl('not a url')).toBe(null)
  })
})

describe('createDeniedHostTracker', () => {
  it('does not deny a host until N DISTINCT stems have failed permanently on it', () => {
    const tracker = createDeniedHostTracker(3)
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-1')).toBe(false)
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-2')).toBe(false)
    expect(tracker.isDenied('dead.example.com')).toBe(false)
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-3')).toBe(true)
    expect(tracker.isDenied('dead.example.com')).toBe(true)
  })

  it('counts each stem once -- the same stem failing three times is one signal, not three', () => {
    const tracker = createDeniedHostTracker(3)
    tracker.recordPermanentFailure('dead.example.com', 'stem-1')
    tracker.recordPermanentFailure('dead.example.com', 'stem-1')
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-1')).toBe(false)
    expect(tracker.isDenied('dead.example.com')).toBe(false)
  })

  it('reports newly-denied only ONCE, so the log line is printed once per host', () => {
    const tracker = createDeniedHostTracker(2)
    tracker.recordPermanentFailure('dead.example.com', 'stem-1')
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-2')).toBe(true)
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-3')).toBe(false)
  })

  it('keeps hosts independent -- a live bucket is unaffected by a dead one', () => {
    const tracker = createDeniedHostTracker(2)
    tracker.recordPermanentFailure('dead.example.com', 'stem-1')
    tracker.recordPermanentFailure('dead.example.com', 'stem-2')
    expect(tracker.isDenied('live.example.com')).toBe(false)
    expect(tracker.deniedHosts()).toEqual(['dead.example.com'])
  })

  it('defaults to the documented threshold', () => {
    const tracker = createDeniedHostTracker()
    for (let i = 0; i < DEFAULT_HOST_DENIED_THRESHOLD - 1; i++) {
      expect(tracker.recordPermanentFailure('dead.example.com', `stem-${i}`)).toBe(false)
    }
    expect(tracker.recordPermanentFailure('dead.example.com', 'stem-last')).toBe(true)
  })
})

describe('createRetryBudget', () => {
  it('allows a stem a bounded number of attempts in one session, then stops', () => {
    const budget = createRetryBudget(3)
    expect(budget.shouldAttempt('stem-1')).toBe(true)
    budget.recordFailedAttempt('stem-1')
    budget.recordFailedAttempt('stem-1')
    expect(budget.shouldAttempt('stem-1')).toBe(true)
    budget.recordFailedAttempt('stem-1')
    expect(budget.shouldAttempt('stem-1')).toBe(false)
  })

  it('forgets a stem that eventually succeeded, so a later re-download is allowed again', () => {
    const budget = createRetryBudget(1)
    budget.recordFailedAttempt('stem-1')
    expect(budget.shouldAttempt('stem-1')).toBe(false)
    budget.clear('stem-1')
    expect(budget.shouldAttempt('stem-1')).toBe(true)
  })

  it('keeps stems independent', () => {
    const budget = createRetryBudget(1)
    budget.recordFailedAttempt('stem-1')
    expect(budget.shouldAttempt('stem-2')).toBe(true)
  })
})

describe('stemIsUsable', () => {
  const unavailable = new Set(['dead-stem'])

  it('keeps a stem nobody has recorded as unavailable', () => {
    expect(stemIsUsable('fine-stem', unavailable)).toBe(true)
  })

  it('drops a stem recorded as unavailable', () => {
    expect(stemIsUsable('dead-stem', unavailable)).toBe(false)
  })

  it('keeps an unavailable stem that is already on disk -- local audio always wins', () => {
    expect(stemIsUsable('dead-stem', unavailable, () => true)).toBe(true)
  })

  it('only asks about the disk for a stem that is actually on the list', () => {
    let asked = 0
    stemIsUsable('fine-stem', unavailable, () => {
      asked++
      return false
    })
    expect(asked).toBe(0)
  })
})
