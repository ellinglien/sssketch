import { useState } from 'react'
import {
  computeCandidates,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from '@shared/autoArrangeEngine'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { applyBuildStep, selectTopCandidates } from '@shared/autoArrangeBuildStep'

interface Props {
  stems: ArrangeStemInput[]
  onComplete: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

/** Second step of the auto-arrangement wizard, shown after AutoArrangeRoleStep.tsx
 * confirms each stem's role. Drives autoArrangeEngine.ts's computeCandidates/
 * advanceBuildState/isArrangementComplete one step at a time, letting the user
 * pick from the top weighted candidates rather than fully automating the
 * build/breakdown arc. The actual stop-condition and top-N-candidate logic
 * live in autoArrangeBuildStep.ts (tested there) -- this component is just
 * the click-through presentation. Styled after AutoArrangeRoleStep.tsx /
 * TidyUpNudgeModal.tsx's conventions: see docs/design.md. */
export function AutoArrangeBuildStep({ stems, onComplete, onCancel }: Props): React.JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const [buildState, setBuildState] = useState<ArrangeBuildState>({
    activeStemKeys: [],
    peakReached: false
  })
  const [moves, setMoves] = useState<ArrangeMoveRecord[]>([])

  const candidates = selectTopCandidates(computeCandidates(stems, buildState))

  const includedCount = stems.filter((s) => s.included).length
  const tooFewStems = includedCount < 2

  function pick(candidate: ArrangeCandidate): void {
    const result = applyBuildStep(moves, buildState, stems, stepIndex, candidate)
    setMoves(result.moves)
    setBuildState(result.buildState)

    if (result.complete) {
      onComplete(result.moves, stepIndex + 1)
      return
    }
    setStepIndex(stepIndex + 1)
  }

  function finishNow(): void {
    onComplete(moves, stepIndex + 1)
  }

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
          width: 420
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 12 }}>
          step {stepIndex + 1} -- {buildState.activeStemKeys.length} active
        </div>
        {tooFewStems && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            only {includedCount} stem{includedCount === 1 ? '' : 's'} included -- not enough
            material for a real build/breakdown arc, this will be a trivial arrangement.
          </div>
        )}
        {candidates.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            no candidates -- finish below
          </div>
        ) : (
          candidates.map((c) => (
            <button
              key={`${c.stemKey}-${c.moveType}`}
              onClick={() => pick(c)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 6,
                padding: '6px 8px',
                borderRadius: 0,
                fontSize: 11,
                border: '1px solid var(--ra-border)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              {c.moveType} {c.stemKey} -- {c.reason}
            </button>
          ))
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
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
            onClick={finishNow}
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
            finish now
          </button>
        </div>
      </div>
    </div>
  )
}
