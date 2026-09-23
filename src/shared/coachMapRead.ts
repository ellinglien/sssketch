/**
 * The map, read back off the timeline.
 *
 * THE RULE THIS FILE SERVES (spec, "The map"): **"toggling a cell edits the
 * real clips -- there is no commit step and no second model to drift out of
 * sync."** Taken literally that forbids storing a grid and writing clips
 * from it, so the map is a PROJECTION: what a cell shows is computed from
 * the material that is actually on that row at that bar, every render.
 * CoachSection.cells records what the map was BUILT from and is not read
 * for display afterwards.
 *
 * What falls out of that, and why it is worth the arithmetic below: moving a
 * clip, resizing it, deleting it, dragging it to another row and UNDO all
 * read back into the map for free. There is nothing else to keep up to date.
 *
 * Pure over bar numbers -- no AppState, no Rifff, no React -- so the risky
 * half of this feature is tested with plain integers. The renderer's own
 * ../renderer/src/state/coachMapRows.ts turns clips and risers into the
 * MapBarWindows below; it is the only thing that knows what a clip is.
 *
 * What is deliberately NOT read here: state.mute, muteRegions, and
 * RiserClip.muted. This answers "is this row's material here", never "can
 * you hear it". A mute region is a hand-drawn hole inside a clip, and if an
 * off cell could mean one, toggling that cell back on would have to delete
 * it -- a hand-drawn edit vanishing behind one click on a grid. leftCrop IS
 * read, by the caller, because a cropped clip genuinely starts later and
 * that is presence rather than audibility.
 */

import { coachCellKey, type CoachCells } from './coachCells'

/** A half-open bar range, `startBar` inclusive and `endBar` exclusive --
 * the same convention CoachSectionBoundary's own bar numbers use. */
export interface MapBarWindow {
  startBar: number
  endBar: number
}

/**
 * How much of a pass has to carry material before the cell reads ON, as a
 * fraction of the pass. Strictly greater than, so a clip covering exactly
 * half a pass stays off.
 *
 * Half, rather than the two obvious alternatives, for reasons worth keeping:
 * "any overlap at all" lights two cells for a clip nudged a single bar, and
 * "covers the pass's downbeat" goes dark for a clip that starts one bar late
 * and plays the rest of the pass. Both are wrong in the direction the user
 * would notice. This one is wrong only about a clip that covers exactly
 * half, where there is no right answer.
 */
export const MAP_CELL_MIN_COVERAGE = 0.5

function safePhrase(phraseBars: number): number {
  return Number.isFinite(phraseBars) ? Math.max(1, Math.round(phraseBars)) : 1
}

function safePasses(passes: number): number {
  return Number.isFinite(passes) ? Math.max(1, Math.round(passes)) : 1
}

/** One pass's own bar window. */
export function passBarWindow(
  section: { startBar: number; passes: number },
  phraseBars: number,
  passIndex: number
): MapBarWindow {
  const phrase = safePhrase(phraseBars)
  const start = section.startBar + Math.max(0, Math.round(passIndex)) * phrase
  return { startBar: start, endBar: start + phrase }
}

/** The whole section's bar window -- the edge beyond which a toggle refuses
 * to act (./coachMapEdit.ts). */
export function sectionBarWindow(
  section: { startBar: number; passes: number },
  phraseBars: number
): MapBarWindow {
  const phrase = safePhrase(phraseBars)
  return {
    startBar: section.startBar,
    endBar: section.startBar + safePasses(section.passes) * phrase
  }
}

/**
 * How many bars of `[from, to)` are covered by the UNION of `windows`.
 *
 * The union, not the sum, because two clips on one row can overlap (the user
 * dragged one on top of another) and because two clips meeting end to end
 * cover a pass between them that neither covers alone. Bars are whole
 * numbers everywhere in this app, but this works on fractions too, which is
 * what lets a left-cropped clip be measured honestly.
 */
export function coveredBars(windows: readonly MapBarWindow[], from: number, to: number): number {
  if (to <= from) return 0
  const clipped: MapBarWindow[] = []
  for (const w of windows) {
    const startBar = Math.max(from, w.startBar)
    const endBar = Math.min(to, w.endBar)
    if (endBar > startBar) clipped.push({ startBar, endBar })
  }
  if (clipped.length === 0) return 0
  clipped.sort((a, b) => a.startBar - b.startBar)

  let covered = 0
  let openStart = clipped[0].startBar
  let openEnd = clipped[0].endBar
  for (let i = 1; i < clipped.length; i += 1) {
    const next = clipped[i]
    if (next.startBar > openEnd) {
      covered += openEnd - openStart
      openStart = next.startBar
      openEnd = next.endBar
    } else if (next.endBar > openEnd) {
      openEnd = next.endBar
    }
  }
  return covered + (openEnd - openStart)
}

/**
 * One row of the map, read off the material that is really there: one
 * boolean per pass of this section.
 *
 * The inverse of ./coachMapEdit.ts's planCellToggle, and tested against it
 * there -- read, toggle, apply, read again, and the grid is the one that was
 * asked for.
 */
export function readRowPasses(
  windows: readonly MapBarWindow[],
  section: { startBar: number; passes: number },
  phraseBars: number
): boolean[] {
  const phrase = safePhrase(phraseBars)
  const passes = safePasses(section.passes)
  const out: boolean[] = []
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    const w = passBarWindow(section, phrase, passIndex)
    out.push(coveredBars(windows, w.startBar, w.endBar) > phrase * MAP_CELL_MIN_COVERAGE)
  }
  return out
}

/** A read row, written back as explicit cells -- every pass, on and off, so
 * no template can overrule what is really on the timeline. Used only when
 * the phrase length changes and the map has to be re-laid (./coachMapEdit's
 * remapCellsToPhrase), never for display. */
export function rowPassesToCells(passes: readonly boolean[], path: string): CoachCells {
  const cells: CoachCells = {}
  for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
    cells[coachCellKey(passIndex, path)] = passes[passIndex]
  }
  return cells
}
