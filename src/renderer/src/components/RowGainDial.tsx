import { Dial } from './Dial'
import { dbLabel } from '@shared/visuals'
import { stemKey } from '@shared/types'
import { scheduleLiveParamSync } from './liveParamSync'
import { useAppSelector, useDispatch } from '../state/StoreContext'
import { ARRANGEMENT_FIRST_GAIN_TOP, ARRANGEMENT_MIXER_CONTROL_INSET } from './arrangementMixerRail'
import { MixerRailAnchor } from './MixerRailAnchor'

/** The dial's own size. Small enough to continue the narrow right-edge
 * control stack beneath the channel's m/s letters without crowding it. */
const DIAL_SIZE = 18

/** Whose gain this dial moves. An EXPANDED rifff shows one row per stem, so
 * each dial owns exactly its own stem; a COLLAPSED one draws its stems as a
 * single block, so its one dial moves the whole rifff together -- the same
 * rule SET_GROUP_VOLUME/SET_GROUP_MUTE and the collapsed automation lane
 * already follow, rather than a third convention. Either way the gain is
 * STORED per stem (state.vol, keyed by stemKey), so expanding a collapsed
 * clip afterwards reveals per-stem dials that can then diverge.
 *
 * A RISER is the odd one out and deliberately shares this control anyway: it
 * has no stem and no state.vol entry, so its number is RiserClip.level and
 * its commit is SET_RISER_LEVEL. It gets this dial rather than a knob of its
 * own because a riser now owns a whole arranger row (2026-09-23), and one
 * row should have exactly one level control in exactly one place -- the
 * riser's old corner knob (RiserBlock.tsx) was removed in the same change
 * rather than shipping two that fight. */
export type GainDialTarget =
  | { kind: 'stem'; stemKey: string }
  | { kind: 'group'; groupId: string; representativeStemKey: string }
  | { kind: 'riser'; riserId: string }

/**
 * The static per-stem gain (state.vol), as a knob in the narrow mixer column
 * pinned to the right edge of one arranger row.
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
  ariaLabel,
  belowChannelButtons = false
}: {
  target: GainDialTarget
  /** Where a double-click puts it back to -- the same import-time default
   * (mixGain.ts's sqrtGain over the rifff's stem count) the waveform's own
   * double-click-to-reset already uses, so the two gestures agree. */
  defaultGain: number
  ariaLabel: string
  /** The first/only gain in a channel starts below Mute and Solo. Additional
   * expanded-stem gains sit at the top of their own rows, continuing down
   * the same narrow mixer column without wasting vertical space. */
  belowChannelButtons?: boolean
}): React.JSX.Element {
  const dispatch = useDispatch()
  const key =
    target.kind === 'stem'
      ? target.stemKey
      : target.kind === 'group'
        ? target.representativeStemKey
        : target.riserId
  const stemGain = useAppSelector((s) => s.vol[key] ?? 1)
  // A riser's level is on the riser, not in state.vol. Read unconditionally
  // (null for the other two kinds) so the hook order stays fixed, which is
  // what a conditional useAppSelector would break.
  const riserLevel = useAppSelector((s) =>
    target.kind === 'riser' ? (s.risers[target.riserId]?.level ?? null) : null
  )
  // ?? not ||: a riser dialled to 0 is a real value, not "unset".
  const committed = riserLevel ?? stemGain
  // The in-progress drag, for every kind. A riser reuses state.dragVol keyed
  // by its own id: dragVol keys are stemKeys (`${groupId}:${slot}`), so a
  // crypto.randomUUID riser id cannot collide with one, SET_DRAG_PREVIEW is
  // already transient in history.ts, and state.dragVol is deliberately NOT
  // in StoreContext's engine-sync deps -- so a riser level drag costs zero
  // undo checkpoints and zero engine reloads until it lands. (Before this,
  // the riser's corner knob dispatched SET_RISER_LEVEL on every mousemove,
  // which is one undo checkpoint per mousemove -- a real bug this fixes.)
  const preview = useAppSelector((s) => s.dragVol[key] ?? null)
  // Only a group dial needs this (to fan its live value out across every
  // stem); reading it for the other kinds too keeps the hook order fixed.
  const groupStems = useAppSelector((s) =>
    target.kind === 'group' ? s.rifffs[target.groupId].stems : null
  )
  const gain = preview ?? committed

  function handleChange(dialValue: number): void {
    const value = dialValue / 100
    if (target.kind === 'riser') {
      // No scheduleLiveParamSync: the engine has no live-override path for a
      // generated riser (liveParamSync's params are all per-stem), so the
      // new level becomes audible on the commit's own project reload. The
      // knob and the block's drawn swell both track the drag from dragVol.
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value })
      return
    }
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
    if (target.kind === 'riser') {
      dispatch({ type: 'SET_RISER_LEVEL', id: target.riserId, level: value })
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      return
    }
    if (target.kind === 'stem') {
      dispatch({ type: 'SET_VOLUME', stemKey: key, volume: value })
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      return
    }
    dispatch({ type: 'SET_GROUP_VOLUME', groupId: target.groupId, volume: value })
    dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId: target.groupId, value: undefined })
  }

  return (
    // Pinned into the mixer rail the same way ChannelRow's m/s/fx stack is,
    // so the dial stays on screen beside the inspector however long the
    // timeline is.
    <MixerRailAnchor zIndex={6}>
      <div
        style={{
          position: 'absolute',
          right: ARRANGEMENT_MIXER_CONTROL_INSET,
          top: belowChannelButtons ? ARRANGEMENT_FIRST_GAIN_TOP : 2,
          padding: 2
        }}
      >
        <Dial
          value={Math.round(gain * 100)}
          onChange={handleChange}
          onCommit={handleCommit}
          defaultValue={Math.round(defaultGain * 100)}
          size={DIAL_SIZE}
          ariaLabel={ariaLabel}
          tooltip={`gain ${dbLabel(gain)} dB`}
        />
      </div>
    </MixerRailAnchor>
  )
}
