import { useState } from 'react'

const buttonStyle: React.CSSProperties = {
  height: 'auto',
  minHeight: 22,
  borderRadius: 0,
  padding: '4px 10px',
  fontSize: 10,
  whiteSpace: 'nowrap',
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)'
}

/** Shown on every launch by default (see App.tsx's Frame -- persisted via
 * localStorage, same convention as LoreLibraryBrowser.tsx's own
 * loreUsername setting) until "don't show this again" is checked. Just
 * the one-line pitch, not a feature explainer -- per direct feedback,
 * anything longer wears thin fast as the first thing you see every time
 * you open the app. */
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
          width: 'min(360px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 18
        }}
      >
        <span className="ra-eyebrow">welcome</span>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6, lineHeight: 1.4 }}>
          sketch out tracks using stems from Endlesss.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          <button onClick={() => onDismiss(dontShowAgain)} style={buttonStyle}>
            start sketching
          </button>
          {!hasExistingContent && (
            <button onClick={() => onStartTour(dontShowAgain)} style={buttonStyle}>
              take the tour
            </button>
          )}
          <button onClick={() => onOpenEndlesss(dontShowAgain)} style={buttonStyle}>
            log into endlesss
          </button>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            color: 'var(--ra-text-3)',
            marginTop: 14
          }}
        >
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          don&apos;t show this again
        </label>
      </div>
    </div>
  )
}
