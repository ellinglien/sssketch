# Tiled Clip Left-Handle Crop Trim (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flawed, already-committed `offsetSteps`-shifting `RESIZE_LEFT` implementation
with a new `leftCropBars` field, symmetric to how `playedBars` already works for the right edge —
so a tiled clip's left resize handle visually crops the box (matching a Final Cut-style trim)
while the underlying loop's phase anchor (`startBar`/`offsetSteps`) never moves and audio content
keeps playing continuously.

**Architecture:** New per-group renderer state `leftCrop: Record<string, number>` (mirrors
`playedBars`'s shape). The visible/audible window becomes `[startBar + leftCropBars, startBar +
playedBars)`. Rendering (`clipGeometryFromFields`) and the waveform's own tile positions both
need to account for the crop; the native engine's wire format gains a matching
`EngineStem.leftCropBars`, and `PlaybackEngine.cpp`'s tile loop gains symmetric left-edge
clipping (today it only clips the last tile against `playedBars`; this adds the same treatment
for the first tile, including reading from the correct offset into the stem's own source buffer
when a tile starts mid-loop) and support for negative tile indices (extending left reveals tiles
*before* the original anchor). `RenderExport.cpp` shares the exact same `renderBlock` function
the live playback path uses, so this one native fix covers live playback and offline export
together — no separate change needed there.

**Tech Stack:** TypeScript (renderer state/rendering), C++ (native engine, JUCE), Vitest +
JUCE `UnitTestRunner` for tests.

---

### Task 1: Renderer state — `leftCrop` replaces `RESIZE_LEFT`'s `offsetSteps`

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Add the `leftCrop` field to `AppState`**

In `src/renderer/src/state/store.ts`, add this field to the `AppState` interface, right after
the existing `playedBars` field (around line 61):

```ts
  /** Bars cropped from a tiled clip's own LEFT edge, keyed by groupId. Default
   * 0 (no crop). Together with playedBars, defines the visible/audible
   * window as [startBar + leftCropBars, startBar + playedBars) -- startBar
   * and offsetSteps never move for a resize; cropping is purely a windowing
   * operation over a loop whose own phase anchor stays fixed. See
   * docs/superpowers/specs/2026-08-04-tiled-clip-crop-trim-design.md. */
  leftCrop: Record<string, number>
```

And add `leftCrop: {},` to `initialState`, right after the existing `playedBars: {},` line
(around line 160).

- [ ] **Step 2: Replace the `RESIZE_LEFT` action with `SET_LEFT_CROP_BARS`**

Replace this line (around line 199):

```ts
  | { type: 'RESIZE_LEFT'; groupId: string; bars: number; startBar: number; offsetSteps: number }
```

with:

```ts
  | { type: 'SET_LEFT_CROP_BARS'; groupId: string; bars: number }
