import { describe, expect, it } from 'vitest'
import {
  coachMapBarToX,
  coachMapColumnWidth,
  coachMapSpans,
  coachMapXToBar,
  type CoachMapColumn
} from './coachMapGeometry'

const CELL_WIDTH = 16
const CELL_GAP = 1

/** Three sections laid end to end on a 4-bar phrase, with an awkward
 * middle one, and a wider trailing gap after the first (what the map draws
 * at a boundary that has a tension move applied). */
function columns(): CoachMapColumn[] {
  return [
    { startBar: 0, bars: 8, passes: 2, trailing: 17 },
    { startBar: 8, bars: 12, passes: 3, trailing: 7 },
    { startBar: 20, bars: 16, passes: 4, trailing: 7 }
  ]
}

describe('coachMapColumnWidth', () => {
  it('is the cells plus the gaps between them, not after the last one', () => {
    expect(coachMapColumnWidth(4, CELL_WIDTH, CELL_GAP)).toBe(4 * 16 + 3)
    expect(coachMapColumnWidth(1, CELL_WIDTH, CELL_GAP)).toBe(16)
  })

  it('never goes below one cell', () => {
    expect(coachMapColumnWidth(0, CELL_WIDTH, CELL_GAP)).toBe(16)
    expect(coachMapColumnWidth(Number.NaN, CELL_WIDTH, CELL_GAP)).toBe(16)
  })
})

describe('coachMapSpans', () => {
  it('walks the sections, each one starting after the previous one plus its trailing gap', () => {
    const spans = coachMapSpans(columns(), CELL_WIDTH, CELL_GAP)
    expect(spans).toEqual([
      { startBar: 0, endBar: 8, x: 0, width: 33 },
      { startBar: 8, endBar: 20, x: 33 + 17, width: 50 },
      { startBar: 20, endBar: 36, x: 33 + 17 + 50 + 7, width: 67 }
    ])
  })

  it('is empty for a project with no sections', () => {
    expect(coachMapSpans([], CELL_WIDTH, CELL_GAP)).toEqual([])
  })
})

describe('coachMapBarToX', () => {
  const spans = coachMapSpans(columns(), CELL_WIDTH, CELL_GAP)

  it('puts the first bar at the grid origin and the last at the right edge', () => {
    expect(coachMapBarToX(spans, 0)).toBe(0)
    expect(coachMapBarToX(spans, 36)).toBe(107 + 67)
  })

  it('puts a section boundary bar at that section first cell, not the previous last', () => {
    expect(coachMapBarToX(spans, 8)).toBe(50)
    expect(coachMapBarToX(spans, 20)).toBe(107)
  })

  it('moves smoothly inside a section rather than snapping to cells', () => {
    // half way through an 8-bar, 33px-wide section
    expect(coachMapBarToX(spans, 4)).toBeCloseTo(16.5, 10)
  })

  it('draws nothing for a bar outside the mapped range', () => {
    expect(coachMapBarToX(spans, -1)).toBeNull()
    expect(coachMapBarToX(spans, 36.5)).toBeNull()
    expect(coachMapBarToX(spans, Number.NaN)).toBeNull()
  })

  it('draws nothing for a bar in a hole between two sections', () => {
    const holed = coachMapSpans(
      [
        { startBar: 0, bars: 8, passes: 2, trailing: 7 },
        { startBar: 16, bars: 8, passes: 2, trailing: 7 }
      ],
      CELL_WIDTH,
      CELL_GAP
    )
    expect(coachMapBarToX(holed, 12)).toBeNull()
  })

  it('draws nothing when there is no map', () => {
    expect(coachMapBarToX([], 0)).toBeNull()
  })
})

describe('coachMapXToBar', () => {
  const spans = coachMapSpans(columns(), CELL_WIDTH, CELL_GAP)

  it('clamps a click before the grid to the first bar and past it to the last', () => {
    expect(coachMapXToBar(spans, -40)).toBe(0)
    expect(coachMapXToBar(spans, 9999)).toBe(36)
  })

  it('snaps a click in the gap between two sections to the nearer edge', () => {
    // the gap after section one runs from x=33 to x=50
    expect(coachMapXToBar(spans, 35)).toBe(8) // nearer the end of section one
    expect(coachMapXToBar(spans, 48)).toBe(8) // nearer the start of section two
    // both edges are the same bar when the sections are contiguous, so use a
    // holed map to prove it really picks the nearer one
    const holed = coachMapSpans(
      [
        { startBar: 0, bars: 8, passes: 2, trailing: 7 },
        { startBar: 16, bars: 8, passes: 2, trailing: 7 }
      ],
      CELL_WIDTH,
      CELL_GAP
    )
    expect(coachMapXToBar(holed, 34)).toBe(8)
    expect(coachMapXToBar(holed, 39)).toBe(16)
  })

  it('has no answer when there is no map', () => {
    expect(coachMapXToBar([], 12)).toBeNull()
    expect(coachMapXToBar(spans, Number.NaN)).toBeNull()
  })
})

/** THE TEST THAT MATTERS. The marker is drawn with bar -> x and a click is
 * read with x -> bar, so the two have to be one mapping read in both
 * directions: a playhead the user drags to a cell must come back at that
 * cell, not one pixel left of it. */
describe('bar -> x -> bar round trip', () => {
  const spans = coachMapSpans(columns(), CELL_WIDTH, CELL_GAP)

  it('returns every bar of the map, whole and fractional, unchanged', () => {
    for (let bar = 0; bar <= 36; bar += 0.25) {
      const x = coachMapBarToX(spans, bar)
      expect(x).not.toBeNull()
      expect(coachMapXToBar(spans, x as number)).toBeCloseTo(bar, 9)
    }
  })

  // Everywhere except one seam: a section's last bar and the next
  // section's first bar are the SAME bar, drawn at two x's, and bar -> x
  // resolves that tie toward the later section (the marker belongs to the
  // section that is about to play). So the right edge of every section but
  // the last is deliberately left out here -- it is the one x the round
  // trip cannot return, by definition rather than by rounding.
  it('returns every x on the grid unchanged, apart from the shared seam', () => {
    spans.forEach((span, index) => {
      const last = index === spans.length - 1
      const end = span.x + span.width - (last ? 0 : 0.5)
      for (let x = span.x; x <= end; x += 0.5) {
        const bar = coachMapXToBar(spans, x)
        expect(bar).not.toBeNull()
        expect(coachMapBarToX(spans, bar as number)).toBeCloseTo(x, 9)
      }
    })
  })

  it('round trips on an odd phrase length, where the cells do not divide the bars evenly', () => {
    const odd = coachMapSpans(
      [
        { startBar: 0, bars: 18, passes: 3, trailing: 7 },
        { startBar: 18, bars: 30, passes: 5, trailing: 7 }
      ],
      CELL_WIDTH,
      CELL_GAP
    )
    for (let bar = 0; bar <= 48; bar += 0.5) {
      const x = coachMapBarToX(odd, bar)
      expect(x).not.toBeNull()
      expect(coachMapXToBar(odd, x as number)).toBeCloseTo(bar, 9)
    }
  })
})
