import { describe, expect, it } from 'vitest'
import {
  COPIED_FEEDBACK_MS,
  copyLinkLabel,
  phoneRemoteModalView,
  type PhoneRemoteStatus
} from './phoneRemoteView'

const running: PhoneRemoteStatus = {
  running: true,
  url: 'http://192.168.1.40:7373',
  pairingCode: 'K7FD',
  attemptsUsed: 0,
  lockedOut: false,
  lanAddress: '192.168.1.40'
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
      pairingNote: null
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
