import { describe, expect, it } from 'vitest'
import {
  DISCOVERED_JAM_CID,
  DISCOVERED_USER_NAME,
  discoveredGroupKey,
  findDuplicateDiscoveredGroup
} from './discoveredRoom'

describe('discoveredRoom', () => {
  it('names the room and its author', () => {
    expect(DISCOVERED_JAM_CID).toBe('discovered')
    expect(DISCOVERED_USER_NAME).toBe('discovered')
  })

  it('gives the same key regardless of order', () => {
    expect(discoveredGroupKey(['c', 'a', 'b'])).toBe(discoveredGroupKey(['a', 'b', 'c']))
  })

  it('collapses a repeated stem, so the same stem twice is one member', () => {
    expect(discoveredGroupKey(['a', 'a', 'b'])).toBe(discoveredGroupKey(['b', 'a']))
  })

  it('gives different keys to different sets', () => {
    expect(discoveredGroupKey(['a', 'b'])).not.toBe(discoveredGroupKey(['a', 'b', 'c']))
  })

  it('finds an existing group with the same stems in a different order', () => {
    const existing = [
      { riffCID: 'r1', stemCIDs: ['a', 'b', 'c'] },
      { riffCID: 'r2', stemCIDs: ['d'] }
    ]
    expect(findDuplicateDiscoveredGroup(existing, ['c', 'b', 'a'])).toBe('r1')
  })

  it('returns null when nothing matches', () => {
    const existing = [{ riffCID: 'r1', stemCIDs: ['a', 'b'] }]
    expect(findDuplicateDiscoveredGroup(existing, ['a', 'b', 'c'])).toBe(null)
  })

  it('returns null for an empty set of stems', () => {
    expect(findDuplicateDiscoveredGroup([{ riffCID: 'r1', stemCIDs: [] }], [])).toBe(null)
  })
})
