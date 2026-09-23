import { useEffect, useState } from 'react'
import { backgroundScanGate } from '../audio/backgroundScanGate'

const WORDMARK = 'SSSKETCH'.split('')

const buttonStyle: React.CSSProperties = {
  height: 36,
  // Fixed rather than padding-driven -- "log into endlesss" is the longest
  // label of the three normal-view buttons, and a shared width means every
  // button (including "recover"/"discard" in the recovery notice) reads
  // as one consistent row instead of each one hugging its own text.
  width: 140,
  borderRadius: 0,
  padding: '0 8px',
  fontSize: 11,
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
// quieter than either CTA above. Same color as the rest of this modal's
// body text (var(--ra-text)) per direct feedback -- previously a
// deliberate accent color (var(--ra-type-fx), teal), which read as an odd
// one-off spot of color against this modal's otherwise plain black/white
// treatment. Sits inline with the "don't show this again" checkbox in one
// shared bottom row (see that row's own comment below) -- same fontSize
// as the checkbox label so the two read as one consistent utility row.
const linkButtonStyle: React.CSSProperties = {
  height: 20,
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: 10,
  color: 'var(--ra-text)',
  cursor: 'pointer'
}

/** Shown on every launch by default (see App.tsx's Frame -- persisted via
 * localStorage, same convention as LoreLibraryBrowser.tsx's own
 * loreUsername setting) until "don't show this again" is checked, OR
 * unconditionally (regardless of that opt-out) whenever there's a genuine
 * crash-recovery snapshot to offer -- see hasRecovery below.
 *
 * hasRecovery adds a recovery notice (offer to restore unsaved work from a
 * previous session that never got explicitly saved or discarded -- see
 * projectFile.ts's writeAutosave/loadAutosave/clearAutosave) ON TOP OF the
 * normal new/open welcome, rather than replacing it with a separate full
 * sub-view -- previously this was two sequential screens (recovery, then,
 * on discard, welcome) that per direct feedback read as "two modals that
 * look very similar" back to back. One screen now: the recovery notice
 * sits above the same new/open/login buttons, which stay visible and
 * usable the whole time, so there's nothing to "fall through" to once
 * discard/recover resolves it -- clearing recoverableAutosave in App.tsx
 * just makes the notice disappear from this same modal. */
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
   * check. Shows the recovery notice above the normal new/open buttons
   * (see this component's own doc comment above). */
  hasRecovery: boolean
  /** Loads the recovered snapshot into the live project and dismisses the
   * whole modal -- dontShowAgain reflects the checkbox at the moment of
   * the click, same semantics as every other callback here. */
  onRecover: (dontShowAgain: boolean) => void
  /** Clears the crash-recovery snapshot, which makes the recovery notice
   * disappear on the next render -- does NOT dismiss the whole modal, since
   * the normal new/open buttons underneath stay exactly as they were. No
   * dontShowAgain: discarding recovered content isn't the same decision as
   * opting out of the welcome screen, and those buttons carry the checkbox
   * themselves if the user goes on to use one of them. */
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
  // Background scans stay paused while this modal is open -- their
  // UI-thread analysis made its inputs lag (backgroundScanGate.ts).
  useEffect(() => backgroundScanGate.hold(), [])

  const [dontShowAgain, setDontShowAgain] = useState(false)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
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
            <span key={i} style={{ fontSize: 28, lineHeight: 1, color: 'var(--ra-text)' }}>
              {ch}
            </span>
          ))}
        </div>

        {hasRecovery && (
          // A bordered box, not a color accent -- this design system spends
          // color only on audio information (see root CLAUDE.md's Design
          // system section), so "this is a notice" is carried by the border
          // + divider below rather than a warning hue.
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              alignItems: 'center',
              alignSelf: 'stretch',
              padding: '14px 12px',
              border: '1px solid var(--ra-border-strong)'
            }}
          >
            <div style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--ra-text)' }}>
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
          </div>
        )}

        <div style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--ra-text)' }}>
          arrangement tool for endlesss
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

        {/* One shared utility row rather than "take the tour" standing on
            its own line above the checkbox -- the checkbox stays put on
            the left (justify-content:space-between's natural resting spot
            for a lone child too, so this row looks identical whether or
            not the tour link is showing), "take the tour" sits at the
            right. alignSelf:'stretch' overrides the panel's own
            alignItems:'center' so this row actually spans the panel's
            full content width -- without it, a shrink-wrapped row can't
            visually separate its two ends. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            alignSelf: 'stretch'
          }}
        >
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
          {!tourSeen && (
            <button onClick={() => onStartTour(dontShowAgain)} style={linkButtonStyle}>
              take the tour
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
