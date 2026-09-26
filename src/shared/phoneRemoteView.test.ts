import { describe, expect, it } from 'vitest'
import {
  COPIED_FEEDBACK_MS,
  copyLinkLabel,
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
  candidates: [{ address: '192.168.1.40', interfaceName: 'en0', preferred: true }]
}

/** His machine on 2026-09-26: wifi that his router will not let the phone
 * cross, the tailnet that it can, and an internet-sharing bridge. */
const THREE_WAYS: PhoneRemoteStatus = {
  ...running,
  candidates: [
    { address: '192.168.1.40', interfaceName: 'en0', preferred: true },
    { address: '100.66.121.12', interfaceName: 'utun0', preferred: false },
    { address: '192.168.3.1', interfaceName: 'bridge100', preferred: false }
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
      addressOptions: []
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
  it('offers nothing at all when there is only one address', () => {
    // The modal is tight and this is the ordinary case -- with one
    // candidate it must look exactly as it did before the picker existed.
    expect(phoneRemoteAddressOptions(running)).toEqual([])
  })

  it('offers nothing when there are no addresses', () => {
    expect(phoneRemoteAddressOptions({ ...running, candidates: [], lanAddress: null })).toEqual([])
  })

  it('offers every address, in rank order, marking the one in use', () => {
    expect(phoneRemoteAddressOptions(THREE_WAYS)).toEqual([
      { address: '192.168.1.40', label: 'en0 192.168.1.40', selected: true },
      { address: '100.66.121.12', label: 'utun0 100.66.121.12', selected: false },
      { address: '192.168.3.1', label: 'bridge100 192.168.3.1', selected: false }
    ])
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
