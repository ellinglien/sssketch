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
 * (0,height) through the fade-in ramp, the flat plateau, and the fade-out
 * ramp, to (width,height). A straight line, not a curve: the real audio
 * fade (native-engine/Source/FadeGain.cpp's buildFadePoints) has always
 * been a plain linear ramp — this used to draw a cosmetic cubic-Bezier
 * S-curve here that never matched what was actually audible. Straight also
 * matches Ableton's own default fade curve (FadeInCurveSkew/
 * FadeInCurveSlope both 0) once volume/fade export writes real fade values
 * (see buildAlsXml.ts's buildStemClips) — the picture, the sound, and the
 * exported clip now all agree.
 * Shared by buildEnvelopePath (which closes it into a fillable region for
 * the clip-path mask below) and the thin stroke line drawn directly on top
 * of the waveform, so the mask and the visible line can never drift apart
 * the way two independently-maintained curves could. */
export function envelopeCurveD(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  const { fiEnd, foStart } = envelopeKnees(width, fadeInPx, fadeOutPx)
  return `M0,${height} L${fiEnd},${plateauY} L${foStart},${plateauY} L${width},${height}`
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

/** Builds an SVG path `d` for one axis-aligned rectangular hole per muted
 * region (full row height). Combined with a base "show color here" shape
 * via clip-path's evenodd fill rule (see combinedClipPath below) so a
 * muted span shows the always-visible gray layer underneath instead of
 * color -- the same "gray means quieter/off" visual language the envelope
 * clip already uses for reduced volume, rather than a separate hatched-
 * stripe treatment drawn on top. */
function muteHolesPath(
  regions: { startBar: number; endBar: number }[],
  ppb: number,
  leftPx: number,
  height: number
): string {
  return regions
    .map((r) => {
      const x0 = r.startBar * ppb - leftPx
      const x1 = r.endBar * ppb - leftPx
      return `M${x0},0 L${x1},0 L${x1},${height} L${x0},${height} Z`
    })
    .join(' ')
}

/** The full clip-path CSS value for a waveform's color layer, combining
 * whatever "show color here" base shape is in effect (the envelope curve
 * while volume-drag mode is engaged, otherwise a plain full-size rect) with
 * muteHolesPath's rectangular holes for any muted regions -- via evenodd, so
 * overlapping shapes subtract rather than union. Returns undefined (no
 * clip-path at all) when there's nothing to clip, matching this codebase's
 * existing behavior of leaving the color layer unclipped/at full height so
 * it doesn't read as dimmed just because volume happens to be below unity. */
export function combinedClipPath(
  width: number,
  height: number,
  envelopeClipActive: boolean,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number,
  muteRegions: { startBar: number; endBar: number }[],
  ppb: number,
  leftPx: number
): string | undefined {
  if (!envelopeClipActive && muteRegions.length === 0) return undefined
  const base = envelopeClipActive
    ? buildEnvelopePath(width, height, fadeInPx, fadeOutPx, plateauY)
    : `M0,0 L${width},0 L${width},${height} L0,${height} Z`
  const holes = muteHolesPath(muteRegions, ppb, leftPx, height)
  return `path(evenodd, "${base}${holes ? ` ${holes}` : ''}")`
}
