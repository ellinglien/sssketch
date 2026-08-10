import { initialState, type AppState } from './store'
import { isSketchEligible } from './selectors'
import { snapToWholeBarIfNearlyExact } from '@shared/barLengthSnap'

/** Everything persisted to a .sssketchproj file — the full AppState minus
 * transient UI-mode fields that never make sense to reopen into. Playback
 * position/running state aren't part of AppState at all anymore (they live
 * in StoreContext.tsx's own transport state, outside this reducer — see its
 * module doc comment), so there's nothing to exclude for those here the way
 * there used to be. */
export type PersistedProject = Omit<
  AppState,
  | 'volumeDragMode'
  | 'mode'
  | 'inspectorCollapsed'
  | 'metronomeEnabled'
  | 'armedChannelId'
  | 'availableInputDevices'
  | 'selectedInputDevice'
  | 'regionSelection'
  | 'tidiedView'
  | 'gatedRecordingEnabled'
  | 'gatedRecordingChannelId'
  | 'gatedRecordingTargetGroupId'
  | 'pendingLockInConfirm'
>

/** The shape of a .sssketchproj saved before channels replaced trackOrder —
 * accepted by deserializeProject's migration step below, so an old save
 * still opens correctly instead of silently losing every placed rifff's row
 * (channelOrder/channelOf would otherwise just be empty). */
export interface LegacyPersistedProject extends Omit<
  PersistedProject,
  'channelOrder' | 'channelOf'
> {
  trackOrder: string[]
}

export function serializeProject(state: AppState): string {
  // Rest destructure is how we drop the transient UI-mode fields;
  // ignoreRestSiblings isn't enabled project-wide, so the extracted-but-unused
  // bindings need an explicit disable.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    volumeDragMode,
    mode,
    inspectorCollapsed,
    metronomeEnabled,
    armedChannelId,
    availableInputDevices,
    selectedInputDevice,
    regionSelection,
    tidiedView,
    gatedRecordingEnabled,
    gatedRecordingChannelId,
    gatedRecordingTargetGroupId,
    pendingLockInConfirm,
    ...rest
  } = state
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return JSON.stringify(rest, null, 2)
}

// Reuses each old trackOrder entry's own groupId as its channel id, matching
// the same "own groupId as channel id" default a first-time PLACE_ON_TIMELINE
// already uses (see store.ts) — an old trackOrder entry basically WAS "this
// groupId's own solo row" already, so this reproduces the exact same
// rendering, one channel per clip, in the same order, with nothing visibly
// different until the user actually drags something onto a shared channel.
function migrateTrackOrder(trackOrder: string[]): Pick<AppState, 'channelOrder' | 'channelOf'> {
  const channelOrder: string[] = []
  const channelOf: Record<string, string> = {}
  for (const groupId of trackOrder) {
    channelOrder.push(groupId)
    channelOf[groupId] = groupId
  }
  return { channelOrder, channelOf }
}

// A save from before the source-side fix in src/main/importOneShot.ts
// (commit 033a1c7) can carry a rifff.barLength and/or stem.barLength
// polluted by sample-quantization noise instead of the clean integer it
// was designed to land on (e.g. 16.000003184020517 instead of 16) -- see
// src/shared/barLengthSnap.ts's own comment for the full mechanism and why
// it causes periodic tiling glitches in the native engine. That fix only
// prevents NEW noise from being written; it does nothing to repair a
// project that already has the noisy value baked into its saved JSON, so
// the same snap is reapplied here, at load time, to every rifff and every
// stem within it. Rebuilds the rifffs record only when something actually
// changed, so an already-clean project's state isn't needlessly
// reallocated.
function snapBarLengthNoise(rifffs: AppState['rifffs']): AppState['rifffs'] {
  let rifffsChanged = false
  const nextRifffs: AppState['rifffs'] = {}
  for (const [groupId, rifff] of Object.entries(rifffs)) {
    const snappedBarLength = snapToWholeBarIfNearlyExact(rifff.barLength)
    let stemsChanged = false
    const nextStems = rifff.stems.map((stem) => {
      const snappedStemBarLength = snapToWholeBarIfNearlyExact(stem.barLength)
      if (snappedStemBarLength === stem.barLength) return stem
      stemsChanged = true
      return { ...stem, barLength: snappedStemBarLength }
    })
    if (snappedBarLength === rifff.barLength && !stemsChanged) {
      nextRifffs[groupId] = rifff
      continue
    }
    rifffsChanged = true
    nextRifffs[groupId] = {
      ...rifff,
      barLength: snappedBarLength,
      stems: stemsChanged ? nextStems : rifff.stems
    }
  }
  return rifffsChanged ? nextRifffs : rifffs
}

export function deserializeProject(data: PersistedProject | LegacyPersistedProject): AppState {
  const migrated = 'channelOrder' in data ? {} : migrateTrackOrder(data.trackOrder)
  const state = { ...initialState, ...data, ...migrated }
  // SNAP_DIVS has grown/shrunk twice now: [4,8,16,32] -> [4,8,16] (dropped
  // the finest option), then -> [1,2,4,8,16] (two new, COARSER options
  // added at the front -- see its own doc comment). There's no persisted
  // format-version field to tell "this snapIdx was saved under an older
  // array shape" apart from "already the current one", so -- matching the
  // first change's own precedent below -- this doesn't attempt a real
  // index remap, just clamps out-of-range values. An old save's snapIdx
  // landing on a different divisor than it meant when saved (specifically:
  // the front-insertion silently reinterprets old 0/1/2 as 1/2/4 instead of
  // their original 4/8/16) only affects a rifff with a currently-UNBAKED
  // nonzero offsetSteps at the moment of upgrade -- already-baked clips are
  // immune (APPLY_BAKE always resets their off entry to 0) -- and even then
  // only shifts which beat that rifff's spectrogram grid highlights until
  // it's re-picked, not anything already committed to audio.
  if (state.snapIdx > 4) state.snapIdx = 4
  state.rifffs = snapBarLengthNoise(state.rifffs)
  return isSketchEligible(state) ? state : { ...state, mode: 'normal' }
}
