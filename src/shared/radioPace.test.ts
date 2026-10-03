import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RADIO_PACE_LEVEL,
  RADIO_PACE_ANCHORS,
  RADIO_PACE_LABEL,
  RADIO_PACE_ROWS_MAX,
  RADIO_PACE_TOOLTIP,
  nextRadioPaceAnchor,
  normalizeRadioPaceLevel,
  radioPaceLabel,
  radioPaceLevelFromLegacy,
  radioPacePhraseBars,
  radioPaceProfile,
  radioPaceRowsThisChange
} from './radioPace'
import { RADIO_PACE_BARS, RADIO_PACE_OPTIONS } from './radioSchedule'

describe('the pace slider anchors', () => {
  it("slow, mid and fast reproduce today's windows exactly, one row, the runtime's phrase", () => {
    for (const word of RADIO_PACE_OPTIONS) {
      const p = radioPaceProfile(RADIO_PACE_ANCHORS[word])
      expect(p.window).toEqual(RADIO_PACE_BARS[word])
      expect(p.phraseCap).toBeNull()
      expect(p.barEvery).toBeNull()
      expect(p.rows).toBe(1)
    }
  })

  it('defaults to mid; copy is lowercase', () => {
    expect(DEFAULT_RADIO_PACE_LEVEL).toBe(RADIO_PACE_ANCHORS.mid)
    expect(RADIO_PACE_LABEL).toBe('pace')
    expect(RADIO_PACE_TOOLTIP).toBe(RADIO_PACE_TOOLTIP.toLowerCase())
  })
})

describe('radioPaceProfile', () => {
  it('never slows down as the level rises: both edges of the window are non-increasing', () => {
    let prev = radioPaceProfile(0).window
    for (let l = 1; l <= 100; l++) {
      const w = radioPaceProfile(l).window
      expect(w.min).toBeLessThanOrEqual(prev.min)
      expect(w.max).toBeLessThanOrEqual(prev.max)
      expect(w.min).toBeGreaterThanOrEqual(1)
      expect(w.max).toBeGreaterThanOrEqual(w.min)
      expect(Number.isInteger(w.min) && Number.isInteger(w.max)).toBe(true)
      prev = w
    }
  })

  it('the phrase cap steps 8 -> 4 -> every loop top above fast', () => {
    expect(radioPaceProfile(51).phraseCap).toBe(8)
    expect(radioPaceProfile(60).phraseCap).toBe(8)
    expect(radioPaceProfile(61).phraseCap).toBe(4)
    expect(radioPaceProfile(70).phraseCap).toBe(4)
    expect(radioPaceProfile(71).phraseCap).toBe(0)
    expect(radioPaceProfile(100).phraseCap).toBe(0)
  })

  it('mid-loop bar lines only from 80: every 4, then 2, then 1 bar', () => {
    expect(radioPaceProfile(79).barEvery).toBeNull()
    expect(radioPaceProfile(80).barEvery).toBe(4)
    expect(radioPaceProfile(86).barEvery).toBe(4)
    expect(radioPaceProfile(87).barEvery).toBe(2)
    expect(radioPaceProfile(94).barEvery).toBe(1)
    expect(radioPaceProfile(100).barEvery).toBe(1)
  })

  it('rows per change: 1 up to 70, then up to 4 at 100', () => {
    expect(radioPaceProfile(70).rows).toBe(1)
    expect(radioPaceProfile(80).rows).toBeCloseTo(2)
    expect(radioPaceProfile(90).rows).toBeCloseTo(3)
    expect(radioPaceProfile(100).rows).toBe(RADIO_PACE_ROWS_MAX)
  })

  it('the window at in-between levels, against the spec table', () => {
    const table: [number, number, number][] = [
      [12, 14, 28],
      [38, 5, 10],
      [55, 2, 5],
      [60, 2, 4],
      [65, 1, 3],
      [70, 1, 2],
      [75, 1, 2],
      [80, 1, 2],
      [85, 1, 1]
    ]
    for (const [level, min, max] of table)
      expect(radioPaceProfile(level).window, `level ${level}`).toEqual({ min, max })
  })

  it('band boundaries: grid 2 at 93, rows start rising at 71', () => {
    expect(radioPaceProfile(93).barEvery).toBe(2)
    expect(radioPaceProfile(71).rows).toBeCloseTo(1.1)
  })

  it('normalises the level first', () => {
    expect(radioPaceProfile(-5)).toEqual(radioPaceProfile(0))
    expect(radioPaceProfile(400)).toEqual(radioPaceProfile(100))
    expect(radioPaceProfile(49.6).level).toBe(50)
  })
})

