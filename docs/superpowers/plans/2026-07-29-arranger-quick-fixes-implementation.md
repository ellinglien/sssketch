# Arranger Quick Fixes & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five small, independent UI fixes to the arranger, per
`docs/superpowers/specs/2026-07-29-arranger-quick-fixes-design.md`.

**Architecture:** All five changes are localized edits to already-existing, already-tested
components (`StemWaveformRow.tsx`, `RifffBlockRow.tsx`, `Inspector.tsx`, `TransportBar.tsx`,
`Shelf.tsx`, `App.tsx`). No new state fields, no reducer changes, no native-engine changes.
One new tiny shared module (`dragGrabOffset.ts`) is added for Task 4.

**Tech Stack:** TypeScript/React (renderer), Vitest (unit tests).

---

## Design decision made while writing this plan (not fully pinned down by the design doc)

The design doc's Task 4 approach (spec §4) says to carry the grab-point offset through
`dataTransfer` as a new field, read back in both `handleDragOver` (for the live preview line)
and `handleDrop` (for the final position). **That doesn't work for `handleDragOver`.** The
HTML5 Drag and Drop spec puts `DataTransfer` into "protected mode" for every event except
`dragstart` and `drop` — during `dragover`, `dataTransfer.getData()` always returns an empty
string, regardless of same-origin/same-window; only `dataTransfer.types` (the list of available
keys, not their values) is readable. So a value stashed via `dataTransfer.setData` at
`dragstart` genuinely cannot be read back during `dragover` — only at `drop`.

Since the live preview line needs the offset *during* the drag, not just at drop, this plan
uses a small **module-level variable** instead of `dataTransfer` for the offset value
specifically (`src/renderer/src/components/dragGrabOffset.ts`, Task 4 below). `dragstart` and
`dragover`/`drop` all run synchronously in the same renderer process for an in-app drag, so a
plain shared variable works and sidesteps the protected-mode restriction entirely — matching
the pattern `dragUtils.ts` already uses for other same-session drag-local values (a plain JS
reference, not routed through a serialization boundary that doesn't need it).
`dataTransfer.setData`/`getData` stay exactly as they are today for the group-id/stem-key
identifiers — only the *offset* moves to the new module.

---

### Task 1: Double-click a stem's waveform resets its volume

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Read the current file in full**

Read `src/renderer/src/components/StemWaveformRow.tsx` completely before editing — it already
has drag handlers, tiling, and envelope rendering that your edit must not disturb.

- [ ] **Step 2: Add the `sqrtGain` import**

At the top of `src/renderer/src/components/StemWaveformRow.tsx`, alongside the existing
imports:

```ts
import { sqrtGain } from '@shared/mixGain'
```

- [ ] **Step 3: Add an `onDoubleClick` handler to the waveform container**

Find this block (the outer draggable-free waveform container, directly inside the
`<div style={{ flex: 1, position: 'relative' }}>` wrapper):

```tsx
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
```

Add `onDoubleClick`, right after the opening `<div` attributes list starts (order doesn't
matter, but keep it near the top for readability):

```tsx
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          onDoubleClick={() => {
            dispatch({
              type: 'SET_VOLUME',
              stemKey: key,
              volume: sqrtGain(rifff.stems.length)
            })
          }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
```

`key` (the stem's `stemKey(groupId, slot)`) and `rifff` are already in scope in this component
— no new variables needed. This resets volume only; mute state is untouched.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Start the dev app (`npm run dev`), drag a rifff onto the timeline, drag its volume plateau up
or down to change the volume away from default, then double-click anywhere on that stem's
waveform. Confirm the volume plateau (and the color-saturation split) jumps back to the
default equal-power level, and that mute state (if toggled) is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Double-click a stem's waveform to reset its volume to the import default"
```

---

### Task 2: Reduce fade-drag sensitivity

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Change the fade-in drag's pixel-to-bar conversion**

Find `handleFadeInStart`:

```tsx
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    // Tracked in a plain closure variable, NOT read back out of dragFadeIn
    // state inside onEnd — see dragUtils.ts's doc comment for why a dispatch
    // can never live inside a setState updater function (StrictMode
    // double-invokes those in dev, already caused a real bug in the resize
    // handler above — don't reintroduce it here).
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(0, Math.min(FADE_MAX, startFadeIn + deltaX / PPB))
        setDragFadeIn(finalFadeIn)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        setDragFadeIn(null)
      }
    )
  }
