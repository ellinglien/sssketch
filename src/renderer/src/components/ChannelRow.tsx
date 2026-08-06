import { memo, useEffect, useMemo, useState } from 'react'
import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { linearWaveBarsRunningMax } from '@shared/visuals'
import type { LoopRegion } from '../state/store'
import { RifffBlockRow, NAME_BAR_HEIGHT } from './RifffBlockRow'
import { ChannelChainPanel } from './ChannelChainPanel'
import { ROW_HEIGHT } from './StemWaveformRow'
import {
  getStateSnapshot,
  useAppSelector,
  useDispatch,
  usePlaying,
  useZoom
} from '../state/StoreContext'

// A recording channel with zero clips yet renders no RifffBlockRow at all,
// so nothing establishes this row's flow height -- it would otherwise
// collapse to 0px (RifffBlockRow.tsx's own NAME_BAR_HEIGHT spacer is what
// normally does that job). Beyond just looking wrong, this silently broke
// the live capture-level overlay below: its fill collapses to a real 0px
// box inside a 0px-tall parent, so the bars were rendering (capturePeaks
// really was updating) but were invisible the entire time a channel was
// armed -- a real bug found during manual testing. Matches a single-stem
// clip's own footprint so an empty recording channel doesn't look
// jarringly different in size once a take lands on it.
const EMPTY_CHANNEL_MIN_HEIGHT = NAME_BAR_HEIGHT + ROW_HEIGHT

