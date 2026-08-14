import { useState } from 'react'

const WORDMARK = 'SSSKETCH'.split('')

const buttonStyle: React.CSSProperties = {
  height: 36,
  borderRadius: 0,
  padding: '0 18px',
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  cursor: 'pointer'
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: '1px solid var(--ra-play-on)',
  background: 'var(--ra-play-on)',
  color: 'var(--ra-play-on-ink)'
}

// Against the new pure-black panel background (see this component's own
// panel style below), the old var(--ra-bg-row)/var(--ra-text-2) pairing
// read as a visible mid-grey box -- exactly what direct feedback called out
// ("black background, white text, no in-between greys"). Transparent fill +
// a bright var(--ra-text) outline instead, so it reads as "outlined button
// on black" rather than "grey button."
const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: '1px solid var(--ra-text)',
  background: 'transparent',
  color: 'var(--ra-text)'
}

// A plain text-link affordance, not a bordered button -- stays visually
// quieter than either CTA above. var(--ra-type-fx) is one of this app's real
// sound-type accent colors (teal), not a grey -- kept as the one deliberate
// spot of color here, same as before this component's restyle.
const linkButtonStyle: React.CSSProperties = {
  height: 36,
  border: 'none',
  background: 'transparent',
  padding: '0 4px',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--ra-type-fx)',
  cursor: 'pointer'
}

/** Shown on every launch by default (see App.tsx's Frame -- persisted via
 * localStorage, same convention as LoreLibraryBrowser.tsx's own
 * loreUsername setting) until "don't show this again" is checked, OR
 * unconditionally (regardless of that opt-out) whenever there's a genuine
 * crash-recovery snapshot to offer -- see hasRecovery below.
 *
 * Two sub-views, chosen by hasRecovery rather than any state local to this
 * component: recovery (offer to restore unsaved work from a previous
 * session that never got explicitly saved or discarded -- see
 * projectFile.ts's writeAutosave/loadAutosave/clearAutosave) and the normal
 * new/open welcome. Deriving the view straight from the prop (not mirroring
 * it into local state) means App.tsx's Frame clearing its own
 * recoverableAutosave state after a discard is all it takes to flip this
 * back to the normal view on the next render -- no separate transition to
 * manage here. */
export function OnboardingModal({
  hasRecovery,
  onRecover,
  onDiscardRecovery,
  onNewProject,
  onOpenProject,
  onOpenEndlesss,
  onStartTour,
  tourSeen,
  endlesssLoggedIn
}: {
  /** True when Frame's startup effect found a real, never-explicitly-saved-
   * or-discarded autosave snapshot -- see App.tsx's own hasRealContent
   * check. Selects the recovery sub-view below. */
  hasRecovery: boolean
  /** Loads the recovered snapshot into the live project and dismisses the
   * whole modal -- dontShowAgain reflects the checkbox at the moment of
   * the click, same semantics as every other callback here. */
  onRecover: (dontShowAgain: boolean) => void
  /** Clears the crash-recovery snapshot and falls through to the normal
   * new/open sub-view -- does NOT dismiss the modal, since the user still
   * needs to pick what to do next. No dontShowAgain: discarding recovered
   * content isn't the same decision as opting out of the welcome screen,
   * and the normal sub-view's own buttons carry the checkbox from here. */
  onDiscardRecovery: () => void
  /** Dismisses the welcome modal, then routes through the exact same "new"
   * flow as the toolbar's New button: a discard-guard if there's real
   * unsaved content on the timeline (possible here too, since the welcome
   * modal is also reachable any time via the gear menu's "show welcome
   * screen" entry, not just at a genuinely fresh launch), followed by the
   * naming modal to actually create the new sketch. No longer a silent
   * auto-named shortcut -- that used to skip both the discard-guard and
   * the actual reducer state reset, corrupting the live project when
   * reopened over real unsaved content. */
  onNewProject: (dontShowAgain: boolean) => void
  /** Dismisses and opens the project library browser. */
  onOpenProject: (dontShowAgain: boolean) => void
  /** Dismisses AND opens the Endlesss login/import browser directly --
   * the shortest path from "just opened this" to "have real audio in the
   * timeline" for anyone with an Endlesss account already. */
  onOpenEndlesss: (dontShowAgain: boolean) => void
  /** Dismisses AND starts the guided tour (see TourOverlay.tsx). App.tsx's
   * own handler confirms first when there's real content to protect, so
   * this component doesn't need to know about that itself. */
  onStartTour: (dontShowAgain: boolean) => void
  /** Once the tour has been started at least once, its welcome-screen
   * link goes away -- it's still reachable as a deliberate replay from the
   * gear/settings menu (see TransportBar.tsx), which isn't gated on this. */
  tourSeen: boolean
  /** True once Frame's mount-time endlesssAuthStatus() fetch resolves
   * "logged in" -- hides the "log into endlesss" button below, same
   * gating pattern as tourSeen above. Defaults false (button shown) until
   * that real async round trip resolves, so a slow fetch just means the
   * button pops away a moment after the modal appears rather than the
   * modal waiting on it -- an acceptable, undramatic flash, not worth
   * special-casing. */
  endlesssLoggedIn: boolean
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
          // A real, literal black -- distinct from the shell's own near-
          // black (--ra-bg-bar, #0a0a0a) per direct feedback ("black
          // background for intro/welcome, white text"). Deliberately a
          // one-off here rather than a new shared token -- this modal's
          // color choices are its own, not a second parallel palette.
          background: '#000000',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          boxShadow: 'var(--ra-shadow-popover)',
          padding: '32px 30px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        <div style={{ display: 'flex', gap: 1 }}>
          {WORDMARK.map((ch, i) => (
            <span
              key={i}
              style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: 'var(--ra-text)' }}
            >
              {ch}
            </span>
          ))}
        </div>

        {hasRecovery ? (
          <>
            <div
              style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.7, color: 'var(--ra-text)' }}
            >
              unsaved work from a previous session was found
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => onRecover(dontShowAgain)} style={primaryButtonStyle}>
                recover
              </button>
              <button onClick={onDiscardRecovery} style={secondaryButtonStyle}>
                discard
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.7, color: 'var(--ra-text)' }}
            >
              a track sketching tool
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => onNewProject(dontShowAgain)} style={primaryButtonStyle}>
                new project
              </button>
              <button onClick={() => onOpenProject(dontShowAgain)} style={secondaryButtonStyle}>
                open project
              </button>
              {!endlesssLoggedIn && (
                <button onClick={() => onOpenEndlesss(dontShowAgain)} style={secondaryButtonStyle}>
                  log into endlesss
                </button>
              )}
            </div>
            {!tourSeen && (
              <button onClick={() => onStartTour(dontShowAgain)} style={linkButtonStyle}>
                take the tour
              </button>
            )}
          </>
        )}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            color: 'var(--ra-text)'
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
