import type { BusId, SoundType, Stem } from './types'
import { guessArrangeRoleFromPresetName } from './presetNames'

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

/** The 8 ArrangeRole values in the app's own canonical display order,
 * replacing the old raw-SoundType dropdown per direct feedback (2026-09-01:
 * "audioIn doesn't really help with arrangement, does it?"). Shared between
 * AutoArrangeRoleStep.tsx's dropdown and ClusterStemsBrowser.tsx's own Tidy
 * Up picker (added 2026-09-14) so both pickers offer the same 8 options in
 * the same order. */
export const ARRANGE_ROLE_OPTIONS: ArrangeRole[] = [
  'drums',
  'bass',
  'lead',
  'backing',
  'aux',
  'textureFx',
  'fill',
  'vocal'
]

/** Finer-grained sub-categorization under the 'drums' ArrangeRole -- kick,
 * snare, hihat, clap, and perc/other, so a build with several drums-typed
 * stems doesn't read them all as one interchangeable role for diversity
 * purposes (see engineRoleFor below). Deliberately its OWN standalone
 * field, not folded into ArrangeRole's own string union: neither Endlesss's
 * SoundType nor Tidy Up's BusId has any concept of "which kit piece is
 * this," so there's no existing signal to auto-detect from (and no new
 * audio classification is being added here either -- see this feature's
 * own non-goals) -- this is manual-only, same as arrangeRole's own
 * dropdown. 'drums' itself stays a valid, un-refined choice; nothing is
 * ever forced to pick a specific piece. Scoped to drums only for now
 * (2026-09-05) -- if other roles (backing, vocal, ...) end up wanting the
 * same treatment later, generalize then, don't speculatively build it now. */
export type DrumSubRole = 'kick' | 'snare' | 'hihat' | 'clap' | 'perc'

/** DrumSubRole's own UI vocabulary -- shared between every picker that
 * offers it (AutoArrangeRoleStep.tsx's dropdown, ClusterStemsBrowser.tsx's
 * own Tidy Up picker added 2026-09-14) so the option list/labels can't
 * silently drift apart between the two. */
export const DRUM_SUB_ROLE_OPTIONS: DrumSubRole[] = ['kick', 'snare', 'hihat', 'clap', 'perc']
export const DRUM_SUB_ROLE_LABELS: Record<DrumSubRole, string> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  clap: 'clap',
  perc: 'perc / other'
}

/** Per-stem re-entry/priority preference for autoArrangeEngine.ts. 'once' is
 * the original, pre-frequency-feature baseline (a stem enters at most once
 * and never re-enters after exiting during the releasing phase) -- every
 * other value both allows re-entry (after a cooldown, see
 * REENTRY_COOLDOWN_STEPS) and boosts the stem's enter-candidate weight (see
 * FREQUENCY_WEIGHT_MULTIPLIER), so it doubles as a priority signal among
 * competing stems even before any re-entry happens. resolveStemRole defaults
 * new stems to 'occasional' rather than 'once' -- Elling wants some baseline
 * re-entry/movement without requiring every stem to be manually opted in
 * (2026-09-04). */
export type StemFrequency = 'once' | 'occasional' | 'frequent' | 'veryFrequent'

const BUS_ID_TO_ARRANGE_ROLE: Record<BusId, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux'
}

/** The real Ableton export bus each of ArrangeRole's 8 values routes a stem
 * to -- BusId only has 5 values, so the 3 that ArrangeRole adds on top
 * (textureFx/fill/vocal) have no bus of their own and route to 'aux', same
 * as the generic aux catch-all. Added for ClusterStemsBrowser.tsx's own
 * Tidy Up picker (2026-09-14, direct request): picking one of those 3
 * there still needs a real busId to assign (Tidy Up's whole export model is
 * bus-based), while ALSO recording the finer arrangeRole via
 * upsertStemCategoryRole so it isn't lost and still trains the arrangeRole
 * classifier. The inverse of BUS_ID_TO_ARRANGE_ROLE above for the 5 shared
 * values; the 3 extras are the only genuinely new mappings. */
export const ARRANGE_ROLE_TO_BUS: Record<ArrangeRole, BusId> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux',
  textureFx: 'aux',
  fill: 'aux',
  vocal: 'aux'
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
  // Only meaningful when arrangeRole is 'drums' -- see DrumSubRole's own doc
  // comment. undefined means "generic drums, not further refined," the
  // default for every stem (resolveStemRole never auto-guesses this).
  drumSubRole?: DrumSubRole
  // True only when NEITHER signal has a real classification: soundType is still
  // the unresolved 'fx' default AND this stem has never been through Tidy Up
  // (busOf has no entry for it). The role-confirmation UI must flag this rather
  // than silently trust it, per the design spec.
  uncertain: boolean
  included: boolean
  // Re-entry/priority preference, edited independently of arrangeRole. See
  // StemFrequency's own doc comment. Defaults to 'occasional' -- some
  // baseline re-entry/movement without requiring the user to manually opt
  // every stem in.
  frequency: StemFrequency
}

export function resolveStemRole(stem: Stem, stemKey: string, busId: BusId | null): StemRoleInfo {
  // Checked only when there's no confirmed busId -- a human confirmation
  // in Tidy Up always wins outright, unchanged from before this lookup
  // existed. See presetNames.ts's own doc comment on ArrangeRoleGuess for
  // why drumSubRole is always undefined with today's preset-name corpus.
  const presetGuess = busId === null ? guessArrangeRoleFromPresetName(stem.name) : null
  const uncertain = stem.type === 'fx' && busId === null && presetGuess === null
  const arrangeRole =
    busId !== null
      ? BUS_ID_TO_ARRANGE_ROLE[busId]
      : (presetGuess?.arrangeRole ?? SOUND_TYPE_TO_ARRANGE_ROLE[stem.type])
  return {
    stemKey,
    soundType: stem.type,
    busId,
    arrangeRole,
    drumSubRole: busId === null ? presetGuess?.drumSubRole : undefined,
    uncertain,
    included: true,
    frequency: 'occasional'
  }
}

/** What autoArrangeEngine.ts should actually treat this stem's "role" as,
 * for diversity-weighting/candidate-labeling purposes: the drum sub-role
 * (if arrangeRole is 'drums' and one was manually picked) instead of the
 * generic 'drums' bucket, otherwise the plain arrangeRole. The engine's own
 * roleDiversityBonus only ever compares role strings for equality -- it has
 * no idea what a "sub-role" is and needs no changes at all for this to
 * work: three drums-typed stems tagged kick/snare/hihat now correctly read
 * as three DIFFERENT roles there, instead of all three being "drums" and
 * getting zero diversity bonus for entering together. drumSubRole is
 * ignored whenever arrangeRole isn't 'drums', even if one is somehow still
 * set (e.g. left over from switching arrangeRole away from 'drums' without
 * clearing it) -- a stale sub-role must never leak into an unrelated role's
 * own identity. */
export function engineRoleFor(role: StemRoleInfo): string {
  if (role.arrangeRole === 'drums' && role.drumSubRole) return role.drumSubRole
  return role.arrangeRole
}
