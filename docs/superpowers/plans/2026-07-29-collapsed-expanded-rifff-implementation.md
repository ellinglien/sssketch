# Collapsed/Expanded Rifff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring back a per-rifff collapsed/expanded toggle, and fix "grab anywhere to move a
clip" in the expanded view, per
`docs/superpowers/specs/2026-07-29-collapsed-expanded-rifff-design.md`.

**Architecture:** Revives the existing (currently dead) `state.exp` field with a real
`TOGGLE_EXPAND` action and a new `CollapsedRifffRow` component; adds a `volumeDragMode` toggle
(`V` key) that repurposes the expanded waveform's open body between "move the clip" (default)
and "adjust volume" (today's only behavior there). Both new drag surfaces (the collapsed block,
and the expanded waveform body) reuse `dragGrabOffset.ts`'s already-tested grab-offset machinery
from an earlier plan this session — a small shared helper is extracted first so the same
"compute the mouse's bar position relative to the timeline" logic isn't tripled across three
drag sources.

**Tech Stack:** TypeScript/React (renderer), Vitest (unit tests).

---

## Design decisions made while writing this plan (not fully pinned down by the design doc)

1. **`PLACE_ON_TIMELINE` and `PASTE_RIFFF` currently force `exp[groupId] = true`.** This is a
   leftover from before `TOGGLE_EXPAND` was deleted (when placing a rifff used to auto-expand it
   to show its stems) — with `state.exp` currently unused by any rendering, this line has had no
   visible effect since. It directly contradicts this plan's "collapsed is the new default"
   requirement: left as-is, every freshly-placed or pasted rifff would render expanded, not
   collapsed. Task 1 removes both assignments so a fresh rifff has no `exp` entry (falsy →
   collapsed, by construction, no migration needed). **This changes the outcome of an existing
   passing test** (`store.test.ts`'s `'placing on the timeline sets startBar, selects, expands,
   and enables stretch'`) — Task 1 updates it to assert the opposite and renames it accordingly,
   rather than leaving a stale assertion that would otherwise start failing.

2. **`clipGeometry` (in `selectors.ts`) is stale and unsuitable for the collapsed block's width.**
   It predates the `playedBars` resize feature added earlier this session and always uses
   `rifff.barLength` — it would silently ignore an active resize, making the collapsed block's
   width visually wrong (too short/long) whenever one had been applied while linked. `stemGeometry`
   (also in `selectors.ts`) already accounts for `resolvePlayedBars` correctly and, for a stem in
   a *linked* group, resolves to the exact same group-level position/width `clipGeometry` was
   trying to compute (since `resolveOffsetKey`/`resolvePlayedBars` both key on `groupId` while
   linked). Task 3 uses `stemGeometry(state, groupId, rifff.stems[0].slot, PPB)` for the
   collapsed block's geometry — correct for the common (linked) case, and a reasonable
   "represents the first stem" fallback for an unlinked-but-collapsed rifff (an edge case the
   design doc doesn't specifically address; not worth more complexity for a state combination
   the UI doesn't specifically encourage).

3. **Collapsed-view dragging always moves the whole group, regardless of link state** — unlike
   the expanded view's per-stem grab targets, which branch on `unlinked`. Collapsing intentionally
   hides per-stem detail; a single summary block dragging "part of itself" independently would be
   confusing with nothing on screen to distinguish which stem moved. `PLACE_ON_TIMELINE` is
   always the right action here.

4. **`volumeDragMode` is excluded from saved projects.** `serialize.ts`'s `PersistedProject` type
   already omits `playing`/`pos` as session-only state that shouldn't survive a reopen — this new
   field is the same kind of thing (an interaction mode, not arrangement content), so Task 1 adds
   it to that same omit list.

5. **`TOGGLE_EXPAND` is *not* added to `history.ts`'s `TRANSIENT_ACTION_TYPES`** (unlike
   `TOGGLE_VOLUME_DRAG_MODE`, which the design doc explicitly calls out as transient). Precedent:
   `SELECT` (also arguably "just UI state") is already undo-tracked in this codebase, not
   transient — collapsing/expanding a rifff follows that same existing convention rather than
   introducing a new category of "UI-only, not undo-tracked" state beyond what `PLAY`/`PAUSE`/
   `STOP`/`SET_POS` already cover (all four of which are genuinely continuous/high-frequency,
   unlike a chevron click).

---

### Task 1: State + reducer — `TOGGLE_EXPAND`, `TOGGLE_VOLUME_DRAG_MODE`

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`
- Modify: `src/renderer/src/state/history.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Read all five files in full**

- [ ] **Step 2: Write the failing reducer tests**

In `src/renderer/src/state/store.test.ts`, first **update** the existing test that currently
asserts the old (about-to-be-wrong) behavior:

```ts
  it('placing on the timeline sets startBar, selects, and enables stretch, without forcing it expanded', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(state.rifffs.r1.startBar).toBe(4)
    expect(state.sel).toBe('r1')
    expect(state.exp.r1).toBeUndefined()
    expect(state.stretch.r1).toBe(true)
  })
```

(This replaces the existing `it('placing on the timeline sets startBar, selects, expands, and
enables stretch', ...)` test — same body structure, just the renamed description and the
`exp.r1` assertion flipped from `toBe(true)` to `toBeUndefined()`.)

Then add new tests for the two new actions, alongside the existing `describe('RESIZE_LEFT', ...)`
block style:

```ts
  describe('TOGGLE_EXPAND', () => {
    it('starts undefined (collapsed) and toggles true/false', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      expect(state.exp.r1).toBeUndefined()
      state = reducer(state, { type: 'TOGGLE_EXPAND', groupId: 'r1' })
      expect(state.exp.r1).toBe(true)
      state = reducer(state, { type: 'TOGGLE_EXPAND', groupId: 'r1' })
      expect(state.exp.r1).toBe(false)
    })
  })

  describe('TOGGLE_VOLUME_DRAG_MODE', () => {
    it('starts false and toggles true/false', () => {
      expect(initialState.volumeDragMode).toBe(false)
      let state = reducer(initialState, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
      expect(state.volumeDragMode).toBe(true)
      state = reducer(state, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
      expect(state.volumeDragMode).toBe(false)
    })
  })
```

(There's no existing `PASTE_RIFFF` test in this file to update — `grep -n "PASTE_RIFFF"
src/renderer/src/state/store.test.ts` currently returns nothing, so the reducer change to that
case in Step 6 below needs no matching test update.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `TOGGLE_EXPAND`/`TOGGLE_VOLUME_DRAG_MODE` aren't valid actions yet, and the
updated `PLACE_ON_TIMELINE` test fails against the current `exp: true` behavior.

- [ ] **Step 4: Add `volumeDragMode` to `AppState` and `initialState`**

In `src/renderer/src/state/store.ts`, find:

```ts
  sel: string | null
  exp: Record<string, boolean>
  rifffs: Record<string, Rifff>
}
```

Change to:

```ts
  sel: string | null
  exp: Record<string, boolean>
  /** Global interaction mode for the expanded waveform's open body: false (default)
   * drags the clip, true repurposes the same drag to adjust volume instead. Toggled
   * by the V key — see App.tsx's Frame component. Not persisted (see serialize.ts). */
  volumeDragMode: boolean
  rifffs: Record<string, Rifff>
}
```

Find:

```ts
  sel: null,
  exp: {},
  rifffs: {}
}
```

Change to:

```ts
  sel: null,
  exp: {},
  volumeDragMode: false,
  rifffs: {}
}
```

- [ ] **Step 5: Add the two new actions to the `Action` union**

Find:

```ts
  | { type: 'SET_STEM_TYPE'; groupId: string; slot: number; soundType: SoundType }
  | { type: 'PLAY' }
