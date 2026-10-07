import { describe, expect, it } from 'vitest'
import { syncOutcomeNote, syncOutcomeNoteRefreshMs } from './syncOutcomeNote'

describe('syncOutcomeNote', () => {
  it('says nothing for a sync that ran (to its end, or cancelled)', () => {
    expect(syncOutcomeNote({ stopped: null }, 0)).toBeNull()
  })

  // Review of b18e27fb: a private-jam sync with no session ended silently.
  it('asks to log in when there was no session', () => {
    expect(syncOutcomeNote({ stopped: 'logged-out' }, 0)).toBe('log in to sync')
  })

  it('says when to try again after a 429, in whole minutes, at least one', () => {
    expect(syncOutcomeNote({ stopped: 'rate-limited', retryAt: 1_000 + 30_000 }, 1_000)).toBe(
      'endlesss asked to slow down — try again in 1 min'
    )
    expect(syncOutcomeNote({ stopped: 'rate-limited', retryAt: 5 * 60_000 + 1 }, 0)).toBe(
      'endlesss asked to slow down — try again in 6 min'
    )
    expect(syncOutcomeNote({ stopped: 'rate-limited' }, 0)).toBe(
      'endlesss asked to slow down — try again in 1 min'
    )
  })

  // Review of a00e7aab: the minutes were worked out once, when the sync
  // ended, and the note stayed until the jam's next sync -- "try again in 6
  // min" an hour later.
  it('counts down from retryAt, and says nothing once it has passed', () => {
    const outcome = { stopped: 'rate-limited' as const, retryAt: 10 * 60_000 }
    expect(syncOutcomeNote(outcome, 0)).toBe('endlesss asked to slow down — try again in 10 min')
    expect(syncOutcomeNote(outcome, 7 * 60_000)).toBe(
      'endlesss asked to slow down — try again in 3 min'
    )
    expect(syncOutcomeNote(outcome, 10 * 60_000)).toBeNull()
    expect(syncOutcomeNote(outcome, 11 * 60_000)).toBeNull()
  })
})

describe('syncOutcomeNoteRefreshMs', () => {
  it('is when the minutes next tick over, or the note goes', () => {
    const outcome = { stopped: 'rate-limited' as const, retryAt: 10 * 60_000 }
    expect(syncOutcomeNoteRefreshMs(outcome, 0)).toBe(60_000)
    expect(syncOutcomeNoteRefreshMs(outcome, 1)).toBe(59_999)
    expect(syncOutcomeNoteRefreshMs(outcome, 9 * 60_000 + 30_000)).toBe(30_000)
  })

  it('is null for a note that will not change', () => {
    expect(syncOutcomeNoteRefreshMs({ stopped: null }, 0)).toBeNull()
    expect(syncOutcomeNoteRefreshMs({ stopped: 'logged-out' }, 0)).toBeNull()
    expect(syncOutcomeNoteRefreshMs({ stopped: 'rate-limited' }, 0)).toBeNull()
    expect(syncOutcomeNoteRefreshMs({ stopped: 'rate-limited', retryAt: 5 }, 5)).toBeNull()
  })
})
