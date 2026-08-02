# Timeline Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ableton-style `Cmd+scroll` horizontal timeline zoom (cursor-anchored, `Cmd+0` to reset) to sssketch's arranger, and remove the now-redundant `'compact'` arranger mode entirely.

**Architecture:** A new zoom multiplier lives as view-only React state in `StoreProvider` (not the undo-tracked reducer), exposed via a new `ZoomCtx`/`useZoom()` hook that returns the effective pixels-per-bar (PPB). Every component that today imports the hardcoded `PPB` constant switches to reading this hook instead. `'compact'` mode — a separate `ArrangerMode` value with its own simplified rendering component (`CompactRifffBlock`) — is deleted outright, since continuous zoom now covers the same need.

**Tech Stack:** React (hooks/context), TypeScript, Vitest.

---

### Task 1: Zoom state, ZoomCtx, and SET_ZOOM/RESET_ZOOM actions

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

No dedicated test — this mirrors how `PLAY`/`PAUSE`/`STOP`/`SET_POS` are already handled in this exact file (intercepted before the undo-tracked reducer, no unit test of their own, verified through the app's own manual behavior), so this task follows that established precedent.

- [ ] **Step 1: Extend `TransportAction` with zoom actions**

Find this near the top of the file:

```ts
export type TransportAction =
  { type: 'PLAY' } | { type: 'PAUSE' } | { type: 'STOP' } | { type: 'SET_POS'; pos: number }
```

Change it to:

```ts
export type TransportAction =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SET_POS'; pos: number }
  | { type: 'SET_ZOOM'; multiplier: number }
  | { type: 'RESET_ZOOM' }
```

- [ ] **Step 2: Add the `ZoomCtx` context**

Find this line:

```ts
const PlayingCtx = createContext<boolean>(false)
```

Add right after it:

```ts
// Effective pixels-per-bar (base PPB * the current zoom multiplier) --
// consumers read this instead of importing the old hardcoded PPB constant
// directly, so the whole timeline zooms together. Separate context (not
// folded into AppState) for the same reason PosCtx/PlayingCtx are separate:
// zoom changes on every scroll tick, and only the handful of components
// that actually render at a bar<->pixel scale need to re-render when it
// changes.
const ZoomCtx = createContext<number>(24)
```

- [ ] **Step 3: Add the zoom multiplier state**

Find this line inside `StoreProvider`:

```ts
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
```

Add right after it:

```ts
  // View-only (not undo-tracked, not persisted -- see ArrangerMode's own
  // "Not persisted" doc comment in store.ts for the same reasoning): resets
  // to 1 on every app launch. 24 is the base PPB (Ruler.tsx); effective PPB
  // is BASE_PPB * zoomMultiplier, computed once below rather than at every
  // call site.
  const [zoomMultiplier, setZoomMultiplier] = useState(1)
```

- [ ] **Step 4: Handle SET_ZOOM/RESET_ZOOM in the dispatch interceptor**

Find this in the `dispatch` callback:

```ts
      case 'SET_POS':
        setPos(action.pos)
        return
```

Add right after it:

```ts
      case 'SET_ZOOM':
        setZoomMultiplier(action.multiplier)
        return
      case 'RESET_ZOOM':
        setZoomMultiplier(1)
        return
```

- [ ] **Step 5: Provide the zoom value**

Find:

```tsx
        <PosCtx.Provider value={pos}>
          <PlayingCtx.Provider value={playing}>
```

Change to:

```tsx
        <PosCtx.Provider value={pos}>
          <PlayingCtx.Provider value={playing}>
            <ZoomCtx.Provider value={24 * zoomMultiplier}>
```

And find its matching closing tags:

```tsx
          </PlayingCtx.Provider>
        </PosCtx.Provider>
```

Change to:

```tsx
            </ZoomCtx.Provider>
          </PlayingCtx.Provider>
        </PosCtx.Provider>
```

- [ ] **Step 6: Export the `useZoom` hook**

Find:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePlaying(): boolean {
  return useContext(PlayingCtx)
}
```

Add right after it:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useZoom(): number {
  return useContext(ZoomCtx)
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "Add zoom multiplier state, ZoomCtx, and SET_ZOOM/RESET_ZOOM actions"
```

---

### Task 2: Zoom math pure functions

**Files:**
- Create: `src/renderer/src/components/zoomMath.ts`
- Test: `src/renderer/src/components/zoomMath.test.ts`

Matches this codebase's established convention of extracting drag/gesture math into pure, fully-tested sibling modules (see `oneShotResize.ts`, `dragGrabOffset.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/components/zoomMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  MIN_ZOOM_MULTIPLIER,
  MAX_ZOOM_MULTIPLIER,
  DEFAULT_ZOOM_MULTIPLIER,
  clampZoomMultiplier,
  zoomMultiplierForWheelDelta,
  scrollLeftForZoomChange
} from './zoomMath'

