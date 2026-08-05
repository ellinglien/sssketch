# Clip Region Select-to-Mute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict clip drag-to-move to the rifff-level title bar; turn the waveform body into an
Ableton-style click-drag region selector whose selection can be muted (or, for an existing
muted span, unmuted) with Delete/Backspace, all the way through real-time playback and Ableton
export.

**Architecture:** A new `muteRegions: Record<stemKey, {startBar,endBar}[]>` slice in the existing
reducer (`store.ts`), a transient `regionSelection` slice for the in-progress/pending selection,
UI changes in `StemWaveformRow.tsx`/`CollapsedRifffRow.tsx` that replace "drag body = move" with
"drag body = select", a new native-engine gain function applied per-sample in `PlaybackEngine.cpp`
(reusing the wire format's existing bar-unit convention, no new heap allocation in the audio
callback), and an Ableton-export change that splits a stem's single `AudioClip` into multiple
clips wherever it has a muted span, continuing the tile's own phase correctly across the gap.

**Tech Stack:** TypeScript/React (renderer), Electron main (Ableton export), JUCE/C++ (native
engine).

**Spec:** `docs/superpowers/specs/2026-08-05-clip-region-mute-design.md`

---

### Task 1: Data model — `muteRegions`, `regionSelection`, reducer actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/history.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.test.ts` (find the `describe` block containing the existing
`SET_LEFT_CROP_BARS`/`SET_DRAG_PREVIEW` tests and add these alongside them):

```ts
describe('mute regions', () => {
  it('ADD_MUTE_REGION appends a region to each listed stem', () => {
    const state = reducer(initialState, {
      type: 'ADD_MUTE_REGION',
      stemKeys: ['r1:0', 'r1:1'],
      startBar: 4,
      endBar: 8
    })
    expect(state.muteRegions['r1:0']).toEqual([{ startBar: 4, endBar: 8 }])
    expect(state.muteRegions['r1:1']).toEqual([{ startBar: 4, endBar: 8 }])
  })

  it('ADD_MUTE_REGION appends onto an existing list rather than replacing it', () => {
    const seeded = reducer(initialState, {
      type: 'ADD_MUTE_REGION',
      stemKeys: ['r1:0'],
      startBar: 0,
      endBar: 2
    })
    const state = reducer(seeded, {
      type: 'ADD_MUTE_REGION',
      stemKeys: ['r1:0'],
      startBar: 4,
      endBar: 8
    })
    expect(state.muteRegions['r1:0']).toEqual([
      { startBar: 0, endBar: 2 },
      { startBar: 4, endBar: 8 }
    ])
  })

  it('REMOVE_MUTE_REGION removes only the exact matching region', () => {
    const seeded = reducer(initialState, {
      type: 'ADD_MUTE_REGION',
      stemKeys: ['r1:0'],
      startBar: 0,
      endBar: 2
    })
    const withTwo = reducer(seeded, {
      type: 'ADD_MUTE_REGION',
      stemKeys: ['r1:0'],
      startBar: 4,
      endBar: 8
    })
    const state = reducer(withTwo, {
      type: 'REMOVE_MUTE_REGION',
      stemKey: 'r1:0',
      startBar: 0,
      endBar: 2
    })
    expect(state.muteRegions['r1:0']).toEqual([{ startBar: 4, endBar: 8 }])
  })

  it('REMOVE_MUTE_REGION is a no-op if no exact match exists', () => {
    const seeded = reducer(initialState, {
      type: 'ADD_MUTE_REGION',
      stemKeys: ['r1:0'],
      startBar: 0,
      endBar: 2
    })
    const state = reducer(seeded, {
      type: 'REMOVE_MUTE_REGION',
      stemKey: 'r1:0',
      startBar: 1,
      endBar: 3
    })
    expect(state.muteRegions['r1:0']).toEqual([{ startBar: 0, endBar: 2 }])
  })

  it('SET_REGION_SELECTION sets and clears the transient selection', () => {
    const selection = { stemKeys: ['r1:0'], startBar: 1, endBar: 3, mode: 'mute' as const }
    const set = reducer(initialState, { type: 'SET_REGION_SELECTION', selection })
    expect(set.regionSelection).toEqual(selection)
    const cleared = reducer(set, { type: 'SET_REGION_SELECTION', selection: null })
    expect(cleared.regionSelection).toBeNull()
  })

  it('DELETE_RIFFFS strips muteRegions for every deleted stem', () => {
    const rifff = {
      groupId: 'r1',
      name: 'x',
      bpm: 120,
      barLength: 4,
      folderPath: '/f',
      stems: [{ slot: 0, author: 'a', name: 's', type: 'other' as const, path: '/p', durationSec: 1, barLength: 1 }]
    }
    const seeded = reducer(
      { ...initialState, rifffs: { r1: rifff } },
      { type: 'ADD_MUTE_REGION', stemKeys: ['r1:0'], startBar: 0, endBar: 2 }
    )
    const state = reducer(seeded, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
    expect(state.muteRegions['r1:0']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "mute regions"`
Expected: FAIL — `ADD_MUTE_REGION`/`REMOVE_MUTE_REGION`/`SET_REGION_SELECTION` aren't valid
`Action` types yet, and `muteRegions`/`regionSelection` don't exist on `AppState`.

- [ ] **Step 3: Add the state shape**

In `src/renderer/src/state/store.ts`, add to the `AppState` interface (right after the existing
`leftCrop: Record<string, number>` field and its doc comment, before `dragVol`):

```ts
  /** One stem's own muted spans, keyed by stemKey(groupId, slot) -- absolute
   * arrangement-bar positions, the same coordinate space rifff.startBar
   * already lives in. Real arrangement data (persists normally, like
   * leftCrop), not a UI-mode toggle. See
   * docs/superpowers/specs/2026-08-05-clip-region-mute-design.md. */
  muteRegions: Record<string, { startBar: number; endBar: number }[]>
```

Add to `AppState`, right after `inspectorCollapsed: boolean` and its doc comment:

```ts
  /** The in-progress or pending-delete region selection -- null when
   * nothing is selected. `mode: 'mute'` means Delete/Backspace should mute
   * this span (it was dragged over raw/unmuted audio); `mode: 'unmute'`
   * means it exactly matches an existing muted region and Delete/Backspace
   * should remove that mute instead. Not persisted (see serialize.ts) --
   * same "how I'm currently working" treatment as volumeDragMode. */
  regionSelection: {
    stemKeys: string[]
    startBar: number
    endBar: number
    mode: 'mute' | 'unmute'
  } | null
```

In `initialState` (same file), add `muteRegions: {},` right after `leftCrop: {},`, and
`regionSelection: null,` right after `inspectorCollapsed: false,`.

In the `Action` union, add these three variants — put them right after the existing
`SET_LEFT_CROP_BARS` variant:

```ts
  | { type: 'ADD_MUTE_REGION'; stemKeys: string[]; startBar: number; endBar: number }
  | { type: 'REMOVE_MUTE_REGION'; stemKey: string; startBar: number; endBar: number }
  | {
      type: 'SET_REGION_SELECTION'
      selection: {
        stemKeys: string[]
        startBar: number
        endBar: number
        mode: 'mute' | 'unmute'
      } | null
    }
```

- [ ] **Step 4: Implement the reducer cases**

Add right after the existing `case 'SET_LEFT_CROP_BARS':` block in the `reducer` function:

