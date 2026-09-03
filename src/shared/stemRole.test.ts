import { describe, expect, it } from 'vitest'
import { resolveStemRole } from './stemRole'
import type { Stem } from './types'

function stem(overrides: Partial<Stem>): Stem {
  return {
    slot: 0,
    author: 'test',
    name: 'test stem',
    type: 'fx',
    path: '/tmp/test.wav',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('resolveStemRole', () => {
  it('is not uncertain when soundType is a real, non-default classification', () => {
    const role = resolveStemRole(stem({ type: 'drums' }), 'g1:0', null)
    expect(role.uncertain).toBe(false)
    expect(role.soundType).toBe('drums')
  })

  it('is not uncertain when busOf has a real assignment, even if soundType is the fx default', () => {
    const role = resolveStemRole(stem({ type: 'fx' }), 'g1:0', 'bass')
    expect(role.uncertain).toBe(false)
    expect(role.busId).toBe('bass')
  })

  it('is uncertain when soundType is still the fx default AND there is no bus assignment', () => {
    const role = resolveStemRole(stem({ type: 'fx' }), 'g1:0', null)
    expect(role.uncertain).toBe(true)
  })

  it('defaults included to true', () => {
    const role = resolveStemRole(stem({ type: 'drums' }), 'g1:0', null)
    expect(role.included).toBe(true)
  })

  it('carries the stemKey through unchanged', () => {
    const role = resolveStemRole(stem({}), 'g1:3', null)
    expect(role.stemKey).toBe('g1:3')
  })
})
