/**
 * One finished section -> real arranger actions.
 *
 * THE POINT (spec): "Placement reuses the arranger's existing write path, so
 * the result is ordinary, fully editable arrangement -- one undo step per
 * section." Nothing here invents a clip type, a flag, or a second-class
 * "guided" object. What comes out is exactly what Discover's own "add to
 * timeline" produces, laid out section by section.
 *
 * ONE CLIP PER RUN, NOT ONE PER SECTION (2026-09-23). A section is N passes
 * of the loop and each pass is its own cell (@shared/coachCells), so a stem
 * can leave and come back inside one section. Its on-passes are
 * collapsed into contiguous RUNS and each run becomes one clip as many
 * passes long as the run is -- which is both what a person would draw and
 * what keeps the clip count sane. A stem playing passes 1-3 of a 4-pass
 * section is ONE clip three passes long, never three clips.
 *
 * Why this is not a call to buildArrangeReplaceActions (selectors.ts), which
 * the spec names: that function REPLACES clips already on the timeline --
 * it reads state.rifffs for every moved stem and finishes with one
 * DELETE_RIFFFS of every source it touched. The map has no such source
 * (the locked climax is a value on the coach state: paths, roles and gains),
 * and calling it once per section would delete the sections already placed.
 * So this builds a section out of the same three actions THAT function
 * emits, in the same order, with the same channel-continuity trick:
 *
 *  - PLACE_LOOP_ON_TIMELINE, one single-stem Rifff per run, which is
 *    exactly what that action's own doc comment describes ("one groupId per
 *    Discover slot, each carrying exactly one Stem") and what
 *    DiscoverPanel's addToTimeline already dispatches. ONE PER DISTINCT RUN
 *    START BAR: that action carries a single `startBar` for every rifff in
 *    it (see its reducer case, which writes `action.startBar` onto each), so
 *    runs that begin on different bars cannot ride in one call. They are
 *    emitted in ascending bar order, and the caller still sends the whole
 *    lot in ONE batch, so undo is still one step per section;
 *  - MOVE_TO_CHANNEL for any run that is not the first sight of its stem,
 *    onto the lane that stem already owns -- buildArrangeReplaceActions' own
 *    firstCopyChannelId trick (selectors.ts). Without it, PLACE_LOOP_ON_
 *    TIMELINE's channelOf[groupId] = groupId would give every section, and
 *    every run inside a section, a fresh row, and the arrangement would read
 *    as a staircase instead of one row per stem;
 *  - SET_PLAYED_BARS, the right-edge resize, carrying the RUN's length
 *    rather than the section's -- which is what tiles a four-bar loop out
 *    across exactly the passes it plays.
 *
 * Unlike buildArrangeReplaceActions this needs no TOGGLE_STRETCH correction:
 * both PLACE_LOOP_ON_TIMELINE and MOVE_TO_CHANNEL's shared placeOnTimeline
 * set stretch to true, and a freshly placed Discover stem wants stretch on.
 *
 * The caller dispatches `actions` and the COACH_PLACE_SECTION that records
 * them in ONE BATCH -- see SssketchySectionPanel.tsx and history.ts.
 */

import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { placedTimelineSpanBars } from './selectors'
import type { Action, AppState } from './store'
import type { LockedClimax, LockedClimaxStem } from '@shared/coachClimax'
import { cellRuns } from '@shared/coachCells'
import { coachMapRowOrder, templateFallbackFor } from '@shared/coachMapTemplate'
import { passOffsetBars, sectionBars } from '@shared/coachPasses'
import {
  nextCoachSectionStartBar,
  sectionLaneChannelIds,
  type CoachSection,
  type CoachSectionDraft,
  type CoachSectionType
} from '@shared/coachSections'
import type { Rifff, Stem } from '@shared/types'

