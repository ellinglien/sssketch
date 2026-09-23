/**
 * The pre-fill: what the map looks like before anybody touches it.
 *
 * THE RULE (spec, "The map arrives pre-filled, and says so"): the map
 * arrives filled in -- intro sparse, drop full, build without the hook --
 * and this **deliberately reverses** the everything-on/user-subtracts rule
 * of the superseded phase two. "The reversal is the point: eight identical
 * sections is the blank page again, and the whole value of paint-by-numbers
 * is that it does the imagining the user cannot do yet."
 *
 * Two things keep that legitimate, and both are structural rather than
 * promised: the map shows the entire song at once, so nothing is removed
 * invisibly; and everything here is COMPUTED, never stored, so a section on
 * disk carries only the cells the user changed and undoing back to full is
 * one cmd+z (which sssketchy says out loud --
 * COACH_PREFILLED_LINE_TEMPLATES).
 *
 * What it does NOT do: it never reads a waveform, a trait or a gain. Its
 * whole input is a section TYPE, the kinds Discover already tagged each stem
 * with, and a rank in the row order. Every cell it draws is a statement
 * about song structure, which is true regardless of what the user made --
 * the spec's own test for a legitimate claim.
 */

import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { cellIsOn } from './coachCells'
import { passesForTargetBars, sectionBars } from './coachPasses'
import {
  defaultSectionName,
  isSuggestedDrop,
  type CoachSection,
  type CoachSectionType
} from './coachSections'
import {
  shapeSectionTypes,
  targetBarsFor,
  type CoachLoopAnswer,
  type CoachShapeId
} from './coachShapes'
import type { ArrangeRole } from './stemRole'

/** Row order: the foundation at the top, the decoration at the bottom. The
 * same order the spec's own map is drawn in (kick, bass, lead, hook), and
 * the order the stagger below builds in. Ties keep the locked climax's own
 * order, which is Discover's, which is the order the user added them. */
export const COACH_MAP_ROW_RANK: Record<ArrangeRole, number> = {
  drums: 0,
  bass: 1,
  lead: 2,
  backing: 3,
  vocal: 4,
  fill: 5,
  textureFx: 6,
  aux: 7
}

export function coachMapRowOrder(climax: LockedClimax): LockedClimaxStem[] {
  return [...climax.stems]
    .map((stem, index) => ({ stem, index }))
    .sort((a, b) => {
      const rank = COACH_MAP_ROW_RANK[a.stem.role] - COACH_MAP_ROW_RANK[b.stem.role]
      return rank !== 0 ? rank : a.index - b.index
    })
    .map((entry) => entry.stem)
}

/** How the stems that play in a section ARRIVE across its passes. This is
 * the whole of "granular": four passes of a four-bar loop stop being four
 * identical bars because the parts come in (or go out) across them. */
export type CoachSectionArrival = 'together' | 'in' | 'out'

export const COACH_SECTION_ARRIVAL: Record<CoachSectionType, CoachSectionArrival> = {
  // An intro and a verse both build toward something, so their parts arrive.
  intro: 'in',
  verse: 'in',
  // A build is already the lift; staggering it would make it a second
  // verse. A drop is the payoff and a breakdown is a held state.
  build: 'together',
  drop: 'together',
  breakdown: 'together',
  // An outro is the only one that empties: the decoration leaves first and
  // the foundation leaves last, which is how a track ends.
  outro: 'out'
}

/** Which pass a stem of this rank arrives on (or, for an outro, how many
 * passes before the end it leaves). Spread evenly across the section, and
 * never later than its last pass -- a stem that never plays at all is not a
 * stagger, it is a drop, and the drop table decides that separately. */
function staggerOffset(rank: number, playingCount: number, passes: number): number {
  if (passes <= 1 || playingCount <= 1) return 0
  return Math.min(passes - 1, Math.floor((rank * passes) / playingCount))
}

export interface TemplateCellInput {
  type: CoachSectionType
  /** The section type the user's own loop IS (COACH_LOOP_HOME_TYPE). */
  homeType: CoachSectionType
  stem: LockedClimaxStem
  /** This stem's index among the stems that PLAY in this section, in row
   * order. */
  rank: number
  playingCount: number
  passIndex: number
  passes: number
}

/** Whether this stem plays at all in this section type. The home section --
 * the thing the user actually built -- keeps everything; every other
 * section reads the suggested-drop table, which keys off the kinds Discover
 * tagged, never stem order or channel index. */
export function templateStemPlays(
  type: CoachSectionType,
  homeType: CoachSectionType,
  stem: LockedClimaxStem
): boolean {
  if (type === homeType) return true
  return !isSuggestedDrop(type, stem)
}

/** One cell of the pre-fill. */
export function templateCellOn(input: TemplateCellInput): boolean {
  if (!templateStemPlays(input.type, input.homeType, input.stem)) return false
  if (input.type === input.homeType) return true
  const offset = staggerOffset(input.rank, input.playingCount, input.passes)
  switch (COACH_SECTION_ARRIVAL[input.type]) {
    case 'in':
      return input.passIndex >= offset
    case 'out':
      return input.passIndex < input.passes - offset
    default:
      return true
  }
}

