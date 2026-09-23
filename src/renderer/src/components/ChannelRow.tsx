import { memo, useEffect, useMemo, useState } from 'react'
import type { BusId, Rifff } from '@shared/types'
import type { LoopRegion } from '../state/store'
import { channelAllMuted, channelIsSoloed } from '../state/selectors'
import { RifffBlockRow, NAME_BAR_HEIGHT } from './RifffBlockRow'
import { RiserBlock } from './RiserBlock'
import { ChannelChainPanel } from './ChannelChainPanel'
import { ROW_HEIGHT } from './StemWaveformRow'
import { busColorHex } from '../theme/typeColor'
import { risersOnChannel } from '@shared/riser'
import { linearToMeterFraction, nextMeterValue } from '../audio/meterBallistics'
import {
  getStateSnapshot,
  useAppSelector,
  useDispatch,
  usePlaying,
  useZoom
} from '../state/StoreContext'

// The right-edge m/s/fx/r/x button stack (rendered further down, an
// absolutely-positioned flex column with gap: 2, anchored at top: 4 from
// this row's own top edge) can hold up to 5 buttons -- m, s, fx, r, x, the
// last two only for isRecordingChannel rows -- or as few as 3 (m, s, fx)
// for a non-recording one. Every button in it shares baseButtonStyle's
// fontSize: 9 and padding: '1px 4px' (1px top + 1px bottom), plus, per its
// own variant style just below (muteButtonStyle/soloButtonStyle/
// fxButtonStyle/recordButtonStyle/the inline "x" button style), a 1px
// solid border on all sides. With no explicit height set anywhere, a
// button's own rendered height is roughly its font-size plus the browser's
// own line-height slack above/below a 9px line (~2px), plus that 2px of
// padding and 2px of border:
//   9 (font) + 2 (line-height slack) + 2 (padding) + 2 (border) = ~15px
// A full 5-button stack then needs:
//   5 buttons x ~15px                            = 75
//   + 4 gaps x 2px (the stack's own gap: 2)       = 8
//   + top: 4 (the stack's own offset from the row's top edge) = 4
//   + ~4px bottom breathing room                  = 4
//   = ~91px
//
// This was previously enforced ONLY on empty channels (rifffs.length ===
// 0), via a smaller EMPTY_CHANNEL_MIN_HEIGHT (NAME_BAR_HEIGHT + ROW_HEIGHT
// = 18 + 44 = 62px) -- that number was meant only to match a single placed
// clip's own visual footprint (so an empty recording channel doesn't look
// jarringly different in size once a take lands on it) and has nothing to
// do with the button stack; at 62px it's actually SMALLER than the 91px a
// 5-button recording channel needs, so even an empty recording channel
// could already have collided before this fix. Non-empty rows had no
// minHeight at all, driven purely by their RifffBlockRow children's own
// flow height -- exactly what let the buttons visibly overlap a short row
// in the reported screenshot.
//
// Applied uniformly below to every channel row's container -- empty or
// not, recording or not. 91px comfortably covers both the old footprint-
// matching goal (62px) and the button-collision fix in one constant, so
// this fully replaces EMPTY_CHANNEL_MIN_HEIGHT rather than coexisting with
// it. A non-recording row only ever needs 3 buttons' worth of height, but
// one uniform minimum across every row is simpler and more consistent
// than maintaining two different minimums for the sake of a few
// slightly-shorter rows.
const CHANNEL_ROW_MIN_HEIGHT = 91

