import { describe, expect, it } from 'vitest'
import { guessSoundTypeFromPresetName } from './presetNames'

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