```

Change the conversion in the `onMove` callback from `deltaX / PPB` to
`deltaX / (PPB * FADE_DRAG_SLOWDOWN)`:

```tsx
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    // Tracked in a plain closure variable, NOT read back out of dragFadeIn
    // state inside onEnd — see dragUtils.ts's doc comment for why a dispatch
    // can never live inside a setState updater function (StrictMode
    // double-invokes those in dev, already caused a real bug in the resize
    // handler above — don't reintroduce it here).
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        setDragFadeIn(finalFadeIn)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        setDragFadeIn(null)
      }
    )
  }
```

- [ ] **Step 2: Same change in `handleFadeOutStart`**

Find `handleFadeOutStart`:

```tsx
  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      // foStart = width - fadeOutPx, so a LONGER fade-out means a SMALLER
      // foStart, which means the knee needs to move LEFT. deltaX moving left
      // is negative, so subtracting it (startFadeOut - deltaX) is what makes
      // "drag left" translate to "fadeOutPx grows" — the mirror image of
      // fade-in's `startFadeIn + deltaX`, where dragging right grows fadeIn.
      (deltaX) => {
        finalFadeOut = Math.max(0, Math.min(FADE_MAX, startFadeOut - deltaX / PPB))
        setDragFadeOut(finalFadeOut)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        setDragFadeOut(null)
      }
    )
  }
```

Change to:

```tsx
  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      // foStart = width - fadeOutPx, so a LONGER fade-out means a SMALLER
      // foStart, which means the knee needs to move LEFT. deltaX moving left
      // is negative, so subtracting it (startFadeOut - deltaX) is what makes
      // "drag left" translate to "fadeOutPx grows" — the mirror image of
      // fade-in's `startFadeIn + deltaX`, where dragging right grows fadeIn.
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        setDragFadeOut(finalFadeOut)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        setDragFadeOut(null)
      }
    )
  }
```

- [ ] **Step 3: Add the `FADE_DRAG_SLOWDOWN` constant**

Near the top of the file, alongside the other module-level constants:

```tsx
export const ROW_HEIGHT = 44
const FADE_MAX = 4 // bars — matches the value the (now-removed) Inspector panel used to clamp fades
// A quick flick at the old 1-bar-per-PPB(24px) rate could hit FADE_MAX almost
// by accident, sounding much stronger than intended. 4x slows that down to
// ~96px of drag per bar of fade — deliberately harder to overshoot, closer to
// how gradual the original Inspector nudge-button stepper felt, while still
// keeping the drag gesture itself (not going back to click-only steps).
const FADE_DRAG_SLOWDOWN = 4
const TOOLTIP_HEIGHT = 18 // volume tooltip's measured rendered height + small margin
const TOOLTIP_GAP = 4 // gap between the tooltip and the plateau line it's anchored to
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

