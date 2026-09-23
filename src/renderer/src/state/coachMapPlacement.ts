/**
 * Turning the map into real clips, and one cell edit into real clip actions.
 *
 * Replaces coachSectionPlacement.ts, whose whole shape assumed sections
 * arriving one at a time and being appended after whatever was already down.
 * The map arrives WHOLE, and the auto-arranger it is entered from REPLACES
 * the material it read -- so sections are placed at their own start bars,
 * from bar zero, and the source clips are deleted afterwards.
 *
 * TWO ORDERING RULES, both load-bearing:
 *
 * 1. **Rows outer, sections inner.** PLACE_LOOP_ON_TIMELINE pushes each
 *    fresh groupId onto channelOrder as it places it, so the order lanes are
 *    CREATED in is the order the arranger draws its rows in. Placing
 *    section-by-section would order the rows by which section a stem first
 *    appears in, and the map would disagree with the timeline behind it on
 *    the very first screen. Iterating rows first makes the two agree by
 *    construction -- and coachMapRows.ts reads channelsInOrder, so there is
 *    nothing to keep in sync.
 * 2. **Place, then delete.** buildArrangeReplaceActions already does this,
 *    and the reason is placeOnTimeline's own quirk: the FIRST placement on
 *    an empty timeline adopts the rifff's bpm as the project's. Deleting
 *    first would empty the timeline and hand the project's tempo to whatever
 *    clip happened to land next.
 *
 * PLACE_LOOP_ON_TIMELINE carries ONE startBar for the whole call, so one
 * call per (row, bar). They all go out in one BATCH and history.ts
 * checkpoints a BATCH exactly once, so the whole map is one undo step --
 * which is what lets sssketchy say "cmd+z puts everything back on".
 *
 * OFFSETS USE passOffsetBars, LENGTHS USE sectionBars. They are two
 * different questions and coachPasses.ts says so at length: sectionBars
 * floors passes at one, because a zero-LENGTH clip is never wanted --
 * whereas a zero OFFSET is exactly right for the first run in a section.
 * Using sectionBars for an offset puts every section's opening clip one
 * whole phrase late.
 */

import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import type { ArrangementMapColumn } from '@shared/arrangementMapColumns'
import { cellRuns, type CoachCellRun, type CoachCells } from '@shared/coachCells'
import { passOffsetBars, sectionBars } from '@shared/coachPasses'
import { COACH_LOOP_HOME_TYPE } from '@shared/coachShapes'
import {
  coachMapRowOrder,
  resizeCoachMapToPhrase,
  templateFallbackFor
} from '@shared/coachMapTemplate'
import { remapCellsToPhrase, type CoachMapRowPlan } from '@shared/coachMapEdit'
import { readRowPasses, rowPassesToCells } from '@shared/coachMapRead'
import type { CoachSection } from '@shared/coachSections'
import type { CoachState } from '@shared/coach'
import type { LockedClimaxStem } from '@shared/coachClimax'
import type { Rifff, Stem } from '@shared/types'
import { coachMapRows, type CoachMapRow } from './coachMapRows'
import type { Action, AppState } from './store'

export interface CoachMapPlacement {
  actions: Action[]
  /** section id -> (climax stem path -> the groupId it was placed as). The
   * FIRST groupId per path per section, which is the one that owns the
   * lane -- sectionLaneChannelIds keeps the first, not the newest. */
  placedGroupIds: Record<string, Record<string, string>>
}

/** Just the Stem fields, never the coach's own extras -- kinds/role/gain
 * live on the locked climax and have no business being persisted into a
 * Rifff. Listed explicitly rather than spread, because a spread of a
 * LockedClimaxStem would carry all three straight into the project file. */
function stemFromClimax(stem: LockedClimaxStem): Omit<Stem, 'slot'> {
  return {
    author: stem.author,
    name: stem.name,
    type: stem.type,
    path: stem.path,
    durationSec: stem.durationSec,
    barLength: stem.barLength
  }
}

/** One run of one stem, as a placed clip plus the actions that shape it.
 *
 * Takes the stem and its gain as PLAIN VALUES rather than a
 * LockedClimaxStem: the map's own toggle now sources both from the row's
 * existing material (coachMapRows.ts's `source`), and only the build still
 * sources them from the climax (through stemFromClimax above). */
