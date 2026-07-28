# Rifff Arranger ("bendlesss") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working macOS Electron app that lets Elling drag real Endlesss rifff
export folders into a 32-bar timeline, arrange them as linked stem groups, and fine-tune
sync/tempo/volume per the `docs/superpowers/specs/2026-07-27-rifff-arranger-design.md`
spec and the `design/design_handoff_rifff_arranger/` visual handoff (option 2a).

**Architecture:** Electron main process owns the filesystem (folder scanning, WAV byte
reads, native `rubberband` CLI invocation, project file I/O). React/TypeScript renderer
owns UI, app state (single reducer matching the spec's documented state shape), and Web
Audio playback (per-stem `AudioBufferSourceNode` + `GainNode`, scheduled off a shared
transport clock). Pure logic (filename parsing, WAV duration reading, bar-length math,
dB/offset/position formatting, clip geometry, playback scheduling) lives in
`src/shared/` so it can be unit tested with Vitest independent of Electron/DOM/Web Audio.

**Tech Stack:** Electron, React 18, TypeScript, `electron-vite`, Vitest, native
`rubberband` CLI (Homebrew, macOS arm64), Web Audio API.

---

## Before You Start

The repo already contains (committed in `8204ac5`):
- `docs/superpowers/specs/2026-07-27-rifff-arranger-design.md` — the design this plan implements
- `design/design_handoff_rifff_arranger/` — visual spec: `README.md` (full token tables,
  layout measurements, interaction rules), `tokens.css`, `rifff-visuals.js`,
  `Rifff Arranger.dc.html` (prototype, option 2a is first in document order),
  `stem-peaks.json`, `fonts/`, `screenshots/`
- `fixtures/sample-rifff/` — 6 real WAV stems from one rifff (150 BPM, `elling`),
  correctly named per the import convention, durations of 8/2/1 bars — use this for all
  manual verification

Read `design/design_handoff_rifff_arranger/README.md` in full before Task 7 (UI shell) —
it has the exact pixel/color/spacing values referenced throughout this plan.

`rubberband` is already installed on this machine at `/opt/homebrew/bin/rubberband`
(confirmed via `which rubberband`, version 4.0.0). Task 18 locates it via a small path
search rather than assuming a fixed location, so the app still works if Homebrew's
prefix differs.

**Post-Task-1 correction:** the electron-vite react-ts scaffolder installs React 19
(this plan originally said "React 18" in the Tech Stack line above that header — treat
React 19 as authoritative, confirmed via the actual installed `@types/react` version).
React 19's types no longer expose a bare global `JSX` namespace — `: JSX.Element` return
type annotations fail to compile (`TS2503: Cannot find namespace 'JSX'`). Every component
in this plan is written with `React.JSX.Element` throughout (already corrected) — that
form works without an explicit `import React from 'react'`, since `@types/react`
declares it as an ambient global namespace. If you're implementing a task and see a
stray bare `JSX.Element` anywhere, treat it as a typo and use `React.JSX.Element`.

Task 1's code review also flagged that `eslint.config.mjs`'s default `ignores` list
doesn't exclude `design/` (which contains `rifff-visuals.js`/`support.js` — reference
files, not app source) — fixed as part of Task 1's follow-up. If a later task's
`npm run lint` comes back with hundreds of errors from `design/design_handoff_rifff_arranger/*.js`,
that ignore entry has regressed and should be restored.

---

## Task 1: Scaffold the Electron + React + TypeScript project

**Files:**
- Create: everything under `/Users/nickel/Claudecode/bendlesss/` produced by the scaffold
  (`package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`,
  `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`,
  `tsconfig*.json`)

- [ ] **Step 1: Scaffold into a temp directory**

```bash
cd /Users/nickel/Claudecode
npm create @quick-start/electron@latest bendlesss-scaffold
```

Answer the prompts: framework → `react`, variant → `TypeScript`, "Add Electron updater
plugin?" → `No`, "Enable Electron download mirror proxy?" → `No` (or `Yes` if npm
installs are slow from Newfoundland — doesn't affect the app).

- [ ] **Step 2: Merge the scaffold into the existing repo**

```bash
rm -rf /Users/nickel/Claudecode/bendlesss-scaffold/.git
cp -R /Users/nickel/Claudecode/bendlesss-scaffold/. /Users/nickel/Claudecode/bendlesss/
rm -rf /Users/nickel/Claudecode/bendlesss-scaffold
cd /Users/nickel/Claudecode/bendlesss
npm install
```

- [ ] **Step 3: Verify the dev app launches**

Run: `npm run dev`
Expected: an Electron window opens showing the electron-vite starter template (Vite +
Electron + React logos). Close the window and stop the process (Ctrl+C).

- [ ] **Step 4: Add Vitest**

```bash
npm install -D vitest
```

Add to `package.json` `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 5: Verify Vitest runs with zero tests**

Run: `npm test`
Expected: `No test files found` (not an error) — confirms the runner and config load.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Scaffold Electron + React + TypeScript app with Vitest"
```

---

## Task 2: Wire the shared-code alias and drop the scaffold's demo content

**Files:**
- Modify: `electron.vite.config.ts`
- Modify: `src/renderer/src/App.tsx`
- Delete: `src/renderer/src/assets/*` (scaffold demo images/CSS), `src/renderer/src/components/Versions.tsx` if the template generated one

- [ ] **Step 1: Rewrite `electron.vite.config.ts`**

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
```

- [ ] **Step 2: Add the `@shared` path to each `tsconfig`**

In `tsconfig.web.json` (renderer) and `tsconfig.node.json` (main/preload), add under
`compilerOptions`:

```json
"paths": {
  "@shared/*": ["src/shared/*"]
}
```

- [ ] **Step 3: Delete scaffold demo files**

```bash
rm -rf src/renderer/src/assets src/renderer/src/components
```

- [ ] **Step 4: Replace `src/renderer/src/App.tsx` with a placeholder**

```tsx
export default function App(): React.JSX.Element {
  return <div style={{ color: '#f2f2f4', padding: 20 }}>rifff arranger</div>
}
```

- [ ] **Step 5: Verify it still runs**

Run: `npm run dev`
Expected: window opens showing "rifff arranger" in light text on the default background.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add @shared alias, strip scaffold demo content"
```

---

## Task 3: Design tokens, fonts, and app shell CSS

**Files:**
- Create: `src/renderer/src/styles/tokens.css`
- Create: `src/renderer/src/styles/global.css`
- Create: `src/renderer/src/assets/fonts/AtkinsonHyperlegibleMono-Regular.ttf`
- Create: `src/renderer/src/assets/fonts/AtkinsonHyperlegibleMono-Bold.ttf`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Copy the token file and fonts in verbatim**

```bash
cp "design/design_handoff_rifff_arranger/tokens.css" src/renderer/src/styles/tokens.css
mkdir -p src/renderer/src/assets/fonts
cp design/design_handoff_rifff_arranger/fonts/*.ttf src/renderer/src/assets/fonts/
```

- [ ] **Step 2: Create `src/renderer/src/styles/global.css`**

```css
@font-face {
  font-family: 'Atkinson Hyperlegible Mono';
  src: url('../assets/fonts/AtkinsonHyperlegibleMono-Regular.ttf') format('truetype');
  font-weight: 400;
}
@font-face {
  font-family: 'Atkinson Hyperlegible Mono';
  src: url('../assets/fonts/AtkinsonHyperlegibleMono-Bold.ttf') format('truetype');
  font-weight: 700;
}

* { box-sizing: border-box; }

html, body, #root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--ra-bg-page);
  font-family: var(--ra-font);
  font-size: var(--ra-fs-11);
  color: var(--ra-text);
  -webkit-font-smoothing: antialiased;
}

button {
  font-family: inherit;
  cursor: pointer;
  color: inherit;
}

.ra-frame {
  width: 1300px;
  margin: 32px auto;
  background: var(--ra-bg-frame);
  border: 1px solid var(--ra-border);
  border-radius: var(--ra-r-7);
  overflow: hidden;
}

.ra-eyebrow {
  font-size: var(--ra-fs-10);
  font-weight: var(--ra-fw-semibold);
  text-transform: uppercase;
  letter-spacing: var(--ra-track-eyebrow);
  color: var(--ra-text-3);
}
```

- [ ] **Step 3: Import both stylesheets in `src/renderer/src/main.tsx`**

Add near the top, before the `App` import:

```ts
import './styles/tokens.css'
import './styles/global.css'
```

- [ ] **Step 4: Set the window title in `src/renderer/index.html`**

Change `<title>...</title>` to `<title>rifff arranger</title>`.

- [ ] **Step 5: Verify**

Run: `npm run dev`
Expected: window background is near-black (`#08080a`), "rifff arranger" text renders in
the Atkinson Hyperlegible Mono font (visibly monospace, distinct from system UI font).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add design tokens, fonts, and app shell CSS"
```

---

## Task 4: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write the file**

```ts
export type SoundType =
  | 'drums'
  | 'notes'
  | 'bass'
  | 'extInst'
  | 'sampler'
  | 'fx'
  | 'extFx'
  | 'audioIn'

export const TYPE_ORDER: SoundType[] = [
  'drums',
  'notes',
  'bass',
  'extInst',
  'sampler',
  'fx',
  'extFx',
  'audioIn'
]

export const TYPE_CSS_VAR: Record<SoundType, string> = {
  drums: '--ra-type-drums',
  notes: '--ra-type-notes',
  bass: '--ra-type-bass',
  extInst: '--ra-type-ext-inst',
  sampler: '--ra-type-sampler',
  fx: '--ra-type-fx',
  extFx: '--ra-type-ext-fx',
  audioIn: '--ra-type-audio-in'
}

export interface Stem {
  slot: number
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
}

export interface Rifff {
  groupId: string
  name: string
  bpm: number
  barLength: number
  folderPath: string
  stems: Stem[]
  /** undefined until dragged from the shelf onto the timeline */
  startBar?: number
  /** true if folderPath couldn't be found on project load */
  missing?: boolean
}