```

Change to:

```ts
  | { type: 'SET_STEM_TYPE'; groupId: string; slot: number; soundType: SoundType }
  | { type: 'TOGGLE_EXPAND'; groupId: string }
  | { type: 'TOGGLE_VOLUME_DRAG_MODE' }
  | { type: 'PLAY' }
```

- [ ] **Step 6: Remove the two `exp: true` assignments**

In `PLACE_ON_TIMELINE`, find:

```ts
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: action.startBar }
        },
        bpm: isFirstPlacement ? rifff.bpm : state.bpm,
        sel: action.groupId,
        exp: { ...state.exp, [action.groupId]: true },
        stretch: { ...state.stretch, [action.groupId]: true }
      }
```

Change to (drop the `exp` line — `...state` already carries whatever `exp` was):

```ts
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: action.startBar }
        },
        bpm: isFirstPlacement ? rifff.bpm : state.bpm,
        sel: action.groupId,
        stretch: { ...state.stretch, [action.groupId]: true }
      }
```

In `PASTE_RIFFF`, find:

```ts
    case 'PASTE_RIFFF':
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
        vol: { ...state.vol, ...action.vol },
        mute: { ...state.mute, ...action.mute },
        off: { ...state.off, ...action.off },
        stretch: { ...state.stretch, [action.rifff.groupId]: action.stretch },
        sel: action.rifff.groupId,
        exp: { ...state.exp, [action.rifff.groupId]: true }
      }
```

Change to:

```ts
    case 'PASTE_RIFFF':
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
        vol: { ...state.vol, ...action.vol },
        mute: { ...state.mute, ...action.mute },
        off: { ...state.off, ...action.off },
        stretch: { ...state.stretch, [action.rifff.groupId]: action.stretch },
        sel: action.rifff.groupId
      }
```

- [ ] **Step 7: Add the two new reducer cases**

Find:

```ts
    case 'PLAY':
      return { ...state, playing: true }
