// src/shared/remoteState.ts
import type { SoundType } from './types'
import type { CoachSlotSnapshot } from './coachClimax'
import { slotKindsLabel } from './discoverSlotKind'

/** One row on the phone. `id` is Discover's own slot id -- needed so a tap
 * can reroll THAT slot, and not a filesystem path. There is deliberately
 * nothing else here: no path, no CID, no bpm, nothing about the library. */
export interface RemoteSlotView {
  id: string
  kindLabel: string
  stemName: string
  soundType: SoundType | null
}

export interface RemoteState {
  /** False when Discover is not open on the Mac -- the page then says
   * "open discover on the mac" and offers nothing else. It does not
   * navigate the desktop app there; screen-driving was considered and
   * rejected by Elling in the arrangement-map work. */
  discoverOpen: boolean
  playing: boolean
  /** A run is a session. Both reset when the server does. No points, no
   * badges, no streaks. */
  kept: number
  rolled: number
  /** Flashed once under the counters as `kept · misty kestrel`. */
  lastKeptName: string | null
  slots: RemoteSlotView[]
}

export interface RemoteStateMeta {
  discoverOpen: boolean
  playing: boolean
  kept: number
  rolled: number
  lastKeptName: string | null
}

/** The whole privacy boundary of Part 2, in one pure function: whatever
 * Discover's renderer knows, only these fields leave the Mac. An
 * unresolved slot keeps its row (with an empty name) rather than
 * disappearing -- the phone should show the shape of the loop he left on
 * screen, mid-roll included. */
export function remoteStateFromSlots(
  slots: readonly CoachSlotSnapshot[],
  meta: RemoteStateMeta
): RemoteState {
  return {
    discoverOpen: meta.discoverOpen,
    playing: meta.playing,
    kept: meta.kept,
    rolled: meta.rolled,
    lastKeptName: meta.lastKeptName,
    slots: slots.map((slot) => ({
      id: slot.id,
      kindLabel: slotKindsLabel(slot.kinds),
      stemName: slot.stem?.name ?? '',
      soundType: slot.stem?.type ?? null
    }))
  }
}

/** Everything the phone can ask the Mac to do. Four verbs, and nothing
 * else: no arranging, no timeline, no slot add/remove, no kind picker, no
 * gain, no settings, no library browsing. The Mac sets the shape of the
 * loop; the phone rolls it. */
export type RemoteCommand =
  | { kind: 'roll-slot'; slotId: string }
  | { kind: 'roll-all' }
  | { kind: 'transport'; play: boolean }
  | { kind: 'keep' }
