# Tiled Clip Left-Handle Crop Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dragging a tiled/looped clip's left resize handle shift the clip's loop phase
(`offsetSteps`) by the exact opposite of however far `startBar` moves, so the remaining pattern
continues playing what it would always have played at each absolute bar position, instead of
restarting from its own beginning at the new boundary.

**Architecture:** `RESIZE_LEFT`'s action payload gains a new required field, `offsetSteps:
number` — the new value to write into `off[groupId]`. There are actually TWO independent
dispatch sites (discovered during Task 1's spec-compliance review, which caught the plan's
original "one dispatch site" claim as wrong via a real typecheck failure) — `StemWaveformRow.
tsx`'s `handleLeftResizeStart` (the expanded, per-stem row view) and `CollapsedRifffRow.tsx`'s
own `handleLeftResizeStart` (the collapsed/summary view of the same tiled clip) — both are
byte-for-byte identical copies of the same drag-handling logic, a pre-existing duplication in
this codebase, not introduced by this plan. Both already track the exact bar delta (`grow`)
they apply to `startBar`, and both already have `offsetSteps`/`snapIdx`/`SNAP_DIVS` in scope.
Both need the identical fix: compute the new offset from that same `grow`, converted to grid
steps via the clip's current `snapDiv`, and include it in the dispatch. The reducer just writes
whatever value it's given — no new logic there beyond storing the field, since the math lives
entirely in the two call sites that have `grow` and `snapDiv` on hand.

**Tech Stack:** TypeScript, the existing Redux-style reducer in `src/renderer/src/state/
store.ts`, Vitest for reducer tests.

---

### Task 1: `RESIZE_LEFT` action + reducer gain `offsetSteps`

**Files:**
- Modify: `src/renderer/src/state/store.ts:199` (action type)
- Modify: `src/renderer/src/state/store.ts:407-424` (reducer case)
- Modify: `src/renderer/src/state/store.test.ts:544-560` (existing `RESIZE_LEFT` tests)

- [ ] **Step 1: Update the action type to require `offsetSteps`**

In `src/renderer/src/state/store.ts`, change:

```ts
  | { type: 'RESIZE_LEFT'; groupId: string; bars: number; startBar: number }
```

to:

```ts
  | { type: 'RESIZE_LEFT'; groupId: string; bars: number; startBar: number; offsetSteps: number }
```

- [ ] **Step 2: Update the two existing `RESIZE_LEFT` tests to pass the new required field, and add a new test for the offset behavior**

In `src/renderer/src/state/store.test.ts`, replace the whole `describe('RESIZE_LEFT', ...)`
block (lines 544-560) with:

```ts
  describe('RESIZE_LEFT', () => {
    it('sets playedBars on the group key and moves the rifff’s own startBar', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        bars: 10,
        startBar: 4,
        offsetSteps: 0
      })
      expect(state.playedBars.r1).toBe(10)
      expect(state.rifffs.r1.startBar).toBe(4)
    })

    it('clamps playedBars to a minimum of 0.25 and startBar to a minimum of 0', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        bars: -3,
        startBar: -2,
        offsetSteps: 0
      })
      expect(state.playedBars.r1).toBe(0.25)
      expect(state.rifffs.r1.startBar).toBe(0)
    })

    it('writes offsetSteps into the group-level off map, so the loop keeps continuing instead of restarting at the new boundary', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: 5 })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        bars: 8,
        startBar: 7,
        offsetSteps: -3
      })
      // Cropping from the left moves startBar forward (6 -> 7 here); the
      // dispatch site computes offsetSteps as the opposite-signed delta
      // (see StemWaveformRow.tsx's handleLeftResizeStart) -- this test only
      // confirms the reducer stores whatever value it's given, not the
      // formula itself (that's exercised by manual walkthrough, since it
      // lives in a drag handler -- see this plan's own Task 3).
      expect(state.off.r1).toBe(-3)
    })

    it('leaves off[groupId] untouched when it was never set (still defaults to 0 via ?? elsewhere)', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        bars: 10,
        startBar: 4,
        offsetSteps: 0
      })
      expect(state.off.r1).toBe(0)
    })
  })
