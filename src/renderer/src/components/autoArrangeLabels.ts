import type { ArrangeStemInput } from '@shared/autoArrangeEngine'

// Stem names in real Endlesss material are frequently unintelligible
// (auto-generated/generic) and can't be relied on to identify a candidate --
// the stem's own arrangeRole (already user-confirmed in the role-confirm
// wizard step) is a far more useful label. Includes DrumSubRole's own
// values (kick/snare/hihat/clap/perc) alongside the 8 ArrangeRole values --
// engineRoleFor (shared/stemRole.ts) substitutes a drum sub-role in for the
// plain 'drums' bucket before this ever reaches the engine, so `role` here
// is an opaque string that can genuinely be either.
export const ROLE_LABELS: Record<string, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux',
  textureFx: 'texture/fx',
  fill: 'fill',
  vocal: 'vocal',
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  clap: 'clap',
  perc: 'perc / other'
}

// Disambiguating label per stem (e.g. "drums 2" when 3 stems all share the
// "drums" role) -- shared by AutoArrangeBuildStep.tsx's candidate list/apply
// button label/build-progress grid AND DrawArrangeWizard.tsx's own grid-row
// labels, so the same stem always reads as the same number everywhere
// rather than each caller computing its own (possibly different) numbering.
export function stemLabelsByKey(
  stems: Pick<ArrangeStemInput, 'stemKey' | 'role' | 'included'>[]
): Map<string, string> {
  const included = stems.filter((s) => s.included)
  const totalByLabel = new Map<string, number>()
  for (const s of included) {
    const label = ROLE_LABELS[s.role] ?? s.role
    totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const byKey = new Map<string, string>()
  for (const s of included) {
    const label = ROLE_LABELS[s.role] ?? s.role
    const total = totalByLabel.get(label) ?? 1
    if (total <= 1) {
      byKey.set(s.stemKey, label)
      continue
    }
    const index = (seen.get(label) ?? 0) + 1
    seen.set(label, index)
    byKey.set(s.stemKey, `${label} ${index}`)
  }
  return byKey
}
