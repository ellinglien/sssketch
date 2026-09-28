// src/shared/phoneRemoteView.ts
import type { LanAddressCandidate, LanAddressKind } from './lanAddress'
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
  /** The human word the row leads with -- 'wi-fi', 'vpn', 'bridge'. */
  label: string
  /** 'en0 · 192.168.1.40' -- the device name and the address, kept under
   * the word rather than instead of it. It is what makes two
   * private-looking addresses tellable apart, and it is the escape hatch
   * for the one guess lanAddress.ts makes (see LanAddressKind: node cannot
   * tell wifi from ethernet, so on a mac mini the word can be wrong and
   * the line under it never is). */
  detail: string
  /** A short clause where the word alone would get someone stuck on the
   * wrong row, else null. */
  note: string | null
  selected: boolean
}

/** The human word, and any warning that goes with it, for each kind of
 * address lanAddress.ts classifies. Derived from that classification, not
 * from a second look at the interface name -- there is one place in this
 * codebase that knows `utun` means vpn, and it is not here. */
const KIND_LABELS: Record<LanAddressKind, { label: string; note: string | null }> = {
  wifi: { label: 'wi-fi', note: null },
  ethernet: { label: 'ethernet', note: null },
  // Both notes are for the same failure: picking a row that is only
  // reachable from somewhere the phone is not. A tailnet address works
  // beautifully -- from another device on the tailnet. A sharing bridge
  // works from a vm, or from something plugged into this mac.
  vpn: { label: 'vpn', note: 'only if the phone is on it too' },
  bridge: { label: 'bridge', note: 'for virtual machines' }
}

/** Every address he could be offered, best first, as the picker draws
 * them. A plain projection of the candidates -- WHETHER to show any of
 * this is the modal's decision, not this function's.
 *
 * It used to return [] below two candidates, because the picker sat on the
 * card unconditionally and one chip would have been noise. Since
 * 2026-09-28 the whole thing lives behind `not connecting?`, so there is
 * nothing to hide from and the hiding rule went with it.
 *
 * Why a picker is needed at all, when the ranking is correct: his router (a
 * Bell Home Hub 3000) isolates wireless clients. His Mac and his iPhone are
 * both on 192.168.2.x and cannot reach each other AT ALL -- a bare
 * `python3 -m http.server` on another port is just as unreachable. No
 * ranking can know that. He can, and Tailscale is his way across. */
export function phoneRemoteAddressOptions(status: PhoneRemoteStatus): PhoneRemoteAddressOption[] {
  return status.candidates.map((candidate) => {
    const { label, note } = KIND_LABELS[candidate.kind]
    return {
      address: candidate.address,
      label,
      detail: `${candidate.interfaceName} · ${candidate.address}`,
      note,
      selected: candidate.address === status.lanAddress
    }
  })
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