```

- [ ] **Step 3: Update `store.test.ts`'s tests**

Replace the entire `describe('RESIZE_LEFT', ...)` block (currently around lines 544-593) with:

```ts
  describe('SET_LEFT_CROP_BARS', () => {
    it('sets leftCrop for the given group', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'SET_LEFT_CROP_BARS', groupId: 'r1', bars: 2 })
      expect(state.leftCrop.r1).toBe(2)
    })

    it('does not touch startBar or offsetSteps -- the whole point of this action', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: 5 })
      state = reducer(state, { type: 'SET_LEFT_CROP_BARS', groupId: 'r1', bars: 2 })
      expect(state.rifffs.r1.startBar).toBe(6)
      expect(state.off.r1).toBe(5)
    })

    it('allows a negative value (extending left, revealing the loop before its original start)', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'SET_LEFT_CROP_BARS', groupId: 'r1', bars: -3 })
      expect(state.leftCrop.r1).toBe(-3)
    })
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t SET_LEFT_CROP_BARS`
Expected: FAIL — `SET_LEFT_CROP_BARS` isn't a handled action yet (the reducer's default case
returns `state` unchanged, so `state.leftCrop.r1` is `undefined`, not `2`).

- [ ] **Step 5: Replace the `RESIZE_LEFT` reducer case**

Replace the entire `RESIZE_LEFT` case (currently around lines 407-433, including its own
now-stale doc comment) with:

```ts
    // Dragging the LEFT resize handle -- unlike the old RESIZE_LEFT this
    // replaces, this never touches startBar or offsetSteps. Cropping is
    // purely a windowing operation: [startBar + leftCropBars, startBar +
    // playedBars) is the visible/audible window, and neither endpoint of
    // that window's own ANCHOR (startBar, offsetSteps) moves -- only how
    // much of the loop is windowed away from the left. See
    // docs/superpowers/specs/2026-08-04-tiled-clip-crop-trim-design.md.
    case 'SET_LEFT_CROP_BARS':
      return {
        ...state,
        leftCrop: { ...state.leftCrop, [action.groupId]: action.bars }
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t SET_LEFT_CROP_BARS`
Expected: PASS (3 tests)

- [ ] **Step 7: Confirm nothing else references the old `RESIZE_LEFT` action yet**

Run: `npx tsc --noEmit -p tsconfig.web.json --composite false 2>&1 | grep RESIZE_LEFT`
Expected: two errors, in `StemWaveformRow.tsx` and `CollapsedRifffRow.tsx` (their own
`dispatch({ type: 'RESIZE_LEFT', ... })` calls no longer match any action in the union) — this
is expected and fixed in Tasks 3 and 4, not this one. Don't fix them here.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Replace RESIZE_LEFT's offsetSteps shift with a dedicated leftCropBars field"
```

---

### Task 2: Rendering — `clipGeometryFromFields` and a shared tile-offset helper

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Modify: `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Write the failing tests for `clipGeometryFromFields`'s new `leftCropBars` field**

In `src/renderer/src/state/selectors.test.ts`, update all 4 existing `clipGeometryFromFields`
calls (in the `describe('clipGeometryFromFields', ...)` block, currently lines 66-128) to add
`leftCropBars: 0` to each call's options object (right after `playedBarsOverride`), and add 2
new tests to that same `describe` block:

```ts
  it('shrinks the width and shifts leftPx right when cropped from the left', () => {
    // leftCropBars=2 at ppb=24: leftPx shifts by +2*24=48, width shrinks by
    // the same 2 bars' worth of pixels.
    const bars = clipGeometryFromFields({
      startBar: 4,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: 2,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars.leftPx).toBe(96 + 48) // (4+2)*24
    expect(bars.widthPx).toBe((8 - 2) * 24)
  })

  it('extends the width and shifts leftPx left when leftCropBars is negative', () => {
    const bars = clipGeometryFromFields({
      startBar: 4,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: -1,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars.leftPx).toBe(96 - 24) // (4-1)*24
    expect(bars.widthPx).toBe((8 + 1) * 24)
  })
```

Then find each of the 4 pre-existing calls in that `describe` block and add `leftCropBars: 0,`
to each one's options (right after the `playedBarsOverride` line in each).

- [ ] **Step 2: Write the failing tests for the new `tileOffsetsPx` helper**

Add a new `describe` block to `src/renderer/src/state/selectors.test.ts`, right after the
`clipGeometryFromFields` block:

```ts
describe('tileOffsetsPx', () => {
  it('tiles from pixel 0 when there is no crop', () => {
    // 2 bars played, 1-bar stem, ppb=24 -> tileWidthPx=24, 2 tiles at [0, 24]
    expect(tileOffsetsPx(48, 1, 2, 0)).toEqual([0, 24])
  })

  it('shifts every tile left by the wrapped crop amount, so the correct mid-loop content lands at pixel 0', () => {
    // 1-bar stem, cropped 0.5 bars from the left, played to 2 bars total,
    // width = (2-0.5)*24 = 36. tileWidthPx = 36 * (1/1.5) = 24. Each tile
    // shifts left by 0.5 bars' worth of pixels: 0.5*24 = 12.
    expect(tileOffsetsPx(36, 1, 2, 0.5)).toEqual([-12, 12, 36])
  })

  it('wraps a crop amount larger than one stem bar into [0, stemBarLength)', () => {
    // leftCropBars=2.5 with a 1-bar stem wraps to 0.5 bars of phase shift --
    // same shift as the test above, despite a much larger raw crop amount.
    // playedBars=4.0 keeps visibleBars (4.0-2.5=1.5) and therefore
    // tileWidthPx identical to the test above, so the expected output is
    // the exact same array -- isolating "wrapping" as the only thing this
    // test is actually checking.
    expect(tileOffsetsPx(36, 1, 4.0, 2.5)).toEqual([-12, 12, 36])
  })

  it('wraps a negative crop amount into [0, stemBarLength) the same way', () => {
    // leftCropBars=-0.5 wraps to 0.5 bars too ((-0.5 % 1) + 1) % 1 = 0.5).
    // playedBars=1.0 again keeps visibleBars (1.0-(-0.5)=1.5) matching the
    // first test's own 1.5, for the same reason as above.
    expect(tileOffsetsPx(36, 1, 1.0, -0.5)).toEqual([-12, 12, 36])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: FAIL — `leftCropBars` isn't a recognized field on `ClipGeometryFields` yet (TypeScript
compile error surfaces as a vitest transform failure), and `tileOffsetsPx` doesn't exist yet.

- [ ] **Step 4: Implement — add `leftCropBars` to `clipGeometryFromFields`**

In `src/renderer/src/state/selectors.ts`, update `ClipGeometryFields` (currently lines 165-175)
by adding a new field right after `playedBarsOverride`:

```ts
export interface ClipGeometryFields {
  startBar: number
  offsetSteps: number
  snapDiv: number
  playedBarsOverride: number | undefined
  /** Bars cropped from this clip's own left edge -- see leftCrop's own doc
   * comment on AppState (store.ts). 0 = no crop, the default for every
   * clip that's never had its left handle dragged. */
  leftCropBars: number
  rifffBarLength: number
  stretchOn: boolean
  rifffBpm: number
  stateBpm: number
  ppb: number
}
```

Then replace `clipGeometryFromFields`'s body (currently lines 182-198):

```ts
export function clipGeometryFromFields(fields: ClipGeometryFields): ClipGeometry {
  const {
    startBar,
    offsetSteps,
    snapDiv,
    playedBarsOverride,
    rifffBarLength,
    stretchOn,
    rifffBpm,
    stateBpm,
    ppb
  } = fields
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifffBarLength)
  const shownBars = stretchOn ? playedBars : playedBars * (rifffBpm / stateBpm)
  return { leftPx: startBar * ppb + offsetPx, widthPx: shownBars * ppb }
}
```

with:

```ts
export function clipGeometryFromFields(fields: ClipGeometryFields): ClipGeometry {
  const {
    startBar,
    offsetSteps,
    snapDiv,
    playedBarsOverride,
    leftCropBars,
    rifffBarLength,
    stretchOn,
    rifffBpm,
    stateBpm,
    ppb
  } = fields
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifffBarLength)
  const visibleBars = playedBars - leftCropBars
  const shownBars = stretchOn ? visibleBars : visibleBars * (rifffBpm / stateBpm)
  return {
    leftPx: (startBar + leftCropBars) * ppb + offsetPx,
    widthPx: shownBars * ppb
  }
}
```

- [ ] **Step 5: Implement — add `leftCropBars` to `clipGeometry`'s own call**

In the same file, update `clipGeometry` (currently lines 206-223) to read and pass the new
field:

```ts
export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const stretchOn = state.stretch[groupId] ?? true
  return clipGeometryFromFields({
    startBar: start,
    offsetSteps,
    snapDiv,
    playedBarsOverride: state.playedBars[groupId],
    leftCropBars: state.leftCrop[groupId] ?? 0,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: state.bpm,
    ppb
  })
}
```

- [ ] **Step 6: Implement `tileOffsetsPx`**

Add this new exported function to `src/renderer/src/state/selectors.ts`, right after
`clipGeometry`:

```ts
/** Pixel offsets for each repeat of a tiled clip's waveform image, shared by
 * StemWaveformRow.tsx (expanded view) and CollapsedRifffRow.tsx's own
 * CollapsedTiles (collapsed view) -- both previously duplicated this exact
 * formula. Extracted here (like clipGeometryFromFields already was) both for
 * testability and to fix the two independent copies with one change.
 *
 * A tile's own image always starts at its stem's sample 0 -- normally fine,
 * since tile 0 is drawn at the container's own left edge, which is exactly
 * where the stem's own audio starts too. But once leftCropBars != 0, the
 * container's left edge no longer sits at the stem's sample-0 point (it
 * sits leftCropBars bars into the stem's own repeating pattern instead) --
 * every tile needs to shift left by that same wrapped amount so the
 * CORRECT mid-loop content lands at the container's own pixel 0, matching
 * what actually plays (see PlaybackEngine.cpp's own analogous
 * sourceOffsetSec fix). Wrapped into [0, stemBarLength) first since a
 * crop amount doesn't need to exceed one stem-bar-length of phase shift --
 * shifting by a whole multiple of stemBarLength doesn't change which
 * content shows (every tile is identical content already).
 *
 * widthPx here is the ALREADY-CROPPED visible width (i.e. clipGeometry's
 * own widthPx) -- not the full uncropped playedBars width. */
export function tileOffsetsPx(
  widthPx: number,
  stemBarLength: number,
  playedBars: number,
  leftCropBars: number
): number[] {
  const visibleBars = playedBars - leftCropBars
  const tileWidthPx = widthPx * (stemBarLength / visibleBars)
  const wrappedLeftCropBars =
    ((leftCropBars % stemBarLength) + stemBarLength) % stemBarLength
  const phaseShiftPx = wrappedLeftCropBars * (tileWidthPx / stemBarLength)
  // +1 over the naive ceil, but only when tiles are actually shifted:
  // shifting every tile left by phaseShiftPx can leave a gap at the
  // container's own right edge that an extra tile is needed to cover.
  // Conditional (not unconditional) so the overwhelmingly common
  // leftCropBars=0 case keeps rendering exactly the same tile count as
  // before this feature existed, instead of one permanently-harmless-but-
  // unnecessary extra tile on every clip that's never had its left edge
  // touched.
  const tileCount = Math.max(
    1,
    Math.ceil(widthPx / tileWidthPx) + (phaseShiftPx > 0 ? 1 : 0)
  )
  return Array.from({ length: tileCount }, (_, i) => i * tileWidthPx - phaseShiftPx)
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Add leftCropBars to clip geometry and extract a shared tileOffsetsPx helper"
```

---

### Task 3: `StemWaveformRow.tsx` — drag handler and tiled waveform

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Update imports**

Add `tileOffsetsPx` to the existing import from `../state/selectors` (currently line 7):

```ts
import { clipGeometryFromFields, resolvedPlayedBarsFromFields, tileOffsetsPx } from '../state/selectors'
```

- [ ] **Step 2: Read the committed `leftCrop` value and thread it into `clipGeometryFromFields`**

Add this line right after the existing `const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)` (currently line 53):

```ts
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
```

Then update the `stemGeo` call (currently lines 93-103) to add `leftCropBars` (after
`playedBarsOverride`, before `rifffBarLength`, matching the field's position in
`ClipGeometryFields`):

```ts
  const stemGeo = clipGeometryFromFields({
    startBar: rifff.startBar ?? 0,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride,
    leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb
  })
```

- [ ] **Step 3: Replace the `dragLeftResize` preview state and `handleLeftResizeStart`**

Replace the existing `dragLeftResize` state declaration (currently lines 62-65):

```ts
  const [dragLeftResize, setDragLeftResize] = useState<{
    playedBars: number
    startBar: number
  } | null>(null)
```

with:

```ts
  const [dragLeftCropBars, setDragLeftCropBars] = useState<number | null>(null)
```

Replace the geometry/preview block (currently lines 104-118 — everything from
`const baseStartBar = ...` through the `widthPx` ternary) with:

```ts
  const baseStartBar = rifff.startBar ?? 0
  const displayedLeftCropBars = dragLeftCropBars ?? leftCropBars
  // Live preview during a left-edge drag uses the EXACT SAME formula real
  // (committed) rendering uses -- unlike the old startBar-based preview this
  // replaces, there's no separate reconciliation needed, since neither
  // startBar nor offsetSteps ever moves for this drag anymore.
  const previewGeo =
    dragLeftCropBars !== null
      ? clipGeometryFromFields({
          startBar: baseStartBar,
          offsetSteps,
          snapDiv: SNAP_DIVS[snapIdx],
          playedBarsOverride,
          leftCropBars: dragLeftCropBars,
          rifffBarLength: rifff.barLength,
          stretchOn,
          rifffBpm: rifff.bpm,
          stateBpm: bpm,
          ppb
        })
      : stemGeo
  const leftPx = previewGeo.leftPx
  // While actively dragging, use the in-progress width instead of the
  // committed-state one, so the row visibly resizes in real time.
  const widthPx = dragPlayedBars !== null ? dragPlayedBars * ppb : previewGeo.widthPx
```

(`nudgeOffsetPx`/`displayedStartBar` are gone entirely -- they existed only to fake a
startBar-based preview, which this no longer needs.)

- [ ] **Step 4: Update `displayedPlayedBars` and the tile computation to use `tileOffsetsPx`**

Replace the existing `displayedPlayedBars` line (currently line 88):

```ts
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
```

with:

```ts
  const displayedPlayedBars = dragPlayedBars ?? resolvedPlayedBars
```

Replace the existing tile computation block (currently lines 120-130 — the comment plus
`tileWidthPx`/`tileCount`/`tileOffsets`):

```ts
  const tileWidthPx = widthPx * (stem.barLength / displayedPlayedBars)
  const tileCount = Math.max(1, Math.ceil(displayedPlayedBars / stem.barLength))
  const tileOffsets = Array.from({ length: tileCount }, (_, i) => i * tileWidthPx)
```

with:

```ts
  // The native engine always loops a stem from its own beginning every
  // stem.barLength bars -- playedBars beyond that adds more repeats (or
  // truncates the last one), it never slows the audio down. One stretched
  // Waveform image would visually read as "slowed down," which contradicts
  // that -- so the waveform is tiled instead. tileOffsetsPx also accounts
  // for displayedLeftCropBars, shifting every tile so the correct mid-loop
  // content lines up with what's actually audible (see its own doc comment).
  const tileOffsets = tileOffsetsPx(widthPx, stem.barLength, displayedPlayedBars, displayedLeftCropBars)
  const tileWidthPx = widthPx * (stem.barLength / (displayedPlayedBars - displayedLeftCropBars))
```

- [ ] **Step 5: Replace `handleLeftResizeStart`**

Replace the whole function (currently lines 179-227):

```ts
  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    const startOffsetSteps = offsetSteps
    let finalPlayedBars = startPlayedBars
    let finalStartBar = startPosBar
    let finalOffsetSteps = startOffsetSteps
    startPointerDrag(
      e,
      (deltaX) => {
        // Dragging left (negative deltaX) extends the loop backward:
        // playedBars grows and the start moves earlier by the same amount,
        // so the RIGHT edge — where the loop currently ends — stays exactly
        // in place. Snapped to whole bars, same as the right handle. The two
        // clamps below can never conflict: the floor is always <= 0
        // (MIN_PLAYED_BARS is always <= startPlayedBars already, since every
        // committed playedBars value is already clamped to that floor) and
        // startPosBar is always >= 0.
        const requestedGrow = -Math.round(deltaX / ppb)
        const grow = Math.max(
          MIN_PLAYED_BARS - startPlayedBars,
          Math.min(startPosBar, requestedGrow)
        )
        finalPlayedBars = startPlayedBars + grow
        finalStartBar = startPosBar - grow
        // The loop's own phase shifts by the OPPOSITE delta startBar just
        // moved by (startBar moved by -grow, so offsetBars moves by +grow),
        // keeping startBar+offsetBars invariant -- the exact condition for
        // "the same absolute bar position keeps showing the same loop
        // content" instead of the pattern restarting from its own beginning
        // at the new boundary. See docs/superpowers/specs/
        // 2026-08-04-tiled-clip-crop-trim-design.md for the full derivation.
        finalOffsetSteps = startOffsetSteps + grow * SNAP_DIVS[snapIdx]
        setDragLeftResize({ playedBars: finalPlayedBars, startBar: finalStartBar })
      },
      (moved) => {
        if (moved) {
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            bars: finalPlayedBars,
            startBar: finalStartBar,
            offsetSteps: finalOffsetSteps
          })
        }
        setDragLeftResize(null)
      }
    )
  }
```

with:

```ts
  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startLeftCropBars = leftCropBars
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    let finalLeftCropBars = startLeftCropBars
    startPointerDrag(
      e,
      (deltaX) => {
        // Dragging right crops more off the left (leftCropBars grows);
        // dragging left extends further left (leftCropBars shrinks, can go
        // negative). Snapped to whole bars, same as the right handle.
        // Clamped so the window never collapses below MIN_PLAYED_BARS wide
        // and never extends before the project's own bar 0 -- both bounds
        // computed from the drag-start snapshot, matching this codebase's
        // existing convention for the right handle's own clamp.
        const requestedLeftCropBars = startLeftCropBars + Math.round(deltaX / ppb)
        finalLeftCropBars = Math.max(
          -startPosBar,
          Math.min(startPlayedBars - MIN_PLAYED_BARS, requestedLeftCropBars)
        )
        setDragLeftCropBars(finalLeftCropBars)
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_LEFT_CROP_BARS', groupId, bars: finalLeftCropBars })
        }
        setDragLeftCropBars(null)
      }
    )
  }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: still shows the ONE remaining `RESIZE_LEFT` error in `CollapsedRifffRow.tsx` (Task 4's
job) — `StemWaveformRow.tsx` itself should now be clean. If `StemWaveformRow.tsx` shows its own
errors, stop and fix them before proceeding.

- [ ] **Step 7: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS except for whatever's still broken in `CollapsedRifffRow.tsx` (no test file
directly exercises that component, so this should actually fully PASS at this point -- if
something unrelated fails, stop and investigate before proceeding).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Rewrite StemWaveformRow's left-handle drag to crop via leftCropBars"
```

---

### Task 4: `CollapsedRifffRow.tsx` — drag handler and tiled waveform

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`

- [ ] **Step 1: Update imports**

Add `tileOffsetsPx` to the existing import from `../state/selectors` (currently line 6):

```ts
import { clipGeometryFromFields, resolvedPlayedBarsFromFields, tileOffsetsPx } from '../state/selectors'
```

- [ ] **Step 2: Update `CollapsedTiles` to use `tileOffsetsPx`**

Replace the whole `CollapsedTiles` function (currently lines 41-90):

```ts
function CollapsedTiles({
  path,
  color,
  opacity,
  widthPx,
  stemBarLength,
  playedBars
}: {
  path: string
  color: string
  opacity: number
  widthPx: number
  stemBarLength: number
  playedBars: number
}): React.JSX.Element {
  const tileWidthPx = widthPx * (stemBarLength / playedBars)
  const tileCount = Math.max(1, Math.ceil(widthPx / tileWidthPx))
  const tileOffsets = Array.from({ length: tileCount }, (_, i) => i * tileWidthPx)
  return (
    <>
      {tileOffsets.map((left) => (
        <div
          key={left}
          style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}
        >
          <Waveform path={path} color={color} opacity={opacity} />
        </div>
      ))}
      {/* One thin line at every point the underlying loop restarts (skipping
          the first, at the block's own left edge) — see StemWaveformRow's
          identical marker for why: makes how long the stem's own native loop
          actually is legible at a glance. */}
      {tileCount > 1 &&
        tileOffsets.slice(1).map((left) => (
          <div
            key={left}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left,
              width: 1,
              background: 'color-mix(in srgb, var(--ra-text) 35%, transparent)',
              pointerEvents: 'none'
            }}
          />
        ))}
    </>
  )
}
```

with:

```ts
function CollapsedTiles({
  path,
  color,
  opacity,
  widthPx,
  stemBarLength,
  playedBars,
  leftCropBars
}: {
  path: string
  color: string
  opacity: number
  widthPx: number
  stemBarLength: number
  playedBars: number
  leftCropBars: number
}): React.JSX.Element {
  const tileOffsets = tileOffsetsPx(widthPx, stemBarLength, playedBars, leftCropBars)
  const tileWidthPx = widthPx * (stemBarLength / (playedBars - leftCropBars))
  return (
    <>
      {tileOffsets.map((left) => (
        <div
          key={left}
          style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}
        >
          <Waveform path={path} color={color} opacity={opacity} />
        </div>
      ))}
      {/* One thin line at every point the underlying loop restarts (skipping
          the first, at the block's own left edge) — see StemWaveformRow's
          identical marker for why: makes how long the stem's own native loop
          actually is legible at a glance. */}
      {tileOffsets.length > 1 &&
        tileOffsets.slice(1).map((left) => (
          <div
            key={left}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left,
              width: 1,
              background: 'color-mix(in srgb, var(--ra-text) 35%, transparent)',
              pointerEvents: 'none'
            }}
          />
        ))}
    </>
  )
}
```

- [ ] **Step 3: Read the committed `leftCrop` value and thread it through**

Add this line right after the existing `const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)` (currently line 179):

```ts
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
```

Then update the `geo` call (currently lines 186-196) to add `leftCropBars`:

```ts
  const geo = clipGeometryFromFields({
    startBar: baseStartBar,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride,
    leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb: PPB
  })
