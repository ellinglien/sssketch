# Live Drag Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift per-component local drag-preview state (volume, fade-in, fade-out, played-bars,
left-crop) into shared store state so sibling stems in an expanded rifff track a drag live, and
push volume/fade changes to the native engine live during playback — safely, by first hardening
`PlaybackEngine`'s cross-thread project handoff.

**Architecture:** Renderer: one generic `SET_DRAG_PREVIEW` action (plus a small
`SET_DRAG_PREVIEW_GROUP_VOLUME` companion for the collapsed view's group-level volume drag)
replaces five local `useState` preview variables with shared, transient (undo-excluded) store
fields; every same-group component instance reads the same value. Native: `PlaybackEngine`'s
`currentProject`/`channelGroups`/scratch buffers become one atomically-published
`ProjectSnapshot`, mirroring `ChannelChainRegistry`'s existing publish pattern exactly, so
`setProject()` can safely be called at drag frequency. Renderer: the existing engine-sync effect
in `StoreContext.tsx` gains the new draft fields (volume/fade only) to its dependency array, with
sends coalesced to once per animation frame.

**Tech Stack:** TypeScript/React (renderer), JUCE/C++ (native engine), Vitest, JUCE
`UnitTestRunner`.

---

### Task 1: Renderer state — shared drag-preview fields + actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.test.ts`, right after the existing `describe('SET_LEFT_CROP_BARS', ...)` block (ends around line 567):

```ts
  describe('SET_DRAG_PREVIEW', () => {
    it('sets a volume preview for the given stem key, without touching committed vol', () => {
      const next = reducer(initialState, {
        type: 'SET_DRAG_PREVIEW',
        field: 'volume',
        key: 'r1:1',
        value: 0.3
      })
      expect(next.dragVol['r1:1']).toBe(0.3)
      expect(next.vol['r1:1']).toBeUndefined()
    })

    it('clears a preview when value is undefined', () => {
      let state = reducer(initialState, {
        type: 'SET_DRAG_PREVIEW',
        field: 'fadeIn',
        key: 'r1',
        value: 1.5
      })
      expect(state.dragFadeIn.r1).toBe(1.5)
      state = reducer(state, {
        type: 'SET_DRAG_PREVIEW',
        field: 'fadeIn',
        key: 'r1',
        value: undefined
      })
      expect(state.dragFadeIn.r1).toBeUndefined()
    })

    it('supports each of the five fields independently', () => {
      let state = reducer(initialState, {
        type: 'SET_DRAG_PREVIEW',
        field: 'fadeOut',
        key: 'r1',
        value: 2
      })
      state = reducer(state, {
        type: 'SET_DRAG_PREVIEW',
        field: 'playedBars',
        key: 'r1',
        value: 8
      })
      state = reducer(state, {
        type: 'SET_DRAG_PREVIEW',
        field: 'leftCropBars',
        key: 'r1',
        value: -1
      })
      expect(state.dragFadeOut.r1).toBe(2)
      expect(state.dragPlayedBars.r1).toBe(8)
      expect(state.dragLeftCropBars.r1).toBe(-1)
    })
  })

  describe('SET_DRAG_PREVIEW_GROUP_VOLUME', () => {
    it('sets a volume preview for every stem in the group, matching SET_GROUP_VOLUME\'s own fan-out', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, {
        type: 'SET_DRAG_PREVIEW_GROUP_VOLUME',
        groupId: 'r1',
        value: 0.4
      })
      expect(state.dragVol['r1:1']).toBe(0.4)
      expect(state.dragVol['r1:6']).toBe(0.4)
    })

    it('clears every stem\'s preview when value is undefined', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, {
        type: 'SET_DRAG_PREVIEW_GROUP_VOLUME',
        groupId: 'r1',
        value: 0.4
      })
      state = reducer(state, {
        type: 'SET_DRAG_PREVIEW_GROUP_VOLUME',
        groupId: 'r1',
        value: undefined
      })
      expect(state.dragVol['r1:1']).toBeUndefined()
      expect(state.dragVol['r1:6']).toBeUndefined()
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `SET_DRAG_PREVIEW`/`SET_DRAG_PREVIEW_GROUP_VOLUME` aren't valid `Action` types yet
(TypeScript compile error surfaced through vitest) and `dragVol`/etc. don't exist on `AppState`.

- [ ] **Step 3: Add the five new state fields**

In `src/renderer/src/state/store.ts`, add to the `AppState` interface, right after the existing
`leftCrop: Record<string, number>` field (around line 68):

```ts
  /** In-progress preview values for an active drag, keyed the same way as
   * their committed counterpart (dragVol/stemKey, the rest/groupId) --
   * populated on every mousemove of a volume/fade/length/crop drag,
   * cleared on release. Transient (see history.ts's TRANSIENT_ACTION_TYPES)
   * -- these are UI/audio previews, never real edits worth an undo
   * checkpoint. Shared store state (not per-component useState) so every
   * component reading the same key -- e.g. every StemWaveformRow instance
   * sharing a groupId -- sees the SAME in-progress value live, not just the
   * one row actually being dragged. See
   * docs/superpowers/specs/2026-08-04-live-drag-preview-design.md. */
  dragVol: Record<string, number>
  dragFadeIn: Record<string, number>
  dragFadeOut: Record<string, number>
  dragPlayedBars: Record<string, number>
  dragLeftCropBars: Record<string, number>
```

And to `initialState`, right after the existing `leftCrop: {},` line (around line 168):

```ts
  dragVol: {},
  dragFadeIn: {},
  dragFadeOut: {},
  dragPlayedBars: {},
  dragLeftCropBars: {},
```

- [ ] **Step 4: Add the two new actions**

In `src/renderer/src/state/store.ts`'s `Action` union, right after the existing
`| { type: 'SET_LEFT_CROP_BARS'; groupId: string; bars: number }` line (around line 207):

```ts
  | {
      type: 'SET_DRAG_PREVIEW'
      field: 'volume' | 'fadeIn' | 'fadeOut' | 'playedBars' | 'leftCropBars'
      key: string
      value: number | undefined
    }
  | { type: 'SET_DRAG_PREVIEW_GROUP_VOLUME'; groupId: string; value: number | undefined }
```

- [ ] **Step 5: Add the two reducer cases**

In `src/renderer/src/state/store.ts`'s `reducer` function, right after the existing
`case 'SET_LEFT_CROP_BARS':` block (around line 422-426):

```ts
    // Live, in-progress preview for a drag still in flight -- see AppState's
    // own dragVol/etc. field comments. Each field maps to its own slice;
    // value: undefined deletes the key entirely (falls back to the
    // committed value everywhere it's read) rather than storing an
    // undefined placeholder.
    case 'SET_DRAG_PREVIEW': {
      const sliceKey = (
        {
          volume: 'dragVol',
          fadeIn: 'dragFadeIn',
          fadeOut: 'dragFadeOut',
          playedBars: 'dragPlayedBars',
          leftCropBars: 'dragLeftCropBars'
        } as const
      )[action.field]
      const next = { ...state[sliceKey] }
      if (action.value === undefined) delete next[action.key]
      else next[action.key] = action.value
      return { ...state, [sliceKey]: next }
    }

    // Group-level counterpart to SET_DRAG_PREVIEW's 'volume' field, mirroring
    // SET_GROUP_VOLUME's own fan-out -- the collapsed view's envelope drag
    // controls every stem in the rifff together, so its live preview must
    // fan out to every stem's own dragVol entry the same way, not just one.
    case 'SET_DRAG_PREVIEW_GROUP_VOLUME': {
      const rifff = state.rifffs[action.groupId]
      const dragVol = { ...state.dragVol }
      for (const stem of rifff.stems) {
        const key = stemKey(action.groupId, stem.slot)
        if (action.value === undefined) delete dragVol[key]
        else dragVol[key] = action.value
      }
      return { ...state, dragVol }
    }
```

- [ ] **Step 6: Add both actions to TRANSIENT_ACTION_TYPES**

In `src/renderer/src/state/history.ts`, add to the `TRANSIENT_ACTION_TYPES` set (around line 23-36),
right after `'SET_AVAILABLE_INPUT_DEVICES'`:

```ts
  'SET_AVAILABLE_INPUT_DEVICES',
  // Fired on every mousemove of a volume/fade/length/crop drag (see
  // AppState's own dragVol/etc. field comments) -- an undo checkpoint per
  // mousemove would flood the undo stack meaninglessly; the REAL edit is
  // whatever commit action (SET_VOLUME, SET_FADE_IN, ...) fires once on
  // release, which is NOT in this set.
  'SET_DRAG_PREVIEW',
  'SET_DRAG_PREVIEW_GROUP_VOLUME'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS, all tests including the 5 new ones.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/history.ts src/renderer/src/state/store.test.ts
git commit -m "Add shared, transient drag-preview state for volume/fade/length/crop"
```

---

### Task 2: `StemWaveformRow.tsx` — read/write the shared preview

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

No new automated tests — this codebase's own convention is that React components are verified via
typecheck/lint + manual walkthrough (see CLAUDE.md's testing-conventions section), not unit-tested
directly.

- [ ] **Step 1: Replace the five local `useState` preview variables with store reads**

In `src/renderer/src/components/StemWaveformRow.tsx`, replace (around line 66-70):

```ts
  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const [dragLeftCropBars, setDragLeftCropBars] = useState<number | null>(null)
  const [dragFadeIn, setDragFadeIn] = useState<number | null>(null)
  const [dragFadeOut, setDragFadeOut] = useState<number | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)
