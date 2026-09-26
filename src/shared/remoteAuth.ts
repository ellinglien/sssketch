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

/** Rejects a request whose Host header is not an address of THIS MACHINE on
 * the port this server is listening on -- the lines that close DNS
 * rebinding from a browser tab elsewhere on the network. Loopback is always
 * allowed, so the desktop can check its own server is up.
 *
 * `ownAddresses` is every IPv4 the machine currently holds (see
 * allLocalIPv4Addresses in lanAddress.ts), not the one address the desktop
 * chose to advertise. It used to be just that one, and a request arriving
 * on any other address of the same machine -- the tailnet address, say --
 * answered 403 into a blank page. A request on another of our own addresses
 * is equally legitimate; insisting on one interface bought nothing.
 *
 * THE PROPERTY THAT SURVIVES, STATED PLAINLY: rebinding works by making a
 * NAME the browser trusts resolve to an address on the victim's network,
 * and the browser then sends that name in Host. This accepts IP LITERALS
 * only. The single exception is `localhost`, which cannot be repointed --
 * every OS and browser pins it to loopback, and a page served from
 * localhost:<port> is same-origin with this server regardless. Adding more
 * of our own literals adds no name and therefore no rebinding path: a
 * browser only sends one of them as Host if it was pointed at that address
 * directly, which is not an attack, it is the phone. */
export function isAllowedHost(
  hostHeader: string | undefined,
  ownAddresses: string[],
  port: number = REMOTE_PORT
): boolean {
  if (!hostHeader) return false
  const host = hostHeader.trim().toLowerCase()
  const separator = host.lastIndexOf(':')
  // No port in the header is not this server: 7373 is never a scheme
  // default, so a browser talking to us always sends one.
  if (separator <= 0) return false
  if (host.slice(separator + 1) !== String(port)) return false
  const name = host.slice(0, separator)
  if (name === 'localhost' || name === '127.0.0.1') return true
  return ownAddresses.some((address) => address.trim().toLowerCase() === name)
}

/** The query parameter the QR code carries the pairing code in. The phone
 * page reads it, pairs with it through the one and only pairing route, and
 * strips it from the address bar -- see remotePage.ts. */
export const REMOTE_PAIR_QUERY_PARAM = 'c'

/** The link the desktop's QR code encodes and its copy button copies: the
 * remote's address with the pairing code already in it, so scanning with
 * the camera (or pasting via Universal Clipboard) pairs with nothing typed.
 *
 * THE SECURITY TRADE, STATED RATHER THAN LEFT IMPLICIT: a code in a link is
 * a code anyone who can see the screen, the photo, or the pasted URL can
 * use. That is genuinely wider than four characters typed by hand. It is
 * accepted here because everything around it is unchanged and narrow -- the
 * server is off by default, opt-in per session, never persisted, killed on
 * quit; the code is regenerated every start; the five-attempt limiter and
 * the Host guard still apply to this path because it IS the typed path (the
 * page just fills the form in); and the blast radius of a paired client is
 * rolling dice on the Discover screen that is already on the Mac. On a home
 * LAN, for a session-lived code, that is a fair price for removing the
 * worst part of the flow. It would not be on a shared or public network --
 * which is the same caveat the feature already carries for being bound to
 * 0.0.0.0 at all. */
export function pairedRemoteUrl(baseUrl: string, code: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${base}/?${REMOTE_PAIR_QUERY_PARAM}=${encodeURIComponent(code)}`
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