```ts
    case 'ADD_MUTE_REGION': {
      const muteRegions = { ...state.muteRegions }
      for (const stemKey of action.stemKeys) {
        const existing = muteRegions[stemKey] ?? []
        muteRegions[stemKey] = [...existing, { startBar: action.startBar, endBar: action.endBar }]
      }
      return { ...state, muteRegions }
    }

    case 'REMOVE_MUTE_REGION': {
      const existing = state.muteRegions[action.stemKey] ?? []
      const next = existing.filter(
        (r) => !(r.startBar === action.startBar && r.endBar === action.endBar)
      )
      return { ...state, muteRegions: { ...state.muteRegions, [action.stemKey]: next } }
    }

    case 'SET_REGION_SELECTION':
      return { ...state, regionSelection: action.selection }
```

In the existing `case 'DELETE_RIFFFS':` block, add `muteRegions: omitStems(state.muteRegions),`
to the returned object, alongside the existing `vol: omitStems(state.vol),` /
`mute: omitStems(state.mute),` lines (same `omitStems` helper already defined in that case,
no new helper needed).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "mute regions"`
Expected: PASS (6 tests)

- [ ] **Step 6: Exclude `SET_REGION_SELECTION` from undo history**

In `src/renderer/src/state/history.ts`, add `'SET_REGION_SELECTION'` to the
`TRANSIENT_ACTION_TYPES` set, right after the existing `'SET_DRAG_PREVIEW'` /
`'SET_DRAG_PREVIEW_GROUP_VOLUME'` entries, with a comment:

```ts
  // The in-progress/pending region selection -- same "not a real edit"
  // treatment as SET_DRAG_PREVIEW; the real edits are ADD_MUTE_REGION/
  // REMOVE_MUTE_REGION, dispatched once Delete/Backspace actually commits.
  'SET_REGION_SELECTION'
```
(`ADD_MUTE_REGION`/`REMOVE_MUTE_REGION` are deliberately NOT added here — they're real,
undo-able edits, per the design spec.)

- [ ] **Step 7: Exclude `regionSelection` from persisted saves**

In `src/renderer/src/state/serialize.ts`, add `'regionSelection'` to the `Omit<AppState, ...>`
list in the `PersistedProject` type, and add `regionSelection` to the destructured/dropped
fields in `serializeProject`:

```ts
export type PersistedProject = Omit<
  AppState,
  | 'volumeDragMode'
  | 'mode'
  | 'inspectorCollapsed'
  | 'metronomeEnabled'
  | 'armedChannelId'
  | 'availableInputDevices'
  | 'selectedInputDevice'
  | 'regionSelection'
>
```

```ts
  const {
    volumeDragMode,
    mode,
    inspectorCollapsed,
    metronomeEnabled,
    armedChannelId,
    availableInputDevices,
    selectedInputDevice,
    regionSelection,
    ...rest
  } = state
```
(`muteRegions` is deliberately NOT added here — it persists normally, like `leftCrop`.)

- [ ] **Step 8: Run typecheck and the full test suite**

Run: `npm run typecheck && npx vitest run src/renderer/src/state/`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts src/renderer/src/state/history.ts src/renderer/src/state/serialize.ts
git commit -m "Add muteRegions data model and region-selection reducer actions"
```

---

### Task 2: `StemWaveformRow.tsx` — region-select interaction + rendering

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Remove the whole-body move-drag**

Remove `draggable`, `onDragStart={handleWaveformDragStart}` from the outer `data-rifff-clip` div
(currently lines 385-387), and delete the now-unused `handleWaveformDragStart` function
(currently lines 366-379, including its doc comment). Remove the now-unused imports
`computeGrabOffsetBars`, `setGrabOffsetBars`, `mouseBarFromDragEvent` from the `dragGrabOffset`
import IF `mouseBarFromDragEvent` isn't still needed — it IS still needed for the new region-select
handler below, so only remove `computeGrabOffsetBars`/`setGrabOffsetBars` from that import line:

```ts
import { mouseBarFromDragEvent } from './dragGrabOffset'
```

- [ ] **Step 2: Add `muteRegions`/`regionSelection` selectors**

Add alongside the other `useAppSelector` calls near the top of the component:

```ts
  const muteRegions = useAppSelector((s) => s.muteRegions[key] ?? [])
  const regionSelection = useAppSelector((s) => s.regionSelection)
```

- [ ] **Step 3: Replace `handleScrubClick` with `handleRegionMouseDown`**

Delete the existing `handleScrubClick` function (currently lines 309-342) entirely, and replace
it with:

```ts
  // Mousedown anywhere on the waveform body (that isn't a resize handle or
  // fade dot): if it lands inside an already-muted region, immediately
  // selects that region's exact bounds (mode 'unmute') -- no drag needed,
  // matching "clicking a muted span re-selects it" from the design spec.
  // Otherwise starts an Ableton-style drag-to-select (mode 'mute'); if the
  // drag never actually moved (a plain click), falls back to the original
  // click-to-scrub behavior instead of leaving a zero-width selection
  // behind. Skipped while volumeDragMode is on, which repurposes this same
  // surface for volume dragging instead (unchanged from before).
  function handleRegionMouseDown(e: React.MouseEvent): void {
    if (volumeDragMode) {
      handleVolumeStart(e)
      return
    }
    const mouseBar = mouseBarFromDragEvent(e, ppb, frameScale)
    if (mouseBar === null) return

    const existingRegion = muteRegions.find((r) => mouseBar >= r.startBar && mouseBar < r.endBar)
    if (existingRegion) {
      e.preventDefault()
      e.stopPropagation()
      dispatch({
        type: 'SET_REGION_SELECTION',
        selection: {
          stemKeys: [key],
          startBar: existingRegion.startBar,
          endBar: existingRegion.endBar,
          mode: 'unmute'
        }
      })
      return
    }

    const startBar = mouseBar
    startPointerDrag(
      e,
      (deltaX) => {
        const currentBar = Math.max(0, startBar + deltaX / ppb)
        dispatch({
          type: 'SET_REGION_SELECTION',
          selection: {
            stemKeys: [key],
            startBar: Math.min(startBar, currentBar),
            endBar: Math.max(startBar, currentBar),
            mode: 'mute'
          }
        })
      },
      (moved) => {
        if (moved) return
        // Not a real drag -- same click-to-scrub behavior this surface
        // always had, and clear any selection this click might have
        // started (there shouldn't be one yet at this point, but keeps
        // this handler self-contained regardless of call order).
        dispatch({ type: 'SET_REGION_SELECTION', selection: null })
        dispatch({ type: 'SELECT', groupId })
        dispatch({ type: 'SET_POS', pos: startBar })
        if (playing) {
          markManualSeek()
          void window.rifffApi.engineSetPosition(startBar)
        }
      }
    )
  }
```

- [ ] **Step 4: Wire the new handler onto the interaction surface**

Replace the existing volume/scrub surface (currently lines 671-687):

```tsx
          <div
            onMouseDown={(e) => {
              if (volumeDragMode) handleVolumeStart(e)
            }}
            onClick={handleScrubClick}
            title={
              volumeDragMode
                ? 'drag to adjust volume · right-click to mute'
                : 'click to scrub playhead · drag to move clip · right-click to mute'
            }
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'grab',
              zIndex: 2
            }}
          />
```

with:

```tsx
          <div
            onMouseDown={handleRegionMouseDown}
            title={
              volumeDragMode
                ? 'drag to adjust volume · right-click to mute'
                : 'click to scrub playhead · drag to select a region (delete to mute) · right-click to mute'
            }
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'crosshair',
              zIndex: 2
            }}
          />
```

- [ ] **Step 5: Render muted regions (hatch pattern) and the live selection highlight**

Add right before the closing `{dragVolume !== null && (...)}` tooltip block (i.e. after the
fade-out knee handle's closing `</div>`, before the volume tooltip):

```tsx
          {/* Muted regions: a diagonal hatch replacing the waveform for that
              span. Purely visual (pointerEvents none) -- handleRegionMouseDown
              on the full-body surface above already does its own bar-based
              lookup against muteRegions, so this never needs its own
              separate mousedown handler. Positioned relative to the clip's
              own left edge (leftPx), matching every other per-pixel overlay
              in this component (fade dots, envelope curve). */}
          {muteRegions.map((region, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: region.startBar * ppb - leftPx,
                width: (region.endBar - region.startBar) * ppb,
                background:
                  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--ra-mute-on) 55%, transparent) 0 3px, transparent 3px 8px)',
                zIndex: 1,
                pointerEvents: 'none'
              }}
            />
          ))}

          {/* Live/pending region selection -- shown while dragging, and
              after release until Delete/Backspace commits it or it's
              cancelled. */}
          {regionSelection && regionSelection.stemKeys.includes(key) && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: regionSelection.startBar * ppb - leftPx,
                width: (regionSelection.endBar - regionSelection.startBar) * ppb,
                background: 'color-mix(in srgb, var(--ra-text) 15%, transparent)',
                border: '1px solid var(--ra-text)',
                zIndex: 1,
                pointerEvents: 'none'
              }}
            />
          )}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/components/StemWaveformRow.tsx`
Expected: PASS, no errors. (This component isn't unit-tested directly, per this codebase's own
convention — see CLAUDE.md's Testing Conventions.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "StemWaveformRow: replace whole-body move-drag with region select-to-mute"
```

---

### Task 3: `CollapsedRifffRow.tsx` — same interaction, whole-rifff scope

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`

This mirrors Task 2 exactly, with two differences: the selection/mute applies to **every stem in
the rifff at once** (so `stemKeys` is the full list, not one), and this file's existing
`handleScrubClick`/volume-surface use slightly different local variable names (`PPB` instead of
`ppb`, `toLogicalX(e.clientX - rect.left, frameScale)` math instead of `mouseBarFromDragEvent` for
the scrub fraction) — read the actual current file before editing, since these steps describe the
change in terms of what Task 2 already established, not a byte-for-byte diff.

- [ ] **Step 1: Remove the whole-body move-drag**

The outer `data-rifff-clip` div currently reads (around lines 598-618):

```tsx
        <div
          data-rifff-clip
          draggable
          onDragStart={(e) => {
            suppressNextSyntheticClick()
            // Always moves the whole group, regardless of link state —
            // unlike the expanded view's per-stem grab targets. Collapsing
            // hides per-stem detail; a summary block dragging "part of
            // itself" independently would be confusing with nothing on
            // screen to show which stem moved.
            e.dataTransfer.setData('text/rifff-group-id', groupId)
            // Must pass this file's own local PPB (the zoom-adjusted shadow,
            // see its own doc comment above), not some other value -- a
            // previous version of this call omitted the argument entirely
            // and silently used a fixed default-zoom constant instead,
            // ignoring the real current zoom level.
            const mouseBar = mouseBarFromDragEvent(e, PPB, frameScale)
            if (mouseBar !== null) {
              setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
            }
          }}
          onContextMenu={handleBlockContextMenu}
```

Remove `draggable` and the entire `onDragStart={...}` prop (everything from `onDragStart={(e) =>`
through its closing `}}`), leaving just `data-rifff-clip` and `onContextMenu={handleBlockContextMenu}`.

This file currently imports all three of `computeGrabOffsetBars`, `setGrabOffsetBars`, and
`mouseBarFromDragEvent` from `./dragGrabOffset` (line 25) — and, unlike `StemWaveformRow.tsx`,
this file's Step 3 region-select handler below reuses its OWN pre-existing `rect`/`toLogicalX`
scrub math (the same one `handleScrubClick` already used), not `mouseBarFromDragEvent`. All
three of these become entirely unused once this step's `onDragStart` is removed — delete the
whole `import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from
'./dragGrabOffset'` line rather than keeping any part of it.

- [ ] **Step 2: Add `muteRegions`/`regionSelection` selectors**

Since a collapsed rifff mutes ALL its stems together, `muteRegions` here needs to represent the
UNION of every stem's own regions (for rendering — each stem might individually have different
regions if a user later drills into per-stem view and adds more, per the design's "both,
view-dependent" scope decision). Add:

```ts
  const muteRegionsByStem = useAppSelector((s) => s.muteRegions)
  const regionSelection = useAppSelector((s) => s.regionSelection)
  // The collapsed view shows the UNION of every stem's own muted spans --
  // a region only needs ONE stem to have it for the block to visibly show
  // it as muted, since the whole point of collapsed view is "one summary
  // block for this rifff." Deduped by exact (startBar,endBar) match.
  const muteRegions = useMemo(() => {
    const seen = new Set<string>()
    const out: { startBar: number; endBar: number }[] = []
    for (const stem of rifff.stems) {
      const key = stemKey(groupId, stem.slot)
      for (const region of muteRegionsByStem[key] ?? []) {
        const dedupeKey = `${region.startBar}:${region.endBar}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        out.push(region)
      }
    }
    return out
  }, [rifff.stems, groupId, muteRegionsByStem])