```

Insert immediately before it:

```ts
    case 'TOGGLE_EXPAND':
      return { ...state, exp: { ...state.exp, [action.groupId]: !state.exp[action.groupId] } }

    case 'TOGGLE_VOLUME_DRAG_MODE':
      return { ...state, volumeDragMode: !state.volumeDragMode }

    case 'PLAY':
      return { ...state, playing: true }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS (all tests, including the two new `describe` blocks and the updated
`PLACE_ON_TIMELINE` test).

- [ ] **Step 9: Add `TOGGLE_VOLUME_DRAG_MODE` to `TRANSIENT_ACTION_TYPES`**

In `src/renderer/src/state/history.ts`, find:

```ts
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>(['SET_POS', 'PLAY', 'PAUSE', 'STOP'])
```

Change to:

```ts
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>([
  'SET_POS',
  'PLAY',
  'PAUSE',
  'STOP',
  'TOGGLE_VOLUME_DRAG_MODE'
])
```

`TOGGLE_EXPAND` is deliberately *not* added here — see "Design decisions" §5 above.

- [ ] **Step 10: Exclude `volumeDragMode` from saved projects**

In `src/renderer/src/state/serialize.ts`, find:

```ts
export type PersistedProject = Omit<AppState, 'playing' | 'pos'>

export function serializeProject(state: AppState): string {
  // Rest destructure is how we drop playing/pos; ignoreRestSiblings isn't enabled
  // project-wide, so the two extracted-but-unused bindings need an explicit disable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { playing, pos, ...rest } = state
  return JSON.stringify(rest, null, 2)
}
```

Change to:

```ts
export type PersistedProject = Omit<AppState, 'playing' | 'pos' | 'volumeDragMode'>

export function serializeProject(state: AppState): string {
  // Rest destructure is how we drop playing/pos/volumeDragMode; ignoreRestSiblings isn't
  // enabled project-wide, so the three extracted-but-unused bindings need an explicit disable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { playing, pos, volumeDragMode, ...rest } = state
  return JSON.stringify(rest, null, 2)
}
```

`deserializeProject` needs no change — it already spreads `initialState` first
(`{ ...initialState, ...data, playing: false, pos: 0 }`), so the omitted `volumeDragMode` key
falls back to `initialState.volumeDragMode` (`false`) automatically.

- [ ] **Step 11: Add a serialization test**

In `src/renderer/src/state/serialize.test.ts`, add a second test to the existing `describe`
block:

```ts
  it('does not persist volumeDragMode — always reopens with it off', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
    expect(state.volumeDragMode).toBe(true)

    const json = serializeProject(state)
    expect(JSON.parse(json).volumeDragMode).toBeUndefined()

    const restored = deserializeProject(JSON.parse(json))
    expect(restored.volumeDragMode).toBe(false)
  })
```

- [ ] **Step 12: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 13: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts src/renderer/src/state/history.ts src/renderer/src/state/serialize.ts src/renderer/src/state/serialize.test.ts
git commit -m "Add TOGGLE_EXPAND and TOGGLE_VOLUME_DRAG_MODE state, stop force-expanding on placement"
```

---

### Task 2: Extract shared `mouseBarFromDragEvent` helper

**Files:**
- Modify: `src/renderer/src/components/dragGrabOffset.ts`
- Modify: `src/renderer/src/components/dragGrabOffset.test.ts`
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

This is a pure refactor (no behavior change) that pulls the "compute the mouse's bar position
relative to the timeline" logic — currently duplicated identically in `RifffBlockRow.tsx`'s
header drag and `StemWaveformRow.tsx`'s label-column drag — into one shared function, so the
*third* copy this plan is about to add (Task 5, the waveform body) doesn't triple it.

- [ ] **Step 1: Read all four files in full**

- [ ] **Step 2: Write the failing test**

In `src/renderer/src/components/dragGrabOffset.test.ts`, add a new `describe` block. This needs
a fake drag event and a fake `[data-timeline]` element in the DOM — this project's test
environment is `happy-dom`/`jsdom` (already used by other renderer tests in this codebase), so
real DOM APIs like `getBoundingClientRect` work, just need mocking since jsdom doesn't compute
real layout:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
```

(add `afterEach`, `vi` to the existing `import { describe, expect, it } from 'vitest'` line at
the top of the file)

```ts
describe('mouseBarFromDragEvent', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns null when there is no [data-timeline] ancestor', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const result = mouseBarFromDragEvent({ currentTarget: target, clientX: 300 })
    expect(result).toBeNull()
  })

  it('computes the bar position relative to the timeline origin', () => {
    const timeline = document.createElement('div')
    timeline.setAttribute('data-timeline', '')
    const target = document.createElement('div')
    timeline.appendChild(target)
    document.body.appendChild(timeline)
    // PPB=24, LANE_HEADER_WIDTH=212 (Ruler.tsx) — timeline's own left edge at
    // clientX=0, so a click at clientX=452 is (452-0-212)/24 = 10 bars in.
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ left: 0 } as DOMRect)
    const result = mouseBarFromDragEvent({ currentTarget: target, clientX: 452 })
    expect(result).toBe(10)
  })

  it('clamps to 0 rather than going negative', () => {
    const timeline = document.createElement('div')
    timeline.setAttribute('data-timeline', '')
    const target = document.createElement('div')
    timeline.appendChild(target)
    document.body.appendChild(timeline)
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ left: 0 } as DOMRect)
    const result = mouseBarFromDragEvent({ currentTarget: target, clientX: 0 })
    expect(result).toBe(0)
  })
})
```

