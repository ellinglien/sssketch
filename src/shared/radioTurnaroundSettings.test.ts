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
