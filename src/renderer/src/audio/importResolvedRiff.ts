import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import { stemKey, type Rifff, type Stem } from '@shared/types'
import { sqrtGain } from '@shared/mixGain'
import {
  bakeToPhaseJob,
  matchBakeResults,
  phaseLineage,
  rotationSecForBars,
  sharedPhaseBars,
  type ReoneBakeJob
} from '@shared/reonedRotation'

/**
 * The committed volumes for stems added by a library import.
 *
 * Library preview plays each row at `sqrtGain(cached stem count) * GainsJSON
 * gain`. Import has to commit that same product, not choose between the two:
 * ADD_TO_SHELF supplies sqrtGain only as a fallback, while the old caller
 * overwrote that fallback with the un-normalised GainsJSON value whenever it
 * differed from 1. The riff therefore changed balance as soon as it moved
 * from Browse to the shelf/timeline.
 *
 * On a later partial-download merge only the newly added slots are returned;
 * volumes for rows the user may already have adjusted remain untouched.
 */
export function importedStemVolumes(
  groupId: string,
  resolved: RiffLibraryResolvedRiff,
  newStemSlots: readonly number[]
): Record<string, number> {
  const cachedStems = resolved.stems.filter((stem) => stem.path !== null)
  const headroom = sqrtGain(cachedStems.length)
  const added = new Set(newStemSlots)
  return Object.fromEntries(
    cachedStems
      .filter((stem) => added.has(stem.slot))
      .map((stem) => [stemKey(groupId, stem.slot), headroom * stem.gain])
  )
}

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
        // A radio-hearts riff carries its "♥ n · ..." label (see
        // RiffLibraryResolvedRiff.name); everything else is named from its id.
        name: resolved.name ?? friendlyRiffName(riffCID, sourceLabel),
        bpm: resolved.bpm,
        barLength: resolved.barLength,
        key: resolved.key,
        folderPath: folderPathLabel,
        stems: newStems
      }

  return { groupId, rifff, newStemSlots: newStems.map((s) => s.slot) }
}

export type JoiningBake = (
  jobs: ReoneBakeJob[]
) => Promise<{ path: string; bakedPath: string; durationSec: number }[]>

/** Stems joining a riff that is already re-oned (a later import of a riff whose stems were
 * still downloading when it was re-oned) are baked to the riff's rotation before they join, so
 * the riff stays at one phase. Without it they came in at their raw Endlesss phase: "only some
 * stems rotated" (the triage of the 2026-10-08 call, B1 path 2).
 *
 * Bakes through the re-oned copies path (`bakeToPhaseJob`: recipe-named, so a copy some other
 * riff or audition already made is reused), as one all-or-nothing batch. Returns the stems to
 * add: as they are when the riff carries no rotation (or it wraps to none for a stem), rotated
 * with their lineage set otherwise, and null when the bake fails or comes back short, in which
 * case none of them may join. Adopting is the caller's: this edits nothing. */
export async function rotateJoiningStems(
  existing: Rifff,
  joining: readonly Stem[],
  bake: JoiningBake
): Promise<Stem[] | null> {
  const bars = sharedPhaseBars(existing.stems)
  if (bars === null) return [...joining]
  const toBake = joining.filter((stem) => rotationSecForBars(bars, stem) !== 0)
  if (toBake.length === 0) return [...joining]
  let results: Awaited<ReturnType<JoiningBake>>
  try {
    results = await bake(toBake.map((stem) => bakeToPhaseJob(stem, bars)))
  } catch (err) {
    console.error('rotateJoiningStems: bake failed:', err)
    return null
  }
  const matched = matchBakeResults(
    toBake.map((stem) => stem.path),
    results
  )
  if (!matched) return null
  const baked = new Map(toBake.map((stem, i) => [stem, matched[i]]))
  return joining.map((stem) => {
    const result = baked.get(stem)
    if (!result) return stem
    return {
      ...stem,
      path: result.bakedPath,
      durationSec: result.durationSec,
      phaseSourcePath: phaseLineage(stem).sourcePath,
      phaseBars: bars
    }
  })
}

export type JoiningMerge =
  | { kind: 'merged'; rifff: Rifff; rotated: Stem[] }
  | { kind: 'gone' }
  | { kind: 'failed'; rifff: Rifff }

/** Joins late stems onto a riff that lives in the store (`readLatest`, read again after every
 * await): bakes them to the riff's rotation (rotateJoiningStems), then merges them onto the
 * riff as it is by then. The bake takes seconds, so the riff can move under it:
 * - deleted: `gone`, and nothing is merged, so the riff isn't brought back;
 * - re-oned (its rotation changed): the stems are baked again to the new one, up to `attempts`
 *   bakes in all, then `failed`, as when a bake fails. A `failed` riff is the latest one, for the
 *   notice to name. */
export async function mergeJoiningStems(
  readLatest: () => Rifff | undefined,
  joining: readonly Stem[],
  bake: JoiningBake,
  attempts = 2
): Promise<JoiningMerge> {
  let before = readLatest()
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!before) return { kind: 'gone' }
    const rotated = await rotateJoiningStems(before, joining, bake)
    const latest = readLatest()
    if (!latest) return { kind: 'gone' }
    if (!rotated) return { kind: 'failed', rifff: latest }
    if (sharedPhaseBars(latest.stems) === sharedPhaseBars(before.stems)) {
      const present = new Set(latest.stems.map((s) => s.slot))
      return {
        kind: 'merged',
        rifff: {
          ...latest,
          stems: [...latest.stems, ...rotated.filter((s) => !present.has(s.slot))]
        },
        rotated
      }
    }
    before = latest
  }
  return before ? { kind: 'failed', rifff: before } : { kind: 'gone' }
}