Add `mouseBarFromDragEvent` to the existing import at the top of the test file:

```ts
import {
  computeGrabOffsetBars,
  applyGrabOffset,
  setGrabOffsetBars,
  getGrabOffsetBars,
  mouseBarFromDragEvent
} from './dragGrabOffset'
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/dragGrabOffset.test.ts`
Expected: FAIL — `mouseBarFromDragEvent` doesn't exist yet.

- [ ] **Step 4: Write the helper**

In `src/renderer/src/components/dragGrabOffset.ts`, add the import and the new function:

```ts
import { PPB, LANE_HEADER_WIDTH } from './Ruler'
```

```ts
/** The bar position under the mouse, relative to the timeline's own left
 * edge — shared by every onDragStart handler that needs to compute a grab
 * offset (RifffBlockRow's header, StemWaveformRow's label column, and its
 * waveform body), so this "find the [data-timeline] ancestor and convert
 * clientX to a bar position" math exists in exactly one place. Returns null
 * if there's no [data-timeline] ancestor to measure against — shouldn't
 * happen in practice, every drag source here is rendered inside Timeline. */
export function mouseBarFromDragEvent(e: { currentTarget: EventTarget; clientX: number }): number | null {
  const target = e.currentTarget as HTMLElement
  const rect = target.closest('[data-timeline]')?.getBoundingClientRect()
  if (!rect) return null
  return Math.max(0, (e.clientX - rect.left - LANE_HEADER_WIDTH) / PPB)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/dragGrabOffset.test.ts`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 6: Retrofit `RifffBlockRow.tsx` to use the helper**

Find:

```tsx
import { PPB, LANE_HEADER_WIDTH } from './Ruler'
import { computeGrabOffsetBars, setGrabOffsetBars } from './dragGrabOffset'
```

In the file's current state, `PPB` and `LANE_HEADER_WIDTH` are used in exactly one place — the
grab-offset computation this step replaces — so the whole `import { PPB, LANE_HEADER_WIDTH }
from './Ruler'` line can be deleted outright. Change the two import lines to:

```tsx
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
```

