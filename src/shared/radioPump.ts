// src/shared/radioPump.ts -- which rows the drums pump (Elling, 2026-10-01: "subtle pump from the
// drums"). A drums row is the key (the pump listens to it); a bass row is left alone, as are the
// drums themselves; every other row is pumped. Fixed per slot, as its kinds are. Moved here from
// ell.ing/radio's src/radio/pump.ts (and PumpRole from its src/audio/engine.ts) by the native
// radio sound plan, Task 0; the radio re-exports both.
import type { DiscoverSlotKind } from './discoverSlotKind'
import type { SoundType } from './types'

/** A row's part in the drums pump: the key (a drums row), pumped, or left alone (bass). */
export type PumpRole = 'key' | 'pumped' | 'none'

export function pumpRoleFor(kinds: readonly DiscoverSlotKind[]): PumpRole {
  if (kinds.includes('drums')) return 'key'
  if (kinds.includes('bass')) return 'none'
  return 'pumped'
}

/** The timeline's twin of pumpRoleFor: a rifff clip stem's role by its SoundType. */
export function pumpRoleForSoundType(type: SoundType): PumpRole {
  return pumpRoleFor(type === 'drums' || type === 'bass' ? [type] : [])
}
