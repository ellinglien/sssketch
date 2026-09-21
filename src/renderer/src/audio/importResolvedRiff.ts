import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import type { Rifff } from '@shared/types'

/** Builds (or merges into) a Rifff from a resolved riff -- the shared core
 * of what LoreLibraryBrowser.tsx's own importResolvedRiff has always done,
 * extracted so the new Endlesss-direct browser can reuse the exact same
 * merge-vs-recreate logic instead of re-deriving it. Callers own the
 * dispatch/setState side effects (ADD_TO_SHELF, SET_VOLUME, classifyStems,
 * tracking which groupId a riffCID was imported as) -- this function is
 * pure with respect to those.
 *
 * If `existing` is provided (this riffCID was already imported once under
 * that groupId), this MERGES: only stems not already present by slot get
 * added onto the SAME rifff, leaving its placement/name/every
 * already-present stem's mute/volume/type untouched. Real bug this fixes
 * (see LoreLibraryBrowser.tsx's own history): re-importing a riff selected
 * before all its stems finished downloading previously left the original
 * incomplete tile behind and created an unrelated duplicate.
 *
 * Returns null if there's nothing to import (no cached stems, and no prior
 * `existing` to merge into) -- and null if merging into `existing` would add
 * nothing new (already fully up to date, in which case `existing` itself is
 * returned as `rifff` so callers can still report success). `sourceLabel`
 * feeds friendlyRiffName's suffix and Rifff.folderPath's display text
 * (e.g. 'library' / 'lore' / 'endlesss'). */
export function buildImportedRifff(
  riffCID: string,
  resolved: RiffLibraryResolvedRiff,
  existing: Rifff | undefined,
  sourceLabel: 'library' | 'lore' | 'endlesss',
  folderPathLabel: string
): { groupId: string; rifff: Rifff; newStemSlots: number[] } | null {
  const cachedStems = resolved.stems.filter((s) => s.path !== null)
  if (!existing && cachedStems.length === 0) return null

  const existingSlots = new Set(existing?.stems.map((s) => s.slot) ?? [])
  const newStems = cachedStems
    .filter((s) => !existingSlots.has(s.slot))
    .map((s) => ({
      slot: s.slot,
      author: s.creatorUserName,
      name: s.presetName,
      type:
        instrumentMaskToSoundType(s.instrumentMask) ??
        guessSoundTypeFromPresetName(s.presetName) ??
        ('fx' as const),
      path: s.path!,
      durationSec: s.durationSec,
      barLength: s.barLength,
      // Every stem in a NORMAL import shares its owning riff's own real
      // creation moment (Stem.creationTime's own doc comment, @shared/
      // types) -- resolved.creationTime undefined (live Endlesss API path)
      // just leaves this undefined too, same graceful-absence convention
      // as `key` above.
      creationTime: resolved.creationTime
    }))

  if (existing && newStems.length === 0) {
    return { groupId: existing.groupId, rifff: existing, newStemSlots: [] }
  }

  const groupId = existing?.groupId ?? crypto.randomUUID()
  const rifff: Rifff = existing
    ? // key: resolved.key ?? existing.key -- a riff imported before this
      // field existed (or before the warehouse row happened to have
      // Root/Scale set) still picks it up on a later re-import/update,
      // rather than staying permanently key-less just because the FIRST
      // import predates this feature. bpm/barLength/name deliberately do
      // NOT get this treatment: they're spread in from `existing` as-is,
      // since those are stable per-riff properties that were already
      // correct on first import, not ones that can newly become available.
      { ...existing, key: resolved.key ?? existing.key, stems: [...existing.stems, ...newStems] }
    : {
        groupId,
        name: friendlyRiffName(riffCID, sourceLabel),
        bpm: resolved.bpm,
        barLength: resolved.barLength,
        key: resolved.key,
        folderPath: folderPathLabel,
        stems: newStems
      }

  return { groupId, rifff, newStemSlots: newStems.map((s) => s.slot) }
}
