# App Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four unmodified default-Electron icon files (`resources/icon.png`,
`build/icon.png`, `build/icon.icns`, `build/icon.ico`) with the two-bar frozen-loader mark
defined in `docs/superpowers/specs/2026-08-04-app-icon-design.md`.

**Architecture:** A single self-contained dev script (`scripts/generate-app-icon.mts`) renders
the icon's exact geometry directly at each target resolution (not by resampling one fixed
bitmap, which would blur the hard rectangle edges), encodes PNG/ICO bytes itself with zero new
npm dependencies (Node's built-in `zlib.deflateSync` handles PNG's compressed data; a small
hand-written CRC32 handles PNG chunk checksums; ICO uses the PNG-embedded format Windows has
supported since Vista, just a header + directory table + concatenated PNG bytes), and shells out
to macOS's own `iconutil` only for the one step that genuinely needs it (assembling a valid
`.icns` container). The three pure functions (geometry, PNG encoding, ICO encoding) are unit
tested; the file-writing/`iconutil` orchestration is verified by actually running the script and
inspecting its output.

**Tech Stack:** TypeScript run directly via Node's `--experimental-strip-types` flag (Node
22.21.1 here supports it; confirmed working during design). Vitest for the pure-function tests.
No new dependencies.

---

### Task 1: Icon geometry renderer

**Files:**
- Create: `scripts/generate-app-icon.mts`
- Create: `scripts/generate-app-icon.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the script's test directory to vitest's include list**

`vitest.config.ts` currently only scans `src/**/*.test.ts` and `native-engine/test/**/*.test.ts`
— this new script lives outside `src/`, so its tests need their own include entry.

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'native-engine/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true
  }
})
```

- [ ] **Step 2: Write the failing test for the geometry renderer**