export function stemKey(groupId: string, slot: number): string {
  return `${groupId}:${slot}`
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "Add shared domain types"
```

(No test file — this module is type/constant declarations only, nothing to assert
against yet. It'll be exercised by every test in the tasks that follow.)

---

## Task 5: Port `rifff-visuals.js` helpers to TypeScript, with tests

**Files:**
- Create: `src/shared/visuals.ts`
- Test: `src/shared/visuals.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { dbLabel, offsetLabels, positionLabel, linearWave, polarGlyph } from './visuals'

describe('dbLabel', () => {
  it('reads unity gain as 0.0', () => {
    expect(dbLabel(1)).toBe('0.0')
  })
  it('reads silence as -inf', () => {
    expect(dbLabel(0)).toBe('−inf')
  })
  it('reads half gain as roughly -6dB', () => {
    expect(dbLabel(0.5)).toBe('−6.0')
  })
})

describe('offsetLabels', () => {
  it('reports dead on for zero offset', () => {
    const l = offsetLabels(0, 16, 80)
    expect(l.grid).toBe('0')
    expect(l.ms).toBe('dead on')
    expect(l.msPerStep).toBe('187.5 ms/step')
  })
  it('reports positive offset in grid steps and ms', () => {
    const l = offsetLabels(2, 16, 80)
    expect(l.grid).toBe('+2/16')
    expect(l.ms).toBe('+375 ms')
  })
  it('reports negative offset', () => {
    const l = offsetLabels(-1, 16, 80)
    expect(l.grid).toBe('−1/16')
    expect(l.ms).toBe('−188 ms')
  })
})

describe('positionLabel', () => {
  it('formats bar 1 beat 1 sixteenth 1 as 001.1.1', () => {
    expect(positionLabel(0)).toBe('001.1.1')
  })
  it('formats bar 9 as zero-padded', () => {
    expect(positionLabel(8)).toBe('009.1.1')
  })
  it('advances beat and sixteenth within a bar', () => {
    // 1.5 bars = bar 2 (0-indexed 1), beat 3 (0.5 bar = 2 beats in), sixteenth 1
    expect(positionLabel(1.5)).toBe('002.3.1')
  })
})

describe('linearWave', () => {
  it('produces a closed SVG path starting and ending appropriately', () => {
    const path = linearWave([0.5, 1, 0.5, 0.2])
    expect(path.startsWith('M0.0,')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })
})

describe('polarGlyph', () => {
  it('produces a closed SVG path', () => {
    const path = polarGlyph([0.2, 0.8, 0.4, 0.6], 17, 20, 8)
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './visuals'`

- [ ] **Step 3: Write `src/shared/visuals.ts`** (ported from `rifff-visuals.js`, typed)

```ts
const TAU = Math.PI * 2

export function peaksFromChannel(samples: Float32Array, buckets = 128): number[] {
  const out: number[] = []
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor((i * samples.length) / buckets)
    const b = Math.floor(((i + 1) * samples.length) / buckets)
    let m = 0
    for (let j = a; j < b; j += 7) {
      const v = Math.abs(samples[j])
      if (v > m) m = v
    }
    out.push(m)
  }
  return out
}

export function downsample(arr: number[], n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * arr.length) / n)
    const b = Math.floor(((i + 1) * arr.length) / n)
    let sum = 0
    let c = 0
    for (let j = a; j < Math.max(b, a + 1); j++) {
      sum += arr[j] || 0
      c++
    }
    out.push(sum / c)
  }
  return out
}

/** mirrored, normalised waveform filling a 128x100 box */
export function linearWave(peaks: number[]): string {
  const n = peaks.length
  const mx = Math.max.apply(null, peaks) || 1
  let up = ''
  let down = ''
  for (let i = 0; i < n; i++) {
    const h = (peaks[i] / mx) * 45
    const x = ((i * 128) / (n - 1)).toFixed(1)
    up += (i ? 'L' : 'M') + x + ',' + (50 - h).toFixed(1)
    down = 'L' + x + ',' + (50 + h).toFixed(1) + down
  }
  return up + down + 'Z'
}

/** one petal ring in a 100x100 box, centred on 50,50 */
export function polarGlyph(peaks: number[], r0 = 17, amp = 20, points = 16): string {
  const arr = downsample(peaks, points)
  const n = arr.length
  const mx = Math.max.apply(null, arr) || 1
  const pt = (a: number, r: number): string =>
    (50 + Math.cos(a) * r).toFixed(1) + ',' + (50 + Math.sin(a) * r).toFixed(1)
  let d = 'M' + pt(0, r0)
  for (let i = 0; i < n; i++) {
    const aMid = ((i + 0.5) / n) * TAU
    const aNext = ((i + 1) / n) * TAU
    d += 'Q' + pt(aMid, r0 + (arr[i] / mx) * amp) + ' ' + pt(aNext, r0)
  }
  return d + 'Z'
}

export function dbLabel(v: number): string {
  if (v <= 0.001) return '−inf'
  const d = 20 * Math.log10(v)
  return d >= -0.05 ? '0.0' : d.toFixed(1).replace('-', '−')
}

export interface OffsetLabels {
  grid: string
  ms: string
  msPerStep: string
}

/** offset is stored in grid steps; snapDiv is 4 | 8 | 16 | 32 */
export function offsetLabels(steps: number, snapDiv: number, bpm: number): OffsetLabels {
  const msPerStep = ((60 / bpm) * 4 * 1000) / snapDiv
  const ms = steps * msPerStep
  return {
    grid: steps ? (steps > 0 ? '+' : '−') + Math.abs(steps) + '/' + snapDiv : '0',
    ms: ms ? (ms > 0 ? '+' : '−') + Math.abs(ms).toFixed(0) + ' ms' : 'dead on',
    msPerStep: msPerStep.toFixed(1) + ' ms/step'
  }
}

/** bar.beat.16th, 1-indexed, bar zero-padded to 3 */
export function positionLabel(posInBars: number): string {
  const beat = Math.floor((posInBars % 1) * 4) + 1
  const sixteenth = Math.floor((posInBars % 0.25) * 16) + 1
  return String(Math.floor(posInBars) + 1).padStart(3, '0') + '.' + beat + '.' + sixteenth
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, all `visuals.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Port rifff-visuals.js helpers to typed shared module with tests"
```

---

## Task 6: Filename parsing and WAV duration reading, with tests

**Files:**
- Create: `src/shared/parseFilename.ts`
- Test: `src/shared/parseFilename.test.ts`
- Create: `src/shared/wavDuration.ts`
- Test: `src/shared/wavDuration.test.ts`

- [ ] **Step 1: Write the failing filename-parsing test**

```ts
import { describe, expect, it } from 'vitest'
import { parseStemFilename } from './parseFilename'

describe('parseStemFilename', () => {
  it('parses the documented convention', () => {
    const parsed = parseStemFilename(
      '1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav'
    )
    expect(parsed).toEqual({
      slot: 1,
      author: 'elling',
      stemName: 'Highpass',
      bpm: 150,
      timestamp: '2020-11-11-13-53'
    })
  })
  it('parses a stem name that itself contains a hyphen', () => {
    const parsed = parseStemFilename(
      '5 - elling - Endless Smile - 80BPM - 2023-07-26-15-52.wav'
    )
    expect(parsed?.stemName).toBe('Endless Smile')
    expect(parsed?.bpm).toBe(80)
  })
  it('returns null for a non-matching filename', () => {
    expect(parseStemFilename('recording 165 (Bass).wav')).toBeNull()
    expect(parseStemFilename('.DS_Store')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './parseFilename'`

- [ ] **Step 3: Write `src/shared/parseFilename.ts`**

```ts
export interface ParsedStemFilename {
  slot: number
  author: string
  stemName: string
  bpm: number
  timestamp: string
}

const STEM_FILENAME_RE = /^(\d+)\s*-\s*(.+?)\s*-\s*(.+)\s*-\s*(\d+)BPM\s*-\s*(.+?)\.wav$/i

export function parseStemFilename(filename: string): ParsedStemFilename | null {
  const match = STEM_FILENAME_RE.exec(filename)
  if (!match) return null
  return {
    slot: parseInt(match[1], 10),
    author: match[2].trim(),
    stemName: match[3].trim(),
    bpm: parseInt(match[4], 10),
    timestamp: match[5].trim()
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Write the failing WAV-duration test**

```ts
import { describe, expect, it } from 'vitest'
import { readWavDurationSeconds } from './wavDuration'

function buildSyntheticWav(opts: {
  sampleRate: number
  numChannels: number
  bitsPerSample: number
  numFrames: number
}): Uint8Array {
  const { sampleRate, numChannels, bitsPerSample, numFrames } = opts
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataBytes = numFrames * blockAlign
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(buf)
}

describe('readWavDurationSeconds', () => {
  it('computes duration from sample rate, channels, and data size', () => {
    const wav = buildSyntheticWav({
      sampleRate: 48000,
      numChannels: 2,
      bitsPerSample: 16,
      numFrames: 48000 * 4 // 4 seconds
    })
    expect(readWavDurationSeconds(wav)).toBeCloseTo(4, 5)
  })
  it('handles mono 24-bit audio', () => {
    const wav = buildSyntheticWav({
      sampleRate: 44100,
      numChannels: 1,
      bitsPerSample: 24,
      numFrames: 44100 * 2
    })
    expect(readWavDurationSeconds(wav)).toBeCloseTo(2, 5)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './wavDuration'`

- [ ] **Step 7: Write `src/shared/wavDuration.ts`**

```ts
export function readWavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (riff !== 'RIFF') throw new Error('not a RIFF/WAV file')

  let offset = 12 // skip 'RIFF' size 'WAVE'
  let sampleRate = 0
  let numChannels = 0
  let bitsPerSample = 0
  let dataBytes = 0

  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    )
    const chunkSize = view.getUint32(offset + 4, true)
    const bodyOffset = offset + 8
    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(bodyOffset + 2, true)
      sampleRate = view.getUint32(bodyOffset + 4, true)
      bitsPerSample = view.getUint16(bodyOffset + 14, true)
    } else if (chunkId === 'data') {
      dataBytes = chunkSize
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2)
  }

  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8)
  if (!bytesPerSecond) throw new Error('WAV missing a valid fmt chunk')
  return dataBytes / bytesPerSecond
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Verify against the real fixture**

Run a quick one-off check (not a permanent test, just confirms the parser handles real
files, then discard the script):

```bash
node --experimental-strip-types -e "
import { readFileSync } from 'fs'
import { readWavDurationSeconds } from './src/shared/wavDuration.ts'
const bytes = new Uint8Array(readFileSync('fixtures/sample-rifff/1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav'))
console.log(readWavDurationSeconds(bytes))
"
```

Expected: prints approximately `12.8` (matches `afinfo`'s `estimated duration:
12.799979 sec` for that file).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add filename parsing and WAV duration reading with tests"
```

---

## Task 7: Rifff assembly (folder → `Rifff` object), with tests

**Files:**
- Create: `src/shared/buildRifff.ts`
- Test: `src/shared/buildRifff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildRifff, type ScannedFile } from './buildRifff'

function wavBytes(seconds: number, sampleRate = 48000): Uint8Array {
  const numFrames = Math.round(seconds * sampleRate)
  const dataBytes = numFrames * 2 // mono 16-bit
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(buf)
}

describe('buildRifff', () => {
  it('assembles a rifff from real-convention filenames', () => {
    const files: ScannedFile[] = [
      {
        filename: '1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav',
        path: '/x/1 - elling - Highpass - 150BPM - 2020-11-11-13-53.wav',
        bytes: wavBytes(12.8)
      },
      {
        filename: '6 - elling - Freezer - 150BPM - 2020-11-11-13-52.wav',
        path: '/x/6 - elling - Freezer - 150BPM - 2020-11-11-13-52.wav',
        bytes: wavBytes(3.2)
      },
      {
        filename: '8 - elling - Sunset - 150BPM - 2020-11-11-12-38.wav',
        path: '/x/8 - elling - Sunset - 150BPM - 2020-11-11-12-38.wav',
        bytes: wavBytes(1.6)
      },
      { filename: '.DS_Store', path: '/x/.DS_Store', bytes: new Uint8Array(0) }
    ]

    const rifff = buildRifff('/x', 'my jam 150 Stems', files)

    expect(rifff).not.toBeNull()
    expect(rifff?.name).toBe('my jam 150')
    expect(rifff?.bpm).toBe(150)
    expect(rifff?.folderPath).toBe('/x')
    expect(rifff?.stems).toHaveLength(3)
    expect(rifff?.stems.map((s) => s.slot)).toEqual([1, 6, 8])
    expect(rifff?.stems[0].barLength).toBe(8)
    expect(rifff?.stems[1].barLength).toBe(2)
    expect(rifff?.stems[2].barLength).toBe(1)
    expect(rifff?.barLength).toBe(8) // max of the stems
    expect(rifff?.stems.every((s) => s.type === 'fx')).toBe(true)
  })

  it('returns null when no files match the convention', () => {
    const files: ScannedFile[] = [
      { filename: 'recording 165 (Bass).wav', path: '/y/a.wav', bytes: new Uint8Array(0) }
    ]
    expect(buildRifff('/y', 'unrelated folder', files)).toBeNull()
  })

  it('does not strip "Stems" from the middle of a name', () => {
    const files: ScannedFile[] = [
      {
        filename: '1 - elling - Tail - 80BPM - 2020-01-01-00-00.wav',
        path: '/z/1.wav',
        bytes: wavBytes(1.6)
      }
    ]
    const rifff = buildRifff('/z', 'Stems of Consciousness', files)
    expect(rifff?.name).toBe('Stems of Consciousness')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './buildRifff'`

- [ ] **Step 3: Write `src/shared/buildRifff.ts`**

```ts
import { parseStemFilename } from './parseFilename'
import { readWavDurationSeconds } from './wavDuration'
import type { Rifff, Stem } from './types'

export interface ScannedFile {
  filename: string
  path: string
  bytes: Uint8Array
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>()
  let best = nums[0]
  let bestCount = 0
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1
    counts.set(n, c)
    if (c > bestCount) {
      bestCount = c
      best = n
    }
  }
  return best
}

function barsForDuration(durationSec: number, bpm: number): number {
  const secPerBar = (60 / bpm) * 4
  return Math.max(1, Math.round(durationSec / secPerBar))
}

function stripTrailingStemsSuffix(folderName: string): string {
  return folderName.replace(/\s+Stems$/, '')
}

export function buildRifff(
  folderPath: string,
  folderName: string,
  files: ScannedFile[]
): Rifff | null {
  const stems: Stem[] = []
  const bpms: number[] = []

  for (const file of files) {
    const parsed = parseStemFilename(file.filename)
    if (!parsed) continue
    const durationSec = readWavDurationSeconds(file.bytes)
    bpms.push(parsed.bpm)
    stems.push({
      slot: parsed.slot,
      author: parsed.author,
      name: parsed.stemName,
      type: 'fx',
      path: file.path,
      durationSec,
      barLength: barsForDuration(durationSec, parsed.bpm)
    })
  }

  if (stems.length === 0) return null

  stems.sort((a, b) => a.slot - b.slot)

  return {
    groupId: crypto.randomUUID(),
    name: stripTrailingStemsSuffix(folderName),
    bpm: mode(bpms),
    barLength: Math.max(...stems.map((s) => s.barLength)),
    folderPath,
    stems
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, all `buildRifff.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add rifff assembly from scanned stem files, with tests"
```

---

## Task 8: App state store (reducer + selectors), with tests

**Files:**
- Create: `src/renderer/src/state/store.ts`
- Create: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/store.test.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Write the failing reducer tests**

```ts
import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import type { Rifff } from '@shared/types'

function makeRifff(overrides: Partial<Rifff> = {}): Rifff {
  return {
    groupId: 'r1',
    name: 'test rifff',
    bpm: 150,
    barLength: 8,
    folderPath: '/x',
    stems: [
      { slot: 1, author: 'elling', name: 'Highpass', type: 'fx', path: '/x/1.wav', durationSec: 12.8, barLength: 8 },
      { slot: 6, author: 'elling', name: 'Freezer', type: 'fx', path: '/x/6.wav', durationSec: 3.2, barLength: 2 }
    ],
    ...overrides
  }
}

describe('reducer', () => {
  it('adds a rifff to the shelf without placing it on the timeline', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    expect(state.rifffs.r1).toBeDefined()
    expect(state.rifffs.r1.startBar).toBeUndefined()
  })

  it('placing on the timeline sets startBar, selects, expands, and enables stretch', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(state.rifffs.r1.startBar).toBe(4)
    expect(state.sel).toBe('r1')
    expect(state.exp.r1).toBe(true)
    expect(state.stretch.r1).toBe(true)
  })

  it('clamps tempo to 40..200', () => {
    expect(reducer(initialState, { type: 'SET_TEMPO', bpm: 500 }).bpm).toBe(200)
    expect(reducer(initialState, { type: 'SET_TEMPO', bpm: 1 }).bpm).toBe(40)
    expect(reducer(initialState, { type: 'SET_TEMPO', bpm: 120 }).bpm).toBe(120)
  })

  it('cycles snap index through 0..3 and wraps', () => {
    let state = initialState // snapIdx starts at 2
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(3)
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(0) // wraps past the end of the array
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(1)
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(2) // back to start, full cycle confirmed
  })

  it('clamps nudged offset to -8..8', () => {
    let state = initialState
    for (let i = 0; i < 20; i++) {
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 1 })
    }
    expect(state.off.r1).toBe(8)
    for (let i = 0; i < 20; i++) {
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: -1 })
    }
    expect(state.off.r1).toBe(-8)
  })

  it('unlink copies the group offset onto each stem key and flags unlinked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 3 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(state.unlinked.r1).toBe(true)
    expect(state.off['r1:1']).toBe(3)
    expect(state.off['r1:6']).toBe(3)
  })

  it('relink clears the unlinked flag', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'RELINK', groupId: 'r1' })
    expect(state.unlinked.r1).toBe(false)
  })

  it('cycles a stem sound-type through all 8 types and back to the start', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    for (let i = 0; i < 8; i++) {
      state = reducer(state, { type: 'CYCLE_TYPE', groupId: 'r1', slot: 1 })
    }
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.type).toBe('fx')
  })

  it('stop resets position and pauses', () => {
    let state = reducer(initialState, { type: 'PLAY' })
    state = reducer(state, { type: 'SET_POS', pos: 12.5 })
    state = reducer(state, { type: 'STOP' })
    expect(state.playing).toBe(false)
    expect(state.pos).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './store'`

- [ ] **Step 3: Write `src/renderer/src/state/store.ts`**

```ts
import { TYPE_ORDER, stemKey, type Rifff } from '@shared/types'

export const SNAP_DIVS = [4, 8, 16, 32] as const

export interface AppState {
  playing: boolean
  pos: number
  bpm: number
  snapIdx: 0 | 1 | 2 | 3
  vol: Record<string, number>
  mute: Record<string, boolean>
  off: Record<string, number>
  stretch: Record<string, boolean>
  unlinked: Record<string, boolean>
  sel: string | null
  exp: Record<string, boolean>
  rifffs: Record<string, Rifff>
}

export const initialState: AppState = {
  playing: false,
  pos: 0,
  bpm: 80,
  snapIdx: 2,
  vol: {},
  mute: {},
  off: {},
  stretch: {},
  unlinked: {},
  sel: null,
  exp: {},
  rifffs: {}
}

export type Action =
  | { type: 'ADD_TO_SHELF'; rifff: Rifff }
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'SELECT'; groupId: string }
  | { type: 'TOGGLE_EXPAND'; groupId: string }
  | { type: 'SET_TEMPO'; bpm: number }
  | { type: 'CYCLE_SNAP' }
  | { type: 'NUDGE_OFFSET'; key: string; delta: number }
  | { type: 'ZERO_OFFSET'; key: string }
  | { type: 'SET_VOLUME'; stemKey: string; volume: number }
  | { type: 'TOGGLE_MUTE'; stemKey: string }
  | { type: 'TOGGLE_STRETCH'; groupId: string }
  | { type: 'UNLINK'; groupId: string }
  | { type: 'RELINK'; groupId: string }
  | { type: 'CYCLE_TYPE'; groupId: string; slot: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SET_POS'; pos: number }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_TO_SHELF':
      return { ...state, rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff } }

    case 'PLACE_ON_TIMELINE':
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...state.rifffs[action.groupId], startBar: action.startBar }
        },
        sel: action.groupId,
        exp: { ...state.exp, [action.groupId]: true },
        stretch: { ...state.stretch, [action.groupId]: true }
      }

    case 'SELECT':
      return { ...state, sel: action.groupId }

    case 'TOGGLE_EXPAND':
      return { ...state, exp: { ...state.exp, [action.groupId]: !state.exp[action.groupId] } }

    case 'SET_TEMPO':
      return { ...state, bpm: Math.min(200, Math.max(40, action.bpm)) }

    case 'CYCLE_SNAP':
      return { ...state, snapIdx: ((state.snapIdx + 1) % 4) as AppState['snapIdx'] }

    case 'NUDGE_OFFSET': {
      const current = state.off[action.key] ?? 0
      const next = Math.min(8, Math.max(-8, current + action.delta))
      return { ...state, off: { ...state.off, [action.key]: next } }
    }

    case 'ZERO_OFFSET':
      return { ...state, off: { ...state.off, [action.key]: 0 } }

    case 'SET_VOLUME':
      return { ...state, vol: { ...state.vol, [action.stemKey]: action.volume } }

    case 'TOGGLE_MUTE':
      return { ...state, mute: { ...state.mute, [action.stemKey]: !state.mute[action.stemKey] } }

    case 'TOGGLE_STRETCH':
      return { ...state, stretch: { ...state.stretch, [action.groupId]: !state.stretch[action.groupId] } }

    case 'UNLINK': {
      const rifff = state.rifffs[action.groupId]
      const groupOffset = state.off[action.groupId] ?? 0
      const off = { ...state.off }
      for (const stem of rifff.stems) {
        off[stemKey(action.groupId, stem.slot)] = groupOffset
      }
      return { ...state, unlinked: { ...state.unlinked, [action.groupId]: true }, off }
    }

    case 'RELINK':
      return { ...state, unlinked: { ...state.unlinked, [action.groupId]: false } }

    case 'CYCLE_TYPE': {
      const rifff = state.rifffs[action.groupId]
      const stems = rifff.stems.map((s) =>
        s.slot === action.slot
          ? { ...s, type: TYPE_ORDER[(TYPE_ORDER.indexOf(s.type) + 1) % TYPE_ORDER.length] }
          : s
      )
      return { ...state, rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, stems } } }
    }

    case 'PLAY':
      return { ...state, playing: true }

    case 'PAUSE':
      return { ...state, playing: false }

    case 'STOP':
      return { ...state, playing: false, pos: 0 }

    case 'SET_POS':
      return { ...state, pos: action.pos }

    default:
      return state
  }
}
```

- [ ] **Step 4: Run to verify the reducer tests pass**

Run: `npm test`
Expected: PASS, all `store.test.ts` cases green.

- [ ] **Step 5: Write the failing selector tests**

```ts
import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import { resolveOffsetKey, clipGeometry, stretchRatio } from './selectors'
import type { Rifff } from '@shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }
  ]
}