In the dev app, drag a fade-in or fade-out handle a short distance (e.g. ~30px) and confirm it
now moves a noticeably smaller fraction of a bar than before — reaching the full 4-bar ceiling
should require a long, deliberate drag, not a quick flick.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Reduce fade-drag sensitivity so a quick flick can't overshoot to a huge fade"
```

---

### Task 3: Rename "offset" to "nudge", finer snap-independent precision

**Files:**
- Modify: `src/renderer/src/components/Inspector.tsx`

- [ ] **Step 1: Read the current file in full**

Read `src/renderer/src/components/Inspector.tsx` completely — the offset/nudge UI appears
twice: once for the group (always visible) and once per stem (only when unlinked), and both
need the same fine-delta treatment.

- [ ] **Step 2: Add a `fineNudgeDelta` helper and import**

`offsetLabels` (already imported from `@shared/visuals`) computes
`msPerStep = (60/bpm)*4*1000/snapDiv` internally but doesn't expose it as a standalone
function — recomputing the same formula here for a target 1ms delta is simpler than
refactoring `offsetLabels`'s return shape (which several other call sites in this file already
consume as-is). Add this small local helper directly in `Inspector.tsx`, above the component:

```tsx
// A finer, snap-division-independent nudge step: 1ms of real time at this
// rifff's own bpm, computed with the same formula offsetLabels() itself uses
// internally (msPerStep = (60/bpm)*4*1000/snapDiv) so the two can never
// silently disagree. This makes each click's real-world effect deliberately
// tiny and constant regardless of whatever the global snap-grid setting
// happens to be — the whole point of separating "nudge precision" from
// "clip-placement snap precision".
const NUDGE_TARGET_MS = 1
function fineNudgeDelta(bpm: number, snapDiv: number): number {
  const msPerStep = ((60 / bpm) * 4 * 1000) / snapDiv
  return NUDGE_TARGET_MS / msPerStep
}
```

- [ ] **Step 3: Rename the group-level "offset" section and use the fine delta**

Find:

```tsx
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
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              −
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--ra-text-4)' }}>
              −8 / 0 / +8
            </div>
            <button
              onClick={() => dispatch({ type: 'NUDGE_OFFSET', key: groupOffsetKey, delta: 1 })}
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              +
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: groupOffsetSteps ? color : 'var(--ra-text-2)'
                }}
              >
                {labels.grid}
              </span>
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ra-text-3)' }}>
                {labels.ms}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
```

Replace the eyebrow, the two nudge buttons' `delta`, and the bold/secondary readout swap:

```tsx
      {section(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="ra-eyebrow">nudge</span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)', whiteSpace: 'nowrap' }}>
              1ms/step
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              onClick={() =>
                dispatch({
                  type: 'NUDGE_OFFSET',
                  key: groupOffsetKey,
                  delta: -fineNudgeDelta(rifff.bpm, snapDiv)
                })
              }
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              −
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--ra-text-4)' }}>
              1ms steps
            </div>
            <button
              onClick={() =>
                dispatch({
                  type: 'NUDGE_OFFSET',
                  key: groupOffsetKey,
                  delta: fineNudgeDelta(rifff.bpm, snapDiv)
                })
              }
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--ra-border-strong)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              +
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: groupOffsetSteps ? color : 'var(--ra-text-2)'
                }}
              >
                {labels.ms}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
```

`rifff.bpm` here is used deliberately, not `state.bpm` — nudge corrects drift in this rifff's
own audio, which `offsetLabels` already converts using `state.bpm` for the *display* (`labels`
further down is computed with `state.bpm` a few lines up, unchanged) — but the *step size*
itself should track the tempo the correction is actually being made at. Check the existing
`labels` computation a few lines above this block:

```tsx
  const labels = offsetLabels(groupOffsetSteps, snapDiv, state.bpm)
```

Leave that line as-is (it already uses `state.bpm`, which is correct for the ms *display* since
that's the project's actual playback tempo) — only the new `fineNudgeDelta` calls use
`rifff.bpm`... actually, on reflection: **use `state.bpm` in `fineNudgeDelta` too, not
`rifff.bpm`**, so the step size and the displayed ms value are computed from the exact same
tempo the audio actually plays back at (matching `labels`'s own convention) — this avoids a
step size that quietly represents a different real-world ms amount than what the readout claims
when a rifff's native bpm differs from the project's. Use `state.bpm` in both nudge-button
`fineNudgeDelta` calls above.

- [ ] **Step 4: Same rename + fine delta for the per-stem (unlinked) nudge row**

Find:

```tsx
                  {unlinked && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginLeft: 13,
                        marginBottom: 2
                      }}
                    >
                      <button
                        onClick={() =>
                          dispatch({ type: 'NUDGE_OFFSET', key: stemOffsetKey, delta: -1 })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 3,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontSize: 9,
                          color: stemOffsetSteps ? typeColorVar(stem.type) : 'var(--ra-text-3)',
                          minWidth: 24
                        }}
                      >
                        {stemLabels.grid}
                      </span>
                      <button
                        onClick={() =>
                          dispatch({ type: 'NUDGE_OFFSET', key: stemOffsetKey, delta: 1 })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 3,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        +
                      </button>
                      <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
                        {stemLabels.ms}
                      </span>
                    </div>
                  )}
