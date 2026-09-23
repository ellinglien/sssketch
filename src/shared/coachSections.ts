/**
 * Phase two, as plain data: what a section IS, how long it is by default,
 * which stems that kind of section usually loses, and what usually follows
 * it.
 *
 * THE RULE THIS FILE EXISTS TO ENCODE (spec, "Phase 2 -- sections, one at a
 * time"): **everything is on, and the user subtracts.** A section is the
 * full climax loop until the person building it says otherwise. The table
 * below is the ONE place in this whole feature where the app asserts
 * anything musical, and it is kept legitimate by being a MARK rather than a
 * change: suggestedDropPaths only ever answers "which stems would this
 * section type usually lose", and nothing here ever puts one of those paths
 * into a draft. Applying them is a click (dropSuggestedCoachSectionStems,
 * ./coachPhase2.ts). A suggestion you can ignore costs nothing when it is
 * wrong; a pre-applied default is a decision you have to notice and undo.
 *
 * So: a fresh draft's droppedPaths is ALWAYS empty. If you are reading this
 * because you are about to seed it from the table, don't.
 *
 * The flags key off the kinds DISCOVER tagged each stem with, carried on the
 * locked climax (LockedClimaxStem.kinds) -- never stem order, never channel
 * index, which the spec rules out twice.
 */

import { kindsCoverSet, type LockedClimax, type LockedClimaxStem } from './coachClimax'
import type { DiscoverSlotKind } from './discoverSlotKind'

export type CoachSectionType = 'intro' | 'build' | 'drop' | 'breakdown' | 'outro'

/** What the section panel's own buttons do, as data rather than as
 * callbacks -- so a step row can list them under "stuck?" and the bubble's
 * "do it for me" can run one without src/shared/ knowing React exists. */
export type CoachSectionOp = 'drop-suggested' | 'preview' | 'place'

export interface CoachSectionTypeDef {
  id: CoachSectionType
  /** Shown on the panel's buttons and used as a section's default name.
   * Lowercase, like all UI copy in this app. */
  label: string
  /** A starting length, in bars, nudgeable by +/-4 and +/-8. Always a whole
   * number of ARRANGE_STEP_BARS (4), so a guided section lands on the same
   * boundaries auto-arrange and draw-arrange use. */
  defaultBars: number
}

const COACH_SECTION_TYPE_BY_ID: Record<CoachSectionType, CoachSectionTypeDef> = {
  intro: { id: 'intro', label: 'intro', defaultBars: 8 },
  build: { id: 'build', label: 'build', defaultBars: 16 },
  drop: { id: 'drop', label: 'drop', defaultBars: 16 },
  breakdown: { id: 'breakdown', label: 'breakdown', defaultBars: 8 },
  outro: { id: 'outro', label: 'outro', defaultBars: 8 }
}

export const COACH_SECTION_TYPES: readonly CoachSectionTypeDef[] = [
  COACH_SECTION_TYPE_BY_ID.intro,
  COACH_SECTION_TYPE_BY_ID.build,
  COACH_SECTION_TYPE_BY_ID.drop,
  COACH_SECTION_TYPE_BY_ID.breakdown,
  COACH_SECTION_TYPE_BY_ID.outro
]

/** Total by construction -- CoachSectionType is a closed union over this
 * record's own keys, so there is no "unknown type" branch to get wrong. */
export function coachSectionTypeDef(type: CoachSectionType): CoachSectionTypeDef {
  return COACH_SECTION_TYPE_BY_ID[type]
}

export function isCoachSectionType(value: unknown): value is CoachSectionType {
  return typeof value === 'string' && value in COACH_SECTION_TYPE_BY_ID
}

/** Four bars is the smallest section this flow will build (one
 * ARRANGE_STEP_BARS step); 64 is a deliberately generous ceiling so the
 * nudge buttons cannot run away. Its own number, not imported from
 * auto-arrange's own cap -- the two limits happen to match today and there
 * is no reason they must stay tied. */
export const COACH_SECTION_MIN_BARS = 4
export const COACH_SECTION_MAX_BARS = 64

/** The spec's "nudgeable +/-4/+/-8", in the order the panel renders them. */
export const COACH_SECTION_BAR_NUDGES: readonly number[] = [-8, -4, 4, 8]

export function nudgeSectionBars(bars: number, delta: number): number {
  const next = Math.round(bars + delta)
  return Math.max(COACH_SECTION_MIN_BARS, Math.min(COACH_SECTION_MAX_BARS, next))
}

