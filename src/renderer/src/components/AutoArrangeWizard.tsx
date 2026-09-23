// src/renderer/src/components/AutoArrangeWizard.tsx
import { useCallback, useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { computeDensityScore, computeFillScore } from '@shared/stemDensityScore'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { engineRoleFor, type StemRoleInfo } from '@shared/stemRole'
import type { ArrangeStemInput } from '@shared/autoArrangeEngine'
import { runAutoArrangeBuild, type ArrangeShape } from '@shared/autoArrangeAutomation'
import {
  lockClimaxFromArrangeRoles,
  type CoachClimaxStemInput,
  type LockedClimax
} from '@shared/coachClimax'
import { buildArrangeReplaceActions } from '../state/selectors'
import { AutoArrangeCoachStep } from './AutoArrangeCoachStep'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import type { ProjectRef } from '@shared/types'
import { recordRoleCategorization } from '../state/stemCategoryCapture'

interface Props {
  onClose: () => void
  currentSketch: ProjectRef
}

/** Which of the two routes through the auto-arranger the user picked, or
 * null while they are still being asked. */
type ArrangeRoute = 'instant' | 'guided'

const panelStyle: React.CSSProperties = {
  background: 'var(--ra-bg-bar)',
  border: '1px solid var(--ra-border-strong)',
  borderRadius: 0,
  padding: 20,
  width: 420
}

const routeButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  borderRadius: 0,
  padding: 10,
  marginTop: 'var(--ra-s-2)',
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text)',
  fontSize: 11,
  cursor: 'pointer'
}

/**
 * TWO ROUTES, AND BOTH STAY.
 *
 * The map plan as drafted would have retired the one-shot build -- "confirm
 * roles, then the whole arrangement lands instantly" -- by making the guided
 * flow the only way through this wizard. Elling was asked directly and chose
 * to keep both. So this screen branches rather than replaces:
 *
 * - **build it for me** is the existing path, completely unchanged:
 *   runAutoArrangeBuild + buildArrangeReplaceActions, length and shape asked
 *   on the role step, one BATCH, done.
 * - **walk me through it** locks a climax from the roles the user just
 *   confirmed and hands it to sssketchy (AutoArrangeCoachStep), who asks his
 *   own two questions and builds the map.
 *
 * The length and shape controls are hidden on the guided route only: they are
 * sssketchy's own two questions there, and asking them twice in two
 * vocabularies would be the app arguing with itself. On the instant route
 * they are the only place those numbers come from, so they stay.
 */
export function AutoArrangeWizard({ onClose, currentSketch }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()
  const [route, setRoute] = useState<ArrangeRoute | null>(null)
  const [climax, setClimax] = useState<LockedClimax | null>(null)

  async function handleInstantConfirm(
    roles: StemRoleInfo[],
    buildOptions?: { targetSections: number; shape: ArrangeShape }
  ): Promise<void> {
    // AutoArrangeRoleStep renders this wizard's length/shape controls on the
    // instant route, so buildOptions is always populated by the time this
    // handler runs.
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

  /**
   * The guided route's own role confirmation. It BUILDS NOTHING.
   *
   * What the roles produce here is the MATERIAL: a locked climax carrying
   * the role the user just confirmed for every stem, which the map is
   * carved from. Starting the flow and giving it that material go out in
   * one batch, so opening sssketchy is one step rather than two.
   */
  const handleGuidedConfirm = useCallback(
    (roles: StemRoleInfo[]): void => {
      const included = roles.filter((role) => role.included)
      recordRoleCategorization(roles, flatStemsByKey, 'autoarrange', currentSketch)
      const inputs: CoachClimaxStemInput[] = []
      for (const role of included) {
        const flat = flatStemsByKey.get(role.stemKey)
        if (flat === undefined) continue
        inputs.push({
          stem: {
            path: flat.stem.path,
            name: flat.stem.name,
            author: flat.stem.author,
            type: flat.stem.type,
            durationSec: flat.stem.durationSec,
            barLength: flat.stem.barLength
          },
          // role.arrangeRole, NOT engineRoleFor(role): engineRoleFor
          // widens to a drum SUB-role ('kick', 'snare') for the engine's
          // diversity scoring, and those are not ArrangeRole values --
          // arrangeRoleToSlotKinds has no entry for them. The climax wants
          // the eight-value role the user actually picked in the dropdown.
          role: role.arrangeRole,
          gain: state.vol[flat.stemKey] ?? 1
        })
      }
      const locked = lockClimaxFromArrangeRoles(inputs, state.bpm, Date.now())
      if (locked === null) return
      dispatch({
        type: 'BATCH',
        actions: [
          { type: 'COACH_START', now: Date.now() },
          { type: 'COACH_SET_CLIMAX', climax: locked }
        ]
      })
      setClimax(locked)
    },
    [currentSketch, dispatch, flatStemsByKey, state.bpm, state.vol]
  )

  if (climax !== null) {
    return <AutoArrangeCoachStep climax={climax} onCancel={onClose} onBuilt={onClose} />
  }

  if (route === 'instant') {
    return (
      <AutoArrangeRoleStep
        onConfirm={(roles, buildOptions) => void handleInstantConfirm(roles, buildOptions)}
        onCancel={onClose}
      />
    )
  }

  if (route === 'guided') {
    return (
      <AutoArrangeRoleStep
        onConfirm={handleGuidedConfirm}
        onCancel={onClose}
        showLengthAndShape={false}
      />
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        zIndex: 'var(--ra-z-modal)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div style={panelStyle}>
        <div className="ra-eyebrow">auto-arrange</div>
        <div
          style={{
            marginTop: 'var(--ra-s-2)',
            fontSize: 11,
            lineHeight: 'var(--ra-lh-body)',
            color: 'var(--ra-text-2)'
          }}
        >
          two ways to get an arrangement out of what is on the timeline.
        </div>

        <button type="button" onClick={(): void => setRoute('instant')} style={routeButtonStyle}>
          build it for me
          <div style={{ marginTop: 4, fontSize: 9, color: 'var(--ra-text-3)' }}>
            confirm the roles, pick a length, and the whole thing lands at once.
          </div>
        </button>

        <button type="button" onClick={(): void => setRoute('guided')} style={routeButtonStyle}>
          walk me through it
          <div style={{ marginTop: 4, fontSize: 9, color: 'var(--ra-text-3)' }}>
            sssketchy asks a couple of things, then lays out a map you can edit.
          </div>
        </button>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ra-s-7)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
}