```

Replace the `−1`/`+1` deltas and the `stemLabels.grid` display:

```tsx
                  {unlinked && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginLeft: 13,
                        marginBottom: 2
                      }}
                    >
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'NUDGE_OFFSET',
                            key: stemOffsetKey,
                            delta: -fineNudgeDelta(state.bpm, snapDiv)
                          })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 3,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontSize: 9,
                          color: stemOffsetSteps ? typeColorVar(stem.type) : 'var(--ra-text-3)',
                          minWidth: 24
                        }}
                      >
                        {stemLabels.ms}
                      </span>
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'NUDGE_OFFSET',
                            key: stemOffsetKey,
                            delta: fineNudgeDelta(state.bpm, snapDiv)
                          })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 3,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
```

Note the trailing `<span>{stemLabels.ms}</span>` that used to sit after the `+` button is
removed here since `stemLabels.ms` is now shown in the middle (where `stemLabels.grid` used to
be) — don't leave a duplicate.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

In the dev app, select a placed rifff, open the Inspector, and confirm the section now reads
"nudge" instead of "offset". Click the `+`/`−` buttons and confirm the ms readout moves by
about 1ms per click (not the old coarse grid-fraction amount). Unlink the rifff and confirm the
same holds for the per-stem nudge row.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Inspector.tsx
git commit -m "Rename offset to nudge, make it a fine 1ms step independent of the snap grid"
```

---

### Task 4: Preserve grab-point offset when repositioning a placed clip

**Files:**
- Create: `src/renderer/src/components/dragGrabOffset.ts`
- Test: `src/renderer/src/components/dragGrabOffset.test.ts`
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing tests for the shared grab-offset module**

Create `src/renderer/src/components/dragGrabOffset.test.ts`. This covers three things: the two
pure arithmetic functions (where sign errors are the real risk) tested directly, plus a
round-trip through both together, and the plain storage functions:

```ts
import { describe, expect, it } from 'vitest'
import {
  computeGrabOffsetBars,
  applyGrabOffset,
  setGrabOffsetBars,
  getGrabOffsetBars
} from './dragGrabOffset'

describe('computeGrabOffsetBars', () => {
  it('is 0 when grabbed exactly at the clip start', () => {
    expect(computeGrabOffsetBars(6, 6)).toBe(0)
  })

  it('is positive when grabbed to the right of the clip start', () => {
    expect(computeGrabOffsetBars(9, 6)).toBe(3)
  })
})

describe('applyGrabOffset', () => {
  it('subtracts the offset back out', () => {
    expect(applyGrabOffset(12, 3)).toBe(9)
  })

  it('is the exact inverse of computeGrabOffsetBars for the same drag', () => {
    // Grabbed 3 bars into a clip starting at bar 6 (so at bar 9)...
    const offset = computeGrabOffsetBars(9, 6)
    // ...then dragged until the mouse is at bar 20 — the clip's new start
    // should be 17, i.e. still 3 bars behind the mouse, same as at grab time.
    expect(applyGrabOffset(20, offset)).toBe(17)
  })
})

describe('dragGrabOffset storage', () => {
  it('returns 0 before anything has been set', () => {
    expect(getGrabOffsetBars()).toBe(0)
  })

  it('returns whatever was last set', () => {
    setGrabOffsetBars(2.5)
    expect(getGrabOffsetBars()).toBe(2.5)
    setGrabOffsetBars(-1)
    expect(getGrabOffsetBars()).toBe(-1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/dragGrabOffset.test.ts`
Expected: FAIL — `dragGrabOffset` module doesn't exist yet.

Note: the storage tests are order-dependent (the first assumes nothing has set a value yet,
the second sets one) — Vitest runs `it` blocks within a `describe` in file order by default, so
this is safe as written. Don't reorder those two.

- [ ] **Step 3: Write the module**

Create `src/renderer/src/components/dragGrabOffset.ts`:

