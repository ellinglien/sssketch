// Fold mode follows the pace slider (spec 2026-10-03-radio-fold-follows-pace-design.md): the
// profile (radioPace.ts) and the cadence it gives (radioSchedule.ts).
import { describe, expect, it, vi } from 'vitest'
import {
  RADIO_FOLD_PACE_FROM,
  RADIO_FOLD_PACE_JOINS,
  RADIO_FOLD_PACE_WINDOW_KNOTS,
  radioFoldPaceProfile,
  radioPaceProfile
} from './radioPace'
import { FOLD_PACE_BARS, FOLD_PREFER_WAIT_LAPS } from './radioFold'
import {
  DEFAULT_RADIO_SETTINGS,
  createRadioClock,
  radioCadenceBarEvery,
  radioCadenceHasMidLoopLines,
  radioCadenceOf,
  radioClockForPace,
  type RadioCadence,
  type RadioSettings
} from './radioSchedule'

const at = (level: number, foldMode = true): RadioSettings => ({
  ...DEFAULT_RADIO_SETTINGS,
  paceLevel: level,
  phraseBars: 16,
  foldMode
})

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

describe('radioCadenceOf in fold mode', () => {
  it("above fast the phrase caps are the slider's", () => {
    expect(radioCadenceOf(at(55)).phraseBars).toBe(8)
    expect(radioCadenceOf(at(65)).phraseBars).toBe(4)
    expect(radioCadenceOf(at(71)).phraseBars).toBe(0)
    expect(radioCadenceOf(at(71)).turnaroundPhraseBars).toBe(16)
  })

  it("rows per change are the slider's above fast (companions from 71, 4 at 100); one at or below", () => {
    for (let level = 0; level <= 100; level++) {
      const fold = radioCadenceOf(at(level))
      const plain = radioCadenceOf(at(level, false))
      expect(fold.rows).toBe(level <= 50 ? 1 : plain.rows)
    }
    expect(radioCadenceOf(at(100)).rows).toBe(4)
    expect(radioCadenceOf(at(80)).rows).toBe(2)
  })

  it('the hurry and the preference reach the cadence; none with fold off', () => {
    expect(radioCadenceOf(at(100)).foldHurry).toBe(1)
    expect(radioCadenceOf(at(70)).foldHurry).toBe(0)
    expect(radioCadenceOf(at(65)).foldPreferWaitLaps).toBe(1)
    expect(radioCadenceOf(at(75)).foldPreferWaitLaps).toBe(0)
    const off = radioCadenceOf(at(100, false))
    expect([off.foldPaced, off.foldPreferWaitLaps, off.foldHurry]).toEqual([false, 0, 0])
  })
})

describe('radioClockForPace in fold mode', () => {
  it('above fast a long fold interval is redrawn from the window; at or below it is kept, no draw', () => {
    const random = vi.fn(() => 0)
    const c = { ...createRadioClock(30, 0), barsElapsed: 3 }
    expect(radioClockForPace(c, radioCadenceOf(at(50)), 4, random).intervalBars).toBe(30)
    expect(radioClockForPace(c, radioCadenceOf(at(40)), 4, random).intervalBars).toBe(30)
    expect(random).not.toHaveBeenCalled()
    const ludicrous = radioClockForPace(c, radioCadenceOf(at(95)), 4, random)
    expect(ludicrous.intervalBars).toBe(1)
    expect(ludicrous.barsElapsed).toBe(3)
    expect(random).toHaveBeenCalledTimes(1)
    // 55: the window's max plus 2 laps of the snap is the most a running interval keeps
    const p55 = radioCadenceOf(at(55))
    expect(p55.foldPreferWaitLaps).toBe(2)
    const keep = p55.window.max + 2 * 4
    expect(radioClockForPace({ ...c, intervalBars: keep }, p55, 4, random).intervalBars).toBe(keep)
    expect(random).toHaveBeenCalledTimes(1)
  })
})

describe('radioCadenceBarEvery', () => {
  it('fold mode keeps a held row to its tops; everything else takes the band', () => {
    const fold = radioCadenceOf(at(95))
    const plain = radioCadenceOf(at(95, false))
    expect(radioCadenceBarEvery(fold, true)).toBeNull()
    expect(radioCadenceBarEvery(fold, false)).toBe(1)
    expect(radioCadenceBarEvery(plain, true)).toBe(1)
  })
})

describe('radioCadenceHasMidLoopLines', () => {
  it('true only when a bar line of the band falls inside the loop', () => {
    const c = (level: number): RadioCadence => radioCadenceOf(at(level))
    // every 4 bars (80-85) on a 4-bar loop: every change lands on the top anyway
    expect(c(80).barEvery).toBe(4)
    expect(radioCadenceHasMidLoopLines(c(80), 0, 4)).toBe(false)
    expect(radioCadenceHasMidLoopLines(c(80), 0, 8)).toBe(true)
    expect(radioCadenceHasMidLoopLines(c(90), 0, 4)).toBe(true)
    expect(radioCadenceHasMidLoopLines(c(95), 0, 1)).toBe(false)
    expect(radioCadenceHasMidLoopLines(c(95), 0, 2)).toBe(true)
    // a 5-bar loop at "every 4": no coarser divisor but the loop itself
    expect(radioCadenceHasMidLoopLines(c(80), 0, 5)).toBe(false)
    // below the band, no loop, a loop that is not whole bars
    expect(radioCadenceHasMidLoopLines(c(79), 0, 8)).toBe(false)
    expect(radioCadenceHasMidLoopLines(c(95), 0, 0)).toBe(false)
    expect(radioCadenceHasMidLoopLines(c(95), 0, 4.5)).toBe(false)
    expect(radioCadenceHasMidLoopLines(c(95), 0, Number.NaN)).toBe(false)
  })
})
