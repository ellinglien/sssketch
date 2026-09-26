import { describe, expect, it } from 'vitest'
import {
  REMOTE_MAX_PAIR_ATTEMPTS,
  REMOTE_PAIR_QUERY_PARAM,
  REMOTE_PORT,
  codesMatch,
  isAllowedHost,
  newPairingCode,
  pairedRemoteUrl,
  recordPairAttempt
} from './remoteAuth'

describe('remoteAuth', () => {
  it('uses the fixed port', () => {
    expect(REMOTE_PORT).toBe(7373)
  })

  it('generates a four-character code from an unambiguous alphabet', () => {
    const code = newPairingCode(() => 0)
    expect(code).toHaveLength(4)
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  })

  it('generates different codes for different randomness', () => {
    expect(newPairingCode(() => 0)).not.toBe(newPairingCode(() => 0.99))
  })

  it('matches a code case-insensitively and ignoring surrounding space', () => {
    expect(codesMatch(' k7fd ', 'K7FD')).toBe(true)
    expect(codesMatch('k7fe', 'K7FD')).toBe(false)
  })

  it('never matches an empty entry against an empty expectation', () => {
    expect(codesMatch('', '')).toBe(false)
  })

  it('allows the expected host and nothing else', () => {
    expect(isAllowedHost('192.168.1.40:7373', '192.168.1.40:7373')).toBe(true)
    expect(isAllowedHost('evil.example.com', '192.168.1.40:7373')).toBe(false)
    expect(isAllowedHost(undefined, '192.168.1.40:7373')).toBe(false)
  })

  it('allows localhost on the same port, for the desktop own check', () => {
    expect(isAllowedHost('localhost:7373', '192.168.1.40:7373')).toBe(true)
    expect(isAllowedHost('127.0.0.1:7373', '192.168.1.40:7373')).toBe(true)
  })

  it('counts a wrong attempt and locks out on the fifth', () => {
    let gate = { attemptsUsed: 0, lockedOut: false }
    for (let i = 0; i < REMOTE_MAX_PAIR_ATTEMPTS - 1; i++) gate = recordPairAttempt(gate, false)
    expect(gate.lockedOut).toBe(false)
    gate = recordPairAttempt(gate, false)
    expect(gate.attemptsUsed).toBe(REMOTE_MAX_PAIR_ATTEMPTS)
    expect(gate.lockedOut).toBe(true)
  })

  it('a correct attempt resets the count and never locks out', () => {
    const gate = recordPairAttempt({ attemptsUsed: 3, lockedOut: false }, true)
    expect(gate).toEqual({ attemptsUsed: 0, lockedOut: false })
  })

  it('stays locked out once locked out, even on a correct code', () => {
    expect(recordPairAttempt({ attemptsUsed: 5, lockedOut: true }, true).lockedOut).toBe(true)
  })

  it('carries the code in the link the qr encodes', () => {
    expect(pairedRemoteUrl('http://192.168.1.40:7373', 'K7FD')).toBe(
      'http://192.168.1.40:7373/?c=K7FD'
    )
    expect(REMOTE_PAIR_QUERY_PARAM).toBe('c')
  })

  it('does not double the slash when the base already ends in one', () => {
    expect(pairedRemoteUrl('http://192.168.1.40:7373/', 'K7FD')).toBe(
      'http://192.168.1.40:7373/?c=K7FD'
    )
  })

  it('escapes the code rather than trusting it to be url-safe', () => {
    expect(pairedRemoteUrl('http://192.168.1.40:7373', 'a b&c')).toBe(
      'http://192.168.1.40:7373/?c=a%20b%26c'
    )
  })
})