function placeRun(
  state: AppState,
  stem: Omit<Stem, 'slot'>,
  gain: number,
  label: string,
  startBar: number,
  barCount: number,
  lane: string | null
): { rifff: Rifff; vol: Record<string, number>; after: Action[] } | null {
  const assembly = assembleDiscoverRifff(`${label} · ${stem.name}`, [{ stem, gain }], state.bpm)
  if (assembly === null) return null
  const groupId = assembly.rifff.groupId
  const after: Action[] = []
  // The first clip for a stem keeps PLACE_LOOP_ON_TIMELINE's own fresh lane
  // (channelOf[groupId] = groupId); every later one is moved onto it, so a
  // stem that leaves and comes back stays one row rather than opening a
  // staircase. MOVE_TO_CHANNEL re-places as well as re-rows, so it carries
  // this RUN's own bar, not the section's.
  if (lane !== null && lane !== groupId) {
    after.push({ type: 'MOVE_TO_CHANNEL', groupId, startBar, channelId: lane })
  }
  after.push({ type: 'SET_PLAYED_BARS', key: groupId, bars: barCount })
  return { rifff: assembly.rifff, vol: assembly.vol, after }
}

/** Every section of the map, as one batch of ordinary clip actions. */
export function buildCoachMapActions(
  state: AppState,
  coach: CoachState,
  sections: readonly CoachSection[]
): CoachMapPlacement {
  const climax = coach.lockedClimax
  const phraseBars = coach.phrase?.bars ?? climax?.barLength ?? 1
  const empty: CoachMapPlacement = { actions: [], placedGroupIds: {} }
  if (climax === null || coach.loopIs === null || sections.length === 0) return empty

  const homeType = COACH_LOOP_HOME_TYPE[coach.loopIs]
  const rows = coachMapRowOrder(climax)
  const placedGroupIds: CoachMapPlacement['placedGroupIds'] = {}
  for (const section of sections) placedGroupIds[section.id] = {}

  const actions: Action[] = []
  const lanes: Record<string, string> = {}

  for (const stem of rows) {
    for (const section of sections) {
      const fallback = templateFallbackFor(section, homeType, climax)
      const runs: CoachCellRun[] = cellRuns(section.cells, section.passes, stem.path, (passIndex) =>
        fallback(stem, passIndex)
      )
      for (const run of runs) {
        const startBar = section.startBar + passOffsetBars(run.startPass, phraseBars)
        const placed = placeRun(
          state,
          stemFromClimax(stem),
          stem.gain,
          section.name,
          startBar,
          sectionBars(run.passCount, phraseBars),
          lanes[stem.path] ?? null
        )
        if (placed === null) continue
        if (lanes[stem.path] === undefined) lanes[stem.path] = placed.rifff.groupId
        if (placedGroupIds[section.id][stem.path] === undefined) {
          placedGroupIds[section.id][stem.path] = placed.rifff.groupId
        }
        actions.push({
          type: 'PLACE_LOOP_ON_TIMELINE',
          stems: [placed.rifff],
          startBar,
          vol: placed.vol
        })
        actions.push(...placed.after)
      }
    }
  }
  if (actions.length === 0) return empty

  // Last, never first -- see this module's own doc comment.
  const sourceGroupIds = Object.values(state.rifffs)
    .filter((rifff) => rifff.startBar !== undefined)
    .map((rifff) => rifff.groupId)
  if (sourceGroupIds.length > 0) actions.push({ type: 'DELETE_RIFFFS', groupIds: sourceGroupIds })

  return { actions, placedGroupIds }
}

