// src/shared/discoverKey.ts -- which keys a Discover/radio pick is ranked against, and a row's
// key as its tooltip shows it (spec 2026-11-21-picking-key-level-groove-design, 1).
import type { RankKey } from './discoverRanking'
import type { DiscoverSlotKind } from './discoverSlotKind'
import { hasKey } from './keyFit'
import { resolveKeyName } from './riffLibraryTypes'

/** The part of a Discover row the key needs (DiscoverPanel's DiscoverSlot fits it as it is). */
interface KeyRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  candidate: { riffRoot?: number | null; riffScale?: number | null } | null
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

/** "f minor (aeolian)", or undefined when the key says nothing. */
export function rowKeyLabel(
  root: number | null | undefined,
  scale: number | null | undefined
): string | undefined {
  const key = { root: root ?? null, scale: scale ?? null }
  return hasKey(key) ? resolveKeyName(key.root, key.scale)?.toLowerCase() : undefined
}
