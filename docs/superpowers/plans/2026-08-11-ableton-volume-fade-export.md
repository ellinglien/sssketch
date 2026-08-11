# Ableton-Matched Volume/Fade Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stem's exported Ableton clip carries its sssketch volume and fade-in/fade-out as
native, still-editable Ableton clip properties (`SampleVolume`, `Fade`, `FadeInLength`/
`FadeOutLength`), and the on-screen fade curve in sssketch's own UI stops implying a curve shape
that was never actually audible.

**Architecture:** Three small, independent pieces. (1) `envelope.ts`'s `envelopeCurveD` switches
from a cubic-Bezier path to a straight-line path — pure rendering math, no state changes. (2)
`buildAlsXml.ts`'s `buildStemClips` gains `volume`/`fadeInBars`/`fadeOutBars`/`sampleRate`
parameters and writes them into the generated clip's `SampleVolume`/`Fade`/`FadeInLength`/
`FadeOutLength` fields — fade only on a stem's first (fade-in) and last (fade-out) audible
segment. (3) `exportAbleton.ts` reads each materialized stem's real sample rate (needed for the
fade-length unit conversion) and threads it through.

**Tech Stack:** TypeScript, Vitest, the existing `fast-xml-parser`-based `.als` helpers in
`alsXmlHelpers.ts`.

---

## Design reference

Full rationale: `docs/superpowers/specs/2026-08-11-ableton-volume-fade-export-design.md`
(approved by Elling — "great! go for it!"). This plan implements it exactly, including its
explicitly-flagged open question (see Task 3).

## A note on the open question

