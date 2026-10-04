// The desktop's payoff helpers (spec 2026-10-03-radio-anointed-stems-design 4.7, radioBuildSize.ts):
// a still-picking arc add, the slow pace's reach, the late decision, stems never twice.
import { describe, expect, it } from 'vitest'
import {
  NO_CHANGE_FORECAST,
  PAYOFF_DECIDE_MARGIN_BARS,
  radioBuildTier,
  radioDistinctStemRows,
  radioForecastWithArcAdd,
  radioPayoffDecidesNow,
  radioPayoffInReach,
  radioPayoffOf,
  type RadioChangeForecast
} from './radioBuildSize'
import { radioForecastWithUncertainRows, radioWrapBeforeLastLap } from './radioBuildForecast'

const F = (o: Partial<RadioChangeForecast> = {}): RadioChangeForecast => ({
  ...NO_CHANGE_FORECAST,
  ...o
})

describe('radioForecastWithArcAdd', () => {
  it('a ready add is a row, an arc step and maybe the low end: large', () => {
    const f = radioForecastWithArcAdd(F(), { ready: true, lowEnd: true })
    expect(f).toEqual(F({ rows: 1, arcStep: 'add', lowEndReturn: true }))
    expect(radioBuildTier(f)).toBe('large')
  })
  it('a still-picking add promises a medium change, never a large one', () => {
    for (const rows of [0, 1, 2]) {
      const f = radioForecastWithArcAdd(F({ rows }), { ready: false, lowEnd: true })
      expect(radioBuildTier(f)).toBe('medium')
      expect(radioPayoffOf(f)).toBe('medium')
      expect(f.arcStep).toBeNull()
      expect(f.lowEndReturn).toBe(false)
    }
  })
  it('what is large without it stays large', () => {
    const f = radioForecastWithArcAdd(F({ rows: 3 }), { ready: false, lowEnd: false })
    expect(radioBuildTier(f)).toBe('large')
  })
})

describe('radioPayoffInReach', () => {
  const o = { barBand: false, barsToDue: 0, aheadBars: 8, phraseBars: 16 }
  it('in the bar band: always', () => {
    expect(radioPayoffInReach({ ...o, barBand: true, barsToDue: 1000 })).toBe(true)
  })
  it('below it: radio due within a phrase of the top', () => {
    expect(radioPayoffInReach(o)).toBe(true)
    expect(radioPayoffInReach({ ...o, barsToDue: 24 })).toBe(true)
    expect(radioPayoffInReach({ ...o, barsToDue: 24.5 })).toBe(false)
    expect(radioPayoffInReach({ ...o, barsToDue: 48 })).toBe(false)
  })
  it('a non-finite count is out of reach', () => {
    expect(radioPayoffInReach({ ...o, barsToDue: Number.NaN })).toBe(false)
  })
})

describe('radioPayoffDecidesNow', () => {
  it('waits until the top is within the lead plus the margin', () => {
    expect(radioPayoffDecidesNow(4, 1.25)).toBe(false)
    expect(radioPayoffDecidesNow(1.25 + PAYOFF_DECIDE_MARGIN_BARS + 0.01, 1.25)).toBe(false)
    expect(radioPayoffDecidesNow(1.25 + PAYOFF_DECIDE_MARGIN_BARS, 1.25)).toBe(true)
    expect(radioPayoffDecidesNow(0.1, 1.25)).toBe(true)
  })
})

describe('radioDistinctStemRows', () => {
  it('keeps the first row of each stem, never a taken one, never a row with none', () => {
    const rows = [
      { slotId: 'a', stemCID: 's1' },
      { slotId: 'b', stemCID: 's2' },
      { slotId: 'c', stemCID: 's1' },
      { slotId: 'd', stemCID: 's3' },
      { slotId: 'e', stemCID: null }
    ]
    expect(radioDistinctStemRows(rows, ['s3']).map((r) => r.slotId)).toEqual(['a', 'b'])
    expect(radioDistinctStemRows([], ['s1'])).toEqual([])
  })
})

describe('radioForecastWithUncertainRows', () => {
  it('rows still warming raise the change to medium at most', () => {
    expect(radioForecastWithUncertainRows(F(), 0)).toEqual(F())
    expect(radioForecastWithUncertainRows(F(), 1).rows).toBe(1)
    expect(radioForecastWithUncertainRows(F(), 3).rows).toBe(2)
    expect(radioForecastWithUncertainRows(F({ rows: 1 }), 2).rows).toBe(2)
    expect(radioBuildTier(radioForecastWithUncertainRows(F({ rows: 1 }), 5))).toBe('medium')
    expect(radioForecastWithUncertainRows(F({ rows: 3 }), 2).rows).toBe(3)
  })
})

describe('radioWrapBeforeLastLap', () => {
  it('the wrap whose next wrap starts the phrase last lap', () => {
    // a 4-lap phrase: laps 0 1 2 3; the roll at the wrap into lap 3, so this is the wrap into 2
    expect([0, 1, 2, 3].map((lap) => radioWrapBeforeLastLap(lap, 4))).toEqual([
      false,
      false,
      true,
      false
    ])
    expect([0, 1].map((lap) => radioWrapBeforeLastLap(lap, 2))).toEqual([true, false])
    // one lap a phrase: every wrap starts the last lap, so every wrap is the one before it
    expect(radioWrapBeforeLastLap(0, 1)).toBe(true)
  })
})