```

with:

```ts
  // Shared, store-backed live preview -- NOT local useState -- so every
  // StemWaveformRow instance sharing this groupId (every stem in the same
  // expanded rifff) sees the SAME in-progress value while ANY one of them
  // is being dragged, not just the row actually under the mouse. See
  // docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
  const dragPlayedBars = useAppSelector((s) => s.dragPlayedBars[groupId] ?? null)
  const dragLeftCropBars = useAppSelector((s) => s.dragLeftCropBars[groupId] ?? null)
  const dragFadeIn = useAppSelector((s) => s.dragFadeIn[groupId] ?? null)
  const dragFadeOut = useAppSelector((s) => s.dragFadeOut[groupId] ?? null)
  const dragVolume = useAppSelector((s) => s.dragVol[key] ?? null)
```

Then remove the now-unused `useState` import if nothing else in this file still uses it — check
with `grep -n "useState" src/renderer/src/components/StemWaveformRow.tsx` after this change; if
the only remaining match is the `import { useState } from 'react'` line itself, delete that
import line too.

- [ ] **Step 2: Dispatch instead of `setState` in `handleResizeStart`**

Replace (around line 165-193):

```ts
  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    // Captured in a plain closure variable rather than read back out of
    // dragPlayedBars state in onEnd: StrictMode double-invokes setState
    // updater FUNCTIONS in dev to catch impure updaters, so a dispatch
    // placed inside a `setDragPlayedBars((current) => ...)` callback would
    // fire twice per drag-release. Dispatching directly in onEnd, from a
    // value tracked outside React state, sidesteps that entirely — see
    // dragUtils.ts's own doc comment for the general rule this follows.
    let finalPlayedBars = startPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        // Snapped to whole bars, matching App.tsx's barForClientX — the same
        // grid other timeline drags (placing/moving a clip) already snap to.
        // Extending a loop makes sense in whole-bar increments (you're adding
        // another repeat, not fine sub-bar precision), and it keeps the tiled
        // waveform below landing on clean tile boundaries most of the time.
        finalPlayedBars = Math.max(MIN_PLAYED_BARS, Math.round(startPlayedBars + deltaX / ppb))
        setDragPlayedBars(finalPlayedBars)
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: finalPlayedBars })
        }
        setDragPlayedBars(null)
      }
    )
  }
```

with:

```ts
  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    // Captured in a plain closure variable, not read back out of store state
    // in onEnd -- same reasoning as before this preview moved into the
    // store: onMove/onEnd both fire outside React's render cycle, so a
    // value threaded through the closure is simpler and cheaper than a
    // round-trip through useAppSelector, and avoids a one-render-late read
    // if onEnd fired before the dispatch above it had a chance to commit.
    let finalPlayedBars = startPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        // Snapped to whole bars, matching App.tsx's barForClientX — the same
        // grid other timeline drags (placing/moving a clip) already snap to.
        // Extending a loop makes sense in whole-bar increments (you're adding
        // another repeat, not fine sub-bar precision), and it keeps the tiled
        // waveform below landing on clean tile boundaries most of the time.
        finalPlayedBars = Math.max(MIN_PLAYED_BARS, Math.round(startPlayedBars + deltaX / ppb))
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'playedBars',
          key: playedBarsKey,
          value: finalPlayedBars
        })
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: finalPlayedBars })
        }
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'playedBars', key: playedBarsKey, value: undefined })
      }
    )
  }
```

- [ ] **Step 3: Dispatch instead of `setState` in `handleLeftResizeStart`**

Replace (around line 195-224):

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
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'leftCropBars',
          key: groupId,
          value: finalLeftCropBars
        })
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_LEFT_CROP_BARS', groupId, bars: finalLeftCropBars })
        }
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'leftCropBars', key: groupId, value: undefined })
      }
    )
  }
```