/**
 * The user changed his mind about the phrase length.
 *
 * "He can change it afterwards; the map RE-SIZES, it does not rebuild"
 * (spec). Ids, types and names all survive -- which is what re-sizing means
 * to the person looking at it -- and so do his own edits, because they are
 * READ OFF THE TIMELINE first (readRowPasses) rather than taken from
 * section.cells, which records only what the map was built from and has said
 * nothing true since the first click.
 *
 * The three steps, in one batch and therefore one undo:
 *   1. read every row's real grid at the OLD phrase,
 *   2. re-size the sections and carry the grid across proportionally
 *      (rowPassesToCells, then remapCellsToPhrase -- in that order),
 *   3. place the clips again from that grid and delete the old ones.
 *
 * buildCoachMapActions is handed a coach whose `phrase` is already the NEW
 * one, because it reads the phrase off the state it is given to work out
 * every offset and length. Handing it the old one lays the whole map out at
 * the wrong scale while the sections underneath say the new one.
 *
 * This is the most fragile thing in the feature and it is worth saying why
 * it exists at all: the alternative -- refusing to change the phrase once a
 * map is down -- would have been much simpler and would have quietly dropped
 * the one thing the spec is most insistent about, which is that the user
 * owns this number.
 */
export function buildMapRebuildActions(
  state: AppState,
  coach: CoachState,
  toPhraseBars: number
): CoachMapPlacement & { sections: CoachSection[] } {
  const fromPhraseBars = coach.phrase?.bars ?? coach.lockedClimax?.barLength ?? 1
  const empty = { actions: [] as Action[], placedGroupIds: {}, sections: [...coach.sections] }
  if (coach.lockedClimax === null || toPhraseBars === fromPhraseBars) return empty
  if (coach.sections.length === 0) return empty

  const rows = coachMapRows(state)
  const pathRows = rows.filter((row): row is CoachMapRow & { path: string } => row.path !== null)
  const resized = resizeCoachMapToPhrase(coach.sections, fromPhraseBars, toPhraseBars)
  const sections = resized.map((section, index): CoachSection => {
    const old = coach.sections[index]
    let cells: CoachCells = {}
    for (const row of pathRows) {
      // EXPLICIT cells for every pass, read off the real clips -- so no
      // template answer can overrule what is actually on the timeline.
      const read = rowPassesToCells(readRowPasses(row.clips, old, fromPhraseBars), row.path)
      cells = { ...cells, ...remapCellsToPhrase(read, [row.path], old.passes, section.passes) }
    }
    return { ...section, cells }
  })

  const phrase = { bars: toPhraseBars, source: coach.phrase?.source ?? 'nominal' } as const
  const built = buildCoachMapActions(state, { ...coach, phrase, sections }, sections)
  return { ...built, sections }
}

/**
 * One cell toggle, as real clip actions.
 *
 * NO CLIMAX. The stem to put back comes from the row itself
 * (coachMapRows.ts's `source`), which is what lets this serve an unguided
 * map as well as a guided one -- see that field's own doc comment.
 *
 * A refusal (blockedGroupIds) produces NOTHING -- the map says why in the
 * cell's own tooltip rather than doing something approximate. See
 * coachMapEdit.ts's own rule 2.
 */
export function buildCellToggleActions(
  state: AppState,
  row: CoachMapRow,
  column: ArrangementMapColumn,
  plan: CoachMapRowPlan,
  phraseBars: number
): Action[] {
  if (plan.blockedGroupIds.length > 0) return []
  if (row.source === null) return []

  // An unnamed column names a placed clip by the bar it starts at -- the
  // column header deliberately shows nothing (spec), but a clip on the
  // timeline still needs a name a person can read.
  const label = column.name ?? `bar ${column.startBar}`
  const actions: Action[] = []
  for (const run of plan.addRuns) {
    const startBar = column.startBar + passOffsetBars(run.startPass, phraseBars)
    const placed = placeRun(
      state,
      row.source.stem,
      row.source.gain,
      label,
      startBar,
      sectionBars(run.passCount, phraseBars),
      row.channelId
    )
    if (placed === null) continue
    actions.push({
      type: 'PLACE_LOOP_ON_TIMELINE',
      stems: [placed.rifff],
      startBar,
      vol: placed.vol
    })
    actions.push(...placed.after)
  }
  // After the placements, for the same reason the build deletes last.
  if (plan.removeGroupIds.length > 0) {
    actions.push({ type: 'DELETE_RIFFFS', groupIds: [...plan.removeGroupIds] })
  }
  return actions
}
