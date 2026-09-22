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

/** Every StemFeatures field a trait kind can read. */
export type TraitField =
  | 'bassEnergyRatio'
  | 'transientDensity'
  | 'spectralCentroidHz'
  | 'rhythmicStrength'
  | 'spectralCentroidFftHz'

/** Each trait kind's FALLBACK field -- present on every analysed row, of
 * every feature version -- the ONE copy, shared by discoverCandidates.ts
 * and discoverAdjacency.ts. bright/warm share spectralCentroidHz as
 * opposite ends. */
export const DISCOVER_TRAIT_FIELD: Record<
  DiscoverTraitKind,
  'bassEnergyRatio' | 'transientDensity' | 'spectralCentroidHz'
> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'transientDensity',
  bright: 'spectralCentroidHz',
  warm: 'spectralCentroidHz'
}

/** Each trait kind's PREFERRED field (docs/superpowers/specs/2026-09-22-
 * discover-promise-vs-delivery-design.md, Phase 3): the better measurement
 * a feature-version-2 row carries. A row without it (not re-extracted yet)
 * is judged by DISCOVER_TRAIT_FIELD instead. bassHeavy has no new field. */
export const DISCOVER_TRAIT_PREFERRED_FIELD: Record<DiscoverTraitKind, TraitField> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'rhythmicStrength',
  bright: 'spectralCentroidFftHz',
  warm: 'spectralCentroidFftHz'
}

/** Which end of its field a trait kind wants -- rankCandidates scores
 * closeness to this end of the POOL's own range. */
export const DISCOVER_TRAIT_DIRECTION: Record<DiscoverTraitKind, 'high' | 'low'> = {
  bassHeavy: 'high',
  rhythmic: 'high',
  bright: 'high',
  warm: 'low'
}

/** The value a stem is judged by per requested trait kind (null = unknown):
 * its preferred field when it has one, else its fallback field. Only the
 * requested kinds are present. */
export type TraitValues = Partial<Record<DiscoverTraitKind, number | null>>

/** Raw per-FIELD values (null = absent/invalid) for the preferred AND
 * fallback fields of each requested kind -- what library percentiles are
 * looked up from, so a stem can fall back to its old field's table while
 * the new field's table doesn't exist yet. */
export type TraitFieldValues = Partial<Record<TraitField, number | null>>

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function traitFieldValuesFromFeatures(
  features: StemFeatures,
  kinds: readonly DiscoverTraitKind[]
): TraitFieldValues {
  const out: TraitFieldValues = {}
  for (const kind of kinds) {
    for (const field of [DISCOVER_TRAIT_PREFERRED_FIELD[kind], DISCOVER_TRAIT_FIELD[kind]]) {
      out[field] = finiteOrNull(features[field])
    }
  }
  return out
}

export function traitValuesFromFeatures(
  features: StemFeatures,
  kinds: readonly DiscoverTraitKind[]
): TraitValues {
  const out: TraitValues = {}
  for (const kind of kinds) {
    out[kind] =
      finiteOrNull(features[DISCOVER_TRAIT_PREFERRED_FIELD[kind]]) ??
      finiteOrNull(features[DISCOVER_TRAIT_FIELD[kind]])
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
