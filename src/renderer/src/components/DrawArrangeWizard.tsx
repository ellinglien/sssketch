// src/renderer/src/components/DrawArrangeWizard.tsx
import { useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { engineRoleFor, type StemRoleInfo } from '@shared/stemRole'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { buildArrangeReplaceActions } from '../state/selectors'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import { DrawArrangeGridStep, type GridStem } from './DrawArrangeGridStep'
import { stemLabelsByKey } from './autoArrangeLabels'
import { typeColorVar } from '../theme/typeColor'

interface Props {
  onClose: () => void
}

type WizardStep = { phase: 'role' } | { phase: 'grid'; stems: GridStem[] }

/** Orchestrates AutoArrangeRoleStep.tsx -> DrawArrangeGridStep.tsx -> real
 * dispatch -- Draw Arrangement's own equivalent of AutoArrangeWizard.tsx,
 * reusing that same role-confirmation step (showFrequency/skippable both
 * off/on respectively, since Draw Arrangement's grid has no concept of
 * re-entry frequency; showLengthAndShape off too, since a drawn
 * arrangement's length/shape come from the grid itself, not an upfront
 * choice, and that step's own advisory text references phases this flow
 * doesn't have) but wiring it to the drawing grid instead of the
 * weighted-candidate build step.
 *
 * handleRoleConfirm here is synchronous and does no feature extraction --
 * unlike AutoArrangeWizard.tsx, Draw Arrangement never scores a stem's
 * density/fill (that's exclusively autoArrangeEngine.ts's candidate-
 * weighting concern); it only needs each included stem's disambiguated
 * label (stemLabelsByKey, shared with AutoArrangeBuildStep.tsx so a stem
 * reads as the same number in both flows) and its identity color.
 *
 * handleApply reuses buildArrangeReplaceActions unchanged, same as
 * AutoArrangeWizard.tsx's own handleBuildComplete -- see that function's
 * doc comment for why each touched rifff's stems land back on several
 * channels as independent clips, and why that means switching back to
 * normal arranger mode afterward regardless of which flow produced the
 * moves. */
export function DrawArrangeWizard({ onClose }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()

  const [step, setStep] = useState<WizardStep>({ phase: 'role' })

  function handleRoleConfirm(roles: StemRoleInfo[]): void {
    const included = roles.filter((r) => r.included)
    const labelByKey = stemLabelsByKey(
      included.map((r) => ({ stemKey: r.stemKey, role: engineRoleFor(r), included: true }))
    )
    const stems: GridStem[] = included.map((role) => {
      const fs = flatStemsByKey.get(role.stemKey)
      const color = fs ? typeColorVar(fs.stem.type) : 'var(--ra-text-3)'
      return {
        stemKey: role.stemKey,
        label: labelByKey.get(role.stemKey) ?? role.stemKey,
        typeColor: color
      }
    })
    setStep({ phase: 'grid', stems })
  }

  function handleApply(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    // One BATCH dispatch, not a loop -- see AutoArrangeWizard.tsx's own
    // identical change for why: without this, undoing a drawn arrangement
    // cost one Cmd+Z per pasted clip copy instead of one for the whole
    // apply.
    dispatch({
      type: 'BATCH',
      actions: [...actions, { type: 'SET_ARRANGER_MODE', mode: 'normal' }]
    })
    onClose()
  }

  if (step.phase === 'role') {
    return (
      <AutoArrangeRoleStep
        onConfirm={handleRoleConfirm}
        onCancel={onClose}
        showFrequency={false}
        skippable={true}
        showLengthAndShape={false}
      />
    )
  }

  return <DrawArrangeGridStep stems={step.stems} onApply={handleApply} onCancel={onClose} />
}
