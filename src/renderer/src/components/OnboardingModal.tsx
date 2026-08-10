import { useState } from 'react'
import { LoadingLoader } from './LoadingLoader'

/** The "1a — marquee" welcome-modal variant, imported via claude_design MCP
 * from the "Sssketch Welcome.dc.html" design project (claude.ai/design,
 * 2026-08-10) and implemented as coded there: a big four-color loader mark
 * over an eight-letter SSSKETCH wordmark that chases the same eight colors
 * across itself, one hard color-step per letter rather than a gradient
 * blend (see ssrainbow below). Originally an 8-hex rainbow sequence as
 * imported from the design; switched to greyscale per direct feedback --
 * this app's own design system spends color only on things that carry
 * audio information (see CLAUDE.md's Design system section), and a color
 * mark is the first thing anyone sees on launch. Kept as 8 distinct steps
 * (not reused from tokens.css's 4-step --ra-text-N scale) so the chase
 * animation still reads as motion rather than collapsing to 2-3 repeats. */
const PALETTE = [
  '#f2f2f2',
  '#d9d9d9',
  '#c2c2c2',
  '#a8a8a8',
  '#8f8f8f',
  '#757575',
  '#5c5c5c',
  '#444444'
] as const
// The mark's 4 bars, per the design's own "colour the SWAPPING PAIRS" note
// on ra-loader-bounce -- these are PALETTE[0], PALETTE[3], PALETTE[6],
// PALETTE[1] as coded in 1a, not an arbitrary pick.
const MARK_COLORS: [string, string, string, string] = [
  PALETTE[0],
  PALETTE[3],
  PALETTE[6],
  PALETTE[1]
]
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

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row)',
  color: 'var(--ra-text-2)'
}

// A plain text-link affordance, not a bordered button -- the tour trigger
// isn't part of the 1a design's own two-button hero row (marquee only
// ships "start sketching" + "log into endlesss"), so it stays visually
// quieter than either CTA while remaining always-visible per direct
// feedback (see this component's own onStartTour doc comment).
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
 * loreUsername setting) until "don't show this again" is checked. Just
 * the one-line pitch, not a feature explainer -- per direct feedback,
 * anything longer wears thin fast as the first thing you see every time
 * you open the app. */
export function OnboardingModal({
  onDismiss,
  onOpenEndlesss,
  onStartTour
}: {
  /** dontShowAgain reflects the checkbox at the moment of dismissal --
   * App.tsx only persists the opt-out when true, so leaving it unchecked
   * means this shows again next launch. */
  onDismiss: (dontShowAgain: boolean) => void
  /** Dismisses AND opens the Endlesss login/import browser directly --
   * the shortest path from "just opened this" to "have real audio in the
   * timeline" for anyone with an Endlesss account already. */
  onOpenEndlesss: (dontShowAgain: boolean) => void
  /** Dismisses AND starts the guided tour (see TourOverlay.tsx) -- always
   * shown, even for a returning user with existing content (previously
   * hidden then, since the tour imports a demo rifff onto the timeline).
   * App.tsx's own handler confirms first when there's real content to
   * protect, so this component doesn't need to know about that itself. */
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
          boxShadow: 'var(--ra-shadow-popover)',
          padding: '32px 30px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        <LoadingLoader size={110} colors={MARK_COLORS} speedMs={6000} />

        <div style={{ display: 'flex', gap: 1 }}>
          {WORDMARK.map((ch, i) => (
            <span
              key={i}
              style={{
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1,
                animation: 'ss-onboarding-rainbow 12.8s steps(1,end) infinite',
                animationDelay: `${(-i * 1.6).toFixed(1)}s`
              }}
            >
              {ch}
            </span>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.7, color: 'var(--ra-text)' }}>
          a track sketching tool
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          <button onClick={() => onDismiss(dontShowAgain)} style={primaryButtonStyle}>
            start sketching
          </button>
          <button onClick={() => onOpenEndlesss(dontShowAgain)} style={secondaryButtonStyle}>
            log into endlesss
          </button>
        </div>

        <button onClick={() => onStartTour(dontShowAgain)} style={linkButtonStyle}>
          take the tour
        </button>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
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

        {/* Discrete color steps (not a blended gradient) per letter, each
            span 1.6s out of phase with the last -- the same 8-hex sequence
            as the mark's own STEMS subset, chasing left to right. Scoped
            locally, same "component owns its own keyframe" pattern as
            LoadingLoader's own ra-loader-bounce. */}
        <style>{`
          @keyframes ss-onboarding-rainbow {
            0%   { color: ${PALETTE[0]} }
            12%  { color: ${PALETTE[1]} }
            25%  { color: ${PALETTE[2]} }
            37%  { color: ${PALETTE[3]} }
            50%  { color: ${PALETTE[4]} }
            62%  { color: ${PALETTE[5]} }
            75%  { color: ${PALETTE[6]} }
            87%  { color: ${PALETTE[7]} }
            100% { color: ${PALETTE[0]} }
          }
        `}</style>
      </div>
    </div>
  )
}
