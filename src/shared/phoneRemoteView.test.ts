import { describe, expect, it } from 'vitest'
import {
  COPIED_FEEDBACK_MS,
  copyLinkLabel,
  REMOTE_TROUBLE_REASONS,
  phoneRemoteAddressOptions,
  phoneRemoteModalView,
  type PhoneRemoteStatus
} from './phoneRemoteView'

const running: PhoneRemoteStatus = {
  running: true,
  url: 'http://192.168.1.40:7373',
  pairingCode: 'K7FD',
  attemptsUsed: 0,
  lockedOut: false,
  lanAddress: '192.168.1.40',
  candidates: [{ address: '192.168.1.40', interfaceName: 'en0', kind: 'wifi', preferred: true }]
}

/** His machine on 2026-09-26: wifi that his router will not let the phone
 * cross, the tailnet that it can, and an internet-sharing bridge. */
const THREE_WAYS: PhoneRemoteStatus = {
  ...running,
  candidates: [
    { address: '192.168.1.40', interfaceName: 'en0', kind: 'wifi', preferred: true },
    { address: '100.66.121.12', interfaceName: 'utun0', kind: 'vpn', preferred: false },
    { address: '192.168.3.1', interfaceName: 'bridge100', kind: 'bridge', preferred: false }
  ]
}

describe('phoneRemoteModalView', () => {
  it('shows nothing until the modal has been asked for', () => {
    expect(phoneRemoteModalView(running, false)).toBeNull()
  })

  it('shows nothing before the first status has arrived', () => {
    expect(phoneRemoteModalView(null, true)).toBeNull()
  })

  it('shows nothing when the remote is not running', () => {
    expect(
      phoneRemoteModalView({ ...running, running: false, url: null, pairingCode: null }, true)
    ).toBeNull()
  })

  it('shows nothing when the server reports no url or no code', () => {
    expect(phoneRemoteModalView({ ...running, url: null }, true)).toBeNull()
    expect(phoneRemoteModalView({ ...running, pairingCode: null }, true)).toBeNull()
  })

  it('shows the address, the code, and the paired link once running and asked for', () => {
    expect(phoneRemoteModalView(running, true)).toEqual({
      url: 'http://192.168.1.40:7373',
      pairedUrl: 'http://192.168.1.40:7373/?c=K7FD',
      pairingCode: 'K7FD',
      pairingNote: null,
      addressOptions: [
        {
          address: '192.168.1.40',
          label: 'wi-fi',
          detail: 'en0 · 192.168.1.40',
          note: null,
          selected: true
        }
      ]
    })
  })

  it('counts down the remaining tries once one has been used', () => {
    expect(phoneRemoteModalView({ ...running, attemptsUsed: 1 }, true)?.pairingNote).toBe(
      '4 tries left'
    )
    expect(phoneRemoteModalView({ ...running, attemptsUsed: 4 }, true)?.pairingNote).toBe(
      '1 tries left'
    )
  })

  it('says pairing is over once locked out, instead of a count', () => {
    expect(
      phoneRemoteModalView({ ...running, attemptsUsed: 5, lockedOut: true }, true)?.pairingNote
    ).toBe('pairing closed for this session')
  })
})

/** The picker exists because no ranking can fix his router: it isolates
 * wireless clients, so the address the app picks perfectly correctly is
 * still one his phone cannot reach. Only he knows which network the phone
 * is actually on. */