describe('resolveOffsetKey', () => {
  it('returns the groupId when linked', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    expect(resolveOffsetKey(state, 'r1', 1)).toBe('r1')
  })
  it('returns the stem key when unlinked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(resolveOffsetKey(state, 'r1', 1)).toBe('r1:1')
  })
})

describe('stretchRatio', () => {
  it('is projectBpm / rifffBpm', () => {
    const state = { ...reducer(initialState, { type: 'ADD_TO_SHELF', rifff }), bpm: 75 }
    expect(stretchRatio(state, 'r1')).toBeCloseTo(0.5, 10)
  })
})

describe('clipGeometry', () => {
  it('positions a clip at startBar * ppb with no offset, full width when stretched', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const geo = clipGeometry(state, 'r1', 24)
    expect(geo.leftPx).toBe(96) // 4 * 24
    expect(geo.widthPx).toBe(192) // 8 bars * 24, stretched to project length
  })

  it('shrinks/grows width when stretch is off, following native bar length', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = { ...state, bpm: 75, stretch: { ...state.stretch, r1: false } }
    const geo = clipGeometry(state, 'r1', 24)
    // native length drifts: barLength * (rifffBpm / projectBpm) = 8 * (150/75) = 16 bars
    expect(geo.widthPx).toBe(384)
  })

  it('shifts left by the grid-step offset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 4 }) // +4/16 steps
    const geo = clipGeometry(state, 'r1', 24)
    // offsetPx = steps * ppb / snapDiv = 4 * 24 / 16 = 6
    expect(geo.leftPx).toBe(6)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './selectors'`

- [ ] **Step 7: Write `src/renderer/src/state/selectors.ts`**

```ts
import { stemKey } from '@shared/types'
import { SNAP_DIVS, type AppState } from './store'

export function resolveOffsetKey(state: AppState, groupId: string, slot: number): string {
  return state.unlinked[groupId] ? stemKey(groupId, slot) : groupId
}

export function stretchRatio(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.bpm / rifff.bpm
}

export interface ClipGeometry {
  leftPx: number
  widthPx: number
}

export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? rifff.barLength : rifff.barLength * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test`
Expected: PASS, all `selectors.test.ts` cases green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add app state reducer and geometry/offset selectors, with tests"
```

---

## Task 9: Static UI shell (Titlebar, Transport, Ruler, empty Shelf/Body/Inspector)

**Files:**
- Create: `src/renderer/src/state/StoreContext.tsx`
- Create: `src/renderer/src/components/Titlebar.tsx`
- Create: `src/renderer/src/components/TransportBar.tsx`
- Create: `src/renderer/src/components/Ruler.tsx`
- Create: `src/renderer/src/components/Shelf.tsx`
- Create: `src/renderer/src/components/Inspector.tsx`
- Modify: `src/renderer/src/App.tsx`

Values below are taken directly from `design/design_handoff_rifff_arranger/README.md`
("Screens / Views → 2a") and `tokens.css`.

- [ ] **Step 1: Create the store context**

```tsx
// src/renderer/src/state/StoreContext.tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import { initialState, reducer, type Action, type AppState } from './store'

const StateCtx = createContext<AppState>(initialState)
const DispatchCtx = createContext<Dispatch<Action>>(() => {})

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

export function useAppState(): AppState {
  return useContext(StateCtx)
}

export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchCtx)
}
```

- [ ] **Step 2: `Titlebar.tsx`**

```tsx
export function Titlebar({
  rifffCount,
  stemCount
}: {
  rifffCount: number
  stemCount: number
}): React.JSX.Element {
  return (
    <div
      style={{
        height: 38,
        padding: '0 14px',
        borderBottom: '1px solid var(--ra-border-soft)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>rifff arranger</span>
        <span style={{ color: '#33333a' }}>|</span>
        <span style={{ color: 'var(--ra-text-2)' }}>untitled sketch 04</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
        {rifffCount} rifffs · {stemCount} stems imported
      </div>
    </div>
  )
}
```

Note: this deviates from the visual handoff's literal copy ("N rifffs referenced · 0
files copied"), which described reference-only import. Per the design doc's revision
note, import now copies files into a managed library, so that exact phrasing would be
false — this is the smallest wording change that keeps the same layout/position/styling.

- [ ] **Step 3: `TransportBar.tsx`**

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import { positionLabel } from '@shared/visuals'
import { SNAP_DIVS } from '../state/store'

export function TransportBar(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()

  return (
    <div
      style={{
        height: 46,
        background: 'var(--ra-bg-bar)',
        borderBottom: '1px solid var(--ra-border)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }}
    >
      <button
        onClick={() => dispatch({ type: state.playing ? 'PAUSE' : 'PLAY' })}
        style={{
          width: 36,
          height: 26,
          borderRadius: 6,
          border: '1px solid var(--ra-border-strong)',
          background: state.playing ? 'var(--ra-play-on)' : 'var(--ra-bg-row-active)',
          color: state.playing ? 'var(--ra-play-on-ink)' : 'var(--ra-text)'
        }}
      >
        {state.playing ? '❙❙' : '▶'}
      </button>
      <button
        onClick={() => dispatch({ type: 'STOP' })}
        style={{
          width: 28,
          height: 26,
          borderRadius: 6,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text-2)'
        }}
      >
        ■
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{positionLabel(state.pos)}</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>0:00.0</span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 26,
          borderLeft: '1px solid var(--ra-border)',
          borderRight: '1px solid var(--ra-border)',
          padding: '0 10px'
        }}
      >
        <span className="ra-eyebrow">tempo</span>
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm - 1 })}
          style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid var(--ra-border)' }}
        >
          −
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, width: 26, textAlign: 'center' }}>
          {state.bpm}
        </span>
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm + 1 })}
          style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid var(--ra-border)' }}
        >
          +
        </button>
      </div>

      <button
        onClick={() => dispatch({ type: 'CYCLE_SNAP' })}
        style={{
          height: 22,
          borderRadius: 6,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text-2)',
          fontSize: 10,
          padding: '0 8px'
        }}
      >
        snap 1/{SNAP_DIVS[state.snapIdx]}
      </button>

      <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ra-text-3)' }}>
        chevron opens stems · block selects
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `Ruler.tsx`**

