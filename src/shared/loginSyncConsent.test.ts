import { describe, expect, it } from 'vitest'
import { loginSyncPromptText, resolveLoginSyncConsent } from './loginSyncConsent'

// Share readiness S4 (2026-10-07): logging in used to start downloading the shared feed and the
// account's own jam, audio included, with no word. Now it asks once. An install that has synced
// before (Elling's) has already said yes.
describe('resolveLoginSyncConsent', () => {
  it('a saved answer wins', () => {
    expect(resolveLoginSyncConsent({ consent: 'yes' }, false)).toBe('yes')
    expect(resolveLoginSyncConsent({ consent: 'no' }, true)).toBe('no')
  })

  it('no saved answer: an earlier sync is a yes, else ask', () => {
    expect(resolveLoginSyncConsent(null, true)).toBe('yes')
    expect(resolveLoginSyncConsent(null, false)).toBe('ask')
    expect(resolveLoginSyncConsent({ consent: 'maybe' }, false)).toBe('ask')
    expect(resolveLoginSyncConsent('nonsense', false)).toBe('ask')
  })
})

describe('loginSyncPromptText', () => {
  it('counts the own jam when known, and always names the shared feed', () => {
    expect(loginSyncPromptText(1234)).toBe(
      'sync your jams now? (about 1234 riffs + your shared feed)'
    )
    expect(loginSyncPromptText(1)).toBe('sync your jams now? (about 1 riff + your shared feed)')
    expect(loginSyncPromptText(null)).toBe(
      'sync your jams now? (your shared feed and your own jam)'
    )
  })
})
