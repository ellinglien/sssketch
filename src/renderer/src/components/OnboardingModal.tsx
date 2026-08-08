import { useState } from 'react'

/** Shown on every launch by default (see App.tsx's Frame -- persisted via
 * localStorage, same convention as LoreLibraryBrowser.tsx's own
 * loreUsername setting) until "don't show this again" is checked. Kept
 * deliberately short -- a paragraph-per-concept explainer would wear thin
 * fast if it's the first thing you see every time you open the app. */
export function OnboardingModal({
  hasExistingContent,
  onDismiss,
  onOpenEndlesss,
  onStartTour
}: {
  /** Hides "take the tour" -- the tour imports a demo rifff onto the
   * timeline, which only makes sense on an empty sketch. A returning user
   * who already has real content shouldn't risk it landing next to (or
   * getting confused with) their own work. */
  hasExistingContent: boolean
  /** dontShowAgain reflects the checkbox at the moment of dismissal --
   * App.tsx only persists the opt-out when true, so leaving it unchecked
   * means this shows again next launch. */
  onDismiss: (dontShowAgain: boolean) => void
  /** Dismisses AND opens the Endlesss login/import browser directly --
   * the shortest path from "just opened this" to "have real audio in the
   * timeline" for anyone with an Endlesss account already. */
  onOpenEndlesss: (dontShowAgain: boolean) => void
  /** Dismisses AND starts the guided tour (see TourOverlay.tsx). */
  onStartTour: (dontShowAgain: boolean) => void
}): React.JSX.Element {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div
        style={{
          width: 'min(420px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20
        }}
      >
        <span className="ra-eyebrow">welcome</span>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>
          sssketch turns Endlesss stems into a real arrangement
        </div>

        <ul
          style={{
            margin: '12px 0 0',
            padding: '0 0 0 16px',
            fontSize: 11,
            color: 'var(--ra-text-2)',
            lineHeight: 1.6
          }}
        >
          <li>
            drag in a rifff folder, or click <span style={{ color: 'var(--ra-text)' }}>import</span>{' '}
            to browse Endlesss directly
          </li>
          <li>tidy up groups similar-sounding stems onto shared tracks automatically</li>
          <li>sketch mode for a quick rough layout, arranger for the full timeline</li>
        </ul>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 18
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              color: 'var(--ra-text-3)'
            }}
          >
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            don&apos;t show this again
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onDismiss(dontShowAgain)}
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
              start sketching
            </button>
            {!hasExistingContent && (
              <button
                onClick={() => onStartTour(dontShowAgain)}
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
                take the tour
              </button>
            )}
            <button
              onClick={() => onOpenEndlesss(dontShowAgain)}
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
              log into endlesss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
