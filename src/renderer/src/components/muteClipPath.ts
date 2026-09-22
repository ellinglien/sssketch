// Mute-region clip-path math, shared by StemWaveformRow (per-stem) and
// CollapsedRifffRow (group-level) — its own module rather than an export from
// either component because a file that exports anything besides a React
// component breaks Fast Refresh (react-refresh/only-export-components).
//
// This file used to be envelope.ts and used to own the drawn volume/fade
// envelope too: a curve built from state.fadeIn/state.fadeOut and the stem's
// own gain, used both as a clip-path on the colour layer and as the visible
// line the fade knee handles sat on. That whole mechanism is gone — a clip's
// level is now drawn in its own automation lane's `volume` curve (see
// docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md section
// 2b, and applyEdgeFade in src/shared/automationEdit.ts for the fades) rather
// than as a shape drawn OUTSIDE the lane. What survives here is only the part
// that was never about the envelope: holing out muted spans.

/** Builds an SVG path `d` for one axis-aligned rectangular hole per muted
 * region (full row height). */
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

/** The clip-path CSS value for a waveform's colour layer: a plain full-size
 * rect with one hole punched through it per muted region -- combined via
 * evenodd, so the overlapping shapes subtract rather than union. A muted span
 * therefore shows the always-visible gray layer underneath instead of colour,
 * which is this app's existing "gray means quieter/off" language rather than a
 * separate hatched-stripe treatment drawn on top.
 *
 * Returns undefined (no clip-path at all) when there's nothing to clip, so a
 * clip with no muted regions renders exactly as it would with no clipping
 * machinery at all. */
export function muteRegionsClipPath(
  width: number,
  height: number,
  muteRegions: { startBar: number; endBar: number }[],
  ppb: number,
  leftPx: number
): string | undefined {
  if (muteRegions.length === 0) return undefined
  const base = `M0,0 L${width},0 L${width},${height} L0,${height} Z`
  return `path(evenodd, "${base} ${muteHolesPath(muteRegions, ppb, leftPx, height)}")`
}