```

- [ ] **Step 4: Replace the `dragLeftResize` preview state and geometry block**

Replace the existing `dragLeftResize` state declaration (find it near the other `useState`
declarations, same shape as `StemWaveformRow.tsx`'s own `{ playedBars: number; startBar: number
} | null`):

```ts
  const [dragLeftCropBars, setDragLeftCropBars] = useState<number | null>(null)
```

Replace the block from `const nudgeOffsetPx = ...` (currently line 200) through the `widthPx`
ternary (currently lines 200-215) with:

```ts
  const displayedLeftCropBars = dragLeftCropBars ?? leftCropBars
  // Live preview during a left-edge drag (non-one-shot case) uses the EXACT
  // SAME formula real (committed) rendering uses -- see StemWaveformRow's
  // identical fix for why the old nudgeOffsetPx/displayedStartBar
  // reconciliation trick is gone.
  const previewGeo =
    dragLeftCropBars !== null
      ? clipGeometryFromFields({
          startBar: baseStartBar,
          offsetSteps,
          snapDiv: SNAP_DIVS[snapIdx],
          playedBarsOverride,
          leftCropBars: dragLeftCropBars,
          rifffBarLength: rifff.barLength,
          stretchOn,
          rifffBpm: rifff.bpm,
          stateBpm: bpm,
          ppb: PPB
        })
      : geo
  const oneShotCommittedDurationSec =
    oneShotStem != null
      ? (oneShotStem.trimEndSec ?? oneShotStem.durationSec) - (oneShotStem.trimStartSec ?? 0)
      : 0
  const displayedStartBar = isOneShot ? (oneShotDragPreview?.startBar ?? baseStartBar) : baseStartBar
  const leftPx = isOneShot ? displayedStartBar * PPB + (geo.leftPx - baseStartBar * PPB) : previewGeo.leftPx
  const widthPx = isOneShot
    ? oneShotWidthBars(oneShotDragPreview?.durationSec ?? oneShotCommittedDurationSec, bpm) * PPB
    : dragPlayedBars !== null
      ? dragPlayedBars * PPB
      : previewGeo.widthPx
