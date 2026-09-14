// src/renderer/src/components/AutoArrangeWizard.tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { computeDensityScore, computeFillScore } from '@shared/stemDensityScore'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { engineRoleFor, type StemRoleInfo } from '@shared/stemRole'
import type { ArrangeStemInput } from '@shared/autoArrangeEngine'
import { runAutoArrangeBuild, type ArrangeShape } from '@shared/autoArrangeAutomation'
import { buildArrangeReplaceActions } from '../state/selectors'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import type { ProjectRef } from '@shared/types'
import { recordRoleCategorization } from '../state/stemCategoryCapture'

interface Props {
  onClose: () => void
  currentSketch: ProjectRef
}

/** Confirms roles, then builds and applies the arrangement fully
 * automatically -- no more interactive candidate-by-candidate screen.
 * Scope unchanged from before: pools stems from EVERY rifff currently
 * placed on the timeline (usePlacedFlatStems.ts), same as
 * AutoArrangeRoleStep.tsx always has.
 *
 * Reuses buildArrangeReplaceActions (state/selectors.ts) completely
 * unchanged -- only how the moves[] it consumes gets produced has changed
 * (runAutoArrangeBuild instead of click-by-click candidate picking).
 * Dispatches the whole result (every PASTE_RIFFF/DELETE_RIFFFS/etc. plus
 * the SET_ARRANGER_MODE switch) as one BATCH action, so undoing a build is
 * one Cmd+Z, not fifteen-plus: without that, re-running auto-arrange after
 * a build you don't like re-arranges its own output rather than your
 * original material. */
export function AutoArrangeWizard({ onClose, currentSketch }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()

  async function handleRoleConfirm(
    roles: StemRoleInfo[],
    buildOptions?: { targetSections: number; shape: ArrangeShape }
  ): Promise<void> {
    // AutoArrangeRoleStep always renders this wizard's length/shape
    // controls -- this is the only call site that doesn't pass
    // showLengthAndShape={false} -- so buildOptions is always populated
    // by the time this handler runs.
    const { targetSections, shape } = buildOptions!

    const included = roles.filter((r) => r.included)
    recordRoleCategorization(roles, flatStemsByKey, 'autoarrange', currentSketch)
    // Promise.allSettled, not a plain await loop -- mirrors
    // AutoArrangeRoleStep.tsx's own handling of getStemFeatures, which is
    // documented (stemFeaturesCache.ts) as able to reject on a corrupt/
    // unreadable stem file. A rejected stem still gets a row here (density/
    // fill score 0, the least presumptuous default) rather than aborting
    // the whole build over one bad file.
    const results = await Promise.allSettled(
      included.map(async (role) => {
        const stem = flatStemsByKey.get(role.stemKey)?.stem
        if (!stem) throw new Error(`AutoArrangeWizard: no stem found for role ${role.stemKey}`)
        return getStemFeatures(stem.path)
      })
    )
    const stems: ArrangeStemInput[] = included.map((role, i) => {
      const result = results[i]
      if (result.status === 'rejected') {
        console.error(
          'AutoArrangeWizard: feature extraction failed for stem',
          role.stemKey,
          result.reason
        )
      }
      const densityScore = result.status === 'fulfilled' ? computeDensityScore(result.value) : 0
      const fillScore = result.status === 'fulfilled' ? computeFillScore(result.value) : 0
      return {
        stemKey: role.stemKey,
        role: engineRoleFor(role),
        densityScore,
        fillScore,
        included: true,
        frequency: role.frequency
      }
    })

    const { moves, totalSteps } = runAutoArrangeBuild(stems, shape, targetSections)
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    // Sketch mode's own eligibility (isSketchEligible, selectors.ts) assumes
    // every placed rifff sits on one shared channel in a plain gapless
    // sequence -- exactly what this apply step breaks (a touched rifff's
    // stems land back on several channels, each with its own now-possibly-
    // different length). Unconditional, not gated on isSketchEligible(state) --
    // per Elling, switch back to arrange mode after auto-arrange "just to
    // be safe" rather than trying to detect exactly when it's still
    // sketch-safe. Folded into the same BATCH as the arrangement itself
    // (rather than a separate dispatch after it) so the whole apply really
    // is one undo checkpoint.
    dispatch({
      type: 'BATCH',
      actions: [...actions, { type: 'SET_ARRANGER_MODE', mode: 'normal' }]
    })
    onClose()
  }

  return <AutoArrangeRoleStep onConfirm={handleRoleConfirm} onCancel={onClose} />
}
