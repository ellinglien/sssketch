/**
 * What a section IS, as plain data: its type, its length in passes of the
 * loop, which stems play in which pass, and what usually follows it.
 *
 * THE RULE THIS FILE USED TO ENCODE WAS THE OPPOSITE OF TODAY'S. Until
 * 2026-09-23 a section started as the full climax loop and the user
 * subtracted, and this comment told you never to seed a draft from the
 * suggestion table. **That rule is gone, deliberately** (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "The map
 * arrives pre-filled, and says so"): the map now arrives filled in from a
 * template -- intro sparse, drop full, build without the hook -- because
 * "eight identical sections is the blank page again, and the whole value of
 * paint-by-numbers is that it does the imagining the user cannot do yet."
 *
 * What makes the reversal legitimate is the map itself: it shows the entire
 * song at once, so nothing is removed invisibly, and sssketchy states that
 * he made the call and states the way out ("cmd+z puts everything back on
 * if you would rather start full"). If you are about to "restore
 * consistency" by inverting this back to everything-on, read the spec
 * first: the reversal IS the feature.
 *
 * The pre-fill itself lives in ./coachMapTemplate.ts, computed rather than
 * stored, so a section on disk only ever carries the cells the user
 * CHANGED (./coachCells.ts).
 *
 * The flags key off the kinds DISCOVER tagged each stem with, carried on the
 * locked climax (LockedClimaxStem.kinds) -- never stem order, never channel
 * index, which the spec rules out twice.
 */

import { kindsCoverSet, type LockedClimax, type LockedClimaxStem } from './coachClimax'
import { cellIsOn, sanitiseCoachCells, setStemAcrossPasses, type CoachCells } from './coachCells'
import {
  COACH_SECTION_MAX_PASSES,
  COACH_SECTION_MIN_PASSES,
  passesForTargetBars,
  sectionBars
} from './coachPasses'
import type { DiscoverSlotKind } from './discoverSlotKind'

export type CoachSectionType = 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'outro'

/** What the section panel's own buttons do, as data rather than as
 * callbacks -- so a step row can list them under "stuck?" and the bubble's
 * "do it for me" can run one without src/shared/ knowing React exists. */
export type CoachSectionOp = 'drop-suggested' | 'preview' | 'place'

export interface CoachSectionTypeDef {
  id: CoachSectionType
  /** Shown on the panel's buttons and used as a section's default name.
   * Lowercase, like all UI copy in this app. */
  label: string
}

/** No `defaultBars` any more: a section's length comes from the shape
 * template's TARGET bar count (./coachShapes.ts), rounded to whole passes
 * of whatever the user said the phrase is. A hardcoded bar count here had
 * no relationship to the loop at all -- see ./coachPasses.ts. */
const COACH_SECTION_TYPE_BY_ID: Record<CoachSectionType, CoachSectionTypeDef> = {
  intro: { id: 'intro', label: 'intro' },
  verse: { id: 'verse', label: 'verse' },
  build: { id: 'build', label: 'build' },
  drop: { id: 'drop', label: 'drop' },
  breakdown: { id: 'breakdown', label: 'breakdown' },
  outro: { id: 'outro', label: 'outro' }
}

