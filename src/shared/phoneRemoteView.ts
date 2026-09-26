// src/shared/phoneRemoteView.ts
import { REMOTE_MAX_PAIR_ATTEMPTS, pairedRemoteUrl } from './remoteAuth'

/** The phone remote's status as main reports it (see phoneRemoteStatus() in
 * src/main/index.ts, and the same shape in src/preload/index.ts). */
export interface PhoneRemoteStatus {
  running: boolean
  url: string | null
  pairingCode: string | null
  attemptsUsed: number
  lockedOut: boolean
  /** Null when this machine has no non-internal IPv4 address. */
  lanAddress: string | null
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
    pairingNote: pairingNote(status)
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