```

(The one-shot branch keeps its own existing `nudgeOffsetPx`-equivalent inline -- `geo.leftPx -
baseStartBar * PPB` -- since one-shots don't use `leftCropBars` at all and their own
`displayedStartBar`/drag-preview logic is untouched by this plan.)

- [ ] **Step 5: Update `displayedPlayedBars` and the `CollapsedTiles` call site**

Replace the existing `displayedPlayedBars` line (currently line 183):

```ts
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
```

with:

```ts
  const displayedPlayedBars = dragPlayedBars ?? resolvedPlayedBars
```

Then update the `CollapsedTiles` call site (currently lines 619-627) to pass the new prop:

```ts
                    <CollapsedTiles
                      key={stem.slot}
                      path={stem.path}
                      color={stemColorVar(stem)}
                      opacity={0.55}
                      widthPx={widthPx}
                      stemBarLength={stem.barLength}
                      playedBars={displayedPlayedBars}
                      leftCropBars={displayedLeftCropBars}
                    />
```

- [ ] **Step 6: Find and replace `handleLeftResizeStart`**

Find the function (same name as `StemWaveformRow.tsx`'s own, a separate independent copy in
this file) and replace it with the exact same replacement as Task 3 Step 5, EXCEPT using this
file's own `PPB` (capitalized) instead of `ppb`, and its own `setDragLeftCropBars`:

```ts
  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startLeftCropBars = leftCropBars
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    let finalLeftCropBars = startLeftCropBars
    startPointerDrag(
      e,
      (deltaX) => {
        const requestedLeftCropBars = startLeftCropBars + Math.round(deltaX / PPB)
        finalLeftCropBars = Math.max(
          -startPosBar,
          Math.min(startPlayedBars - MIN_PLAYED_BARS, requestedLeftCropBars)
        )
        setDragLeftCropBars(finalLeftCropBars)
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_LEFT_CROP_BARS', groupId, bars: finalLeftCropBars })
        }
        setDragLeftCropBars(null)
      }
    )
  }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS, clean -- this was the last file with a `RESIZE_LEFT` reference.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS (no test file directly exercises this component, so this confirms nothing
elsewhere broke).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "Rewrite CollapsedRifffRow's left-handle drag to crop via leftCropBars"
```

---

### Task 5: `RifffBlockRow.tsx` — thread `leftCropBars` through

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`