```tsx
const PPB = 24
const BARS = 32
const LANE_HEADER_WIDTH = 212

export function Ruler(): React.JSX.Element {
  const bars = Array.from({ length: BARS }, (_, i) => i + 1)
  return (
    <div
      style={{
        height: 24,
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)',
        display: 'flex'
      }}
    >
      <div style={{ width: LANE_HEADER_WIDTH, flexShrink: 0 }} />
      <div style={{ position: 'relative', width: BARS * PPB }}>
        {bars.map((bar) => (
          <div
            key={bar}
            style={{
              position: 'absolute',
              left: (bar - 1) * PPB,
              top: 0,
              bottom: 0,
              borderLeft: `1px solid ${(bar - 1) % 4 === 0 ? 'var(--ra-border)' : 'var(--ra-grid-minor)'}`
            }}
          >
            {(bar - 1) % 8 === 0 && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', paddingLeft: 3 }}>{bar}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export { PPB, BARS, LANE_HEADER_WIDTH }
```

- [ ] **Step 5: `Shelf.tsx`** (empty-state only for this task — drop handling comes in Task 10)

```tsx
export function Shelf(): React.JSX.Element {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="ra-eyebrow">shelf</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-4)' }}>
          drag one down into the arrangement · stems land linked and pre-aligned
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div
          style={{
            flex: 1,
            minWidth: 150,
            height: 78,
            border: '1px dashed var(--ra-border-strong)',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: 'var(--ra-text-3)',
            textAlign: 'center'
          }}
        >
          <div>drop rifff folders, or stems straight from endlesss</div>
          <div>copied into your rifff library</div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: `Inspector.tsx`** (empty-state only for this task)

```tsx
export function Inspector(): React.JSX.Element {
  return (
    <div
      style={{
        width: 308,
        flexShrink: 0,
        background: 'var(--ra-bg-bar)',
        borderLeft: '1px solid var(--ra-border)'
      }}
    >
      <div style={{ padding: '12px 14px' }}>
        <span className="ra-eyebrow">inspector</span>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>
          select a rifff block to inspect it
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Wire it all together in `App.tsx`**

```tsx
import { StoreProvider, useAppState } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'

function Frame(): React.JSX.Element {
  const state = useAppState()
  return (
    <div className="ra-frame">
      <Titlebar
        rifffCount={Object.keys(state.rifffs).length}
        stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
      />
      <Shelf />
      <TransportBar />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <Ruler />
          {/* rifff block rows land here in Task 11 */}
        </div>
        <Inspector />
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  )
}
```

- [ ] **Step 8: Verify visually**

Run: `npm run dev`
Expected: window shows the titlebar ("rifff arranger | untitled sketch 04", "0 rifffs ·
0 stems imported"), shelf with the dashed drop target, transport bar with
play/stop/position/tempo/snap controls, a 32-bar ruler with tick marks every bar and
numbers every 8, and an empty inspector on the right. Clicking play toggles the button
to the teal "playing" state and back (no audio yet). Tempo ± changes the readout and
clamps at 40/200. Compare side-by-side against
`design/design_handoff_rifff_arranger/screenshots/2a-shelf-blocks-inspector.png` for
color/spacing sanity — it won't match exactly yet (no rifffs loaded), but the chrome
should look right.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add static UI shell: titlebar, transport, ruler, empty shelf/inspector"
```

---

## Task 10: Main-process import (folder or loose files), copy into library, Shelf drop

**Files:**
- Create: `src/main/importRifff.ts`
- Create: `src/preload/index.ts` (modify scaffold-generated file)
- Create: `src/preload/index.d.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/components/Shelf.tsx`

Per the design doc's revision note: import now **copies** matching WAVs into
`~/Music/Rifff Arranger Library/{rifff-id}/` rather than referencing them in place. Two
drop shapes are handled identically from here on: a single dropped **folder** (scanned
one level deep), or **one-or-more loose files** dropped together (e.g. dragged directly
out of the Endlesss app's own UI, which hands the OS a flat file list, not a folder) —
both produce one rifff per drop event.

- [ ] **Step 1: Write `src/main/importRifff.ts`**

```ts
import {
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  mkdirSync,
  copyFileSync
} from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import { buildRifff, type ScannedFile } from '@shared/buildRifff'
import type { Rifff } from '@shared/types'

/**
 * Reads just enough of each candidate WAV's header (fmt + data chunk metadata)
 * to compute duration, without loading the whole file into memory.
 */
function readWavHeaderBytes(path: string): Uint8Array {
  const size = statSync(path).size
  const headerSize = Math.min(size, 4096) // fmt/data chunks land well within this
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(headerSize)
    readSync(fd, buf, 0, headerSize, 0)
    return new Uint8Array(buf)
  } finally {
    closeSync(fd)
  }
}

function libraryRoot(): string {
  return join(homedir(), 'Music', 'Rifff Arranger Library')
}

/**
 * Accepts the paths handed over by a single drop event: either one folder path
 * (scanned one level deep for .wav files) or one-or-more loose file paths. Every
 * matching .wav is copied into the managed library, grouped into one rifff.
 */
export function importRifff(droppedPaths: string[]): Rifff | null {
  let candidateWavPaths: string[]
  let displayName: string
  let provenancePath: string

  if (droppedPaths.length === 1 && statSync(droppedPaths[0]).isDirectory()) {
    const folderPath = droppedPaths[0]
    const entries = readdirSync(folderPath, { withFileTypes: true })
    candidateWavPaths = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.wav'))
      .map((e) => join(folderPath, e.name))
    displayName = basename(folderPath)
    provenancePath = folderPath
  } else {
    candidateWavPaths = droppedPaths.filter((p) => p.toLowerCase().endsWith('.wav'))
    displayName = 'untitled rifff'
    provenancePath = dirname(droppedPaths[0])
  }

  if (candidateWavPaths.length === 0) return null

  const scanned: ScannedFile[] = candidateWavPaths.map((path) => ({
    filename: basename(path),
    path,
    bytes: readWavHeaderBytes(path)
  }))

  const rifff = buildRifff(provenancePath, displayName, scanned)
  if (!rifff) return null

  const destDir = join(libraryRoot(), rifff.groupId)
  mkdirSync(destDir, { recursive: true })

  const copiedStems = rifff.stems.map((stem) => {
    const destPath = join(destDir, basename(stem.path))
    copyFileSync(stem.path, destPath)
    return { ...stem, path: destPath }
  })

  return { ...rifff, stems: copiedStems }
}
```

- [ ] **Step 2: Expose it over IPC in `src/main/index.ts`**

Find the scaffold's `app.whenReady().then(() => { ... })` block and add, alongside the
existing `ipcMain.on('ping', ...)` handler (remove that demo handler):

```ts
import { ipcMain, dialog } from 'electron'
import { importRifff } from './importRifff'

// inside app.whenReady().then(() => { ... }), before createWindow():
ipcMain.handle('import-rifff', (_event, paths: string[]) => {
  return importRifff(paths)
})

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
```

- [ ] **Step 3: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Rifff } from '@shared/types'

const api = {
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder')
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
```

- [ ] **Step 4: Write `src/preload/index.d.ts`**

```ts
import type { RifffApi } from './index'

declare global {
  interface Window {
    rifffApi: RifffApi
  }
}
```

- [ ] **Step 5: Wire the drop target in `Shelf.tsx`**

Replace the file with a version that renders shelf cards from state and handles both
drop sources: a Finder folder drop, and (stubbed for now, built out in Task 11) a
drag-out to the timeline. All paths from one drop event are collected and sent in a
single `importRifff` call, so a multi-file drag (e.g. straight out of Endlesss) is
grouped into one rifff rather than one-per-file.

```tsx
import { useState, type DragEvent } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'

export function Shelf(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    // Electron's File objects carry a real filesystem path.
    const paths = Array.from(e.dataTransfer.files).map((f) => (f as File & { path: string }).path)
    if (paths.length === 0) return
    const rifff = await window.rifffApi.importRifff(paths)
    if (rifff) dispatch({ type: 'ADD_TO_SHELF', rifff })
  }

  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="ra-eyebrow">shelf</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-4)' }}>
          drag one down into the arrangement · stems land linked and pre-aligned
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {Object.values(state.rifffs).map((rifff) => (
          <div
            key={rifff.groupId}
            style={{
              width: 212,
              borderRadius: 8,
              padding: '9px 10px',
              background: 'var(--ra-bg-frame)',
              border: '1px solid var(--ra-border)'
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700 }}>{rifff.name}</div>
            <div style={{ fontSize: 9, color: 'var(--ra-text-2)' }}>
              {rifff.bpm} BPM · {rifff.stems.length} stems · {rifff.barLength} bars
            </div>
          </div>
        ))}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            flex: 1,
            minWidth: 150,
            height: 78,
            border: `1px dashed ${dragOver ? 'var(--ra-text-2)' : 'var(--ra-border-strong)'}`,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: 'var(--ra-text-3)',
            textAlign: 'center'
          }}
        >
          <div>drop rifff folders, or stems straight from endlesss</div>
          <div>copied into your rifff library</div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify with the real fixture**

Run: `npm run dev`. First, in Finder, select the `fixtures/sample-rifff` folder itself
(not the files inside it) and drag it onto the dashed drop target.
Expected: a shelf card appears reading `sample-rifff` · `150 BPM · 6 stems · 8 bars`, and
the titlebar's count updates to `1 rifffs · 6 stems imported`. Then check
`~/Music/Rifff Arranger Library/` in Finder — a new folder (named after the rifff's
`groupId`) should contain copies of all 6 WAVs.

Second, test the loose-file path: open `fixtures/sample-rifff` in Finder, select all 6
`.wav` files individually (not the folder), drag that multi-file selection onto the drop
target. Expected: a second shelf card appears (name `untitled rifff`, since there's no
folder name to derive one from), also with 6 stems, and a second folder appears under
`~/Music/Rifff Arranger Library/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add import IPC (folder or loose files) copying stems into a managed library"
```

---

## Task 11: Shelf card → timeline drag placement, and real `RifffBlockRow`/`StemSubRow`

**Files:**
- Modify: `src/renderer/src/components/Shelf.tsx`
- Create: `src/renderer/src/theme/typeColor.ts`
- Create: `src/renderer/src/components/RifffBlockRow.tsx`
- Create: `src/renderer/src/components/StemSubRow.tsx`
- Modify: `src/renderer/src/App.tsx`

This uses flat placeholder polar glyphs (a plain colored circle) and flat waveform fills
— Task 12 swaps in the real peak-driven SVGs from `visuals.ts` once audio decoding
exists. Layout/geometry is real starting now.

- [ ] **Step 1: Make shelf cards draggable in `Shelf.tsx`**

Add `draggable` and an `onDragStart` handler to the shelf-card `div` from Task 10:

```tsx
<div
  key={rifff.groupId}
  draggable
  onDragStart={(e) => {
    e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
  }}
  style={{ /* unchanged */ }}
>
```

- [ ] **Step 2: Write a shared `typeColorVar` helper, then `RifffBlockRow.tsx`**

`RifffBlockRow` and `StemSubRow` both need a sound-type's color as a CSS value. Rather
than a second, hand-maintained hex table duplicating the `--ra-type-*` custom properties
already defined in `tokens.css` (Task 3) and already mapped by `TYPE_CSS_VAR` in
`src/shared/types.ts` (Task 4) — which would drift silently if one copy were edited and
not the other — both components pull from one shared helper. This also avoids a
circular import between the two components (`StemSubRow` importing color data back out
of `RifffBlockRow`, which imports `StemSubRow` to render it).

Create `src/renderer/src/theme/typeColor.ts`:

```ts
import { TYPE_CSS_VAR, type SoundType } from '@shared/types'

/**
 * A CSS `var(...)` reference for a sound type's color, sourced from the single
 * design-token definition in tokens.css (via TYPE_CSS_VAR) rather than a second,
 * hand-maintained hex table — avoids two color sources drifting out of sync.
 * Works anywhere a CSS color is valid, including inside color-mix().
 */
export function typeColorVar(type: SoundType): string {
  return `var(${TYPE_CSS_VAR[type]})`
}
```

Then `RifffBlockRow.tsx`:

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import { clipGeometry } from '../state/selectors'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemSubRow } from './StemSubRow'

const PPB = 24

function identityColor(rifff: Rifff): string {
  return typeColorVar(rifff.stems[0]?.type ?? 'fx')
}

export function RifffBlockRow({ groupId }: { groupId: string }): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  const expanded = !!state.exp[groupId]
  const color = identityColor(rifff)
  const geo = clipGeometry(state, groupId, PPB)

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border-soft)' }}>
      <div style={{ display: 'flex', height: 52 }}>
        <div
          onClick={() => dispatch({ type: 'SELECT', groupId })}
          style={{
            width: 212,
            flexShrink: 0,
            borderRight: '1px solid var(--ra-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '0 10px',
            background: selected ? 'var(--ra-bg-row-active)' : 'var(--ra-bg-row)',
            cursor: 'pointer'
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_EXPAND', groupId })
            }}
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              fontSize: 9
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: color,
              opacity: 0.55,
              flexShrink: 0
            }}
          />
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {rifff.name}
            </div>
            <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
              {rifff.stems.length} stems · {rifff.barLength} bars · {rifff.bpm} bpm
            </div>
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: geo.leftPx,
              width: geo.widthPx,
              borderRadius: 4,
              border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
              background: 'rgba(255,255,255,0.03)'
            }}
          >
            <div
              style={{
                height: 12,
                background: 'rgba(255,255,255,0.05)',
                fontSize: 9,
                color,
                padding: '0 4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              linked · {rifff.stems.length} stems
            </div>
          </div>
        </div>
      </div>

      {expanded &&
        rifff.stems.map((stem) => (
          <StemSubRow key={stem.slot} groupId={groupId} slot={stem.slot} />
        ))}
    </div>
  )
}
```

- [ ] **Step 3: Write `StemSubRow.tsx`**

```tsx
import { useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { clipGeometry } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'

const PPB = 24

export function StemSubRow({ groupId, slot }: { groupId: string; slot: number }): React.JSX.Element {
  const state = useAppState()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const muted = !!state.mute[key]

  const groupGeo = clipGeometry(state, groupId, PPB)
  const repetitions = Math.max(1, Math.round(rifff.barLength / stem.barLength))
  // Divide the parent clip's actual width evenly across repetitions, rather than
  // scaling each segment independently from the stem/rifff bar-length ratio — the
  // latter only tiles exactly when barLength divides evenly (e.g. 8/2), and silently
  // overshoots or leaves a gap otherwise (e.g. an 8-bar rifff with a 3-bar stem:
  // round(8/3)=3 reps at (3/8)*width each overshoots by a full bar).
  const repWidthPx = groupGeo.widthPx / repetitions

  return (
    <div
      style={{
        display: 'flex',
        height: 26,
        background: 'var(--ra-bg-row-sub)',
        borderTop: '1px solid var(--ra-bg-row)'
      }}
    >
      <div
        style={{
          width: 212,
          flexShrink: 0,
          padding: '0 10px 0 34px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          opacity: muted ? 0.5 : 1
        }}
      >
        <div style={{ width: 6, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{stem.slot}</span>
        <span
          style={{
            fontSize: 10,
            color: muted ? 'var(--ra-text-3)' : 'var(--ra-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {stem.name}
        </span>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {Array.from({ length: repetitions }, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: 3,
              bottom: 3,
              left: groupGeo.leftPx + i * repWidthPx,
              width: repWidthPx,
              borderRadius: 2,
              border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
              background: `color-mix(in srgb, ${color} 7%, transparent)`,
              opacity: muted ? 0.35 : 1
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Render block rows in the timeline and handle drop-to-place in `App.tsx`**

```tsx
import { type DragEvent } from 'react'
import { StoreProvider, useAppState, useDispatch } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB, LANE_HEADER_WIDTH } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { RifffBlockRow } from './components/RifffBlockRow'

function Timeline(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xInTimeline = e.clientX - rect.left - LANE_HEADER_WIDTH
    const startBar = Math.max(0, Math.round(xInTimeline / PPB))
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId, startBar })
  }

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <Ruler />
      {Object.values(state.rifffs)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (
          <RifffBlockRow key={r.groupId} groupId={r.groupId} />
        ))}
    </div>
  )
}

