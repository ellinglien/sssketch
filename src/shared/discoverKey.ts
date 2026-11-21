// src/shared/discoverKey.ts -- which keys a Discover/radio pick is ranked against, and a row's
// key as its tooltip shows it (spec 2026-11-21-picking-key-level-groove-design, 1). Also which
// rows' presences it is balanced against (the same spec, 3).
import type { RankBalance, RankKey } from './discoverRanking'
import type { DiscoverSlotKind } from './discoverSlotKind'
import { hasKey } from './keyFit'
import { resolveKeyName } from './riffLibraryTypes'

/** The part of a Discover row the key and the balance need (DiscoverPanel's DiscoverSlot fits it
 * as it is). */
interface KeyRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  candidate: {
    riffRoot?: number | null
    riffScale?: number | null
    presence?: number | null
  } | null
}

const isDrums = (kinds: readonly DiscoverSlotKind[]): boolean => kinds.includes('drums')

/** The key term's input for filling `slotId`: the other rows that aren't drums and hold a stem.
 * The caller passes only the rows that sound with the pick. */
export function rankKeyFor(
  rows: readonly KeyRow[],
  slotId: string,
  kinds: readonly DiscoverSlotKind[]
): RankKey {
  const others: RankKey['others'][number][] = []
  for (const r of rows) {
    if (r.id === slotId || r.candidate === null || isDrums(r.kinds)) continue
    others.push({ root: r.candidate.riffRoot ?? null, scale: r.candidate.riffScale ?? null })
  }
  return { exempt: isDrums(kinds), others }
}

/** The balance term's input for filling `slotId`: the presences of the other rows that hold a
 * stem with one. Bass, back and front count; drums don't, as the pick or among the others, unless
 * `countDrums` (design 2's rotating focus; off here). The caller passes only the rows that sound
 * with the pick. */
export function rankBalanceFor(
  rows: readonly KeyRow[],
  slotId: string,
  kinds: readonly DiscoverSlotKind[],
  countDrums = false
): RankBalance {
  const others: number[] = []
  for (const r of rows) {
    if (r.id === slotId || (!countDrums && isDrums(r.kinds))) continue
    const presence = r.candidate?.presence
    if (typeof presence === 'number' && Number.isFinite(presence)) others.push(presence)
  }
  return { exempt: !countDrums && isDrums(kinds), others }
}

/** "f minor (aeolian)", or undefined when the key says nothing. */
export function rowKeyLabel(
  root: number | null | undefined,
  scale: number | null | undefined
): string | undefined {
  const key = { root: root ?? null, scale: scale ?? null }
  return hasKey(key) ? resolveKeyName(key.root, key.scale)?.toLowerCase() : undefined
}
