import { describe, expect, it } from 'vitest'
import { engineRoleFor, resolveStemRole, type StemRoleInfo } from './stemRole'
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

  it("defaults frequency to 'occasional' -- some baseline re-entry/movement without manual opt-in", () => {
    const role = resolveStemRole(stem({ type: 'drums' }), 'g1:0', null)
    expect(role.frequency).toBe('occasional')
  })

  it('carries the stemKey through unchanged', () => {
    const role = resolveStemRole(stem({}), 'g1:3', null)
    expect(role.stemKey).toBe('g1:3')
  })

  describe('arrangeRole seeding', () => {
    it('maps busId 1:1 when set, taking priority over soundType', () => {
      expect(resolveStemRole(stem({ type: 'fx' }), 'k', 'drums').arrangeRole).toBe('drums')
      expect(resolveStemRole(stem({ type: 'fx' }), 'k', 'bass').arrangeRole).toBe('bass')
      expect(resolveStemRole(stem({ type: 'fx' }), 'k', 'lead').arrangeRole).toBe('lead')
      expect(resolveStemRole(stem({ type: 'fx' }), 'k', 'backing').arrangeRole).toBe('backing')
      expect(resolveStemRole(stem({ type: 'fx' }), 'k', 'aux').arrangeRole).toBe('aux')
    })

    it('falls back to soundType-based guess when busId is null', () => {
      expect(resolveStemRole(stem({ type: 'drums' }), 'k', null).arrangeRole).toBe('drums')
      expect(resolveStemRole(stem({ type: 'bass' }), 'k', null).arrangeRole).toBe('bass')
      expect(resolveStemRole(stem({ type: 'notes' }), 'k', null).arrangeRole).toBe('lead')
      expect(resolveStemRole(stem({ type: 'extInst' }), 'k', null).arrangeRole).toBe('backing')
      expect(resolveStemRole(stem({ type: 'sampler' }), 'k', null).arrangeRole).toBe('fill')
      expect(resolveStemRole(stem({ type: 'fx' }), 'k', null).arrangeRole).toBe('textureFx')
      expect(resolveStemRole(stem({ type: 'extFx' }), 'k', null).arrangeRole).toBe('textureFx')
      expect(resolveStemRole(stem({ type: 'audioIn' }), 'k', null).arrangeRole).toBe('vocal')
    })

    it('busId takes priority even when soundType would guess something else', () => {
      const role = resolveStemRole(stem({ type: 'audioIn' }), 'k', 'lead')
      expect(role.arrangeRole).toBe('lead')
    })
  })

  it('defaults drumSubRole to undefined -- no auto-detection, manual-only per this feature design', () => {
    const role = resolveStemRole(stem({ type: 'drums' }), 'k', null)
    expect(role.drumSubRole).toBeUndefined()
  })
})

describe('engineRoleFor', () => {
  function roleInfo(overrides: Partial<StemRoleInfo>): StemRoleInfo {
    return {
      stemKey: 'k',
      soundType: 'drums',
      busId: null,
      arrangeRole: 'drums',
      uncertain: false,
      included: true,
      frequency: 'occasional',
      ...overrides
    }
  }

  it('returns the plain arrangeRole when arrangeRole is drums but no sub-role was set', () => {
    expect(engineRoleFor(roleInfo({ arrangeRole: 'drums', drumSubRole: undefined }))).toBe('drums')
  })

  it('returns the drum sub-role instead of the generic "drums" bucket when one is set', () => {
    expect(engineRoleFor(roleInfo({ arrangeRole: 'drums', drumSubRole: 'kick' }))).toBe('kick')
    expect(engineRoleFor(roleInfo({ arrangeRole: 'drums', drumSubRole: 'hihat' }))).toBe('hihat')
  })

  it('ignores drumSubRole entirely when arrangeRole is not drums', () => {
    // Shouldn't be reachable through the real UI (the sub-role picker only
    // shows for arrangeRole === 'drums'), but the engine-facing string must
    // never silently read a stale sub-role left over from a prior role
    // switch as if it still applied to some other role.
    expect(engineRoleFor(roleInfo({ arrangeRole: 'bass', drumSubRole: 'kick' }))).toBe('bass')
  })
})
