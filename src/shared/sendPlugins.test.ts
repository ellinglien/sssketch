import { describe, expect, it } from 'vitest'
import { SEND_PLUGIN_ALLOWLIST, findSendPlugin } from './sendPlugins'

describe('SEND_PLUGIN_ALLOWLIST', () => {
  it('has exactly 5 entries, matching the native allowlist', () => {
    expect(SEND_PLUGIN_ALLOWLIST).toHaveLength(5)
  })

  it('every entry has a unique id', () => {
    const ids = SEND_PLUGIN_ALLOWLIST.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('findSendPlugin', () => {
  it('finds an entry by id', () => {
    expect(findSendPlugin('solid-bus-comp')?.displayName).toBe('Solid Bus Comp')
  })

  it('returns undefined for an unknown id', () => {
    expect(findSendPlugin('not-a-real-plugin')).toBeUndefined()
  })
})
