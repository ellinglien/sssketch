import { Dial } from './Dial'
import { dbLabel } from '@shared/visuals'
import { stemKey } from '@shared/types'
import { scheduleLiveParamSync } from './liveParamSync'
import { useAppSelector, useDispatch } from '../state/StoreContext'

/** The dial's own size. Small enough to sit in a 44px row's control stack
 * beside the m/s letters (ChannelRow's own buttons are ~15px tall) without
 * crowding it -- "a very tiny dial on the right of each channel? where the
 * letters are" (Elling, 2026-09-22). */
const DIAL_SIZE = 18

/** How far in from the row's right edge the dial sits. ChannelRow's m/s/fx
 * stack is pinned at right: 4 and each button is ~16px wide, so this parks
 * the dial in its own column immediately to the LEFT of those letters
 * rather than underneath them. */
const DIAL_RIGHT_PX = 26

/** Whose gain this dial moves. An EXPANDED rifff shows one row per stem, so
 * each dial owns exactly its own stem; a COLLAPSED one draws its stems as a
 * single block, so its one dial moves the whole rifff together -- the same
 * rule SET_GROUP_VOLUME/SET_GROUP_MUTE and the collapsed automation lane
 * already follow, rather than a third convention. Either way the gain is
 * STORED per stem (state.vol, keyed by stemKey), so expanding a collapsed
 * clip afterwards reveals per-stem dials that can then diverge. */
export type GainDialTarget =
  | { kind: 'stem'; stemKey: string }
  | { kind: 'group'; groupId: string; representativeStemKey: string }

/**
 * The static per-stem gain (state.vol), as a knob pinned to the right edge
 * of one arranger row.
 *
 * This is the LEVEL. The clip's automation lane's `volume` curve is its
 * SHAPE, and the two multiply -- see buildEngineProject's buildStemToolkit,
 * which scales the curve it sends by this gain so the engine's own
 * curve-wins rule still comes out as "dial times curve". Elling's framing
 * when the drawn envelope was replaced by the lane: "we might need a spot
 * for people to adjust the gain per stem. maybe a very tiny dial on the
 * right of each channel? where the letters are."
 *
 * The drag split is the one this codebase already uses for every other
 * live-audible drag (docs/superpowers/specs/2026-08-04-live-drag-preview-
 * design.md + 2026-08-04-live-param-fast-path-design.md): every value
 * change writes a transient SET_DRAG_PREVIEW and pushes a live param
 * straight to the engine, and exactly one SET_VOLUME/SET_GROUP_VOLUME
 * lands when the gesture finishes (Dial's own onCommit). So a drag is one
 * undo step, not one per mousemove -- and that commit is also what clears
 * the native live override, indirectly: it triggers StoreContext's
 * full-reload effect, and the engine's load-project handler drops every
 * override once that reload lands. Removing it would leave the engine
 * stuck on this drag's last live value forever.
 *
 * One known gap, worth stating rather than discovering by ear: the engine
 * ignores a live volume override on a clip that HAS a volume curve (it
 * renders the curve at unity instead -- PlaybackEngine.cpp's
 * `volumeAutomated`), so on such a clip the dial only becomes audible when
 * the drag commits and the project reloads with the curve rescaled. Every
 * clip without a drawn volume curve -- which is nearly all of them --
 * tracks the drag live.
 */
export function RowGainDial({
  target,
  defaultGain,
  ariaLabel
}: {
  target: GainDialTarget
  /** Where a double-click puts it back to -- the same import-time default
   * (mixGain.ts's sqrtGain over the rifff's stem count) the waveform's own
   * double-click-to-reset already uses, so the two gestures agree. */
  defaultGain: number
  ariaLabel: string
}): React.JSX.Element {
  const dispatch = useDispatch()
  const key = target.kind === 'stem' ? target.stemKey : target.representativeStemKey
  const committed = useAppSelector((s) => s.vol[key] ?? 1)
  const preview = useAppSelector((s) => s.dragVol[key] ?? null)
  // Only a group dial needs this (to fan its live value out across every
  // stem); reading it for a stem dial too keeps the hook order fixed, which
  // is what a conditional useAppSelector would break.
  const groupStems = useAppSelector((s) =>
    target.kind === 'group' ? s.rifffs[target.groupId].stems : null
  )
  const gain = preview ?? committed

  function handleChange(dialValue: number): void {
    const value = dialValue / 100
    if (target.kind === 'stem') {
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value })
      scheduleLiveParamSync('volume', key, value)
      return
    }
    dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId: target.groupId, value })
    // Fans out to every stem, matching SET_DRAG_PREVIEW_GROUP_VOLUME's own
    // fan-out -- this dial moves the whole rifff, so every stem's live
    // override needs updating, not just the representative one.
    for (const stem of groupStems ?? []) {
      scheduleLiveParamSync('volume', stemKey(target.groupId, stem.slot), value)
    }
  }

  function handleCommit(dialValue: number): void {
    const value = dialValue / 100
    if (target.kind === 'stem') {
      dispatch({ type: 'SET_VOLUME', stemKey: key, volume: value })
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      return
    }
    dispatch({ type: 'SET_GROUP_VOLUME', groupId: target.groupId, volume: value })
    dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId: target.groupId, value: undefined })
  }

  return (
    // Zero-height sticky anchor, the same technique ChannelRow's own m/s/fx
    // stack uses: the dial hangs off it absolutely, so it stays on screen
    // while the timeline scrolls horizontally without adding anything to
    // the row's own flow height.
    <div style={{ position: 'sticky', right: 0, top: 0, height: 0, zIndex: 6 }}>
      <div style={{ position: 'absolute', right: DIAL_RIGHT_PX, top: 2 }}>
        <Dial
          value={Math.round(gain * 100)}
          onChange={handleChange}
          onCommit={handleCommit}
          defaultValue={Math.round(defaultGain * 100)}
          size={DIAL_SIZE}
          ariaLabel={ariaLabel}
          tooltip={`gain ${dbLabel(gain)} dB -- drag, scroll or arrow keys; double-click resets`}
        />
      </div>
    </div>
  )
}
