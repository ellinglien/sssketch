// src/renderer/src/components/AutoArrangeWizard.tsx
import { useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { computeDensityScore, computeFillScore } from '@shared/stemDensityScore'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { engineRoleFor, type StemRoleInfo } from '@shared/stemRole'
import type { ArrangeStemInput } from '@shared/autoArrangeEngine'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { buildArrangeReplaceActions } from '../state/selectors'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import { AutoArrangeBuildStep } from './AutoArrangeBuildStep'

interface Props {
  onClose: () => void
}

type WizardStep = { phase: 'role' } | { phase: 'build'; stems: ArrangeStemInput[] }

/** Orchestrates AutoArrangeRoleStep.tsx -> AutoArrangeBuildStep.tsx -> real
 * dispatch. Sits between the two click-through steps and
 * buildArrangeReplaceActions (state/selectors.ts), which turns the finished
 * move list into real PASTE_RIFFF/DELETE_RIFFFS actions -- each touched
 * rifff's stems become independent, per-window clip copies, and the
 * original rifff is deleted outright. (Formerly SET_PLAYED_BARS/
 * ADD_MUTE_REGION edits to one continuous clip, via the now-removed
 * buildArrangeActions in autoArrangeApply.ts -- changed on Elling's real-app
 * feedback that gaps should be genuinely empty timeline space, not muted
 * regions inside one long clip.)
 *
 * Scope: pools stems from EVERY rifff currently placed on the timeline, via
 * usePlacedFlatStems (state/usePlacedFlatStems.ts) -- the same hook
 * AutoArrangeRoleStep.tsx uses, so both agree on one "all placed rifffs'
 * stems" data source. Not one target rifff passed in as a prop -- there's no
 * PLACE_ON_TIMELINE step here anymore either, since every rifff in scope is,
 * by that same selection criterion, already placed.
 *
 * No re-run confirmation step: the old buildArrangeActions path warned
 * before re-applying over a stem that showed signs (muteRegions/playedBars)
 * of a prior arrangement run, because it would silently overwrite that
 * state. That signal doesn't survive this rework -- buildArrangeReplaceActions
 * deletes the whole source rifff and replaces it with fresh independent
 * clips, so a "previous run" is no longer a detectable marker on a stem;
 * it's indistinguishable from clips placed by hand. Rather than warn on a
 * repurposed, misleading signal, this now matches how DELETE_RIFFFS already
 * works everywhere else in the app (e.g. Shelf.tsx's Delete/Backspace
 * handler) -- dispatched directly, undo-backed (useHistory/Cmd+Z), no
 * confirm dialog.
 */
export function AutoArrangeWizard({ onClose }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()

  const [step, setStep] = useState<WizardStep>({ phase: 'role' })

  async function handleRoleConfirm(roles: StemRoleInfo[]): Promise<void> {
    const included = roles.filter((r) => r.included)
    // Promise.allSettled, not a plain await loop -- mirrors
    // AutoArrangeRoleStep.tsx's own handling of getStemFeatures, which is
    // documented (stemFeaturesCache.ts) as able to reject on a corrupt/
    // unreadable stem file. A rejected stem still gets a row here (density/
    // fill score 0, the least presumptuous default) rather than aborting the
    // whole wizard over one bad file.
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
    setStep({ phase: 'build', stems })
  }

  function handleBuildComplete(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    for (const action of actions) {
      dispatch(action)
    }
    // Sketch mode's own eligibility (isSketchEligible, selectors.ts) assumes
    // every placed rifff sits on one shared channel in a plain gapless
    // sequence -- exactly what this apply step breaks: a touched rifff's
    // stems land back on SEVERAL channels (one per original stem), each with
    // its own now-possibly-different length. Left in sketch mode, that read
    // as a jumble of oddly-sized tiles and played several at once instead of
    // in sequence. Unconditional, not gated on isSketchEligible(state) --
    // per Elling, switch back to arrange mode after auto-arrange "just to be
    // safe" rather than trying to detect exactly when it's still sketch-safe.
    dispatch({ type: 'SET_ARRANGER_MODE', mode: 'normal' })
    onClose()
  }

  if (step.phase === 'role') {
    return <AutoArrangeRoleStep onConfirm={handleRoleConfirm} onCancel={onClose} />
  }

  return (
    <AutoArrangeBuildStep stems={step.stems} onComplete={handleBuildComplete} onCancel={onClose} />
  )
}
