import { useAppState, useDispatch, usePlaying } from './StoreContext'
import { stopActivePreview } from '../audio/previewLoop'
import type { LoopRegion } from './store'

/** Endlesss-style gated ("always listening") recording controls -- see
 * GatedLoopRecorder's own doc comment (native-engine) for the capture
 * design, and docs/superpowers/specs/2026-08-06-rifff-recording-design.md
 * for why this lives in its own hook rather than as App.tsx-local
 * closures (the previous shape): RifffBlockRow.tsx/SketchStrip.tsx need
 * the SAME confirm-before-losing-a-take logic App.tsx already built for
 * the transport Stop button / rec dot / spacebar, and threading a
 * callback prop for that through ChannelRow.tsx (which has nothing to do
 * with gated recording) would be worse than just sharing the hook -- every
 * caller already has access to the same underlying StoreContext, so
 * multiple independent useGatedRecordingControls() calls across different
 * components stay in sync for free. */
export function useGatedRecordingControls(): {
  enableGatedRecording: () => Promise<void>
  disableGatedRecording: () => Promise<void>
  lockInGatedRecording: () => Promise<void>
  confirmLockInIfRecording: () => Promise<void>
  handleStop: () => Promise<void>
  targetRifffForRecording: (groupId: string, region: LoopRegion) => Promise<void>
} {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()

  // Three separate actions (below), not one toggle-everything function:
  // enable (off -> on, \ key or clicking the rec dot while off), lock in
  // (\ key while on -- commits the current pass WITHOUT turning recording
  // mode off, so repeated \ presses grab successive takes across multiple
  // loop passes), and disable (clicking the rec dot while on -- stops
  // listening WITHOUT committing whatever's currently captured, a plain
  // cancel/abort). Splitting these out (rather than \-while-on also
  // auto-disabling, an earlier design) was a direct response to real
  // feedback: users need an explicit way to stop without losing the
  // ability to grab multiple takes via \ alone.
  async function enableGatedRecording(): Promise<void> {
    const region = state.loopRegion
    const loopBars = region ? region.endBar - region.startBar : 0
    if (!region || loopBars <= 0 || loopBars > 16) {
      window.alert('select a loop region of 16 bars or less first (drag on the ruler)')
      return
    }
    const result = await window.rifffApi.engineSetGatedRecordingEnabled(
      true,
      region.startBar,
      region.endBar
    )
    if (!result.success) {
      if (result.error) window.alert(`Couldn't enable recording mode: ${result.error}`)
      return
    }
    dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: true })
    // Pins down exactly which recording channel the NEXT lock-in will land
    // on -- reuses an existing EMPTY recording channel if one's sitting
    // around (e.g. the always-present invariant channel from the mount
    // effect above), otherwise mints a fresh one. This is also what
    // ChannelRow.tsx's live waveform overlay binds to (see
    // gatedRecordingChannelId's own doc comment on AppState) -- pinning it
    // HERE, once, rather than re-deriving "the" recording channel by
    // searching channelOrder each render, is what keeps the overlay and the
    // actual lock-in destination from ever disagreeing.
    //
    // Skipped entirely when a rifff is already targeted (double-click path,
    // see targetRifffForRecording below) -- gatedRecordingChannelId stays
    // null in that case, matching the mutual-exclusivity contract with
    // gatedRecordingTargetGroupId.
    if (!state.gatedRecordingTargetGroupId) {
      const placedChannelIds = new Set(Object.values(state.channelOf))
      const emptyRecordingChannelId = state.channelOrder.find(
        (id) => state.recordingChannelIds[id] && !placedChannelIds.has(id)
      )
      const targetChannelId = emptyRecordingChannelId ?? crypto.randomUUID()
      if (!emptyRecordingChannelId) {
        dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: targetChannelId })
      }
      dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: targetChannelId })
    }
    // Starts playback automatically if it isn't already running -- gated
    // recording only ever captures anything while the transport is
    // actually moving, so without this, arming it and not separately
    // remembering to hit play produced a real reported bug ("didn't seem
    // to record anything"). Deliberately does NOT jump to region.startBar
    // anymore (an earlier version did) -- per direct feedback ("it should
    // just go with the spot you press it at"), enabling recording
    // shouldn't yank the playhead anywhere. Play (or keep playing) from
    // wherever pos already is; Transport.cpp's own renderLoopAware now
    // handles "hasn't reached the loop region yet" by playing straight
    // through unwrapped until it arrives there naturally, then looping.
    if (!playing) {
      dispatch({ type: 'PLAY' })
    }
  }

  // Shared by disableGatedRecording below, handleStop, the spacebar
  // shortcut's own pause handling (App.tsx), and targetRifffForRecording
  // below -- all would otherwise silently abandon whatever's been captured
  // since the last \ lock-in the moment they fire. Per direct feedback:
  // "if the user stops or presses the dot or presses space and it's been
  // recording and hasn't been committed, a tiny popup should ask if they
  // want to commit the most recent loop... i just forget to press the \
  // key" -- easy to forget, and losing a take silently is much worse than
  // one extra confirm click. Plain window.confirm, matching this app's own
  // existing convention for exactly this kind of lightweight yes/no gate
  // (see ProjectMenu's handleNew). A no-op while recording isn't even
  // enabled.
  async function confirmLockInIfRecording(): Promise<void> {
    if (!state.gatedRecordingEnabled) return
    if (window.confirm('Lock in the most recent recording pass first?')) {
      await lockInGatedRecording()
    }
  }

  async function disableGatedRecording(): Promise<void> {
    await confirmLockInIfRecording()
    await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0)
    dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: false })
    dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: null })
    dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId: null })
  }

  // The transport Stop button's own handler (TransportBar's onStop prop) --
  // routes through confirmLockInIfRecording first, unlike a bare
  // dispatch({type:'STOP'}) would. See confirmLockInIfRecording's own doc
  // comment.
  async function handleStop(): Promise<void> {
    await confirmLockInIfRecording()
    stopActivePreview()
    dispatch({ type: 'STOP' })
    dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId: null })
  }

  async function lockInGatedRecording(): Promise<void> {
    const result = await window.rifffApi.engineCaptureGatedTake()
    if (result.committed && result.path) {
      // loopBars is what makes this take tile/loop like any other imported
      // rifff instead of playing once -- see importRecordedTake's own doc
      // comment. Falls back to the take's own captured length via
      // loopRegion if it's somehow gone by the time this resolves (region
      // cleared mid-flight) -- shouldn't happen in practice since gated
      // recording can't even be enabled without one.
      const loopBars = state.loopRegion
        ? state.loopRegion.endBar - state.loopRegion.startBar
        : undefined

      // Targeted-rifff path (double-click a rifff, see
      // targetRifffForRecording) -- build a STEM and attach it to the
      // target rifff, rather than a whole new rifff on a channel. Stays
      // pinned after committing (unlike the channel path's own rotation
      // below) so repeated \ presses keep adding MORE stems to the same
      // rifff -- see the design doc's own "Accumulation" section.
      if (state.gatedRecordingTargetGroupId) {
        const targetRifff = state.rifffs[state.gatedRecordingTargetGroupId]
        if (targetRifff && loopBars !== undefined) {
          const stem = await window.rifffApi.importRecordedStem(
            result.path,
            targetRifff.bpm,
            loopBars,
            targetRifff.stems.map((s) => s.slot)
          )
          if (stem) {
            dispatch({
              type: 'ADD_STEM_TO_RIFFF',
              groupId: state.gatedRecordingTargetGroupId,
              stem
            })
          }
        }
        return
      }

      const rifff = await window.rifffApi.importRecordedTake(result.path, state.bpm, loopBars)
      if (rifff) {
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        // Lands on the channel pinned by enableGatedRecording (or the
        // previous lock-in's own rotation below) -- NOT wherever
        // channelOrder happens to find "a" recording channel. Each
        // gated-recording take is now a permanent loop clip (per direct
        // feedback -- "because the rec clips are now loops, they should
        // behave as other imported rifffs"), so repeated \ presses build up
        // a stack of takes across their own channels rather than silently
        // deleting the previous one to make room (an earlier version did
        // that). Falls back to minting one on the spot in the unexpected
        // case this is somehow null (gated recording can't normally be
        // enabled without enableGatedRecording having already set it).
        const targetChannelId = state.gatedRecordingChannelId ?? crypto.randomUUID()
        if (!state.gatedRecordingChannelId) {
          dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: targetChannelId })
        }
        // Same round-trip latency compensation as the manual recording
        // flow -- see ChannelRow.tsx's own handleToggleArm for the
        // identical calculation and reasoning.
        const compensatedStartBar = Math.max(
          0,
          (state.loopRegion?.startBar ?? 0) - (result.latencyCompensationBars ?? 0)
        )
        dispatch({
          type: 'MOVE_TO_CHANNEL',
          groupId: rifff.groupId,
          startBar: compensatedStartBar,
          channelId: targetChannelId
        })
        // Rotates the pin to a BRAND NEW empty channel for whatever the
        // NEXT lock-in (or the live overlay, meanwhile) should target --
        // the channel just used above now has a take on it, so it's no
        // longer a valid destination.
        const nextChannelId = crypto.randomUUID()
        dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: nextChannelId })
        dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: nextChannelId })
      }
    } else if (result.error) {
      window.alert(`Couldn't lock in recording: ${result.error}`)
    }
  }

  // Called by RifffBlockRow.tsx/SketchStrip.tsx's own onDoubleClick --
  // pins groupId as the gated-recording target and sets the loop region to
  // match it (region is the caller's own current-geometry-derived span,
  // same "reflects however the clip is ACTUALLY sized right now" data
  // both components already compute for their existing double-click
  // behavior). If recording is currently enabled (either the channel path
  // or a previous rifff target), confirms before abandoning whatever's
  // in-progress, then turns recording OFF -- re-targeting mid-session
  // requires an explicit \ press to resume onto the new target, same
  // two-step "set the region/target, then press \ to actually start
  // capturing" flow a fresh double-click already has. This sidesteps
  // having to splice a live loop-region change into an already-running
  // native capture.
  async function targetRifffForRecording(groupId: string, region: LoopRegion): Promise<void> {
    if (!region) return
    // Re-clicking the rifff that's ALREADY the current target is a no-op
    // refresh, not a re-target -- covers the case where the clip's own
    // rendered geometry changed (a resize) since targeting began, per the
    // design doc's own "Re-clicking the same target" section. Deliberately
    // does NOT go through confirmLockInIfRecording/disable -- there's
    // nothing to abandon, the same rifff is still the destination.
    if (groupId === state.gatedRecordingTargetGroupId) {
      dispatch({ type: 'SET_LOOP_REGION', region })
      return
    }
    if (state.gatedRecordingEnabled) {
      await confirmLockInIfRecording()
      await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0)
      dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: false })
    }
    dispatch({ type: 'SET_LOOP_REGION', region })
    dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: null })
    dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId })
  }

  return {
    enableGatedRecording,
    disableGatedRecording,
    lockInGatedRecording,
    confirmLockInIfRecording,
    handleStop,
    targetRifffForRecording
  }
}