function Frame(): React.JSX.Element {
  const state = useAppState()
  return (
    <div className="ra-frame">
      <Titlebar
        rifffCount={Object.keys(state.rifffs).length}
        stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
      />
      <Shelf />
      <TransportBar />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <Timeline />
        </div>
        <Inspector />
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  )
}
```

- [ ] **Step 5: Verify with the fixture**

Run: `npm run dev`. Drag `fixtures/sample-rifff` onto the shelf drop target (as in
Task 10), then drag the resulting shelf card down onto the timeline around bar 5.
Expected: a block row appears with header "sample-rifff · 6 stems · 8 bars · 150 bpm",
a clip starting at `left = 120px` (bar 5 × `PPB` 24) spanning `width = 192px` (8 bars ×
24 — `PLACE_ON_TIMELINE` sets `stretch[groupId] = true`, so `clipGeometry` shows the
rifff's own 8-bar length unscaled; the project tempo, 80 by default, only changes the
clip's width once tempo diverges from the rifff's native 150 BPM in a later task's
live-reschedule behavior — dropping doesn't itself trigger a stretch preview). Clicking
the chevron expands 6 stem sub-rows, each showing its own repeated clip pattern (slot 6
"Freezer", 2 bars native, should show 4 repetitions; slot 8 "Sunset", 1 bar native,
should show 8; slots 1/3/5/7, each a full 8 bars, should show a single unrepeated clip).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add shelf-to-timeline drag placement and real block/stem row rendering"
```

---

## Task 12: Peak extraction and real waveform/polar-glyph rendering

**Files:**
- Create: `src/main/readAudioFile.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Create: `src/renderer/src/audio/peakCache.ts`
- Create: `src/renderer/src/components/PolarGlyph.tsx`
- Create: `src/renderer/src/components/Waveform.tsx`
- Modify: `src/renderer/src/components/Shelf.tsx`
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`
- Modify: `src/renderer/src/components/StemSubRow.tsx`

- [ ] **Step 1: Add a raw-bytes IPC read in `src/main/readAudioFile.ts`**

```ts
import { readFileSync } from 'fs'

export function readAudioFile(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}
```

- [ ] **Step 2: Expose it in `src/main/index.ts`**

```ts
import { readAudioFile } from './readAudioFile'

// alongside the other ipcMain.handle calls:
ipcMain.handle('read-audio-file', (_event, path: string) => readAudioFile(path))
```

- [ ] **Step 3: Add to the preload bridge (`src/preload/index.ts`)**

```ts
const api = {
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  readAudioFile: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('read-audio-file', path)
}
```

(Update `src/preload/index.d.ts`'s `RifffApi` type will follow automatically since it's
inferred from `typeof api`.)

- [ ] **Step 4: Write `src/renderer/src/audio/peakCache.ts`**

```ts
import { peaksFromChannel } from '@shared/visuals'

const cache = new Map<string, Promise<number[]>>()
let sharedContext: AudioContext | null = null

function getContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext()
  return sharedContext
}

export function getPeaks(path: string): Promise<number[]> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    const bytes = await window.rifffApi.readAudioFile(path)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const audioBuffer = await getContext().decodeAudioData(arrayBuffer)
    return peaksFromChannel(audioBuffer.getChannelData(0), 128)
  })()

  cache.set(path, promise)
  return promise
}

export function getAudioContext(): AudioContext {
  return getContext()
}
```

- [ ] **Step 5: Write `PolarGlyph.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { polarGlyph } from '@shared/visuals'
import { getPeaks } from '../audio/peakCache'
import type { Stem } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'

export function PolarGlyph({
  stems,
  identityColor,
  size
}: {
  stems: Stem[]
  identityColor: string
  size: number
}): React.JSX.Element {
  const [peaksByPath, setPeaksByPath] = useState<Record<string, number[]>>({})

  useEffect(() => {
    let cancelled = false
    Promise.all(stems.map((s) => getPeaks(s.path).then((p) => [s.path, p] as const))).then(
      (entries) => {
        if (!cancelled) setPeaksByPath(Object.fromEntries(entries))
      }
    )
    return () => {
      cancelled = true
    }
  }, [stems])

  const rings = stems
    .map((stem, i) => {
      const peaks = peaksByPath[stem.path]
      if (!peaks) return null
      const r0 = 17 + i * 2.5
      const amp = 10 + 15 * Math.min(1, 1 + 0.1) // volume wiring lands in Task 14; assume unity for now
      return { path: polarGlyph(peaks, r0, amp, 16), amp, color: typeColorVar(stem.type) }
    })
    .filter((r): r is { path: string; amp: number; color: string } => r !== null)
    .sort((a, b) => b.amp - a.amp)

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {rings.map((r, i) => (
        <path key={i} d={r.path} fill={r.color} opacity={0.55} />
      ))}
      <circle cx={50} cy={50} r={9} fill={identityColor} opacity={0.85} />
    </svg>
  )
}
```

- [ ] **Step 6: Write `Waveform.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { linearWave } from '@shared/visuals'
import { getPeaks } from '../audio/peakCache'

export function Waveform({
  path,
  color,
  opacity = 0.75
}: {
  path: string
  color: string
  opacity?: number
}): React.JSX.Element | null {
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getPeaks(path).then((p) => {
      if (!cancelled) setPeaks(p)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!peaks) return null

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 128 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0 }}
    >
      <path d={linearWave(peaks)} fill={color} opacity={opacity} />
    </svg>
  )
}
```

- [ ] **Step 7: Use them in `Shelf.tsx`** — replace the plain shelf-card contents with:

```tsx
<PolarGlyph
  stems={rifff.stems}
  identityColor={typeColorVar(rifff.stems[0]?.type ?? 'fx')}
  size={40}
/>
```

(add the import for `PolarGlyph` from `./PolarGlyph` and `typeColorVar` from `../theme/typeColor`)

- [ ] **Step 8: Use them in `RifffBlockRow.tsx`** — replace the 30px colored circle with
`<PolarGlyph stems={rifff.stems} identityColor={color} size={30} />`, and inside the clip
div (below the caption strip), add a summed waveform using the rifff's loudest stem as a
stand-in source (a true per-clip "summed" mix is out of scope for v1 — the design doc's
fidelity note only requires *a* representative waveform, not a true downmix):

```tsx
<div style={{ position: 'relative', flex: 1 }}>
  <Waveform path={rifff.stems[0].path} color={color} opacity={0.75} />
</div>
```

- [ ] **Step 9: Use `Waveform` in `StemSubRow.tsx`** inside each repetition div:

```tsx
<div style={{ /* existing repetition div styles */ }}>
  <Waveform path={stem.path} color={color} opacity={1} />
</div>
```

- [ ] **Step 10: Verify with the fixture**