export interface CoachSectionPlacement {
  /** Where the section really goes. */
  startBar: number
  /** Dispatch these in order, in one BATCH, together with the
   * COACH_PLACE_SECTION that records the result. Empty for a section with
   * every cell switched off -- a silent section is allowed, and the flow's
   * own arithmetic still advances past it. */
  actions: Action[]
  /** climax stem path -> the groupId its FIRST run was placed as, which is
   * also the channel row that stem owns from here on. Goes straight into
   * COACH_PLACE_SECTION.
   *
   * One entry per stem, not one per run: this record answers "which row
   * does this stem live on", and a later run of the same stem is moved onto
   * that same row rather than naming a second one. */
  placedGroupIds: Record<string, string>
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

/** Every rifff that begins on one bar, gathered so they can share a single
 * PLACE_LOOP_ON_TIMELINE. */
interface PlacementBucket {
  startBar: number
  rifffs: Rifff[]
  vol: Record<string, number>
}

export function buildCoachSectionActions(
  state: AppState,
  climax: LockedClimax,
  draft: CoachSectionDraft,
  sections: readonly CoachSection[],
  homeType: CoachSectionType,
  phraseBars: number
): CoachSectionPlacement {
  const startBar = nextCoachSectionStartBar(sections, placedTimelineSpanBars(state), phraseBars)
  const lanes = sectionLaneChannelIds(sections)
  // The template's answer for every cell the user has not touched. One
  // source for "is this cell on", shared with the map and the preview.
  const fallback = templateFallbackFor(draft, homeType, climax)
  const rows = coachMapRowOrder(climax)

  const buckets = new Map<number, PlacementBucket>()
  const placedGroupIds: Record<string, string> = {}
  const afterPlacement: Action[] = []

  for (const stem of rows) {
    const runs = cellRuns(draft.cells, draft.passes, stem.path, (passIndex) =>
      fallback(stem, passIndex)
    )
    for (const [runIndex, run] of runs.entries()) {
      // One member, so the assembled rifff's own barLength is this stem's --
      // which is what makes SET_PLAYED_BARS below tile it out rather than
      // stretch it. Reused rather than hand-rolled so the gain-to-vol
      // mapping stays in the one tested place that already owns it.
      const assembly = assembleDiscoverRifff(
        `${draft.name} · ${stem.name}`,
        [{ stem: stemFromClimax(stem), gain: stem.gain }],
        state.bpm
      )
      if (assembly === null) continue

      const groupId = assembly.rifff.groupId
      const runStartBar = startBar + passOffsetBars(run.startPass, phraseBars)
      const bucket = buckets.get(runStartBar) ?? { startBar: runStartBar, rifffs: [], vol: {} }
      bucket.rifffs.push(assembly.rifff)
      Object.assign(bucket.vol, assembly.vol)
      buckets.set(runStartBar, bucket)

      // The FIRST run is this stem's lane for the whole song -- every later
      // run in this section, and every run in every later section, moves
      // onto it.
      if (runIndex === 0) placedGroupIds[stem.path] = groupId
      const lane = lanes[stem.path] ?? placedGroupIds[stem.path]
      if (lane !== undefined && lane !== groupId) {
        afterPlacement.push({
          type: 'MOVE_TO_CHANNEL',
          groupId,
          // The bar this RUN starts on -- MOVE_TO_CHANNEL re-places as well
          // as re-rows, so passing the section's own start here would drag
          // every later run back to the top of the section.
          startBar: runStartBar,
          channelId: lane
        })
      }
      afterPlacement.push({
        type: 'SET_PLAYED_BARS',
        key: groupId,
        bars: sectionBars(run.passCount, phraseBars)
      })
    }
  }

  if (buckets.size === 0) return { startBar, actions: [], placedGroupIds }

  // Ascending, so the timeline fills left to right and a reader of the batch
  // can follow it. Every placement lands before the first MOVE_TO_CHANNEL,
  // which needs its rifff to already exist.
  const placements: Action[] = [...buckets.values()]
    .sort((a, b) => a.startBar - b.startBar)
    .map((bucket) => ({
      type: 'PLACE_LOOP_ON_TIMELINE',
      stems: bucket.rifffs,
      startBar: bucket.startBar,
      vol: bucket.vol
    }))

  return { startBar, actions: [...placements, ...afterPlacement], placedGroupIds }
}