```ts
// Pure: where within the clip (in bars) it was grabbed, given the mouse's own
// bar position and the clip's start bar, both at drag-start.
export function computeGrabOffsetBars(mouseBar: number, clipStartBar: number): number {
  return mouseBar - clipStartBar
}

// Pure inverse of computeGrabOffsetBars: given the mouse's bar position at
// drop (or during a dragover preview) and a previously captured grab offset,
// the clip's resulting start bar.
export function applyGrabOffset(mouseBar: number, offsetBars: number): number {
  return mouseBar - offsetBars
}

// Carries the offset itself from a drag's onDragStart to Timeline's
// handleDragOver/handleDrop in App.tsx — NOT via dataTransfer, deliberately.
// The HTML5 Drag and Drop spec puts DataTransfer into "protected mode" for
// every event except dragstart and drop: dataTransfer.getData() always
// returns an empty string during dragover, regardless of same-window/
// same-origin. A value stashed via dataTransfer.setData at dragstart
// genuinely can't be read back during dragover — only at drop. Since the
// live preview line (shown during dragover, before drop) needs this offset
// too, it has to travel some other way. dragstart and dragover/drop all run
// synchronously in the same renderer process for an in-app drag, so a plain
// module-level variable works fine and sidesteps the restriction entirely.
let grabOffsetBars = 0

export function setGrabOffsetBars(bars: number): void {
  grabOffsetBars = bars
}

export function getGrabOffsetBars(): number {
  return grabOffsetBars
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/dragGrabOffset.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Set the grab offset at RifffBlockRow's drag start**

Read `src/renderer/src/components/RifffBlockRow.tsx` in full first (it was restructured
recently to fix a pointer-events overlap bug — the header is now split into an outer
non-interactive background layer and an inner interactive div; make sure your edit lands in the
inner one).

Find:

```tsx
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/rifff-group-id', groupId)
          }}
          onClick={() => dispatch({ type: 'SELECT', groupId })}
```

Add the import at the top of the file:

```ts
import { computeGrabOffsetBars, setGrabOffsetBars } from './dragGrabOffset'
```

Change the handler to compute and stash the grab offset. `PPB` and `LANE_HEADER_WIDTH` are
needed to convert the mouse's clientX into a bar position the same way `barForClientX` in
`App.tsx` does — import both from `./Ruler`:

```ts
import { PPB, LANE_HEADER_WIDTH } from './Ruler'
```

```tsx
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/rifff-group-id', groupId)
            // Grab point in bars, relative to this rifff's own current start —
            // read back in Timeline's handleDragOver/handleDrop (App.tsx) so
            // the clip moves as if picked up at this exact point rather than
            // snapping its start under wherever the mouse ends up.
            const rect = e.currentTarget.closest('[data-timeline]')?.getBoundingClientRect()
            if (rect) {
              const mouseBar = Math.max(0, (e.clientX - rect.left - LANE_HEADER_WIDTH) / PPB)
              setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
            }
          }}
          onClick={() => dispatch({ type: 'SELECT', groupId })}
```

This needs `Timeline`'s root div (in `App.tsx`) to carry a `data-timeline` attribute so
`closest()` can find it reliably from any nested drag source — add that now rather than
threading a ref through props, since it's a one-line, purely-structural marker with no other
behavior implications. In `src/renderer/src/App.tsx`, find:

```tsx
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      style={{ position: 'relative' }}
    >
```

Add the attribute:

```tsx
  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      style={{ position: 'relative' }}
    >
```

- [ ] **Step 6: Set the grab offset at StemWaveformRow's drag start**

Find (in `src/renderer/src/components/StemWaveformRow.tsx`):

```tsx
      <div
        draggable={unlinked}
        onDragStart={(e) => {
          if (!unlinked) return
          e.dataTransfer.setData('text/rifff-stem-key', key)
        }}
        title={unlinked ? 'drag to move this stem independently' : undefined}
