import type { AppState } from './store'
import { stemKey } from '@shared/types'

export function mixerSoloContains(mixerSolo: readonly string[] | null, key: string): boolean {
  return mixerSolo?.includes(key) ?? false
}

/** The temporary listening layers' effective verdict for one stem/riser.
 * Solo overrides temporary Mute for its targets, while durable Disable is
 * handled separately by the caller and always wins. */
export function mixerKeyIsSilenced(
  mixerMute: Readonly<Record<string, boolean>>,
  mixerSolo: readonly string[] | null,
  key: string
): boolean {
  return mixerSolo === null ? !!mixerMute[key] : !mixerSoloContains(mixerSolo, key)
}

/** Overlay temporary Mute and Solo on the snapshot sent to the realtime
 * engine. The persisted arrangement remains untouched. Solo is evaluated
 * independently: a target can be heard through a temporary Mute, but never
 * through durable stem Disable or a durably muted riser. */
export function stateWithMixerMute(state: AppState): AppState {
  const activeMixerEntries = Object.entries(state.mixerMute).filter(([, muted]) => muted)
  if (activeMixerEntries.length === 0 && state.mixerSolo === null) return state

  const keys = new Set(activeMixerEntries.map(([key]) => key))
  if (state.mixerSolo !== null) {
    for (const rifff of Object.values(state.rifffs)) {
      if (rifff.startBar === undefined) continue
      for (const stem of rifff.stems) keys.add(stemKey(rifff.groupId, stem.slot))
    }
    for (const id of Object.keys(state.risers)) keys.add(id)
  }

  const mute = { ...state.mute }
  for (const key of keys) {
    if (!state.risers[key] && mixerKeyIsSilenced(state.mixerMute, state.mixerSolo, key)) {
      mute[key] = true
    }
  }

  let risers = state.risers
  for (const id of keys) {
    const riser = risers[id]
    if (!riser || riser.muted || !mixerKeyIsSilenced(state.mixerMute, state.mixerSolo, id)) {
      continue
    }
    if (risers === state.risers) risers = { ...state.risers }
    risers[id] = { ...riser, muted: true }
  }
  return { ...state, mute, risers }
}
