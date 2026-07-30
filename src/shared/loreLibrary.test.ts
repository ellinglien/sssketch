import { describe, expect, it } from 'vitest'
import { instrumentMaskToSoundType, computeOwnerFraction, LORE_USERNAME } from './loreLibrary'

describe('instrumentMaskToSoundType', () => {
  it('maps the drum bit (2) to drums', () => {
    expect(instrumentMaskToSoundType(2)).toBe('drums')
  })

  it('maps the note bit (4) to notes', () => {
    expect(instrumentMaskToSoundType(4)).toBe('notes')
  })

  it('maps the bass bit (8) to bass', () => {
    expect(instrumentMaskToSoundType(8)).toBe('bass')
  })

  it('maps the mic bit (16) to audioIn', () => {
    expect(instrumentMaskToSoundType(16)).toBe('audioIn')
  })

  it('maps no bits set (0) to null', () => {
    expect(instrumentMaskToSoundType(0)).toBe(null)
  })

  it('prioritizes drum over note when both bits are set', () => {
    expect(instrumentMaskToSoundType(2 | 4)).toBe('drums')
  })

  it('prioritizes note over bass when both bits are set', () => {
    expect(instrumentMaskToSoundType(4 | 8)).toBe('notes')
  })

  it('prioritizes bass over mic when both bits are set', () => {
    expect(instrumentMaskToSoundType(8 | 16)).toBe('bass')
  })
})

describe('computeOwnerFraction', () => {
  it('is 1.0 when every creator matches', () => {
    expect(computeOwnerFraction(['elling', 'elling'], 'elling')).toBe(1)
  })

  it('is 0.0 when no creator matches', () => {
    expect(computeOwnerFraction(['ishaniii', 'mvdg'], 'elling')).toBe(0)
  })

  it('is the matching fraction for a mix', () => {
    expect(computeOwnerFraction(['elling', 'mvdg', 'elling', 'ishaniii'], 'elling')).toBe(0.5)
  })

  it('is 0 for an empty stem list, not NaN or a divide-by-zero error', () => {
    expect(computeOwnerFraction([], 'elling')).toBe(0)
  })

  it('matches LORE_USERNAME by default when no target is passed', () => {
    expect(computeOwnerFraction([LORE_USERNAME], undefined)).toBe(1)
  })
})