- [ ] **Step 4: Dispatch instead of `setState` in `handleFadeInStart`/`handleFadeOutStart`**

Replace (around line 226-248):

```ts
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
          Math.min(FADE_MAX, startFadeIn + deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        setDragFadeIn(finalFadeIn)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        setDragFadeIn(null)
      }
    )
  }

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
          Math.min(FADE_MAX, startFadeOut - deltaX / (ppb * FADE_DRAG_SLOWDOWN))
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

with:

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
      }
    )
  }

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
          Math.min(FADE_MAX, startFadeOut - deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }
```

- [ ] **Step 5: Dispatch instead of `setState` in `handleVolumeStart`**

Replace (around line 309-328):

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    // Same closure-variable pattern as the handlers above: finalVolume is
    // tracked outside React state and dispatched directly in onEnd's body,
    // never from inside a setDragVolume updater function — see dragUtils.ts's
    // doc comment for why.
    let finalVolume = startVolume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        setDragVolume(finalVolume)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: finalVolume })
        setDragVolume(null)
      }
    )
  }
```

with:

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: finalVolume })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      }
    )
  }
```

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (No behavior beyond a mechanical state-source swap — every existing
`dragX !== null`/`dragX ?? committedX` read in this file is untouched, since the replaced
variables keep the exact same `number | null` type.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "StemWaveformRow: back live drag preview with shared store state"
```

---

### Task 3: `CollapsedRifffRow.tsx` — read/write the shared preview

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`

Same pattern as Task 2, applied to this file's own independent copy of the same drag-handler
logic (a pre-existing duplication in this codebase, not something this task fixes). The one
difference: this file's volume drag is group-level (`SET_GROUP_VOLUME`, fanning out to every
stem), so its live preview uses `SET_DRAG_PREVIEW_GROUP_VOLUME` instead of `SET_DRAG_PREVIEW`.

- [ ] **Step 1: Replace the five local `useState` preview variables with store reads**

Replace (around line 142-146):

```ts
  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const [dragLeftCropBars, setDragLeftCropBars] = useState<number | null>(null)
  const [dragFadeIn, setDragFadeIn] = useState<number | null>(null)
  const [dragFadeOut, setDragFadeOut] = useState<number | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)
```

with:

```ts
  // Shared, store-backed live preview -- see StemWaveformRow.tsx's identical
  // change and docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
  const dragPlayedBars = useAppSelector((s) => s.dragPlayedBars[groupId] ?? null)
  const dragLeftCropBars = useAppSelector((s) => s.dragLeftCropBars[groupId] ?? null)
  const dragFadeIn = useAppSelector((s) => s.dragFadeIn[groupId] ?? null)
  const dragFadeOut = useAppSelector((s) => s.dragFadeOut[groupId] ?? null)
  const dragVolume = useAppSelector((s) => s.dragVol[stemKey(groupId, firstStem.slot)] ?? null)
```

Leave the `oneShotDragPreview` local `useState` (right below, around line 154) untouched — it's a
different, one-shot-only preview this task doesn't cover (see its own doc comment: it holds
seconds-based trim/stretch values a bar-snapped drag preview can't represent).

Then check `grep -n "useState" src/renderer/src/components/CollapsedRifffRow.tsx` — if it's still
used for `oneShotDragPreview`, keep the import; it will be.

- [ ] **Step 2: Dispatch instead of `setState` in `handleResizeStart`**

Replace (around line 273-289):

```ts
  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    let finalPlayedBars = startPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        finalPlayedBars = Math.max(MIN_PLAYED_BARS, Math.round(startPlayedBars + deltaX / PPB))
        setDragPlayedBars(finalPlayedBars)
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: finalPlayedBars })
        }
        setDragPlayedBars(null)
      }
    )
  }
```

with:

```ts
  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    let finalPlayedBars = startPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        finalPlayedBars = Math.max(MIN_PLAYED_BARS, Math.round(startPlayedBars + deltaX / PPB))
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'playedBars',
          key: playedBarsKey,
          value: finalPlayedBars
        })
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: finalPlayedBars })
        }
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'playedBars', key: playedBarsKey, value: undefined })
      }
    )
  }
```

- [ ] **Step 3: Dispatch instead of `setState` in `handleLeftResizeStart`**

Replace (around line 291-313):

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
        const requestedLeftCropBars = startLeftCropBars + Math.round(deltaX / PPB)
        finalLeftCropBars = Math.max(
          -startPosBar,
          Math.min(startPlayedBars - MIN_PLAYED_BARS, requestedLeftCropBars)
        )
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'leftCropBars',
          key: groupId,
          value: finalLeftCropBars
        })
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_LEFT_CROP_BARS', groupId, bars: finalLeftCropBars })
        }
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'leftCropBars', key: groupId, value: undefined })
      }
    )
  }
```

- [ ] **Step 4: Dispatch instead of `setState` in `handleFadeInStart`/`handleFadeOutStart`**

Replace (around line 465-501):

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
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

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
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

with:

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }
```

- [ ] **Step 5: Dispatch instead of `setState` in `handleVolumeStart` (group fan-out)**

Replace (around line 524-538):

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        setDragVolume(finalVolume)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_GROUP_VOLUME', groupId, volume: finalVolume })
        setDragVolume(null)
      }
    )
  }
```

with:

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: finalVolume })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_GROUP_VOLUME', groupId, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: undefined })
      }
    )
  }
```

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "CollapsedRifffRow: back live drag preview with shared store state"
```

---

### Task 4: Native — `PlaybackEngine`'s atomically-published `ProjectSnapshot`

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.h`
- Modify: `native-engine/Source/PlaybackEngine.cpp`

This is the highest-risk task in this plan — real-time audio-thread-safety code. The existing
`PlaybackEngineTests.cpp` suite (unchanged by this task) is the regression guard: every test must
still pass byte-for-byte identically, since this task changes *how* the data is stored, not what
`renderBlock` computes from it.

- [ ] **Step 1: Confirm the current test suite passes before touching anything**

Run (from `native-engine/`): `cmake --build build`
Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -5`
Expected: `All unit tests passed.` — this is the baseline Step 4 below must reproduce exactly.

- [ ] **Step 2: Replace `PlaybackEngine.h`'s private section**

The full current file is:

```cpp
// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <map>

namespace sssketch
{
    class PlaybackEngine
    {
    public:
        explicit PlaybackEngine(StemBufferCache& bufferCache);

        /** Replaces the current project. Loads every stem's audio into
         * bufferCache up front (mirrors AudioEngine.ts loading buffers before
         * scheduling) — a stem whose file fails to load is silently skipped
         * during rendering, not fatal to the whole project, matching
         * AudioEngine.ts's per-stem try/catch. */
        void setProject(const EngineProject& project);

