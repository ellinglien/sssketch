// src/shared/roleEmbeddingRefinement.ts
import type { StemRoleInfo, ArrangeRole, DrumSubRole } from './stemRole'
import { refineRoleWithCentroidSuggestion } from './roleCentroidRefinement'
import { suggestCategoryFromEmbedding, type ConfirmedEmbedding } from './embeddingMatch'
import type { CategoryCentroidStore } from './categoryCentroids'

/** Every axis's own confirmed-embeddings list this function needs -- fetched
 * once per mount (get-confirmed-embeddings IPC, one call per axis) by a
 * caller, same frozen-snapshot pattern as centroidStore. */
export interface ConfirmedEmbeddingsByAxis {
  arrangeRoles: ConfirmedEmbedding[]
  drumSubRoles: ConfirmedEmbedding[]
}

/** Composes embeddingMatch.ts's own suggestCategoryFromEmbedding with the
 * already-shipped roleCentroidRefinement.ts's refineRoleWithCentroidSuggestion
 * -- embedding-based match preferred whenever this stem's embedding has
 * already been extracted AND embeddingMatch has something confident to say,
 * Plan B1's centroid classifier as the fallback otherwise (no embedding yet,
 * or embeddingMatch itself declines to guess). Same "only overrides when
 * busId is null" and "never forces a guess when uncertain" shape as the
 * function it wraps -- this is a stronger signal source slotted into the
 * SAME priority chain, not a redesign of it.
 *
 * `embedding` is null for a stem that hasn't been extracted yet (the normal
 * case for a while after a fresh library sync, since extraction is ambient
 * and throttled -- see BackgroundFeatureScan.tsx) -- falls straight through
 * to the centroid path with no special-casing needed here. */
export function refineRoleWithEmbeddingOrCentroidSuggestion(
  role: StemRoleInfo,
  rawFeatureVector: number[] | null,
  centroidStore: CategoryCentroidStore,
  confirmedEmbeddings: ConfirmedEmbeddingsByAxis,
  embedding: number[] | null = null
): StemRoleInfo {
  if (role.busId !== null) return role

  if (embedding) {
    const suggestedArrangeRole = suggestCategoryFromEmbedding(
      confirmedEmbeddings.arrangeRoles,
      embedding
    ) as ArrangeRole | null
    if (suggestedArrangeRole) {
      const drumSubRole =
        suggestedArrangeRole === 'drums'
          ? ((suggestCategoryFromEmbedding(
              confirmedEmbeddings.drumSubRoles,
              embedding
            ) as DrumSubRole | null) ?? undefined)
          : undefined
      return { ...role, arrangeRole: suggestedArrangeRole, drumSubRole, uncertain: false }
    }
  }

  return refineRoleWithCentroidSuggestion(role, rawFeatureVector, centroidStore)
}
