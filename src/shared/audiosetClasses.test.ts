import { describe, expect, it } from 'vitest'
import { arrangeRoleForAudiosetClass } from './audiosetClasses'

describe('arrangeRoleForAudiosetClass', () => {
  it('maps "Drum kit" (index 157) to drums', () => {
    expect(arrangeRoleForAudiosetClass(157)).toBe('drums')
  })

  it('maps "Bass guitar" (index 137) to bass', () => {
    expect(arrangeRoleForAudiosetClass(137)).toBe('bass')
  })

  it('maps "Singing" (index 24) to vocal', () => {
    expect(arrangeRoleForAudiosetClass(24)).toBe('vocal')
  })

  it('returns null for an unmapped/ambiguous class (an index deliberately not in the lookup table)', () => {
    expect(arrangeRoleForAudiosetClass(500)).toBeNull()
  })

  it('returns null for an out-of-range index', () => {
    expect(arrangeRoleForAudiosetClass(9999)).toBeNull()
  })
})
