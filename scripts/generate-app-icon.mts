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

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lengthBuf = Buffer.alloc(4)
  lengthBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf])
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Encodes a raw RGBA buffer (as renderIconRgba produces) as a standard
 * 8-bit-depth, color-type-6 (RGBA) PNG file. Every scanline is prefixed
 * with filter-type 0 (None) -- simplest correct encoding, and fine here
 * since flat-color rectangles compress well under deflate regardless of
 * per-row filtering. IDAT's compressed payload is exactly what
 * zlib.deflateSync produces (PNG's own spec requires zlib-wrapped
 * deflate, RFC 1950 -- the same format deflateSync outputs, no extra
 * wrapping needed). */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const rowBytes = width * 4
  const raw = Buffer.alloc(height * (1 + rowBytes))
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + rowBytes)
    raw[rawOffset] = 0 // filter type: None
    rgba.copy(raw, rawOffset + 1, y * rowBytes, (y + 1) * rowBytes)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression method
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace method

  const idat = deflateSync(raw)

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** Encodes a set of already-PNG-encoded images as a single .ico file,
 * using the PNG-compressed ICO format Windows has supported since Vista
 * (each directory entry just points at a normal embedded PNG file,
 * rather than the older raw-BMP-plus-AND-mask format) -- avoids needing
 * a second, different raster encoder for this one file. */
export function encodeIco(entries: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(entries.length, 4)

  const dirEntries: Buffer[] = []
  const imageDatas: Buffer[] = []
  let offset = 6 + entries.length * 16

  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16)
    dir[0] = size >= 256 ? 0 : size // width (0 means 256)
    dir[1] = size >= 256 ? 0 : size // height
    dir[2] = 0 // color count (0 = no palette)
    dir[3] = 0 // reserved
    dir.writeUInt16LE(1, 4) // color planes
    dir.writeUInt16LE(32, 6) // bits per pixel
    dir.writeUInt32LE(png.length, 8) // size of image data
    dir.writeUInt32LE(offset, 12) // offset of image data
    dirEntries.push(dir)
    imageDatas.push(png)
    offset += png.length
  }

  return Buffer.concat([header, ...dirEntries, ...imageDatas])
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function pngAt(size: number): Buffer {
  return encodePng(size, size, renderIconRgba(size))
}

function main(): void {
  // resources/icon.png (dev-mode BrowserWindow icon, see src/main/index.ts)
  // and build/icon.png (electron-builder's linux icon source) -- both
  // 512x512, matching the existing placeholder files' own size.
  const png512 = pngAt(512)
  writeFileSync(resolve(repoRoot, 'resources/icon.png'), png512)
  writeFileSync(resolve(repoRoot, 'build/icon.png'), png512)

  // build/icon.icns (mac icon source), built via the macOS-native
  // iconutil from a temporary .iconset directory -- iconutil is the only
  // reliable way to produce a valid multi-resolution .icns container
  // short of hand-rolling that format too.
  const iconsetDir = resolve(repoRoot, 'build/AppIcon.iconset')
  if (existsSync(iconsetDir)) rmSync(iconsetDir, { recursive: true })
  const icnsSizes: [string, number][] = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ]
  try {
    // Cleanup in the finally below needs to cover this whole block, not
    // just the iconutil call -- a write failing partway through (disk
    // full, permissions) would otherwise leave iconsetDir behind exactly
    // like an iconutil failure would, in the same tracked, non-gitignored
    // build/ directory a later `git add build/` could accidentally stage.
    mkdirSync(iconsetDir)
    for (const [name, size] of icnsSizes) {
      writeFileSync(resolve(iconsetDir, name), pngAt(size))
    }
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', resolve(repoRoot, 'build/icon.icns')])
  } finally {
    if (existsSync(iconsetDir)) rmSync(iconsetDir, { recursive: true })
  }

  // build/icon.ico (windows icon source) -- standard sizes covering
  // taskbar through large Explorer icon views.
  const icoSizes = [16, 32, 48, 256]
  writeFileSync(
    resolve(repoRoot, 'build/icon.ico'),
    encodeIco(icoSizes.map((size) => ({ size, png: pngAt(size) })))
  )

  console.log('Wrote resources/icon.png, build/icon.png, build/icon.icns, build/icon.ico')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
