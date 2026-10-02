import { describe, expect, it } from 'vitest'
import { discoverStemPumpRoles, pumpRoleFor, pumpRoleForSoundType } from './radioPump'
import { stemKey } from './types'

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

describe('discoverStemPumpRoles (the preview rows, by slot kinds)', () => {
  it("gives each member's stem key its slot's role; bass and unknown slots have none", () => {
    const slots = [
      { id: 'a', kinds: ['drums'] as const },
      { id: 'b', kinds: ['bass'] as const },
      { id: 'c', kinds: ['lead'] as const },
      { id: 'd', kinds: [] as const }
    ]
    // members in their own order: stem i + 1 is memberSlotIds[i]
    const roles = discoverStemPumpRoles(slots, ['c', 'a', 'b', 'gone', 'd'], 'g')
    expect([...roles.entries()]).toEqual([
      [stemKey('g', 1), 'pumped'],
      [stemKey('g', 2), 'key'],
      [stemKey('g', 5), 'pumped']
    ])
  })
})
