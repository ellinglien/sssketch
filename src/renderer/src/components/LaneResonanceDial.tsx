import { useState } from 'react'
import { Dial } from './Dial'
import { useAppSelector, useDispatch } from '../state/StoreContext'

/** The dial's own size. Smaller than RowGainDial's 18px: this one sits
 * INSIDE the lane, in the same corner cluster as the parameter picker,
 * which has a 44px-tall lane to share with the curve being drawn. 16px
 * leaves the cluster no taller than the picker plus a couple of pixels. */
const DIAL_SIZE = 16

/** Whose resonance this dial moves. An EXPANDED rifff shows one lane per
 * stem, so each dial owns exactly its own stem; a COLLAPSED one draws its
 * stems as a single block, so its one dial moves the whole rifff together --
 * the same rule the collapsed lane's own curve and SET_GROUP_VOLUME /
 * SET_GROUP_MUTE already follow. Either way the value is STORED per stem
 * (state.stemFilters, keyed by stemKey), so expanding a collapsed clip
 * afterwards reveals per-stem dials that can then diverge.
 *
 * Structurally identical to AutomationLane's own AutomationLaneTarget (and
 * to RowGainDial's GainDialTarget) rather than imported from it -- the lane
 * imports this component, so taking its type back would be a cycle. */
export type ResonanceDialTarget =
  | { kind: 'stem'; stemKey: string }
  | { kind: 'group'; groupId: string; representativeStemKey: string }

/**
 * The filter's RESONANCE, as a knob in the corner of the filter lane you
 * draw the cutoff in.
 *
 * Resonance was briefly a drawable lane of its own, and Elling, using it:
 * "that's confusing to have it separate from cut though isn't it?" It is --
 * resonance is a peak AT the cutoff corner, so a resonance curve on a clip
 * whose cutoff isn't moving does nothing audible, which reads as a broken
 * lane. So there is ONE filter lane, drawn, with its resonance as a stored
 * per-clip setting on a knob beside it. Ableton's Auto Filter works exactly
 * this way (you automate Frequency; Resonance is a knob), which is also
 * what both export mappings already describe.
 *
 * The drag split is the same one every other dial here uses (Dial's own
 * onChange/onCommit): the in-progress value is LOCAL to this component and
 * exactly one SET_STEM_FILTER_RESONANCE / SET_GROUP_FILTER_RESONANCE lands
 * when the gesture finishes, so a drag is one undo step and one engine
 * reload rather than one of each per mousemove. No SET_DRAG_PREVIEW and no
 * live param push, unlike RowGainDial: nothing outside this dial needs to
 * see a half-turned knob, and the engine has no live fast-path field for
 * resonance (adding one would be an engine change, which this deliberately
 * is not). So a turn becomes audible when it commits, not during.
 */
export function LaneResonanceDial({
  target,
  ariaLabel
}: {
  target: ResonanceDialTarget
  ariaLabel: string
}): React.JSX.Element {
  const dispatch = useDispatch()
  const key = target.kind === 'stem' ? target.stemKey : target.representativeStemKey
  // A clip with no filter settings at all has no resonance -- absence and
  // zero are the same thing here, which is what lets an untouched clip stay
  // off the wire entirely (buildEngineProject).
  const committed = useAppSelector((s) => s.stemFilters[key]?.resonance ?? 0)
  const [preview, setPreview] = useState<number | null>(null)
  const resonance = preview ?? committed

  function handleCommit(dialValue: number): void {
    const value = dialValue / 100
    setPreview(null)
    if (target.kind === 'stem') {
      dispatch({ type: 'SET_STEM_FILTER_RESONANCE', stemKey: key, resonance: value })
      return
    }
    dispatch({ type: 'SET_GROUP_FILTER_RESONANCE', groupId: target.groupId, resonance: value })
  }

  return (
    <Dial
      value={Math.round(resonance * 100)}
      onChange={(dialValue) => setPreview(dialValue / 100)}
      onCommit={handleCommit}
      // Zero: no resonance at all, which is also what an untouched clip
      // has -- so a double-click genuinely puts the clip back rather than
      // to some arbitrary middle.
      defaultValue={0}
      size={DIAL_SIZE}
      ariaLabel={ariaLabel}
      tooltip={`resonance ${Math.round(resonance * 100)} -- sharpens the filter corner, so it is only audible where the drawn cutoff moves; drag, scroll or arrow keys, double-click resets`}
    />
  )
}
