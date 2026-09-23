/**
 * The map's columns when nobody built it.
 *
 * THE RULE (spec, "Columns: unnamed, one phrase each", and Elling's own
 * choice): **no inference of section boundaries.** The app does not know
 * where the verse ends and will not pretend to. A column is ONE PASS of the
 * phrase, and its header carries no text at all -- the map's existing
 * per-column tooltip already says which bar it starts at, and a header
 * saying "4" on every fourth column is a rule somebody has to maintain
 * forever for no information.
 *
 * Rejected, and recorded so it is not re-derived: inferring sections from
 * where material enters and leaves would be wrong in the way that is
 * hardest to notice, because a plausible wrong boundary looks exactly like
 * a right one. One column per bar needs no phrase at all, but a 128-bar
 * arrangement is then 128 columns of single squares and the map stops
 * being a map.
 *
 * The phrase itself is the ONE number an unguided map assumes, and it is
 * about GRID SPACING, not structure: getting it wrong makes the squares the
 * wrong size and cannot make the map say something untrue about the song.
 */

/** A column of the map, whichever kind of map it is. A guided map maps one
 * of these off each CoachSection; an unguided one gets them from
 * unguidedMapColumns below. Structurally compatible with everything in
 * coachMapRead.ts / coachMapEdit.ts, which only ever ask for
 * `{ startBar, passes }`. */
export interface ArrangementMapColumn {
  /** Stable across renders -- the map keys its columns off this. */
  id: string
  /** The user's own name for it, or **null when nobody named it**. Null is
   * not "unknown": it means this column has no name and must be drawn
   * without one. */
  name: string | null
  startBar: number
  passes: number
}

/** One loop already on the timeline, as this module needs to see it. */
export interface PlacedLoop {
  startBar: number
  barLength: number
}

function wholePhrase(phraseBars: number): number {
  if (!Number.isFinite(phraseBars) || phraseBars < 1) return 1
  return Math.max(1, Math.round(phraseBars))
}

function usableBarLength(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.round(value))
}

/** `ceil(totalBars / phraseBars)` unnamed columns of one pass each. */
export function unguidedMapColumns(totalBars: number, phraseBars: number): ArrangementMapColumn[] {
  const phrase = wholePhrase(phraseBars)
  const bars = Number.isFinite(totalBars) ? Math.max(0, totalBars) : 0
  const count = Math.ceil(bars / phrase)
  const columns: ArrangementMapColumn[] = []
  for (let index = 0; index < count; index += 1) {
    columns.push({ id: `bar-${index * phrase}`, name: null, startBar: index * phrase, passes: 1 })
  }
  return columns
}

/** The bar length of the EARLIEST placed loop -- a rifff IS a loop, and its
 * barLength is the nominal phrase without measuring anything. A startBar tie
 * goes to the LONGER loop: too large a phrase draws fewer, bigger squares,
 * where too small a one draws a wall of them. null when nothing usable is
 * placed, which the caller reads as "there is no map to draw". */
export function unguidedPhraseBars(placed: readonly PlacedLoop[]): number | null {
  let best: { startBar: number; barLength: number } | null = null
  for (const loop of placed) {
    const barLength = usableBarLength(loop.barLength)
    if (barLength === null) continue
    if (!Number.isFinite(loop.startBar)) continue
    if (
      best === null ||
      loop.startBar < best.startBar ||
      (loop.startBar === best.startBar && barLength > best.barLength)
    ) {
      best = { startBar: loop.startBar, barLength }
    }
  }
  return best?.barLength ?? null
}

/** The distinct bar lengths ACTUALLY PRESENT, ascending. Facts about the
 * arrangement rather than guesses about it, which is the property that makes
 * offering them allowed at all. */
export function distinctPlacedBarLengths(placed: readonly PlacedLoop[]): number[] {
  const lengths = new Set<number>()
  for (const loop of placed) {
    const barLength = usableBarLength(loop.barLength)
    if (barLength !== null) lengths.add(barLength)
  }
  return [...lengths].sort((a, b) => a - b)
}
