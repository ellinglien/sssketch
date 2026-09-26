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

/** The three addresses of the machine in lanAddress.test.ts's fixture:
 * wifi, tailnet, and the internet-sharing bridge. */
const OURS = ['192.168.1.40', '100.66.121.12', '192.168.3.1']

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

  it('allows this machine own addresses and nothing else', () => {
    expect(isAllowedHost('192.168.1.40:7373', OURS, 7373)).toBe(true)
    expect(isAllowedHost('evil.example.com', OURS, 7373)).toBe(false)
    expect(isAllowedHost(undefined, OURS, 7373)).toBe(false)
  })

  it('allows localhost on the same port, for the desktop own check', () => {
    expect(isAllowedHost('localhost:7373', OURS, 7373)).toBe(true)
    expect(isAllowedHost('127.0.0.1:7373', OURS, 7373)).toBe(true)
    // Even when loopback is not in the list it was handed.
    expect(isAllowedHost('127.0.0.1:7373', ['192.168.1.40'], 7373)).toBe(true)
  })

  /** WHY THE GUARD WIDENED (2026-09-26).
   *
   * It used to be built from THE ONE address the desktop advertised, so a
   * request that arrived on any other address of the same machine got 403.
   * Reaching the remote by its tailnet address while the Mac was
   * advertising its wifi address answered a blank page -- which is what he
   * got, twice, before this.
   *
   * There is no security in insisting on one interface. A request arriving
   * on another address of the SAME MACHINE is equally legitimate; the
   * property being defended is something else entirely.
   *
   * WHAT THE GUARD IS FOR, AND WHY IT STILL WORKS: dns rebinding. An
   * attacker's page on evil.example.com re-resolves that NAME to the
   * victim's 192.168.x.y and has the browser talk to this server -- but the
   * browser sends the name it was given, `Host: evil.example.com`, and a
   * name is what this rejects. The allow-list holds IP LITERALS ONLY (plus
   * `localhost`, which no attacker can repoint: every OS and browser pins
   * it to loopback, and a page served from localhost:7373 is same-origin
   * with this server anyway). Widening one literal to all of this machine's
   * literals adds no name, so it adds no rebinding path: the only way a
   * browser sends one of them as Host is if it was pointed straight at that
   * address, which is not an attack, it is the phone. */
  it('allows any address of this machine, not only the advertised one', () => {
    expect(isAllowedHost('100.66.121.12:7373', OURS, 7373)).toBe(true)
    expect(isAllowedHost('192.168.3.1:7373', OURS, 7373)).toBe(true)
  })

  it('still refuses every name, which is what dns rebinding needs', () => {
    for (const name of [
      'evil.example.com:7373',
      'rebind.localhost.evil.com:7373',
      'localhost.evil.com:7373',
      'sssketch.local:7373',
      'EVIL.EXAMPLE.COM:7373'
    ]) {
      expect(isAllowedHost(name, OURS, 7373)).toBe(false)
    }
  })

  it('refuses an address of some other machine', () => {
    expect(isAllowedHost('192.168.1.99:7373', OURS, 7373)).toBe(false)
  })

  it('refuses the right address on the wrong port, and a missing port', () => {
    expect(isAllowedHost('192.168.1.40:8080', OURS, 7373)).toBe(false)
    expect(isAllowedHost('192.168.1.40', OURS, 7373)).toBe(false)
    expect(isAllowedHost('192.168.1.40:', OURS, 7373)).toBe(false)
    expect(isAllowedHost(':7373', OURS, 7373)).toBe(false)
  })

  it('refuses when this machine has no addresses to compare against', () => {
    // Everything but loopback, which is never in doubt.
    expect(isAllowedHost('192.168.1.40:7373', [], 7373)).toBe(false)
    expect(isAllowedHost('localhost:7373', [], 7373)).toBe(true)
  })

  it('ignores surrounding space and case in the header', () => {
    expect(isAllowedHost('  192.168.1.40:7373  ', OURS, 7373)).toBe(true)
    expect(isAllowedHost('LOCALHOST:7373', OURS, 7373)).toBe(true)
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
