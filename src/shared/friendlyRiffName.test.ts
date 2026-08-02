import { describe, expect, it } from 'vitest'
import { friendlyRiffName } from './friendlyRiffName'

describe('friendlyRiffName', () => {
  it('is deterministic — the same riffCID always produces the same name', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid)).toBe(friendlyRiffName(cid))
  })

  it('ends with the first 8 characters of the riffCID, followed by "lore"', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid)).toMatch(/2f29c140 lore$/)
  })

  it('starts with an "adjective noun" pair', () => {
    const cid = '2f29c1401234567890abcdef'
    expect(friendlyRiffName(cid)).toMatch(/^[a-z]+ [a-z]+ 2f29c140 lore$/)
  })

  it('produces different names for different riffCIDs (not a constant)', () => {
    const a = friendlyRiffName('aaaaaaaa1111111111111111')
    const b = friendlyRiffName('bbbbbbbb2222222222222222')
    expect(a).not.toBe(b)
  })

  it('the adjective and noun do not always move together across different CIDs', () => {
    // Regression guard for a naive single-hash implementation where the
    // adjective and noun index would be derived from the same value (e.g.
    // one via modulo, one via integer division of the same hash), which
    // can make them covary more than expected. Not a strict statistical
    // test — just confirms a handful of sample CIDs produce more than one
    // distinct adjective AND more than one distinct noun.
    const cids = ['cid-one', 'cid-two', 'cid-three', 'cid-four', 'cid-five', 'cid-six']
    const names = cids.map((cid) => friendlyRiffName(cid).split(' '))
    const adjectives = new Set(names.map((n) => n[0]))
    const nouns = new Set(names.map((n) => n[1]))
    expect(adjectives.size).toBeGreaterThan(1)
    expect(nouns.size).toBeGreaterThan(1)
  })
})
