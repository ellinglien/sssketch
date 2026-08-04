// scripts/generate-app-icon.mts
//
// Generates the app's icon files (resources/icon.png, build/icon.png,
// build/icon.icns, build/icon.ico) from the exact geometry defined in
// docs/superpowers/specs/2026-08-04-app-icon-design.md. Run directly via
// Node's native TypeScript support:
//
//   node --experimental-strip-types scripts/generate-app-icon.mts
//
// A standalone dev tool, not part of the app itself -- lives outside
// src/ and isn't covered by npm run typecheck (see the design plan's own
// note on why: getting this into the existing tsconfig project-reference
// graph would require changes disproportionate to a one-off script).

const CANVAS_BASE = 1024
const BG_COLOR = [0x0a, 0x0a, 0x0a] as const // #0a0a0a, matches --ra-bg-frame
const BAR_COLOR = [0xed, 0xed, 0xed] as const // #ededed, matches --ra-text

// All proportions expressed as fractions of the canvas size so
// renderIconRgba can render any target resolution directly, rather than
// resampling one fixed-size bitmap (which would blur the hard rectangle
// edges at every size other than the master's own). Absolute values are
// the spec's own 1024-canvas numbers (e.g. 160/1024 = the horizontal edge
// padding fraction).
const PADDING_FRAC = 160 / CANVAS_BASE
const BAR_WIDTH_FRAC = 352 / CANVAS_BASE
const BAR_THICKNESS_FRAC = 48 / CANVAS_BASE
const LEFT_BAR_CENTER_Y_FRAC = 608 / CANVAS_BASE
const RIGHT_BAR_CENTER_Y_FRAC = 416 / CANVAS_BASE

/** Renders the icon at `size`x`size` as a raw RGBA pixel buffer
 * (size*size*4 bytes, row-major, no row padding) -- geometry is computed
 * fresh at the target size (not scaled from a fixed bitmap), so edges
 * stay crisp at every resolution from 16px up to 1024px. */
export function renderIconRgba(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const padding = PADDING_FRAC * size
  const barWidth = BAR_WIDTH_FRAC * size
  const halfThickness = (BAR_THICKNESS_FRAC * size) / 2
  const leftCenterY = LEFT_BAR_CENTER_Y_FRAC * size
  const rightCenterY = RIGHT_BAR_CENTER_Y_FRAC * size
  const leftBar = {
    x0: padding,
    x1: padding + barWidth,
    y0: leftCenterY - halfThickness,
    y1: leftCenterY + halfThickness
  }
  const rightBar = {
    x0: size / 2,
    x1: size - padding,
    y0: rightCenterY - halfThickness,
    y1: rightCenterY + halfThickness
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inLeftBar = x >= leftBar.x0 && x < leftBar.x1 && y >= leftBar.y0 && y < leftBar.y1
      const inRightBar = x >= rightBar.x0 && x < rightBar.x1 && y >= rightBar.y0 && y < rightBar.y1
      const color = inLeftBar || inRightBar ? BAR_COLOR : BG_COLOR
      const offset = (y * size + x) * 4
      buf[offset] = color[0]
      buf[offset + 1] = color[1]
      buf[offset + 2] = color[2]
      buf[offset + 3] = 0xff
    }
  }
  return buf
}
