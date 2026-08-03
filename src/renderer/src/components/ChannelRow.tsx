import { memo, useMemo, useState } from 'react'
import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { RifffBlockRow } from './RifffBlockRow'
import { ChannelChainPanel } from './ChannelChainPanel'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'

/** One arranger row, hosting every clip currently assigned to this channel
 * (see channelOf in store.ts) — could be exactly one clip (today's default,
 * unchanged visually) or several sharing the row, each still positioned by
 * its own clipGeometry exactly as RifffBlockRow already does; if two
 * overlap in time they'll visually overlap too; z-order (which one's on
 * top) follows plain array order, matching the design spec.
 *
 * This component owns the row's own onDrop, stopping propagation so a drop
 * landing here reassigns the dragged clip's channel to THIS one (see
 * App.tsx's Timeline, which supplies onDropOnChannel) rather than falling
 * through to the Timeline container's own fallback (which always means
 * "give it a brand new channel instead").
 *
 * Also owns the channel's M/S/fx button stack (mute/solo the whole channel
 * at once via SET_CHANNEL_MUTE/SOLO_CHANNEL, plus the "fx" button opening
 * this channel's own 2-slot plugin chain panel — see
 * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md).
 * Pinned to the row's own right edge with position:sticky so it stays on
 * screen while the timeline scrolls horizontally, rather than the clip
 * title (which lives at the LEFT of each clip, per RifffBlockRow) ever
 * being covered. The sticky element itself has height:0 so it never adds
 * to the row's own flow height -- the actual visible buttons hang off it
 * via an absolutely-positioned child, a standard "zero-size sticky anchor"
 * technique for pinning an overlay to a scrolling viewport's edge without
 * disturbing surrounding layout. */
