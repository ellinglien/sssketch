import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getStemAvailabilityReport,
  onStemAvailabilityNotice,
  recordStemDownloadFailure,
  recordStemDownloadSuccess,
  resetStemAvailabilitySessionStateForTests,
  shouldAttemptStemDownload
} from './stemAvailability'
import { isStemUnavailable } from './stemUnavailableStore'
import {
  DEFAULT_HOST_DENIED_THRESHOLD,
  type StemAvailabilityNotice
} from '@shared/stemAvailability'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemUnavailable (
      StemCID TEXT PRIMARY KEY, Reason TEXT NOT NULL, CheckedAt INTEGER NOT NULL
    );
  `)
  return db
}

const DEAD = 'https://endlesss-dev.fra1.digitaloceanspaces.com/attachments/oggAudio/x/'
const LIVE = 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/x/'

describe('stemAvailability (main-side wiring)', () => {
  beforeEach(() => {
    resetStemAvailabilitySessionStateForTests()
  })

  it('allows a first attempt for an unknown stem', () => {
    const db = freshDb()
    expect(shouldAttemptStemDownload(db, 'stem-1', `${DEAD}stem-1`)).toBe(true)
  })

  it('a 403 is remembered and the stem is never attempted again', () => {
    const db = freshDb()
    recordStemDownloadFailure(db, 'stem-1', `${DEAD}stem-1`, { kind: 'http', status: 403 })
    expect(isStemUnavailable(db, 'stem-1')).toBe(true)
    expect(shouldAttemptStemDownload(db, 'stem-1', `${DEAD}stem-1`)).toBe(false)
  })

  it('learns the host after N distinct 403s and then skips its other stems without asking', () => {
    const db = freshDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < DEFAULT_HOST_DENIED_THRESHOLD; i++) {
      recordStemDownloadFailure(db, `stem-${i}`, `${DEAD}stem-${i}`, { kind: 'http', status: 403 })
    }
    // Exactly one line for the whole host, not one per stem.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('endlesss-dev.fra1.digitaloceanspaces.com')

    // A stem never tried before, on the same host: skipped, and remembered
    // lazily so the knowledge survives a restart.
    expect(shouldAttemptStemDownload(db, 'never-tried', `${DEAD}never-tried`)).toBe(false)
    expect(isStemUnavailable(db, 'never-tried')).toBe(true)
    warn.mockRestore()
  })

  it('a live host is unaffected by a dead one', () => {
    const db = freshDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < DEFAULT_HOST_DENIED_THRESHOLD; i++) {
      recordStemDownloadFailure(db, `stem-${i}`, `${DEAD}stem-${i}`, { kind: 'http', status: 403 })
    }
    expect(shouldAttemptStemDownload(db, 'other-stem', `${LIVE}other-stem`)).toBe(true)
    warn.mockRestore()
  })

  it('a retryable failure never writes a row, and stops after the bounded retries', () => {
    const db = freshDb()
    for (let i = 0; i < 5; i++) {
      recordStemDownloadFailure(db, 'stem-1', `${LIVE}stem-1`, { kind: 'http', status: 503 })
    }
    expect(isStemUnavailable(db, 'stem-1')).toBe(false)
    expect(shouldAttemptStemDownload(db, 'stem-1', `${LIVE}stem-1`)).toBe(false)
  })

  it('a success clears both the retry budget and a stale unavailable row', () => {
    const db = freshDb()
    recordStemDownloadFailure(db, 'stem-1', `${DEAD}stem-1`, { kind: 'http', status: 403 })
    recordStemDownloadSuccess(db, 'stem-1')
    expect(isStemUnavailable(db, 'stem-1')).toBe(false)
    expect(shouldAttemptStemDownload(db, 'stem-1', `${DEAD}stem-1`)).toBe(true)
  })

  it('tells the renderer once for the first skip, and again only when a new host is learned', () => {
    const db = freshDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notices: StemAvailabilityNotice[] = []
    onStemAvailabilityNotice((n) => notices.push(n))

    recordStemDownloadFailure(db, 'stem-0', `${DEAD}stem-0`, { kind: 'http', status: 404 })
    expect(notices).toHaveLength(1)
    // More permanent failures on the same host: no further notices until the
    // host itself is learned.
    for (let i = 1; i < DEFAULT_HOST_DENIED_THRESHOLD; i++) {
      recordStemDownloadFailure(db, `stem-${i}`, `${DEAD}stem-${i}`, { kind: 'http', status: 403 })
    }
    expect(notices).toHaveLength(2)
    expect(notices[1].deniedHosts).toEqual(['endlesss-dev.fra1.digitaloceanspaces.com'])
    expect(getStemAvailabilityReport().skipped).toBe(DEFAULT_HOST_DENIED_THRESHOLD)
    warn.mockRestore()
  })
})
