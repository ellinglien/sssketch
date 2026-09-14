import { guessSoundTypeFromPresetName } from './presetNames'

// 'suggested' and 'confirmed' are never returned by clusterProvenance below
// -- both are set directly by ClusterStemsBrowser.tsx as a provenanceOverride,
// for a row built from the bus-centroid/embedding classifier's own auto-slot
// suggestion, or from stems already confirmed to a bus this session, neither
// of which has a name/clustering signal of its own to infer from.
export type BusProvenance = 'clustered' | 'from preset name' | 'unknown' | 'suggested' | 'confirmed'

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
