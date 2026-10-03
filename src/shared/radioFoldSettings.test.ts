import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_PACE_BARS,
  normalizeRadioSettings,
  radioPaceWindowOf
} from './radioSchedule'

describe('RadioSettings fold fields', () => {
  it('default to off, fold 40, clash 25 and the default seed', () => {
    expect(DEFAULT_RADIO_SETTINGS.foldMode).toBe(false)
    expect(DEFAULT_RADIO_SETTINGS.fold).toBe(40)
    expect(DEFAULT_RADIO_SETTINGS.clash).toBe(25)
    expect(DEFAULT_RADIO_SETTINGS.foldSeed).toBe('autech')
  })

  it('a settings file from before fold mode gets the defaults', () => {
    const s = normalizeRadioSettings({ pace: 'fast' })
    expect(s.foldMode).toBe(false)
    expect(s.fold).toBe(40)
    expect(s.clash).toBe(25)
    expect(s.foldSeed).toBe('autech')
  })

  it('normalises: only true is on, faders clamp, a seed is cleaned', () => {
    const s = normalizeRadioSettings({ foldMode: 'yes', fold: 130, clash: -5, foldSeed: 'K3X9PQ' })
    expect(s.foldMode).toBe(false)
    expect(s.fold).toBe(100)
    expect(s.clash).toBe(0)
    expect(s.foldSeed).toBe('k3x9pq')
    expect(normalizeRadioSettings({ foldMode: true }).foldMode).toBe(true)
  })

  it('fold mode replaces the pace window with 16-64 bars, and gives the pace window back off', () => {
    const on = normalizeRadioSettings({ pace: 'fast', foldMode: true })
    expect(radioPaceWindowOf(on)).toEqual({ min: 16, max: 64 })
    expect(on.paceBars).toEqual(RADIO_PACE_BARS.fast)
    expect(radioPaceWindowOf({ ...on, foldMode: false })).toEqual(RADIO_PACE_BARS.fast)
  })
})
