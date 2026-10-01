import { describe, expect, it } from 'vitest'
import { pumpRoleFor, pumpRoleForSoundType } from './radioPump'

// moved from ell.ing/radio src/radio/pump.test.ts (2026-10-01)
describe('pumpRoleFor', () => {
  it('drums key the pump, bass is left alone, everything else is pumped', () => {
    expect(pumpRoleFor(['drums'])).toBe('key')
    expect(pumpRoleFor(['drums', 'lead'])).toBe('key')
    expect(pumpRoleFor(['bass'])).toBe('none')
    expect(pumpRoleFor(['lead'])).toBe('pumped')
    expect(pumpRoleFor(['warm'])).toBe('pumped')
    expect(pumpRoleFor([])).toBe('pumped')
  })
})

describe('pumpRoleForSoundType (the timeline)', () => {
  it('drums key the pump, bass is left alone, every other type is pumped', () => {
    expect(pumpRoleForSoundType('drums')).toBe('key')
    expect(pumpRoleForSoundType('bass')).toBe('none')
    for (const t of ['notes', 'extInst', 'sampler', 'fx', 'extFx', 'audioIn'] as const) {
      expect(pumpRoleForSoundType(t)).toBe('pumped')
    }
  })
})