/**
 * WHICH STEMS A SECTION TYPE USUALLY LOSES -- as kind SETS, matched by the
 * same superset rule phase one's step completion uses (kindsCoverSet). A
 * stem is flagged when its own kinds cover ANY one of the sets.
 *
 * Read straight off the spec: "intro and outro: harmony and hook; build: the
 * hook; breakdown: kick and bass; drop: nothing".
 *
 * Two deliberate choices in how that is expressed:
 *
 * - intro/outro drop BOTH harmony and hook, and both of those are leadesque
 *   slots (phase one arms {leadesque, buttery} for harmony and {leadesque,
 *   sparkly} for the hook), so ONE set -- ['lead'] -- says it exactly, and
 *   also catches a plain leadesque stem that is one or the other.
 * - build drops the hook ONLY, so it names the hook's full set, ['lead',
 *   'bright']. A plain leadesque stem is NOT flagged there: the app cannot
 *   tell a bare lead apart from the hook, and the honest thing to do with
 *   something it cannot tell is to say nothing. Under-flagging costs the
 *   user one click; over-flagging is the app asserting something it does
 *   not know.
 *
 * Nothing outside the kinds Discover really tagged is ever inferred: a
 * chonky (bassHeavy) supporting stem is not flagged in a breakdown, because
 * Discover tagged it as a trait, not as the bass.
 */
export const COACH_SECTION_DROP_SETS: Record<
  CoachSectionType,
  readonly (readonly DiscoverSlotKind[])[]
> = {
  intro: [['lead']],
  build: [['lead', 'bright']],
  drop: [],
  breakdown: [['drums'], ['bass']],
  outro: [['lead']]
}

/** What the panel writes next to a flagged toggle. Deliberately flat and
 * unrotated: it is a label on a control, not something sssketchy says. */
export const COACH_SUGGESTED_DROP_HINT = 'usually out here'

/** The one button that applies every flag at once. */
export const COACH_DROP_SUGGESTED_LABEL = 'drop the suggested ones'

/** True when this section type usually loses this stem. A MARK -- nothing
 * in this module ever acts on it. */
export function isSuggestedDrop(type: CoachSectionType, stem: LockedClimaxStem): boolean {
  return COACH_SECTION_DROP_SETS[type].some((want) => kindsCoverSet(stem.kinds, want))
}

/** Every flagged stem's path, in the locked climax's own order. */
export function suggestedDropPaths(type: CoachSectionType, climax: LockedClimax): string[] {
  return climax.stems.filter((stem) => isSuggestedDrop(type, stem)).map((stem) => stem.path)
}

/**
 * What usually comes after each section type (spec: "after build -> drop;
 * after drop -> breakdown or outro"). Offers, not a route: the panel also
 * always offers ending phase two, and nothing here auto-advances.
 *
 * outro's list is empty because choosing an outro is how phase two ends --
 * see placeCoachSection in ./coachPhase2.ts.
 */
export const COACH_SECTION_TRANSITIONS: Record<CoachSectionType, readonly CoachSectionType[]> = {
  intro: ['build', 'drop'],
  build: ['drop'],
  drop: ['breakdown', 'outro'],
  breakdown: ['build', 'drop'],
  outro: []
}

/** "sssketchy asks what comes first (suggests intro, or build for a short
 * sketch)" (spec). */
export const COACH_FIRST_SECTION_TYPES: readonly CoachSectionType[] = ['intro', 'build']

export function nextSectionTypeSuggestions(
  sections: readonly CoachSection[]
): readonly CoachSectionType[] {
  if (sections.length === 0) return COACH_FIRST_SECTION_TYPES
  return COACH_SECTION_TRANSITIONS[sections[sections.length - 1].type]
}

/** One section the user has finished and placed. Plain, persisted data. */
export interface CoachSection {
  type: CoachSectionType
  /** The user's own name for it; defaults to the type's label. */
  name: string
  bars: number
  /** The paths of the climax stems the user switched OFF. Everything not
   * listed here PLAYS. Storing the subtraction rather than the selection is
   * the everything-on rule written into the data itself: an empty list is
   * the full loop, and no stem can ever go missing by omission. */
  droppedPaths: string[]
  /** Where it really went on the timeline. */
  startBar: number
  /** climax stem path -> the groupId that stem was placed as, which is also
   * the channel row it created (PLACE_LOOP_ON_TIMELINE sets
   * channelOf[groupId] = groupId). Later sections reuse these so one stem
   * keeps one lane -- see sectionLaneChannelIds. */
  placedGroupIds: Record<string, string>
}

/** The section currently being carved. Same shape minus everything that
 * only exists once it has really been placed. */
export interface CoachSectionDraft {
  type: CoachSectionType
  name: string
  bars: number
  droppedPaths: string[]
}

/** "drop", then "drop 2" the second time. Counts by TYPE, not by name, so
 * renaming a section never renumbers a later one. */
