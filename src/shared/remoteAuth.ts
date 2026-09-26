// src/shared/remoteAuth.ts

/** Fixed, so the URL he types once stays the URL forever. Bound to
 * 0.0.0.0 by the server -- it has to be, or the phone cannot reach it. */
export const REMOTE_PORT = 7373

/** Five wrong codes ends pairing for the session, and the desktop says so.
 * A 4-character code out of 32^4 is not brute-forceable in five tries, and
 * he will notice. */
export const REMOTE_MAX_PAIR_ATTEMPTS = 5

/** No 0/O/1/I/L -- this gets read off a screen across a room and typed on a
 * phone. 32 symbols, 4 characters, 1,048,576 codes. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** A fresh pairing code, generated each time the server starts and shown on
 * the desktop. `random` is injected (not Math.random directly) so this is
 * testable without a seam in the caller. */
export function newPairingCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    const index = Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))
    code += CODE_ALPHABET[index]
  }
  return code
}

/** Case-insensitive and trimmed, because he is typing it on a phone. An
 * empty expectation never matches anything -- that state means "no code
 * has been generated", and it must not read as "everything is correct". */
export function codesMatch(entered: string, expected: string): boolean {
  const a = entered.trim().toUpperCase()
  const b = expected.trim().toUpperCase()
  return a.length > 0 && a === b
}

/** Rejects a request whose Host header is not the address this server is
 * actually reachable at -- three lines that close DNS rebinding from a
 * browser tab elsewhere on the network. Loopback on the same port is also
 * allowed, so the desktop can check its own server is up without the guard
 * refusing it. */
export function isAllowedHost(hostHeader: string | undefined, expectedHost: string): boolean {
  if (!hostHeader) return false
  const host = hostHeader.trim().toLowerCase()
  if (host === expectedHost.trim().toLowerCase()) return true
  const port = expectedHost.split(':')[1] ?? String(REMOTE_PORT)
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`
}

export interface PairingGate {
  attemptsUsed: number
  lockedOut: boolean
}

/** The attempt limiter, as a pure transition so the server holds no logic
 * of its own. Once locked out, always locked out for this session -- a
 * correct code afterwards must not reopen it, or the limit means nothing. */
export function recordPairAttempt(gate: PairingGate, correct: boolean): PairingGate {
  if (gate.lockedOut) return gate
  if (correct) return { attemptsUsed: 0, lockedOut: false }
  const attemptsUsed = gate.attemptsUsed + 1
  return { attemptsUsed, lockedOut: attemptsUsed >= REMOTE_MAX_PAIR_ATTEMPTS }
}