```

(Add `useMemo` to this file's React import if not already imported; check the top of the file
first — most of this codebase's components already import several hooks from `react`.)

- [ ] **Step 3: Replace `handleScrubClick` with `handleRegionMouseDown`**

Delete the existing `handleScrubClick` (currently lines 542-561) and replace with the same
pattern as Task 2's `StemWaveformRow.tsx`, except `stemKeys` is every stem in the rifff and the
click-to-scrub fallback reuses this file's own existing `leftPx`/`PPB`/`toLogicalX` scrub math
instead of `StemWaveformRow`'s `mouseBarFromDragEvent`-only version (both compute the same real
bar position, just via each file's own pre-existing convention — don't introduce a third one):

```ts
  function handleRegionMouseDown(e: React.MouseEvent): void {
    if (volumeDragMode) {
      handleVolumeStart(e)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const startBar = Math.max(
      0,
      leftPx / PPB + toLogicalX(e.clientX - rect.left, frameScale) / PPB
    )

    const stemKeys = rifff.stems.map((s) => stemKey(groupId, s.slot))
    const existingRegion = muteRegions.find((r) => startBar >= r.startBar && startBar < r.endBar)
    if (existingRegion) {
      e.preventDefault()
      e.stopPropagation()
      dispatch({
        type: 'SET_REGION_SELECTION',
        selection: {
          stemKeys,
          startBar: existingRegion.startBar,
          endBar: existingRegion.endBar,
          mode: 'unmute'
        }
      })
      return
    }

    startPointerDrag(
      e,
      (deltaX) => {
        const currentBar = Math.max(0, startBar + deltaX / PPB)
        dispatch({
          type: 'SET_REGION_SELECTION',
          selection: {
            stemKeys,
            startBar: Math.min(startBar, currentBar),
            endBar: Math.max(startBar, currentBar),
            mode: 'mute'
          }
        })
      },
      (moved) => {
        if (moved) return
        dispatch({ type: 'SET_REGION_SELECTION', selection: null })
        dispatch({ type: 'SELECT', groupId })
        dispatch({ type: 'SET_POS', pos: startBar })
        if (playing) {
          markManualSeek()
          void window.rifffApi.engineSetPosition(startBar)
        }
      }
    )
  }
```

Note this computes `startBar` up front (before the drag even starts) using this file's existing
`rect`/`toLogicalX` scrub math (previously only used in the click path) — reusing it for both the
"is this inside a muted region" check AND as the drag's own start point keeps the two code paths
consistent instead of drifting.

- [ ] **Step 4: Wire the new handler onto the interaction surface**

Same change as Task 2 Step 4, applied to this file's own volume/scrub surface (currently lines
872-888): replace `onMouseDown`/`onClick={handleScrubClick}` with
`onMouseDown={handleRegionMouseDown}`, update the `title` string, and change
`cursor: volumeDragMode ? 'ns-resize' : 'grab'` to `cursor: volumeDragMode ? 'ns-resize' : 'crosshair'`.

- [ ] **Step 5: Render muted regions and the live selection highlight**

Same JSX pattern as Task 2 Step 5 (hatch pattern for `muteRegions`, highlight for
`regionSelection`), inserted in the equivalent position (right before this file's own volume
tooltip block). The `regionSelection` visibility check here should be
`regionSelection.stemKeys.some((k) => rifff.stems.some((s) => stemKey(groupId, s.slot) === k))`
(any overlap with this rifff's own stems) rather than `.includes(key)`, since there's no single
`key` variable in this file the way there is in `StemWaveformRow.tsx` — this rifff's block should
show the selection highlight whenever the active selection touches ANY of its stems, whether that
selection was started from this collapsed view (all stems) or, if the design's per-view scoping
were ever loosened later, a single stem. For now (given the current design), it will always be
either "all of this rifff's stems" (matching a whole-rifff drag from this component) or "none of
them" (a selection belongs to some other rifff or was made in ITS OWN expanded view, not
reachable from here since expand/collapse is mutually exclusive per rifff).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/components/CollapsedRifffRow.tsx`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "CollapsedRifffRow: replace whole-body move-drag with region select-to-mute"
```

---

### Task 4: `App.tsx` — Delete/Backspace precedence, Escape to cancel

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Give region-mute/unmute precedence over whole-clip delete**

Find the existing Delete/Backspace `useEffect` (search for
`// Delete/Backspace removes the selected clip from the timeline`, currently around line 912).
Replace its `handleKeyDown` body:

```ts
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      // A pending region selection always takes precedence over the
      // whole-clip delete below -- a user who just finished dragging a
      // region expects Delete to act on THAT, not blow away the entire
      // clip. See docs/superpowers/specs/2026-08-05-clip-region-mute-design.md.
      if (state.regionSelection) {
        const { stemKeys, startBar, endBar, mode } = state.regionSelection
        if (mode === 'mute') {
          dispatch({ type: 'ADD_MUTE_REGION', stemKeys, startBar, endBar })
        } else {
          for (const stemKey of stemKeys) {
            dispatch({ type: 'REMOVE_MUTE_REGION', stemKey, startBar, endBar })
          }
        }
        dispatch({ type: 'SET_REGION_SELECTION', selection: null })
        return
      }

      if (!state.sel) return
      const selectedRifff = state.rifffs[state.sel]
      // Unplaced (library-only) rifffs are Shelf's own domain — see its own
      // Delete handler (also owns multi-select batch delete there). This
      // handler only ever un-places an already-placed clip; deleting one
      // from the library entirely is a different action (DELETE_RIFFFS).
      if (!selectedRifff || selectedRifff.startBar === undefined) return
      // Sketch mode has its own Delete/Backspace handling (SketchStrip),
      // which also re-packs the remaining sequence via SEQUENCE_RIFFFS —
      // this handler firing too would remove the same rifff a second time
      // (a no-op) but skip that repack step, racing with SketchStrip's own.
      if (state.mode === 'sketch') return
      dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: state.sel })
    }
```

Note the `target.tagName === 'INPUT'`/`'TEXTAREA'` guard moved to the very top (it applies
equally to both the region-mute path and the whole-clip-delete path — typing a digit that
happens to be Delete/Backspace in a text field should never trigger either).

- [ ] **Step 2: Escape cancels a pending selection**

Find this same `useEffect`'s dependency array (currently `[state.sel, state.mode, state.rifffs,
dispatch]`) and update it to include `state.regionSelection`. Then add a second, small `useEffect`
right after it for Escape-to-cancel — this is deliberately a SEPARATE effect (not folded into the
Delete/Backspace one above) since it only needs to depend on `state.regionSelection`, not the
whole-clip-delete effect's own larger dependency set:

```ts
  // Escape cancels a pending region selection without changing anything --
  // see docs/superpowers/specs/2026-08-05-clip-region-mute-design.md.
  useEffect(() => {
    if (!state.regionSelection) return
    function handleEscape(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      dispatch({ type: 'SET_REGION_SELECTION', selection: null })
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [state.regionSelection, dispatch])
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/App.tsx`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "App.tsx: region-mute/unmute takes precedence over whole-clip Delete, Escape cancels selection"
```

---

### Task 5: Wire format — `muteRegions` on `EngineStem`

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Test: `native-engine/Source/EngineProjectTests.cpp` (create if it doesn't already exist — check
  first; if a `EngineProjectTests.cpp` already exists in that directory, add to it instead)

- [ ] **Step 1: Add the TS-side field**

In `src/shared/buildEngineProject.ts`, add to the `EngineStem` interface, right after the
existing `muted: boolean` field:

```ts
  muteRegions: { startBar: number; endBar: number }[]
```

In the stem-building loop (the `stems.push({...})` block), add right after the existing
`muted: state.mute[key] ?? false,` line:

```ts
        muteRegions: state.muteRegions[key] ?? [],
```

- [ ] **Step 2: Run the TS build to confirm the shape change compiles**

Run: `npm run typecheck`
Expected: PASS (no consumer of `EngineStem` destructures it exhaustively in a way that would
break from an added field).

- [ ] **Step 3: Add the C++ struct field**

In `native-engine/Source/EngineProject.h`, add to `EngineStem`, right after the existing
`bool muted = false;` field:

```cpp
        /** A muted span, in bars -- the same absolute arrangement-bar
         * coordinate space startBarOverride/rifff.startBar already use.
         * Kept in bars (not pre-converted to seconds) so PlaybackEngine.cpp
         * can apply muteRegionGainAt() directly with no per-block
         * conversion or heap allocation -- see MuteRegionGain.h. */
        struct MuteRegion
        {
            double startBar = 0.0;
            double endBar = 0.0;
        };
        std::vector<MuteRegion> muteRegions;
```

- [ ] **Step 4: Parse it in `EngineProject.cpp`**

In the stem-parsing loop inside `parseEngineProject` (right after
`stem.trimEndSec = getDouble(stemVar, "trimEndSec", -1.0);`, before
`rifff.stems.push_back(std::move(stem));`), add:

```cpp
                        auto muteRegionsVar = stemVar.getProperty("muteRegions", juce::var());
                        if (auto* muteRegionsArray = muteRegionsVar.getArray())
                        {
                            for (auto& regionVar : *muteRegionsArray)
                            {
                                if (regionVar.getDynamicObject() == nullptr)
                                {
                                    errorOut = "muteRegions entry is not an object (stemKey: " + stem.stemKey + ")";
                                    return false;
                                }
                                EngineStem::MuteRegion region;
                                region.startBar = getDouble(regionVar, "startBar", 0.0);
                                region.endBar = getDouble(regionVar, "endBar", 0.0);
                                stem.muteRegions.push_back(region);
                            }
                        }
                        else if (stemVar.hasProperty("muteRegions") && !isNullish(muteRegionsVar))
                        {
                            errorOut = "muteRegions is present but not an array (stemKey: " + stem.stemKey + ")";
                            return false;
                        }
```

This follows the exact same array-of-objects pattern already used for `rifffs`/`stems` themselves
in this same function (see the file's own precedent) — missing/absent `muteRegions` is not a
parse error, matching this function's existing lenient-parse convention for every other field.

- [ ] **Step 5: Write a parse test**

Check whether `native-engine/Source/` has an existing `EngineProjectTests.cpp`. If yes, add this
test to its `runTest()`; if no, create the file following the exact `PlaybackEngineTests.cpp`
pattern (a `class EngineProjectTests : public juce::UnitTest`, `runTest()` override with
`beginTest`/`expect*` blocks, a `static EngineProjectTests engineProjectTests;` instance at the
bottom) and add it to `native-engine/CMakeLists.txt`'s source list alongside the other
`*Tests.cpp` files (check that file for the exact pattern other test files are added with).

```cpp
            beginTest("parses muteRegions on a stem");
            {
                EngineProject project;
                juce::String error;
                bool ok = parseEngineProject(
                    R"({"rifffs":[{"groupId":"g1","stems":[{"stemKey":"g1:0","muteRegions":[{"startBar":4,"endBar":8},{"startBar":12,"endBar":16}]}]}]})",
                    project, error);
                expect(ok);
                expectEquals(project.rifffs.size(), (size_t) 1);
                expectEquals(project.rifffs[0].stems.size(), (size_t) 1);
                const auto& regions = project.rifffs[0].stems[0].muteRegions;
                expectEquals(regions.size(), (size_t) 2);
                expectEquals(regions[0].startBar, 4.0);
                expectEquals(regions[0].endBar, 8.0);
                expectEquals(regions[1].startBar, 12.0);
                expectEquals(regions[1].endBar, 16.0);
            }

            beginTest("defaults to empty muteRegions when absent");
            {
                EngineProject project;
                juce::String error;
                bool ok = parseEngineProject(
                    R"({"rifffs":[{"groupId":"g1","stems":[{"stemKey":"g1:0"}]}]})",
                    project, error);
                expect(ok);
                expect(project.rifffs[0].stems[0].muteRegions.empty());
            }
```

- [ ] **Step 6: Build and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: all tests pass, including the two new ones above.

- [ ] **Step 7: Commit**

```bash
git add src/shared/buildEngineProject.ts native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp native-engine/CMakeLists.txt
git commit -m "Wire format: add muteRegions to EngineStem"
```

---

### Task 6: Native playback — silence muted spans with anti-click fades

**Files:**
- Create: `native-engine/Source/MuteRegionGain.h`
- Create: `native-engine/Source/MuteRegionGain.cpp`
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Modify: `native-engine/CMakeLists.txt`
- Test: `native-engine/Source/PlaybackEngineTests.cpp`

This is the highest-risk task in this plan — real-time audio callback code. Read
`native-engine/Source/PlaybackEngine.cpp`'s `renderBlock` function in full before starting (the
whole per-stem loop, both the one-shot and tiled branches) so the insertion points below make
sense in context, not just in isolation.

- [ ] **Step 1: Write `MuteRegionGain.h`**

```cpp
// native-engine/Source/MuteRegionGain.h
#pragma once
#include "EngineProject.h"
#include <vector>

namespace sssketch
{
    /** Gain multiplier in [0,1] for `sampleTimeSec` (absolute transport
     * seconds), given a stem's own mute regions (bars, converted to seconds
     * here via `spb` -- NOT pre-converted by the caller, so this can be
     * called directly against stem.muteRegions every sample with no
     * per-block heap allocation, matching this codebase's existing
     * real-time-safety convention for GainRampPoints -- see FadeGain.h's
     * own doc comment on why THAT avoids heap allocation).
     *
     * 1.0 outside every region. Inside a region, 0.0. At a region's edges,
     * ramps linearly over a short fixed window so a mute boundary doesn't
     * click -- same reasoning as FadeGain.cpp's own kMicroFadeSec, but a
     * separate constant/mechanism: GainRampPoints' fixed 4-point capacity
     * is already fully used by a segment's own fade-in/fade-out (see
     * buildFadePoints), and mute regions are a variable-length, per-stem
     * list, not a fixed-shape per-segment curve.
     *
     * Regions may overlap or be adjacent -- this returns the MINIMUM gain
     * across every region that applies at this instant, so an overlap
     * never accidentally leaks audio through (deliberately not merging
     * regions ahead of time; see the design spec's own "Known risks"
     * section on why overlap isn't merged at the data-model layer). */
    double muteRegionGainAt(
        double sampleTimeSec,
        double spb,
        const std::vector<EngineStem::MuteRegion>& regionsBars);
}
```

- [ ] **Step 2: Write `MuteRegionGain.cpp`**

```cpp
// native-engine/Source/MuteRegionGain.cpp
#include "MuteRegionGain.h"
#include <algorithm>

namespace sssketch
{
    namespace
    {
        // Same 3ms rationale as FadeGain.cpp's own kMicroFadeSec -- short
        // enough to never read as an intentional/musical fade, just enough
        // to smooth the discontinuity a hard gain jump would otherwise
        // produce at a mute region's edge.
        constexpr double kMuteMicroFadeSec = 0.003;
    }

    double muteRegionGainAt(
        double sampleTimeSec,
        double spb,
        const std::vector<EngineStem::MuteRegion>& regionsBars)
    {
        double gain = 1.0;
        for (const auto& region : regionsBars)
        {
            const double startSec = region.startBar * spb;
            const double endSec = region.endBar * spb;

            double regionGain;
            if (sampleTimeSec < startSec - kMuteMicroFadeSec || sampleTimeSec >= endSec + kMuteMicroFadeSec)
            {
                regionGain = 1.0;
            }
            else if (sampleTimeSec < startSec)
            {
                const double frac = (sampleTimeSec - (startSec - kMuteMicroFadeSec)) / kMuteMicroFadeSec;
                regionGain = 1.0 - frac;
            }
            else if (sampleTimeSec < endSec)
            {
                regionGain = 0.0;
            }
            else
            {
                const double frac = (sampleTimeSec - endSec) / kMuteMicroFadeSec;
                regionGain = frac;
            }
            gain = std::min(gain, regionGain);
        }
        return gain;
    }
}
```

- [ ] **Step 3: Add both files to the build**

In `native-engine/CMakeLists.txt`, find where `FadeGain.h`/`FadeGain.cpp` are listed as source
files and add `Source/MuteRegionGain.h`/`Source/MuteRegionGain.cpp` right alongside them, matching
the exact same list formatting.

- [ ] **Step 4: Apply the gain in `PlaybackEngine.cpp`'s one-shot branch**

Add `#include "MuteRegionGain.h"` to this file's own includes at the top (alongside the existing
`FadeGain.h`/similar includes).

In the one-shot branch's per-sample loop (the `for (int i2 = 0; i2 < numSamples; ++i2)` loop
inside `if (stem.oneShot) { ... }`), find the line:

```cpp
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume;
```

and change it to:

```cpp
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume
                            * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
```

- [ ] **Step 5: Apply the gain in the tiled-loop branch**

In the tiled branch's own per-sample loop (further down, inside the `for (; tileIdx <
totalTiles; ++tileIdx)` tile loop's own `for (int i2 = 0; i2 < numSamples; ++i2)` inner loop),
find the equivalent line:

```cpp
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume;
```

and apply the identical change:

```cpp
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume
                            * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
```

(There are two occurrences of this exact line in the file, one per branch — both need the same
change; don't skip either one.)

- [ ] **Step 6: Write the failing tests first (per this codebase's own native-test convention)**

Add to `native-engine/Source/PlaybackEngineTests.cpp`'s `runTest()`, right after the existing
"muted stem contributes nothing" test:

```cpp
            beginTest("a mute region silences only its own span, not the whole stem");
            {
                // 4 bars at 60bpm (secPerBar=4s) -> whole stem spans [0,16)s.
                // Mute region covers bars [2,3) -> seconds [8,12).
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName(); // constant 0.5
                stem.durationSec = 16.0;
                stem.barLength = 4;
                stem.muteRegions.push_back({ 2.0, 3.0 });
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Deep inside the mute region (t=10s, well past both micro-fade
                // edges at 8s/12s) -- must be silent.
                {
                    std::vector<float> l(64, 0.0f), r(64, 0.0f);
                    engine.renderBlock(10.0 / 4.0, 44100.0, 64, l.data(), r.data(), channelChains);
                    for (float s : l) expectWithinAbsoluteError(s, 0.0f, 0.001f);
                }
                // Well before the mute region (t=2s) -- must be unaffected.
                {
                    std::vector<float> l(64, 0.0f), r(64, 0.0f);
                    engine.renderBlock(2.0 / 4.0, 44100.0, 64, l.data(), r.data(), channelChains);
                    for (float s : l) expectWithinAbsoluteError(s, 0.5f, 0.001f);
                }
                // Well after the mute region (t=14s) -- must be unaffected.
                {
                    std::vector<float> l(64, 0.0f), r(64, 0.0f);
                    engine.renderBlock(14.0 / 4.0, 44100.0, 64, l.data(), r.data(), channelChains);
                    for (float s : l) expectWithinAbsoluteError(s, 0.5f, 0.001f);
                }
            }

            beginTest("a mute region's edge ramps rather than jumps discontinuously");
            {
                // Same setup as above; render a block straddling the mute
                // region's own start edge (8s) and confirm the samples ramp
                // down smoothly rather than jumping from 0.5 to 0.0 between
                // two adjacent samples.
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 16.0;
                stem.barLength = 4;
                stem.muteRegions.push_back({ 2.0, 3.0 }); // seconds [8,12)
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Render starting 5ms before the edge, straddling t=8.0s.
                const double positionBars = 7.995 / 4.0;
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);

                // No two adjacent samples should differ by more than a small
                // fraction of the full 0.5 -> 0.0 swing -- a hard cut would
                // produce exactly one sample-to-sample jump of the full 0.5.
                float maxAdjacentDelta = 0.0f;
                for (size_t i = 1; i < l.size(); ++i)
                    maxAdjacentDelta = std::max(maxAdjacentDelta, std::abs(l[i] - l[i - 1]));
                expect(maxAdjacentDelta < 0.1f);
            }