```

Add the same imports as Task 4 Step 5 (`computeGrabOffsetBars`/`setGrabOffsetBars` from
`./dragGrabOffset`; `PPB` is already imported in this file — add `LANE_HEADER_WIDTH` alongside
it):

```ts
import { PPB, LANE_HEADER_WIDTH } from './Ruler'
import { computeGrabOffsetBars, setGrabOffsetBars } from './dragGrabOffset'
```

(`PPB` is already imported from `'./Ruler'` in this file today as `import { PPB } from
'./Ruler'` — just add `LANE_HEADER_WIDTH` to that existing import line rather than duplicating
it.)

```tsx
      <div
        draggable={unlinked}
        onDragStart={(e) => {
          if (!unlinked) return
          e.dataTransfer.setData('text/rifff-stem-key', key)
          const rect = e.currentTarget.closest('[data-timeline]')?.getBoundingClientRect()
          if (rect) {
            const mouseBar = Math.max(0, (e.clientX - rect.left - LANE_HEADER_WIDTH) / PPB)
            setGrabOffsetBars(computeGrabOffsetBars(mouseBar, baseStartBar))
          }
        }}
        title={unlinked ? 'drag to move this stem independently' : undefined}
```

`baseStartBar` is already defined earlier in this component (`const baseStartBar =
stemStartBar(state, groupId, slot)`) — no new variable needed.

- [ ] **Step 7: Apply the offset in Timeline's handleDragOver and handleDrop**

In `src/renderer/src/App.tsx`, add the import:

```ts
import { applyGrabOffset, getGrabOffsetBars } from './components/dragGrabOffset'
```

Find:

```tsx
  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(barForClientX(e.clientX, e.currentTarget))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(null)
    const startBar = barForClientX(e.clientX, e.currentTarget)

    // Checked first — more specific than a whole-group drag, and the two payloads
    // are never both set on the same drop (StemWaveformRow only sets this one,
    // and only while its stem's group is unlinked).
    const stemDragKey = e.dataTransfer.getData('text/rifff-stem-key')
    if (stemDragKey) {
      dispatch({ type: 'SET_STEM_START', key: stemDragKey, startBar })
      return
    }

    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId, startBar })
  }
```

Replace with:

```tsx
  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(applyGrabOffset(barForClientX(e.clientX, e.currentTarget), getGrabOffsetBars()))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(null)
    const startBar = applyGrabOffset(barForClientX(e.clientX, e.currentTarget), getGrabOffsetBars())

    // Checked first — more specific than a whole-group drag, and the two payloads
    // are never both set on the same drop (StemWaveformRow only sets this one,
    // and only while its stem's group is unlinked).
    const stemDragKey = e.dataTransfer.getData('text/rifff-stem-key')
    if (stemDragKey) {
      dispatch({ type: 'SET_STEM_START', key: stemDragKey, startBar })
      return
    }

    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId, startBar })
  }
```

This applies uniformly to *every* drag onto the timeline, including a fresh shelf-to-timeline
placement — but that's fine: `getGrabOffsetBars()` reads whatever was last set, and nothing in
`Shelf.tsx`'s own `onDragStart` (which only sets `'text/rifff-group-id'`, unchanged by this
plan) ever calls `setGrabOffsetBars`, so it keeps returning whatever the *previous* drag left
behind — which could be stale and wrong for a shelf placement immediately following an
in-arranger reposition. Fix this by having `Shelf.tsx`'s drag source explicitly zero it out too
— see Step 8.

- [ ] **Step 8: Zero the grab offset for shelf-to-timeline drags**

Read `src/renderer/src/components/Shelf.tsx` in full. Find:

```tsx
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
            }}
```

Add the import:

```ts
import { setGrabOffsetBars } from './dragGrabOffset'
```

Change to:

```tsx
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
              // Not yet placed — there's no existing on-timeline position to
              // preserve an offset from, and without this the module could
              // still be holding a stale value left behind by a previous
              // in-arranger reposition drag.
              setGrabOffsetBars(0)
            }}
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `dragGrabOffset.test.ts`.

- [ ] **Step 11: Manual verification**