- [ ] **Step 1: Add the selector and thread it into `clipGeometryFromFields`**

Add this line right after the existing `const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)` (currently line 33):

```ts
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
```

Then update the `geo` call (currently lines 50-60) to add `leftCropBars`:

```ts
  const geo = clipGeometryFromFields({
    startBar: rifff.startBar ?? 0,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride,
    leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb
  })
```

This component has no drag handlers of its own (those live in `StemWaveformRow.tsx`/
`CollapsedRifffRow.tsx`, which it renders) -- it only needs the new field so its own
`clipGeometryFromFields` call keeps compiling and stays visually consistent with its children.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/RifffBlockRow.tsx
git commit -m "Thread leftCropBars through RifffBlockRow's own clip geometry call"
```

---

### Task 6: Native engine wire format

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `native-engine/Source/EngineProjectTests.cpp`

- [ ] **Step 1: Add `leftCropBars` to the native `EngineStem` struct**

In `native-engine/Source/EngineProject.h`, add this field to `EngineStem` (right after the
existing `playedBars` field, around line 21):

```cpp
        double leftCropBars = 0.0; // bars cropped from this stem's own LEFT edge; 0 = no crop
```

- [ ] **Step 2: Parse it in `EngineProject.cpp`**

Add this line to the stem-parsing block (right after the existing
`stem.playedBars = getDouble(stemVar, "playedBars", (double) rifff.barLength);` line, around
line 118):

```cpp
                        stem.leftCropBars = getDouble(stemVar, "leftCropBars", 0.0);