```

- [ ] **Step 3: Run the tests to verify the new/changed ones fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t RESIZE_LEFT`
Expected: FAIL — TypeScript will actually refuse to even run until Step 1's type change and
Step 2's test updates both exist together (an action missing the now-required `offsetSteps`
field is a compile error, not just a runtime assertion failure) — if you did Step 1 first, this
step's failure is a compile error on the test file; if you did Step 2 alongside it, the two new
tests specifically fail at the `expect(state.off.r1)` assertions because the reducer doesn't
write to `off` yet.

- [ ] **Step 4: Implement — write `offsetSteps` into `off[groupId]` in the reducer**

In `src/renderer/src/state/store.ts`, replace the `RESIZE_LEFT` case:

```ts
    // Dragging the LEFT resize handle: playedBars and the rifff's own start
    // move together in one atomic edit (one undo step, not two) so the
    // clip's right edge — where the loop currently ends — stays exactly in
    // place while the loop extends backward.
    case 'RESIZE_LEFT': {
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        playedBars: {
          ...state.playedBars,
          [action.groupId]: Math.max(MIN_PLAYED_BARS, action.bars)
        },
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: Math.max(0, action.startBar) }
        }
      }
    }
```

with:

```ts
    // Dragging the LEFT resize handle: playedBars, the rifff's own start,
    // and the loop's own phase (off[groupId]) all move together in one
    // atomic edit (one undo step, not three) so the clip's right edge —
    // where the loop currently ends — stays exactly in place while the
    // loop extends backward, AND the pattern keeps playing what it always
    // would have at each absolute bar position instead of restarting from
    // its own beginning at the new boundary. The offsetSteps value itself
    // is computed by the one dispatch site that has the exact bar delta on
    // hand (StemWaveformRow.tsx's handleLeftResizeStart) -- see
    // docs/superpowers/specs/2026-08-04-tiled-clip-crop-trim-design.md for
    // the derivation (offsetBars must move by the OPPOSITE delta startBar
    // moves by, so their sum stays invariant).
    case 'RESIZE_LEFT': {
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        playedBars: {
          ...state.playedBars,
          [action.groupId]: Math.max(MIN_PLAYED_BARS, action.bars)
        },
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: Math.max(0, action.startBar) }
        },
        off: { ...state.off, [action.groupId]: action.offsetSteps }
      }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t RESIZE_LEFT`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add offsetSteps to RESIZE_LEFT so a tiled clip's loop phase can shift with it"
