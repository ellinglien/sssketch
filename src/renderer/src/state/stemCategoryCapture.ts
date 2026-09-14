// src/renderer/src/state/stemCategoryCapture.ts
import type { StemRoleInfo } from '@shared/stemRole'
import type { ProjectRef } from '@shared/types'
import type { FlatStem } from './usePlacedFlatStems'

/** Forward-captures every INCLUDED stem's confirmed arrangeRole/drumSubRole
 * into the library-wide StemCategories table (design spec §2) -- fire-and-
 * forget, matching ClusterStemsBrowser.tsx's own recordBusCategories. This
 * is new behavior: today this data reaches nowhere at all once the wizard
 * closes (see the design spec's own Background) -- it's the only way
 * role/drum-sub-role data ever becomes recoverable going forward.
 *
 * Shared by AutoArrangeWizard.tsx and DrawArrangeWizard.tsx's own
 * handleRoleConfirm, which both reach this exact same confirmation shape
 * from otherwise-unrelated flows -- duplicating this per-wizard would
 * silently let the two call sites drift out of sync with each other (see
 * the design spec's own §9 consolidation priority). */
export function recordRoleCategorization(
  roles: StemRoleInfo[],
  flatStemsByKey: Map<string, FlatStem>,
  source: 'autoarrange' | 'drawarrange',
  currentSketch: ProjectRef
): void {
  const entries: {
    path: string
    arrangeRole: StemRoleInfo['arrangeRole']
    drumSubRole?: StemRoleInfo['drumSubRole']
  }[] = []
  for (const role of roles) {
    if (!role.included) continue
    const stem = flatStemsByKey.get(role.stemKey)?.stem
    if (!stem) continue
    entries.push({ path: stem.path, arrangeRole: role.arrangeRole, drumSubRole: role.drumSubRole })
  }
  if (entries.length === 0) return
  void window.rifffApi.upsertStemCategoryRole(entries, source, currentSketch)
}
