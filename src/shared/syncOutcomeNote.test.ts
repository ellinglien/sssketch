import { describe, expect, it } from 'vitest'
import { syncOutcomeNote } from './syncOutcomeNote'

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
})
