// src/shared/qrSvg.ts
import qrcode from 'qrcode-generator'

/** QR encoding comes from `qrcode-generator` (Kazuhiko Arase, MIT, no
 * dependencies of its own, ~52KB as the ESM build Vite bundles into the
 * renderer). Chosen over writing an encoder here: a QR encoder is a
 * specification, not a puzzle, and a wrong one fails silently in the only
 * way that matters (a phone that will not scan it). Chosen over a hosted
 * chart/QR service: the renderer's CSP forbids it, and the phone remote has
 * to work on a laptop with no internet at all.
 *
 * This module is the only thing that touches the library -- everything
 * downstream gets one SVG path string, which is testable and has no DOM,
 * canvas, or React in it. */

/** Four modules of blank margin on every side, as the QR specification
 * requires. Without it, scanners fail against a dark app background. */
export const QR_QUIET_ZONE = 4

export interface QrSvg {
  /** An SVG path in a 1-unit-per-module grid: one square per dark module. */
  path: string
  /** Width and height of the square viewBox, in modules, quiet zone
   * included. */
  size: number
}

/** The QR code for `text`, as a single path plus the viewBox size to draw
 * it in. Error correction level M: the standard middle setting, and the
 * amount of damage tolerance a screen (which is not going to get scuffed)
 * needs. Type number 0 lets the library pick the smallest version the text
 * fits in, so a short LAN URL stays a coarse, easy-to-scan grid. */
export function qrSvg(text: string): QrSvg {
  if (text.length === 0) throw new Error('qrSvg: nothing to encode')
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue
      const x = col + QR_QUIET_ZONE
      const y = row + QR_QUIET_ZONE
      path += `M${x} ${y}h1v1h-1z`
    }
  }
  return { path, size: count + QR_QUIET_ZONE * 2 }
}