describe('phoneRemoteAddressOptions', () => {
  /** WHY THIS NO LONGER HIDES A LONE ADDRESS (2026-09-28). It used to
   * return [] below two candidates, because the picker was on the card
   * unconditionally and one chip would have been noise. The picker is
   * behind a disclosure now, so hiding is the modal's decision and this
   * is a plain projection of the candidates. */
  it('offers the one address there is, rather than nothing', () => {
    expect(phoneRemoteAddressOptions(running)).toHaveLength(1)
  })

  it('offers nothing when there are no addresses', () => {
    expect(phoneRemoteAddressOptions({ ...running, candidates: [], lanAddress: null })).toEqual([])
  })

  it('leads each row with a human word and keeps the device name under it', () => {
    // `utun0 100.66.121.12` is a BSD device name and an address. Nobody
    // outside lanAddress.ts should have to know what a utun is.
    expect(phoneRemoteAddressOptions(THREE_WAYS)).toEqual([
      {
        address: '192.168.1.40',
        label: 'wi-fi',
        detail: 'en0 · 192.168.1.40',
        note: null,
        selected: true
      },
      {
        address: '100.66.121.12',
        label: 'vpn',
        detail: 'utun0 · 100.66.121.12',
        note: 'only if the phone is on it too',
        selected: false
      },
      {
        address: '192.168.3.1',
        label: 'bridge',
        detail: 'bridge100 · 192.168.3.1',
        note: 'for virtual machines',
        selected: false
      }
    ])
  })

  it('calls an ordinary non-wifi interface ethernet', () => {
    const wired = phoneRemoteAddressOptions({
      ...running,
      candidates: [
        { address: '192.168.1.40', interfaceName: 'en5', kind: 'ethernet', preferred: true }
      ]
    })
    expect(wired[0].label).toBe('ethernet')
    expect(wired[0].detail).toBe('en5 · 192.168.1.40')
  })

  it('marks the tailnet address as the one in use once he has picked it', () => {
    const options = phoneRemoteAddressOptions({ ...THREE_WAYS, lanAddress: '100.66.121.12' })
    expect(options.map((option) => option.selected)).toEqual([false, true, false])
  })

  it('marks nothing when the address in use is not among the candidates', () => {
    // Should not happen -- main resolves one from the other -- but a picker
    // with a phantom selection would be worse than one with none.
    expect(
      phoneRemoteAddressOptions({ ...THREE_WAYS, lanAddress: '10.0.0.9' }).some(
        (option) => option.selected
      )
    ).toBe(false)
  })

  it('carries the options onto the modal view', () => {
    expect(phoneRemoteModalView(THREE_WAYS, true)?.addressOptions).toHaveLength(3)
  })
})

describe('copyLinkLabel', () => {
  it('names the action, then confirms it', () => {
    expect(copyLinkLabel('idle')).toBe('copy link')
    expect(copyLinkLabel('copied')).toBe('copied')
  })

  it('says so when the clipboard refused, rather than nothing', () => {
    expect(copyLinkLabel('failed')).toBe('copy failed')
  })

  it('holds the confirmation long enough to read and not long enough to mislead', () => {
    expect(COPIED_FEEDBACK_MS).toBeGreaterThanOrEqual(1000)
    expect(COPIED_FEEDBACK_MS).toBeLessThanOrEqual(3000)
  })
})

/** WHY A FAILURE USED TO SAY NOTHING (2026-09-28). A phone that would not
 * connect got a QR code, an address and silence. All three of the real
 * causes are things the app cannot detect and the person CAN check, so
 * naming them is the whole of the help there is to give. */
describe('REMOTE_TROUBLE_REASONS', () => {
  it('names the three real causes and stops there', () => {
    expect(REMOTE_TROUBLE_REASONS).toHaveLength(3)
    // client isolation (his Bell Home Hub 3000 does exactly this), a vpn
    // on the phone, and a firewall on this mac.
    expect(REMOTE_TROUBLE_REASONS[0]).toContain('router')
    expect(REMOTE_TROUBLE_REASONS[1]).toContain('vpn')
    expect(REMOTE_TROUBLE_REASONS[2]).toContain('firewall')
  })

  it('is written in the product voice -- lowercase, no shouting', () => {
    for (const reason of REMOTE_TROUBLE_REASONS) {
      expect(reason).toBe(reason.toLowerCase())
      expect(reason).not.toMatch(/[!]/)
      // Short enough to be read at a glance under a qr code.
      expect(reason.length).toBeLessThanOrEqual(64)
    }
  })
})

/** The computer's own name as a row in the picker -- see withComputerName
 * in lanAddress.ts for why it is offered and why it is never the default. */
describe('the computer name row', () => {
  const withName: PhoneRemoteStatus = {
    ...THREE_WAYS,
    candidates: [
      ...THREE_WAYS.candidates,
      { address: 'nickelm2.local', interfaceName: '', kind: 'computer-name', preferred: false }
    ]
  }

  it('leads with the human words and says what it is for', () => {
    expect(phoneRemoteAddressOptions(withName).at(-1)).toEqual({
      address: 'nickelm2.local',
      label: 'computer name',
      // No interface, so no `en0 · ` in front of it -- the name IS the
      // address, and a dangling separator would read as a missing word.
      detail: 'nickelm2.local',
      note: 'survives address changes',
      selected: false
    })
  })

  it('is marked in use once it is the address being served on', () => {
    const options = phoneRemoteAddressOptions({ ...withName, lanAddress: 'nickelm2.local' })
    expect(options.map((option) => option.selected)).toEqual([false, false, false, true])
  })
})
