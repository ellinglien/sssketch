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
  lastAppliedRiserId,
  tensionCurveFor,
  type CoachTensionApplied,
  type CoachTensionKind
} from '@shared/coachTension'
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

/** This section's clips that are still on the timeline, in the order phase
 * two placed them. A groupId the user has since deleted is skipped rather
 * than throwing -- the arrangement is ordinary material, and deleting a
 * clip is an ordinary thing to do to it. */
function liveGroupIds(state: AppState, section: CoachSection): string[] {
  return Object.values(section.placedGroupIds).filter(
    (groupId) => state.rifffs[groupId] !== undefined
  )
}

/**
 * The arranger row the NEXT flow-placed riser should join: the one the most
 * recent flow-placed riser is on, or null when there is none (the caller
 * then mints a fresh channel id).
 *
 * Why reuse rather than a row per riser: a riser is not a stem, so it does
 * not belong on a stem's row -- but a track with three drops would
 * otherwise grow three riser rows, which reads as three instruments rather
 * than as one. Reusing is also exactly what a user dragging the second
 * riser would do by hand.
 */
export function coachRiserChannelId(
  state: AppState,
  tension: readonly CoachTensionApplied[]
): string | null {
  const riserId = lastAppliedRiserId(tension)
  if (riserId === null) return null
  return state.risers[riserId]?.channelId ?? null
}

/**
 * Switches one offer ON.
 *
 * `ids.riserId` and `ids.channelId` are minted by the caller (crypto.
 * randomUUID, like every other freshly-minted id in the renderer) and
 * injected rather than generated here, so this stays a pure function with
 * pinnable output. `ids.channelId` is only used when the flow has no riser
 * row yet -- see coachRiserChannelId.
 */
export function buildCoachTensionActions(
  state: AppState,
  section: CoachSection,
  kind: CoachTensionKind,
  ids: { riserId: string; channelId: string }
): CoachTensionApplication {
  const def = coachTensionDef(kind)

  if (def.param === null) {
    const { startBar, lengthBars } = coachRiserFieldsFor({
      bar: section.startBar + section.bars,
      leadBars: section.bars
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
      leadBars: section.bars,
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
