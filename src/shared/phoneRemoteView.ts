// src/shared/phoneRemoteView.ts
import type { LanAddressCandidate } from './lanAddress'
import { REMOTE_MAX_PAIR_ATTEMPTS, pairedRemoteUrl } from './remoteAuth'

/** The phone remote's status as main reports it (see phoneRemoteStatus() in
 * src/main/index.ts, and the same shape in src/preload/index.ts). */
export interface PhoneRemoteStatus {
  running: boolean
  url: string | null
  pairingCode: string | null
  attemptsUsed: number
  lockedOut: boolean
  /** The address the remote is served on, or would be if switched on now.
   * His remembered choice when it is still one of `candidates`, otherwise
   * the best default -- see resolveRemoteAddress in lanAddress.ts. Null
   * when this machine has no usable IPv4 address at all. */
  lanAddress: string | null
  /** Every address it COULD be served on, best first. More than one means
   * the picker appears; see phoneRemoteAddressOptions. */
  candidates: LanAddressCandidate[]
}

/** One row of the address picker. */
export interface PhoneRemoteAddressOption {
  address: string
  /** 'en0 192.168.1.40' -- the interface then the address. The interface
   * name is what makes two private-looking addresses tellable apart, and it
   * is how he recognises the tailnet one (utun0) without the modal having
   * to explain what a tailnet is. */
  label: string
  selected: boolean
}

/** The addresses to offer him, or NOTHING WHEN THERE IS ONLY ONE.
 *
 * The empty list is the important case, not an edge case: on a machine with
 * one address there is no choice to make, and the modal must look exactly
 * as it did before any of this existed. A picker that is always on screen
 * would turn a card that answers "what do I type into my phone" into a
 * settings panel.
 *
 * Why a picker is needed at all, when the ranking is correct: his router (a
 * Bell Home Hub 3000) isolates wireless clients. His Mac and his iPhone are
 * both on 192.168.2.x and cannot reach each other AT ALL -- a bare
 * `python3 -m http.server` on another port is just as unreachable. No
 * ranking can know that. He can, and Tailscale is his way across. */
export function phoneRemoteAddressOptions(status: PhoneRemoteStatus): PhoneRemoteAddressOption[] {
  if (status.candidates.length < 2) return []
  return status.candidates.map((candidate) => ({
    address: candidate.address,
    label: `${candidate.interfaceName} ${candidate.address}`,
    selected: candidate.address === status.lanAddress
  }))
}

export interface PhoneRemoteModalView {
  /** The bare address, shown as text for anyone typing it by hand. */
  url: string
  /** The address with the pairing code in it -- what the QR encodes and
   * what the copy button copies. See pairedRemoteUrl's own comment for the
   * security trade that carries. */
  pairedUrl: string
  pairingCode: string
  /** What the attempt limiter is currently saying, or null while it has
   * nothing to say. */
  pairingNote: string | null
  /** The other addresses this machine could be reached on, or empty when
   * there is no choice to make. See phoneRemoteAddressOptions. */
  addressOptions: PhoneRemoteAddressOption[]
}

/** Whether the phone remote modal is showing, and what is on it.
 *
 * This is the rule the modal failed to have when the pairing code lived in
 * the gear menu: the code has to be on screen the moment the remote is
 * switched on, not only when someone happens to reopen a menu. So the modal
 * shows when it has been ASKED FOR (switching the remote on asks for it;
 * so does picking the menu entry again while it is running) AND the server
 * is actually up with an address and a code to show. Dismissing it only
 * clears the asked-for half -- it never stops the server, and the entry
 * that brings it back is still in the gear menu.
 *
 * Returning null for a running-but-incomplete status matters: a start can
 * fail asynchronously (port 7373 taken -> onServerError -> running false),
 * and an empty card claiming a remote is up would be worse than no card. */
export function phoneRemoteModalView(
  status: PhoneRemoteStatus | null,
  requested: boolean
): PhoneRemoteModalView | null {
  if (!requested || status === null) return null
  if (!status.running || status.url === null || status.pairingCode === null) return null
  return {
    url: status.url,
    pairedUrl: pairedRemoteUrl(status.url, status.pairingCode),
    pairingCode: status.pairingCode,
    pairingNote: pairingNote(status),
    addressOptions: phoneRemoteAddressOptions(status)
  }
}

function pairingNote(status: PhoneRemoteStatus): string | null {
  if (status.lockedOut) return 'pairing closed for this session'
  if (status.attemptsUsed > 0) return `${REMOTE_MAX_PAIR_ATTEMPTS - status.attemptsUsed} tries left`
  return null
}

/** How long the copy button says "copied" before going back to naming the
 * action. Long enough to be read after the eye returns to the button,
 * short enough that it is never still claiming a copy that happened a
 * while ago and may since have been overwritten. */
export const COPIED_FEEDBACK_MS = 1600

/** A clipboard write can be refused (it is a browser API, and Electron is a
 * browser) -- a button that says nothing when that happens is worse than
 * one that never claimed to work, because the address would then be handed
 * around unpasted. So the failure is a third state with its own label, not
 * a console line. */
export type CopyState = 'idle' | 'copied' | 'failed'

export function copyLinkLabel(state: CopyState): string {
  if (state === 'copied') return 'copied'
  if (state === 'failed') return 'copy failed'
  return 'copy link'
}