        /** Renders numSamples of stereo output starting at absolute transport
         * position positionBars, into outL/outR (each numSamples long, must be
         * pre-zeroed by the caller — this function adds into them).
         * channelChains provides each channel's own 2-slot plugin chain (see
         * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md)
         * -- a channel with no chain currently published (chainFor returns
         * nullptr) is a pure passthrough, identical to the pre-this-feature
         * direct-sum behaviour. Otherwise pure/deterministic given the same
         * channelChains state: no hidden state carried between calls on
         * PlaybackEngine's own side — safe to call repeatedly out of order
         * (as the parity test does) or from a real-time callback. */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR,
            ChannelChainRegistry& channelChains) const;

        double secPerBar() const { return currentProject.bpm > 0.0 ? (60.0 / currentProject.bpm) * 4.0 : 0.0; }

        /** Read-only access to the project most recently passed to setProject(),
         * for the render-export IPC handler to render "whatever was last
         * loaded" without inventing a second way to pass project data. */
        const EngineProject& currentProjectForExport() const { return currentProject; }

        /** Toggled by the 'set-metronome' IPC message — off by default, so a
         * freshly-constructed engine (including RenderExport's own, offline)
         * never includes the click unless explicitly turned on. Live
         * playback and offline export share this same renderBlock, but
         * export always uses its own fresh PlaybackEngine instance (see
         * RenderExport.cpp), so this defaulting to false there is automatic
         * — the metronome is a practice aid, not part of the actual mix. */
        void setMetronomeEnabled(bool enabled) { metronomeEnabled = enabled; }
        bool isMetronomeEnabled() const { return metronomeEnabled; }

    private:
        StemBufferCache& bufferCache;
        EngineProject currentProject;
        bool metronomeEnabled = false;
        // Precomputed once per setProject() call (not per block) -- groups
        // currentProject.rifffs by channelId. Pointers into currentProject's
        // OWN vector<EngineRifff>, valid until the next setProject() call
        // rebuilds both together.
        std::map<juce::String, std::vector<const EngineRifff*>> channelGroups;

        // Per-channel accumulation scratch for renderBlock() -- one entry per
        // channelGroups entry, in the same order. Sized/populated once per
        // setProject() (not per block); renderBlock() only resizes an inner
        // buffer when numSamples itself changes (rare -- Transport.cpp's
        // loop-boundary splitting), and just zeroes it (std::fill, no
        // allocation) otherwise. `mutable` since renderBlock() is const but
        // still needs to write into this reused scratch space -- same
        // "logically const, physically caching" reasoning as any const
        // method backed by an internal cache. Never touched concurrently:
        // a single PlaybackEngine instance is driven by exactly one thread
        // at a time (either the real-time audio thread during playback, or
        // RenderExport's own offline thread, which always uses its own
        // fresh instance -- see renderBlock's doc comment).
        mutable std::vector<std::vector<float>> scratchChannelL, scratchChannelR;
        mutable std::vector<juce::String> scratchChannelIds;
    };
}
```

Replace it in full with:

```cpp
// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <map>

namespace sssketch
{
    class PlaybackEngine
    {
    public:
        explicit PlaybackEngine(StemBufferCache& bufferCache);
        ~PlaybackEngine();

        PlaybackEngine(const PlaybackEngine&) = delete;
        PlaybackEngine& operator=(const PlaybackEngine&) = delete;

        /** Replaces the current project. Loads every stem's audio into
         * bufferCache up front (mirrors AudioEngine.ts loading buffers before
         * scheduling) — a stem whose file fails to load is silently skipped
         * during rendering, not fatal to the whole project, matching
         * AudioEngine.ts's per-stem try/catch. Builds a brand-new
         * ProjectSnapshot and publishes it via one atomic pointer exchange —
         * see ProjectSnapshot's own doc comment for why. Safe to call at
         * high frequency (e.g. live volume dragging during playback, see
         * docs/superpowers/specs/2026-08-04-live-drag-preview-design.md) --
         * this used to be a plain, unsynchronized member reassignment racing
         * against the real-time audio thread's own concurrent read, flagged
         * but never fixed in native-engine/PHASE3_FINDINGS.md. */
        void setProject(const EngineProject& project);

        /** Renders numSamples of stereo output starting at absolute transport
         * position positionBars, into outL/outR (each numSamples long, must be
         * pre-zeroed by the caller — this function adds into them).
         * channelChains provides each channel's own 2-slot plugin chain (see
         * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md)
         * -- a channel with no chain currently published (chainFor returns
         * nullptr) is a pure passthrough, identical to the pre-this-feature
         * direct-sum behaviour. Otherwise pure/deterministic given the same
         * channelChains state: no hidden state carried between calls on
         * PlaybackEngine's own side — safe to call repeatedly out of order
         * (as the parity test does) or from a real-time callback. */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR,
            ChannelChainRegistry& channelChains) const;

        double secPerBar() const;

        /** Read-only access to the project most recently passed to setProject(),
         * for the render-export IPC handler to render "whatever was last
         * loaded" without inventing a second way to pass project data. */
        const EngineProject& currentProjectForExport() const { return published.load()->project; }

        /** Toggled by the 'set-metronome' IPC message — off by default, so a
         * freshly-constructed engine (including RenderExport's own, offline)
         * never includes the click unless explicitly turned on. Live
         * playback and offline export share this same renderBlock, but
         * export always uses its own fresh PlaybackEngine instance (see
         * RenderExport.cpp), so this defaulting to false there is automatic
         * — the metronome is a practice aid, not part of the actual mix. */
        void setMetronomeEnabled(bool enabled) { metronomeEnabled = enabled; }
        bool isMetronomeEnabled() const { return metronomeEnabled; }

    private:
        /** Bundles the project together with every derived structure that
         * points INTO it (channelGroups) or is sized FROM it
         * (scratchChannelL/R/Ids) into one immutable-once-published unit --
         * these can't be independently atomic-swapped without reintroducing
         * a race between the two swaps landing at different times. Mirrors
         * ChannelChainRegistry's own published-map pattern exactly (see
         * ChannelChainRegistry.h's class doc comment): setProject() builds a
         * whole new ProjectSnapshot on the heap and publishes it with one
         * atomic exchange; renderBlock() loads the current pointer once, at
         * the top of the call, and reads everything through it for the rest
         * of that one call -- never touches a shared mutable field
         * directly. */
        struct ProjectSnapshot
        {
            EngineProject project;

