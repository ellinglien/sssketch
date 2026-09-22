// src/shared/discoverTraits.ts
import {
  instrumentMaskToSoundType,
  soundSourceMatchesFilter,
  type DiscoverSoundSourceFilter
} from './riffLibraryTypes'
import type { StemFeatures } from './stemFeatures'
import type { ArrangeRole } from './stemRole'
import {
  discoverSlotKindToArrangeRole,
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

/** A stem's own ArrangeRole classification, both from ownDb: a human
 * confirmation (StemCategories) and the overnight classifier's guess
 * (StemAutoCategory). Either may be absent. */
export interface StemSlotClassification {
  confirmedRole?: ArrangeRole | null
  autoRole?: ArrangeRole | null
}

/** The combination-slot pool rule, for one stem -- the per-stem twin of
 * getDiscoverCandidates's own pool rule (src/main/discoverCandidates.ts).
 *
 * 1. The sound-source filter (soundSourceMatchesFilter) applies FIRST, to
 *    every kind set, by the stem's own instrument mask: "endlesss" = sounds
 *    made with Endlesss instruments/effects (an unmasked stem counts here);
 *    "non-endlesss" = audio-in/mic.
 * 2. A trait-only set accepts anything that survives (tagged or not) --
 *    trait kinds never filter, they only rank.
 * 3. Mask kinds (drums/bass/lead) OR together, and a stem is placed by, in
 *    order: its human-confirmed role (always wins, any mask -- confirmed for
 *    a different role excludes it); else its Endlesss instrument mask when
 *    that resolves to drums/bass/notes (ground truth -- an auto guess never
 *    moves it); else, only for a stem the mask can't place (no mask, or
 *    audio-in), the overnight classifier's guess. Direct request,
 *    2026-09-22: audio-in/mic stems never appeared under drums/bass/lead. */
export function stemMatchesSlotKinds(
  instrumentMask: number | null | undefined,
  kinds: readonly DiscoverSlotKind[],
  soundSource: DiscoverSoundSourceFilter,
  classification: StemSlotClassification = {}
): boolean {
  if (!soundSourceMatchesFilter(instrumentMask, soundSource)) return false
  const maskKinds = normalizeSlotKinds(kinds).filter(isMaskSlotKind)
  if (maskKinds.length === 0) return true

  const roles = maskKinds.map(discoverSlotKindToArrangeRole)
  const { confirmedRole, autoRole } = classification
  if (confirmedRole) return roles.includes(confirmedRole)

  const soundType =
    instrumentMask === null || instrumentMask === undefined
      ? null
      : instrumentMaskToSoundType(instrumentMask)
  if (soundType === 'drums' || soundType === 'bass' || soundType === 'notes') {
    return maskKinds.some(
      (k) =>
        (k === 'drums' && soundType === 'drums') ||
        (k === 'bass' && soundType === 'bass') ||
        (k === 'lead' && soundType === 'notes')
    )
  }
  return autoRole !== null && autoRole !== undefined && roles.includes(autoRole)
}