Run: `npm run dev`, drop `fixtures/sample-rifff` onto the shelf. Expected: the shelf
card's glyph renders as a layered polar shape (not a plain circle) within a couple
seconds of dropping (peak decoding is async). Dragging onto the timeline and expanding
shows real waveform shapes in both the block's clip and each stem sub-row's repeated
clips, matching the general shape of `screenshots/2a-shelf-blocks-inspector.png`'s
waveforms (not pixel-identical — this is real audio, not the demo's canned peaks).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Add peak extraction and real waveform/polar-glyph rendering"
```

---

## Task 13: Inspector — full wiring (header, tempo, offset, stems)

**Files:**
- Rewrite: `src/renderer/src/components/Inspector.tsx`

- [ ] **Step 1: Rewrite `Inspector.tsx`**

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import { resolveOffsetKey, stretchRatio } from '../state/selectors'
import { dbLabel, offsetLabels } from '@shared/visuals'
import { stemKey, TYPE_ORDER } from '@shared/types'
import { SNAP_DIVS } from '../state/store'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'

export function Inspector(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const groupId = state.sel

  if (!groupId || !state.rifffs[groupId]) {
    return (
      <div style={{ width: 308, flexShrink: 0, background: 'var(--ra-bg-bar)', borderLeft: '1px solid var(--ra-border)' }}>
        <div style={{ padding: '12px 14px' }}>
          <span className="ra-eyebrow">inspector</span>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>
            select a rifff block to inspect it
          </div>
        </div>
      </div>
    )
  }

  const rifff = state.rifffs[groupId]
  const color = typeColorVar(rifff.stems[0]?.type ?? 'fx')
  const stretchOn = state.stretch[groupId] ?? true
  const ratio = stretchRatio(state, groupId)
  const groupOffsetKey = resolveOffsetKey(state, groupId, rifff.stems[0]?.slot ?? 0)
  const groupOffsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const labels = offsetLabels(groupOffsetSteps, snapDiv, state.bpm)
  const unlinked = !!state.unlinked[groupId]

  const section = (children: React.JSX.Element): React.JSX.Element => (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ra-border)' }}>{children}</div>
  )

  return (
    <div style={{ width: 308, flexShrink: 0, background: 'var(--ra-bg-bar)', borderLeft: '1px solid var(--ra-border)' }}>
      {section(
        <>
          <span className="ra-eyebrow">inspector</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <PolarGlyph stems={rifff.stems} identityColor={color} size={34} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{rifff.name}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ra-text-3)', wordBreak: 'break-all' }}>
            {rifff.folderPath}/
          </div>
        </>
      )}

      {section(
        <>
          <span className="ra-eyebrow">tempo</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <div>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{rifff.bpm}</span>
              <span style={{ margin: '0 6px' }}>→</span>
              <span style={{ fontSize: 19, fontWeight: 700, color }}>{state.bpm}</span>
            </div>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_STRETCH', groupId })}
              style={{
                height: 22,
                borderRadius: 6,
                padding: '0 8px',
                fontSize: 10,
                background: stretchOn && ratio !== 1 ? 'var(--ra-stretch-on-bg)' : 'transparent',
                border: `1px solid ${stretchOn && ratio !== 1 ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: stretchOn && ratio !== 1 ? 'var(--ra-stretch-on)' : 'var(--ra-text-3)'
              }}
            >
              {stretchOn ? 'stretch on' : 'native'}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ra-text-2)' }}>
            {ratio === 1
              ? 'native tempo — nothing to stretch.'
              : stretchOn
                ? `stretched ${(ratio * 100).toFixed(1)}% to fit the project grid. pitch preserved.`
                : 'playing at source tempo — will drift against the grid.'}
          </div>
        </>
      )}

      {section(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="ra-eyebrow">offset</span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              grid 1/{snapDiv} · {labels.msPerStep}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => dispatch({ type: 'NUDGE_OFFSET', key: groupOffsetKey, delta: -1 })}
              style={{ width: 26, height: 24, borderRadius: 6, border: '1px solid var(--ra-border-strong)' }}
            >
              −
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--ra-text-4)' }}>
              −8 / 0 / +8
            </div>
            <button
              onClick={() => dispatch({ type: 'NUDGE_OFFSET', key: groupOffsetKey, delta: 1 })}
              style={{ width: 26, height: 24, borderRadius: 6, border: '1px solid var(--ra-border-strong)' }}
            >
              +
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
            <div>
              <span style={{ fontSize: 16, fontWeight: 700, color: groupOffsetSteps ? color : 'var(--ra-text-2)' }}>
                {labels.grid}
              </span>
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>{labels.ms}</span>
            </div>
            <button
              onClick={() => dispatch({ type: 'ZERO_OFFSET', key: groupOffsetKey })}
              style={{ height: 20, borderRadius: 4, padding: '0 6px', fontSize: 10 }}
            >
              zero
            </button>
          </div>
        </>
      )}

      {section(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ra-eyebrow">stems</span>
            <button
              onClick={() => dispatch({ type: unlinked ? 'RELINK' : 'UNLINK', groupId })}
              style={{
                height: 20,
                borderRadius: 4,
                padding: '0 6px',
                fontSize: 10,
                color: unlinked ? 'var(--ra-text-2)' : 'var(--ra-mute-on)',
                border: `1px solid ${unlinked ? 'var(--ra-border)' : 'color-mix(in srgb, var(--ra-mute-on) 55%, transparent)'}`
              }}
            >
              {unlinked ? 'relink group' : 'unlink group'}
            </button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {rifff.stems.map((stem) => {
              const key = stemKey(groupId, stem.slot)
              const muted = !!state.mute[key]
              const volume = state.vol[key] ?? 1
              return (
                <div key={stem.slot} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 24 }}>
                  <button
                    onClick={() => dispatch({ type: 'CYCLE_TYPE', groupId, slot: stem.slot })}
                    title="click to change sound type"
                    style={{ width: 6, height: 12, borderRadius: 2, background: typeColorVar(stem.type), border: 'none', padding: 0 }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{stem.slot}</span>
                  <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stem.name}
                  </span>
                  <button
                    onClick={() => dispatch({ type: 'TOGGLE_MUTE', stemKey: key })}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: muted ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
                      color: muted ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)',
                      fontSize: 9,
                      border: 'none'
                    }}
                  >
                    m
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(volume * 100)}
                    onChange={(e) =>
                      dispatch({ type: 'SET_VOLUME', stemKey: key, volume: Number(e.target.value) / 100 })
                    }
                    style={{ width: 82 }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 30, textAlign: 'right' }}>
                    {muted ? 'mute' : dbLabel(volume)}
                  </span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--ra-text-3)' }}>
            source: {rifff.stems[0]?.author}
            {new Set(rifff.stems.map((s) => s.author)).size > 1 ? ' and others' : ''}, copied into
            your rifff library.
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify with the fixture**