            // Groups project.rifffs by channelId. Pointers into THIS
            // snapshot's OWN project.rifffs vector -- never the previous
            // snapshot's -- so they stay valid for exactly this
            // snapshot's own lifetime.
            std::map<juce::String, std::vector<const EngineRifff*>> channelGroups;

            // Per-channel accumulation scratch for renderBlock() -- one
            // entry per channelGroups entry, in the same order. `mutable`:
            // renderBlock() reads a ProjectSnapshot through a const
            // pointer but still needs to write into this reused scratch
            // space every block -- same "logically const, physically
            // caching" reasoning this class used before this refactor,
            // just relocated. Still race-free: only one thread (the live
            // audio callback, or RenderExport's own single-threaded
            // offline instance -- never both, see renderBlock's own doc
            // comment) ever touches a GIVEN published snapshot's scratch
            // space, for as long as it stays published.
            mutable std::vector<std::vector<float>> scratchChannelL, scratchChannelR;
            mutable std::vector<juce::String> scratchChannelIds;
        };

        StemBufferCache& bufferCache;
        std::atomic<const ProjectSnapshot*> published;
        bool metronomeEnabled = false;
    };
}
```

- [ ] **Step 3: Rewrite `PlaybackEngine.cpp`**

The full current file is 380 lines (read it in full at `native-engine/Source/PlaybackEngine.cpp`
before editing — reproducing it here in full would make this step error-prone to transcribe by
hand). Make exactly these changes, leaving every other line (the metronome block, the one-shot
branch, the tile-loop math, the fade/gain sample loop, the per-channel chain-processing loop at
the bottom) byte-for-byte unchanged:

**3a. Add `#include <thread>`** at the top, alongside the existing includes:

```cpp
#include "PlaybackEngine.h"
#include "FadeGain.h"
#include "Metronome.h"
#include <algorithm>
#include <cmath>
#include <thread>
```

**3b. Replace the constructor and add a destructor + `secPerBar()`.** Replace:

```cpp
    PlaybackEngine::PlaybackEngine(StemBufferCache& cache) : bufferCache(cache) {}
```

with:

```cpp
    PlaybackEngine::PlaybackEngine(StemBufferCache& cache)
        : bufferCache(cache), published(new ProjectSnapshot())
    {
        // Published to a freshly-constructed, empty snapshot immediately --
        // renderBlock()/currentProjectForExport() must never see a null
        // pointer, including before setProject() is ever called (see the
        // "silence when no project is set" test, which relies on exactly
        // this: an empty project.rifffs, not a null snapshot).
    }

    PlaybackEngine::~PlaybackEngine() { delete published.load(); }

    double PlaybackEngine::secPerBar() const
    {
        const auto* snap = published.load(std::memory_order_acquire);
        return snap->project.bpm > 0.0 ? (60.0 / snap->project.bpm) * 4.0 : 0.0;
    }
```

**3c. Replace `setProject()`.** Replace:

```cpp
    void PlaybackEngine::setProject(const EngineProject& project)
    {
        currentProject = project;
        for (auto& rifff : currentProject.rifffs)
            for (auto& stem : rifff.stems)
                // stem.durationSec: see StemBufferCache::load's own doc
                // comment on why the loop-sewing blend needs this (not just
                // the raw decoded buffer length) to land on the same point
                // renderBlock's own tiling math actually wraps at, below.
                // Failure is fine either way — renderBlock skips missing
                // buffers.
                bufferCache.load(stem.resolvedPath, stem.durationSec);

        channelGroups.clear();
        for (const auto& rifff : currentProject.rifffs)
            channelGroups[rifff.channelId].push_back(&rifff);

        // Rebuild the render scratch space to match the new channel set --
        // off the real-time thread (see renderBlock's own comment on why
        // this lives here, not there). Inner per-numSamples buffers are left
        // empty; renderBlock sizes those lazily on first use.
        scratchChannelL.assign(channelGroups.size(), {});
        scratchChannelR.assign(channelGroups.size(), {});
        scratchChannelIds.clear();
        scratchChannelIds.reserve(channelGroups.size());
        for (const auto& [channelId, rifffPtrs] : channelGroups)
            scratchChannelIds.push_back(channelId);
    }
```

with:

```cpp
    void PlaybackEngine::setProject(const EngineProject& project)
    {
        auto* next = new ProjectSnapshot();
        next->project = project;
        for (auto& rifff : next->project.rifffs)
            for (auto& stem : rifff.stems)
                // stem.durationSec: see StemBufferCache::load's own doc
                // comment on why the loop-sewing blend needs this (not just
                // the raw decoded buffer length) to land on the same point
                // renderBlock's own tiling math actually wraps at, below.
                // Failure is fine either way — renderBlock skips missing
                // buffers.
                bufferCache.load(stem.resolvedPath, stem.durationSec);

        for (const auto& rifff : next->project.rifffs)
            next->channelGroups[rifff.channelId].push_back(&rifff);

        // Scratch space for the new channel set -- off the real-time thread
        // (see renderBlock's own comment on why this lives here, not
        // there). Inner per-numSamples buffers are left empty; renderBlock
        // sizes those lazily on first use.
        next->scratchChannelL.assign(next->channelGroups.size(), {});
        next->scratchChannelR.assign(next->channelGroups.size(), {});
        next->scratchChannelIds.reserve(next->channelGroups.size());
        for (const auto& [channelId, rifffPtrs] : next->channelGroups)
            next->scratchChannelIds.push_back(channelId);

        const auto* old = published.exchange(next, std::memory_order_acq_rel);
        // Detached, not deleted inline -- the audio thread may still be
        // mid-renderBlock() on `old` at the exact instant of this exchange;
        // by the time this detached thread actually runs, the audio
        // thread's own bounded, fast real-time execution has certainly
        // already moved on to the newly-published snapshot. Copied verbatim
        // from ChannelChainRegistry.cpp's own identical handoff.
        std::thread([old]() { delete old; }).detach();
    }
```

**3d. Update `renderBlock()`'s opening.** Replace:

```cpp
    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR,
        ChannelChainRegistry& channelChains) const
    {
        const double spb = secPerBar();
        if (spb <= 0.0)
            return;
```

with:

```cpp
    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR,
        ChannelChainRegistry& channelChains) const
    {
        // Loaded ONCE, here, and read through for the rest of this call --
        // not via secPerBar() (which does its own independent load) or any
        // other second load, which could observe a DIFFERENT snapshot than
        // this one if a setProject() call landed in between the two loads.
        const auto* snap = published.load(std::memory_order_acquire);
        if (snap == nullptr)
            return;

        const double spb = snap->project.bpm > 0.0 ? (60.0 / snap->project.bpm) * 4.0 : 0.0;
        if (spb <= 0.0)
            return;
```

**3e. Update the empty-project check.** Replace:

```cpp
        if (currentProject.rifffs.empty())
            return;
```

with:

```cpp
        if (snap->project.rifffs.empty())
            return;
```

**3f. Update the scratch-space aliases.** Replace:

```cpp
        auto& channelL = scratchChannelL;
        auto& channelR = scratchChannelR;
        auto& channelIds = scratchChannelIds;
```

with:

```cpp
        auto& channelL = snap->scratchChannelL;
        auto& channelR = snap->scratchChannelR;
        auto& channelIds = snap->scratchChannelIds;
```

**3g. Update the channel-groups iteration.** Replace:

```cpp
        size_t channelIdx = 0;
        for (const auto& [channelId, rifffPtrs] : channelGroups)
        {
```

with:

```cpp
        size_t channelIdx = 0;
        for (const auto& [channelId, rifffPtrs] : snap->channelGroups)
        {
```

**3h. Update the one remaining `currentProject` reference (inside the tile-loop's offset-bars
computation).** Replace:

```cpp
                const double rawOffsetBars = stem.offsetSteps / currentProject.snapDiv;
```

with:

```cpp
                const double rawOffsetBars = stem.offsetSteps / snap->project.snapDiv;
```

Every other line in `renderBlock` (the metronome block, the one-shot branch, `fadeConfig`,
`lowerBound`/`upperBound`/`firstTileIdx`/`tileIdx` and the rest of the tile loop, the per-sample
gain/mix loop, and the final per-channel chain-processing loop) references only local variables
or the now-updated `snap->`-qualified names above — no further changes needed.

- [ ] **Step 4: Build and run the full native test suite**

Run (from `native-engine/`): `cmake --build build 2>&1 | tail -40`
Expected: clean build, no errors.

Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -10`
Expected: `All unit tests passed.` — the exact same result as Step 1's baseline. Every existing
test uses `leftCropBars`/`playedBars` etc. defaults that make every new formula above reduce
exactly to the old one; any newly-failing test means a transcription error in Step 3, not a
legitimate behavior change — find and fix it before proceeding, don't work around it.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/PlaybackEngine.h native-engine/Source/PlaybackEngine.cpp
git commit -m "Harden PlaybackEngine's project handoff with an atomically-published snapshot"
```

---

### Task 5: Native — concurrent `setProject`/`renderBlock` stress test

**Files:**
- Modify: `native-engine/Source/PlaybackEngineTests.cpp`

Unlike every other task in this plan, this one isn't a clean TDD red/green cycle: a data race
doesn't reliably manifest as a deterministic failure in a short, bounded test loop, especially
against the OLD (pre-Task-4) code — it might pass by luck even though the underlying race is
real (that's exactly what "flagged, not confirmed, not ruled out" in `PHASE3_FINDINGS.md`
means). Write it, optionally sanity-check it against the current (Task-4-hardened) code, then
treat it as a permanent regression guard going forward — its value is in exercising the exact
concurrent-access pattern the live-volume-drag feature depends on, under sustained load, not in
proving the absence of a race the way a thread-sanitizer build could.

- [ ] **Step 1: Add the stress test**

In `native-engine/Source/PlaybackEngineTests.cpp`, add `#include <atomic>` and `#include <thread>`
to the top, alongside the existing includes:

```cpp
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include <juce_core/juce_core.h>
#include <atomic>
#include <cmath>
#include <limits>
#include <thread>
```

Then add the test itself right before the final `fixture.deleteFile();` line (near the end of
`runTest()`, just before the closing braces of the test class):

```cpp
            beginTest("concurrent setProject() and renderBlock() calls do not crash");
            {
                // Regression test for the PlaybackEngine::currentProject/
                // channelGroups race documented in PHASE3_FINDINGS.md --
                // setProject() used to reassign a plain member while
                // renderBlock() read it directly on another thread with no
                // synchronization at all. This exercises the exact
                // concurrent-access pattern the live-volume/fade-drag
                // feature depends on being safe, for real, under sustained
                // load -- the previous code had no mechanism to survive
                // this at all. See this file's own header comment on why
                // this isn't a strict TDD red/green test.
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;

                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;

                std::atomic<bool> stop { false };
                std::thread setProjectThread([&]() {
                    int volumeToggle = 0;
                    while (!stop.load())
                    {
                        EngineRifff rifff;
                        rifff.startBar = 0.0;
                        rifff.barLength = 4;
                        EngineStem stem;
                        // Never actually decoded -- see StemBufferCache::load's
                        // own doc comment, a missing file is a normal, harmless
                        // case (renderBlock just skips it). Keeps this test
                        // fast and independent of any audio fixture.
                        stem.resolvedPath = "/nonexistent.wav";
                        stem.durationSec = 4.0;
                        stem.barLength = 4;
                        stem.playedBars = 4.0;
                        stem.volume = (volumeToggle++ % 2 == 0) ? 0.3 : 0.9;
                        rifff.stems.push_back(stem);

                        EngineProject next = project;
                        next.rifffs.push_back(rifff);
                        engine.setProject(next);
                    }
                });

                std::thread renderThread([&]() {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    double positionBars = 0.0;
                    const double secPerBar = (60.0 / project.bpm) * 4.0;
                    for (int i = 0; i < 20000; ++i)
                    {
                        l.assign(512, 0.0f);
                        r.assign(512, 0.0f);
                        engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);
                        positionBars += (512.0 / 44100.0) / secPerBar;
                    }
                });

                renderThread.join();
                stop = true;
                setProjectThread.join();

                // Reaching here at all -- no crash, no hang -- is the actual
                // assertion.
                expect(true);
            }
```

- [ ] **Step 2: Build and run the full native test suite**

Run (from `native-engine/`): `cmake --build build 2>&1 | tail -40`
Expected: clean build.

Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -10`
Expected: `All unit tests passed.` — including this new test. Run it 2-3 times in a row to build
confidence (a race that survives one run isn't guaranteed to survive every run, though with
Task 4 landed there should no longer be a race to hit at all):

```bash
for i in 1 2 3; do
  native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -3
