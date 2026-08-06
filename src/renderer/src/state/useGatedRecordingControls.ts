import {
  getStateSnapshot,
  useAppState,
  useDispatch,
  usePlaying,
  type DispatchableAction
} from './StoreContext'
import { stopActivePreview } from '../audio/previewLoop'
import type { LoopRegion } from './store'
import type { Dispatch } from 'react'

// Holds the in-flight confirm dialog's own resolve function, plus the
// SETTLEMENT promise it belongs to -- plain module-level variables, not
// React state, because a promise's resolve callback isn't serializable/
// reducer-friendly the way pendingLockInConfirm (store.ts's AppState field)
// is. confirmLockInIfRecording below sets both, LockInConfirmDialog.tsx's
// own two buttons call resolvePendingLockInConfirm (exported below) to
// settle the resolver half.
//
// IMPORTANT: a second call to confirmLockInIfRecording IS reachable while a
// first is still unresolved -- the click-catching backdrop blocks
// mouse-triggered callers (Stop button, a rifff double-click), but the
// spacebar play/pause shortcut (App.tsx) also routes through
// confirmLockInIfRecording and is a plain `window` keydown listener, not
// blocked by the backdrop at all. confirmLockInIfRecording's own guard below
// (checking pendingLockInSettlement before creating a new one) makes every
// such joining caller await the SAME settlement instead of overwriting
// pendingLockInResolve and orphaning the first caller's promise forever.
//
// pendingLockInSettlement deliberately resolves to void, not the raw
// boolean answer -- it represents "the user has answered AND, if they chose
// to keep it, lockInGatedRecording() has actually finished," built via a
// single .then() attached ONCE, at creation time, in confirmLockInIfRecording
// below. If this instead just re-exposed the raw boolean to every joining
// caller, each of them would independently see keepIt===true and each call
// lockInGatedRecording() itself -- committing the SAME take twice. Routing
// every caller through the one shared settlement (whichever caller created
// it) is what keeps the actual commit a single-fire side effect while still
// letting every caller safely await "fully dealt with" before proceeding
// (e.g. handleStop's subsequent STOP dispatch).
let pendingLockInResolve: ((keepIt: boolean) => void) | null = null
let pendingLockInSettlement: Promise<void> | null = null

