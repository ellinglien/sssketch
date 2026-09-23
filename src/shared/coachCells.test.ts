import { describe, expect, it } from 'vitest'
import {
  cellIsOn,
  cellRuns,
  coachCellKey,
  parseCoachCellKey,
  runsToCells,
  sanitiseCoachCells,
  setCell,
  setStemAcrossPasses,
  type CoachCells
} from './coachCells'

describe('the cell key', () => {
  it('round-trips a pass and a path', () => {
    const key = coachCellKey(3, '/stems/kick 01.wav')
    expect(parseCoachCellKey(key)).toEqual({ passIndex: 3, path: '/stems/kick 01.wav' })
  })

  it('survives a path containing the separator', () => {
    const key = coachCellKey(0, '/odd|name.wav')
    expect(parseCoachCellKey(key)).toEqual({ passIndex: 0, path: '/odd|name.wav' })
  })

  it('refuses a key it did not write', () => {
    expect(parseCoachCellKey('nonsense')).toBeNull()
    expect(parseCoachCellKey('x|/a.wav')).toBeNull()
    expect(parseCoachCellKey('-1|/a.wav')).toBeNull()
  })
})

describe('cellIsOn', () => {
  it('falls back to the template for a cell nobody touched', () => {
    expect(cellIsOn({}, 0, '/a.wav', true)).toBe(true)
    expect(cellIsOn({}, 0, '/a.wav', false)).toBe(false)
  })

  it('lets an explicit answer beat the template in both directions', () => {
    const off = setCell({}, 0, '/a.wav', false)
    expect(cellIsOn(off, 0, '/a.wav', true)).toBe(false)
    const on = setCell({}, 0, '/a.wav', true)
    expect(cellIsOn(on, 0, '/a.wav', false)).toBe(true)
  })

  it('keeps an override for a pass that is out of range right now', () => {
    // Shrink then grow: the edit was never destroyed.
    const cells = setCell({}, 5, '/a.wav', false)
    expect(cellIsOn(cells, 5, '/a.wav', true)).toBe(false)
  })
})

describe('setStemAcrossPasses', () => {
  it('writes one explicit answer per pass', () => {
    const cells = setStemAcrossPasses({}, 3, '/a.wav', false)
    expect(Object.keys(cells)).toHaveLength(3)
    for (let pass = 0; pass < 3; pass += 1) {
      expect(cellIsOn(cells, pass, '/a.wav', true)).toBe(false)
    }
  })

  it('leaves every other stem alone', () => {
    const cells = setStemAcrossPasses(setCell({}, 0, '/b.wav', false), 2, '/a.wav', true)
    expect(cellIsOn(cells, 0, '/b.wav', true)).toBe(false)
  })
})

describe('cellRuns', () => {
  const always = (): boolean => true
  const never = (): boolean => false

  it('collapses contiguous on-passes into one run', () => {
    let cells: CoachCells = {}
    cells = setCell(cells, 0, '/a.wav', false)
    expect(cellRuns(cells, 4, '/a.wav', always)).toEqual([{ startPass: 1, passCount: 3 }])
  })

  it('reports two runs for a stem that leaves and comes back', () => {
    let cells: CoachCells = {}
    cells = setCell(cells, 1, '/a.wav', false)
    expect(cellRuns(cells, 4, '/a.wav', always)).toEqual([
      { startPass: 0, passCount: 1 },
      { startPass: 2, passCount: 2 }
    ])
  })

  it('reports nothing for a stem that never plays', () => {
    expect(cellRuns({}, 4, '/a.wav', never)).toEqual([])
  })

  it('reports one whole-section run for a stem that always plays', () => {
    expect(cellRuns({}, 4, '/a.wav', always)).toEqual([{ startPass: 0, passCount: 4 }])
  })

  it('asks the template per PASS, so a staggered arrival reads as one run', () => {
    // The template brings this stem in on pass 2 and nothing overrides it.
    const arrivesLate = (passIndex: number): boolean => passIndex >= 2
    expect(cellRuns({}, 4, '/a.wav', arrivesLate)).toEqual([{ startPass: 2, passCount: 2 }])
  })
})

describe('runsToCells', () => {
  const always = (): boolean => true
  const never = (): boolean => false

  it('is the exact inverse of cellRuns', () => {
    let cells: CoachCells = {}
    cells = setCell(cells, 1, '/a.wav', false)
    cells = setCell(cells, 3, '/a.wav', false)
    const runs = cellRuns(cells, 5, '/a.wav', always)
    const rebuilt = runsToCells(runs, 5, '/a.wav')
    // Explicit in both directions, so NO template can change the answer.
    expect(cellRuns(rebuilt, 5, '/a.wav', always)).toEqual(runs)
    expect(cellRuns(rebuilt, 5, '/a.wav', never)).toEqual(runs)
  })

  it('writes an explicit answer for every pass, so no template can change it', () => {
    expect(Object.keys(runsToCells([{ startPass: 1, passCount: 2 }], 4, '/a.wav'))).toHaveLength(4)
  })
})

describe('sanitiseCoachCells', () => {
  it('keeps only real keys with real booleans', () => {
    expect(sanitiseCoachCells({ '0|/a.wav': false, 'x|/b.wav': true, '1|/c.wav': 'yes' })).toEqual({
      '0|/a.wav': false
    })
  })

  it('survives anything a hand-edited file can contain', () => {
    expect(sanitiseCoachCells(null)).toEqual({})
    expect(sanitiseCoachCells([1, 2, 3])).toEqual({})
  })
})