done
```

Expected: `All unit tests passed.` on every run.

- [ ] **Step 3: Commit**

```bash
git add native-engine/Source/PlaybackEngineTests.cpp
git commit -m "Add a concurrent setProject/renderBlock stress test for PlaybackEngine"
```

---

### Task 6: `buildEngineProject.ts` — prefer the live drag draft

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Test: `src/shared/buildEngineProject.test.ts` (create if it doesn't already cover volume/fade
  construction — check first with `grep -n "describe\|it(" src/shared/buildEngineProject.test.ts`;
  if a `describe`/`it` block already exercises stem `volume`/rifff `fadeInBars`/`fadeOutBars`
  construction, add cases there instead of a new file)

This task alone has no visible effect yet — nothing reads `state.dragVol`/`state.dragFadeIn`/
`state.dragFadeOut` to trigger a rebuild until Task 7 wires `StoreContext.tsx`'s dependency array.
Landing it first (and tested in isolation) keeps Task 7's own diff smaller and focused purely on
the dependency-array/throttle change.

- [ ] **Step 1: Write the failing test**

`src/shared/buildEngineProject.test.ts` already exists and already has a `'carries volume/mute/
offset/fade fields through'` test using its own `stateWith(overrides)` helper (merges into
`initialState` with a fixed single-stem `rifff` at groupId `r1`, slot `1`) and an `emptyCatalog`
constant — reuse both exactly. Add these two tests, right after that existing test (around line
169, after its closing `})`):

```ts
  it('prefers a live drag-preview volume/fade over the committed value when present', async () => {
    const state = stateWith({
      bpm: 150,
      vol: { 'r1:1': 0.7 },
      fadeIn: { r1: 1.5 },
      fadeOut: { r1: 0.5 },
      dragVol: { 'r1:1': 0.2 },
      dragFadeIn: { r1: 3 },
      dragFadeOut: { r1: 1.2 }
    })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    expect(stem.volume).toBe(0.2)
    expect(project.rifffs[0].fadeInBars).toBe(3)
    expect(project.rifffs[0].fadeOutBars).toBe(1.2)
  })

  it('falls back to the committed volume/fade when no drag preview is present', async () => {
    const state = stateWith({
      bpm: 150,
      vol: { 'r1:1': 0.7 },
      fadeIn: { r1: 1.5 },
      fadeOut: { r1: 0.5 }
    })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    expect(stem.volume).toBe(0.7)
    expect(project.rifffs[0].fadeInBars).toBe(1.5)
    expect(project.rifffs[0].fadeOutBars).toBe(0.5)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: FAIL — `stem.volume`/`fadeInBars`/`fadeOutBars` still read only the committed fields.

- [ ] **Step 3: Update `buildEngineProject.ts`**

In `src/shared/buildEngineProject.ts`, replace (around line 184):

```ts
        volume: state.vol[key] ?? 1,
```

with:

```ts
        // Prefers an in-progress drag preview over the committed value --
        // see docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
        // StoreContext.tsx's engine-sync effect re-runs this on every
        // dragVol change during an active volume drag, so playback hears
        // the change live rather than only once, on release.
        volume: state.dragVol[key] ?? state.vol[key] ?? 1,
```

And replace (around line 201-202):

```ts
      fadeInBars: state.fadeIn[rifff.groupId] ?? 0,
      fadeOutBars: state.fadeOut[rifff.groupId] ?? 0,
```

with:

```ts
      // Same drag-preview preference as volume above.
      fadeInBars: state.dragFadeIn[rifff.groupId] ?? state.fadeIn[rifff.groupId] ?? 0,
      fadeOutBars: state.dragFadeOut[rifff.groupId] ?? state.fadeOut[rifff.groupId] ?? 0,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full TS test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "buildEngineProject: prefer a live drag-preview volume/fade over the committed value"
```

---

### Task 7: `StoreContext.tsx` — throttled live push + `leftCrop` dependency fix

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

Native safety (Task 4) has already landed by this point in the plan — this task is the one that
actually starts exercising it at drag frequency, so it must come after Task 4, not before.

- [ ] **Step 1: Replace the engine-sync effect**

The current effect (around line 316-372) is:

```tsx
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const project = await buildEngineProject(state, resolveStretchedForPlayback, pluginCatalog)
      if (!cancelled) {
        await window.rifffApi.engineLoadProject(project)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes playing/pos (no longer part of state at all); those are handled by the separate play/pause effect and the position-update subscription below, not by reloading the whole project
  }, [
    state.off,
    state.bpm,
    state.snapIdx,
    state.stretch,
    state.rifffs,
    state.fadeIn,
    state.fadeOut,
    state.vol,
    state.mute,
    // Missing here meant a resize-handle drag (SET_PLAYED_BARS) never
    // reached the native engine during live playback -- the reducer state
    // updated fine (so the row visibly resized and export/re-open picked it
    // up), but this effect wouldn't re-run to actually re-send the project,
    // so the engine kept scheduling the stem at its old length until some
    // OTHER tracked field happened to change too. Found via Task 12 manual
    // verification: after a resize-handle drag, the captured EngineProject
    // sent over IPC still showed the pre-drag playedBars.
    state.playedBars,
    // masterChain plugin IDs flow through this general project sync (the
    // native engine's own EngineProject.masterChain field just needs to
    // stay current); actually LOADING/swapping the plugin binary is a
    // separate, explicit engineLoadMasterPlugin call below instead -- see
    // the SET_MASTER_CHAIN_PLUGIN dispatch-side effect.
    state.masterChain,
    // A catalog id only resolves to a real path once the catalog itself has
    // loaded (or been rescanned) -- without this, a masterChain slot set
    // before the catalog finished loading would be sent to the engine with
    // an empty, unresolvable path forever, never re-sent once the real path
    // became known.
    pluginCatalog,
    // channelPlugins flows through this general project sync the same way
    // masterChain's own ids already do -- actual loading/swapping is the
    // separate, explicit engineLoadChannelPlugin call in the diffing effect
    // below instead.
    state.channelPlugins,
    // channelOf determines each rifff's EngineRifff.channelId (see
    // buildEngineProject.ts), which now directly decides which channel's
    // plugin chain a rifff's audio routes through -- missing here would mean
    // dragging a clip onto a different channel doesn't actually re-route its
    // audio through that channel's chain until some OTHER tracked field
    // happens to change too, same class of bug as the SET_PLAYED_BARS gap
    // documented above.
    state.channelOf
  ])
