import type { StemRoleInfo, ArrangeRole, DrumSubRole } from './stemRole'
import { suggestCategory, type CategoryCentroidStore } from './categoryCentroids'

/** Applies the centroid classifier's own suggestion on top of an already-
 * resolved StemRoleInfo (resolveStemRole, stemRole.ts) -- kept as its own
 * function/file rather than folded into resolveStemRole itself, since
 * categoryCentroids.ts needs ArrangeRole/DrumSubRole types FROM
 * stemRole.ts, and stemRole.ts importing back from categoryCentroids.ts
 * to call this would be a real circular import. See this plan's own
 * "Important context" for the full reasoning.
 *
 * Only ever overrides a role that has NO confirmed busId -- a human
 * confirmation in Tidy Up always wins outright, exactly like
 * resolveStemRole's own busId handling. When it does apply, the centroid
 * suggestion overrides BOTH the raw SoundType fallback AND a PresetName
 * match -- the centroid classifier ranks as the STRONGER signal of the
 * two non-human-confirmed ones (see this plan's own "Important context"
 * for why). rawFeatureVector is null for a stem that hasn't been scanned
 * yet (see useStemFeatureScan.ts) -- nothing to suggest from, role passes
 * through unchanged. */
export function refineRoleWithCentroidSuggestion(
  role: StemRoleInfo,
  rawFeatureVector: number[] | null,
  centroidStore: CategoryCentroidStore
): StemRoleInfo {
  if (role.busId !== null) return role
  if (!rawFeatureVector) return role

  const suggestedArrangeRole = suggestCategory(
    centroidStore,
    'arrangeRole',
    rawFeatureVector
  ) as ArrangeRole | null
  if (!suggestedArrangeRole) return role

  const drumSubRole =
    suggestedArrangeRole === 'drums'
      ? ((suggestCategory(centroidStore, 'drumSubRole', rawFeatureVector) as DrumSubRole | null) ??
        undefined)
      : undefined

  return { ...role, arrangeRole: suggestedArrangeRole, drumSubRole, uncertain: false }
}
