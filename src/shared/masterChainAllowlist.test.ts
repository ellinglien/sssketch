import { describe, it, expect } from 'vitest'
import { MASTER_CHAIN_ALLOWLIST, findMasterChainPlugin } from './masterChainAllowlist'

describe('findMasterChainPlugin', () => {
  it('finds a known entry by id', () => {
    expect(findMasterChainPlugin('pro-q-3')).toEqual({
      id: 'pro-q-3',
      displayName: 'FabFilter Pro-Q 3'
    })
  })

  it('returns undefined for an unknown id', () => {
    expect(findMasterChainPlugin('nope')).toBeUndefined()
  })

  it('has exactly 5 curated entries', () => {
    expect(MASTER_CHAIN_ALLOWLIST).toHaveLength(5)
  })
})