// Called by LockInConfirmDialog.tsx's own "lock it in"/"discard" buttons --
// settles whatever confirm is currently pending (a no-op if somehow nothing
// is, e.g. a stray double-click on an already-dismissed dialog) and clears
// pendingLockInConfirm so the dialog itself hides. Deliberately does NOT
// clear pendingLockInSettlement itself -- confirmLockInIfRecording's own
// .then() chain still needs it live a moment longer to run lockInGatedRecording
// and let every joined caller's own await resolve; it's cleared there,
// once that chain actually finishes, not here. Kept as the ONE place that
// resolves pendingLockInResolve, per this file's own module-level-escape-hatch
// design (see pendingLockInResolve's own doc comment).
export function resolvePendingLockInConfirm(
  dispatch: Dispatch<DispatchableAction>,
  keepIt: boolean
): void {
  pendingLockInResolve?.(keepIt)
  pendingLockInResolve = null
  dispatch({ type: 'SET_PENDING_LOCK_IN_CONFIRM', pending: false })
}

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
    // Same "nothing to record from without an explicitly selected device"
    // gating ChannelRow.tsx's own manual arm/disarm flow already enforces
    // (see its canArm/handleToggleArm) -- mirrored here rather than letting
    // the engine silently capture from whatever device the AudioDeviceManager
    // already happened to have open. Alert-and-no-op, matching this
    // function's own existing loop-region check just above (TransportBar.tsx's
    // rec-dot button comment already documents this "otherwise just alerts
    // and no-ops" convention).
    if (!state.selectedInputDevice) {
      window.alert('select an input device first')
      return
    }
    const result = await window.rifffApi.engineSetGatedRecordingEnabled(
      true,
      region.startBar,
      region.endBar,
      state.selectedInputDevice
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
  // one extra confirm click. A no-op while recording isn't even enabled.
  //
  // Used to be a plain window.confirm(...) -- Electron/Chromium's native
  // confirm always renders generic "OK"/"Cancel" buttons with no way to
  // customize their text, which read ambiguously for this specific
  // interruption-style phrasing (unlike this app's other window.confirm call
  // sites, which are all direct "do X?" questions where OK unambiguously
  // means yes -- see e.g. ProjectMenu's handleNew). Replaced with
  // LockInConfirmDialog.tsx, a custom overlay (mounted once, unconditionally,
  // from App.tsx) with explicitly-labeled "lock it in"/"discard" buttons.
  // Since this hook is called independently from multiple components
  // (App.tsx, RifffBlockRow.tsx), each with its own local state, the
  // dialog's visibility lives in the shared reducer (state.pendingLockInConfirm)
  // rather than local useState here -- see that field's own doc comment on
  // AppState. The user's answer is delivered from OUTSIDE this function call
  // entirely (the dialog's button handlers, via resolvePendingLockInConfirm
  // above) -- pendingLockInResolve is the bridge. If a confirm is ALREADY
  // pending (see pendingLockInSettlement's own doc comment for exactly how
  // that's reachable -- the spacebar shortcut, not just a stray double
  // dispatch), this joins the SAME outstanding settlement instead of
  // starting a second one and, critically, does NOT independently call
  // lockInGatedRecording itself -- see pendingLockInSettlement's own doc
  // comment for why a naive "every caller sees keepIt===true, every caller
  // commits" design would double-commit the same take.
  async function confirmLockInIfRecording(): Promise<void> {
    if (!state.gatedRecordingEnabled) return
    if (!pendingLockInSettlement) {
      dispatch({ type: 'SET_PENDING_LOCK_IN_CONFIRM', pending: true })
      const answered = new Promise<boolean>((resolve) => {
        pendingLockInResolve = resolve
      })
      // This .then() is attached exactly once, right here, at creation time
      // -- it's what makes lockInGatedRecording a single-fire side effect no
      // matter how many callers below end up awaiting the same
      // pendingLockInSettlement.
      pendingLockInSettlement = answered
        .then((keepIt) => (keepIt ? lockInGatedRecording() : undefined))
        .finally(() => {
          pendingLockInSettlement = null
        })
    }
    await pendingLockInSettlement
  }

  async function disableGatedRecording(): Promise<void> {
    await confirmLockInIfRecording()
    await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0, '')
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
            // importRecordedStem above is a real async round-trip -- the
            // target rifff can be deleted/ungrouped WHILE it's in flight
            // (store.ts's own DELETE_RIFFFS/UNGROUP cases clear
            // gatedRecordingTargetGroupId live when that happens). This
            // hook's own `state` is a frozen closure captured at render
            // time, so it would never see that change; dispatching against
            // it here would hand ADD_STEM_TO_RIFFF a groupId the live
            // reducer no longer has. Re-read the CURRENT state via
            // getStateSnapshot() right before dispatching so this check
            // reflects reality at the moment it matters, not the moment
            // this function started.
            const liveState = getStateSnapshot()
            const liveTargetGroupId = liveState.gatedRecordingTargetGroupId
            if (liveTargetGroupId && liveState.rifffs[liveTargetGroupId]) {
              dispatch({
                type: 'ADD_STEM_TO_RIFFF',
                groupId: liveTargetGroupId,
                stem
              })
            } else {
              // Mirrors the fallback below -- the engine has already
              // committed the take to disk (result.path) and
              // importRecordedStem already built the stem, but the target
              // rifff vanished while we were awaiting it. Surfacing this
              // rather than silently dropping the take is the same
              // silent-take-loss concern this whole fallback exists for.
              window.alert("Couldn't attach the recorded take: the target rifff no longer exists.")
            }
          }
        } else {
          // The engine has already committed a real take to disk at
          // result.path by this point regardless -- store.ts's own
          // UNGROUP/DELETE_RIFFFS cases clear gatedRecordingTargetGroupId
          // proactively when the target rifff goes away, so this should be
          // rare, but it's still reachable (e.g. loopBars somehow
          // undefined) and silently dropping the take here would be exactly
          // the kind of silent take-loss confirmLockInIfRecording above was
          // built to avoid.
          window.alert("Couldn't attach the recorded take: the target rifff no longer exists.")
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
      await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0, '')
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
