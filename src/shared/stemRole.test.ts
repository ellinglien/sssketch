import { describe, expect, it } from 'vitest'
import { ARRANGE_ROLE_TO_BUS, engineRoleFor, resolveStemRole, type StemRoleInfo } from './stemRole'
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

  it('is uncertain for an unmatched audioIn stem too -- soundType->vocal is a blunt guess, not a real classification', () => {
    const role = resolveStemRole(
      stem({ type: 'audioIn', name: 'not a known preset' }),
      'g1:0',
      null
    )
    expect(role.uncertain).toBe(true)
    expect(role.arrangeRole).toBe('vocal')
  })

  it('is not uncertain for an audioIn stem once a real signal resolves it (busId or PresetName)', () => {
    const withBus = resolveStemRole(stem({ type: 'audioIn' }), 'g1:0', 'lead')
    expect(withBus.uncertain).toBe(false)
    // 'Microphone' is a real, known AUDIO_IN_PRESET_NAMES entry (presetNames.ts).
    const withPreset = resolveStemRole(stem({ type: 'audioIn', name: 'Microphone' }), 'g1:0', null)
    expect(withPreset.uncertain).toBe(false)
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

  it('a confirmed busId always wins, even when the preset name would also match', () => {
    const role = resolveStemRole(stem({ name: 'Keymasher', type: 'fx' }), 'k', 'drums')
    expect(role.arrangeRole).toBe('drums')
  })

  it('falls back to a PresetName match when there is no busId', () => {
    const role = resolveStemRole(stem({ name: 'Keymasher', type: 'fx' }), 'k', null)
    expect(role.arrangeRole).toBe('textureFx')
  })

  it('falls back to the raw SoundType mapping when neither busId nor PresetName match', () => {
    const role = resolveStemRole(stem({ name: 'My Custom Take', type: 'notes' }), 'k', null)
    expect(role.arrangeRole).toBe('lead')
  })

  it('a stem is no longer "uncertain" once a PresetName match is found, even with SoundType still fx', () => {
    const role = resolveStemRole(stem({ name: 'Keymasher', type: 'fx' }), 'k', null)
    expect(role.uncertain).toBe(false)
  })

  it('stays "uncertain" when SoundType is still fx and neither busId nor PresetName resolve it', () => {
    const role = resolveStemRole(stem({ name: 'My Custom Take', type: 'fx' }), 'k', null)
    expect(role.uncertain).toBe(true)
  })
})

describe('ARRANGE_ROLE_TO_BUS', () => {
  it('maps the 5 shared values to their own same-named bus', () => {
    expect(ARRANGE_ROLE_TO_BUS.drums).toBe('drums')
    expect(ARRANGE_ROLE_TO_BUS.bass).toBe('bass')
    expect(ARRANGE_ROLE_TO_BUS.lead).toBe('lead')
    expect(ARRANGE_ROLE_TO_BUS.backing).toBe('backing')
    expect(ARRANGE_ROLE_TO_BUS.aux).toBe('aux')
  })

  it('maps the 3 bus-less arrangeRole values to aux', () => {
    expect(ARRANGE_ROLE_TO_BUS.textureFx).toBe('aux')
    expect(ARRANGE_ROLE_TO_BUS.fill).toBe('aux')
    expect(ARRANGE_ROLE_TO_BUS.vocal).toBe('aux')
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
