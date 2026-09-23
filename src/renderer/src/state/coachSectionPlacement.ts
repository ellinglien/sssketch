/**
 * One finished section -> real arranger actions.
 *
 * THE POINT (spec): "Placement reuses the arranger's existing write path, so
 * the result is ordinary, fully editable arrangement -- one undo step per
 * section." Nothing here invents a clip type, a flag, or a second-class
 * "guided" object. What comes out is exactly what Discover's own "add to
 * timeline" produces, laid out section by section.
 *
 * Why this is not a call to buildArrangeReplaceActions (selectors.ts), which
 * the spec names: that function REPLACES clips already on the timeline --
 * it reads state.rifffs for every moved stem and finishes with one
 * DELETE_RIFFFS of every source it touched. Phase two has no such source
 * (the locked climax is a value on the coach state: paths, roles and gains),
 * and calling it once per section would delete the sections already placed.
 * So this builds a section out of the same three actions THAT function
 * emits, in the same order, with the same channel-continuity trick:
 *
 *  - PLACE_LOOP_ON_TIMELINE, one single-stem Rifff per kept stem, which is
 *    exactly what that action's own doc comment describes ("one groupId per
 *    Discover slot, each carrying exactly one Stem") and what
 *    DiscoverPanel's addToTimeline already dispatches;
 *  - MOVE_TO_CHANNEL for any stem that already owns a lane from an earlier
 *    section, onto that lane -- buildArrangeReplaceActions' own
 *    firstCopyChannelId trick (selectors.ts). Without it, PLACE_LOOP_ON_
 *    TIMELINE's channelOf[groupId] = groupId would give every section a
 *    fresh set of rows and the arrangement would read as a staircase
 *    instead of one row per stem;
 *  - SET_PLAYED_BARS, which is the right-edge resize, so a four-bar loop
 *    tiles out to fill a sixteen-bar section.
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
import {
  nextCoachSectionStartBar,
  sectionKeptStems,
  sectionLaneChannelIds,
  type CoachSection,
  type CoachSectionDraft
} from '@shared/coachSections'
import type { Rifff, Stem } from '@shared/types'

export interface CoachSectionPlacement {
  /** Where the section really goes. */
  startBar: number
  /** Dispatch these in order, in one BATCH, together with the
   * COACH_PLACE_SECTION that records the result. Empty for a section with
   * every stem switched off -- a silent section is allowed, and the flow's
   * own arithmetic still advances past it. */
  actions: Action[]
  /** climax stem path -> the groupId it was placed as, which is also the
   * channel row it owns from here on. Goes straight into
   * COACH_PLACE_SECTION. */
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

export function buildCoachSectionActions(
  state: AppState,
  climax: LockedClimax,
  draft: CoachSectionDraft,
  sections: readonly CoachSection[]
): CoachSectionPlacement {
  const startBar = nextCoachSectionStartBar(sections, placedTimelineSpanBars(state))
  const lanes = sectionLaneChannelIds(sections)

  const rifffs: Rifff[] = []
  const vol: Record<string, number> = {}
  const placedGroupIds: Record<string, string> = {}
  const afterPlacement: Action[] = []

  for (const stem of sectionKeptStems(climax, draft.droppedPaths)) {
    // One member, so the assembled rifff's own barLength is this stem's --
    // which is what makes SET_PLAYED_BARS below tile it out rather than
    // stretch it. Reused rather than hand-rolled so the gain-to-vol mapping
    // stays in the one tested place that already owns it.
    const assembly = assembleDiscoverRifff(
      `${draft.name} · ${stem.name}`,
      [{ stem: stemFromClimax(stem), gain: stem.gain }],
      state.bpm
    )
    if (assembly === null) continue

    rifffs.push(assembly.rifff)
    Object.assign(vol, assembly.vol)
    const groupId = assembly.rifff.groupId
    placedGroupIds[stem.path] = groupId

    const lane = lanes[stem.path]
    if (lane !== undefined) {
      // Same startBar PLACE_LOOP_ON_TIMELINE just used -- this only changes
      // which row the clip lives on.
      afterPlacement.push({ type: 'MOVE_TO_CHANNEL', groupId, startBar, channelId: lane })
    }
    afterPlacement.push({ type: 'SET_PLAYED_BARS', key: groupId, bars: draft.bars })
  }

  if (rifffs.length === 0) return { startBar, actions: [], placedGroupIds }

  return {
    startBar,
    actions: [{ type: 'PLACE_LOOP_ON_TIMELINE', stems: rifffs, startBar, vol }, ...afterPlacement],
    placedGroupIds
  }
}