```

- [ ] **Step 3: Write a failing test confirming the new field round-trips through JSON parsing**

Find an existing test in `native-engine/Source/EngineProjectTests.cpp` that constructs a stem
JSON payload with `"playedBars"` in it (there are at least 3 -- lines ~33, ~73, ~101 per the
existing file) and add a new, small, standalone test right after the last existing `beginTest`
block in that file's `runTest()`:

```cpp
            beginTest("parses leftCropBars from the wire format, defaulting to 0.0 when omitted");
            {
                const juce::String json = R"({
                    "bpm": 120.0,
                    "snapDiv": 16.0,
                    "rifffs": [{
                        "groupId": "r1",
                        "channelId": "c1",
                        "startBar": 0.0,
                        "barLength": 4,
                        "stems": [
                            { "stemKey": "s1", "resolvedPath": "/a.wav", "durationSec": 8.0,
                              "barLength": 4, "leftCropBars": 1.5 },
                            { "stemKey": "s2", "resolvedPath": "/b.wav", "durationSec": 8.0,
                              "barLength": 4 }
                        ]
                    }]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectWithinAbsoluteError(project.rifffs[0].stems[0].leftCropBars, 1.5, 0.0001);
                expectWithinAbsoluteError(project.rifffs[0].stems[1].leftCropBars, 0.0, 0.0001);
            }
```

- [ ] **Step 4: Build and run the native test suite to verify it fails, then passes**

Run (from `native-engine/`): `cmake --build build`
Then run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | grep -A2 "leftCropBars\|FAILED\|All unit tests"`

Since Steps 1-2 (the field + its parsing) are implemented together with the test in this same
task (unlike the TS-side tasks above, native code changes are typically built once and tested
together per this codebase's own convention for small, mechanical field additions -- see
`kick.wav`-style small existing tests), this should show PASS on the first build. If it doesn't
(e.g. a typo in the JSON literal), fix and rebuild until `All unit tests passed.` appears.

- [ ] **Step 5: Add `leftCropBars` to the TypeScript wire format**

In `src/shared/buildEngineProject.ts`, add this field to the `EngineStem` interface (right
after the existing `playedBars` field, around line 11):

```ts
  leftCropBars: number
```

Then add it to the actual stem object construction (right after the existing
`playedBars: resolvePlayedBars(state, rifff.groupId),` line, around line 179):

```ts
        leftCropBars: state.leftCrop[rifff.groupId] ?? 0,
```

- [ ] **Step 6: Typecheck and run the full TS test suite**

Run: `npm run typecheck`
Expected: PASS

Run: `npm test`
Expected: PASS -- check specifically for any `buildEngineProject.test.ts` assertions that
snapshot a full `EngineStem` object literal and would need `leftCropBars: 0` added to their own
expected-output fixtures; if any fail for that reason, add the missing field to those fixtures
(this is a mechanical fixture update, not a logic change).

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp src/shared/buildEngineProject.ts
git commit -m "Add leftCropBars to the renderer<->engine wire format"
```

---

### Task 7: Native playback — symmetric tile clipping in `PlaybackEngine.cpp`

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Modify: `native-engine/Source/PlaybackEngineTests.cpp`

This is the highest-risk task in this plan -- real-time audio code, hand-optimized, with a
subtle correctness requirement (reading from the correct offset into the stem's own source
buffer when a tile is clipped from the left, not just clipping the rendered TIME window). Work
through it carefully; don't skip the verification step.

- [ ] **Step 1: Write failing tests**

Add these test cases to `native-engine/Source/PlaybackEngineTests.cpp`, right after the existing
`beginTest("a block straddling a segment boundary reads each segment from its own buffer position")` test (which already has a `writeRampFixtureWav` helper call you can copy the pattern from,
currently around lines 193-245):

```cpp
            beginTest("leftCropBars clips the first tile without moving startBar, and reads from the correct offset into the source buffer");
            {
                // A 1-bar stem tiled twice (rifff.barLength=2), cropped 0.5
                // bars from the left. The ramp fixture lets us confirm the
                // FIRST rendered sample comes from HALFWAY into the stem's
                // own 4s buffer (~0.5), not from its very start (~0.0) --
                // proving the source read offset accounts for the crop, not
                // just the rendered time window.
                const int rampSamples = 176400; // 4s @ 44100Hz
                auto ramp = writeRampFixtureWav("sssketch_pe_leftcrop_ramp.wav", rampSamples);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.leftCropBars = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                const int numSamples = 4;
                // Rendered window starts exactly at startBar + leftCropBars
                // (0.5 bars = 2.0s at this tempo) -- startBar itself never
                // moved.
                const double blockStartSec = 2.0;
                const double positionBars = blockStartSec / 4.0;

                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                engine.renderBlock(positionBars, sampleRate, numSamples, l.data(), r.data(), channelChains);

                // Halfway into a 0..1 ramp over 176400 samples is ~0.5, not ~0.0.
                expect(l[0] > 0.45f && l[0] < 0.55f);

                ramp.deleteFile();
            }

            beginTest("a negative leftCropBars renders tiles before the original anchor (extend-left case)");
            {
                // Same setup, but leftCropBars=-1 -- one whole extra tile
                // should now be audible starting one bar (2.0s) BEFORE
                // startBar itself (i.e. at absolute position -2.0s).
                const int rampSamples = 176400;
                auto ramp = writeRampFixtureWav("sssketch_pe_extendleft_ramp.wav", rampSamples);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 1.0; // so the extended tile (1 bar earlier) still starts >= 0
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.leftCropBars = -1.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                const int numSamples = 4;
                // startBar=1.0 bar (4.0s) + leftCropBars=-1.0 bar (-4.0s) = 0.0s.
                const double blockStartSec = 0.0;
                const double positionBars = blockStartSec / 4.0;

                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                engine.renderBlock(positionBars, sampleRate, numSamples, l.data(), r.data(), channelChains);

                // Right at the start of this extended tile's own buffer -> near 0.0,
                // confirming audio is actually rendered here at all (not silence,
                // which is what today's code -- hardcoded floor of tileIdx at 0 --
                // would produce, since this position is "before tile 0").
                expect(l[0] < 0.05f);

                ramp.deleteFile();
            }

            beginTest("leftCropBars beyond playedBars renders nothing (fully cropped away)");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = "/nonexistent.wav"; // never actually read if this test passes
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.playedBars = 2.0;
                stem.leftCropBars = 3.0; // > playedBars
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                const int numSamples = 4;
                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                // Should not crash, and should render silence (the missing
                // file would be audible as non-silence garbage if this
                // somehow tried to read it).
                engine.renderBlock(0.0, sampleRate, numSamples, l.data(), r.data(), channelChains);
                expect(l[0] == 0.0f);
            }
