// Shared plain-function style helpers for the auto-arrange wizard's two
// click-through steps (AutoArrangeRoleStep.tsx, AutoArrangeBuildStep.tsx).
// Pulled out to its own non-component file because react-refresh's
// only-export-components lint rule forbids a component file from also
// exporting a plain function -- same pattern as dragUtils.ts/zoomMath.ts/
// envelope.ts/oneShotResize.ts elsewhere in this directory.

// Mirrors ClusterStemsBrowser.tsx's own buttonStyle 'confirmed' state
// exactly -- bright near-white border/text vs. dim gray, reusing
// ChannelRow.tsx's solo-button visual language rather than a background
// swap (this modal's own panel background already reads too close to a
// background-only "active" indicator, same reasoning documented there).
// No 'suggested' state needed here -- neither auto-arrange step has a
// bus-suggestion concept, just "is this playing right now."
export function playButtonStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 9,
    padding: '3px 8px',
    borderRadius: 0,
    background: active ? 'var(--ra-stretch-on-bg)' : 'transparent',
    border: `1px solid ${active ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: active ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    outline: 'none',
    whiteSpace: 'nowrap'
  }
}
