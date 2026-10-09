import type { AppState } from './store'

/** Overlay temporary mixer silence on the snapshot sent to the realtime
 * engine. The persisted arrangement remains untouched, and mixer mute can
 * only add silence -- never re-enable a durably disabled stem or riser. */
export function stateWithMixerMute(state: AppState): AppState {
  const activeMixerEntries = Object.entries(state.mixerMute).filter(([, muted]) => muted)
  if (activeMixerEntries.length === 0) return state

  const mute = { ...state.mute }
  for (const [key] of activeMixerEntries) {
    if (!state.risers[key]) mute[key] = true
  }

  let risers = state.risers
  for (const [id] of activeMixerEntries) {
    const riser = risers[id]
    if (!riser || riser.muted) continue
    if (risers === state.risers) risers = { ...state.risers }
    risers[id] = { ...riser, muted: true }
  }
  return { ...state, mute, risers }
}
