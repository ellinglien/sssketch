// src/shared/radioSegmentBar.ts
// Pure math for the radio view's segment bars (design pass 2026-10-04, decision 3): a 0-100
// value drawn as cells, a pointer position turned back into a value, and the keys a bar takes.
// Full resolution is kept: cells light fractionally rather than snapping to multiples of 10.

interface Range {
  min?: number
  max?: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** How lit each of `cells` cells is, 0..1, for `value` in [min, max]: the last lit cell partly. */
export function segmentBarFills(value: number, cells: number, min = 0, max = 100): number[] {
  const span = max - min
  const v = Number.isFinite(value) ? clamp(value, min, max) : min
  const lit = span > 0 ? ((v - min) * cells) / span : 0
  return Array.from({ length: cells }, (_, i) => clamp(lit - i, 0, 1))
}

/** The value under a pointer at `x` px across a bar `width` px wide, on `step`, clamped. */
export function segmentBarValueAt(
  x: number,
  width: number,
  o: Range & { step?: number } = {}
): number {
  const { min = 0, max = 100, step = 1 } = o
  if (!(width > 0) || !Number.isFinite(x)) return min
  const raw = min + (clamp(x, 0, width) / width) * (max - min)
  return clamp(min + Math.round((raw - min) / step) * step, min, max)
}

/** The value a key gives, or null for a key the bar does not take (or that changes nothing). */
export function segmentBarKey(
  value: number,
  key: string,
  shift: boolean,
  o: Range = {}
): number | null {
  const { min = 0, max = 100 } = o
  let next: number
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = value + (shift ? 10 : 1)
      break
    case 'ArrowLeft':
    case 'ArrowDown':
      next = value - (shift ? 10 : 1)
      break
    case 'PageUp':
      next = value + 10
      break
    case 'PageDown':
      next = value - 10
      break
    case 'Home':
      next = min
      break
    case 'End':
      next = max
      break
    default:
      return null
  }
  next = clamp(next, min, max)
  return next === value ? null : next
}
