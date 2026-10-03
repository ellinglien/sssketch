// Fold mode follows the pace slider (spec 2026-10-03-radio-fold-follows-pace-design.md): the
// profile (radioPace.ts) and the cadence it gives (radioSchedule.ts).
import { describe, expect, it } from 'vitest'
import {
  RADIO_FOLD_PACE_FROM,
  RADIO_FOLD_PACE_JOINS,
  RADIO_FOLD_PACE_WINDOW_KNOTS,
  radioFoldPaceProfile,
  radioPaceProfile
} from './radioPace'
import { FOLD_PACE_BARS, FOLD_PREFER_WAIT_LAPS } from './radioFold'

describe('radioFoldPaceProfile', () => {
  it('its first knot is FOLD_PACE_BARS and its preference FOLD_PREFER_WAIT_LAPS', () => {
    const [l, min, max] = RADIO_FOLD_PACE_WINDOW_KNOTS[0]
    expect(l).toBe(RADIO_FOLD_PACE_FROM)
    expect({ min, max }).toEqual(FOLD_PACE_BARS)
    expect(radioFoldPaceProfile(0).preferWaitLaps).toBe(FOLD_PREFER_WAIT_LAPS)
  })

  it('at or below fast: fold mode as it was, whatever the level', () => {
    expect(RADIO_FOLD_PACE_FROM).toBe(50)
    for (let level = 0; level <= RADIO_FOLD_PACE_FROM; level++) {
      const p = radioFoldPaceProfile(level)
      expect(p.window).toEqual(FOLD_PACE_BARS)
      expect(p.phraseCap).toBeNull()
      expect(p.barEvery).toBeNull()
      expect(p.rows).toBe(1)
      expect(p.preferWaitLaps).toBe(FOLD_PREFER_WAIT_LAPS)
      expect(p.hurry).toBe(0)
    }
  })

  it('both window edges never grow with the level, never pass the slider, and meet it at 80', () => {
    for (let level = 1; level <= 100; level++) {
      const a = radioFoldPaceProfile(level - 1).window
      const b = radioFoldPaceProfile(level).window
      expect(b.min).toBeLessThanOrEqual(a.min)
      expect(b.max).toBeLessThanOrEqual(a.max)
      expect(b.min).toBeGreaterThanOrEqual(1)
      if (level > RADIO_FOLD_PACE_FROM) {
        expect(b.max).toBeGreaterThanOrEqual(radioPaceProfile(level).window.max)
        expect(b.min).toBeGreaterThanOrEqual(radioPaceProfile(level).window.min)
      }
    }
    for (let level = RADIO_FOLD_PACE_JOINS; level <= 100; level++) {
      const { preferWaitLaps, hurry, ...rest } = radioFoldPaceProfile(level)
      expect(rest).toEqual(radioPaceProfile(level))
      expect(preferWaitLaps).toBe(0)
      expect(hurry).toBeGreaterThan(0)
    }
  })

  it('the realignment preference fades 2 -> 1 -> 0, gone above 70; the hurry starts above 70', () => {
    expect(radioFoldPaceProfile(60).preferWaitLaps).toBe(2)
    expect(radioFoldPaceProfile(61).preferWaitLaps).toBe(1)
    expect(radioFoldPaceProfile(70).preferWaitLaps).toBe(1)
    expect(radioFoldPaceProfile(71).preferWaitLaps).toBe(0)
    expect(radioFoldPaceProfile(70).hurry).toBe(0)
    expect(radioFoldPaceProfile(85).hurry).toBeCloseTo(0.5)
    expect(radioFoldPaceProfile(100).hurry).toBe(1)
  })
})