Create `scripts/generate-app-icon.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderIconRgba } from './generate-app-icon.mts'

function pixelAt(rgba: Buffer, size: number, x: number, y: number): [number, number, number, number] {
  const offset = (y * size + x) * 4
  return [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]]
}

describe('renderIconRgba', () => {
  it('fills the corner with the background color', () => {
    const rgba = renderIconRgba(1024)
    expect(pixelAt(rgba, 1024, 0, 0)).toEqual([0x0a, 0x0a, 0x0a, 0xff])
  })

  it('fills the left bar (low, left half) with the bar color', () => {
    const rgba = renderIconRgba(1024)
    // Left bar spans x 160-512, y 584-632 per the design spec -- sample
    // its center, (336, 608).
    expect(pixelAt(rgba, 1024, 336, 608)).toEqual([0xed, 0xed, 0xed, 0xff])
  })

  it('fills the right bar (high, right half) with the bar color', () => {
    const rgba = renderIconRgba(1024)
    // Right bar spans x 512-864, y 392-440 -- sample its center, (688, 416).
    expect(pixelAt(rgba, 1024, 688, 416)).toEqual([0xed, 0xed, 0xed, 0xff])
  })

  it('leaves the vertical center strip as background, between the two bars', () => {
    const rgba = renderIconRgba(1024)
    // At the canvas's own vertical center (512), neither bar reaches --
    // left bar's closest edge is y=584, right bar's is y=440.
    expect(pixelAt(rgba, 1024, 512, 512)).toEqual([0x0a, 0x0a, 0x0a, 0xff])
  })

  it('scales proportionally at a small size, not by resampling a fixed bitmap', () => {
    const rgba = renderIconRgba(64)
    // Same fractions as the 1024 case, scaled down: left bar's own
    // center is (336/1024)*64 = 21, (608/1024)*64 = 38.
    expect(pixelAt(rgba, 64, 21, 38)).toEqual([0xed, 0xed, 0xed, 0xff])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: FAIL — `scripts/generate-app-icon.mts` doesn't exist yet (`Cannot find module`).

- [ ] **Step 4: Implement the geometry renderer**

Create `scripts/generate-app-icon.mts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-app-icon.mts scripts/generate-app-icon.test.ts vitest.config.ts
git commit -m "Add icon geometry renderer for the app icon generation script"
```

---

### Task 2: PNG encoder

**Files:**
- Modify: `scripts/generate-app-icon.mts`
- Modify: `scripts/generate-app-icon.test.ts`

- [ ] **Step 1: Write the failing tests for the PNG encoder**

Add to `scripts/generate-app-icon.test.ts` (new import plus a new `describe` block):

```ts
import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { renderIconRgba, encodePng } from './generate-app-icon.mts'
```

(replaces the existing `import { renderIconRgba } from './generate-app-icon.mts'` line — same
import, with `encodePng` added, plus the new `inflateSync` import above it)

```ts
describe('encodePng', () => {
  it('starts with the standard PNG signature', () => {
    const rgba = renderIconRgba(4)
    const png = encodePng(4, 4, rgba)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('IHDR declares the correct width, height, bit depth, and color type', () => {
    const rgba = renderIconRgba(4)
    const png = encodePng(4, 4, rgba)
    // IHDR chunk: 4-byte length, 4-byte type "IHDR", then 13 bytes of
    // data, starting right after the 8-byte PNG signature.
    const ihdr = png.subarray(8 + 8, 8 + 8 + 13)
    expect(ihdr.readUInt32BE(0)).toBe(4) // width
    expect(ihdr.readUInt32BE(4)).toBe(4) // height
    expect(ihdr[8]).toBe(8) // bit depth
    expect(ihdr[9]).toBe(6) // color type: RGBA
  })

  it('round-trips: decompressing IDAT recovers the exact original pixel data', () => {
    const rgba = renderIconRgba(8)
    const png = encodePng(8, 8, rgba)
    // IDAT chunk starts right after the 8-byte signature + 25-byte IHDR
    // chunk (4 length + 4 type + 13 data + 4 crc).
    const idatStart = 8 + 25
    const idatLength = png.readUInt32BE(idatStart)
    const idatData = png.subarray(idatStart + 8, idatStart + 8 + idatLength)
    const raw = inflateSync(idatData)
    // Strip each row's filter-type byte (always 0/None) and compare
    // against the original RGBA buffer.
    const rowBytes = 8 * 4
    for (let y = 0; y < 8; y++) {
      const rawRow = raw.subarray(y * (1 + rowBytes) + 1, (y + 1) * (1 + rowBytes))
      const originalRow = rgba.subarray(y * rowBytes, (y + 1) * rowBytes)
      expect(rawRow).toEqual(originalRow)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: FAIL — `encodePng` is not exported from `./generate-app-icon.mts`.

- [ ] **Step 3: Implement the PNG encoder**

Add to `scripts/generate-app-icon.mts`, right after the existing `import` comment header (before
`const CANVAS_BASE = 1024`):

```ts
import { deflateSync } from 'node:zlib'
```

Add at the end of the file, after `renderIconRgba`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-app-icon.mts scripts/generate-app-icon.test.ts
git commit -m "Add PNG encoder to the app icon generation script"
```

---

### Task 3: ICO encoder

**Files:**
- Modify: `scripts/generate-app-icon.mts`
- Modify: `scripts/generate-app-icon.test.ts`

- [ ] **Step 1: Write the failing tests for the ICO encoder**

Add to `scripts/generate-app-icon.test.ts` (extend the existing import, same line as Task 2's
`encodePng` addition):

```ts
import { renderIconRgba, encodePng, encodeIco } from './generate-app-icon.mts'
```

Add a new `describe` block:

```ts
describe('encodeIco', () => {
  it('writes a header declaring the correct icon count', () => {
    const ico = encodeIco([
      { size: 16, png: Buffer.from([1, 2, 3]) },
      { size: 32, png: Buffer.from([4, 5]) }
    ])
    expect(ico.readUInt16LE(0)).toBe(0) // reserved
    expect(ico.readUInt16LE(2)).toBe(1) // type: icon
    expect(ico.readUInt16LE(4)).toBe(2) // count
  })

  it('encodes 256px entries using the special 0-means-256 byte convention', () => {
    const ico = encodeIco([{ size: 256, png: Buffer.from([9, 9]) }])
    const dirEntry = ico.subarray(6, 22)
    expect(dirEntry[0]).toBe(0) // width byte: 0 means 256
    expect(dirEntry[1]).toBe(0) // height byte: 0 means 256
  })

  it('total file length matches header + directory entries + concatenated PNG data', () => {
    const entries = [
      { size: 16, png: Buffer.from([1, 2, 3]) },
      { size: 32, png: Buffer.from([4, 5, 6, 7]) }
    ]
    const ico = encodeIco(entries)
    const expectedLength = 6 + entries.length * 16 + entries.reduce((sum, e) => sum + e.png.length, 0)
    expect(ico.length).toBe(expectedLength)
  })

  it('each directory entry points at the correct offset into the concatenated image data', () => {
    const entries = [
      { size: 16, png: Buffer.from([1, 2, 3]) },
      { size: 32, png: Buffer.from([4, 5, 6, 7]) }
    ]
    const ico = encodeIco(entries)
    const firstOffset = ico.readUInt32LE(6 + 12) // first dir entry's offset field (bytes 12-15 of its 16-byte entry)
    const secondOffset = ico.readUInt32LE(6 + 16 + 12)
    expect(firstOffset).toBe(6 + 2 * 16) // right after header + 2 dir entries
    expect(secondOffset).toBe(firstOffset + entries[0].png.length)
    expect(ico.subarray(firstOffset, firstOffset + 3)).toEqual(Buffer.from([1, 2, 3]))
    expect(ico.subarray(secondOffset, secondOffset + 4)).toEqual(Buffer.from([4, 5, 6, 7]))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: FAIL — `encodeIco` is not exported from `./generate-app-icon.mts`.

- [ ] **Step 3: Implement the ICO encoder**

Add to the end of `scripts/generate-app-icon.mts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-app-icon.mts scripts/generate-app-icon.test.ts
git commit -m "Add ICO encoder to the app icon generation script"
```

---

### Task 4: Wire up file generation and run it for real

**Files:**
- Modify: `scripts/generate-app-icon.mts`

- [ ] **Step 1: Add the main() orchestration function**

Add to the top of `scripts/generate-app-icon.mts`, alongside the existing `import { deflateSync } from 'node:zlib'` line:

```ts
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
```

Add at the end of the file, after `encodeIco`:

```ts
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
  mkdirSync(iconsetDir)
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
  for (const [name, size] of icnsSizes) {
    writeFileSync(resolve(iconsetDir, name), pngAt(size))
  }
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', resolve(repoRoot, 'build/icon.icns')])
  rmSync(iconsetDir, { recursive: true })

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
```

- [ ] **Step 2: Run the tests once more to confirm the new imports/code didn't break anything**

Run: `npx vitest run scripts/generate-app-icon.test.ts`
Expected: PASS (12 tests) — `main()` only runs under the `import.meta.url` guard, which is
false when vitest imports this module, so none of the new file-writing code executes during
the test run.

- [ ] **Step 3: Run the script for real**

Run: `node --experimental-strip-types scripts/generate-app-icon.mts`
Expected output: `Wrote resources/icon.png, build/icon.png, build/icon.icns, build/icon.ico`

- [ ] **Step 4: Verify the generated files look right**

```bash
file build/icon.icns build/icon.ico
sips -g pixelWidth -g pixelHeight resources/icon.png build/icon.png
open resources/icon.png
```

Expected: `build/icon.icns` reports as a Mac OS X icon file; `build/icon.ico` reports as an MS
Windows icon resource with 4 images; both PNGs report 512x512; the opened PNG visibly shows two
white bars (left low, right high, touching in the middle) on a near-black square with hard
corners, matching the approved design at
`docs/superpowers/specs/2026-08-04-app-icon-design.md`.

- [ ] **Step 5: Commit the generated assets and the script's final form**

```bash
git add scripts/generate-app-icon.mts resources/icon.png build/icon.png build/icon.icns build/icon.ico
git commit -m "Generate the new two-bar app icon"
```

---

### Task 5: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`scripts/**` isn't part of either tsconfig's `include`, so this doesn't touch
the new script at all — it's only verifying nothing else in the app broke.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS. `scripts/**` is NOT in `eslint.config.mjs`'s `ignores` list, so the new
`.mts`/`.ts` files ARE linted — fix anything ESLint flags (e.g. unused imports) before
proceeding.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS, including the 12 new tests in `scripts/generate-app-icon.test.ts`.

- [ ] **Step 4: Restart the dev app and confirm the new window icon shows up**

`resources/icon.png` is imported by `src/main/index.ts` (`import icon from
'../../resources/icon.png?asset'`) for the dev-mode `BrowserWindow` icon — a main-process asset,
so per this repo's own convention (see CLAUDE.md) it needs a full quit-and-relaunch of `npm run
dev`, not just a renderer reload, to pick up the new PNG bytes.

```bash
pkill -f "electron-vite dev"
pkill -f "Electron Helper"
npm run dev
```

Expected: the app's dock icon (and any window-manager surface that shows a per-window icon)
shows the new two-bar mark instead of the default Electron atom logo.

- [ ] **Step 5: Note what's NOT verified here**

The packaged app icon (`build/icon.icns`/`.ico`, used by `npm run build:mac` /
`npm run build:win` / `npm run dist:mac`) is not exercised by `npm run dev` at all — only a real
packaged build would show it in Finder/the dock for a built `.app`/`.exe`. That's out of scope
for this plan's own verification (matches this repo's own "prefer npm run dev for iteration;
only use a packaged build when you specifically need to test packaging" convention) — say so
explicitly rather than claiming the packaged icon was visually confirmed.
