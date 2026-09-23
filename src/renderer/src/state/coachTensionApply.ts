/**
 * One tension offer -> real arranger actions.
 *
 * THE POINT (spec): "a riser is the same riser you get from right-clicking,
 * freely movable, resizable, and redrawable afterwards. One undo step
 * each." Nothing here invents a clip type, a flag, or a second-class
 * "guided" object:
 *
 *  - a riser is built by createRiser (@shared/riser) and placed by
 *    ADD_RISER -- the same function and the same action App.tsx's own "add
 *    riser here" context-menu item uses, with the same defaults;
 *  - a curve is written by SET_GROUP_AUTOMATION, which is what the
 *    automation lane itself dispatches on a completed gesture, carrying a
 *    shape built by automationEdit.ts's own primitives (see
 *    tensionCurveFor).
 *
 * The caller dispatches these and the COACH_APPLY_TENSION / COACH_CLEAR_
 * TENSION that records them in ONE BATCH -- see SssketchyTensionPanel.tsx
 * and history.ts.
 *
 * Why SET_GROUP_AUTOMATION rather than SET_STEM_AUTOMATION: a section clip
 * carries exactly one stem (buildCoachSectionActions builds a single-member
 * rifff per kept climax stem), so group and stem are the same thing here,
 * and the group action means this file never has to know the slot number.
 */

import { clipLengthBars } from '@shared/automationEdit'
import type { CoachSection } from '@shared/coachSections'
import {
  coachRiserFieldsFor,
  coachTensionDef,
  tensionCurveFor,
  type CoachTensionKind
} from '@shared/coachTension'
import { sectionBars } from '@shared/coachPasses'
import { createRiser } from '@shared/riser'
import { stemKey } from '@shared/types'
import { resolvedPlayedBarsFromFields } from './selectors'
import type { Action, AppState } from './store'

export interface CoachTensionApplication {
  /** Dispatch these in order, in one BATCH, together with the
   * COACH_APPLY_TENSION that records the result. Empty when there is
   * nothing left to write to (every clip deleted, a zero-length clip). */
  actions: Action[]
  /** The riser this placed, for the 'riser' offer only -- goes straight
   * into COACH_APPLY_TENSION so switching the toggle back off can remove
   * exactly this one. */
  riserId: string | null
}

/** A clip's REAL current length in bars -- never the section's own number.
 * The same formula (and the same shared helper) clipGeometryFromFields uses
 * to DRAW the clip, so the span a curve is written over and the span it is
 * drawn over cannot drift apart. */
function clipBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  if (rifff === undefined) return 0
  return clipLengthBars({
    playedBars: resolvedPlayedBarsFromFields(state.playedBars[groupId], rifff.barLength),
    leftCropBars: state.leftCrop[groupId] ?? 0,
    stretchOn: state.stretch[groupId] ?? true,
    rifffBpm: rifff.bpm,
    stateBpm: state.bpm
  })
}

/** How long this section really is, in bars.
 *
 * A section stores a count of PASSES, never bars (@shared/coachPasses), so
 * the only way back to a bar number is the phrase length -- and the phrase
 * length is the USER'S answer, which lives on the coach state. Read off the
 * state rather than taken as an argument so both call sites here, and the
 * panel above them, cannot disagree about it. One pass is the fallback for a
 * flow that has not been asked yet, which is what every other reader of
 * `phrase` uses too. */
function sectionBarsFor(state: AppState, section: CoachSection): number {
  return sectionBars(section.passes, state.coach?.phrase?.bars ?? 1)
}

/**
 * This section's clips, READ OFF THE LIVE TIMELINE -- one per arranger row,
 * in the order the arranger draws its rows.
 *
 * NOT `section.placedGroupIds`, and that is the whole point of this
 * function. That record is a snapshot of what the map BUILD placed, written
 * once by COACH_RECORD_MAP_PLACEMENT and never again; meanwhile every edit
 * on the map is a DELETE plus a fresh PLACE_LOOP_ON_TIMELINE with a new
 * groupId (buildCellToggleActions), and so is every clip the user drags,
 * splits or redraws by hand. So by the time the tension pass runs -- which
 * is AFTER the walk whose entire purpose is shaping those columns -- the
 * record names clips that no longer exist, and a toggle built off it wrote
 * nothing, recorded nothing, and looked broken. (Elling, 2026-09-23: "not
 * sure if clicking one of these choices works... no visual confirmation or
 * change to the grid.")
 *
 * This is the same rule ArrangementMap.tsx already states at the top of
 * itself -- "every cell it draws is read out of the live timeline" -- and
 * the tension pass was the last thing in the map world still reading a
 * stored grid instead.
 *
 * ONE PER ROW, not one per clip: a stem switched off mid-section and back
 * on is two clips on one lane, and a curve that spans the section once
 * belongs on the clip that OPENS the lane here -- which is exactly what
 * placedGroupIds used to name ("the FIRST groupId per path per section").
 * Writing the same ramp onto both would be two ramps where the offer
 * promises one.
 *
 * A clip BELONGS to the section when it starts inside it. Same test the
 * build's own placement makes, and it keeps the boundary where the user
 * sees it: a clip that begins on the join is the next section's.
 */
