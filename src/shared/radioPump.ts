// src/shared/radioPump.ts -- which rows the drums pump (Elling, 2026-10-01: "subtle pump from the
// drums"). A drums row is the key (the pump listens to it); a bass row is left alone, as are the
// drums themselves; every other row is pumped. Fixed per slot, as its kinds are. Moved here from
// ell.ing/radio's src/radio/pump.ts (and PumpRole from its src/audio/engine.ts) by the native
// radio sound plan, Task 0; the radio re-exports both.
import type { DiscoverSlotKind } from './discoverSlotKind'
import { stemKey, type SoundType } from './types'

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

/** Discover's pump roles, by the PREVIEW stem's key (native radio sound plan, Task 9): each
 * member row takes its slot's role (pumpRoleFor over the slot's kinds), the way discoverStemPans
 * gives it its pan. The preview rifff numbers its stems by member order (stem i + 1 is
 * `memberSlotIds[i]`). A member whose slot is not in `slots` is left alone ('none'): with no kinds
 * to go by, it neither keys nor is pumped. Only the rows with a part are in the map. */
export function discoverStemPumpRoles(
  slots: readonly { id: string; kinds: readonly DiscoverSlotKind[] }[],
  memberSlotIds: readonly string[],
  groupId: string
): Map<string, PumpRole> {
  const bySlot = new Map(slots.map((s) => [s.id, pumpRoleFor(s.kinds)]))
  const roles = new Map<string, PumpRole>()
  memberSlotIds.forEach((id, i) => {
    const role = bySlot.get(id) ?? 'none'
    if (role !== 'none') roles.set(stemKey(groupId, i + 1), role)
  })
  return roles
}
