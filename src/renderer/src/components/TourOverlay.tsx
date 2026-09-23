import { useEffect, useState } from 'react'
import type { TourStep } from '@shared/tourSteps'

// The steps themselves (and this type) live in @shared/tourSteps so their
// copy can be held to the app's voice rules by a unit test without mounting
// React -- see that file's own doc comment. Re-exported here so nothing that
// already imports the type from this component has to move.
export type { TourStep }

const CALLOUT_WIDTH = 300

/** A minimal spotlight tour: dims the screen, cuts a highlight box out
 * around each step's target element, and shows a small callout with
 * next/back/skip. Falls back to a centered callout (no spotlight) if a
 * step's target isn't found in the DOM, rather than getting stuck. */
export function TourOverlay({
  steps,
  stepIndex,
  onNext,
  onBack,
  onSkip
}: {
  steps: readonly TourStep[]
  stepIndex: number
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}): React.JSX.Element {
  const step = steps[stepIndex]
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    function update(): void {
      const el = document.querySelector(step.selector)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step.selector])

  const isLast = stepIndex === steps.length - 1
  const calloutLeft = rect
    ? Math.min(Math.max(rect.left, 12), window.innerWidth - CALLOUT_WIDTH - 12)
    : window.innerWidth / 2 - CALLOUT_WIDTH / 2
  const calloutTop = rect
    ? Math.min(rect.bottom + 12, window.innerHeight - 160)
    : window.innerHeight / 2 - 70

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, pointerEvents: 'none' }}>
      {rect && (
        <div
          style={{
            position: 'fixed',
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
            border: '1px solid var(--ra-stretch-on)'
          }}
        />
      )}
      <div
        style={{
          position: 'fixed',
          left: calloutLeft,
          top: calloutTop,
          width: CALLOUT_WIDTH,
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 14,
          pointerEvents: 'auto'
        }}
      >
        <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
          {stepIndex + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{step.title}</div>
        <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginTop: 6, lineHeight: 1.5 }}>
          {step.body}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12
          }}
        >
          <button
            onClick={onSkip}
            style={{
              height: 20,
              borderRadius: 0,
              padding: '0 8px',
              fontSize: 9,
              border: '1px solid var(--ra-border)',
              background: 'transparent',
              color: 'var(--ra-text-3)'
            }}
          >
            skip tour
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {stepIndex > 0 && (
              <button
                onClick={onBack}
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
                back
              </button>
            )}
            <button
              onClick={onNext}
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
              {isLast ? 'finish' : 'next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
