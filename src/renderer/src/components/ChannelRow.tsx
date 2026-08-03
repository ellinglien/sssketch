import { memo, useEffect, useMemo, useState } from 'react'
import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { RifffBlockRow } from './RifffBlockRow'
import { ChannelChainPanel } from './ChannelChainPanel'
import { useAppSelector, useDispatch, usePlaying, useZoom } from '../state/StoreContext'
import { typeColorVar } from '../theme/typeColor'

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
  const ppb = useZoom()

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

  // Guards handleToggleArm against a rapid double-click re-entering it
  // mid-flight -- canArm/isArmed alone don't cover this, since both stay
  // in their PRE-click state for the whole duration of the async IPC
  // round-trip (and, on disarm, the file-copy afterward), not just a
  // sub-frame window. A second click during that window would otherwise
  // re-enter the same branch with a stale isArmed closure and fire a
  // second concurrent engine call. Real state (not a ref) deliberately --
  // this also disables/dims the button visually while in flight, not just
  // preventing the second call silently. A couple of extra re-renders of
  // this one row for a rare, deliberate user click doesn't undermine this
  // component's own React.memo/fine-grained-selector work, which is about
  // avoiding re-renders from UNRELATED dispatches elsewhere, not from a
  // row's own direct interaction with itself.
  const [togglingArm, setTogglingArm] = useState(false)
  // Arming is blocked without a selected input device (nothing to record
  // from) or mid-toggle; disarming is always allowed regardless of device,
  // but still blocked mid-toggle.
  const canArm = !togglingArm && (isArmed || !!selectedInputDevice)

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
    if (togglingArm) return
    setTogglingArm(true)
    try {
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
    } catch (err) {
      // Defense in depth -- every IPC call this function makes is expected
      // to always resolve rather than reject (see their own main-process
      // handlers' try/catch), but if that invariant is ever broken, fail
      // visibly instead of leaving an unhandled rejection and a channel
      // stuck mid-toggle with no user-facing feedback.
      console.error('ChannelRow: arm/disarm toggle failed:', err)
      window.alert(`Recording action failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTogglingArm(false)
    }
  }

  // Removing an armed channel needs to disarm the engine side first --
  // REMOVE_RECORDING_CHANNEL is a pure renderer-state action with no engine
  // call of its own, and the engine's armedRecorder has no other way to
  // learn its target channel is gone. Without this, the engine keeps
  // capturing into a LoopRecorder for a channelId that no longer exists
  // anywhere in the UI until something else happens to arm (and thus
  // clobber it via previousRecorder's deferred free -- see IpcServer.cpp).
  // Discards whatever take result comes back rather than importing it: the
  // user explicitly chose to delete this channel, not commit a take to it.
  // Shares togglingArm with handleToggleArm above so the two can't race
  // each other (e.g. removing mid-arm/disarm, or double-clicking remove).
  async function handleRemoveRecordingChannel(): Promise<void> {
    if (togglingArm) return
    if (!window.confirm('Remove this recording channel?')) return
    if (isArmed) {
      setTogglingArm(true)
      try {
        const result = await window.rifffApi.engineDisarmRecording()
        if (result.error) {
          // Still remove the channel below (the user already confirmed a
          // destructive action) but say so -- silently continuing here
          // would defeat the entire point of disarming first: the engine
          // may still be actively recording into a channel nothing in the
          // UI references anymore.
          window.alert(
            `Channel removed, but the engine may still be recording (disarm failed: ${result.error}). Restart if audio behaves oddly.`
          )
        }
      } catch (err) {
        console.error('ChannelRow: failed to disarm before removing channel:', err)
        window.alert(
          `Channel removed, but the engine may still be recording (disarm failed: ${err instanceof Error ? err.message : String(err)}). Restart if audio behaves oddly.`
        )
      } finally {
        setTogglingArm(false)
      }
    }
    dispatch({ type: 'REMOVE_RECORDING_CHANNEL', channelId })
  }

  // Live "building up" waveform feedback while this channel is armed -- see
  // docs/superpowers/specs/2026-08-03-loop-recording-design.md's "Live
  // capture feedback" section. Subscribes only while armed (unsubscribes and
  // clears immediately on disarm, rather than leaving a stale bar graph
  // sitting there) since the engine only pushes capture-level-update while
  // some channel is actually armed (see IpcServer.cpp's timerCallback).
  const [capturePeaks, setCapturePeaks] = useState<number[]>([])
  useEffect(() => {
    if (!isArmed) return
    const unsubscribe = window.rifffApi.onCaptureLevelUpdate((updateChannelId, peaks) => {
      if (updateChannelId === channelId) setCapturePeaks(peaks)
    })
    // Reset lives in the cleanup, not the setup body -- calling setState
    // synchronously in an effect's setup trips react-hooks/set-state-in-effect
    // (see BeatPicker.tsx's identical reasoning on its own preview-stop
    // effect). Cleanup fires both when isArmed flips back to false and on
    // unmount, so the bar graph never lingers stale after a disarm.
    return () => {
      unsubscribe()
      setCapturePeaks([])
    }
  }, [isArmed, channelId])

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
          {isRecordingChannel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void handleRemoveRecordingChannel()
              }}
              disabled={togglingArm}
              aria-label={`remove recording channel ${channelId}`}
              title="remove recording channel"
              style={{
                ...baseButtonStyle,
                color: 'var(--ra-text-2)',
                cursor: togglingArm ? 'not-allowed' : 'pointer'
              }}
            >
              x
            </button>
          )}
        </div>
      </div>
      {isArmed && loopRegion && (
        <div
          style={{
            position: 'absolute',
            left: loopRegion.startBar * ppb,
            width: (loopRegion.endBar - loopRegion.startBar) * ppb,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            padding: '0 2px',
            pointerEvents: 'none'
          }}
        >
          {capturePeaks.map((peak, i) => (
            <div
              key={i}
              style={{
                width: 3,
                height: `${Math.max(4, peak * 100)}%`,
                background: peak > 0 ? typeColorVar('audioIn') : 'var(--ra-border)'
              }}
            />
          ))}
        </div>
      )}
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
