import type { BusId, SoundType, Stem } from './types'

/** Arrangement-oriented role taxonomy for the auto-arrange role-confirmation
 * step -- a purpose-built set distinct from both SoundType (Endlesss's raw
 * instrument taxonomy, which doesn't help with arrangement decisions -- e.g.
 * 'audioIn' says nothing about whether a stem is a vocal that should enter
 * late) and BusId (Tidy Up's own 5-value mix-bus taxonomy, which this
 * extends but does not replace -- BusId itself is untouched, see
 * docs/superpowers/specs for its own scope). 'textureFx' is ambient/
 * atmospheric material (pads/drones/sweeps), distinct from the generic 'aux'
 * catch-all; 'fill' is one-shot hits/stutters/percussion fills, mapping
 * directly onto autoArrangeEngine.ts's own "Fill" move type; 'vocal' is
 * vocal takes, since Endlesss jams commonly have them and they often want to
 * be held back rather than entering immediately. */
export type ArrangeRole =
  'drums' | 'bass' | 'lead' | 'backing' | 'aux' | 'textureFx' | 'fill' | 'vocal'

/** Per-stem re-entry/priority preference for autoArrangeEngine.ts. 'once' is
 * the current-behavior baseline (a stem enters at most once and never
 * re-enters after exiting during the releasing phase) -- every other value
 * both allows re-entry (after a cooldown, see REENTRY_COOLDOWN_STEPS) and
 * boosts the stem's enter-candidate weight (see
 * FREQUENCY_WEIGHT_MULTIPLIER), so it doubles as a priority signal among
 * competing stems even before any re-entry happens. */
export type StemFrequency = 'once' | 'occasional' | 'frequent' | 'veryFrequent'

const BUS_ID_TO_ARRANGE_ROLE: Record<BusId, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux'
}

const SOUND_TYPE_TO_ARRANGE_ROLE: Record<SoundType, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  notes: 'lead',
  extInst: 'backing',
  sampler: 'fill',
  fx: 'textureFx',
  extFx: 'textureFx',
  audioIn: 'vocal'
}

export interface StemRoleInfo {
  stemKey: string
  soundType: SoundType
  busId: BusId | null
  // Arrangement-oriented role -- what the role-confirmation dropdown edits.
  // Seeded from busId when present (1:1 pass-through, BusId's 5 values are
  // already a subset of ArrangeRole's 8), else guessed from soundType. See
  // ArrangeRole's own doc comment for the taxonomy's rationale.
  arrangeRole: ArrangeRole
  // True only when NEITHER signal has a real classification: soundType is still
  // the unresolved 'fx' default AND this stem has never been through Tidy Up
  // (busOf has no entry for it). The role-confirmation UI must flag this rather
  // than silently trust it, per the design spec.
  uncertain: boolean
  included: boolean
  // Re-entry/priority preference, edited independently of arrangeRole. See
  // StemFrequency's own doc comment. Defaults to 'once' -- the safe,
  // no-behavior-change default for any stem the user doesn't touch.
  frequency: StemFrequency
}

export function resolveStemRole(stem: Stem, stemKey: string, busId: BusId | null): StemRoleInfo {
  const uncertain = stem.type === 'fx' && busId === null
  const arrangeRole =
    busId !== null ? BUS_ID_TO_ARRANGE_ROLE[busId] : SOUND_TYPE_TO_ARRANGE_ROLE[stem.type]
  return {
    stemKey,
    soundType: stem.type,
    busId,
    arrangeRole,
    uncertain,
    included: true,
    frequency: 'once'
  }
}