Run: `npm run dev`, drop and place `fixtures/sample-rifff`, click its block to select
it. Expected: inspector shows the header with glyph/name/path, tempo `150 → 80` with the
mismatch-colored stretch chip and "stretched ...% to fit the project grid" note, an
offset section whose ± buttons and zero button change the grid/ms readouts live, and a
stems list where dragging each volume slider updates its dB readout, muting dims the row,
and clicking a type swatch cycles its color through all 8 types (also updating the
matching stem sub-row's swatch/clip color in the timeline).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Wire full inspector: header, tempo, offset, stems sections"
```

---

## Task 14: Playback engine — pure scheduling logic, with tests

**Files:**
- Create: `src/shared/schedulePlayback.ts`
- Test: `src/shared/schedulePlayback.test.ts`

This isolates the *math* of "when does each stem repetition need to start, and at what
offset into its buffer" from the actual Web Audio calls, so it can be unit tested. Task
15 wires this into a real `AudioContext`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { computeStemSchedule } from './schedulePlayback'
import type { Rifff } from './types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 12.8, barLength: 8 },
    { slot: 6, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 3.2, barLength: 2 }
  ]
}

describe('computeStemSchedule', () => {
  it('schedules one segment for a stem whose loop matches the rifff length', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments).toHaveLength(1)
    expect(segments[0].startBarInTimeline).toBe(4)
    expect(segments[0].durationSec).toBeCloseTo(12.8, 5)
    expect(segments[0].bufferOffsetSec).toBe(0)
  })

  it('schedules one segment per repetition for a shorter loop', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[1], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments).toHaveLength(4) // 8-bar rifff / 2-bar stem
    expect(segments[0].startBarInTimeline).toBe(4)
    expect(segments[1].startBarInTimeline).toBe(6)
    expect(segments[3].startBarInTimeline).toBe(10)
  })

  it('shifts segments by the grid-step offset, in bars', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 4, // +4/16 = +0.25 bar
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments[0].startBarInTimeline).toBe(4.25)
  })

  it('drops segments that have already fully played before the current position', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[1], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 8, // partway through the rifff
      projectBpm: 150
    })
    // repetitions at bars 4,6,8,10 -> only the ones ending after pos 8 remain (6→8 boundary excluded, 8→10 and beyond)
    expect(segments).toHaveLength(2)
    expect(segments[0].startBarInTimeline).toBe(8)
    expect(segments[1].startBarInTimeline).toBe(10)
    expect(segments.every((s) => s.startBarInTimeline + s.barLength > 8)).toBe(true)
  })

  it('clips the final repetition when the stem length does not evenly divide the rifff length', () => {
    const threeBarStem = {
      slot: 9,
      author: 'e',
      name: 'c',
      type: 'fx' as const,
      path: '/c.wav',
      durationSec: 4.8, // 3 bars at 150 bpm (1.6s/bar)
      barLength: 3
    }
    const segments = computeStemSchedule(rifff, threeBarStem, {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    // 8-bar rifff / 3-bar stem: reps at [0,3) [3,6) [6,9) would overrun by 1 bar —
    // the last one must be clipped to [6,8), i.e. barLength 2, not 3.
    expect(segments).toHaveLength(3)
    expect(segments[0]).toMatchObject({ startBarInTimeline: 4, barLength: 3 })
    expect(segments[1]).toMatchObject({ startBarInTimeline: 7, barLength: 3 })
    expect(segments[2]).toMatchObject({ startBarInTimeline: 10, barLength: 2 })
    // No segment may extend past the rifff's own span on the timeline.
    const rifffEnd = (rifff.startBar ?? 0) + rifff.barLength
    for (const s of segments) {
      expect(s.startBarInTimeline + s.barLength).toBeLessThanOrEqual(rifffEnd)
    }
    // Duration scales down proportionally for the clipped final segment.
    expect(segments[2].durationSec).toBeCloseTo((2 / 3) * 4.8, 5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './schedulePlayback'`

- [ ] **Step 3: Write `src/shared/schedulePlayback.ts`**

```ts
import type { Rifff, Stem } from './types'

export interface ScheduleOptions {
  offsetSteps: number
  snapDiv: number
  /** current playhead position, in bars */
  projectPos: number
  projectBpm: number
}

export interface PlaybackSegment {
  /** where this segment's audio starts, in bars along the 32-bar timeline */
  startBarInTimeline: number
  /** how many bars of the rifff's grid this segment occupies */
  barLength: number
  /** offset into the stem's own audio buffer to start playback from, in seconds */
  bufferOffsetSec: number
  /** how many seconds of audio to play for this segment */
  durationSec: number
}

export function computeStemSchedule(
  rifff: Rifff,
  stem: Stem,
  opts: ScheduleOptions
): PlaybackSegment[] {
  const start = rifff.startBar ?? 0
  const offsetBars = opts.offsetSteps / opts.snapDiv
  const secPerBarNative = stem.durationSec / stem.barLength

  const segments: PlaybackSegment[] = []
  for (let barOffset = 0; barOffset < rifff.barLength; barOffset += stem.barLength) {
    // Clip the final repetition so segments always tile exactly across the rifff's
    // own span, even when stem.barLength doesn't evenly divide rifff.barLength (e.g.
    // a 3-bar stem in an 8-bar rifff would otherwise produce a last repetition that
    // overruns into whatever follows on the timeline, or for a >50%-length stem,
    // leave the block's tail silent). Same failure mode already fixed for the visual
    // layer in Task 11's StemSubRow tiling.
    const segmentBarLength = Math.min(stem.barLength, rifff.barLength - barOffset)
    const startBarInTimeline = start + offsetBars + barOffset
    const endBarInTimeline = startBarInTimeline + segmentBarLength
    if (endBarInTimeline <= opts.projectPos) continue // fully in the past
    segments.push({
      startBarInTimeline,
      barLength: segmentBarLength,
      // Mid-segment resume offset (e.g. resuming playback partway through a
      // segment) is computed by the audio engine (Task 15), not here.
      bufferOffsetSec: 0,
      durationSec: segmentBarLength * secPerBarNative
    })
  }
  return segments
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, all `schedulePlayback.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add pure playback scheduling logic, with tests"
```

---

## Task 15: Playback engine — Web Audio wiring, transport, and playhead

**Files:**
- Create: `src/renderer/src/audio/AudioEngine.ts`
- Modify: `src/renderer/src/state/StoreContext.tsx`
- Create: `src/renderer/src/components/Playhead.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write `src/renderer/src/audio/AudioEngine.ts`**

```ts
import { computeStemSchedule } from '@shared/schedulePlayback'
import type { Rifff } from '@shared/types'
import { getAudioContext } from './peakCache'

interface EngineDeps {
  getRifffs: () => Rifff[]
  getOffsetSteps: (groupId: string, slot: number) => number
  getSnapDiv: () => number
  getVolume: (stemKey: string) => number
  isMuted: (stemKey: string) => boolean
  getProjectBpm: () => number
}

const bufferCache = new Map<string, Promise<AudioBuffer>>()

async function loadBuffer(path: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(path)
  if (cached) return cached
  const promise = (async () => {
    const bytes = await window.rifffApi.readAudioFile(path)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return getAudioContext().decodeAudioData(arrayBuffer)
  })()
  bufferCache.set(path, promise)
  return promise
}

export class AudioEngine {
  private deps: EngineDeps
  private activeSources: AudioBufferSourceNode[] = []
  private gainNodes = new Map<string, GainNode>()
  private startContextTime = 0
  private startPos = 0
  private secPerBar = 0

  constructor(deps: EngineDeps) {
    this.deps = deps
  }

  private gainFor(stemKeyStr: string): GainNode {
    let node = this.gainNodes.get(stemKeyStr)
    if (!node) {
      node = getAudioContext().createGain()
      node.connect(getAudioContext().destination)
      this.gainNodes.set(stemKeyStr, node)
    }
    this.applyGain(stemKeyStr, node)
    return node
  }

  private applyGain(stemKeyStr: string, node: GainNode): void {
    const muted = this.deps.isMuted(stemKeyStr)
    node.gain.value = muted ? 0 : this.deps.getVolume(stemKeyStr)
  }

  updateLiveGains(): void {
    for (const [key, node] of this.gainNodes) this.applyGain(key, node)
  }

  async play(fromPos: number): Promise<void> {
    const ctx = getAudioContext()
    await ctx.resume()
    this.stopSources()

    const bpm = this.deps.getProjectBpm()
    this.secPerBar = (60 / bpm) * 4
    this.startContextTime = ctx.currentTime
    this.startPos = fromPos

    const rifffs = this.deps.getRifffs().filter((r) => r.startBar !== undefined)
    for (const rifff of rifffs) {
      for (const stem of rifff.stems) {
        const stemKeyStr = `${rifff.groupId}:${stem.slot}`
        const offsetSteps = this.deps.getOffsetSteps(rifff.groupId, stem.slot)
        const segments = computeStemSchedule(rifff, stem, {
          offsetSteps,
          snapDiv: this.deps.getSnapDiv(),
          projectPos: fromPos,
          projectBpm: bpm
        })
        if (segments.length === 0) continue

        const buffer = await loadBuffer(stem.path)
        const gain = this.gainFor(stemKeyStr)

        for (const seg of segments) {
          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(gain)
          const barsFromNow = seg.startBarInTimeline - fromPos
          const when = this.startContextTime + Math.max(0, barsFromNow) * this.secPerBar
          const bufferOffset = barsFromNow < 0 ? -barsFromNow * this.secPerBar : 0
          const duration = seg.durationSec - bufferOffset
          if (duration <= 0) continue
          source.start(when, seg.bufferOffsetSec + bufferOffset, duration)
          this.activeSources.push(source)
        }
      }
    }
  }

  stop(): void {
    this.stopSources()
  }

  private stopSources(): void {
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    this.activeSources = []
  }

  currentPos(loopBars: number): number {
    const ctx = getAudioContext()
    const elapsedBars = (ctx.currentTime - this.startContextTime) / this.secPerBar
    return (this.startPos + elapsedBars) % loopBars
  }
}
```

- [ ] **Step 2: Instantiate the engine and drive the transport clock from `StoreContext.tsx`**

Rewrite `StoreProvider` to own an `AudioEngine`, start/stop it on `PLAY`/`PAUSE`/`STOP`,
and poll the playhead position on an animation frame throttled to ~55ms (18fps) per the
spec:

```tsx
import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react'
import { initialState, reducer, type Action, type AppState } from './store'
import { AudioEngine } from '../audio/AudioEngine'
import { stemKey } from '@shared/types'
import { resolveOffsetKey } from './selectors'

const StateCtx = createContext<AppState>(initialState)
const DispatchCtx = createContext<Dispatch<Action>>(() => {})

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  const engineRef = useRef<AudioEngine>()
  if (!engineRef.current) {
    engineRef.current = new AudioEngine({
      getRifffs: () => Object.values(stateRef.current.rifffs),
      getOffsetSteps: (groupId, slot) => {
        const key = resolveOffsetKey(stateRef.current, groupId, slot)
        return stateRef.current.off[key] ?? 0
      },
      getSnapDiv: () => [4, 8, 16, 32][stateRef.current.snapIdx],
      getVolume: (key) => stateRef.current.vol[key] ?? 1,
      isMuted: (key) => !!stateRef.current.mute[key],
      getProjectBpm: () => stateRef.current.bpm
    })
  }

  useEffect(() => {
    engineRef.current!.updateLiveGains()
  }, [state.vol, state.mute])

  useEffect(() => {
    if (state.playing) {
      engineRef.current!.play(state.pos)
      let raf: number
      let lastTick = 0
      const tick = (t: number): void => {
        if (t - lastTick > 55) {
          lastTick = t
          dispatch({ type: 'SET_POS', pos: engineRef.current!.currentPos(32) })
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    } else {
      engineRef.current!.stop()
    }
    return undefined
  }, [state.playing])

  useEffect(() => {
    if (!state.playing) engineRef.current!.stop()
  }, [state.pos === 0])

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

export function useAppState(): AppState {
  return useContext(StateCtx)
}

export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchCtx)
}
```

- [ ] **Step 3: Write `Playhead.tsx`**

```tsx
import { useAppState } from '../state/StoreContext'
import { LANE_HEADER_WIDTH, PPB } from './Ruler'

export function Playhead(): React.JSX.Element {
  const state = useAppState()
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: LANE_HEADER_WIDTH + state.pos * PPB,
        width: 1,
        background: 'var(--ra-playhead)',
        pointerEvents: 'none'
      }}
    />
  )
}
```

- [ ] **Step 4: Overlay it in `App.tsx`'s `Timeline`**

```tsx
<div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} style={{ position: 'relative' }}>
  <Ruler />
  {Object.values(state.rifffs)
    .filter((r) => r.startBar !== undefined)
    .map((r) => (
      <RifffBlockRow key={r.groupId} groupId={r.groupId} />
    ))}
  <Playhead />
</div>
```

(add the `Playhead` import)

- [ ] **Step 5: Verify with the fixture**

Run: `npm run dev`, place `fixtures/sample-rifff` on the timeline around bar 1, press
play. Expected: audible playback of the 6 real stems, the playhead line advances left to
right, the position readout (`001.1.1` etc.) counts up, and it loops back to bar 1 after
32 bars. Stop resets the playhead to bar 1 and silences all stems immediately.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Wire Web Audio playback engine, transport controls, and playhead"
```

---

## Task 16: Offset applied to live playback, tempo changes reschedule

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

Offset and tempo already drive `AudioEngine.play()`'s scheduling math (Task 15's
`getOffsetSteps`/`getProjectBpm` callbacks read live state). What's missing: changing
offset or tempo *while already playing* needs to restart scheduling from the current
position so the change takes effect immediately instead of only on the next `play()`.

- [ ] **Step 1: Add a re-schedule effect to `StoreProvider`**

```tsx
useEffect(() => {
  if (state.playing) {
    engineRef.current!.play(engineRef.current!.currentPos(32))
  }
}, [state.off, state.bpm, state.snapIdx, state.unlinked])
```

Place this alongside the other `useEffect` calls in `StoreProvider`.

- [ ] **Step 2: Verify with the fixture**

Run: `npm run dev`, place and play `fixtures/sample-rifff`. While it's playing, click a
tempo + button in the transport bar repeatedly. Expected: playback audibly speeds up
(pitch is unaffected until Task 18 adds real stretch — for now, changing tempo changes
native playback rate implicitly through the rescheduling, which is expected transitional
behavior before Task 18 lands). Adjust an offset ± in the inspector while playing;
expected: a brief audible jump as the affected stem(s) reschedule to the new offset.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Reschedule live playback on offset/tempo/snap/unlink changes"
```

---

## Task 17: Unlink/relink — full behavior confirmation

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`

The reducer (Task 8) and inspector button (Task 13) already implement unlink/relink
state. This task wires the one remaining visual rule from the spec: an unlinked group's
clip border goes neutral instead of the rifff identity color.

- [ ] **Step 1: Update the clip border color in `RifffBlockRow.tsx`**

Change the clip `div`'s `border` style from the hardcoded identity-color version to:

```tsx
const unlinked = !!state.unlinked[groupId]
const clipBorderColor = unlinked ? 'var(--ra-border-strong)' : `color-mix(in srgb, ${color} 55%, transparent)`
```

and use `border: `1px solid ${clipBorderColor}`` in the clip div's style.

- [ ] **Step 2: Verify with the fixture**

Run: `npm run dev`, place `fixtures/sample-rifff`, select it, click "unlink group" in the
inspector. Expected: the clip's border in the timeline changes from the rifff's identity
color to neutral gray, and the inspector button now reads "relink group". Adjust one
stem's offset via... (offset UI is group/stem-key aware already since `resolveOffsetKey`
switches automatically once `unlinked` is true — no separate per-stem offset UI exists
yet in the inspector, which only shows the group-level offset control; note this as a
known v1 gap, not a regression: per-stem offset after unlink is settable programmatically
via the same control once `sel` targeting is extended, but the spec's inspector layout
only shows one offset section regardless of link state, driven by whichever key
`resolveOffsetKey` resolves to for the group's first stem). Click "relink group";
expected: border returns to the identity color and the button reads "unlink group" again.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Apply neutral clip border when a rifff group is unlinked"
```

---

## Task 18: Time-stretch via native `rubberband`

**Files:**
- Create: `src/main/rubberband.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/audio/AudioEngine.ts`

- [ ] **Step 1: Write `src/main/rubberband.ts`**

```ts
import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/rubberband',
  '/usr/local/bin/rubberband',
  'rubberband' // fall back to PATH
]

function findRubberband(): string {
  for (const path of CANDIDATE_PATHS) {
    if (path === 'rubberband' || existsSync(path)) return path
  }
  return 'rubberband'
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'stretch-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

function cacheKey(stemPath: string, ratio: number): string {
  const hash = createHash('sha1').update(`${stemPath}::${ratio.toFixed(4)}`).digest('hex')
  return `${hash}.wav`
}

/**
 * Renders a tempo-stretched, pitch-preserved copy of stemPath at the given ratio
 * (projectBpm / rifffBpm) and returns the rendered file's absolute path.
 * Results are cached by (path, ratio) so repeated tempo settings don't re-render.
 */
export async function renderStretched(stemPath: string, ratio: number): Promise<string> {
  if (Math.abs(ratio - 1) < 0.001) return stemPath // native tempo, nothing to render

  const outPath = join(cacheDir(), cacheKey(stemPath, ratio))
  if (existsSync(outPath)) return outPath

  const binary = findRubberband()
  // --tempo is a multiplier on duration: to speed audio up to fit projectBpm/rifffBpm = ratio,
  // the OUTPUT duration should be 1/ratio of the input's, so pass --tempo {ratio}.
  await execFileAsync(binary, ['--tempo', ratio.toFixed(6), stemPath, outPath])
  return outPath
}
```

- [ ] **Step 2: Expose it over IPC in `src/main/index.ts`**

```ts
import { renderStretched } from './rubberband'

ipcMain.handle('render-stretched', (_event, stemPath: string, ratio: number) =>
  renderStretched(stemPath, ratio)
)
```

- [ ] **Step 3: Add to the preload bridge**

```ts
const api = {
  // ...existing entries
  renderStretched: (stemPath: string, ratio: number): Promise<string> =>
    ipcRenderer.invoke('render-stretched', stemPath, ratio)
}
```

- [ ] **Step 4: Wire it into `AudioEngine`**

Modify `loadBuffer` to accept an optional ratio and resolve through rubberband first:

```ts
async function loadBuffer(path: string, ratio: number): Promise<AudioBuffer> {
  const cacheKeyStr = `${path}::${ratio.toFixed(4)}`
  const cached = bufferCache.get(cacheKeyStr)
  if (cached) return cached
  const promise = (async () => {
    let resolvedPath = path
    if (Math.abs(ratio - 1) >= 0.001) {
      try {
        resolvedPath = await window.rifffApi.renderStretched(path, ratio)
      } catch {
        resolvedPath = path // fall back to native-speed playback on render failure
      }
    }
    const bytes = await window.rifffApi.readAudioFile(resolvedPath)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return getAudioContext().decodeAudioData(arrayBuffer)
  })()
  bufferCache.set(cacheKeyStr, promise)
  return promise
}
```

And in `play()`, compute each rifff's ratio only when its stretch toggle is on, and
pass it through:

```ts
// inside the `for (const rifff of rifffs)` loop, before the stem loop:
const stretchOn = this.deps.isStretchOn(rifff.groupId)
const ratio = stretchOn ? bpm / rifff.bpm : 1

// change the loadBuffer call inside the stem loop:
const buffer = await loadBuffer(stem.path, ratio)
```

Add `isStretchOn: (groupId: string) => boolean` to `EngineDeps`, and wire it from
`StoreContext.tsx`'s engine construction: `isStretchOn: (groupId) => stateRef.current.stretch[groupId] ?? true`.

Also add `state.stretch` to the re-schedule effect's dependency array from Task 16.

- [ ] **Step 5: Verify with the fixture**

Since all 6 fixture stems share one BPM (150), stretch behavior needs a tempo mismatch
to observe: run `npm run dev`, place `fixtures/sample-rifff`, set the transport tempo to
100 (so ratio = 100/150 ≈ 0.667), and press play.
Expected: first playback has a brief delay (rubberband rendering — check the terminal
running `npm run dev` for no errors), then plays back at the new tempo with pitch
sounding unchanged (not simply sped up/down). Toggle the inspector's stretch chip to
"native"; expected: reverts to the original 150 BPM native speed and the tempo note
switches to "playing at source tempo — will drift against the grid." Re-render the same
tempo again (toggle stretch back on); expected: near-instant response (hits the on-disk
cache from `~/Library/Application Support/bendlesss/stretch-cache/`, no re-render delay).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add native rubberband time-stretch rendering with disk cache"
```

---

## Task 19: Project save/load, and relink-missing-folder flow

**Files:**
- Create: `src/main/projectFile.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/serialize.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Inspector.tsx`

- [ ] **Step 1: Write the failing serialize/deserialize test**

```ts
import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import { serializeProject, deserializeProject } from './serialize'
import type { Rifff } from '@shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [{ slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }]
}

