// src/renderer/src/components/AutoArrangeWizard.tsx
import { useState } from 'react'
import { useAppSelector, useDispatch } from '../state/StoreContext'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { computeDensityScore, computeFillScore } from '@shared/stemDensityScore'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import type { StemRoleInfo } from '@shared/stemRole'
import type { ArrangeStemInput } from '@shared/autoArrangeEngine'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { buildArrangeActions } from '@shared/autoArrangeApply'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import { AutoArrangeBuildStep } from './AutoArrangeBuildStep'

interface Props {
  onClose: () => void
}

type WizardStep =
  | { phase: 'role' }
  | { phase: 'build'; stems: ArrangeStemInput[] }
  | {
      phase: 'confirm-rerun'
      pendingMoves: ArrangeMoveRecord[]
      totalSteps: number
      existingRegionCount: number
    }

/** Orchestrates AutoArrangeRoleStep.tsx -> AutoArrangeBuildStep.tsx -> real
 * dispatch. Sits between the two click-through steps and buildArrangeActions
 * (autoArrangeApply.ts), which turns the finished move list into real
 * SET_PLAYED_BARS/ADD_MUTE_REGION actions.
 *
 * Scope: pools stems from EVERY rifff currently placed on the timeline, via
 * usePlacedFlatStems (state/usePlacedFlatStems.ts) -- the same hook
 * AutoArrangeRoleStep.tsx uses, so both agree on one "all placed rifffs'
 * stems" data source. Not one target rifff passed in as a prop -- there's no
 * PLACE_ON_TIMELINE step here anymore either, since every rifff in scope is,
 * by that same selection criterion, already placed.
 *
 * Re-run guard: buildArrangeActions always emits a fresh, complete set of
 * mute regions for every targeted stem (it has no notion of "existing" state
 * -- see its own doc comments), so applying it a second time over a stem
 * that was already auto-arranged (or manually mute-region-edited) would
 * silently replace that state with no way back. handleBuildComplete checks
 * the REAL pre-apply state (muteRegions + playedBars) for every stem this
 * run would touch and, if either shows prior arrangement, routes through an
 * explicit confirm step instead of applying straight away -- never silently
 * clears, never silently layers on top.
 */
export function AutoArrangeWizard({ onClose }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const muteRegions = useAppSelector((s) => s.muteRegions)
  const playedBarsOverrides = useAppSelector((s) => s.playedBars)
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
        role: role.arrangeRole,
        densityScore,
        fillScore,
        included: true,
        frequency: role.frequency
      }
    })
    setStep({ phase: 'build', stems })
  }

  function handleBuildComplete(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const stemKeys = [...new Set(moves.map((m) => m.stemKey))]
    const existingRegionCount = stemKeys.reduce(
      (count, key) => count + (muteRegions[key]?.length ?? 0),
      0
    )
    // Multi-rifff aware: a re-run warning fires if ANY rifff whose stems this
    // run touches already carries a playedBars override -- not just one
    // groupId, since moves can now span several placed rifffs at once.
    const touchedGroupIds = [
      ...new Set(
        stemKeys
          .map((key) => flatStemsByKey.get(key)?.groupId)
          .filter((g): g is string => g !== undefined)
      )
    ]
    const hasExtendedPlayedBars = touchedGroupIds.some(
      (groupId) => playedBarsOverrides[groupId] !== undefined
    )
    if (existingRegionCount > 0 || hasExtendedPlayedBars) {
      setStep({ phase: 'confirm-rerun', pendingMoves: moves, totalSteps, existingRegionCount })
      return
    }
    apply(moves, totalSteps)
  }

  function apply(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeActions(moves, totalSteps)
    for (const action of actions) {
      dispatch(action)
    }
    onClose()
  }

  if (step.phase === 'role') {
    return <AutoArrangeRoleStep onConfirm={handleRoleConfirm} onCancel={onClose} />
  }

  if (step.phase === 'build') {
    return (
      <AutoArrangeBuildStep
        stems={step.stems}
        onComplete={handleBuildComplete}
        onCancel={onClose}
      />
    )
  }

  // confirm-rerun -- styled after AutoArrangeRoleStep.tsx / AutoArrangeBuildStep.tsx's
  // own dialog conventions (see docs/design.md: dialogs share one visual
  // treatment, no click-outside-to-dismiss on anything consequential).
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          width: 360
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 12 }}>
          re-run auto-arrange
        </div>
        <div style={{ fontSize: 11, color: 'var(--ra-text)', marginBottom: 16 }}>
          {step.existingRegionCount > 0 ? (
            <>
              this will replace {step.existingRegionCount} existing mute region
              {step.existingRegionCount === 1 ? '' : 's'} on these stems.
            </>
          ) : (
            <>these stems were already arranged before -- this will replace that arrangement.</>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
          <button
            onClick={() => apply(step.pendingMoves, step.totalSteps)}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)'
            }}
          >
            replace and apply
          </button>
        </div>
      </div>
    </div>
  )
}