describe('normalizeRadioPaceLevel', () => {
  it('clamps and rounds; anything else is the fallback', () => {
    expect(normalizeRadioPaceLevel(37.4)).toBe(37)
    expect(normalizeRadioPaceLevel(-1)).toBe(0)
    expect(normalizeRadioPaceLevel(101)).toBe(100)
    expect(normalizeRadioPaceLevel('50')).toBe(DEFAULT_RADIO_PACE_LEVEL)
    expect(normalizeRadioPaceLevel(NaN, 50)).toBe(50)
  })
})

describe('radioPacePhraseBars', () => {
  it("the runtime's phrase up to fast, then capped; a base of 0 stays 0", () => {
    expect(radioPacePhraseBars(radioPaceProfile(50), 16)).toBe(16)
    expect(radioPacePhraseBars(radioPaceProfile(50), 32)).toBe(32)
    expect(radioPacePhraseBars(radioPaceProfile(55), 16)).toBe(8)
    expect(radioPacePhraseBars(radioPaceProfile(55), 32)).toBe(8)
    expect(radioPacePhraseBars(radioPaceProfile(65), 16)).toBe(4)
    expect(radioPacePhraseBars(radioPaceProfile(75), 16)).toBe(0)
    expect(radioPacePhraseBars(radioPaceProfile(55), 0)).toBe(0)
    expect(radioPacePhraseBars(radioPaceProfile(0), 0)).toBe(0)
  })
})

describe('radioPaceRowsThisChange', () => {
  it('never calls random while rows is whole', () => {
    const random = vi.fn(() => 0.5)
    expect(radioPaceRowsThisChange(radioPaceProfile(50), random)).toBe(1)
    expect(radioPaceRowsThisChange(radioPaceProfile(100), random)).toBe(4)
    expect(random).not.toHaveBeenCalled()
  })

  it('the fraction is the chance of one more row', () => {
    const p = radioPaceProfile(85) // 2.5 rows
    expect(radioPaceRowsThisChange(p, () => 0.49)).toBe(3)
    expect(radioPaceRowsThisChange(p, () => 0.5)).toBe(2)
  })
})

describe('radioPaceLabel', () => {
  it('words at the anchors and through ludicrous; bar lines in the mid-loop band; the window between', () => {
    expect(radioPaceLabel(0)).toBe('slow')
    expect(radioPaceLabel(25)).toBe('mid')
    expect(radioPaceLabel(50)).toBe('fast')
    expect(radioPaceLabel(90)).toBe('ludicrous')
    expect(radioPaceLabel(100)).toBe('ludicrous')
    expect(radioPaceLabel(80)).toBe('every 4 bars')
    expect(radioPaceLabel(88)).toBe('every 2 bars')
    expect(radioPaceLabel(89)).toBe('every 2 bars')
    expect(radioPaceLabel(60)).toBe('2-4 bars')
    expect(radioPaceLabel(12)).toMatch(/^\d+-\d+ bars$/)
  })
})

describe('radioPaceLevelFromLegacy', () => {
  it('a preset word is its anchor, with or without its own window', () => {
    expect(radioPaceLevelFromLegacy('slow')).toBe(0)
    expect(radioPaceLevelFromLegacy('mid', { min: 8, max: 16 })).toBe(25)
    expect(radioPaceLevelFromLegacy('fast', { ...RADIO_PACE_BARS.fast })).toBe(50)
    expect(radioPaceLevelFromLegacy(undefined)).toBe(DEFAULT_RADIO_PACE_LEVEL)
    expect(radioPaceLevelFromLegacy('nonsense', 'nonsense')).toBe(DEFAULT_RADIO_PACE_LEVEL)
  })

  it("a hand-tuned window is the nearest level at or below fast; another preset's window is that preset", () => {
    expect(radioPaceLevelFromLegacy('mid', { min: 3, max: 6 })).toBe(50)
    const between = radioPaceLevelFromLegacy('mid', { min: 12, max: 24 })
    expect(between).toBeGreaterThan(0)
    expect(between).toBeLessThan(25)
    expect(radioPaceLevelFromLegacy('fast', { min: 1, max: 2 })).toBe(50)
    expect(radioPaceLevelFromLegacy('slow', { min: 64, max: 64 })).toBe(0)
  })
})

describe('nextRadioPaceAnchor', () => {
  it('slow -> mid -> fast -> ludicrous -> slow, from wherever the level is', () => {
    expect(nextRadioPaceAnchor(0)).toBe(25)
    expect(nextRadioPaceAnchor(25)).toBe(50)
    expect(nextRadioPaceAnchor(50)).toBe(90)
    expect(nextRadioPaceAnchor(90)).toBe(0)
    expect(nextRadioPaceAnchor(33)).toBe(50)
    expect(nextRadioPaceAnchor(95)).toBe(0)
  })
})
