import { initialState, type AppState } from './store'
import { isSketchEligible } from './selectors'

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

export function deserializeProject(data: PersistedProject | LegacyPersistedProject): AppState {
  const migrated = 'channelOrder' in data ? {} : migrateTrackOrder(data.trackOrder)
  const state = { ...initialState, ...data, ...migrated }
  return isSketchEligible(state) ? state : { ...state, mode: 'normal' }
}
