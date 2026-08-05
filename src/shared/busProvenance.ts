import { guessSoundTypeFromPresetName } from './presetNames'

export type BusProvenance = 'clustered' | 'from preset name' | 'unknown'

/**
 * Plain-text explanation of why a cluster looks the way it does, shown in
 * the labelling UI instead of a fake confidence percentage -- different
 * provenance sources are trusted differently by the user, which a single
 * number can't convey. A cluster with more than one member stem is, by
 * definition, a real DSP-clustering result ("clustered"). A SINGLETON
 * cluster (one stem, nothing else grouped with it) is less a clustering
 * result than an outlier -- for those, fall back to whether the stem's
 * own name is a recognizable Endlesss preset name (a completely
 * independent, non-DSP signal), or 'unknown' if not.
 */
export function clusterProvenance(memberStemNames: string[]): BusProvenance {
  if (memberStemNames.length > 1) return 'clustered'
  const [onlyName] = memberStemNames
  if (onlyName && guessSoundTypeFromPresetName(onlyName) !== null) return 'from preset name'
  return 'unknown'
}
