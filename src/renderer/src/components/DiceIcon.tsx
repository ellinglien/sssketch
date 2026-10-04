// src/renderer/src/components/DiceIcon.tsx
// Hand-drawn dice glyph. It predates @phosphor-icons/react (2026-09-29),
// which is scoped to the six Discover row icons only, so it stays
// hand-drawn. Used by the "similar all" buttons (DiscoverPanel's toolbar and
// RadioStrip's mix group), which pass size={18}; the default of 12 is a
// leftover from the row's old decorative dice.
// Direct request, 2026-09-21: "instead of that loader, have the dice spin
// intermittently" -- a quick full turn, then a rest (discover-dice-spin's
// own 0-35% / 35-100% split), for as long as a roll is in flight.
export function DiceIcon({
  size = 12,
  spinning = false
}: {
  size?: number
  spinning?: boolean
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        animation: spinning ? 'discover-dice-spin 1200ms ease-in-out infinite' : undefined,
        // Direct request, 2026-09-22: "when dice are animated, turn them
        // white to show they are active" -- overrides whatever dim color the
        // surrounding button inherits (stroke/fill use currentColor).
        color: spinning ? 'var(--ra-text)' : undefined
      }}
    >
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      {/* Five pips (a DiceFive face) -- doesn't need to represent any real
          rolled value, it's decorative either way, and five reads clearly
          at this size where six pips would blur together. */}
      <circle cx="5" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="11" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
