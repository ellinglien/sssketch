import { describe, expect, it } from 'vitest'
import { guessSoundTypeFromPresetName, guessArrangeRoleFromPresetName } from './presetNames'

describe('guessSoundTypeFromPresetName', () => {
  it('matches a built-in FX preset name', () => {
    expect(guessSoundTypeFromPresetName('Bitcrusher')).toBe('fx')
  })

  it('matches a Notes pack preset name', () => {
    expect(guessSoundTypeFromPresetName('Pianabot')).toBe('notes')
  })

  it('matches "Microphone" to audioIn', () => {
    expect(guessSoundTypeFromPresetName('Microphone')).toBe('audioIn')
  })

  it('is case-insensitive', () => {
    expect(guessSoundTypeFromPresetName('bitcrusher')).toBe('fx')
    expect(guessSoundTypeFromPresetName('BITCRUSHER')).toBe('fx')
  })

  it('tolerates surrounding whitespace', () => {
    expect(guessSoundTypeFromPresetName('  Bitcrusher  ')).toBe('fx')
  })

  it("returns null for a name not in the table, e.g. a user's own custom stem name", () => {
    expect(guessSoundTypeFromPresetName('my cool loop')).toBeNull()
  })

  it('requires an exact match, not a substring', () => {
    // "Bitcrusher Deluxe" contains a known name but isn't one itself.
    expect(guessSoundTypeFromPresetName('Bitcrusher Deluxe')).toBeNull()
  })
})

describe('guessArrangeRoleFromPresetName', () => {
  it('maps a known FX preset name to textureFx', () => {
    expect(guessArrangeRoleFromPresetName('Keymasher')).toEqual({ arrangeRole: 'textureFx' })
  })

  it('maps a known Notes preset name to lead', () => {
    expect(guessArrangeRoleFromPresetName('Eardrop')).toEqual({ arrangeRole: 'lead' })
  })

  it('maps the literal "Microphone" preset name to vocal', () => {
    expect(guessArrangeRoleFromPresetName('Microphone')).toEqual({ arrangeRole: 'vocal' })
  })

  it('is case-insensitive and trims whitespace, matching guessSoundTypeFromPresetName', () => {
    expect(guessArrangeRoleFromPresetName('  keymasher  ')).toEqual({ arrangeRole: 'textureFx' })
  })

  it('returns null for an unrecognized name', () => {
    expect(guessArrangeRoleFromPresetName('My Custom Take 3')).toBeNull()
  })

  it('never returns a drumSubRole today -- the reused preset-name corpus has no drum entries', () => {
    const result = guessArrangeRoleFromPresetName('Keymasher')
    expect(result?.drumSubRole).toBeUndefined()
  })
})
