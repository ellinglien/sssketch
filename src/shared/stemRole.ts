import type { BusId, SoundType, Stem } from './types'

export interface StemRoleInfo {
  stemKey: string
  soundType: SoundType
  busId: BusId | null
  // True only when NEITHER signal has a real classification: soundType is still
  // the unresolved 'fx' default AND this stem has never been through Tidy Up
  // (busOf has no entry for it). The role-confirmation UI must flag this rather
  // than silently trust it, per the design spec.
  uncertain: boolean
  included: boolean
}

export function resolveStemRole(stem: Stem, stemKey: string, busId: BusId | null): StemRoleInfo {
  const uncertain = stem.type === 'fx' && busId === null
  return {
    stemKey,
    soundType: stem.type,
    busId,
    uncertain,
    included: true
  }
}
