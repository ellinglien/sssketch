// The intensity arc's settings (spec 2026-10-05-radio-intensity-arc-design section 8):
// radioSchedule.ts's `intensity` density, `energy` and `drama`.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_DENSITY_OPTIONS,
  normalizeRadioDensity,
  normalizeRadioSettings,
  radioDensityOf,
  radioDramaOf,
  radioEnergyOf,
  radioIntensityOn
} from './radioSchedule'

describe('density intensity', () => {
  it('is an option, kept by normalize; the default stays arc', () => {
    expect(RADIO_DENSITY_OPTIONS).toEqual(['off', 'arc', 'intensity'])
    expect(normalizeRadioDensity('intensity')).toBe('intensity')
    expect(normalizeRadioDensity('loud')).toBe('arc')
    expect(DEFAULT_RADIO_SETTINGS.density).toBe('arc')
    expect(normalizeRadioSettings({ density: 'intensity' }).density).toBe('intensity')
    expect(radioIntensityOn(normalizeRadioSettings({ density: 'intensity' }))).toBe(true)
    expect(radioIntensityOn(DEFAULT_RADIO_SETTINGS)).toBe(false)
    expect(radioIntensityOn({})).toBe(false)
    expect(radioDensityOf({ ...DEFAULT_RADIO_SETTINGS, density: undefined })).toBe('arc')
  })
})

describe('energy and drama', () => {
  it('default to 50 and 60, clamped and rounded, a non-number taking the default', () => {
    expect(normalizeRadioSettings({})).toMatchObject({ energy: 50, drama: 60 })
    expect(normalizeRadioSettings({ energy: 120.4, drama: -3 })).toMatchObject({
      energy: 100,
      drama: 0
    })
    expect(normalizeRadioSettings({ energy: 33.6, drama: 'x' })).toMatchObject({
      energy: 34,
      drama: 60
    })
  })

  it('read as the defaults when absent (the web builds its own RadioSettings)', () => {
    expect(radioEnergyOf({})).toBe(50)
    expect(radioDramaOf({})).toBe(60)
    expect(radioEnergyOf({ energy: 7 })).toBe(7)
    expect(radioDramaOf({ drama: Number.NaN })).toBe(60)
  })
})