(This drops the `./Ruler` import entirely and adds `mouseBarFromDragEvent` to the existing
`dragGrabOffset` import — `computeGrabOffsetBars` stays, since it's still called directly below.)

Find:

```tsx
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
```

Change to:

```tsx
          onDragStart={(e) => {
            e.dataTransfer.setData('text/rifff-group-id', groupId)
            // Grab point in bars, relative to this rifff's own current start —
            // read back in Timeline's handleDragOver/handleDrop (App.tsx) so
            // the clip moves as if picked up at this exact point rather than
            // snapping its start under wherever the mouse ends up.
            const mouseBar = mouseBarFromDragEvent(e)
            if (mouseBar !== null) {
              setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
            }
          }}
```

- [ ] **Step 7: Retrofit `StemWaveformRow.tsx`'s label-column drag to use the helper**

Find:

```tsx
        onDragStart={(e) => {
          if (!unlinked) return
          e.dataTransfer.setData('text/rifff-stem-key', key)
          const rect = e.currentTarget.closest('[data-timeline]')?.getBoundingClientRect()
          if (rect) {
            const mouseBar = Math.max(0, (e.clientX - rect.left - LANE_HEADER_WIDTH) / PPB)
            setGrabOffsetBars(computeGrabOffsetBars(mouseBar, baseStartBar))
          }
        }}
```

Change to:

```tsx
        onDragStart={(e) => {
          if (!unlinked) return
          e.dataTransfer.setData('text/rifff-stem-key', key)
          const mouseBar = mouseBarFromDragEvent(e)
          if (mouseBar !== null) {
            setGrabOffsetBars(computeGrabOffsetBars(mouseBar, baseStartBar))
          }
        }}
```

Find:

```tsx
import { PPB, LANE_HEADER_WIDTH } from './Ruler'
import { startPointerDrag } from './dragUtils'
import { computeGrabOffsetBars, setGrabOffsetBars } from './dragGrabOffset'
```

Change to (this file still needs `PPB` for its own geometry math elsewhere — check with
`grep -n "PPB" src/renderer/src/components/StemWaveformRow.tsx` before touching that part of the
import; `LANE_HEADER_WIDTH` was only ever used for the grab-offset math this step just replaced,
so it can be dropped):

```tsx
import { PPB } from './Ruler'
import { startPointerDrag } from './dragUtils'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
```

- [ ] **Step 8: Typecheck and run the full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 9: Manual verification**

Start the dev app. Confirm dragging a placed rifff by its name header, and dragging an unlinked
stem by its label column, both still work exactly as before (grab-point preserved, no jump on
drop) — this step should be behaviorally invisible.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/dragGrabOffset.ts src/renderer/src/components/dragGrabOffset.test.ts src/renderer/src/components/RifffBlockRow.tsx src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Extract shared mouseBarFromDragEvent helper, dedupe two existing call sites"
```

---

### Task 3: `CollapsedRifffRow` component

**Files:**
- Create: `src/renderer/src/components/CollapsedRifffRow.tsx`

**Files to read first:** `src/renderer/src/components/StemWaveformRow.tsx` (for the tiling
pattern, `ROW_HEIGHT`, and the mute-dot styling to match), `src/renderer/src/components/
RifffBlockRow.tsx` (for the header content this needs to mirror), `src/renderer/src/state/
selectors.ts` (for `stemGeometry`), `src/renderer/src/components/Ruler.tsx` (for `PPB`).

For historical reference on the original fade-gradient overlay this restores, see
`git show 44ed1ec^:src/renderer/src/components/RifffBlockRow.tsx` — it used:

```tsx
const fadeInPx = Math.min(geo.widthPx / 2, (state.fadeIn[groupId] ?? 0) * PPB)
const fadeOutPx = Math.min(geo.widthPx / 2, (state.fadeOut[groupId] ?? 0) * PPB)
// ...
{fadeInPx > 0 && (
  <div style={{position:'absolute',top:0,bottom:0,left:0,width:fadeInPx,background:'linear-gradient(to right, rgba(0,0,0,0.6), transparent)',pointerEvents:'none'}}/>
)}
{fadeOutPx > 0 && (
  <div style={{position:'absolute',top:0,bottom:0,right:0,width:fadeOutPx,background:'linear-gradient(to left, rgba(0,0,0,0.6), transparent)',pointerEvents:'none'}}/>
)}
```

This plan adapts that directly, using this session's `stemGeometry`-derived width instead of the
stale `clipGeometry` (see "Design decisions" §2 above).

- [ ] **Step 1: Write the component**

Create `src/renderer/src/components/CollapsedRifffRow.tsx`:

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PolarGlyph } from './PolarGlyph'
import { PPB } from './Ruler'
import { ROW_HEIGHT } from './StemWaveformRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'

/** Tiles one representative stem's waveform across the collapsed block's
 * width, repeating every rifff.barLength — same non-stretching-loop rationale
 * as StemWaveformRow's own tiling (see that file's comment), simplified here
 * since a collapsed block isn't individually resizable: one tile is
 * barLength bars wide in pixels, repeated across widthPx (the rifff's
 * current played length, from stemGeometry — see "Design decisions" §2 in
 * the plan doc for why that's the right geometry source here). */
function CollapsedTiles({
  path,
  color,
  widthPx,
  barLength
}: {
  path: string
  color: string
  widthPx: number
  barLength: number
}): React.JSX.Element {
  const tileWidthPx = barLength * PPB
  const tileCount = Math.max(1, Math.ceil(widthPx / tileWidthPx))
  const tileOffsets = Array.from({ length: tileCount }, (_, i) => i * tileWidthPx)
  return (
    <>
      {tileOffsets.map((left) => (
        <div key={left} style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}>
          <Waveform path={path} color={color} opacity={1} />
        </div>
      ))}
    </>
  )
}

export function CollapsedRifffRow({
  groupId,
  selected
}: {
  groupId: string
  selected: boolean
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const firstStem = rifff.stems[0]
  const color = typeColorVar(firstStem?.type ?? 'fx')

  // See "Design decisions" §2 in the plan doc: stemGeometry (not the stale
  // clipGeometry) so an active playedBars resize while linked is reflected
  // here too, not silently ignored.
  const geo = stemGeometry(state, groupId, firstStem.slot, PPB)
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0
  const fadeInPx = Math.min(geo.widthPx / 2, fadeIn * PPB)
  const fadeOutPx = Math.min(geo.widthPx / 2, fadeOut * PPB)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/rifff-group-id', groupId)
        const mouseBar = mouseBarFromDragEvent(e)
        if (mouseBar !== null) {
          setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
        }
      }}
      style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)', cursor: 'grab' }}
    >
      <div
        style={{
          width: 212,
          flexShrink: 0,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <PolarGlyph stems={rifff.stems} identityColor={color} size={26} />
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
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
            top: 0,
            bottom: 0,
            left: geo.leftPx,
            width: geo.widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} ${selected ? 70 : 40}%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          <CollapsedTiles path={firstStem.path} color={color} widthPx={geo.widthPx} barLength={rifff.barLength} />
          {fadeInPx > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: fadeInPx,
                background: 'linear-gradient(to right, rgba(0,0,0,0.6), transparent)',
                pointerEvents: 'none'
              }}
            />
          )}
          {fadeOutPx > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: fadeOutPx,
                background: 'linear-gradient(to left, rgba(0,0,0,0.6), transparent)',
                pointerEvents: 'none'
              }}
            />
          )}
          {/* Mini mute-dot row: one per stem, same filled/hollow convention as
              the expanded view's mute button. stopPropagation so clicking a dot
              doesn't also start a drag on this block. */}
          <div style={{ position: 'absolute', left: 6, top: 6, display: 'flex', gap: 4, zIndex: 2 }}>
            {rifff.stems.map((stem) => {
              const key = stemKey(groupId, stem.slot)
              const muted = !!state.mute[key]
              return (
                <button
                  key={stem.slot}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title={`${stem.name}: ${muted ? 'unmute' : 'mute'}`}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    border: '1px solid rgba(201,191,232,0.6)',
                    background: muted ? 'transparent' : 'var(--ra-text-2)',
                    padding: 0,
                    cursor: 'pointer'
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

This component isn't wired into `RifffBlockRow` yet (Task 4) — no live UI to check yet. Confirm
the file typechecks cleanly and re-read it once end-to-end: header content matches
`RifffBlockRow`'s own header, the fade gradients only render when `fadeIn`/`fadeOut` are
non-zero, and the mute-dot row renders exactly one dot per stem.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "Add CollapsedRifffRow: summary block, fade hint, mini mute row, draggable"
```

---

### Task 4: Wire the chevron toggle into `RifffBlockRow`

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`

- [ ] **Step 1: Read the current file in full**

- [ ] **Step 2: Import `CollapsedRifffRow` and branch on `state.exp[groupId]`**

Find:

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow, ROW_HEIGHT } from './StemWaveformRow'
import { PolarGlyph } from './PolarGlyph'
```

Add the import:

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow, ROW_HEIGHT } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { PolarGlyph } from './PolarGlyph'
```

Find:

```tsx
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  const color = identityColor(rifff)
```

Add an `expanded` binding right after:

```tsx
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  const expanded = !!state.exp[groupId]
  const color = identityColor(rifff)