```

- [ ] **Step 2: Build and confirm the new tests fail**

Run (from `native-engine/`): `cmake --build build`
Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -60`
Expected: the 3 new tests FAIL (the first two because `leftCropBars` isn't read by the tile loop
yet -- rendering will produce silence or wrong-offset content; the third may already pass by
coincidence since `bound <= 0` behavior is close to today's `bound <= lowerBound` need, but
confirm all three explicitly).

- [ ] **Step 3: Replace the tile loop**

In `native-engine/Source/PlaybackEngine.cpp`, replace the entire block from the existing
`const double start = ...` line through the closing `}` of the `for (int i2 = 0; ...)` inner
sample loop's opening portion up through the `srcSample` computation (currently lines 205-307 --
everything covering tile bound computation, the tile loop itself, and the per-sample source
offset). Specifically, replace:

```cpp
                const double start = stem.startBarOverride >= 0.0 ? stem.startBarOverride : rifff.startBar;
                // Wrapped into [0, stem.barLength) — kept in sync by hand with
                // SchedulePlayback.cpp's identical fix/reasoning (this function
                // is a hand-optimized reimplementation of the same algorithm
                // for the real-time callback, not a caller of
                // computeStemSchedule — see the comment above this loop).
                const double rawOffsetBars = stem.offsetSteps / currentProject.snapDiv;
                double offsetBars = std::fmod(rawOffsetBars, (double) stem.barLength);
                if (offsetBars < 0.0)
                    offsetBars += (double) stem.barLength;
                const double bound = stem.playedBars >= 0.0 ? stem.playedBars : (double) rifff.barLength;
                if (bound <= 0.0)
                    continue;
                const double secPerBarNative = stem.durationSec / (double) stem.barLength;

                const int totalTiles = (int) std::ceil(bound / (double) stem.barLength);
                const double tileDurationSec = (double) stem.barLength * spb;
                const double firstTileStartSec = (start + offsetBars) * spb;

                // One tile of slack behind the naive floor absorbs floating-
                // point drift at a tile boundary (positionBars accumulates by
                // repeated addition in Transport.cpp) — worst case the extra
                // tile checked here is immediately skipped by the per-tile
                // overlap test below, at negligible cost.
                int tileIdx = std::max(
                    0,
                    (int) std::floor((blockStartSec - firstTileStartSec) / tileDurationSec) - 1);

                for (; tileIdx < totalTiles; ++tileIdx)
                {
                    const double barOffset = (double) tileIdx * (double) stem.barLength;
                    const double segmentBarLength = std::min((double) stem.barLength, bound - barOffset);
                    const double segStartSec = (start + offsetBars + barOffset) * spb;
                    const double segEndSec = segStartSec + segmentBarLength * secPerBarNative;

                    // Tiles only get later from here on — nothing further in
                    // this loop can overlap the block once one starts after it.
                    if (segStartSec >= blockEndSec)
                        break;
                    // Reached via the one-tile slack margin above; this
                    // particular tile turned out to end before the block starts.
                    if (segEndSec <= blockStartSec)
                        continue;

                    const bool isFirstSegment = tileIdx == 0;
                    const bool isLastSegment = tileIdx == totalTiles - 1;
```

with:

