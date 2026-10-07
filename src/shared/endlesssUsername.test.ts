import { describe, expect, it } from 'vitest'
import {
  canonicalUsernameCandidates,
  isValidSharedFeedKey,
  normalizeEndlesssUsername
} from './endlesssUsername'

describe('normalizeEndlesssUsername', () => {
  it('trims and lowercases: Endlesss usernames are stored lowercase', () => {
    // Elling's LORE archive, read-only 2026-10-07: 6,802 distinct riff authors
    // and 6,506 distinct stem creators, none with an uppercase letter or an '@'.
    expect(normalizeEndlesssUsername(' Elling ')).toBe('elling')
    expect(normalizeEndlesssUsername('elling')).toBe('elling')
  })

  it('an email is not a username (Endlesss accepts one at login)', () => {
    expect(normalizeEndlesssUsername('someone@example.org')).toBe('')
    expect(normalizeEndlesssUsername(' Someone@Example.org ')).toBe('')
  })

  it('nothing is nobody', () => {
    expect(normalizeEndlesssUsername('')).toBe('')
    expect(normalizeEndlesssUsername('   ')).toBe('')
    expect(normalizeEndlesssUsername(null)).toBe('')
    expect(normalizeEndlesssUsername(undefined)).toBe('')
  })
})

describe('canonicalUsernameCandidates', () => {
  it("the login's user_id first, then the typed login name, normalised and unique", () => {
    expect(canonicalUsernameCandidates('Elling', 'elling')).toEqual(['elling'])
    expect(canonicalUsernameCandidates('elling', 'u_123')).toEqual(['u_123', 'elling'])
  })

  it('never offers an email', () => {
    expect(canonicalUsernameCandidates('someone@example.org', 'elling')).toEqual(['elling'])
    expect(canonicalUsernameCandidates('a@b.c', '')).toEqual([])
  })
})

describe('isValidSharedFeedKey', () => {
  it('a shared feed key names a real username, never an email or nobody', () => {
    expect(isValidSharedFeedKey('shared:elling')).toBe(true)
    expect(isValidSharedFeedKey('shared:someone@example.org')).toBe(false)
    expect(isValidSharedFeedKey('shared:')).toBe(false)
    expect(isValidSharedFeedKey('shared:Elling')).toBe(false)
  })

  it('anything else is not a shared feed key', () => {
    expect(isValidSharedFeedKey('band1234')).toBe(false)
  })
})
