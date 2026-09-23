/**
 * Where a bar sits on the arrangement map, and which bar a click on it
 * means. Both directions of one mapping.
 *
 * WHY THIS IS NOT `bar * ppb`. On the timeline, x is linear in bars and one
 * multiplication answers everything. The map is not a timeline: a column is
 * one SECTION, a cell inside it is one PASS of the phrase, and between two
 * columns there is a gap -- wider at a boundary that carries a tension move.
 * So the same number of bars occupies different widths depending on which
 * section it lands in, and bar -> x has to walk the sections. That walk is
 * here, as plain arithmetic over plain numbers, so it can be tested without
 * a DOM: the component hands over what it is about to draw (a column's
 * passes and the trailing space after it) and gets back one span per
 * section.
 *
 * The two functions are exact inverses over the grid -- see the round-trip
 * tests, which are the reason this module exists as its own file rather
 * than as two helpers inside ArrangementMap.tsx. The one tie is a section
 * boundary: the last bar of one section and the first of the next are the
 * same bar drawn at two x's, and bar -> x resolves it toward the LATER
 * section, because the marker belongs to what is about to play.
 *
 * Off the map is honest rather than clamped: a bar before the first section
 * (or past the last, or in a hole between two sections that are not laid
 * end to end) has no x, and the caller draws no marker rather than parking
 * one at the edge, which would be indistinguishable from really being
 * there. A CLICK is the other way round -- it is a request, not a report --
 * so it clamps into the grid, and a click in the gap between two columns
 * snaps to the nearer of the two edges.
 */

/** One section, as the map is about to draw it. */
export interface CoachMapColumn {
  /** Its first bar on the timeline (CoachSection.startBar). */
  startBar: number
  /** How many bars it covers -- sectionBars(passes, phraseBars). */
  bars: number
  /** How many cells it draws, one per pass. */
  passes: number
  /** Px between this column's last cell and the next column's first:
   * whatever padding, divider and margin the component puts there. */
  trailing: number
}

/** One section's cells, measured from the grid's own origin (the left edge
 * of the first column's first cell -- the row headers are not in it). */
export interface CoachMapSpan {
  startBar: number
  /** startBar + bars. The next section's startBar, when they are laid end
   * to end. */
  endBar: number
  /** Left edge of the first cell. */
  x: number
  /** First cell's left edge to last cell's right edge, gaps between cells
   * included and the trailing gap excluded. */
  width: number
}

function safePasses(passes: number): number {
  if (!Number.isFinite(passes)) return 1
  return Math.max(1, Math.round(passes))
}

/** A column is its cells plus the gaps BETWEEN them -- there is no gap
 * after the last cell, which is what makes this off-by-one worth a named
 * function rather than an inline multiply. */
export function coachMapColumnWidth(passes: number, cellWidth: number, cellGap: number): number {
  const count = safePasses(passes)
  return count * cellWidth + (count - 1) * cellGap
}

/** Walks the columns left to right, turning each into the bar range it
 * covers and the pixels it occupies. */
export function coachMapSpans(
  columns: readonly CoachMapColumn[],
  cellWidth: number,
  cellGap: number
): CoachMapSpan[] {
  const spans: CoachMapSpan[] = []
  let x = 0
  for (const column of columns) {
    const width = coachMapColumnWidth(column.passes, cellWidth, cellGap)
    const bars = Number.isFinite(column.bars) ? Math.max(0, column.bars) : 0
    spans.push({ startBar: column.startBar, endBar: column.startBar + bars, x, width })
    x += width + (Number.isFinite(column.trailing) ? column.trailing : 0)
  }
  return spans
}

/** Where to draw the marker for `bar`, or null when that bar is not on the
 * map at all. */
export function coachMapBarToX(spans: readonly CoachMapSpan[], bar: number): number | null {
  if (!Number.isFinite(bar)) return null
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    // Before this column's first bar: either before the map entirely, or
    // in a hole between two columns. Neither is on the grid.
    if (bar < span.startBar) return null
    const last = index === spans.length - 1
    if (bar < span.endBar || (last && bar === span.endBar)) {
      const bars = span.endBar - span.startBar
      const fraction = bars > 0 ? (bar - span.startBar) / bars : 0
      return span.x + fraction * span.width
    }
  }
  return null
}

/** Which bar a click at `x` means. Clamped into the grid, so a click near
 * an edge always seeks somewhere; null only when there is no map. */
export function coachMapXToBar(spans: readonly CoachMapSpan[], x: number): number | null {
  if (!Number.isFinite(x) || spans.length === 0) return null
  const first = spans[0]
  const last = spans[spans.length - 1]
  if (x <= first.x) return first.startBar
  if (x >= last.x + last.width) return last.endBar
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    if (x > span.x + span.width) continue
    if (x >= span.x) {
      const fraction = span.width > 0 ? (x - span.x) / span.width : 0
      return span.startBar + fraction * (span.endBar - span.startBar)
    }
    // In the gap before this column -- the divider, its padding and the
    // margin. Snap to whichever edge is nearer; when the two sections are
    // laid end to end (the normal case) both answers are the same bar.
    const previous = spans[index - 1]
    const previousRight = previous.x + previous.width
    return x - previousRight <= span.x - x ? previous.endBar : span.startBar
  }
  return last.endBar
}