```

Replace it with:

```tsx
  // pendingEngineSyncRef tracks whether an rAF-scheduled flush is currently
  // pending OR in flight -- deliberately NOT cleared by this effect's own
  // cleanup function on every dependency change (only on unmount, in the
  // separate effect below). A naive `return () =>
  // cancelAnimationFrame(...)` here would cancel-and-reschedule on every
  // single dependency change; during a fast drag (state.dragVol changing
  // far more often than once per animation frame), each new dispatch would
  // perpetually push the flush deadline out, so it would never actually
  // fire until the drag paused for a whole frame -- defeating the entire
  // point of a live update. Guarding on this ref instead means the FIRST
  // change after being idle schedules a flush ~1 frame out; every
  // subsequent change while that flush is still pending (scheduled OR
  // in-flight) is a no-op, and the eventual flush reads stateRef.current --
  // the LATEST committed state at the moment it actually runs, not
  // whatever was captured when it was scheduled.
  const pendingEngineSyncRef = useRef(false)

  useEffect(() => {
    if (!pendingEngineSyncRef.current) {
      pendingEngineSyncRef.current = true
      requestAnimationFrame(() => {
        void (async () => {
          try {
            const project = await buildEngineProject(
              stateRef.current,
              resolveStretchedForPlayback,
              pluginCatalog
            )
            await window.rifffApi.engineLoadProject(project)
          } finally {
            // Cleared only once the send actually completes (success or
            // failure) -- not at the start of the rAF callback -- so at
            // most one send is ever pending/in-flight at a time. Without
            // this, a slow send (e.g. buildEngineProject's own rubberband
            // resolveStretched round-trip) could let a second flush get
            // scheduled and fire while the first is still in flight,
            // reintroducing the exact overlapping-async-calls race the
            // effect's own removed `cancelled` flag used to guard against.
            pendingEngineSyncRef.current = false
          }
        })()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes playing/pos (no longer part of state at all); those are handled by the separate play/pause effect and the position-update subscription below, not by reloading the whole project
  }, [
    state.off,
    state.bpm,
    state.snapIdx,
    state.stretch,
    state.rifffs,
    state.fadeIn,
    state.fadeOut,
    state.vol,
    state.mute,
    // Missing here meant a resize-handle drag (SET_PLAYED_BARS) never
    // reached the native engine during live playback -- the reducer state
    // updated fine (so the row visibly resized and export/re-open picked it
    // up), but this effect wouldn't re-run to actually re-send the project,
    // so the engine kept scheduling the stem at its old length until some
    // OTHER tracked field happened to change too. Found via Task 12 manual
    // verification: after a resize-handle drag, the captured EngineProject
    // sent over IPC still showed the pre-drag playedBars.
    state.playedBars,
    // Same class of gap as state.playedBars above, found while building the
    // live-drag-preview feature: a committed left-crop change didn't sync
    // to the engine at all, not even on mouse-up, since this field was
    // simply never added here despite buildEngineProject.ts already reading
    // it.
    state.leftCrop,
    // Live volume/fade preview during an active drag -- NOT
    // dragPlayedBars/dragLeftCropBars, which stay commit-on-release only
    // (pushing a length/crop change to the engine mid-drag risks an audible
    // scheduling jump if the playhead is inside the tile being resized; see
    // docs/superpowers/specs/2026-08-04-live-drag-preview-design.md's
    // "Explicitly out of scope" section).
    state.dragVol,
    state.dragFadeIn,
    state.dragFadeOut,
    // masterChain plugin IDs flow through this general project sync (the
    // native engine's own EngineProject.masterChain field just needs to
    // stay current); actually LOADING/swapping the plugin binary is a
    // separate, explicit engineLoadMasterPlugin call below instead -- see
    // the SET_MASTER_CHAIN_PLUGIN dispatch-side effect.
    state.masterChain,
    // A catalog id only resolves to a real path once the catalog itself has
    // loaded (or been rescanned) -- without this, a masterChain slot set
    // before the catalog finished loading would be sent to the engine with
    // an empty, unresolvable path forever, never re-sent once the real path
    // became known.
    pluginCatalog,
    // channelPlugins flows through this general project sync the same way
    // masterChain's own ids already do -- actual loading/swapping is the
    // separate, explicit engineLoadChannelPlugin call in the diffing effect
    // below instead.
    state.channelPlugins,
    // channelOf determines each rifff's EngineRifff.channelId (see
    // buildEngineProject.ts), which now directly decides which channel's
    // plugin chain a rifff's audio routes through -- missing here would mean
    // dragging a clip onto a different channel doesn't actually re-route its
    // audio through that channel's chain until some OTHER tracked field
    // happens to change too, same class of bug as the SET_PLAYED_BARS gap
    // documented above.
    state.channelOf
  ])
```

- [ ] **Step 2: Verify `stateRef`/`useRef` are already available in scope**

`stateRef` already exists in this file (see the existing `const stateRef = useRef(state)` a few
lines above this effect, at around line 298) — no new ref needed for reading latest state.
`useRef` itself is already imported (the file already uses it for `stateRef`/`playingRef`) — no
new import needed.

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: Run the full TS test suite**

Run: `npm test`
Expected: PASS — no test in this codebase directly unit-tests `StoreContext.tsx`'s internal
effects (React components/context providers are verified via typecheck + manual walkthrough per
this codebase's convention), so this step is a regression check on everything else, not a direct
test of this change.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "StoreContext: throttled live volume/fade push to the engine; fix missing leftCrop dependency"
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

Per this repo's own CLAUDE.md: the native engine does NOT hot-reload, and a renderer reload alone
is not enough. Fully quit (Cmd+Q, or `kill -9` every `Electron`/`electron-vite`/
`sssketch-engine --serve` process) and run `npm run dev` again.

- [ ] **Step 6: Manual walkthrough**

This is real-time audio/UI behavior that can't be verified any other way in this environment (see
CLAUDE.md's own testing-conventions section). With the freshly-relaunched dev app running:

1. Expand a multi-stem rifff. Drag one stem's left or right resize handle. Confirm every OTHER
   stem row in the same rifff visibly tracks the drag LIVE, in real time — not just once, on
   release (the bug this whole plan exists to fix).
2. Same expanded view: drag one stem's volume envelope. Confirm every other stem's own volume
   line does NOT move (volume is genuinely per-stem, unlike length/crop) — only the dragged
   stem's own envelope should move live.
3. Start playback. While it's playing, drag a stem's volume envelope. Confirm the actual audible
   volume changes live, continuously, as you drag — not only once you release the mouse.
4. Same, for a fade-in or fade-out handle, while playing.
5. Collapse the same rifff. Drag its own (group-level) volume envelope while playing. Confirm the
   audible volume changes live for the WHOLE rifff (every stem together).
6. Drag a length/crop handle while playing. Confirm the box resizes live but the AUDIBLE content
   does NOT change until you release the mouse (deliberately out of scope for live engine push —
   confirm this is what actually happens, not an accident).
7. With nothing playing, drag a left-crop handle, release, then reload the project (or check via
   the Inspector) — confirm the crop committed correctly (regression check for the newly-fixed
   `state.leftCrop` dependency-array bug: before this plan, a left-crop change could silently
   fail to reach the engine on save/reload in some cases).
8. General stability check: drag several handles rapidly, back and forth, for 10-20 seconds
   continuously, both while playing and stopped. Confirm no crash, no audio glitch/dropout beyond
   what's expected from just moving a fader quickly, and no console errors.

Report back what you see.
