// src/renderer/src/state/stemCategoryCapture.ts
import type { ArrangeRole, DrumSubRole, StemRoleInfo } from '@shared/stemRole'
import type { ProjectRef } from '@shared/types'
import type { FlatStem } from './usePlacedFlatStems'

/** One claim about one file. The ONLY thing the merged surface writes --
 * ArrangeRole and DrumSubRole, and nothing else (spec, "The taxonomy").
 * BusId is derived from it through ARRANGE_ROLE_TO_BUS; Discover's kinds
 * are a property of a SLOT and nothing writes one onto a file. */
export interface StemRoleConfirmation {
  path: string
  arrangeRole: ArrangeRole
  drumSubRole?: DrumSubRole
}

/** Where a confirmation came from, for the Source column. */
export type StemRoleSource = 'tidyup' | 'autoarrange' | 'drawarrange' | 'discover'

/**
 * THE one path a confirmed role reaches the library-wide StemCategories
 * table by.
 *
 * Replaces recordRoleCategorization (the wizards') and
 * recordRoleCategories (Tidy Up's), which were two functions writing the
 * same rows through the same IPC handler into the same table and triggering
 * the same server-side training (categoryCentroidTraining.ts). Two of these
 * is how the suggestion chains drifted apart in the first place, which cost
 * a real user-visible defect ("arrange mode is much better at guessing
 * currently... tidy up doesn't seem to be using it at all", 2026-09-15).
 *
 * Returns the promise rather than swallowing it: most callers are
 * fire-and-forget (`void recordStemRoles(...)`), but DiscoverPanel's
 * reclassifySlot has to know whether the write landed before it shows the
 * slot as reclassified. A member whose path does not resolve to a real
 * StemCID is silently skipped by the main-process side, not an error here.
 */
export function recordStemRoles(
  entries: StemRoleConfirmation[],
  source: StemRoleSource,
  currentSketch: ProjectRef
): Promise<void> {
  if (entries.length === 0) return Promise.resolve()
  return window.rifffApi.upsertStemCategoryRole(entries, source, currentSketch)
}

/** The wizards' own confirmation shape, as entries. INCLUDED stems only --
 * a stem the user took out of the arrangement has not been given a role,
 * it has been declined. */
export function roleConfirmationsFromStemRoles(
  roles: readonly StemRoleInfo[],
  flatStemsByKey: ReadonlyMap<string, FlatStem>
): StemRoleConfirmation[] {
  const entries: StemRoleConfirmation[] = []
  for (const role of roles) {
    if (!role.included) continue
    const stem = flatStemsByKey.get(role.stemKey)?.stem
    if (!stem) continue
    entries.push({
      path: stem.path,
      arrangeRole: role.arrangeRole,
      drumSubRole: role.drumSubRole
    })
  }
  return entries
}