In the dev app: place a rifff, then drag it again from a point roughly in the middle of its
waveform (not its very left edge) to a new position. Confirm the clip moves by exactly the
distance you dragged — its start bar shifts by the same amount your mouse moved, rather than
snapping its start to land under your mouse. Repeat for an unlinked stem's own drag (via its
left name/mute column). Then drag a *fresh* rifff from the shelf onto an empty part of the
timeline and confirm it still lands exactly where you drop it (no leftover offset from the
previous test).

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/components/dragGrabOffset.ts src/renderer/src/components/dragGrabOffset.test.ts src/renderer/src/components/RifffBlockRow.tsx src/renderer/src/components/StemWaveformRow.tsx src/renderer/src/components/Shelf.tsx src/renderer/src/App.tsx
git commit -m "Preserve grab-point offset when repositioning a placed clip"
```

---

### Task 5: Trim explanatory UI text

**Files:**
- Modify: `src/renderer/src/components/Shelf.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`
- Modify: `src/renderer/src/components/Inspector.tsx`

- [ ] **Step 1: Shelf — remove the eyebrow/hint line, shrink the drop zone's text to "+"**

In `src/renderer/src/components/Shelf.tsx`, find:

```tsx
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="ra-eyebrow">shelf</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-4)' }}>
          drag one down into the arrangement · stems land linked and pre-aligned
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
```

Remove the whole eyebrow/hint `<div>` block:

```tsx
      <div style={{ display: 'flex', gap: 10 }}>
```

Then find the drop zone:

```tsx
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
```

Replace the two-line text with a single "+", and drop the now-unused `flexDirection`/`textAlign`
(kept only for the two-line layout):

```tsx
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          title="drop rifff folders, or stems straight from endlesss"
          style={{
            flex: 1,
            minWidth: 150,
            height: 78,
            border: `1px dashed ${dragOver ? 'var(--ra-text-2)' : 'var(--ra-border-strong)'}`,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            color: 'var(--ra-text-3)'
          }}
        >
          +
        </div>
```

The `title` attribute keeps the original explanation available as a hover tooltip rather than
dropping it entirely — drag-and-drop behavior (`onDragOver`/`onDrop`) is unchanged.

- [ ] **Step 2: TransportBar — remove the stale hint and the "tempo" eyebrow**

In `src/renderer/src/components/TransportBar.tsx`, find:

```tsx
        <span className="ra-eyebrow">tempo</span>
        <button
          onClick={() => dispatch({ type: 'SET_TEMPO', bpm: state.bpm - 1 })}
```

Remove the `<span className="ra-eyebrow">tempo</span>` line, leaving the `<button>` as the
first child of that flex container.

Then find:

```tsx
      <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ra-text-3)' }}>
        chevron opens stems · block selects
      </div>
```

Remove this whole `<div>` block (the chevron it refers to no longer exists — it was removed
along with the collapsed/combined-clip view earlier in this session's arranger-stem-controls
work).

- [ ] **Step 3: Inspector — remove the "tempo" eyebrow**

In `src/renderer/src/components/Inspector.tsx`, find:

```tsx
      {section(
        <>
          <span className="ra-eyebrow">tempo</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
```

Remove the `<span className="ra-eyebrow">tempo</span>` line, leaving the `<div>` as the first
child of the fragment.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors (pre-existing warnings in unrelated files are fine).

- [ ] **Step 5: Manual verification**

In the dev app: confirm the shelf shows a plain "+" drop zone with no title text or hint line
above it (hovering over the drop zone should still show the original explanation as a browser
tooltip). Confirm the transport bar's tempo control has no "tempo" label and the trailing
"chevron opens stems" hint is gone. Confirm the Inspector's tempo section has no "tempo" label
either.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Shelf.tsx src/renderer/src/components/TransportBar.tsx src/renderer/src/components/Inspector.tsx
git commit -m "Trim explanatory UI text for a more minimal, compact look"
```

---

### Final task: Whole-implementation review

- [ ] **Step 1: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all pass.

- [ ] **Step 2: Re-read the design spec**

Re-read `docs/superpowers/specs/2026-07-29-arranger-quick-fixes-design.md` end to end and
confirm each of the five numbered items is fully addressed by Tasks 1-5 above, including the
"Testing" section's notes.

- [ ] **Step 3: Manual smoke test of all five together**

Start the dev app and walk through all five behaviors in one session (double-click volume
reset, a fade drag, a nudge click, a reposition drag preserving grab offset, and the trimmed UI
text) to confirm none of them interact badly with each other.

- [ ] **Step 4: Use superpowers:finishing-a-development-branch**

Follow that skill to verify tests, present completion options, and handle cleanup.