describe('clampZoomMultiplier', () => {
  it('leaves a value inside the range unchanged', () => {
    expect(clampZoomMultiplier(1.5)).toBe(1.5)
  })

  it('clamps a value below MIN_ZOOM_MULTIPLIER up to the minimum', () => {
    expect(clampZoomMultiplier(0.01)).toBe(MIN_ZOOM_MULTIPLIER)
  })

  it('clamps a value above MAX_ZOOM_MULTIPLIER down to the maximum', () => {
    expect(clampZoomMultiplier(100)).toBe(MAX_ZOOM_MULTIPLIER)
  })
})

describe('zoomMultiplierForWheelDelta', () => {
  it('increases the multiplier for a negative deltaY (scroll up = zoom in)', () => {
    const result = zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, -10)
    expect(result).toBeGreaterThan(DEFAULT_ZOOM_MULTIPLIER)
  })

  it('decreases the multiplier for a positive deltaY (scroll down = zoom out)', () => {
    const result = zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, 10)
    expect(result).toBeLessThan(DEFAULT_ZOOM_MULTIPLIER)
  })

  it('never goes below MIN_ZOOM_MULTIPLIER even with a huge positive deltaY', () => {
    expect(zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, 100000)).toBe(MIN_ZOOM_MULTIPLIER)
  })

  it('never goes above MAX_ZOOM_MULTIPLIER even with a huge negative deltaY', () => {
    expect(zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, -100000)).toBe(MAX_ZOOM_MULTIPLIER)
  })
})

