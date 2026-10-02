import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIO_SETTINGS, normalizeRadioSettings } from './radioSchedule'

describe('RadioSettings.turnarounds', () => {
  it('defaults to rare, with the deprecated dropOuts mirror equal', () => {
    expect(DEFAULT_RADIO_SETTINGS.turnarounds).toBe('rare')
    expect(DEFAULT_RADIO_SETTINGS.dropOuts).toBe('rare')
  })

  it('carries an old drop-outs choice over', () => {
    expect(normalizeRadioSettings({ dropOuts: 'often' })).toMatchObject({
      turnarounds: 'often',
      dropOuts: 'often'
    })
    expect(normalizeRadioSettings({ dropOuts: 'off' })).toMatchObject({
      turnarounds: 'off',
      dropOuts: 'off'
    })
  })

  it('reads turnarounds when there is no drop-outs value', () => {
    expect(normalizeRadioSettings({ turnarounds: 'often' })).toMatchObject({
      turnarounds: 'often',
      dropOuts: 'often'
    })
  })

  it('while the shipped menu still writes dropOuts, that is the newer of the two', () => {
    expect(normalizeRadioSettings({ turnarounds: 'rare', dropOuts: 'off' })).toMatchObject({
      turnarounds: 'off',
      dropOuts: 'off'
    })
  })

  it('falls back to rare for junk', () => {
    expect(normalizeRadioSettings({ turnarounds: 'loud', dropOuts: 3 })).toMatchObject({
      turnarounds: 'rare',
      dropOuts: 'rare'
    })
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