// Temporary, deliberate hide per direct feedback ("let's temporarily
// remove the FX button from the tracks .. i don't want to have fx on the
// tracks currently, just the main") -- NOT a bug, and not a removal: the
// button's onClick, chainPanelOpen state, and the ChannelChainPanel it
// toggles are all left fully intact below so this is trivially reversible
// by flipping this one flag back to true. This is only about the
// per-CHANNEL plugin-chain button; the separate, already-existing "fx on
// main" control elsewhere in the app is untouched.
const CHANNEL_FX_BUTTON_ENABLED = false

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
  bus,
  onOpenContextMenu,
  onOpenRiserMenu,
  onDropOnChannel,
  openRiserLaneId,
  onCloseRiserLane
}: {
  channelId: string
  rifffs: Rifff[]
  /** Only set in tidied view (see selectors.ts's tidiedChannelsInOrder) --
   * paints a left accent border in this bus's color so a tidied project
   * visually groups its rows the same way the Ableton export's own
   * per-bus track coloring does. Undefined in the normal (untidied) view,
   * where channels aren't bus-partitioned at all. */
  bus?: BusId
  /** No automation prop: this row does nothing automation-specific any
   * more. Each clip and riser reads state.automationLanes itself and lays
   * an AutomationLane over its OWN rect (StemWaveformRow /
   * CollapsedRifffRow / RiserBlock render it, not this row -- the lane is
   * per CLIP, see the spec's section 2b), and that lane sitting on top is
   * the whole of what showing the lanes does to a clip's body. Having
   * nothing left here is also why automation stopped being an ArrangerMode
   * and became a transport-bar toggle (2026-09-23): there was no
   * mode-specific behaviour left in it. See the comment above this row's
   * clip stack for the wrapper that used to be here and why it is gone. */
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
  onOpenRiserMenu: (x: number, y: number, riserId: string) => void
  onDropOnChannel: (e: React.DragEvent<HTMLDivElement>, channelId: string) => void
  /** The one riser (anywhere in the project) whose automation lane is open
   * in place -- the riser that was just drawn, per App.tsx's own
   * openRiserLaneId. Passed straight through to every RiserBlock rather
   * than filtered here so this row has no opinion about it; a row holding
   * none of them simply hands each of its risers a null-ish answer. It
   * changes at most once per riser created, so it costs this memoized row
   * one extra render then. */
  openRiserLaneId: string | null
  onCloseRiserLane: () => void
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
  // The whole record, then narrowed with useMemo -- risersOnChannel builds a
  // fresh array every call, so selecting it directly would fail Object.is on
  // every dispatch anywhere and defeat this component's own React.memo.
  // state.risers itself only changes when a riser actually does.
  const allRisers = useAppSelector((s) => s.risers)
  const channelRisers = useMemo(() => risersOnChannel(allRisers, channelId), [allRisers, channelId])
  const riserIds = useMemo(() => channelRisers.map((riser) => riser.id), [channelRisers])
  const isRecordingChannel = useAppSelector((s) => !!s.recordingChannelIds[channelId])
  const isArmed = useAppSelector((s) => s.armedChannelId === channelId)
  // Brief "click here to arm" pointer -- see App.tsx's own "/" key handler
  // for when this gets set (pressing "/" while this channel already
  // exists, empty and unarmed, rather than creating yet another one).
  const showArmReminder = useAppSelector((s) => s.recordingArmReminderChannelId === channelId)
  const selectedInputDevice = useAppSelector((s) => s.selectedInputDevice)
  const bpm = useAppSelector((s) => s.bpm)
  const loopRegion = useAppSelector((s) => s.loopRegion)
  const gatedRecordingEnabled = useAppSelector((s) => s.gatedRecordingEnabled)
  // Only one channel is ever "the" gated-recording channel at a time -- the
  // engine's own gated-recording-update push carries no channelId (unlike
  // capture-level-update, which is scoped to whichever channel is armed),
  // so this is how each ChannelRow decides whether IT is the one that
  // should render the live overlay below. Reads gatedRecordingChannelId
  // directly (see its own doc comment on AppState) rather than searching
  // channelOrder for "the first recording channel" -- an earlier version
  // did that, which broke the moment lock-in started minting a NEW
  // recording channel per take (see App.tsx's lockInGatedRecording): the
  // overlay got stuck on the original, permanently-empty channel forever,
  // on the wrong row, and never cleared after a commit (real bug, caught
  // via screenshot during manual testing).
  const isGatedRecordingChannel = useAppSelector((s) => s.gatedRecordingChannelId === channelId)
  const playing = usePlaying()
  const ppb = useZoom()

  // Both rules live in selectors.ts, where they are unit-tested -- a riser
  // row's m/s are the one part of this that can be wrong quietly (a button
  // that lights up and changes nothing), and components are not tested here.
  // Both still scan the WHOLE project (solo is a statement about everything
  // else), and both are still memoized so that scan only re-runs when mute
  // state, the rifff set or the riser set actually changes.
  const allMuted = useMemo(
    () => channelAllMuted({ rifffs, channelRisers, mute }),
    [rifffs, channelRisers, mute]
  )
  const soloed = useMemo(
    () =>
      channelIsSoloed({
        channelId,
        channelGroupIds: new Set(rifffs.map((r) => r.groupId)),
        rifffs: rifffsMap,
        risers: allRisers,
        mute
      }),
    [channelId, rifffs, rifffsMap, allRisers, mute]
  )

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

  // ARMED keeps the same "filled red = active/attention-grabbing state"
  // treatment the mute button already uses, reusing this app's own
  // audio-in accent color -- that's an established, clear signal and
  // unchanged here. UNARMED now uses --ra-recording-live (#8f7dd4), this
  // app's own established "recording system" purple -- already used
  // elsewhere in THIS FILE (the live capture-level overlay above) and in
  // SketchStrip.tsx/RifffBlockRow.tsx's pulsing in-progress-recording dot
  // -- so the R button reads as visually linked to the recording system
  // at a glance even before it's armed, not just indistinguishable neutral
  // chrome like m/s/fx/x until the moment it turns red. Background stays
  // the same subtle --ra-bg-row-active fill the other buttons use (not a
  // solid purple block) so only the border/text carry the accent.
  const recordButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: isArmed ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${isArmed ? 'var(--ra-mute-on)' : 'var(--ra-recording-live)'}`,
    color: isArmed ? 'var(--ra-mute-on-ink)' : 'var(--ra-recording-live)',
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
                liveState.rifffs[id].startBar !== undefined && liveState.channelOf[id] === channelId
            )
            if (previousTakeGroupId)
              dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: previousTakeGroupId })
            // The engine reports how many bars of round-trip audio I/O
            // latency it estimates for the device that was recording (see
            // Transport::roundTripLatencySamples' doc comment) -- captured
            // audio lands this much later than when it was actually played,
            // so the take is placed that much EARLIER than the loop's own
            // nominal start to compensate. Clamped at 0 rather than going
            // negative for an edge case like a very short loop region on a
            // high-latency device.
            const compensatedStartBar = Math.max(
              0,
              (armedRegion?.startBar ?? 0) - (result.latencyCompensationBars ?? 0)
            )
            dispatch({
              type: 'MOVE_TO_CHANNEL',
              groupId: rifff.groupId,
              startBar: compensatedStartBar,
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

  // Live VU-meter feedback while this channel is armed -- see
  // docs/superpowers/specs/2026-08-03-loop-recording-design.md's "Live
  // capture feedback" section. Subscribes only while armed (unsubscribes and
  // clears immediately on disarm, rather than leaving a stale meter reading
  // sitting there) since the engine only pushes capture-level-update while
  // some channel is actually armed (see IpcServer.cpp's timerCallback).
  // displayL/displayR/lastUpdateMs live in this effect's own closure (not
  // state) since they're intermediate ballistics bookkeeping updated on
  // every poll -- only the final, already-eased value needs to be state so
  // React actually re-renders on it.
  const [capturePeakL, setCapturePeakL] = useState(0)
  const [capturePeakR, setCapturePeakR] = useState(0)
  useEffect(() => {
    if (!isArmed) return
    let lastUpdateMs = performance.now()
    let displayL = 0
    let displayR = 0
    const unsubscribe = window.rifffApi.onCaptureLevelUpdate((updateChannelId, peakL, peakR) => {
      if (updateChannelId !== channelId) return
      const now = performance.now()
      const elapsedMs = now - lastUpdateMs
      lastUpdateMs = now
      displayL = nextMeterValue(displayL, linearToMeterFraction(peakL), elapsedMs)
      displayR = nextMeterValue(displayR, linearToMeterFraction(peakR), elapsedMs)
      setCapturePeakL(displayL)
      setCapturePeakR(displayR)
    })
    // Reset lives in the cleanup, not the setup body -- calling setState
    // synchronously in an effect's setup trips react-hooks/set-state-in-effect
    // (see BeatPicker.tsx's identical reasoning on its own preview-stop
    // effect). Cleanup fires both when isArmed flips back to false and on
    // unmount, so the meter never lingers stale after a disarm.
    return () => {
      unsubscribe()
      setCapturePeakL(0)
      setCapturePeakR(0)
    }
  }, [isArmed, channelId])

  // Same live-overlay pattern as capturePeakL/R above, adapted for
  // GatedLoopRecorder's fixed-size buffer (see its own doc comment):
  // unlike the arm-to-disarm LoopRecorder, this buffer never grows -- it
  // always spans the WHOLE selected loop region from the moment gated
  // recording is enabled, so the overlay's width is fixed too (derived
  // from loopRegion, not from anything peak-related).
  const [gatedPeakL, setGatedPeakL] = useState(0)
  const [gatedPeakR, setGatedPeakR] = useState(0)
  useEffect(() => {
    if (!gatedRecordingEnabled || !isGatedRecordingChannel) return
    let lastUpdateMs = performance.now()
    let displayL = 0
    let displayR = 0
    const unsubscribe = window.rifffApi.onGatedRecordingUpdate((peakL, peakR) => {
      const now = performance.now()
      const elapsedMs = now - lastUpdateMs
      lastUpdateMs = now
      displayL = nextMeterValue(displayL, linearToMeterFraction(peakL), elapsedMs)
      displayR = nextMeterValue(displayR, linearToMeterFraction(peakR), elapsedMs)
      setGatedPeakL(displayL)
      setGatedPeakR(displayR)
    })
    return () => {
      unsubscribe()
      setGatedPeakL(0)
      setGatedPeakR(0)
    }
  }, [gatedRecordingEnabled, isGatedRecordingChannel])

  return (
    <div
      data-channel-id={channelId}
      onDrop={(e) => onDropOnChannel(e, channelId)}
      style={{
        position: 'relative',
        minHeight: CHANNEL_ROW_MIN_HEIGHT,
        borderLeft: bus ? `3px solid ${busColorHex(bus)}` : undefined
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
          {CHANNEL_FX_BUTTON_ENABLED && (
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
          )}
          {isRecordingChannel && (
            <span style={{ position: 'relative', display: 'inline-block' }}>
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
                    : 'no input device'
                }
                style={recordButtonStyle}
              >
                r
              </button>
              {showArmReminder && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: 4,
                    padding: '2px 6px',
                    background: 'var(--ra-mute-on)',
                    color: 'var(--ra-mute-on-ink)',
                    border: '1px solid var(--ra-mute-on)',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 10
                  }}
                >
                  click to arm
                </div>
              )}
            </span>
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
      {/* No automation pointer-events wrapper here, deliberately.
          There used to be one -- `pointerEvents: 'none'` over this whole
          stack whenever the lanes were up, so a drag landed on the lane rather than
          moving a clip the user meant to draw on. It was written when the
          lane was one wide strip per CHANNEL. Once the lane was rescoped to
          sit INSIDE each clip (see the per-clip lane spec, section 2b) it
          became both redundant and harmful:

          - redundant, because AutomationLane is the last child of the clip's
            own box at zIndex 4 and everything else in that box tops out at
            zIndex 3 (both resize handles, the move/scrub surface) -- so the
            lane already wins every pixel of the clip body on z-order alone,
            measured in real Chromium, with no pointer-events rule involved;
          - harmful, because the wrapper reached well past the clip body it
            was aiming at. It also covered the clip's NAME BAR (which lives
            above the body, where no lane ever draws) and each row's
            RowGainDial (which sits outside the clip box entirely, at the
            row's right edge). Both went dead with the lanes up and their
            presses fell through to the Timeline's background click-to-scrub,
            so reaching for a gain knob jumped the playhead instead -- while
            this row's own m/s/fx buttons, rendered ABOVE this point and so
            outside the wrapper, kept working and made it look like only some
            controls were broken. Reported 2026-09-23 ("i cannot reach them.
            the transport line keeps thinking i want to play that part of the
            track ... i can click s and m though", and separately "cannot
            resize it or move it" about a riser).

          So clips and risers stay fully interactive whether the lanes are
          up or not -- "all clips should be selectable and movable in
          automation mode" -- and
          the clip BODY is still the lane's, because the lane is on top of
          it. */}
      {rifffs.map((rifff) => (
        <RifffBlockRow
          key={rifff.groupId}
          groupId={rifff.groupId}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
      {/* Rendered after the clips so a riser overlapping one is drawn on
          top: a riser is a few translucent strokes, and the audio it stands
          for is the thing about to happen. */}
      {riserIds.map((riserId) => (
        <RiserBlock
          key={riserId}
          riserId={riserId}
          onOpenContextMenu={onOpenRiserMenu}
          laneOpenInPlace={openRiserLaneId === riserId}
          onCloseLane={onCloseRiserLane}
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
        // Positioned at armedLoopRegion's startBar/endBar -- a fixed
        // snapshot taken at arm time (see its own doc comment above) --
        // not the live loopRegion selector, and NOT derived from any
        // growing peaks array: a live level meter shows "right now," not
        // "how far the take has built up," so the region is sized to its
        // full final bounds the instant the channel arms, matching where
        // the committed take will actually land (MOVE_TO_CHANNEL's own
        // placement at disarm).
        <div
          style={{
            position: 'absolute',
            left: armedLoopRegion.startBar * ppb,
            width: (armedLoopRegion.endBar - armedLoopRegion.startBar) * ppb,
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
          {/* Two thin, flush-stacked L/R VU-meter fill bars (5px each, no
              gap) near the bottom of the lane, instead of a growing
              waveform -- see meterBallistics.ts for the dB conversion +
              peak-hold-and-decay ballistics behind capturePeakL/R. Color
              stays the dedicated --ra-recording-live purple at ALL levels
              (no clip/near-max warning color) -- an explicit, established
              design choice for this overlay, matching the SAME purple
              --ra-type-audio-in uses for a committed clip too. */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${capturePeakL * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 1, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${capturePeakR * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
        </div>
      )}
      {gatedRecordingEnabled && isGatedRecordingChannel && loopRegion && (
        // Fixed position/width spanning the WHOLE loop region for the
        // entire time gated recording is enabled -- GatedLoopRecorder's
        // own buffer is bounded to exactly one loop pass from the start,
        // so there's no "how far has it gotten" position to track, just
        // "redraw the whole fixed span on every poll." Same
        // NAME_BAR_HEIGHT/ROW_HEIGHT lane, VU-meter bars, and
        // --ra-recording-live color as the armed overlay above, for one
        // continuous "this is live capture" color language across both
        // recording paths.
        <div
          style={{
            position: 'absolute',
            left: loopRegion.startBar * ppb,
            width: (loopRegion.endBar - loopRegion.startBar) * ppb,
            top: NAME_BAR_HEIGHT,
            height: ROW_HEIGHT,
            pointerEvents: 'none'
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${gatedPeakL * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 1, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${gatedPeakR * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
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