```

- [ ] **Step 3: Render `CollapsedRifffRow` when collapsed, today's header + stems when expanded**

Find:

```tsx
      {rifff.stems.map((stem) => (
        <StemWaveformRow key={stem.slot} groupId={groupId} slot={stem.slot} />
      ))}
    </div>
  )
}
```

Change to:

```tsx
      {expanded ? (
        rifff.stems.map((stem) => (
          <StemWaveformRow key={stem.slot} groupId={groupId} slot={stem.slot} />
        ))
      ) : (
        <CollapsedRifffRow groupId={groupId} selected={selected} />
      )}
    </div>
  )
}
```

This leaves the existing header (name/glyph/counts, always visible, both collapsed and expanded
— it's `RifffBlockRow`'s own header, separate from `CollapsedRifffRow`'s own inner header) and
its background/drag-target sizing exactly as they are — collapsing only changes what renders
*below* that header (one `CollapsedRifffRow` row for the whole rifff, vs. one `StemWaveformRow`
per stem), matching how `expanded ? stems.map(...) : <CollapsedRifffRow/>` was already going to
work with the *existing* `pointerEvents:none`-background / 44px-interactive-header split from
the earlier pointer-events fix (that split's own height calculation — the outer background div's
`top:0; bottom:0` — already sizes itself from whatever's rendered below in normal flow, so it
correctly shrinks to one row's height when collapsed without any extra change here).

- [ ] **Step 4: Add the chevron toggle button**

Find the header's inner draggable div's children:

```tsx
          <PolarGlyph stems={rifff.stems} identityColor={color} size={30} />
          <div style={{ overflow: 'hidden' }}>