export const COACH_SECTION_TYPES: readonly CoachSectionTypeDef[] = [
  COACH_SECTION_TYPE_BY_ID.intro,
  COACH_SECTION_TYPE_BY_ID.verse,
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
  // The hook only. "the verse should hint at the drop without giving it
  // away" is the spec's own example of a good line; this is that line as
  // data. Harmony stays -- a verse with no chords is a build.
  verse: [['lead', 'bright']],
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
  intro: ['verse', 'build', 'drop'],
  verse: ['build', 'drop'],
  build: ['drop'],
  drop: ['verse', 'breakdown', 'outro'],
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

/** One section of the map. Plain, persisted data. */
export interface CoachSection {
  /** Stable across re-sizes, renames and reorders -- the map UI keys its
   * columns off this, and a cell edit must not follow the index when a
   * section is inserted before it. Never shown to the user. */
  id: string
  type: CoachSectionType
  /** The user's own name for it; defaults to the type's label. */
  name: string
  /** Its length, as a count of passes of the phrase (./coachPasses.ts).
   * Bars are derived -- sectionBars(passes, phraseBars) -- because the
   * phrase length is the user's answer and can change under a section
   * without rebuilding it. */
  passes: number
  /** The cells the USER changed, sparse (./coachCells.ts). Everything not
   * in here is answered by the template (./coachMapTemplate.ts). An empty
   * record is a section exactly as the template drew it, which is what a
   * freshly built map is made of. */
  cells: CoachCells
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
  passes: number
  cells: CoachCells
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
 * A new section, PRE-FILLED from the template.
 *
 * `cells: {}` does not mean "nothing plays" -- it means "nothing has been
 * overridden", so every cell reads whatever the template says for this
 * section type. That is the deliberate reversal of the old everything-on
 * rule; see this module's own doc comment before changing it.
 */
export function newCoachSectionDraft(
  type: CoachSectionType,
  sections: readonly CoachSection[],
  passes: number
): CoachSectionDraft {
  return { type, name: defaultSectionName(type, sections), passes, cells: {} }
}

/** The stems that actually play in ONE PASS of this section, in whatever
 * row order `stems` is already in (coachMapRowOrder, ./coachMapTemplate.ts).
 * `fallback` answers a cell the user has not touched -- the template's own
 * answer.
 *
 * Takes the template's answer as a CALLBACK rather than importing it, so
 * this module stays free of the template and the two cannot form a cycle.
 *
 * No `climax` parameter: the caller has already turned the climax into the
 * ordered `stems` list it wants asked about, and taking both would be two
 * sources for one question. */
export function sectionStemsInPass(
  section: { cells: CoachCells },
  passIndex: number,
  stems: readonly LockedClimaxStem[],
  fallback: (stem: LockedClimaxStem, passIndex: number) => boolean
): LockedClimaxStem[] {
  return stems.filter((stem) =>
    cellIsOn(section.cells, passIndex, stem.path, fallback(stem, passIndex))
  )
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
  fallbackBar: number,
  phraseBars: number
): number {
  if (sections.length === 0) return Math.max(0, Math.round(fallbackBar))
  const last = sections[sections.length - 1]
  return last.startBar + sectionBars(last.passes, phraseBars)
}

/** Sections saved before 2026-09-23 carried `bars` and `droppedPaths`.
 * They are brought up to today's shape here, once, on load: the bar count
 * becomes a pass count at the phrase length the project now has (or one
 * pass when it has none yet -- the map's own re-size fixes that the moment
 * he answers), and each dropped path becomes an explicit OFF cell in every
 * pass, which is exactly what it meant. */
function migratedPasses(loose: Record<string, unknown>, phraseBars: number): number {
  const passes = loose.passes
  if (typeof passes === 'number' && Number.isFinite(passes)) {
    return Math.max(
      COACH_SECTION_MIN_PASSES,
      Math.min(COACH_SECTION_MAX_PASSES, Math.round(passes))
    )
  }
  const bars = loose.bars
  if (typeof bars === 'number' && Number.isFinite(bars)) {
    return passesForTargetBars(bars, phraseBars)
  }
  return COACH_SECTION_MIN_PASSES
}

function migratedCells(loose: Record<string, unknown>, passes: number): CoachCells {
  const cells = sanitiseCoachCells(loose.cells)
  if (Object.keys(cells).length > 0 || !Array.isArray(loose.droppedPaths)) return cells
  let migrated: CoachCells = {}
  for (const path of loose.droppedPaths) {
    if (typeof path !== 'string') continue
    migrated = setStemAcrossPasses(migrated, passes, path, false)
  }
  return migrated
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
export function sanitiseCoachSections(value: unknown, phraseBars: number): CoachSection[] {
  if (!Array.isArray(value)) return []
  const sections: CoachSection[] = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) continue
    const loose = entry as Record<string, unknown>
    if (!isCoachSectionType(loose.type)) continue
    const startBar =
      typeof loose.startBar === 'number' && Number.isFinite(loose.startBar)
        ? Math.max(0, Math.round(loose.startBar))
        : 0
    const passes = migratedPasses(loose, phraseBars)
    sections.push({
      // A missing id is minted from the index -- stable within a load,
      // which is all it has to be.
      id: typeof loose.id === 'string' && loose.id !== '' ? loose.id : `section-${index}`,
      type: loose.type,
      name:
        typeof loose.name === 'string' && loose.name !== ''
          ? loose.name
          : coachSectionTypeDef(loose.type).label,
      passes,
      cells: migratedCells(loose, passes),
      startBar,
      placedGroupIds: loadedGroupIds(loose.placedGroupIds)
    })
  }
  return sections
}

/** The in-progress section, or null. Same rules; an unusable draft is
 * discarded rather than repaired into a section the user never started. */
export function sanitiseCoachSectionDraft(
  value: unknown,
  phraseBars: number
): CoachSectionDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (!isCoachSectionType(loose.type)) return null
  const passes = migratedPasses(loose, phraseBars)
  return {
    type: loose.type,
    name:
      typeof loose.name === 'string' && loose.name !== ''
        ? loose.name
        : coachSectionTypeDef(loose.type).label,
    passes,
    cells: migratedCells(loose, passes)
  }
}
