import { useMemo } from 'react'
import { useAppSelector } from './StoreContext'
import { stemKey as buildStemKey, type Rifff, type Stem } from '@shared/types'

/** One stem flattened out of its owning placed rifff, carrying enough of that
 * rifff's identity (groupId) to rebuild its real per-stem stemKey. */
export interface FlatStem {
  stem: Stem
  groupId: string
  stemKey: string
}

/** "All stems from every rifff currently placed on the timeline" -- the same
 * pooling Tidy Up itself uses, and what auto-arrangement (AutoArrangeRoleStep.tsx,
 * AutoArrangeWizard.tsx) was reworked to operate over instead of one
 * caller-supplied target groupId (see docs/superpowers/plans/ for that
 * history). Extracted here because it started out identically duplicated
 * between those two components -- same filter, same flatten, same shape.
 * Follows useGatedRecordingControls.ts's own pattern of a small `state/`-local
 * hook wrapping a StoreContext selector rather than threading this through
 * props.
 *
 * The timeline-length guard (auto-arrange only available under 32 placed
 * bars, see App.tsx/selectors.ts's `placedTimelineSpanBars`) ended up NOT
 * using this hook -- it needs to be a plain function testable directly
 * against an AppState in selectors.test.ts without React, so it re-derives
 * the same "placed" filter itself rather than sharing code with this hook.
 *
 * Returns `placedRifffs` and `flatStems`/`flatStemsByKey` -- the array for
 * callers that need to iterate every stem alongside its owning rifff
 * (AutoArrangeRoleStep.tsx's density-map merge, which needs `rifff.stems`/
 * `rifff.groupId` grouped, not flattened), the Map for callers that only
 * ever look a stem up BY its stemKey (AutoArrangeWizard.tsx's role/rerun
 * resolution, previously a `flatStems.find(...)` linear scan per stem). */
export function usePlacedFlatStems(): {
  placedRifffs: Rifff[]
  flatStems: FlatStem[]
  flatStemsByKey: Map<string, FlatStem>
} {
  const rifffs = useAppSelector((s) => s.rifffs)

  const placedRifffs = useMemo(
    () => Object.values(rifffs).filter((r) => r.startBar !== undefined),
    [rifffs]
  )
  const flatStems = useMemo<FlatStem[]>(
    () =>
      placedRifffs.flatMap((rifff) =>
        rifff.stems.map((stem) => ({
          stem,
          groupId: rifff.groupId,
          stemKey: buildStemKey(rifff.groupId, stem.slot)
        }))
      ),
    [placedRifffs]
  )
  const flatStemsByKey = useMemo(
    () => new Map(flatStems.map((fs) => [fs.stemKey, fs])),
    [flatStems]
  )

  return { placedRifffs, flatStems, flatStemsByKey }
}
