import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIO_SETTINGS, normalizeRadioSettings } from './radioSchedule'

describe('RadioSettings.turnarounds', () => {
  it('defaults to rare, and there is no dropOuts field any more', () => {
    expect(DEFAULT_RADIO_SETTINGS.turnarounds).toBe('rare')
    expect(DEFAULT_RADIO_SETTINGS).not.toHaveProperty('dropOuts')
    expect(normalizeRadioSettings({})).not.toHaveProperty('dropOuts')
  })

  it('carries an old drop-outs choice over when there is no turnarounds value', () => {
    expect(normalizeRadioSettings({ dropOuts: 'often' }).turnarounds).toBe('often')
    expect(normalizeRadioSettings({ dropOuts: 'off' }).turnarounds).toBe('off')
  })

  it('a turnarounds value wins over an old drop-outs one', () => {
    expect(normalizeRadioSettings({ turnarounds: 'rare', dropOuts: 'off' }).turnarounds).toBe(
      'rare'
    )
  })

  it('falls back to rare for junk', () => {
    expect(normalizeRadioSettings({ turnarounds: 'loud', dropOuts: 3 }).turnarounds).toBe('rare')
  })
})

describe('RadioSettings.turnaroundMoves and turnaroundDepth', () => {
  it('default to every family, bold', () => {
    expect(DEFAULT_RADIO_SETTINGS.turnaroundMoves).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(DEFAULT_RADIO_SETTINGS.turnaroundDepth).toBe('bold')
  })

  it('normalise: unknown families dropped, empty kept (off), junk depth bold', () => {
    expect(normalizeRadioSettings({ turnaroundMoves: ['riser', 'loud'] }).turnaroundMoves).toEqual([
      'riser'
    ])
    expect(normalizeRadioSettings({ turnaroundMoves: [] }).turnaroundMoves).toEqual([])
    expect(normalizeRadioSettings({}).turnaroundMoves).toEqual([
      'drops',
      'wash',
      'filters',
      'riser'
    ])
    expect(normalizeRadioSettings({ turnaroundDepth: 'subtle' }).turnaroundDepth).toBe('subtle')
    expect(normalizeRadioSettings({ turnaroundDepth: 'deep' }).turnaroundDepth).toBe('bold')
  })
})
