import { describe, expect, it } from 'vitest'
import { REMOTE_PAIR_QUERY_PARAM } from '@shared/remoteAuth'
import { REMOTE_PAGE_HTML } from './remotePage'

/** The phone page is one hand-written string, so these are the only checks
 * that can be made of it without a browser. They are the ones worth having:
 * that scanning the QR code still goes through the single pairing route,
 * and that the code does not stay in the address bar afterwards. */
describe('remotePage pairing', () => {
  it('has exactly one way to pair -- the qr link fills the same form in', () => {
    const attempts = REMOTE_PAGE_HTML.match(/fetch\('\/api\/pair'/g) ?? []
    expect(attempts).toHaveLength(1)
  })

  it('reads the pairing code out of the query parameter the qr encodes', () => {
    expect(REMOTE_PAGE_HTML).toContain(`/[?&]${REMOTE_PAIR_QUERY_PARAM}=([^&]*)/`)
  })

  it('strips the code from the address bar rather than leaving it to be reloaded', () => {
    expect(REMOTE_PAGE_HTML).toContain("history.replaceState(null, '', location.pathname)")
  })
})
