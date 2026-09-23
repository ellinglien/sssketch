import { describe, expect, it } from 'vitest'
import {
  MAP_CELL_MIN_COVERAGE,
  coveredBars,
  passBarWindow,
  readRowPasses,
  rowPassesToCells,
  sectionBarWindow,
  type MapBarWindow
} from './coachMapRead'

/** A 4-pass section starting at bar 8, on a 4-bar phrase: bars 8..24. */
const SECTION = { startBar: 8, passes: 4 }
const PHRASE = 4

function window(startBar: number, endBar: number): MapBarWindow {
  return { startBar, endBar }
}

/** The grid as a string, so a failure prints something readable. */
function grid(windows: readonly MapBarWindow[]): string {
  return readRowPasses(windows, SECTION, PHRASE)
    .map((on) => (on ? 'x' : '.'))
    .join('')
}

describe('the geometry', () => {
  it('gives each pass its own window', () => {
    expect(passBarWindow(SECTION, PHRASE, 0)).toEqual({ startBar: 8, endBar: 12 })
    expect(passBarWindow(SECTION, PHRASE, 3)).toEqual({ startBar: 20, endBar: 24 })
  })

  it('gives the section its whole window', () => {
    expect(sectionBarWindow(SECTION, PHRASE)).toEqual({ startBar: 8, endBar: 24 })
  })

  it('never produces a zero-length window, so nothing downstream divides by it', () => {
    expect(passBarWindow({ startBar: 0, passes: 0 }, 0, 0)).toEqual({ startBar: 0, endBar: 1 })
  })
})

describe('coveredBars', () => {
  it('unions overlapping windows rather than counting them twice', () => {
    expect(coveredBars([window(0, 3), window(2, 4)], 0, 4)).toBe(4)
  })

  it('adds two halves of a pass together', () => {
    expect(coveredBars([window(8, 10), window(10, 12)], 8, 12)).toBe(4)
  })

  it('clips to the window it was asked about', () => {
    expect(coveredBars([window(0, 100)], 8, 12)).toBe(4)
  })

  it('is zero for windows that miss entirely', () => {
    expect(coveredBars([window(0, 8), window(12, 20)], 8, 12)).toBe(0)
  })
})

describe('readRowPasses', () => {
  it('reads a clip covering the whole section as every pass on', () => {
    expect(grid([window(8, 24)])).toBe('xxxx')
  })

  it('reads nothing as every pass off', () => {
    expect(grid([])).toBe('....')
  })

  it('reads one clip of one pass as one cell', () => {
    expect(grid([window(12, 16)])).toBe('.x..')
  })

  it('reads two clips with a hole between them as two runs', () => {
    expect(grid([window(8, 12), window(16, 24)])).toBe('x.xx')
  })

  it('ignores material outside the section entirely', () => {
    expect(grid([window(0, 8), window(24, 40)])).toBe('....')
  })

  // The four ordinary timeline edits, each read straight back.
  it('reads a clip nudged one bar as the same cells', () => {
    expect(grid([window(9, 25)])).toBe('xxxx')
  })

  it('reads a clip moved a whole pass as shifted cells', () => {
    expect(grid([window(12, 16)])).toBe('.x..')
    expect(grid([window(16, 20)])).toBe('..x.')
  })

  it('reads a clip resized one pass shorter as one fewer cell', () => {
    expect(grid([window(8, 20)])).toBe('xxx.')
  })

  it('reads a deleted clip as an empty row', () => {
    expect(grid([])).toBe('....')
  })

  it('needs MORE than half a pass, so a clip covering exactly half stays off', () => {
    expect(MAP_CELL_MIN_COVERAGE).toBe(0.5)
    expect(grid([window(8, 10)])).toBe('....')
    expect(grid([window(8, 11)])).toBe('x...')
  })

  it('reads a left-cropped clip as starting where it really starts', () => {
    // The caller passes the cropped window; this is the shape it takes.
    expect(grid([window(12, 24)])).toBe('.xxx')
  })
})

describe('rowPassesToCells', () => {
  it('writes an explicit answer for every pass, on and off', () => {
    expect(rowPassesToCells([true, false], '/kick.wav')).toEqual({
      '0|/kick.wav': true,
      '1|/kick.wav': false
    })
  })
})
