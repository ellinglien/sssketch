import { COACH_PHASES, coachStepsInPhase } from '@shared/coachSteps'
import { coachPhaseElapsedMs, type CoachState } from '@shared/coach'

const PANEL_WIDTH = 340

function minutes(ms: number): number {
  return Math.floor(ms / 60_000)
}

/** "12 of 60-90 min" -- the spec's gentle timer, stated as a fact and never
 * as a judgement. Nothing here goes red, nothing blocks. */
function phaseTiming(elapsedMs: number, minMinutes: number, maxMinutes: number): string {
  return `${minutes(elapsedMs)} of ${minMinutes}-${maxMinutes} min`
}

/** Three plain ASCII marks: done, skipped, and the one you are on. No
 * colour and no icon font -- colour in this app is spent only on things
 * that carry audio information. */
function stepMark(outcome: string | undefined, isCurrent: boolean): string {
  if (outcome === 'done') return 'x'
  if (outcome === 'skipped') return '-'
  return isCurrent ? '>' : ' '
}

/**
 * The whole flow at a glance: three phases, every step, and where the time
 * went. Opened by CLICKING THE SPRITE -- a deliberately different gesture
 * from the bubble's own buttons, "so the two never compete" (spec).
 *
 * Deliberately a flat, scannable list rather than anything interactive: the
 * bubble is where you act, this is where you look. The one exception is the
 * close button, and (when he is minimised) a way back to the current step --
 * both passed in, so this component stays presentational.
 */
export function SssketchyChecklist({
  coach,
  now,
  zIndex,
  onClose,
  onRestore
}: {
  coach: CoachState
  /** Injected rather than read here, so the whole panel re-renders off one
   * clock owned by SssketchyCoach.tsx instead of each row running its own. */
  now: number
  /** The same layer the bubble is on, passed in rather than fixed here:
   * opening this from a sprite standing inside the riff library's own
   * full-screen view has to float above that view too, or clicking him
   * appears to do nothing. See SssketchyCoach.tsx's own useAnchorLeft. */
  zIndex: React.CSSProperties['zIndex']
  onClose: () => void
  /** Present only while he is minimised -- the way back to the bubble. */
  onRestore?: () => void
}): React.JSX.Element {
  const buttonStyle: React.CSSProperties = {
    height: 20,
    borderRadius: 0,
    padding: '0 8px',
    fontSize: 10,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)',
    cursor: 'pointer'
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        bottom: 96,
        width: PANEL_WIDTH,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        borderRadius: 0,
        padding: 'var(--ra-s-6)',
        zIndex,
        boxShadow: 'var(--ra-shadow-popover)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div className="ra-eyebrow">the method</div>
        <button type="button" onClick={onClose} style={buttonStyle}>
          close
        </button>
      </div>

      {COACH_PHASES.map((phase) => (
        <div key={phase.id} style={{ marginTop: 'var(--ra-s-6)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--ra-text)'
            }}
          >
            <span>{phase.label}</span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
              {phaseTiming(
                coachPhaseElapsedMs(coach, phase.id, now),
                phase.targetMinMinutes,
                phase.targetMaxMinutes
              )}
            </span>
          </div>

          {coachStepsInPhase(phase.id, coach.flavour).map((step) => {
            const isCurrent = step.id === coach.stepId && coach.status !== 'finished'
            return (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  gap: 'var(--ra-s-2)',
                  marginTop: 'var(--ra-s-1)',
                  fontSize: 10,
                  lineHeight: 'var(--ra-lh-body)',
                  color: isCurrent ? 'var(--ra-text)' : 'var(--ra-text-3)'
                }}
              >
                <span style={{ width: 10, flex: 'none', whiteSpace: 'pre' }}>
                  {stepMark(coach.outcomes[step.id], isCurrent)}
                </span>
                <span>{step.label}</span>
              </div>
            )
          })}
        </div>
      ))}

      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          style={{ ...buttonStyle, marginTop: 'var(--ra-s-6)', height: 22, padding: '0 10px' }}
        >
          back to the step
        </button>
      )}
    </div>
  )
}