// Must match IpcServer.cpp's own armedRecorder->peaksFixedWindow(0.05) call
// exactly -- the live capture overlay below derives its pixel width from
// capturePeaks.length * this value, not from a separately-pushed elapsed
// time, so the two need to agree on what one bucket represents.
const LIVE_CAPTURE_BUCKET_SECONDS = 0.05

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

  // Snapshot of loopRegion as it was AT ARM TIME -- used to decide where
  // the committed take lands on the timeline (MOVE_TO_CHANNEL's
  // startBar), not its length: barLength is now derived from the audio's
  // own real captured duration (see importRecordedTake's doc comment),
  // independent of the loop region entirely, so a resize mid-recording no
  // longer needs any special handling here. Also drives the live capture
  // overlay's own left-edge position below (real state, not a ref --
  // React doesn't allow reading a ref's .current during render). Still
  // the ARMED snapshot rather than the live loopRegion selector, since
  // "where recording started" should stay fixed even if the user drags
  // the region elsewhere before disarming.
  const [armedLoopRegion, setArmedLoopRegion] = useState<LoopRegion>(null)

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
        const armedRegion = armedLoopRegion
        const result = await window.rifffApi.engineDisarmRecording()
        dispatch({ type: 'DISARM_RECORDING_CHANNEL' })
        if (result.committed && result.path) {
          // barLength is no longer derived from the loop region here --
          // importRecordedTake computes it from the audio's own real
          // captured duration instead (see its own doc comment): capture
          // is arm-to-disarm, whatever length that turns out to be, not
          // tied to the loop region's length.
          const rifff = await window.rifffApi.importRecordedTake(result.path, bpm)
          if (rifff) {
            dispatch({ type: 'ADD_TO_SHELF', rifff })
            // Replace any previous take on this channel -- see the design
            // doc's own "Retake behavior" section. Find the existing placed
            // rifff (if any) on this channel by scanning rifffs/channelOf.
            // Re-reads CURRENT live state via getStateSnapshot() rather than
            // a rifffsMap/channelOf closed over at render time -- two
            // unguarded async round-trips already happened above
            // (engineDisarmRecording, then importRecordedTake's own WAV
            // decode), during which something else could have touched this
            // channel's placed clips (e.g. a drag-and-drop landing on it
            // mid-import). Dispatching REMOVE_FROM_TIMELINE against a stale
            // snapshot could miss the actual current previous take, leaving
            // the old clip stacked alongside the new one -- same
            // stale-closure-during-an-async-gap pattern already fixed in
            // useGatedRecordingControls.ts's lockInGatedRecording.
            const liveState = getStateSnapshot()
            const previousTakeGroupId = Object.keys(liveState.rifffs).find(
              (id) =>
                liveState.rifffs[id].startBar !== undefined &&
                liveState.channelOf[id] === channelId
            )
            if (previousTakeGroupId)
              dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: previousTakeGroupId })
            dispatch({
              type: 'MOVE_TO_CHANNEL',
              groupId: rifff.groupId,
              startBar: armedRegion?.startBar ?? 0,
              channelId
            })
          }
        } else if (result.error) {
          window.alert(`Recording failed: ${result.error}`)
        } else {
          // committed: false with no error -- no minimum-length
          // requirement anymore (LoopRecorder.hasAnyAudio() just checks
          // whether anything was captured at all), so this only happens
          // if the channel was armed and disarmed with zero actual audio
          // captured in between. Whatever was already on this channel is
          // untouched (correct -- nothing to replace it with), but
          // silently doing nothing here was genuinely confusing during
          // manual testing: an old take just sitting there, revealed once
          // the live overlay disappears, read as "it recorded the wrong
          // thing" rather than "it recorded nothing."
          window.alert('Nothing recorded.')
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
          setArmedLoopRegion(loopRegion)
          dispatch({ type: 'ARM_RECORDING_CHANNEL', channelId })
          // The engine itself already jumped playback to loopRegion.startBar
          // instantly and atomically as part of the arm-recording call above
          // (see IpcServer.cpp's arm-recording handler) -- that's what
          // actually keeps captured audio and its claimed timeline placement
          // in sync. This just mirrors that into renderer state so the UI
          // (playhead, play button) reflects it immediately rather than
          // waiting for the next periodic position poll. Only dispatch PLAY
          // if we weren't already playing -- it's a state transition action,
          // not idempotent, and if already playing the engine has nothing
          // new to be told (its own enginePlay effect only fires on a
          // playing:false -> true transition).
          dispatch({ type: 'SET_POS', pos: loopRegion.startBar })
          if (!playing) {
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
      if (updateChannelId === channelId) {
        setCapturePeaks(peaks)
      }
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
      style={{
        position: 'relative',
        minHeight: rifffs.length === 0 ? EMPTY_CHANNEL_MIN_HEIGHT : undefined
      }}
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
              setChainPanelOpen((open) => !open)
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
                // Matches its siblings' (muteButtonStyle/soloButtonStyle/
                // fxButtonStyle/recordButtonStyle, all above) static
                // background/border treatment -- this button never had it
                // (confirmed via git blame: missing since it was first added
                // in 45610a4, not a recent regression), so it fell through to
                // Chromium's default <button> UA chrome (a light "ButtonFace"
                // fill with a beveled border) instead of this app's own dark
                // theme -- a bright, out-of-place box against this near-black
                // UI. No state-conditional variant needed here (unlike
                // mute/solo/record, "x" has no on/off state of its own to
                // reflect in its background/border), so this mirrors
                // fxButtonStyle's plain static styling exactly.
                background: 'var(--ra-bg-row-active)',
                border: '1px solid var(--ra-border)',
                color: 'var(--ra-text-2)',
                cursor: togglingArm ? 'not-allowed' : 'pointer'
              }}
            >
              x
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
      {isArmed && armedLoopRegion && (
        // Rendered AFTER rifffs.map above, not before -- both are plain
        // position:absolute siblings with no explicit z-index, so DOM
        // order alone decides paint order. Placed earlier, this overlay
        // was invisible any time a recording channel already had a clip
        // on it (the normal retake case): RifffBlockRow's own opaque
        // background painted straight over it. pointerEvents: none means
        // sitting on top here still can't block clicking the clip
        // underneath.
        //
        // Positioned at armedLoopRegion's startBar (where capture
        // ACTUALLY started, matching MOVE_TO_CHANNEL's own placement at
        // disarm -- see that state's own doc comment), not the live
        // loopRegion selector -- capture length is no longer tied to the
        // loop region at all, so this needs to track "where and how much
        // has actually been recorded," not "the loop's own box." Width is
        // derived from capturePeaks.length (each entry is exactly
        // LIVE_CAPTURE_BUCKET_SECONDS of real captured audio -- see
        // peaksFixedWindow's own doc comment on the native side), NOT from
        // a separately-pushed elapsedSeconds -- growing in lockstep with
        // the bars themselves means the container only ever widens in the
        // same discrete steps new bars appear in, instead of stretching
        // smoothly between bucket arrivals (which visibly "breathed" the
        // most recently drawn bar wider each frame until the next bucket
        // landed). Math.max(2, ...) keeps it from collapsing to 0px in the
        // first instant after arming, before the first bucket exists yet.
        <div
          style={{
            position: 'absolute',
            left: armedLoopRegion.startBar * ppb,
            width: Math.max(
              2,
              ((capturePeaks.length * LIVE_CAPTURE_BUCKET_SECONDS) / ((60 / bpm) * 4)) * ppb
            ),
            // NAME_BAR_HEIGHT/ROW_HEIGHT, not top:0/bottom:0 spanning this
            // whole channel row -- the row's own container includes the
            // 18px name-bar strip above where a committed clip's Waveform
            // actually renders (see RifffBlockRow.tsx), so filling the
            // whole row stretched this overlay taller than -- and shifted
            // it vertically from -- the exact lane the finished clip's own
            // waveform will occupy. This matches that lane exactly.
            top: NAME_BAR_HEIGHT,
            height: ROW_HEIGHT,
            pointerEvents: 'none'
          }}
        >
          {/* Same linearWaveBars geometry Waveform.tsx uses for every other
              clip's waveform (centered bars in a 128x100 viewBox, edge to
              edge, crisp edges) -- not a from-scratch bar-graph look, per
              feedback asking this to read more like "the waveforms
              elsewhere." No brightness modulation (that's the zero-
              crossing-rate "spectrographic" layer Waveform.tsx also draws --
              explicitly not wanted here) and no pitch line -- still no glow
              (an earlier, separate, explicit design decision). Full
              opacity, not Waveform.tsx's usual 0.75. Uses the dedicated
              --ra-recording-live purple, which is the SAME purple
              --ra-type-audio-in now uses for a committed clip too -- live
              and final read as one continuous color language rather than
              switching partway through.

              linearWaveBarsRunningMax, not linearWaveBars -- the latter
              normalizes every bar's height against Math.max(peaks) across
              the WHOLE array, which for a live, growing array meant a
              louder bucket arriving later in the take retroactively shrank
              every bar already on screen (the "waveform looks animated"
              bug). linearWaveBarsRunningMax normalizes each bar only
              against peaks up to and including its own index -- values
              that never change once present -- so a bar's height, once
              drawn, is provably stable on every later poll, while still
              tracking toward the same auto-normalized look
              Waveform.tsx's own linearWaveBars gives the finished clip. */}
          <svg width="100%" height="100%" viewBox="0 0 128 100" preserveAspectRatio="none">
            {linearWaveBarsRunningMax(capturePeaks).map((bar, i) => (
              <rect
                key={i}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill="var(--ra-recording-live)"
                shapeRendering="crispEdges"
              />
            ))}
          </svg>
        </div>
      )}
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