describe('scrollLeftForZoomChange', () => {
  it('keeps the bar under the cursor at the same screen position after zooming in', () => {
    // scrollLeft=0, cursor at 100px, old ppb=24 -- bar under cursor is
    // (0+100)/24 = 4.1666...; zooming to ppb=48 should put that same bar's
    // pixel position (4.1666*48=200) at cursorX (100), so scrollLeft=100.
    const result = scrollLeftForZoomChange(0, 100, 24, 48)
    expect(result).toBeCloseTo(100, 5)
  })

  it('round-trips back to the original scrollLeft when zooming back out', () => {
    const zoomedIn = scrollLeftForZoomChange(0, 100, 24, 48)
    const zoomedBackOut = scrollLeftForZoomChange(zoomedIn, 100, 48, 24)
    expect(zoomedBackOut).toBeCloseTo(0, 5)
  })

  it('never returns a negative scrollLeft', () => {
    // Cursor near the very start, zooming out -- the naive formula would
    // go negative; must clamp to 0.
    const result = scrollLeftForZoomChange(0, 5, 48, 6)
    expect(result).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/zoomMath.test.ts`
Expected: FAIL — `Cannot find module './zoomMath'` (the file doesn't exist yet)

- [ ] **Step 3: Implement `zoomMath.ts`**

Create `src/renderer/src/components/zoomMath.ts`:

```ts
// src/renderer/src/components/zoomMath.ts

export const MIN_ZOOM_MULTIPLIER = 0.25
export const MAX_ZOOM_MULTIPLIER = 4
export const DEFAULT_ZOOM_MULTIPLIER = 1

// Tuned by feel -- roughly a doubling in multiplier per ~70 units of wheel
// delta, which on a typical trackpad/mouse wheel reads as "a few brisk
// scroll ticks to go from min to max zoom," not an imperceptible creep or
// an overshoot-prone jump.
const ZOOM_WHEEL_SENSITIVITY = 0.01

export function clampZoomMultiplier(multiplier: number): number {
  return Math.max(MIN_ZOOM_MULTIPLIER, Math.min(MAX_ZOOM_MULTIPLIER, multiplier))
}

/** Ableton-style: a negative deltaY (scrolling up/away from you) zooms in
 * (multiplier increases); a positive deltaY (scrolling down/toward you)
 * zooms out. */
export function zoomMultiplierForWheelDelta(currentMultiplier: number, deltaY: number): number {
  return clampZoomMultiplier(currentMultiplier * (1 - deltaY * ZOOM_WHEEL_SENSITIVITY))
}

/** The scrollLeft that keeps the bar currently under the cursor at the same
 * on-screen (local-to-container) x position after the pixels-per-bar scale
 * changes from oldPpb to newPpb -- the cursor-anchored zoom Ableton and most
 * other DAWs use. Clamped to never go negative (the DOM would silently clamp
 * a negative scrollLeft to 0 anyway, but computing it explicitly here keeps
 * this function's contract self-contained and testable on its own). */
export function scrollLeftForZoomChange(
  oldScrollLeft: number,
  cursorXInContainer: number,
  oldPpb: number,
  newPpb: number
): number {
  const barUnderCursor = (oldScrollLeft + cursorXInContainer) / oldPpb
  return Math.max(0, barUnderCursor * newPpb - cursorXInContainer)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/zoomMath.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/zoomMath.ts src/renderer/src/components/zoomMath.test.ts
git commit -m "Add zoomMath pure functions for clamping, wheel-delta, and cursor-anchor scroll compensation"
```

---

### Task 3: Wire Cmd+scroll zoom and Cmd+0 reset into App.tsx

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import `useZoom`, `zoomMath`, and the `WheelEvent` type**

Find:

```ts
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  StoreProvider,
  useAppState,
  useDispatch,
  useHistory,
  usePlaying,
  usePos
} from './state/StoreContext'
```

Change to:

```ts
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type WheelEvent
} from 'react'
import {
  StoreProvider,
  useAppState,
  useDispatch,
  useHistory,
  usePlaying,
  usePos,
  useZoom
} from './state/StoreContext'
```

And find:

```ts
import { Ruler, PPB, COMPACT_PPB } from './components/Ruler'
```

Change to:

```ts
import { Ruler, PPB } from './components/Ruler'
import { zoomMultiplierForWheelDelta, scrollLeftForZoomChange } from './components/zoomMath'
```

(`COMPACT_PPB` is removed from this import entirely -- Task 6 removes it from `Ruler.tsx`.)

- [ ] **Step 2: Switch Timeline's `ppb` to `useZoom()`**

Find, inside the `Timeline` function:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const [dropBar, setDropBar] = useState<number | null>(null)
  // Compact mode uses its own, much denser horizontal scale (see Ruler.tsx)
  // — every bar<->pixel conversion below has to agree on which one is
  // active, so this is threaded through drag/drop math and into the Ruler/
  // Playhead/drop-indicator this component renders, rather than assuming
  // the shared PPB everywhere.
  const ppb = state.mode === 'compact' ? COMPACT_PPB : PPB
```

Change to:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const [dropBar, setDropBar] = useState<number | null>(null)
  const ppb = useZoom()
```

- [ ] **Step 3: Add zoom wiring to `Frame`**

Find, inside the `Frame` function:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const history = useHistory()
  const playing = usePlaying()
  const pos = usePos()
```

Change to:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const history = useHistory()
  const playing = usePlaying()
  const pos = usePos()
  const ppb = useZoom()
```

- [ ] **Step 4: Add the Cmd+0 reset-zoom keyboard shortcut**

Find the Cmd/Ctrl+Z undo/redo `useEffect` block (search for `isUndo`), and add this new `useEffect` right after its closing `}, [history])`:

```ts
  // Cmd/Ctrl+0 resets zoom to its default level -- the standard "reset
  // zoom" convention across creative and browser apps. Skipped while focus
  // is in a text input, same pattern as every other global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '0') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'RESET_ZOOM' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])
```

- [ ] **Step 5: Add the Cmd+scroll wheel-zoom handler and its scroll-compensation effect**

Find, right after the `scrollContainerRef`/`panning` declarations (search for `const [panning, setPanning] = useState(false)`), and add this right after that line:

```ts
  // Captured by handleTimelineWheel, consumed by the effect below once the
  // zoom multiplier actually changes and the DOM has re-rendered at the new
  // scale -- setting scrollLeft synchronously in the same handler that
  // dispatches the zoom change would compute against the OLD (pre-re-render)
  // scrollWidth and could get silently clamped by the browser before React
  // ever grows the content to the new width.
  const pendingZoomAnchorRef = useRef<{
    cursorXInContainer: number
    oldScrollLeft: number
    oldPpb: number
  } | null>(null)

  function handleTimelineWheel(e: WheelEvent<HTMLDivElement>): void {
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const container = scrollContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    pendingZoomAnchorRef.current = {
      cursorXInContainer: e.clientX - rect.left,
      oldScrollLeft: container.scrollLeft,
      oldPpb: ppb
    }
    const currentMultiplier = ppb / PPB
    dispatch({ type: 'SET_ZOOM', multiplier: zoomMultiplierForWheelDelta(currentMultiplier, e.deltaY) })
  }

  useEffect(() => {
    const anchor = pendingZoomAnchorRef.current
    const container = scrollContainerRef.current
    if (!anchor || !container) return
    pendingZoomAnchorRef.current = null
    container.scrollLeft = scrollLeftForZoomChange(
      anchor.oldScrollLeft,
      anchor.cursorXInContainer,
      anchor.oldPpb,
      ppb
    )
  }, [ppb])
```

- [ ] **Step 6: Attach the wheel handler to the scroll container**

Find:

```tsx
            <div ref={scrollContainerRef} style={{ height: '100%', overflowX: 'auto' }}>
```

Change to:

```tsx
            <div
              ref={scrollContainerRef}
              onWheel={handleTimelineWheel}
              style={{ height: '100%', overflowX: 'auto' }}
            >
```

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npx eslint src/renderer/src/App.tsx`
Expected: no errors (fix any prettier-only warnings with `npx eslint src/renderer/src/App.tsx --fix` and re-run)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire Cmd+scroll cursor-anchored zoom and Cmd+0 reset into the timeline"
```

---

### Task 4: Migrate CollapsedRifffRow.tsx and RifffBlockRow.tsx off the static PPB import

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`

`CollapsedRifffRow.tsx` uses `PPB` as a bare identifier in ~14 places throughout the component body. Rather than rename every call site, this shadows the same name with a local `const PPB = useZoom()` so every existing usage keeps working unchanged. `RifffBlockRow.tsx` also loses its `compact`/`COMPACT_PPB` branching here, since that's the same `ppb`-computation line this task is already touching (kept in this task rather than Task 6, to avoid two separate edits to the same line).

- [ ] **Step 1: `CollapsedRifffRow.tsx` — swap the import for the hook**

Find:

```ts
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
```

Change to:

```ts
import { useAppState, useDispatch, usePlaying, useZoom } from '../state/StoreContext'
```

Find:

```ts
import { PPB } from './Ruler'
```

Delete this line entirely.

- [ ] **Step 2: `CollapsedRifffRow.tsx` — add the local `PPB` const**

Find, near the top of the `CollapsedRifffRow` function body:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
```

Change to:

```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  // Shadows the name every existing PPB reference in this file already
  // uses -- see zoomMath.ts/useZoom's own doc comments for what this value
  // actually is (base PPB * the current zoom multiplier).
  const PPB = useZoom()
```

- [ ] **Step 3: `RifffBlockRow.tsx` — swap the import and the `ppb`/`compact` computation**

Find:

```ts
import { useAppState, useDispatch } from '../state/StoreContext'
```

Change to:

```ts
import { useAppState, useDispatch, useZoom } from '../state/StoreContext'
```

Find:

```ts
import { PPB, COMPACT_PPB } from './Ruler'
```

Delete this line entirely.

Find:

```ts
  const compact = state.mode === 'compact'
```

Delete this line entirely (compact mode no longer exists as of Task 6 -- this task removes the reference to it here since it's on the exact line being changed anyway).

Find:

```ts
  const ppb = compact ? COMPACT_PPB : PPB
```

Change to:

```ts
  const ppb = useZoom()
```

Find the early-return branch just above that line:

```ts
  if (compact && !expanded) {
    return <CompactRifffBlock groupId={groupId} onOpenContextMenu={onOpenContextMenu} />
  }
```

Delete this block entirely (also part of compact-mode removal, on lines this task is already touching -- Task 6 handles deleting `CompactRifffBlock.tsx` itself and its now-unused import here).

Find:

```ts
import { CompactRifffBlock } from './CompactRifffBlock'
```

Delete this line entirely.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npx eslint src/renderer/src/components/CollapsedRifffRow.tsx src/renderer/src/components/RifffBlockRow.tsx`
Expected: no errors (fix any prettier-only warnings with `--fix` and re-run)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx src/renderer/src/components/RifffBlockRow.tsx
git commit -m "Migrate CollapsedRifffRow/RifffBlockRow to zoom-reactive PPB, drop compact-mode branch"
```

---

### Task 5: Make Playhead and StemWaveformRow's `ppb` prop required

**Files:**
- Modify: `src/renderer/src/components/Playhead.tsx`
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

Both components only ever receive `ppb` as an explicit prop from their one real call site each (`App.tsx`'s `<Playhead ppb={ppb} />`, `RifffBlockRow.tsx`'s `<StemWaveformRow ... ppb={ppb} />` -- both already updated by Tasks 3/4 to pass the zoom-reactive value). Their own `ppb = PPB` default-parameter fallback was already dead in practice; rather than call `useZoom()` inside a default-parameter expression (awkward, and hooks shouldn't be called there), this makes `ppb` a required prop and removes the now-unused `PPB` import and fallback entirely.

- [ ] **Step 1: `Playhead.tsx`**

Replace the entire file:

```tsx
import { usePos } from '../state/StoreContext'

export function Playhead({ ppb }: { ppb: number }): React.JSX.Element {
  const pos = usePos()
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: pos * ppb,
        width: 1,
        background: 'var(--ra-playhead)',
        pointerEvents: 'none'
      }}
    />
  )
}
```

- [ ] **Step 2: `StemWaveformRow.tsx`**

Find:

```ts
import { PPB } from './Ruler'
```

Delete this line entirely.

Find:

```ts
export function StemWaveformRow({
  groupId,
  slot,
  ppb = PPB
}: {
  groupId: string
  slot: number
  /** Horizontal scale — defaults to Normal mode's own PPB, but Compact
   * mode's expanded-stem view (see RifffBlockRow) passes COMPACT_PPB
   * instead, so an expanded rifff's stems stay aligned with the rest of
   * that compact timeline (Ruler, other clips) instead of quietly reverting
   * to Normal mode's much wider spacing underneath it. */
  ppb?: number
}): React.JSX.Element {
```

Change to:

```ts
export function StemWaveformRow({
  groupId,
  slot,
  ppb
}: {
  groupId: string
  slot: number
  /** Horizontal scale, in pixels-per-bar -- the caller's own zoom-reactive
   * value (see RifffBlockRow, App.tsx's Timeline), threaded through rather
   * than read directly so every stem row in the arranger always agrees
   * with the Ruler/Playhead/clip blocks around it. */
  ppb: number
}): React.JSX.Element {
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npx eslint src/renderer/src/components/Playhead.tsx src/renderer/src/components/StemWaveformRow.tsx`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Playhead.tsx src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Make Playhead/StemWaveformRow's ppb prop required, drop dead PPB fallback"
```

---

### Task 6: Remove compact mode

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/selectors.ts`
- Modify: `src/renderer/src/components/Ruler.tsx`
- Modify: `src/renderer/src/App.tsx`
- Delete: `src/renderer/src/components/CompactRifffBlock.tsx`

Tasks 3 and 4 already removed every *usage* of `'compact'`/`COMPACT_PPB`/`CompactRifffBlock` from `App.tsx`/`RifffBlockRow.tsx`. This task removes what's left: the type/selector definitions, the constant's own declaration, and the file itself.

- [ ] **Step 1: `store.ts` — narrow `ArrangerMode`**

Find:

```ts
export type ArrangerMode = 'normal' | 'compact' | 'sketch'
```

Change to:

```ts
export type ArrangerMode = 'normal' | 'sketch'
```

- [ ] **Step 2: `selectors.ts` — simplify `nextArrangerMode`**

Find:

```ts
const ARRANGER_MODE_ORDER: ArrangerMode[] = ['normal', 'compact', 'sketch']

/** What Tab / the TransportBar's mode button should switch to next —
 * normal -> compact -> sketch -> normal, skipping 'sketch' entirely (landing
 * on 'normal' instead) when isSketchEligible(state) is false, so the toggle
 * never lands on a mode it can't actually show. */
export function nextArrangerMode(state: AppState): ArrangerMode {
  const next = ARRANGER_MODE_ORDER[(ARRANGER_MODE_ORDER.indexOf(state.mode) + 1) % 3]
  if (next === 'sketch' && !isSketchEligible(state)) {
    return ARRANGER_MODE_ORDER[(ARRANGER_MODE_ORDER.indexOf(next) + 1) % 3]
  }
  return next
}
```

Change to:

```ts
/** What Tab / the TransportBar's mode button should switch to next —
 * normal <-> sketch, staying on 'normal' when isSketchEligible(state) is
 * false, so the toggle never lands on a mode it can't actually show. */
export function nextArrangerMode(state: AppState): ArrangerMode {
  if (state.mode === 'sketch') return 'normal'
  return isSketchEligible(state) ? 'sketch' : 'normal'
}
```

- [ ] **Step 3: `Ruler.tsx` — remove `COMPACT_PPB`**

Find:

```ts
const PPB = 24

// Compact mode's own, much denser horizontal scale — deliberately a
// separate constant (not a shrunk row height on the same PPB Normal mode
// uses) so far more bars fit in the same viewport width, matching "compact
// horizontally too, not just vertically." Every bar<->pixel conversion the
// timeline uses (Ruler's own ticks, clipGeometry, drag/drop position math)
// has to agree on which scale is active, so this is threaded through
// wherever state.mode is checked rather than hardcoded — see Timeline in
// App.tsx for the single place that decides which one applies.
const COMPACT_PPB = 2
```

Change to:

```ts
const PPB = 24
```

Find:

```ts
export { PPB, COMPACT_PPB }
```

Change to:

```ts
export { PPB }
```

- [ ] **Step 4: `App.tsx` — remove `COMPACT_ROW_HEIGHT` usage**

Find:

```ts
import { COMPACT_ROW_HEIGHT } from './components/CompactRifffBlock'
```

Delete this line entirely.

Find:

```ts
  const ghostRowHeight = state.mode === 'compact' ? COMPACT_ROW_HEIGHT : GHOST_ROW_HEIGHT
```

Change to:

```ts
  const ghostRowHeight = GHOST_ROW_HEIGHT
```

- [ ] **Step 5: Delete `CompactRifffBlock.tsx`**

```bash
rm src/renderer/src/components/CompactRifffBlock.tsx
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors (this is where any leftover reference to the deleted `'compact'` value, `COMPACT_PPB`, or `CompactRifffBlock` would surface as a real compile error)

Run: `npx eslint .`
Expected: no errors (fix any prettier-only warnings with `--fix` and re-run)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Remove compact arranger mode entirely -- zoom now covers the same need"
```

---

### Task 7: Final verification + manual walkthrough report

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run, in order:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
```

Expected: all clean/passing. (`pluginScan.test.ts`'s `scanOneCandidate` test is a known-flaky, unrelated real-subprocess test — see git history; if only that one fails, re-run it alone to confirm before treating it as a regression.)

- [ ] **Step 2: Report manual verification checklist to the user**

This feature can't be exercised by an automated test (no GUI interaction tooling, no React interaction-test harness in this codebase). Report clearly that automated checks (types, lint, unit tests) all pass, and that these need a real walkthrough:

1. `Cmd+scroll` over the timeline zooms in/out smoothly; the bar under the cursor visibly stays under the cursor throughout.
2. Plain scroll (trackpad or scrollbar) still pans exactly as before — no change in feel.
3. `Cmd+0` snaps back to the default zoom level from any zoomed-in/out state.
4. Zoom stops changing at the min/max bounds rather than continuing indefinitely or glitching.
5. Tab (or the TransportBar mode button) now cycles only between Normal and Sketch mode — Compact is gone from the cycle entirely.
6. Every clip interaction (drag, resize, mute, envelope, one-shot trim/stretch) still works correctly at multiple zoom levels, not just the default.
7. Zoom resets to default after quitting and relaunching the app (confirming it's correctly not persisted).
8. The existing hand-pan tool (hold `M`, drag to pan) still works correctly alongside the new zoom.
