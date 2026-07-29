// Shared volume/fade envelope math for both StemWaveformRow (per-stem) and
// CollapsedRifffRow (group-level) — pulled into its own module rather than
// exported from StemWaveformRow.tsx because a file that exports anything
// besides a React component breaks Fast Refresh (react-refresh/only-export-
// components).

export const FADE_MAX = 4 // bars — matches the value the (now-removed) Inspector panel used to clamp fades
// A quick flick at the old 1-bar-per-PPB(24px) rate could hit FADE_MAX almost
// by accident, sounding much stronger than intended. 4x slows that down to
// ~96px of drag per bar of fade — deliberately harder to overshoot, closer to
// how gradual the original Inspector nudge-button stepper felt, while still
// keeping the drag gesture itself (not going back to click-only steps).
export const FADE_DRAG_SLOWDOWN = 4
export const TOOLTIP_HEIGHT = 18 // volume tooltip's measured rendered height + small margin
export const TOOLTIP_GAP = 4 // gap between the tooltip and the plateau line it's anchored to

/** Where the envelope curve's two knees (fade-in-ends-here, fade-out-starts-here)
 * sit in the row's own pixel coordinates, clamped so they can never cross past
 * the midpoint even under oversized fade values. The single source of truth
 * for this position — used by `buildEnvelopePath` (the curve itself) AND by
 * the fade-knee drag handles' own on-screen position, so the two can never
 * drift apart the way two independently-maintained copies of this formula
 * could. */
export function envelopeKnees(
  width: number,
  fadeInPx: number,
  fadeOutPx: number
): { fiEnd: number; foStart: number } {
  return {
    fiEnd: Math.min(fadeInPx, width / 2),
    foStart: Math.max(width - fadeOutPx, width / 2)
  }
}

/** Builds the SVG path `d` for the envelope curve itself — an OPEN path from
 * (0,height) through the fade-in ease, the flat plateau, and the fade-out
 * ease, to (width,height). Shared by buildEnvelopePath (which closes it into
 * a fillable region for the clip-path mask below) and the thin stroke line
 * drawn directly on top of the waveform, so the mask and the visible line can
 * never drift apart the way two independently-maintained curves could. */
export function envelopeCurveD(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  const { fiEnd, foStart } = envelopeKnees(width, fadeInPx, fadeOutPx)
  const c1x = fiEnd * 0.35
  const c2x = fiEnd * 0.65
  const c3x = foStart + (width - foStart) * 0.35
  const c4x = foStart + (width - foStart) * 0.65
  return (
    `M0,${height} ` +
    `C${c1x},${height} ${c2x},${plateauY} ${fiEnd},${plateauY} ` +
    `L${foStart},${plateauY} ` +
    `C${c3x},${plateauY} ${c4x},${height} ${width},${height}`
  )
}

/** Builds the SVG path `d` for the "below the envelope" region — the curve
 * above, closed off along the bottom edge. Used as a CSS clip-path on the
 * full-color waveform layer; everything outside this region (above the
 * curve) shows only the always-visible gray layer underneath. */
export function buildEnvelopePath(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  return `${envelopeCurveD(width, height, fadeInPx, fadeOutPx, plateauY)} Z`
}
