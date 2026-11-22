// src/shared/heldStems.ts -- held stems: nine slots on keys 1 to 9, each holding one Discover
// candidate (spec 2026-11-22-held-stems-design). Pure: the key to slot map, the slot's category,
// assign and clear, which row holds a stem, and the saved shape's normalising. Saved with the app
// (DiscoverSettings.heldStems), not the project.
import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverSlotKind } from './discoverSlotKind'

export const HELD_SLOT_COUNT = 9
/** Slots 1 to 5 are drums; the rest are front. */
export const HELD_DRUM_SLOTS = 5

/** Slot 0 is key `1`, slot 8 is key `9`. Always HELD_SLOT_COUNT long. */
export type HeldStems = readonly (DiscoverCandidate | null)[]

export const EMPTY_HELD_STEMS: HeldStems = Array.from({ length: HELD_SLOT_COUNT }, () => null)

/** The slot a key names, by KeyboardEvent.code (shift changes `key`), or null. `0` is no slot. */
export function heldSlotForCode(code: string): number | null {
  const m = /^Digit([1-9])$/.exec(code)
  return m === null ? null : Number(m[1]) - 1
}

/** The key that plays a slot: `1`..`9`. */
export function heldSlotLabel(index: number): string {
  return String(index + 1)
}

/** The category of the row a slot adds, whatever row its stem was assigned from: 1 to 5 are
 * drums, 6 to 9 are front. */
export function heldSlotKinds(index: number): DiscoverSlotKind[] {
  return index < HELD_DRUM_SLOTS ? ['drums'] : ['front']
}

/** Assign (a filled slot is replaced) or, with null, clear. */
export function setHeldStem(
  held: HeldStems,
  index: number,
  candidate: DiscoverCandidate | null
): HeldStems {
  if (!Number.isInteger(index) || index < 0 || index >= HELD_SLOT_COUNT) return held
  return held.map((s, i) => (i === index ? candidate : s))
}

/** The first row holding `stemCID`: playing it, or with it waiting to land. */
export function rowHoldingStem(
  rows: readonly { id: string; stemCID: string | null; waitingStemCID?: string | null }[],
  stemCID: string
): string | null {
  return rows.find((r) => r.stemCID === stemCID || r.waitingStemCID === stemCID)?.id ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One saved stem, or null when it lacks what resolving and ranking need. The fields a row reads
 * without a guard are filled in. */
function normalizeHeldStem(value: unknown): DiscoverCandidate | null {
  if (!isRecord(value)) return null
  const { stemCID, jamCID, riffCID, riffBpm } = value
  if (typeof stemCID !== 'string' || stemCID === '') return null
  if (typeof jamCID !== 'string' || typeof riffCID !== 'string') return null
  if (typeof riffBpm !== 'number' || !Number.isFinite(riffBpm) || riffBpm <= 0) return null
  return {
    ...(value as unknown as DiscoverCandidate),
    presetName: typeof value.presetName === 'string' ? value.presetName : '',
    creatorUserName: typeof value.creatorUserName === 'string' ? value.creatorUserName : '',
    slotKinds: Array.isArray(value.slotKinds) ? (value.slotKinds as DiscoverSlotKind[]) : [],
    drumSubRole: (value.drumSubRole as DiscoverCandidate['drumSubRole'] | undefined) ?? null,
    traitValues: isRecord(value.traitValues) ? value.traitValues : {},
    traitPercentiles: isRecord(value.traitPercentiles) ? value.traitPercentiles : {},
    kindSources: isRecord(value.kindSources) ? value.kindSources : {},
    riffCreationTime: typeof value.riffCreationTime === 'number' ? value.riffCreationTime : null
  }
}

/** The saved slots, read defensively: a missing, old or damaged value gives nine empty slots, and
 * a damaged stem an empty slot. */
export function normalizeHeldStems(value: unknown): HeldStems {
  if (!Array.isArray(value)) return EMPTY_HELD_STEMS
  return Array.from({ length: HELD_SLOT_COUNT }, (_, i) => normalizeHeldStem(value[i]))
}