export function defaultSectionName(
  type: CoachSectionType,
  sections: readonly { type: CoachSectionType }[]
): string {
  const label = coachSectionTypeDef(type).label
  const already = sections.filter((section) => section.type === type).length
  return already === 0 ? label : `${label} ${already + 1}`
}

/**
 * A new section, EVERYTHING ON.
 *
 * `droppedPaths: []` is not a default that happens to be empty -- it is the
 * feature. Do not seed it from COACH_SECTION_DROP_SETS here or anywhere
 * else; that table is a mark, and applying it is a click the user makes.
 */
export function newCoachSectionDraft(
  type: CoachSectionType,
  sections: readonly CoachSection[]
): CoachSectionDraft {
  return {
    type,
    name: defaultSectionName(type, sections),
    bars: coachSectionTypeDef(type).defaultBars,
    droppedPaths: []
  }
}

/** The stems that actually play in this section, in the locked climax's own
 * order. A path in droppedPaths that no longer matches any stem is simply
 * ignored. */
export function sectionKeptStems(
  climax: LockedClimax,
  droppedPaths: readonly string[]
): LockedClimaxStem[] {
  const dropped = new Set(droppedPaths)
  return climax.stems.filter((stem) => !dropped.has(stem.path))
}

/** climax stem path -> the channel row that stem already owns, taken from
 * the FIRST section that placed it. Keeping the first (not the newest) is
 * what makes one stem one lane for the whole song. */
export function sectionLaneChannelIds(sections: readonly CoachSection[]): Record<string, string> {
  const lanes: Record<string, string> = {}
  for (const section of sections) {
    for (const [path, groupId] of Object.entries(section.placedGroupIds)) {
      if (lanes[path] === undefined) lanes[path] = groupId
    }
  }
  return lanes
}

/** Where the next section goes: straight after the previous one, or --
 * for the very first -- after everything already on the timeline
 * (placedTimelineSpanBars, the caller's job to measure). Deriving later
 * sections from the coach's own numbers rather than from the timeline keeps
 * them contiguous even when a section is entirely silent, which is allowed:
 * subtracting every stem is a real musical move, not an error. */
export function nextCoachSectionStartBar(
  sections: readonly CoachSection[],
  fallbackBar: number
): number {
  if (sections.length === 0) return Math.max(0, Math.round(fallbackBar))
  const last = sections[sections.length - 1]
  return last.startBar + last.bars
}

function finiteBars(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(COACH_SECTION_MIN_BARS, Math.min(COACH_SECTION_MAX_BARS, Math.round(value)))
}

function loadedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((path): path is string => typeof path === 'string')
}

function loadedGroupIds(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [path, groupId] of Object.entries(value as Record<string, unknown>)) {
    if (typeof groupId === 'string' && groupId !== '') out[path] = groupId
  }
  return out
}

/**
 * Turns whatever a `.sssketchproj` actually contains into a section list --
 * the same repair-rather-than-trust rule the rest of the load path follows,
 * for the same reason: a project file is plain JSON people can and do
 * hand-edit, and a load must never throw. A section whose type is not one of
 * the five is dropped entirely rather than guessed at.
 */
export function sanitiseCoachSections(value: unknown): CoachSection[] {
  if (!Array.isArray(value)) return []
  const sections: CoachSection[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const loose = entry as Record<string, unknown>
    if (!isCoachSectionType(loose.type)) continue
    const startBar =
      typeof loose.startBar === 'number' && Number.isFinite(loose.startBar)
        ? Math.max(0, Math.round(loose.startBar))
        : 0
    sections.push({
      type: loose.type,
      name:
        typeof loose.name === 'string' && loose.name !== ''
          ? loose.name
          : coachSectionTypeDef(loose.type).label,
      bars: finiteBars(loose.bars, coachSectionTypeDef(loose.type).defaultBars),
      droppedPaths: loadedPaths(loose.droppedPaths),
      startBar,
      placedGroupIds: loadedGroupIds(loose.placedGroupIds)
    })
  }
  return sections
}

/** The in-progress section, or null. Same rules; an unusable draft is
 * discarded rather than repaired into a section the user never started. */
export function sanitiseCoachSectionDraft(value: unknown): CoachSectionDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (!isCoachSectionType(loose.type)) return null
  return {
    type: loose.type,
    name:
      typeof loose.name === 'string' && loose.name !== ''
        ? loose.name
        : coachSectionTypeDef(loose.type).label,
    bars: finiteBars(loose.bars, coachSectionTypeDef(loose.type).defaultBars),
    droppedPaths: loadedPaths(loose.droppedPaths)
  }
}