```cpp
                const double start = stem.startBarOverride >= 0.0 ? stem.startBarOverride : rifff.startBar;
                // Wrapped into [0, stem.barLength) — kept in sync by hand with
                // SchedulePlayback.cpp's identical fix/reasoning (this function
                // is a hand-optimized reimplementation of the same algorithm
                // for the real-time callback, not a caller of
                // computeStemSchedule — see the comment above this loop).
                const double rawOffsetBars = stem.offsetSteps / currentProject.snapDiv;
                double offsetBars = std::fmod(rawOffsetBars, (double) stem.barLength);
                if (offsetBars < 0.0)
                    offsetBars += (double) stem.barLength;
                // lowerBound/upperBound together define the visible/audible
                // window as [lowerBound, upperBound) bars, relative to
                // start+offsetBars -- NEITHER start NOR offsetBars moves for
                // a crop (see docs/superpowers/specs/
                // 2026-08-04-tiled-clip-crop-trim-design.md); leftCropBars
                // can be negative (extend-left, revealing tiles before the
                // original anchor) just as playedBars can already exceed
                // rifff.barLength (extend-right).
                const double lowerBound = stem.leftCropBars;
                const double upperBound = stem.playedBars >= 0.0 ? stem.playedBars : (double) rifff.barLength;
                if (upperBound <= lowerBound)
                    continue;
                const double secPerBarNative = stem.durationSec / (double) stem.barLength;

                const int firstTileIdx = (int) std::floor(lowerBound / (double) stem.barLength);
                const int totalTiles = (int) std::ceil(upperBound / (double) stem.barLength);
                const double tileDurationSec = (double) stem.barLength * spb;
                // The first AUDIBLE tile's own start (not tile 0's start,
                // unless lowerBound is itself 0) -- this is what the
                // one-tile-slack skip-ahead below measures forward from.
                const double firstTileStartSec = (start + offsetBars + lowerBound) * spb;

                // One tile of slack behind the naive floor absorbs floating-
                // point drift at a tile boundary (positionBars accumulates by
                // repeated addition in Transport.cpp) — worst case the extra
                // tile checked here is immediately skipped by the per-tile
                // overlap test below, at negligible cost. Floored at
                // firstTileIdx now, not a hardcoded 0 -- firstTileIdx can be
                // negative (extend-left case).
                int tileIdx = firstTileIdx + std::max(
                    0,
                    (int) std::floor((blockStartSec - firstTileStartSec) / tileDurationSec) - 1);

                for (; tileIdx < totalTiles; ++tileIdx)
                {
                    const double barOffset = (double) tileIdx * (double) stem.barLength;
                    // Clip THIS tile against both bounds symmetrically -- the
                    // first audible tile gets clipped from the left when
                    // lowerBound falls inside it (barOffset < lowerBound <
                    // barOffset+barLength), the last gets clipped from the
                    // right exactly as it always did.
                    const double tileStart = std::max(barOffset, lowerBound);
                    const double tileEnd = std::min(barOffset + (double) stem.barLength, upperBound);
                    if (tileEnd <= tileStart)
                        continue; // shouldn't normally happen given firstTileIdx/totalTiles above; defensive
                    const double segmentBarLength = tileEnd - tileStart;
                    const double segStartSec = (start + offsetBars + tileStart) * spb;
                    const double segEndSec = segStartSec + segmentBarLength * secPerBarNative;
                    // How far into THIS tile's own native content segStartSec
                    // actually begins -- zero for every tile except one
                    // clipped from the left by lowerBound, where it's however
                    // far past that tile's own natural start the crop point
                    // falls. Without this, a left-clipped tile would read
                    // from ITS OWN sample 0 at segStartSec instead of from
                    // partway through -- the exact same "restarts instead of
                    // continuing" bug this whole feature exists to fix, just
                    // one layer deeper (source-buffer read position, not
                    // just the rendered time window).
                    const double sourceOffsetSec = (tileStart - barOffset) * secPerBarNative;

                    // Tiles only get later from here on — nothing further in
                    // this loop can overlap the block once one starts after it.
                    if (segStartSec >= blockEndSec)
                        break;
                    // Reached via the one-tile slack margin above; this
                    // particular tile turned out to end before the block starts.
                    if (segEndSec <= blockStartSec)
                        continue;

                    const bool isFirstSegment = tileIdx == firstTileIdx;
                    const bool isLastSegment = tileIdx == totalTiles - 1;
```

Then, inside the same block, find this line (in the per-sample inner loop that follows):

```cpp
                        const int srcSample = (int) std::llround(posInSegSec * entry.sampleRate);
```

and replace it with:

```cpp
                        const int srcSample = (int) std::llround((posInSegSec + sourceOffsetSec) * entry.sampleRate);
```

- [ ] **Step 4: Build and run the full native test suite**

Run (from `native-engine/`): `cmake --build build`
Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -80`
Expected: `All unit tests passed.` -- including the 3 new tests from Step 1 AND every
pre-existing `PlaybackEngine`/`SchedulePlayback` test (the pre-existing ones all use
`leftCropBars`'s default of `0.0`, under which `lowerBound=0`, `firstTileIdx=0`, and every
formula above reduces exactly to what it was before this change -- if any pre-existing test
newly fails, that reduction has a bug; stop and find it rather than proceeding).

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp
git commit -m "Add symmetric left-edge tile clipping to PlaybackEngine's tile loop"
```

---

### Task 8: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Full TS test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Native build + test suite**

Run (from `native-engine/`): `cmake --build build`
Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test`
Expected: `All unit tests passed.`

- [ ] **Step 5: Full quit-and-relaunch (native engine changed)**

Per this repo's own CLAUDE.md: the native engine does NOT hot-reload, and a renderer reload
alone is not enough. Fully quit (Cmd+Q, or `kill -9` every `Electron`/`electron-vite`/
`sssketch-engine --serve` process) and run `npm run dev` again.

- [ ] **Step 6: Manual walkthrough**

This is real-time audio/UI behavior that can't be verified any other way in this environment
(see CLAUDE.md's own testing-conventions section). With the freshly-relaunched dev app running,
repeat in BOTH the expanded (`StemWaveformRow.tsx`) and collapsed (`CollapsedRifffRow.tsx`)
views of the same tiled clip:

1. Drag a multi-bar tiled clip's LEFT handle to the RIGHT (cropping). Confirm: the box's LEFT
   EDGE visibly moves inward this time (the bug this whole plan exists to fix), the right edge
   stays fixed, the audible content continues rather than restarting, AND the waveform IMAGE
   shown in the cropped region visually matches what's audible (not a jump-cut back to the
   stem's own sample-0 image).
2. Drag the same handle back to the LEFT past its original position (extending). Confirm: the
   box's left edge extends outward, and the newly-revealed portion (both audibly and visually in
   the waveform) shows the loop's own wraparound content, not silence or a repeat.
3. Drag the RIGHT handle (either direction). Confirm it behaves exactly as before this whole
   plan (untouched).
4. Place a recorded take or dragged-in sample and confirm its own one-shot trim handles are
   unaffected (this plan never touches `oneShotResize.ts` or the one-shot branches in either
   drag-handler file).
5. Save the project, reload it, and confirm a clip with a nonzero left-crop reopens with its
   crop intact (persistence is automatic per the design doc, but worth actually confirming once).

Report back what you see.