function ChannelRowImpl({
  channelId,
  rifffs,
  onOpenContextMenu,
  onDropOnChannel
}: {
  channelId: string
  rifffs: Rifff[]
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
  onDropOnChannel: (e: React.DragEvent<HTMLDivElement>, channelId: string) => void
}): React.JSX.Element {
  const [chainPanelOpen, setChainPanelOpen] = useState(false)
  const dispatch = useDispatch()
  // Read as whole maps, not per-key -- the solo check below genuinely needs
  // every rifff/mute entry in the project, not just this channel's own. This
  // still helps: this component now only re-renders when mute state or the
  // rifffs map actually changes, not on every dispatch anywhere (a volume
  // drag, fade adjustment, tempo change, etc. no longer touches it). See
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const mute = useAppSelector((s) => s.mute)
  const rifffsMap = useAppSelector((s) => s.rifffs)
  const isRecordingChannel = useAppSelector((s) => !!s.recordingChannelIds[channelId])
  const isArmed = useAppSelector((s) => s.armedChannelId === channelId)
  const selectedInputDevice = useAppSelector((s) => s.selectedInputDevice)
  const bpm = useAppSelector((s) => s.bpm)
  const channelOf = useAppSelector((s) => s.channelOf)
  const loopRegion = useAppSelector((s) => s.loopRegion)
  const playing = usePlaying()

  const allMuted = useMemo(
    () =>
      rifffs.length > 0 &&
      rifffs.every((r) => r.stems.every((s) => mute[stemKey(r.groupId, s.slot)])),
    [rifffs, mute]
  )

  // Mirrors SOLO_GROUP/SOLO_CHANNEL's own "alreadySoloed" definition in
  // store.ts: every stem in this channel unmuted, every stem in every other
  // PLACED channel muted. When there's only one channel on the timeline
  // this is trivially true even with nothing "soloed" -- same accepted edge
  // case the pre-existing SOLO_GROUP check already has, not a new one.
  //
  // Scans EVERY rifff in the whole project, not just this channel's own --
  // memoized so that scan only re-runs when mute state or the project's own
  // rifff set actually changes.
  const soloed = useMemo(() => {
    const channelGroupIds = new Set(rifffs.map((r) => r.groupId))
    return Object.values(rifffsMap).every((r) => {
      if (r.startBar === undefined) return true
      const inThisChannel = channelGroupIds.has(r.groupId)
      return r.stems.every((s) => !!mute[stemKey(r.groupId, s.slot)] === !inThisChannel)
    })
  }, [rifffs, rifffsMap, mute])

  const baseButtonStyle: React.CSSProperties = {
    fontSize: 9,
    padding: '1px 4px',
    fontFamily: 'inherit',
    borderRadius: 2,
    cursor: 'pointer'
  }

  // Matches StemWaveformRow's own mute-active treatment: a filled reddish
  // background rather than just a colored border, so a muted channel reads
  // clearly even at this stack's small size.
  const muteButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: allMuted ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${allMuted ? 'var(--ra-mute-on)' : 'var(--ra-border)'}`,
    color: allMuted ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)'
  }

  // Matches Inspector's own stretch-toggle treatment: a soft tinted
  // background with the accent color on border/text, not a hard fill.
  const soloButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: soloed ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${soloed ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: soloed ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
  }

  const fxButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    color: 'var(--ra-text-2)'
  }

  // Arming is blocked without a selected input device (nothing to record
  // from); disarming is always allowed regardless.
  const canArm = isArmed || !!selectedInputDevice

  // Same "filled red = active/attention-grabbing state" treatment the mute
  // button already uses, reusing this app's own audio-in accent color.
  const recordButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: isArmed ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${isArmed ? 'var(--ra-mute-on)' : 'var(--ra-border)'}`,
    color: isArmed ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)',
    opacity: canArm ? 1 : 0.3,
    cursor: canArm ? 'pointer' : 'not-allowed'
  }

  async function handleToggleArm(): Promise<void> {
    if (isArmed) {
      const result = await window.rifffApi.engineDisarmRecording()
      dispatch({ type: 'DISARM_RECORDING_CHANNEL' })
      if (result.committed && result.path) {
        const rifff = await window.rifffApi.importRecordedTake(
          result.path,
          bpm,
          (loopRegion?.endBar ?? 0) - (loopRegion?.startBar ?? 0)
        )
        if (rifff) {
          dispatch({ type: 'ADD_TO_SHELF', rifff })
          // Replace any previous take on this channel -- see the design
          // doc's own "Retake behavior" section. Find the existing placed
          // rifff (if any) on this channel by scanning rifffsMap/channelOf.
          const previousTakeGroupId = Object.keys(rifffsMap).find(
            (id) => rifffsMap[id].startBar !== undefined && channelOf[id] === channelId
          )
          if (previousTakeGroupId)
            dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: previousTakeGroupId })
          dispatch({
            type: 'MOVE_TO_CHANNEL',
            groupId: rifff.groupId,
            startBar: loopRegion?.startBar ?? 0,
            channelId
          })
        }
      } else if (result.error) {
        window.alert(`Recording failed: ${result.error}`)
      }
    } else {
      if (!selectedInputDevice || !loopRegion) return
      const result = await window.rifffApi.engineArmRecording(
        channelId,
        selectedInputDevice,
        loopRegion.startBar,
        loopRegion.endBar
      )
      if (result.success) {
        dispatch({ type: 'ARM_RECORDING_CHANNEL', channelId })
        if (!playing) {
          dispatch({ type: 'SET_POS', pos: loopRegion.startBar })
          dispatch({ type: 'PLAY' })
        }
      } else {
        window.alert(`Failed to arm recording: ${result.error ?? 'unknown error'}`)
      }
    }
  }

  return (
    <div
      data-channel-id={channelId}
      onDrop={(e) => onDropOnChannel(e, channelId)}
      style={{ position: 'relative' }}
    >
      <div style={{ position: 'sticky', right: 0, top: 0, height: 0, zIndex: 5 }}>
        <div
          style={{
            position: 'absolute',
            right: 4,
            top: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SET_CHANNEL_MUTE', channelId, muted: !allMuted })
            }}
            aria-label={`mute channel ${channelId}`}
            title="mute channel"
            style={muteButtonStyle}
          >
            m
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SOLO_CHANNEL', channelId })
            }}
            aria-label={`solo channel ${channelId}`}
            title="solo channel"
            style={soloButtonStyle}
          >
            s
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setChainPanelOpen(true)
            }}
            aria-label={`channel ${channelId} plugin chain`}
            title="channel plugin chain"
            style={fxButtonStyle}
          >
            fx
          </button>
          {isRecordingChannel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void handleToggleArm()
              }}
              disabled={!canArm}
              aria-label={
                isArmed ? `disarm channel ${channelId}` : `arm channel ${channelId} for recording`
              }
              title={
                selectedInputDevice
                  ? isArmed
                    ? 'disarm recording'
                    : 'arm for recording'
                  : 'select an input device first'
              }
              style={recordButtonStyle}
            >
              r
            </button>
          )}
        </div>
      </div>
      {rifffs.map((rifff) => (
        <RifffBlockRow
          key={rifff.groupId}
          groupId={rifff.groupId}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
      {chainPanelOpen && (
        <ChannelChainPanel channelId={channelId} onClose={() => setChainPanelOpen(false)} />
      )}
    </div>
  )
}

// Memoized because Timeline (its parent) re-renders on every dispatch --
// without this, ChannelRow would re-render on every mute toggle/volume
// drag/fade tweak project-wide regardless of its own useAppSelector calls
// above, since React always re-invokes a non-memoized child's render
// function when its parent re-renders. This only pays off because all of
// Timeline's props to ChannelRow are now referentially stable across
// unrelated dispatches: `rifffs` comes from Timeline's own memoized
// `channels` array, and `onOpenContextMenu`/`onDropOnChannel` are both
// useCallback-wrapped (see App.tsx's stateRef comments for how they stay
// stable). See docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
export const ChannelRow = memo(ChannelRowImpl)