```

Add a chevron button before the glyph:

```tsx
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_EXPAND', groupId })
            }}
            title={expanded ? 'collapse' : 'expand'}
            style={{
              width: 16,
              height: 16,
              flexShrink: 0,
              borderRadius: 4,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)',
              fontSize: 9,
              padding: 0,
              cursor: 'pointer'
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <PolarGlyph stems={rifff.stems} identityColor={color} size={30} />
          <div style={{ overflow: 'hidden' }}>
```

`e.stopPropagation()` matches the mute-dot buttons elsewhere in this codebase's convention for a
button nested inside a `draggable` ancestor — without it, a click on the chevron could also be
interpreted as the start of a native drag gesture on the header.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors (pre-existing warnings in unrelated files are fine).

- [ ] **Step 6: Manual verification**

Start the dev app. Place a rifff — confirm it now renders **collapsed** by default (one summary
row with a combined waveform, not per-stem rows). Click the chevron — confirm it expands to
today's per-stem `StemWaveformRow` list, and the chevron flips to `▾`. Click again to collapse.
Confirm the collapsed block's mute dots toggle mute per stem, and dragging the collapsed block
from its waveform (not just its name header) moves the whole clip correctly (grab-offset
preserved, matching Task 2's fix).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/RifffBlockRow.tsx
git commit -m "Wire chevron toggle: collapsed CollapsedRifffRow vs expanded per-stem rows"
```

---

### Task 5: "Grab anywhere" on the expanded waveform body

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Read the current file in full**

- [ ] **Step 2: Read `volumeDragMode` and branch the waveform body's drag behavior**

Find:

```tsx
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const playedBarsKey = resolveOffsetKey(state, groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]
```

Add a binding right after:

```tsx
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const playedBarsKey = resolveOffsetKey(state, groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]
  const volumeDragMode = state.volumeDragMode
```

- [ ] **Step 3: Add a `handleWaveformDragStart` function**

Add this new function near the other handlers (e.g. right after `handleVolumeStart`):

```tsx
  // Default (volumeDragMode off): the waveform body is a native HTML5 drag
  // target, moving the clip — same linked/unlinked branching as everywhere
  // else in this app (whole rifff when linked, just this stem when
  // unlinked), just exposed on a wider surface than the label column alone.
  // When volumeDragMode is on, this never fires: the browser only initiates
  // a native drag from a mousedown that wasn't already preventDefault'd, and
  // handleVolumeStart (wired below) calls preventDefault via
  // startPointerDrag whenever volumeDragMode is on.
  function handleWaveformDragStart(e: React.DragEvent): void {
    const mouseBar = mouseBarFromDragEvent(e)
    if (unlinked) {
      e.dataTransfer.setData('text/rifff-stem-key', key)
      if (mouseBar !== null) setGrabOffsetBars(computeGrabOffsetBars(mouseBar, baseStartBar))
    } else {
      e.dataTransfer.setData('text/rifff-group-id', groupId)
      if (mouseBar !== null) {
        setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
      }
    }
  }
```

- [ ] **Step 4: Make the waveform container draggable, and gate the volume strip on `volumeDragMode`**

Find:

```tsx
        <div
          onDoubleClick={() => {
```

Change to add `draggable` and `onDragStart`:

```tsx
        <div
          draggable
          onDragStart={handleWaveformDragStart}
          onDoubleClick={() => {
```

Find the volume-plateau drag strip:

```tsx
          {/* Volume-plateau drag strip: invisible horizontal band spanning the
              flat top of the envelope between the two fade knees, positioned
              via the same fiEnd/foStart used by the fade-knee dots and the
              envelope path itself. Dragging it vertically adjusts volume. */}
          <div
            onMouseDown={handleVolumeStart}
            title="drag to adjust volume"
            style={{
              position: 'absolute',
              left: fiEnd,
              width: Math.max(0, foStart - fiEnd),
              top: plateauY - 4,
              height: 8,
              cursor: 'ns-resize',
              zIndex: 3
            }}
          />
```

Change to cover the *entire* waveform body (not just the narrow band around the plateau line)
while `volumeDragMode` is on, and do nothing (letting the native drag proceed instead) while
it's off:

```tsx
          {/* Volume drag surface: spans the whole waveform body while
              volumeDragMode is on (see the V-key toggle in App.tsx/TransportBar),
              repurposing the same open area that defaults to "drag to move
              the clip" (handleWaveformDragStart above). While off, this does
              nothing on mousedown — the event is left alone so the browser's
              native drag (from the container's own `draggable`) proceeds
              normally instead. Resize handles and fade-knee dots are
              unaffected by this either way — they're separate elements with
              their own onMouseDown, and their own stopPropagation (inside
              startPointerDrag) already wins over this whenever the mouse
              starts on one of them specifically. */}
          <div
            onMouseDown={(e) => {
              if (volumeDragMode) handleVolumeStart(e)
            }}
            title={volumeDragMode ? 'drag to adjust volume' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'grab',
              zIndex: volumeDragMode ? 3 : 1
            }}
          />
```

Note the `zIndex` drop from the old fixed `3` to `1` while off — resize handles (`zIndex: 3`)
and fade dots (`zIndex: 4`) must stay visually and interactively on top of this layer in both
modes; `zIndex: 3` while volumeDragMode is on matches what the old narrow strip already used
(no change in stacking there), `zIndex: 1` while off just keeps this div out of the way instead
of needlessly matching the resize handles' own layer when it's not doing anything.

No import changes are needed for this task — Task 2 already added `mouseBarFromDragEvent` to
this file's `dragGrabOffset` import, and `handleWaveformDragStart` above only uses names already
in scope (`key`, `groupId`, `unlinked`, `baseStartBar`, `rifff`, `computeGrabOffsetBars`,
`setGrabOffsetBars`, `mouseBarFromDragEvent`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no test in this codebase exercises component-level drag interaction,
so this step is really just confirming nothing else broke).

- [ ] **Step 7: Manual verification**

Start the dev app, expand a rifff. With `volumeDragMode` off (the default — no toggle button
exists yet, that's Task 6, so it's off for this whole step): drag the open part of a stem's
waveform (not a resize handle or fade dot) — confirm it moves the clip (whole rifff if linked,
just that stem if unlinked), grab-offset preserved. Confirm resize handles and fade-knee dots
still work exactly as before, unaffected. Confirm double-click-to-reset-volume still works
(dblclick and native drag don't conflict). To manually exercise the `volumeDragMode: true` path
before Task 6 adds a way to toggle it from the UI, temporarily flip `volumeDragMode: false` to
`true` in `store.ts`'s `initialState`, reload, confirm dragging the waveform body now adjusts
volume across its *entire* area (not just the old narrow band) instead of moving the clip, then
revert that temporary edit before committing.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Waveform body drags the clip by default; volumeDragMode repurposes it to volume"
```

---

### Task 6: `V` key toggle + `TransportBar` indicator

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`

- [ ] **Step 1: Read both files in full**

- [ ] **Step 2: Add the `V` keyboard handler in `App.tsx`'s `Frame` component**

Find the existing Space handler (the closest analog: a single-key global toggle, skipped in
inputs and while a picker/menu might want the key):

```tsx
  // Space toggles play/pause, the standard DAW convention. Skipped whenever the
  // beat-picker is open (it owns spacebar for tap-to-mark while it's up) or focus
  // is on a naturally space-activated control (typing a space, or triggering a
  // focused button/checkbox) — only intercepted when space wouldn't otherwise do
  // anything useful.
  useEffect(() => {
    const interactiveTags = new Set(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'])
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || pickerGroupId) return
      const target = e.target as HTMLElement | null
      if (target && interactiveTags.has(target.tagName)) return
      e.preventDefault()
      dispatch({ type: state.playing ? 'PAUSE' : 'PLAY' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pickerGroupId, state.playing, dispatch])
```

Add a new effect right after it:

```tsx
  // V toggles volumeDragMode — see StemWaveformRow.tsx's waveform-body drag
  // handling and TransportBar's indicator button. Skipped while focus is in a
  // text input, matching Delete/undo above (typing "v" in the tempo field
  // shouldn't also flip the drag mode).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() !== 'v') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])
```

- [ ] **Step 3: Add the indicator button to `TransportBar`**

Find:

```tsx
      <button
        onClick={() => dispatch({ type: 'CYCLE_SNAP' })}
        aria-label="Cycle snap grid"
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
```

Add a new button right after it, matching the same visual treatment but reflecting on/off state
the way the fade-drag/stretch toggles elsewhere in this codebase do (active state gets a
highlighted background/border):

```tsx
      <button
        onClick={() => dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })}
        aria-label="Toggle volume drag mode"
        title="V"
        style={{
          height: 22,
          borderRadius: 6,
          padding: '0 8px',
          fontSize: 10,
          background: state.volumeDragMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.volumeDragMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        volume drag: {state.volumeDragMode ? 'on' : 'off'}
      </button>
```

`--ra-stretch-on`/`--ra-stretch-on-bg` are the same CSS variables Inspector.tsx's "stretch on"
button already uses for its own active-state highlight — reused here rather than introducing a
new color pairing for what's conceptually the same kind of thing (a binary mode toggle).

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Start the dev app. Press `V` — confirm the TransportBar button flips to "volume drag: on" with
the highlighted style, and dragging an expanded stem's waveform body now adjusts volume (across
its whole area, not a narrow band) instead of moving the clip. Press `V` again (or click the
button) — confirm it flips back and dragging moves the clip again. Confirm typing "v" while
focused in the tempo input field does *not* toggle the mode. Confirm Cmd+Z after toggling does
*not* undo the toggle (it's transient, per Task 1's `TRANSIENT_ACTION_TYPES` addition) — undo
should skip straight past it to whatever the last real edit was.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TransportBar.tsx
git commit -m "Add V-key toggle and TransportBar indicator for volume drag mode"
```

---

### Final task: Whole-implementation review

- [ ] **Step 1: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all pass.

- [ ] **Step 2: Re-read the design spec**

Re-read `docs/superpowers/specs/2026-07-29-collapsed-expanded-rifff-design.md` end to end and
confirm each numbered section (1-4) is fully addressed by Tasks 1-6 above, including the
"Testing" section's notes.

- [ ] **Step 3: Manual smoke test of the whole feature together**

Start the dev app and, in one session: place a rifff (confirm it's collapsed by default),
toggle it expanded and back with the chevron, drag the collapsed block from its waveform body,
toggle its per-stem mute dots, expand it and confirm resize/fade/mute/double-click-reset all
still work, drag the expanded waveform body with volume-drag mode off (moves the clip) and on
(adjusts volume, `V` to toggle), and confirm the TransportBar indicator always matches the
actual mode. Save the project, reopen it, and confirm `volumeDragMode` reset to off while the
collapsed/expanded state of each rifff was preserved.

- [ ] **Step 4: Use superpowers:finishing-a-development-branch**

Follow that skill to verify tests, present completion options, and handle cleanup.