function liveGroupIds(state: AppState, section: CoachSection): string[] {
  const startBar = section.startBar
  const endBar = startBar + sectionBarsFor(state, section)
  const firstPerLane = new Map<string, { groupId: string; startBar: number }>()
  for (const rifff of Object.values(state.rifffs)) {
    const bar = rifff.startBar
    if (bar === undefined || bar < startBar || bar >= endBar) continue
    const lane = state.channelOf[rifff.groupId] ?? rifff.groupId
    const seen = firstPerLane.get(lane)
    if (seen === undefined || bar < seen.startBar) {
      firstPerLane.set(lane, { groupId: rifff.groupId, startBar: bar })
    }
  }
  // channelOrder is the order the arranger draws its rows in, and the map
  // above it too (coachMapRows reads channelsInOrder), so the actions come
  // out in the order the user sees the rows. A lane the order has not heard
  // of yet goes last rather than being dropped.
  const order = new Map(state.channelOrder.map((id, index) => [id, index]))
  return [...firstPerLane.entries()]
    .sort(
      ([a], [b]) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)
    )
    .map(([, entry]) => entry.groupId)
}

/**
 * Is there anything in this section for this offer to be written onto?
 *
 * The panel asks before it draws a toggle, so an offer that cannot land is
 * shown as unavailable instead of accepting a click and doing nothing --
 * which is exactly how this whole path looked when it was reading a stale
 * record (see liveGroupIds above). A section the user has emptied is a
 * legitimate thing to have made; silently ignoring a press on it is not.
 *
 * A riser needs no material at all -- it is a clip in its own right on a row
 * of its own, so it can always land.
 */
export function coachTensionHasMaterial(
  state: AppState,
  section: CoachSection,
  kind: CoachTensionKind
): boolean {
  if (coachTensionDef(kind).param === null) return true
  return liveGroupIds(state, section).length > 0
}

/**
 * Switches one offer ON.
 *
 * `ids.riserId` and `ids.channelId` are minted by the caller (crypto.
 * randomUUID, like every other freshly-minted id in the renderer) and
 * injected rather than generated here, so this stays a pure function with
 * pinnable output. Both are ALWAYS fresh: one riser owns one arranger row
 * (Elling, 2026-09-23), and a flow-placed riser has to behave exactly like a
 * hand-placed one -- nothing here marks it as sssketchy's. This used to
 * reuse the previous flow riser's row (coachRiserChannelId, removed in the
 * same change) so three drops made one riser row rather than three; the
 * one-row-per-riser rule replaced that, and the two must not diverge again.
 */
export function buildCoachTensionActions(
  state: AppState,
  section: CoachSection,
  kind: CoachTensionKind,
  ids: { riserId: string; channelId: string }
): CoachTensionApplication {
  const def = coachTensionDef(kind)
  const barsInSection = sectionBarsFor(state, section)

  if (def.param === null) {
    const { startBar, lengthBars } = coachRiserFieldsFor({
      bar: section.startBar + barsInSection,
      leadBars: barsInSection
    })
    const riser = createRiser({
      id: ids.riserId,
      channelId: ids.channelId,
      startBar,
      lengthBars
    })
    return { actions: [{ type: 'ADD_RISER', riser }], riserId: riser.id }
  }

  const param = def.param
  const actions: Action[] = []
  for (const groupId of liveGroupIds(state, section)) {
    const rifff = state.rifffs[groupId]
    const firstSlot = rifff.stems[0]?.slot
    const existing =
      firstSlot === undefined
        ? []
        : (state.stemAutomation[stemKey(groupId, firstSlot)]?.[param] ?? [])
    const points = tensionCurveFor(kind, existing, {
      leadBars: barsInSection,
      clipBars: clipBarsFor(state, groupId)
    })
    if (points === null) continue
    actions.push({ type: 'SET_GROUP_AUTOMATION', groupId, param, points })
  }
  return { actions, riserId: null }
}

/**
 * Switches one offer back OFF.
 *
 * For a curve this clears that one parameter on the section's clips --
 * literally the same edit right-clicking the lane makes (writeCurve deletes
 * a parameter written as an empty list, and drops the clip's whole record
 * when that was its last one, which is what lets it take the engine's
 * pre-toolkit path again).
 *
 * KNOWN AND DELIBERATE: a hand-drawn shape on top of an applied offer is
 * cleared along with it, because the curve has one set of points and
 * nothing records which of them the flow wrote. Undo is the way back, not
 * the toggle -- and the panel's own copy says so rather than leaving the
 * user to find out.
 */
export function buildCoachTensionRemovalActions(
  state: AppState,
  section: CoachSection,
  kind: CoachTensionKind,
  riserId: string | null
): Action[] {
  const def = coachTensionDef(kind)
  if (def.param === null) {
    return riserId === null ? [] : [{ type: 'REMOVE_RISER', id: riserId }]
  }
  const param = def.param
  return liveGroupIds(state, section).map((groupId) => ({
    type: 'SET_GROUP_AUTOMATION',
    groupId,
    param,
    points: []
  }))
}
