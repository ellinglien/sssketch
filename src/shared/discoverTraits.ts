// src/shared/discoverTraits.ts
import {
  instrumentMaskToSoundType,
  soundSourceMatchesFilter,
  type DiscoverSoundSourceFilter
} from './riffLibraryTypes'
import type { StemFeatures } from './stemFeatures'
import {
  isMaskSlotKind,
  normalizeSlotKinds,
  type DiscoverSlotKind,
  type DiscoverTraitKind
} from './discoverSlotKind'

/** Which StemFeatures field each trait kind reads -- the ONE copy, shared
 * by discoverCandidates.ts and discoverAdjacency.ts (each used to keep its
 * own duplicate). bright/warm share spectralCentroidHz as opposite ends. */
export const DISCOVER_TRAIT_FIELD: Record<
  DiscoverTraitKind,
  'bassEnergyRatio' | 'transientDensity' | 'spectralCentroidHz'
> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'transientDensity',
  bright: 'spectralCentroidHz',
  warm: 'spectralCentroidHz'
}

/** Which end of its field a trait kind wants -- rankCandidates scores
 * closeness to this end of the POOL's own range. */
export const DISCOVER_TRAIT_DIRECTION: Record<DiscoverTraitKind, 'high' | 'low'> = {
  bassHeavy: 'high',
  rhythmic: 'high',
  bright: 'high',
  warm: 'low'
}

/** Raw field value per requested trait kind (null = unknown). Only the
 * requested kinds are present. */
export type TraitValues = Partial<Record<DiscoverTraitKind, number | null>>

export function traitValuesFromFeatures(
  features: StemFeatures,
  kinds: readonly DiscoverTraitKind[]
): TraitValues {
  const out: TraitValues = {}
  for (const kind of kinds) {
    const value = features[DISCOVER_TRAIT_FIELD[kind]]
    out[kind] = typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  return out
}

/** The combination-slot pool rule, for one stem: any mask kinds in the set
 * are an OR filter on the Endlesss instrument mask (and match nothing while
 * the "endlesss" source is off -- they are Endlesss content by definition);
 * a trait-only set accepts any stem the sound-source filter allows, tagged
 * or not. Trait kinds never filter -- they only rank. */
export function stemMatchesSlotKinds(
  instrumentMask: number | null | undefined,
  kinds: readonly DiscoverSlotKind[],
  soundSource: DiscoverSoundSourceFilter
): boolean {
  const maskKinds = normalizeSlotKinds(kinds).filter(isMaskSlotKind)
  if (maskKinds.length > 0) {
    if (!soundSource.endlesss) return false
    const soundType =
      instrumentMask === null || instrumentMask === undefined
        ? null
        : instrumentMaskToSoundType(instrumentMask)
    return maskKinds.some(
      (k) =>
        (k === 'drums' && soundType === 'drums') ||
        (k === 'bass' && soundType === 'bass') ||
        (k === 'lead' && soundType === 'notes')
    )
  }
  return soundSourceMatchesFilter(instrumentMask, soundSource)
}
