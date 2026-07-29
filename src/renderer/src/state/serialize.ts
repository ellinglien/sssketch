import { initialState, type AppState } from './store'

/** Everything persisted to a .rifffproj file — the full AppState minus two
 * transient UI-mode fields that never make sense to reopen into. Playback
 * position/running state aren't part of AppState at all anymore (they live
 * in StoreContext.tsx's own transport state, outside this reducer — see its
 * module doc comment), so there's nothing to exclude for those here the way
 * there used to be. */
export type PersistedProject = Omit<AppState, 'volumeDragMode' | 'compactMode'>

export function serializeProject(state: AppState): string {
  // Rest destructure is how we drop volumeDragMode/compactMode; ignoreRestSiblings
  // isn't enabled project-wide, so the two extracted-but-unused bindings need an explicit disable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { volumeDragMode, compactMode, ...rest } = state
  return JSON.stringify(rest, null, 2)
}

export function deserializeProject(data: PersistedProject): AppState {
  return { ...initialState, ...data }
}