`FadeInLength`/`FadeOutLength`'s real unit has **not** been verified against actual Ableton (no
Ableton available in this environment). Task 3 implements against the working hypothesis
documented in the design doc (an absolute sample count at the source file's own sample rate) and
isolates that conversion in one small function so it's a one-line fix if the hypothesis turns out
wrong. Task 5 is where Elling verifies it for real.

---

### Task 1: Straighten the on-screen fade curve

**Files:**
- Modify: `src/renderer/src/components/envelope.ts:41-59`
- Create: `src/renderer/src/components/envelope.test.ts`

`envelopeCurveD` currently builds a cubic-Bezier `C...C...` path for the fade shape. The real
audio (`native-engine/Source/FadeGain.cpp`) has always been a plain linear ramp — this makes the
picture match it.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/envelope.test.ts`:

```ts
// src/renderer/src/components/envelope.test.ts
import { describe, it, expect } from 'vitest'
import { envelopeCurveD, envelopeKnees } from './envelope'

describe('envelopeCurveD', () => {
  it('builds a straight-line path (no curve commands) through the envelope knees', () => {
    const width = 200
    const height = 40
    const fadeInPx = 30
    const fadeOutPx = 20
    const plateauY = 10

    const d = envelopeCurveD(width, height, fadeInPx, fadeOutPx, plateauY)

    const { fiEnd, foStart } = envelopeKnees(width, fadeInPx, fadeOutPx)
    expect(d).toBe(
      `M0,${height} L${fiEnd},${plateauY} L${foStart},${plateauY} L${width},${height}`
    )
    expect(d).not.toContain('C') // no Bezier curve commands
  })

  it('collapses to a single straight line across the full width when there is no fade', () => {
    const d = envelopeCurveD(100, 40, 0, 0, 10)
    const { fiEnd, foStart } = envelopeKnees(100, 0, 0)
    expect(d).toBe(`M0,40 L${fiEnd},10 L${foStart},10 L100,40`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/envelope.test.ts`
Expected: FAIL — the current implementation produces a `C...C...` path, not the plain `L...L...L`
path the test expects.

- [ ] **Step 3: Write the minimal implementation**

In `src/renderer/src/components/envelope.ts`, replace `envelopeCurveD` (lines 41-59):

Current:

```ts
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
```

Replace with:

```ts
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
```

Only the JSDoc comment and body change — the function signature is unchanged, so
`buildEnvelopePath`/`combinedClipPath` (which call it) need no changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/envelope.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/envelope.ts src/renderer/src/components/envelope.test.ts
git commit -m "Straighten the on-screen fade curve to match the real linear audio"
```

---

### Task 2: Export volume — `SampleVolume`

**Files:**
- Modify: `src/main/ableton/buildAlsXml.ts:334-442` (`buildStemClips`), `:627-648` (call site)
- Test: `src/main/ableton/buildAlsXml.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/ableton/buildAlsXml.test.ts`, inside the top-level `describe('buildAlsXml', ...)`
block (anywhere after the existing tests — e.g. right before the `describe('bus clustering', ...)`
block):

```ts
  describe('volume export', () => {
    it("writes the stem's volume into the clip's SampleVolume", () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        vol: { 'rifff-1:0': 0.62 }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('0.62')
    })

    it('leaves SampleVolume at the template default (1) when no volume override is set', () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('1')
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts -t "volume export"`
Expected: FAIL — the first case fails (`SampleVolume` stays at the template's `1`, not `0.62`);
the second case already passes coincidentally (template default is already `1`), but run both to
confirm the first genuinely fails before implementing.

- [ ] **Step 3: Write the minimal implementation**

In `src/main/ableton/buildAlsXml.ts`, add a `volume: number` parameter to `buildStemClips`'s
signature (line 334-346):

Current:

```ts
function buildStemClips(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions'],
  colorIndex: number
): StemClipsResult {
```

Replace with:

```ts
function buildStemClips(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions'],
  colorIndex: number,
  volume: number
): StemClipsResult {
```

Then, inside the `audibleSegments.map((segment) => {...})` body (line 373 onward), right after the
existing `setColor(clipBody, colorIndex)` line (line 413), add:

```ts
    setAttr(findChild(clipBody, 'SampleVolume')!, '@_Value', String(volume))
```

Finally, at the call site (`buildAlsXml`, lines 636-648), pass the stem's volume — reading
`state.vol[key]` the same way `buildEngineProject.ts:198` already does for the wire format
(`state.dragVol[key] ?? state.vol[key] ?? 1` — `buildAlsXml` has no drag-preview concept, so just
the committed value with the same `?? 1` fallback):

Current:

```ts
      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        ABLETON_BUS_COLORS[busId]
      )
```

Replace with:

```ts
      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        ABLETON_BUS_COLORS[busId],
        state.vol[key] ?? 1
      )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts -t "volume export"`
Expected: PASS (2/2)

- [ ] **Step 5: Run the FULL buildAlsXml test suite to confirm no regressions**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: PASS, same total count as before this task plus the 2 new cases — the new `volume`
parameter is additive and every existing test's `emptyAppState()` fixture has `vol: {}`, which
falls back to the unchanged default of `1`.

- [ ] **Step 6: Commit**

```bash
git add src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts
git commit -m "Write stem volume into the Ableton export's SampleVolume"
```

---

### Task 3: Export fade — `Fade`/`FadeInLength`/`FadeOutLength`

**Files:**
- Modify: `src/main/ableton/buildAlsXml.ts`
- Test: `src/main/ableton/buildAlsXml.test.ts`

Implements against the design doc's explicitly-flagged, **unverified** hypothesis: `FadeInLength`/
`FadeOutLength` are an absolute sample count at the stem's own source file sample rate (unlike
every other timing field on this same clip, which are in arrangement beats). See Task 5 for the
real verification step.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/ableton/buildAlsXml.test.ts`, inside the `describe('volume export', ...)` block
added in Task 2 — rename that block to `describe('volume/fade export', ...)` and add these three
cases alongside the two from Task 2:

```ts
    it('writes Fade + FadeInLength on the (only) segment when fadeInBars is set, as a sample count at the given sample rate', () => {
      const rifff = drumsRifff() // bpm irrelevant here -- project bpm (120, from emptyAppState) drives the conversion
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        fadeIn: { 'rifff-1': 0.5 } // 0.5 bar at 120bpm = 1 beat = 0.5s
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const stemSampleRates = new Map([['rifff-1:0', 48000]])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames, stemSampleRates)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'Fade')!)['@_Value']).toBe('true')
      const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
      expect(attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value']).toBe('24000') // 0.5s * 48000
      expect(attrs(findChild(fadesBody, 'FadeOutLength')!)['@_Value']).toBe('0')
    })

    it('leaves Fade/FadeInLength/FadeOutLength at template defaults when no fade or sample rate is set', () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'Fade')!)['@_Value']).toBe('false')
      const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
      expect(attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value']).toBe('0')
      expect(attrs(findChild(fadesBody, 'FadeOutLength')!)['@_Value']).toBe('0')
    })

    it('writes fade-in only on the FIRST audible segment and fade-out only on the LAST, when muted regions split a stem into 3 segments', () => {
      const rifff = drumsRifff() // startBar: 8, barLength: 4, stem barLength: 4
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        playedBars: { 'rifff-1': 8 }, // clip spans [8,16) bars = beats [32,64)
        muteRegions: {
          'rifff-1:0': [
            { startBar: 9, endBar: 10 }, // beats [36,40)
            { startBar: 12, endBar: 13 } // beats [48,52)
          ]
        }, // 3 audible segments: [8,9) [10,12) [13,16) bars
        fadeIn: { 'rifff-1': 1 },
        fadeOut: { 'rifff-1': 1 }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const stemSampleRates = new Map([['rifff-1:0', 48000]])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames, stemSampleRates)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const body = childArray(audioTrack, 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
      expect(clips).toHaveLength(3)

      function fadeLengths(clip: AlsNode): { fadeOn: string; fadeIn: string; fadeOut: string } {
        const clipBody = childArray(clip, 'AudioClip')
        const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
        return {
          fadeOn: attrs(findChild(clipBody, 'Fade')!)['@_Value'],
          fadeIn: attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value'],
          fadeOut: attrs(findChild(fadesBody, 'FadeOutLength')!)['@_Value']
        }
      }

      const first = fadeLengths(clips[0])
      expect(first.fadeOn).toBe('true')
      expect(first.fadeIn).toBe('48000') // 1 bar at 120bpm = 2s * 48000
      expect(first.fadeOut).toBe('0')

      const middle = fadeLengths(clips[1])
      expect(middle.fadeOn).toBe('false')
      expect(middle.fadeIn).toBe('0')
      expect(middle.fadeOut).toBe('0')

      const last = fadeLengths(clips[2])
      expect(last.fadeOn).toBe('true')
      expect(last.fadeIn).toBe('0')
      expect(last.fadeOut).toBe('48000')
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts -t "volume/fade export"`
Expected: FAIL on all 3 new cases — `buildAlsXml` doesn't accept a 5th `stemSampleRates` argument
yet (TypeScript will actually fail to compile these calls once you save the file; that compile
failure IS the "test fails" signal here), and no fade fields are written regardless.

- [ ] **Step 3: Write the minimal implementation**

In `src/main/ableton/buildAlsXml.ts`, add a `secPerBarFor` helper and the (explicitly-flagged
hypothesis) fade-length conversion function. Add these near the top of the file, after the
existing `WARP_MODE_BEATS`/`WARP_MODE_COMPLEX_PRO` constants (around line 29):

```ts
const PROJECT_BEATS_PER_BAR = 4

function secPerBarFor(projectBpm: number): number {
  return projectBpm > 0 ? (60 / projectBpm) * PROJECT_BEATS_PER_BAR : 0
}

// HYPOTHESIS, not verified against real Ableton (no Ableton available in
// the environment this was written in) -- see docs/superpowers/specs/
// 2026-08-11-ableton-volume-fade-export-design.md's "Real open question"
// section. Every OTHER timing field this file writes into a clip
// (CurrentStart/CurrentEnd/Time/WarpMarker BeatTime) is in arrangement
// beats, but FadeInLength/FadeOutLength are assumed here to be a
// different unit convention entirely -- an absolute sample count at the
// STEM'S OWN SOURCE FILE sample rate, a known Ableton .als XML quirk. If
// this turns out wrong, fix is confined to this one function.
function fadeBarsToSampleCount(fadeBars: number, projectBpm: number, sampleRate: number): number {
  return Math.round(fadeBars * secPerBarFor(projectBpm) * sampleRate)
}

/** Writes Fade/FadeInLength (or FadeOutLength) onto a clip, only when
 * there's an actual fade to write (fadeBars > 0) and a sample rate is
 * known to convert it with -- otherwise the template's own defaults
 * (Fade=false, length=0) are left untouched, which is exactly correct: no
 * fade. See fadeBarsToSampleCount's own doc comment for the unit caveat. */
function applyFade(
  clipBody: AlsNode[],
  fadeBars: number,
  projectBpm: number,
  sampleRate: number | undefined,
  field: 'FadeInLength' | 'FadeOutLength'
): void {
  if (fadeBars <= 0 || sampleRate === undefined) return
  setAttr(findChild(clipBody, 'Fade')!, '@_Value', 'true')
  const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
  setAttr(
    findChild(fadesBody, field)!,
    '@_Value',
    String(fadeBarsToSampleCount(fadeBars, projectBpm, sampleRate))
  )
}
```

Add `fadeInBars: number`, `fadeOutBars: number`, and `sampleRate: number | undefined` parameters
to `buildStemClips`'s signature (continuing from Task 2's edit):

```ts
function buildStemClips(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions'],
  colorIndex: number,
  volume: number,
  fadeInBars: number,
  fadeOutBars: number,
  sampleRate: number | undefined
): StemClipsResult {
```

Change the `audibleSegments.map((segment) => {...})` call (line 373) to also receive the segment's
index, so the first/last segment can be identified:

Current:

```ts
  const clips = audibleSegments.map((segment) => {
```

Replace with:

```ts
  const clips = audibleSegments.map((segment, segmentIndex) => {
```

Then, right after the `setAttr(findChild(clipBody, 'SampleVolume')!, '@_Value', String(volume))`
line added in Task 2, add:

```ts
    if (segmentIndex === 0) {
      applyFade(clipBody, fadeInBars, projectBpm, sampleRate, 'FadeInLength')
    }
    if (segmentIndex === audibleSegments.length - 1) {
      applyFade(clipBody, fadeOutBars, projectBpm, sampleRate, 'FadeOutLength')
    }
```

(When there's only one segment, both branches run on it — correct: a stem with no mute gaps gets
both its fade-in and fade-out on its single clip.)

Finally, update `buildAlsXml`'s exported signature to accept an optional sample-rate map, and
thread the per-stem fade/sample-rate values through the call site. Current signature (lines
570-575):

```ts
export function buildAlsXml(
  templateXml: string,
  state: AppState,
  outputDir: string,
  stemFileNames: Map<string, string>
): string {
```

Replace with:

```ts
export function buildAlsXml(
  templateXml: string,
  state: AppState,
  outputDir: string,
  stemFileNames: Map<string, string>,
  stemSampleRates: Map<string, number> = new Map()
): string {
```

And the call site (from Task 2's edit, lines 636-649 after that edit):

```ts
      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        ABLETON_BUS_COLORS[busId],
        state.vol[key] ?? 1
      )
```

Replace with:

```ts
      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        ABLETON_BUS_COLORS[busId],
        state.vol[key] ?? 1,
        state.fadeIn[rifff.groupId] ?? 0,
        state.fadeOut[rifff.groupId] ?? 0,
        stemSampleRates.get(key)
      )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts -t "volume/fade export"`
Expected: PASS (5/5 — the 2 from Task 2 plus the 3 new ones)

- [ ] **Step 5: Run the FULL buildAlsXml test suite to confirm no regressions**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: PASS, same total as before plus the 3 new cases — every pre-existing test calls
`buildAlsXml` with 4 arguments (no `stemSampleRates`), which defaults to an empty `Map`, so
`sampleRate` is `undefined` for every stem in those tests and `applyFade` is a no-op — behavior
unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts
git commit -m "Write stem fade-in/fade-out into the Ableton export's Fade fields"
```

---

### Task 4: Thread real per-stem sample rates from `exportAbleton.ts`

**Files:**
- Modify: `src/main/exportAbleton.ts`

`buildAlsXml` needs each stem's real sample rate to convert `fadeInBars`/`fadeOutBars` into the
sample-count unit Task 3 writes. The safest source is the stem's own **already-materialized
destination file** (`destPath`, in the export's own `Samples/Imported/` folder) — reading it there
guarantees the sample rate matches whatever `materializeStem` actually produced (which could in
principle differ from the original source, if it ever transcodes), not just what the untouched
source file happened to be.

- [ ] **Step 1: Add the needed imports**

In `src/main/exportAbleton.ts`, find the existing import block (starts at line 1) and add two new
imports — `readWavHeaderBytes` (already used elsewhere in this codebase for stem import) and
`findWavChunks` (the existing low-level WAV-chunk parser that already extracts `sampleRate`):

```ts
import { readWavHeaderBytes } from './importRifff'
import { findWavChunks } from '@shared/wavChunks'
```

- [ ] **Step 2: Compute `stemSampleRates` after the materialize loop**

Find the existing materialize loop and the `buildAlsXml` call immediately after it:

```ts
  try {
    for (const { key, path, destPath } of stemEntries) {
      try {
        const ok = await materializeStem(path, destPath, client)
        if (!ok) stemFileNames.delete(key)
      } catch (err) {
        stemFileNames.delete(key)
        console.error(`buildAndWriteAlsProject: failed to materialize stem from ${path}:`, err)
      }
    }
  } finally {
    client?.disconnect()
    engineHandle?.stop()
  }

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames)
```

Replace with:

```ts
  try {
    for (const { key, path, destPath } of stemEntries) {
      try {
        const ok = await materializeStem(path, destPath, client)
        if (!ok) stemFileNames.delete(key)
      } catch (err) {
        stemFileNames.delete(key)
        console.error(`buildAndWriteAlsProject: failed to materialize stem from ${path}:`, err)
      }
    }
  } finally {
    client?.disconnect()
    engineHandle?.stop()
  }

  // Read each successfully-materialized stem's real sample rate from its
  // ACTUAL destination file (not the original source) -- needed to convert
  // fadeInBars/fadeOutBars into buildAlsXml's fade-length unit (see that
  // function's own fadeBarsToSampleCount doc comment for the unverified
  // hypothesis this depends on). Iterating stemFileNames here (not
  // stemEntries) naturally skips any stem whose materialize failed above
  // (deleted from the map already) -- no separate failure tracking needed.
  const stemSampleRates = new Map<string, number>()
  for (const [key, fileName] of stemFileNames) {
    try {
      const destPath = join(samplesDir, fileName)
      const { sampleRate } = findWavChunks(readWavHeaderBytes(destPath))
      if (sampleRate > 0) stemSampleRates.set(key, sampleRate)
    } catch (err) {
      console.error(`buildAndWriteAlsProject: failed to read sample rate for ${fileName}:`, err)
    }
  }

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames, stemSampleRates)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the new imports resolve, `buildAlsXml`'s 5th argument type-checks against
the updated signature from Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/main/exportAbleton.ts
git commit -m "Read real per-stem sample rates for the Ableton fade-length export"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every new/modified case from Tasks 1-3.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (pre-existing warnings, if any, are fine — see this repo's own established
baseline).

- [ ] **Step 4: Manual verification — the real open question**

This is the one thing genuinely impossible to verify without hands on real Ableton (consistent
with this project's own testing conventions — see root `CLAUDE.md`'s "React components" and
manual-walkthrough precedents elsewhere in this codebase). Elling:

1. Opens sssketch, places a rifff with a non-default volume and a real fade-in/fade-out (drag the
   fade handles on a stem in the arranger), exports to Ableton.
2. Opens the exported `.als` in real Ableton.
3. Confirms the clip's volume slider reflects the sssketch volume.
4. Confirms the fade handles appear at the correct on-screen length for the known `fadeInBars`
   value at the project's bpm, and that the fade sounds/looks right.
5. If the fade LENGTH is wrong but everything else is right, the bug is confined to
   `fadeBarsToSampleCount` in `buildAlsXml.ts` (Task 3) — report back what the real unit turns out
   to be (e.g. "no scaling needed, it really is beats" or "it's samples but at a fixed 44100
   regardless of the source file") so it can be fixed in one place.

- [ ] **Step 5: Report the real outcome**

Summarize plainly: which of Steps 1-4 passed, and if Step 4 surfaced a wrong unit, what the
correct one turned out to be (for a follow-up fix, not blocking this plan's own completion — the
structural pieces, code organization, and the two straightforward field mappings volume/Fade
enable are all correct regardless of the length's exact scale).

---

## Self-review notes

- **Spec coverage:** all three design sections have a task — straightened curve (Task 1),
  `SampleVolume` mapping (Task 2), `Fade`/`FadeInLength`/`FadeOutLength` mapping with first/last-
  segment-only gating (Task 3) — plus the design's own required real-world verification step
  (Task 5) and the supporting plumbing it depends on (Task 4).
- **Type consistency:** `buildStemClips`'s parameter list is threaded consistently across Tasks
  2-3 (`volume` added in Task 2, `fadeInBars`/`fadeOutBars`/`sampleRate` added in Task 3, in that
  order, matching the final call site in Task 3's Step 3) — verified by re-reading both edits
  together rather than in isolation.
- **No placeholders:** every step has complete, real code — including the exact expected numeric
  values in each new test (e.g. `24000`, `48000`), derived from the actual bpm/sample-rate math
  the implementation performs, not asserted vaguely.
