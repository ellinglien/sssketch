export interface ReOneMarkerModel {
  leftPct: number
  label: '1' | 'new 1'
  labelSide: 'left' | 'right'
  pending: boolean
}

/** Visual model for the exact subdivision that will become the loop's new
 * downbeat. Normalizing keeps legacy/out-of-range offsets on the visible
 * loop, and moves the badge to the left near the right edge so it stays
 * readable without moving the marker itself away from the true boundary. */
export function reOneMarkerModel(
  subdivisionIndex: number,
  totalSubdivisions: number,
  pending: boolean
): ReOneMarkerModel | null {
  if (!Number.isFinite(subdivisionIndex) || !(totalSubdivisions > 0)) return null
  const rounded = Math.round(subdivisionIndex)
  const normalized = ((rounded % totalSubdivisions) + totalSubdivisions) % totalSubdivisions
  const leftPct = (normalized / totalSubdivisions) * 100
  return {
    leftPct,
    label: pending ? 'new 1' : '1',
    labelSide: leftPct > 75 ? 'left' : 'right',
    pending
  }
}