```

---

### Task 2: Compute and dispatch the new offset from the left-handle drag

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx:179-215` (`handleLeftResizeStart`)
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx:271-300` (`handleLeftResizeStart`)

- [ ] **Step 1: Update `handleLeftResizeStart` to track and dispatch the new offset**

In `src/renderer/src/components/StemWaveformRow.tsx`, replace the whole `handleLeftResizeStart`
function:

```ts
  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    let finalPlayedBars = startPlayedBars
    let finalStartBar = startPosBar
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
        setDragLeftResize({ playedBars: finalPlayedBars, startBar: finalStartBar })
      },
      (moved) => {
        if (moved) {
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            bars: finalPlayedBars,
            startBar: finalStartBar
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

(`offsetSteps` and `snapIdx` are both already read via `useAppSelector` earlier in this
component — lines 53-54 — and `SNAP_DIVS` is already imported at the top of the file, so no new
imports are needed.)

- [ ] **Step 2: Apply the identical fix to `CollapsedRifffRow.tsx`'s own copy of this handler**

`CollapsedRifffRow.tsx` (the collapsed/summary view of the same tiled clip, rendered instead of
`StemWaveformRow.tsx` when the rifff isn't expanded — see `RifffBlockRow.tsx`) has its own,
separate, byte-for-byte-identical `handleLeftResizeStart` function that dispatches the same
`RESIZE_LEFT` action and needs the exact same fix. `offsetSteps` and `snapIdx` are already read
via `useAppSelector` earlier in this component too (lines 179-180), and `SNAP_DIVS` is already
imported at the top of the file (line 3) — no new imports needed here either.

In `src/renderer/src/components/CollapsedRifffRow.tsx`, replace the whole `handleLeftResizeStart`
function:

```ts
  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    let finalPlayedBars = startPlayedBars
    let finalStartBar = startPosBar
    startPointerDrag(
      e,
      (deltaX) => {
        const requestedGrow = -Math.round(deltaX / PPB)
        const grow = Math.max(
          MIN_PLAYED_BARS - startPlayedBars,
          Math.min(startPosBar, requestedGrow)
        )
        finalPlayedBars = startPlayedBars + grow
        finalStartBar = startPosBar - grow
        setDragLeftResize({ playedBars: finalPlayedBars, startBar: finalStartBar })
      },
      (moved) => {
        if (moved) {
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            bars: finalPlayedBars,
            startBar: finalStartBar
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
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    const startOffsetSteps = offsetSteps
    let finalPlayedBars = startPlayedBars
    let finalStartBar = startPosBar
    let finalOffsetSteps = startOffsetSteps
    startPointerDrag(
      e,
      (deltaX) => {
        const requestedGrow = -Math.round(deltaX / PPB)
        const grow = Math.max(
          MIN_PLAYED_BARS - startPlayedBars,
          Math.min(startPosBar, requestedGrow)
        )
        finalPlayedBars = startPlayedBars + grow
        finalStartBar = startPosBar - grow
        // The loop's own phase shifts by the OPPOSITE delta startBar just
        // moved by (startBar moved by -grow, so offsetBars moves by +grow),
        // keeping startBar+offsetBars invariant -- see
        // docs/superpowers/specs/2026-08-04-tiled-clip-crop-trim-design.md
        // (same fix as StemWaveformRow.tsx's own handleLeftResizeStart --
        // this component has its own separate copy of this handler for the
        // collapsed/summary view of a tiled clip).
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

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS — this confirms BOTH dispatch sites now satisfy `RESIZE_LEFT`'s new required
`offsetSteps` field (neither file has automated tests of its own per this codebase's own
convention — React drag-handler components are verified by manual walkthrough, not unit
tests — see CLAUDE.md's testing-conventions section).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "Shift a tiled clip's loop phase when dragging its left resize handle"
```

---

### Task 3: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS, including the 4 tests in the `RESIZE_LEFT` describe block (2 pre-existing + 2
new)

- [ ] **Step 4: Manual walkthrough**

This is a renderer-only change (no native engine, no main-process files touched) — hot-reloads
automatically under `npm run dev`, no restart needed. With the dev app running:

Repeat steps 1-4 below in BOTH the EXPANDED view (`StemWaveformRow.tsx`, click the rifff to
expand it) and the COLLAPSED view (`CollapsedRifffRow.tsx`, the default/summary view) of the
same tiled clip — they're two independent copies of the same handler (see Task 2's own note on
this pre-existing duplication), so a mistake in one wouldn't show up testing only the other.

1. Drag a multi-bar tiled clip (any regular, non-one-shot rifff placed on the timeline) onto a
   channel with room to its left.
2. Drag its LEFT resize handle to the RIGHT (cropping/shrinking) by a couple of bars. Confirm:
   the clip's right edge doesn't move, and the waveform content visible after the crop reads as
   a continuation of what was already there (not a repeat of the clip's own very beginning).
3. Undo (or manually drag the same handle back), then drag the LEFT resize handle to the LEFT
   (extending/growing) by a couple of bars. Confirm: the newly-revealed bars show what the loop
   would play if it wrapped around from its own end (e.g. a 4-bar "1234" pattern extended left
   by one bar reveals "4" immediately before the original "1", reading as "41234"), not silence
   or a repeat of "1".
4. Drag the RIGHT resize handle (either direction) on the same clip and confirm it behaves
   exactly as before this change (no restart/repositioning artifact was ever present there, and
   this plan made no changes to that code path).
5. Place a recorded take (or any one-shot/dragged-in sample) on a channel and confirm its own
   trim handles still behave exactly as before — one-shots use `trimStartSec`/`trimEndSec`
   (`oneShotResize.ts`), a completely separate code path from `handleLeftResizeStart` in either
   file this plan touches.

Report back what you see — this is real-time audio/UI behavior that can't be verified any other
way in this environment (see CLAUDE.md: "this environment has no GUI/audio interaction tooling,
so a coding agent cannot itself click through the app").
