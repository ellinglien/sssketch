// src/shared/remoteState.ts
import type { SoundType } from './types'
import type { CoachSlotSnapshot } from './coachClimax'
import {
  DISCOVER_SLOT_KIND_OPTIONS,
  normalizeSlotKinds,
  slotKindsLabel,
  type DiscoverSlotKind
} from './discoverSlotKind'

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

/** What GET /api/state actually answers: the snapshot the renderer pushed,
 * plus the id of the loop the phone can fetch right now.
 *
 * `loopId` is deliberately NOT part of RemoteState and is NOT produced by
 * remoteStateFromSlots. The renderer does not know it -- main computes it
 * from the EngineProject Discover pushes over IPC, which is full of real
 * filesystem paths and never leaves the main process. Sixteen hex characters
 * of a sha256 is what leaves, and the no-path property remoteState.test.ts
 * asserts is preserved by construction rather than by care. */
export interface RemoteStateResponse extends RemoteState {
  loopId: string | null
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

/** Everything the phone can ask the Mac to do. FIVE verbs, and nothing else:
 * no arranging, no timeline, no gain, no settings, no library browsing. The
 * phone can now set the shape of the loop as well as roll it.
 *
 * `add-slot`/`remove-slot` arrived on 2026-09-26, from real use: "the initial
 * state of the phone interface... how do i add a stem? it starts with zero
 * and no apparent way to add". Steering slots the Mac already has is no use
 * when Discover is empty, which is exactly when he is not at the Mac.
 *
 * Deliberately still NOT here, and each one can be pulled back later: the
 * matching dial, chaos, the endlesss/other filters, favourites-only,
 * undo/redo, the adjacency popover, per-slot gain, the match meter. Every
 * control competes with the verbs that matter on a thumb-sized screen, and
 * a reroll already is undo on a phone.
 *
 * `transport` was here until 2026-09-26 and was removed on purpose when the
 * phone became an audio client. One button cannot mean two outputs, and the
 * phone's `play` now means the phone. The two outputs are independent by
 * Elling's own instruction ("phone audio distinct from the app") -- the phone
 * does not reach into the Mac's transport in either direction, and both
 * playing at once is intended rather than a bug. */
export type RemoteCommand =
  | { kind: 'roll-slot'; slotId: string }
  | { kind: 'roll-all' }
  | { kind: 'keep' }
  | { kind: 'add-slot'; kinds: DiscoverSlotKind[] }
  | { kind: 'remove-slot'; slotId: string }

/** The kinds POST /api/add-slot will accept, or null for "do not act on
 * this". The whole trust boundary for the phone's kind picker, in one pure
 * function: an unknown string is not coerced, dropped or best-guessed, it
 * fails the whole request -- so `kinds` can never become a channel for a
 * path, and the renderer's addSlot only ever sees a normalized, non-empty
 * set of real kinds. */
export function parseRemoteSlotKinds(value: unknown): DiscoverSlotKind[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0 || value.length > DISCOVER_SLOT_KIND_OPTIONS.length) return null
  const kinds: DiscoverSlotKind[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const kind = DISCOVER_SLOT_KIND_OPTIONS.find((k) => k === entry)
    if (kind === undefined) return null
    kinds.push(kind)
  }
  const normalized = normalizeSlotKinds(kinds)
  return normalized.length === 0 ? null : normalized
}
