import { initialState, type AppState } from './store'

/** Everything persisted to a .rifffproj file — the full AppState minus the two fields
 * that never make sense to reopen into: whether playback was running, and where the
 * playhead was sitting. */
export type PersistedProject = Omit<AppState, 'playing' | 'pos'>

export function serializeProject(state: AppState): string {
  // Rest destructure is how we drop playing/pos; ignoreRestSiblings isn't enabled
  // project-wide, so the two extracted-but-unused bindings need an explicit disable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { playing, pos, ...rest } = state
  return JSON.stringify(rest, null, 2)
}

export function deserializeProject(data: PersistedProject): AppState {
  return { ...initialState, ...data, playing: false, pos: 0 }
}