```

- [ ] **Step 7: Build and run — confirm the new tests fail first, then pass**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Before Steps 4-5's `PlaybackEngine.cpp` changes are in place, these two new tests should FAIL
(no silencing happens at all). After Steps 4-5, run again — expected: all tests PASS, including
the existing "muted stem contributes nothing" and "a later repeat of a looping stem does not get
a spurious fade-in" tests (confirming this change doesn't regress the existing whole-stem-mute or
fade-timing behavior).

Since this task's own steps are ordered "write the gain function, wire it in, then test" rather
than strict test-first, at minimum re-run the build/test cycle once with Steps 4-5 TEMPORARILY
reverted (comment out the `* muteRegionGainAt(...)` multiplication) to confirm the two new tests
genuinely fail without the fix, then restore Steps 4-5 and confirm they pass — this is the same
"verify it fails, then verify it passes" discipline as every other task in this plan, just applied
after the fact given how tightly coupled the gain function is to its two call sites.

- [ ] **Step 8: Commit**

```bash
git add native-engine/Source/MuteRegionGain.h native-engine/Source/MuteRegionGain.cpp native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp native-engine/CMakeLists.txt
git commit -m "Native engine: silence muted regions during playback with anti-click edges"
```

- [ ] **Step 9: Rebuild and fully relaunch the dev app**

Per this repo's own CLAUDE.md convention: the native engine does NOT hot-reload. After this
task's `cmake --build build`, **fully quit (Cmd+Q) and relaunch** `npm run dev` before any manual
testing in Task 8 — a renderer reload alone will not pick up the new engine binary.

---

### Task 7: Ableton export — split muted spans into real gaps

**Files:**
- Modify: `src/main/ableton/buildAlsXml.ts`
- Test: `src/main/ableton/buildAlsXml.test.ts`

Read `buildAlsXml.ts`'s current `buildStemTrack` function in full before starting — this task
restructures it from "compute one clip's attributes" into "compute N audible segments, emit one
clip per segment."

- [ ] **Step 1: Write the failing tests first**

Add to `src/main/ableton/buildAlsXml.test.ts`, in a new `describe('mute regions', ...)` block:

```ts
describe('mute region export', () => {
  it('emits a single unsplit clip when a stem has no mute regions (unchanged behavior)', () => {
    const rifff = drumsRifff() // startBar: 8, barLength: 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTrack = findChild(tracks, 'AudioTrack')!
    const body = childArray(audioTrack, 'AudioTrack')
    const deviceChain = findChild(body, 'DeviceChain')!
    const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
    const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
    const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
    const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
    const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
    expect(clips).toHaveLength(1)
  })

  it('splits a stem into two clips around a muted middle span, with a real gap', () => {
    const rifff = drumsRifff() // startBar: 8, barLength: 4, stem barLength: 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      playedBars: { 'rifff-1': 8 }, // clip spans [8,16) bars = beats [32,64)
      muteRegions: { 'rifff-1:0': [{ startBar: 10, endBar: 11 }] } // beats [40,44)
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTrack = findChild(tracks, 'AudioTrack')!
    const body = childArray(audioTrack, 'AudioTrack')
    const deviceChain = findChild(body, 'DeviceChain')!
    const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
    const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
    const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
    const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
    const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
    expect(clips).toHaveLength(2)

    const first = childArray(clips[0], 'AudioClip')
    expect(attrs(findChild(first, 'CurrentStart')!)['@_Value']).toBe('32')
    expect(attrs(findChild(first, 'CurrentEnd')!)['@_Value']).toBe('40')
    const second = childArray(clips[1], 'AudioClip')
    expect(attrs(findChild(second, 'CurrentStart')!)['@_Value']).toBe('44')
    expect(attrs(findChild(second, 'CurrentEnd')!)['@_Value']).toBe('64')

    // Both clips' own @_Id (and every Id nested within each, e.g. WarpMarker
    // Ids) must be unique -- the second clip is a clone of the first plus
    // renumbering, not a raw duplicate.
    expect(attrs(clips[0])['@_Id']).not.toBe(attrs(clips[1])['@_Id'])
  })

  it('continues the tile phase correctly across a gap, not restarting from LoopStart', () => {
    // barLength=4 (16 beats/tile). Clip spans [8,16) bars = beats [32,64),
    // unmuted, LoopStart would be 0 (no crop). Mute region at bars [10,11)
    // = beats [40,44) -- 8 beats (2 bars) into the clip. The second segment
    // starts 12 beats (3 bars) into the clip's own original timeline (its
    // own Time is beats 44, clip started at beat 32 -- elapsed 12 beats),
    // so its own tile phase should be (0 + 12) mod 16 = 12 beats, NOT 0.
    const rifff = drumsRifff()
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      playedBars: { 'rifff-1': 8 },
      muteRegions: { 'rifff-1:0': [{ startBar: 10, endBar: 11 }] }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTrack = findChild(tracks, 'AudioTrack')!
    const body = childArray(audioTrack, 'AudioTrack')
    const deviceChain = findChild(body, 'DeviceChain')!
    const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
    const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
    const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
    const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
    const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
    const second = childArray(clips[1], 'AudioClip')
    const loop = findChild(second, 'Loop')!
    const loopBody = childArray(loop, 'Loop')
    expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('12')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts -t "mute region export"`
Expected: FAIL — `emptyAppState` doesn't accept a `muteRegions` override yet (check its signature
— if it spreads `overrides` directly onto a base object with `muteRegions: {}` already present,
this may just work once Step 3 adds the field; if `emptyAppState` explicitly lists every field
rather than spreading, add `muteRegions: {}` to its own defaults), and the clip-splitting logic
doesn't exist yet (only ever one clip emitted, regardless of mute regions).

- [ ] **Step 3: Add `muteRegions` to `emptyAppState`'s defaults if needed**

Check `emptyAppState`'s definition at the top of `buildAlsXml.test.ts` (around line 24-52 based on
earlier reads in this session) — if it's a function returning a full `AppState` with explicit
field defaults (spread with `overrides` last), add `muteRegions: {},` to its base object,
matching the existing `leftCrop: {},` entry.

- [ ] **Step 4: Restructure `buildStemTrack` to split around mute regions**

Add two new pure helper functions right above `buildStemTrack` in `buildAlsXml.ts`:

```ts
interface AudibleSegment {
  segStartBeats: number
  segEndBeats: number
}

/** Given a clip's full [clipStartBeats, clipEndBeats) span and a stem's own
 * muted bar-ranges (converted to the same absolute-beats space as
 * clipStartBeats/clipEndBeats), returns the disjoint AUDIBLE sub-spans
 * remaining. A mute range outside the clip's own span is ignored; one that
 * fully covers the clip produces zero segments (nothing audible left).
 * Overlapping/adjacent mute ranges simply merge into one gap. */
function subtractMutedRanges(
  clipStartBeats: number,
  clipEndBeats: number,
  mutedRanges: { startBar: number; endBar: number }[]
): AudibleSegment[] {
  const sorted = mutedRanges
    .map((r) => ({ startBeats: r.startBar * 4, endBeats: r.endBar * 4 }))
    .sort((a, b) => a.startBeats - b.startBeats)
  const segments: AudibleSegment[] = []
  let cursor = clipStartBeats
  for (const range of sorted) {
    const rangeStart = Math.max(range.startBeats, clipStartBeats)
    const rangeEnd = Math.min(range.endBeats, clipEndBeats)
    if (rangeEnd <= cursor) continue
    if (rangeStart > cursor) segments.push({ segStartBeats: cursor, segEndBeats: rangeStart })
    cursor = Math.max(cursor, rangeEnd)
  }
  if (cursor < clipEndBeats) segments.push({ segStartBeats: cursor, segEndBeats: clipEndBeats })
  return segments
}

/** For a TILED (non-one-shot) stem's clip, the tile phase (in beats,
 * wrapped into [0, tileLengthBeats)) `elapsedBeatsFromClipStart` beats past
 * the clip's own ORIGINAL Time position -- i.e. "if a segment starts this
 * many beats after the clip's true beginning, which point in the tile
 * cycle is that?" Used so a segment resuming after a muted gap picks up
 * the SAME tile phase it would have had if the gap didn't exist, rather
 * than restarting the loop from originalLoopStartBeats every time. Mirrors
 * computeLoopWindow's own wrappedLeftCropBars wrapping, generalized to an
 * arbitrary elapsed offset instead of just leftCropBars itself. */
function tilePhaseAtElapsedBeats(
  originalLoopStartBeats: number,
  elapsedBeatsFromClipStart: number,
  tileLengthBeats: number
): number {
  const raw = originalLoopStartBeats + elapsedBeatsFromClipStart
  return ((raw % tileLengthBeats) + tileLengthBeats) % tileLengthBeats
}
```

Now replace `buildStemTrack`'s body from where it currently does:

```ts
  const timeBeats = ((rifff.startBar ?? 0) + timeShiftBars) * 4
  setAttr(clip, '@_Time', String(timeBeats))

  const clipBody = childArray(clip, 'AudioClip')
  setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)

  setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', String(timeBeats))
  setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(timeBeats + currentEndBeats))
```

through the end of the function (everything that sets attributes on the SINGLE `clip` found via
`findAudioClip(track)`, including the `Loop`/`IsWarped`/`SampleRef`/`WarpMode`/`WarpMarkers`
blocks) with a version that:
1. Computes `clipStartBeats`/`clipEndBeats` as before.
2. Calls `subtractMutedRanges` to get the audible segments.
3. For the FIRST segment, reuses the SAME `clip` node `findAudioClip(track)` already found (no
   extra clone needed — this is the clip already embedded in the cloned track).
4. For every ADDITIONAL segment, clones that same original `clip` node via `cloneNode`,
   renumbers ITS Ids via the shared `nextId` (a clip has its own `@_Id`, confirmed via the real
   template — see this plan's own research), and pushes it into the SAME track's `Events`
   children array.
5. Every segment gets its own `Time`/`CurrentStart`/`CurrentEnd`, and for a tiled (non-one-shot)
   stem, its own `LoopStart` computed via `tilePhaseAtElapsedBeats` relative to the FIRST
   segment's own original (pre-split) `loopStartBeats`/`timeBeats` — a one-shot stem has no
   tiling concept at all (`isWarped=false`), so every one-shot segment just keeps the SAME
   `loopStartBeats`/`loopEndBeats` computed once by `computeLoopWindow` (only its own
   `Time`/`CurrentStart`/`CurrentEnd` differ per segment, matching a one-shot's own trim/segment
   semantics — no phase-continuity concept applies there).
6. If there are ZERO audible segments (the whole clip is muted end-to-end), remove the clip
   entirely (`events['Events'] = []`) rather than leaving an empty or degenerate clip behind.
7. Everything computed ONCE per track that ISN'T segment-specific (`nativeBpm`, `warpModeFor`,
   `SampleRef`/`FileRef` path, clip `Name`, track's own `TrackGroupId`/track name) stays exactly
   as it already is — this only affects the segment-specific attributes.

```ts
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)
  clearSends(track, 'AudioTrack')

  const trackBody = childArray(track, 'AudioTrack')
  setAttr(findChild(trackBody, 'TrackGroupId')!, '@_Value', groupTrackId)

  const trackName = `${rifff.name} - ${stem.name}`
  const nameNode = findChild(trackBody, 'Name')!
  setAttr(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!, '@_Value', trackName)

  const deviceChain = findChild(trackBody, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sampleNode = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sampleNode, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  const canonicalClip = findChild(childArray(events, 'Events'), 'AudioClip')!

  const nativeBpm = nativeBpmFor(stem)
  const {
    loopStartBeats,
    loopEndBeats,
    loopOn,
    timeShiftBars,
    currentEndBeats,
    hiddenLoopEndBeats,
    isWarped
  } = computeLoopWindow(stem, leftCropBars, playedBars, projectBpm)

  const clipStartBeats = ((rifff.startBar ?? 0) + timeShiftBars) * 4
  const clipEndBeats = clipStartBeats + currentEndBeats
  const muteRegionsForStem = muteRegions[stemKey(rifff.groupId, stem.slot)] ?? []
  const audibleSegments = subtractMutedRanges(clipStartBeats, clipEndBeats, muteRegionsForStem)

  const relativePath = join('Samples', 'Imported', fileName)
  const absolutePath = join(outputDir, relativePath)
  const tileLengthBeats = stem.barLength * 4

  const segmentClips: AlsNode[] = []
  audibleSegments.forEach((segment, i) => {
    const segClip = i === 0 ? canonicalClip : cloneNode(canonicalClip)
    if (i > 0) renumberIds(segClip, nextId)

    setAttr(segClip, '@_Time', String(segment.segStartBeats))
    const clipBody = childArray(segClip, 'AudioClip')
    setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)
    setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', String(segment.segStartBeats))
    setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(segment.segEndBeats))

    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')
    const segLoopStartBeats = isWarped
      ? tilePhaseAtElapsedBeats(
          loopStartBeats,
          segment.segStartBeats - clipStartBeats,
          tileLengthBeats
        )
      : loopStartBeats
    setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(segLoopStartBeats))
    setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(loopEndBeats))
    setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', loopOn ? 'true' : 'false')
    setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
    setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(hiddenLoopEndBeats))

    setAttr(findChild(clipBody, 'IsWarped')!, '@_Value', isWarped ? 'true' : 'false')

    const sampleRef = findChild(clipBody, 'SampleRef')!
    const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
    const fileRefBody = childArray(fileRef, 'FileRef')
    setAttr(findChild(fileRefBody, 'Path')!, '@_Value', absolutePath)
    setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

    setAttr(findChild(clipBody, 'WarpMode')!, '@_Value', String(warpModeFor(stem)))

    if (isWarped) {
      const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
      warpMarkersNode['WarpMarkers'] = [
        { WarpMarker: [], ':@': { '@_Id': String(nextId()), '@_SecTime': '0', '@_BeatTime': '0' } },
        {
          WarpMarker: [],
          ':@': { '@_Id': String(nextId()), '@_SecTime': String(60 / nativeBpm), '@_BeatTime': '1' }
        }
      ]
    }

    segmentClips.push(segClip)
  })

  events['Events'] = segmentClips

  return track