/** The template's answer for one section, curried into the shape
 * ./coachSections.ts's sectionStemsInPass and ./coachCells.ts's cellRuns
 * both want -- so there is exactly one place that knows how a cell is
 * pre-filled. */
export function templateFallbackFor(
  section: { type: CoachSectionType; passes: number },
  homeType: CoachSectionType,
  climax: LockedClimax
): (stem: LockedClimaxStem, passIndex: number) => boolean {
  const rows = coachMapRowOrder(climax)
  const playing = rows.filter((stem) => templateStemPlays(section.type, homeType, stem))
  return (stem, passIndex) => {
    const rank = playing.findIndex((candidate) => candidate.path === stem.path)
    if (rank < 0) return false
    return templateCellOn({
      type: section.type,
      homeType,
      stem,
      rank,
      playingCount: playing.length,
      passIndex,
      passes: section.passes
    })
  }
}

/** Whether one cell of one section plays, template and overrides together.
 * The one function the map UI, the write path and the preview all call.
 *
 * Nothing in THIS plan calls it -- the write path works in runs
 * (templateFallbackFor + cellRuns) and the preview reads one pass. It is
 * here because the map grid is one `coachMapCellIsOn` per square, and
 * having the map plan reach for a second, subtly different implementation
 * is exactly how the pre-fill would start to drift. */
export function coachMapCellIsOn(
  section: CoachSection,
  homeType: CoachSectionType,
  climax: LockedClimax,
  stem: LockedClimaxStem,
  passIndex: number
): boolean {
  const fallback = templateFallbackFor(section, homeType, climax)
  return cellIsOn(section.cells, passIndex, stem.path, fallback(stem, passIndex))
}

export interface BuildCoachMapInput {
  shape: CoachShapeId
  loopIs: CoachLoopAnswer
  /** THE USER'S ANSWER, never a measurement this function took itself. */
  phraseBars: number
  climax: LockedClimax
  /** Where the first section goes -- the furthest bar anything placed
   * already reaches, measured by the caller (placedTimelineSpanBars). */
  firstStartBar: number
}

/**
 * A whole pre-filled section list, from a shape, a phrase length and an
 * answer to "what is this loop?".
 *
 * `cells` comes out EMPTY on every section, and that is the feature, not an
 * oversight: empty means "nothing overridden", so every cell reads the
 * template. See this module's own doc comment.
 */
export function buildCoachMapSections(input: BuildCoachMapInput): CoachSection[] {
  const types = shapeSectionTypes(input.shape)
  const sections: CoachSection[] = []
  const seen: { type: CoachSectionType }[] = []
  let startBar = Math.max(0, Math.round(input.firstStartBar))
  for (const [index, type] of types.entries()) {
    const ordinal = seen.filter((entry) => entry.type === type).length
    const passes = passesForTargetBars(targetBarsFor(type, ordinal), input.phraseBars)
    sections.push({
      id: `map-${index}-${type}`,
      type,
      // defaultSectionName takes only `{ type }[]`, which is all `seen` is
      // -- "drop", then "drop 2" the second time, counted by TYPE so a
      // rename never renumbers a later section.
      name: defaultSectionName(type, seen),
      passes,
      cells: {},
      startBar,
      placedGroupIds: {}
    })
    seen.push({ type })
    startBar += sectionBars(passes, input.phraseBars)
  }
  return sections
}

/** Every section laid end to end from `firstStartBar`. Called after any
 * change to a section's length. */
export function relayoutCoachSections(
  sections: readonly CoachSection[],
  phraseBars: number,
  firstStartBar: number
): CoachSection[] {
  let startBar = Math.max(0, Math.round(firstStartBar))
  return sections.map((section) => {
    const placed = { ...section, startBar }
    startBar += sectionBars(section.passes, phraseBars)
    return placed
  })
}

/**
 * The user changed his mind about the phrase length.
 *
 * "He can change it afterwards; the map RE-SIZES, it does not rebuild"
 * (spec). So: ids, types, names, cells and placedGroupIds all survive
 * untouched, and only the pass counts and the layout move. Each section
 * keeps its LENGTH IN BARS as closely as the new phrase allows, which is
 * what preserves a nudge the user made -- a verse he stretched to six
 * passes of four bars comes back as three passes of eight, not as the
 * template's four.
 */
export function resizeCoachMapToPhrase(
  sections: readonly CoachSection[],
  fromPhraseBars: number,
  toPhraseBars: number
): CoachSection[] {
  const resized = sections.map((section) => ({
    ...section,
    passes: passesForTargetBars(sectionBars(section.passes, fromPhraseBars), toPhraseBars)
  }))
  return relayoutCoachSections(resized, toPhraseBars, sections[0]?.startBar ?? 0)
}