describe('project serialization', () => {
  it('round-trips app state through JSON', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_TEMPO', bpm: 96 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 2 })

    const json = serializeProject(state)
    const restored = deserializeProject(JSON.parse(json))

    expect(restored.bpm).toBe(96)
    expect(restored.off.r1).toBe(2)
    expect(restored.rifffs.r1.name).toBe('test')
    expect(restored.playing).toBe(false) // never restore a playing state
    expect(restored.pos).toBe(0) // always reopen at the top
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './serialize'`

- [ ] **Step 3: Write `src/renderer/src/state/serialize.ts`**

```ts
import { initialState, type AppState } from './store'

export function serializeProject(state: AppState): string {
  const { playing, pos, ...rest } = state
  return JSON.stringify(rest, null, 2)
}

export function deserializeProject(data: Omit<AppState, 'playing' | 'pos'>): AppState {
  return { ...initialState, ...data, playing: false, pos: 0 }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Write `src/main/projectFile.ts`**

```ts
import { readFileSync, writeFileSync } from 'fs'
import { dialog, BrowserWindow } from 'electron'

export async function saveProjectAs(win: BrowserWindow, json: string): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Rifff Arranger Project', extensions: ['rifffproj'] }]
  })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, json, 'utf-8')
  return result.filePath
}

export async function openProject(win: BrowserWindow): Promise<{ path: string; json: string } | null> {
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Rifff Arranger Project', extensions: ['rifffproj'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const path = result.filePaths[0]
  return { path, json: readFileSync(path, 'utf-8') }
}
```

- [ ] **Step 6: Expose over IPC in `src/main/index.ts`**

```ts
import { BrowserWindow } from 'electron'
import { saveProjectAs, openProject } from './projectFile'

ipcMain.handle('save-project', (event, json: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)!
  return saveProjectAs(win, json)
})

ipcMain.handle('open-project', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)!
  return openProject(win)
})
```

- [ ] **Step 7: Add to the preload bridge**

```ts
const api = {
  // ...existing entries
  saveProject: (json: string): Promise<string | null> => ipcRenderer.invoke('save-project', json),
  openProject: (): Promise<{ path: string; json: string } | null> => ipcRenderer.invoke('open-project')
}
```

- [ ] **Step 8: Add Save/Open to the titlebar area in `App.tsx`**

Add two buttons to `Frame`, wired to dispatch a full-state replace. Since the reducer
has no "replace whole state" action, add one:

In `src/renderer/src/state/store.ts`, add to the `Action` union:

```ts
| { type: 'LOAD_STATE'; state: AppState }
```

and to the `reducer` switch:

```ts
case 'LOAD_STATE':
  return action.state
```

Then in `App.tsx`:

```tsx
import { serializeProject, deserializeProject } from './state/serialize'

function ProjectMenu(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()

  async function handleSave(): Promise<void> {
    await window.rifffApi.saveProject(serializeProject(state))
  }

  async function handleOpen(): Promise<void> {
    const result = await window.rifffApi.openProject()
    if (!result) return
    const loaded = deserializeProject(JSON.parse(result.json))
    dispatch({ type: 'LOAD_STATE', state: loaded })
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={handleSave}>save</button>
      <button onClick={handleOpen}>open</button>
    </div>
  )
}
```

Render `<ProjectMenu />` inside `Frame`, e.g. next to the `Titlebar`.

- [ ] **Step 9: Handle a missing library copy — re-import flow**

Since import now copies stems into `~/Music/Rifff Arranger Library`, the app no longer
depends on the original source folder staying where it was — that's the whole point of
copying. The remaining failure case is rarer: the user manually deletes a rifff's folder
from inside the library itself. Handle it the same way regardless: make the inspector's
source-path line clickable to re-import from a freshly picked folder, reusing the
existing `groupId` so offsets/volumes/mutes survive.

In `Inspector.tsx`'s header section, make the source-path line clickable:

```tsx
<div
  onClick={async () => {
    const folder = await window.rifffApi.pickFolder()
    if (!folder) return
    const reimported = await window.rifffApi.importRifff([folder])
    if (!reimported) return
    dispatch({
      type: 'ADD_TO_SHELF',
      rifff: { ...reimported, groupId, startBar: rifff.startBar }
    })
  }}
  style={{ marginTop: 6, fontSize: 10, color: 'var(--ra-text-3)', wordBreak: 'break-all', cursor: 'pointer' }}
  title="click to re-import this rifff from its source folder"
>
  {rifff.folderPath}/
</div>
```

This reuses the existing `groupId` so offsets/volumes/mutes (all keyed by `groupId` or
`stemKey(groupId, slot)`) survive the re-import — only the `rifffs[groupId]` entry itself
(name/bpm/stems/paths) is replaced, and a fresh copy lands in the library under the same
`groupId` folder (overwriting whatever was or wasn't there).

- [ ] **Step 10: Verify with the fixture**

Run: `npm run dev`, build up a small arrangement (place `fixtures/sample-rifff`, adjust
tempo/offset/volume), click "save", choose a location. Quit and relaunch the app
(`npm run dev` again), click "open", select the saved file. Expected: the arrangement,
tempo, and offset restore exactly; playback position starts at bar 1 and the app isn't
mid-playing. To test the re-import flow: in Finder, delete that rifff's folder from
`~/Music/Rifff Arranger Library/{groupId}/`, reload the saved project — the block still
shows with its old data but the waveform/playback should fail silently (stems point at
now-missing files); click the inspector's source path, pick `fixtures/sample-rifff`
again in the dialog; expected: a fresh copy lands in the library and
waveforms/playback work again with the same offset/volume settings preserved.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Add project save/load and library re-import flow"
```

---

## Task 20: Packaging (macOS, arm64) and end-to-end manual verification

**Files:**
- Modify: `package.json`
- Create: `electron-builder.yml`

- [ ] **Step 1: Install electron-builder** (electron-vite scaffolds usually include it
already — check `package.json` devDependencies first)

```bash
npm ls electron-builder || npm install -D electron-builder
```

- [ ] **Step 2: Write `electron-builder.yml`**

```yaml
appId: com.ellinglien.bendlesss
productName: Rifff Arranger
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
mac:
  category: public.app-category.music
  target:
    - target: dmg
      arch:
        - arm64
```

- [ ] **Step 3: Add a build script if the scaffold didn't already**

In `package.json` `"scripts"`, ensure:

```json
"build": "electron-vite build",
"dist:mac": "npm run build && electron-builder --mac --arm64"
```

- [ ] **Step 4: Verify packaging**

Run: `npm run dist:mac`
Expected: completes without error, producing `dist/Rifff Arranger-<version>-arm64.dmg`.
Mount it, drag the app to Applications (or run it directly from the mounted volume),
launch it. Expected: opens like the dev build. Note: the packaged app relies on
`rubberband` being installed via Homebrew on the machine running it (per the design
doc's stated trade-off — bundling the binary into the app package is a documented
fast-follow, not required for this personal-use v1).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add macOS arm64 packaging config"
```

- [ ] **Step 6: Full manual verification pass**

Using the packaged (or dev) app and `fixtures/sample-rifff`, walk through every
interaction in the design spec's "Interactions & Behavior" section and confirm:

- [ ] Dropping the fixture folder onto the shelf adds a card with correct name/bpm/stems/bars
- [ ] Dragging the shelf card onto the timeline places a block at the drop bar, pre-aligned, auto-selected and expanded
- [ ] Clicking a block or shelf card selects it and drives the inspector
- [ ] Chevron expand/collapse works independent of selection
- [ ] Play/pause/stop behave per spec (wall-clock transport, loops at 32 bars, stop resets to bar 1 and silences everything)
- [ ] Tempo ± moves in 1 BPM steps, clamps 40–200, changes stretch ratio and clip widths live
- [ ] Snap cycles 1/4 → 1/8 → 1/16 → 1/32 and back; existing offsets keep their step count (verify: set an offset, cycle snap, confirm the step count number is unchanged even though its ms value changes)
- [ ] Offset ± moves in single grid steps, clamps −8..8
- [ ] Stretch toggle changes clip width and audio pitch-preserved speed as described
- [ ] Unlink turns the group into independent stems with neutral clip border; relink restores group control
- [ ] Mute dims the row, drops the clip to 35% opacity, shows "mute" in the dB readout, and silences audio
- [ ] Volume slider updates the dB readout correctly (`0.0` at unity, `−inf` at zero)
- [ ] Loop-length handling draws multiple repeated clips for slot 6 (Freezer, 2 bars →
      4 repetitions across the 8-bar rifff) and slot 8 (Sunset, 1 bar → 8 repetitions),
      while slots 1/3/5/7 (each a full 8 bars) draw a single clip with no repetition
- [ ] Save then Open round-trips the full arrangement
- [ ] Re-importing after deleting a rifff's library folder preserves prior offsets/volumes/mutes

If any item fails, file it as a fast-follow rather than blocking — this checklist is the
plan's definition of "v1 done," not a gate on every future refinement.

---

## Self-Review Notes

- **Spec coverage:** all 5 core features (linked drop, unlink, time-stretch, offset,
  volume) have dedicated tasks (9–11, 17, 13/15, 13/14). Sound-type assignment, project
  persistence, copy-on-import to the managed library, and the re-import flow (this
  design's additions beyond the visual spec) are covered in Tasks 4/10/13 and 19.
  Packaging is covered in Task 20.
- **Type consistency:** `stemKey(groupId, slot)` (Task 4) is used identically in the
  reducer (Task 8), selectors (Task 8), Inspector (Task 13), and AudioEngine (Task 15) —
  no divergent naming. `AppState`'s field names match the design doc's state table
  verbatim, plus the `rifffs` map this plan adds.
- **Known v1 gap flagged in Task 17:** unlinked per-stem offset has no dedicated UI
  control (the inspector's offset section is group-scoped visually even when unlinked).
  This matches the *visual* spec, which doesn't show a second offset control anywhere —
  left as-is rather than inventing a UI element the design doesn't call for.