```

This changes `buildStemTrack`'s own signature: it now needs `muteRegions: AppState['muteRegions']`
as an additional parameter (read from `state.muteRegions` by its caller in `buildAlsXml`'s main
loop), since the original signature only received `leftCropBars`/`playedBars` as already-resolved
scalars, not the full state. Update the function signature:

```ts
function buildStemTrack(
  canonicalAudioTrack: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  groupTrackId: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions']
): AlsNode {
```

And update its one call site inside `buildAlsXml`'s main loop to pass `state.muteRegions` as the
new final argument.

- [ ] **Step 5: Handle the fully-muted-clip case (zero audible segments)**

The `events['Events'] = segmentClips` assignment above already handles this correctly —
`segmentClips` is simply empty when `audibleSegments` is empty, leaving the track with zero
clips (structurally valid; Ableton shows an empty track, same as any track this export already
produces for a stem whose `stemFileNames` lookup failed). No special-case branch needed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: ALL tests pass — both the 3 new ones from Step 1 and every pre-existing test in this
file (confirming the single-segment/no-mute-regions case is byte-for-byte unchanged from before).

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts
git commit -m "Ableton export: split a stem's clip around muted spans, continuing tile phase across the gap"
```

---

### Task 8: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run:
```bash
npm test
npm run typecheck
npm run lint
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: all pass with zero failures/errors (the pre-existing, unrelated `scanOneCandidate`
flaky test in `pluginScan.test.ts` may still fail intermittently under system load — see this
project's own established note on that test's history; not a regression to chase here).

- [ ] **Step 2: Manual walkthrough**

Since this touches `native-engine/Source/` (a rebuild happened in Task 6) and no `src/main/`
IPC/preload surface changed, a renderer-only reload should suffice for the UI/state changes —
but confirm the native engine picked up its Task 6 rebuild by having already done the full
Cmd+Q + relaunch called out at the end of Task 6, before starting this walkthrough.

Walk through, in order:
1. **Move still works from the title bar only**: drag a rifff by its name bar (collapsed view)
   or the expanded view's own rifff-level name bar — confirms it still moves the whole clip.
2. **Dragging the waveform body no longer moves the clip**: in both collapsed and expanded view,
   click-drag in the middle of a stem's waveform — confirms a selection highlight appears instead
   of the clip moving.
3. **Plain click still scrubs**: a click with no real drag still moves the playhead to that exact
   point, same as before this feature.
4. **Mute a region**: drag a selection, press Delete — confirms the selected span turns into the
   hatched pattern and audibly goes silent during playback, with no audible click at either edge.
5. **Unmute a region**: click the hatched span (should immediately re-select it), press Delete
   again — confirms the hatch disappears and audio resumes playing there.
6. **Whole-rifff mute (collapsed view) vs per-stem mute (expanded view)**: confirm a mute made in
   collapsed view affects every stem, and a mute made after expanding one specific stem only
   affects that stem.
7. **Escape cancels**: start a drag-selection, press Escape before releasing — confirms nothing
   gets muted and the highlight disappears.
8. **Whole-clip Delete still works when nothing is selected**: with no pending region selection,
   select a whole rifff and press Delete — confirms it's still removed from the timeline (the
   pre-existing behavior, unaffected by this feature).
9. **Export to Ableton with a mute region present**: export a project containing at least one
   muted region, confirm it **opens cleanly** in Ableton (non-negotiable, given this exporter's
   own history — see `2026-08-04-ableton-export-design.md`'s "Known risks" and "Post-ship bugs"
   sections) and that the exported track shows a real gap where the mute was, with audio
   continuing to loop correctly (not glitching/restarting) on the far side of the gap.

- [ ] **Step 3: Report findings**

If anything in the manual walkthrough doesn't match, do NOT patch it ad hoc — apply
`superpowers:systematic-debugging` before proposing a fix, per this project's own established
convention (see this repo's Ableton-export bug history for why: guessing at fixes for this exact
codebase has cost entire sessions before, root-causing first has consistently been faster).
