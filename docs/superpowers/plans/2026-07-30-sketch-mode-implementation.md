# Sketch Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third arranger view mode — Sketch — for quickly sequencing rifffs into a single gapless row that plays one after another, using the existing PolarGlyph radial waveform with an orbiting-dot playhead.

**Architecture:** Sketch mode adds no new persisted data. It replaces the existing `compactMode: boolean` field with a three-way `mode: 'normal' | 'compact' | 'sketch'`, gates entry with a pure eligibility check (`isSketchEligible`) over the *existing* `rifff.startBar`/`playedBars`/`fadeIn`/`fadeOut`/`off`/`unlinked` fields, and reorders via one new reducer action (`SEQUENCE_RIFFFS`) that repacks a given rifff order into contiguous bar positions. Playback is unchanged — a gapless sequential arrangement already plays "one after another" under the existing scheduler.

**Tech Stack:** React 19, TypeScript, Vitest. No native-engine/C++ changes — this plan is renderer-only.

---

## Read first

Full spec: `docs/superpowers/specs/2026-07-30-sketch-mode-design.md`. Read it before starting Task 1 — it resolves every open design question referenced below (eligibility rule, playhead formula, interaction list, explicit out-of-scope list).

Current relevant code (read each in full before touching it):
- `src/renderer/src/state/store.ts` — `AppState`, `Action`, `reducer`
- `src/renderer/src/state/selectors.ts` — `placedRifffsInOrder`, `channelMuteLetters`, `pasteRifffAction`
- `src/renderer/src/state/serialize.ts`, `src/renderer/src/state/history.ts`
- `src/renderer/src/App.tsx` — `Timeline`, `Frame`
- `src/renderer/src/components/RifffBlockRow.tsx`, `CompactRifffBlock.tsx`, `TransportBar.tsx`, `Playhead.tsx`, `Shelf.tsx` (its `handleTileClick`), `PolarGlyph.tsx`

---

### Task 1: Replace `compactMode` with a three-way `mode` field

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.test.ts` (append near the other simple-toggle tests, e.g. near `'toggles stretch'`):

```ts
describe('SET_ARRANGER_MODE', () => {
  it('sets the mode field directly', () => {
    let state = reducer(initialState, { type: 'SET_ARRANGER_MODE', mode: 'compact' })
    expect(state.mode).toBe('compact')
    state = reducer(state, { type: 'SET_ARRANGER_MODE', mode: 'sketch' })
    expect(state.mode).toBe('sketch')
  })
})

describe('initialState', () => {
  it('defaults mode to sketch', () => {
    expect(initialState.mode).toBe('sketch')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `mode` doesn't exist on `AppState`, `SET_ARRANGER_MODE` isn't a valid action type.

- [ ] **Step 3: Replace the field and action in store.ts**

In `src/renderer/src/state/store.ts`, add the type above `AppState` and replace the `compactMode` field:

```ts
export type ArrangerMode = 'normal' | 'compact' | 'sketch'
```

Replace:
```ts
  /** Global arrangement-wide view mode: false (default) is today's per-rifff
   * collapsed/expanded rendering, true replaces every rifff's row with a
   * small fixed-size tile at its real timeline position (CompactRifffBlock).
   * Toggled by the Tab key, Ableton-style — see App.tsx's Frame component.
   * Not persisted (see serialize.ts). */
  compactMode: boolean
```
with:
```ts
  /** Global arrangement-wide view mode. 'normal' is today's per-rifff
   * collapsed/expanded rendering. 'compact' replaces every rifff's row with
   * a small fixed-size tile at its real timeline position
   * (CompactRifffBlock). 'sketch' replaces the whole Timeline with a single
   * gapless sequence strip (SketchStrip) — only reachable when
   * isSketchEligible(state) (see selectors.ts). Cycled by the Tab key,
   * Ableton-style, via selectors.ts's nextArrangerMode — see App.tsx's
   * Frame component. Not persisted (see serialize.ts). */
  mode: ArrangerMode
```

In `initialState`, replace `compactMode: false,` with `mode: 'sketch',`.

In the `Action` union, replace:
```ts
  | { type: 'TOGGLE_COMPACT_MODE' }
```
with:
```ts
  | { type: 'SET_ARRANGER_MODE'; mode: ArrangerMode }
```

In the reducer's `switch`, replace:
```ts
    case 'TOGGLE_COMPACT_MODE':
      return { ...state, compactMode: !state.compactMode }
```
with:
```ts
    case 'SET_ARRANGER_MODE':
      return { ...state, mode: action.mode }
```

- [ ] **Step 4: Update serialize.ts**

In `src/renderer/src/state/serialize.ts`, replace both occurrences of `compactMode` with `mode`:

```ts
export type PersistedProject = Omit<AppState, 'volumeDragMode' | 'mode' | 'inspectorCollapsed'>

export function serializeProject(state: AppState): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { volumeDragMode, mode, inspectorCollapsed, ...rest } = state
  return JSON.stringify(rest, null, 2)
}
```

Leave `deserializeProject` as-is for now — since `mode` isn't part of `PersistedProject`, `{ ...initialState, ...data }` will always resolve to `initialState.mode` ('sketch') regardless of what's actually in the loaded arrangement. The spec requires falling back to `'normal'` when a loaded arrangement isn't sketch-eligible; that fix needs `isSketchEligible`, which doesn't exist until Task 3 — **Task 3 adds one more step to `serialize.ts` for this**, so don't consider this task done-done until that lands too.

- [ ] **Step 5: Update history.ts**

In `src/renderer/src/state/history.ts`, in `TRANSIENT_ACTION_TYPES`, replace `'TOGGLE_COMPACT_MODE'` with `'SET_ARRANGER_MODE'`:

```ts
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>([
  'TOGGLE_VOLUME_DRAG_MODE',
  'SET_ARRANGER_MODE',
  'TOGGLE_INSPECTOR_COLLAPSED'
])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: Errors in every file still referencing `compactMode`/`TOGGLE_COMPACT_MODE` (`RifffBlockRow.tsx`, `TransportBar.tsx`, `App.tsx`, `selectors.ts`'s `channelMuteLetters`, and their tests) — these are fixed in later tasks. Confirm the errors are *only* in those known files, nothing else.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/serialize.ts src/renderer/src/state/history.ts src/renderer/src/state/store.test.ts
git commit -m "Replace compactMode with a three-way arranger mode field"
```

---

### Task 2: Add `SEQUENCE_RIFFFS` action

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.test.ts`:

```ts
describe('SEQUENCE_RIFFFS', () => {
  it('repacks rifffs into contiguous bar positions in the given order, starting at 0', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: makeRifff({ groupId: 'r2', barLength: 4 })
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: makeRifff({ groupId: 'r3', barLength: 2 })
    })
    state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r2', 'r3', 'r1'] })
    expect(state.rifffs.r2.startBar).toBe(0)
    expect(state.rifffs.r3.startBar).toBe(4) // right after r2's 4 bars
    expect(state.rifffs.r1.startBar).toBe(6) // right after r3's 2 bars
  })

  it('replaces trackOrder with the new sequence order', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
    state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r2', 'r1'] })
    expect(state.trackOrder).toEqual(['r2', 'r1'])
  })
})
```

Check whether this file already has a `makeRifff` helper accepting overrides (used elsewhere in this file/`selectors.test.ts`) — if it only has the bare `rifff` fixture without a factory, add one near the top of the `describe('reducer', ...)` block:

```ts
function makeRifff(overrides: Partial<Rifff> = {}): Rifff {
  return {
    groupId: 'r1',
    name: 'test',
    bpm: 120,
    barLength: 8,
    folderPath: '/x',
    stems: [
      { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 4, barLength: 8 }
    ],
    ...overrides
  }
}
```

(If a differently-shaped helper already exists under this exact name, reuse it instead of adding a duplicate — check the top of the file first.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `SEQUENCE_RIFFFS` isn't a valid action type.

- [ ] **Step 3: Add the action and reducer case**

In `src/renderer/src/state/store.ts`, add to the `Action` union (near `PLACE_ON_TIMELINE`):

```ts
  | { type: 'SEQUENCE_RIFFFS'; groupIds: string[] }
```

Add the reducer case (near `PLACE_ON_TIMELINE`'s case, since it's the closest relative):

```ts
    // Repacks every rifff in groupIds into contiguous bar positions, in that
    // order, starting at bar 0 — the only way rifffs get reordered/inserted
    // in sketch mode (dragging to reorder, or dropping a new rifff in at
    // some position). groupIds must be the COMPLETE set of currently-placed
    // rifffs in their new order: sketch mode only ever calls this with
    // exactly that (isSketchEligible guarantees there's nothing else placed
    // to leave out). One dispatch, one undo entry, regardless of how many
    // rifffs shifted position. trackOrder is replaced outright to match —
    // sketch mode's left-to-right sequence and Normal/Compact mode's
    // top-to-bottom row order stay in sync with each other.
    case 'SEQUENCE_RIFFFS': {
      const rifffs = { ...state.rifffs }
      let cursor = 0
      for (const groupId of action.groupIds) {
        const rifff = rifffs[groupId]
        rifffs[groupId] = { ...rifff, startBar: cursor }
        cursor += rifff.barLength
      }
      return { ...state, rifffs, trackOrder: action.groupIds }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add SEQUENCE_RIFFFS action for sketch-mode reordering"
```

---

### Task 3: Add `isSketchEligible` selector

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/selectors.test.ts` (the file already imports `reducer`/`initialState` from `./store` and has a `rifff`/`unplaced` fixture pattern — reuse that convention):

```ts
describe('isSketchEligible', () => {
  it('is true for an empty timeline', () => {
    expect(isSketchEligible(initialState)).toBe(true)
  })

  it('is true for rifffs stacked contiguously from bar 0, in bar order', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 8, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    expect(isSketchEligible(state)).toBe(true)
  })

  it('is false if there is a gap between rifffs', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 8, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 8 }) // gap: r1 ends at 4
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if the first rifff does not start at bar 0', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 2 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if two rifffs overlap (e.g. both start at 0, a different track/row)', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if a rifff is unlinked', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if a rifff has a fade', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if a rifff has a resize override (playedBars)', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 2 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if a rifff has a nonzero offset', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 1 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('ignores mute and volume — those do not affect positioning', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.3 })
    expect(isSketchEligible(state)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: FAIL — `isSketchEligible` is not exported from `./selectors`.

- [ ] **Step 3: Implement `isSketchEligible`**

In `src/renderer/src/state/selectors.ts`, add (near `placedRifffsInOrder`, since it depends on it):

```ts
/**
 * True iff the current arrangement is "plain" enough for sketch mode: every
 * placed rifff is linked, unfaded, at its natural (un-resized) bar length,
 * with zero offset, AND the whole set — sorted by startBar, not by
 * placedRifffsInOrder's row-render order, which is a DIFFERENT ordering —
 * is perfectly contiguous starting at bar 0 with no gaps or overlaps. An
 * empty timeline is trivially eligible (starting a fresh sketch is the
 * common case, not an edge case). Mute and volume are deliberately not
 * checked — they don't affect positioning/sequencing accuracy, only mix.
 *
 * Note there's no separate "track" concept in this data model beyond
 * trackOrder's render order — every placed rifff gets its own row
 * regardless of whether its bars overlap another's. Two rifffs both
 * starting at bar 0 (simultaneous playback, valid in Normal mode) correctly
 * fails this check, since sketch mode has no way to represent "two things
 * at once."
 */
export function isSketchEligible(state: AppState): boolean {
  const placed = placedRifffsInOrder(state)
  for (const rifff of placed) {
    if (state.unlinked[rifff.groupId]) return false
    if (state.fadeIn[rifff.groupId]) return false
    if (state.fadeOut[rifff.groupId]) return false
    if (state.playedBars[rifff.groupId] !== undefined) return false
    if ((state.off[rifff.groupId] ?? 0) !== 0) return false
  }
  const sorted = [...placed].sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))
  let expectedStart = 0
  for (const rifff of sorted) {
    if (rifff.startBar !== expectedStart) return false
    expectedStart += rifff.barLength
  }
  return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS

- [ ] **Step 5: Fall back to Normal on load when the loaded arrangement isn't sketch-eligible**

**Files (added to this task):**
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/renderer/src/state/serialize.test.ts` (already exists — has a `rifff` fixture with `startBar: 4` and a `describe('project serialization', ...)` block; add a new `describe` block below it, don't touch the existing tests)

Per the spec: "Loading a project ... always starts in `'sketch'`. If the loaded arrangement isn't sketch-eligible ..., the app falls back to `'normal'` immediately." Since `mode` is excluded from `PersistedProject`, `deserializeProject`'s `{ ...initialState, ...data }` always resolves to `initialState.mode` ('sketch') today, regardless of what's actually in `data` — this step fixes that.

Write the failing test first. Add this new `describe` block to `src/renderer/src/state/serialize.test.ts`, after the existing `describe('project serialization', ...)` block, reusing that file's own `rifff` fixture (note it has `startBar: 4` baked in — override to `undefined` before placing, same convention `selectors.test.ts`'s `placedRifffsInOrder` tests already use):

```ts
describe('deserializeProject mode fallback', () => {
  it('defaults to sketch mode for a plain (sketch-eligible) loaded arrangement', () => {
    const persisted = JSON.parse(serializeProject(initialState))
    expect(deserializeProject(persisted).mode).toBe('sketch')
  })

  it('falls back to normal mode when the loaded arrangement is not sketch-eligible', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1 }) // disqualifies sketch
    const persisted = JSON.parse(serializeProject(state))
    expect(deserializeProject(persisted).mode).toBe('normal')
  })
})
```

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: FAIL — `deserializeProject` still always returns `mode: 'sketch'`.

Fix `src/renderer/src/state/serialize.ts` — add the import and update `deserializeProject`:

```ts
import { isSketchEligible } from './selectors'
```

```ts
export function deserializeProject(data: PersistedProject): AppState {
  const state = { ...initialState, ...data }
  return isSketchEligible(state) ? state : { ...state, mode: 'normal' }
}
```

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts src/renderer/src/state/serialize.ts src/renderer/src/state/serialize.test.ts
git commit -m "Add isSketchEligible selector; fall back to normal mode on an ineligible load"
```

---

### Task 4: Add `nextArrangerMode` selector helper

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

**Context:** `store.ts` cannot import `isSketchEligible` from `selectors.ts` (selectors.ts already imports types from store.ts — a reverse import would be circular). So the mode-cycling reducer action stays a simple, explicit `SET_ARRANGER_MODE` (Task 1), and the *decision* of what "next" means — including skipping over `'sketch'` when the arrangement isn't eligible — lives here as a plain function the UI calls before dispatching.

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/selectors.test.ts`:

```ts
describe('nextArrangerMode', () => {
  it('cycles normal -> compact -> sketch -> normal when sketch-eligible', () => {
    const state = { ...initialState, mode: 'normal' as const } // empty timeline: trivially eligible
    expect(nextArrangerMode(state)).toBe('compact')
    expect(nextArrangerMode({ ...state, mode: 'compact' })).toBe('sketch')
    expect(nextArrangerMode({ ...state, mode: 'sketch' })).toBe('normal')
  })

  it('skips sketch when the arrangement is not eligible', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1 }) // disqualifies sketch
    expect(nextArrangerMode({ ...state, mode: 'normal' })).toBe('compact')
    expect(nextArrangerMode({ ...state, mode: 'compact' })).toBe('normal') // sketch skipped
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: FAIL — `nextArrangerMode` is not exported from `./selectors`.

- [ ] **Step 3: Implement `nextArrangerMode`**

In `src/renderer/src/state/selectors.ts`, add (needs `ArrangerMode` — import it alongside the other store.ts imports at the top of the file):

```ts
import { SNAP_DIVS, type Action, type AppState, type ArrangerMode } from './store'
```

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Add nextArrangerMode selector helper"
```

---

### Task 5: Add `groupIdAtPosition` selector

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/selectors.test.ts`:

```ts
describe('groupIdAtPosition', () => {
  it('finds which placed rifff contains a given position', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    expect(groupIdAtPosition(state, 0)).toBe('r1')
    expect(groupIdAtPosition(state, 3.9)).toBe('r1')
    expect(groupIdAtPosition(state, 4)).toBe('r2')
    expect(groupIdAtPosition(state, 7.5)).toBe('r2')
  })

  it('returns null when the position is past every placed rifff', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    expect(groupIdAtPosition(state, 4)).toBeNull()
    expect(groupIdAtPosition(state, 100)).toBeNull()
  })

  it('returns null on an empty timeline', () => {
    expect(groupIdAtPosition(initialState, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: FAIL — `groupIdAtPosition` is not exported from `./selectors`.

- [ ] **Step 3: Implement `groupIdAtPosition`**

In `src/renderer/src/state/selectors.ts`, add:

```ts
/** Which placed rifff's [startBar, startBar + barLength) range contains
 * `pos` — used by the sketch-mode Inspector auto-follow effect (App.tsx) to
 * find "whichever rifff is currently playing." Not sketch-mode-specific
 * itself; the caller is. */
export function groupIdAtPosition(state: AppState, pos: number): string | null {
  for (const rifff of placedRifffsInOrder(state)) {
    const start = rifff.startBar ?? 0
    if (pos >= start && pos < start + rifff.barLength) return rifff.groupId
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Add groupIdAtPosition selector"
```

---

### Task 6: Fix `channelMuteLetters` for the new mode field

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

**Context:** `channelMuteLetters` currently reads `state.compactMode`, which no longer exists (Task 1 removed it) — this task fixes the resulting typecheck error. Sketch mode also has no mixing controls (per the spec's "no mute inside sketch mode" — Task 9+ won't wire Shift+letter into SketchStrip at all), so both non-normal modes should contribute zero channels, not just compact.

- [ ] **Step 1: Update the existing test fixture**

In `src/renderer/src/state/selectors.test.ts`, find the `channelMuteLetters` test `'returns no channels at all in compact mode, which has no mixing controls'` and change:

```ts
    state = { ...state, compactMode: true }
```
to:
```ts
    state = { ...state, mode: 'compact' }
```

Add a second case right after it in the same `describe` block:

```ts
  it('returns no channels at all in sketch mode either', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = { ...state, mode: 'sketch' }
    expect(channelMuteLetters(state)).toEqual({})
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: FAIL — the updated test still calls the old `state.compactMode`-checking implementation, which will actually currently just silently pass through the eligibility of `mode: 'compact'` unnoticed (since `compactMode` field simply doesn't exist post-Task-1, `state.compactMode` is `undefined`, which is falsy, so the old code as-is would incorrectly treat `mode: 'compact'` as "not compact" and return real channels). Confirm the new sketch-mode test fails, and manually confirm the compact-mode test's assertion would also be wrong before the fix (add a temporary `console.log` if needed, then remove it) — the point is Step 3 must actually change behavior, not just satisfy the typechecker.

- [ ] **Step 3: Fix the implementation**

In `src/renderer/src/state/selectors.ts`, in `channelMuteLetters`, replace:

```ts
  if (state.compactMode) return out
```
with:
```ts
  if (state.mode !== 'normal') return out
```

Update the function's doc comment too — replace the sentence `Compact mode has no mixing affordances at all (CompactRifffBlock is a pure positional overview), so it contributes no channels here either.` with:

```
 * Neither Compact nor Sketch mode has mixing affordances (CompactRifffBlock
 * is a pure positional overview; sketch tiles deliberately expose no
 * mute/volume/fade at all — see the sketch mode spec), so only 'normal'
 * contributes channels here.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: Remaining errors only in `RifffBlockRow.tsx`, `TransportBar.tsx`, `App.tsx` (fixed in Tasks 7-8).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Fix channelMuteLetters for the new three-way mode field"
```

---

### Task 7: Wire the new mode field into RifffBlockRow and TransportBar

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`

- [ ] **Step 1: Update RifffBlockRow.tsx**

In `src/renderer/src/components/RifffBlockRow.tsx`, replace:

```ts
  if (state.compactMode) {
    return <CompactRifffBlock groupId={groupId} onOpenContextMenu={onOpenContextMenu} />
  }
```
with:
```ts
  if (state.mode === 'compact') {
    return <CompactRifffBlock groupId={groupId} onOpenContextMenu={onOpenContextMenu} />
  }
```

(Sketch mode never reaches `RifffBlockRow` at all — App.tsx's `Timeline` swaps in `SketchStrip` for the entire area instead, added in Task 10.)

- [ ] **Step 2: Update TransportBar.tsx**

In `src/renderer/src/components/TransportBar.tsx`, add the import (alongside the existing selectors import — there may not be one yet; add it):

```ts
import { nextArrangerMode, isSketchEligible } from '../state/selectors'
```

Replace the compact-mode button:

```tsx
      <button
        onClick={() => dispatch({ type: 'TOGGLE_COMPACT_MODE' })}
        aria-label="Toggle compact mode"
        title={state.compactMode ? 'compact mode: on (Tab)' : 'compact mode: off (Tab)'}
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.compactMode ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.compactMode ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.compactMode ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        compact
      </button>
```
with:
```tsx
      <button
        onClick={() =>
          dispatch({ type: 'SET_ARRANGER_MODE', mode: nextArrangerMode(state) })
        }
        aria-label="Cycle arranger mode"
        title={
          state.mode === 'normal' && !isSketchEligible(state)
            ? 'mode: normal (Tab) — sketch unavailable: clear fades, resizes, offsets, unlinked stems, and gaps first'
            : `mode: ${state.mode} (Tab)`
        }
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: state.mode !== 'normal' ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${state.mode !== 'normal' ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.mode !== 'normal' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        {state.mode}
      </button>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: Remaining errors only in `App.tsx` (fixed in Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RifffBlockRow.tsx src/renderer/src/components/TransportBar.tsx
git commit -m "Wire the three-way mode field into RifffBlockRow and TransportBar"
```

---

### Task 8: Update App.tsx's Tab handler

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Update the import and Tab handler**

In `src/renderer/src/App.tsx`, update the `selectors` import to add `nextArrangerMode`:

```ts
import {
  loopLengthBars,
  pasteRifffAction,
  placedRifffsInOrder,
  channelMuteLetters,
  nextArrangerMode
} from './state/selectors'
```

Replace the Tab-key effect:

```ts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'TOGGLE_COMPACT_MODE' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])
```
with:
```ts
  // Tab cycles the arranger mode, Ableton-style: normal -> compact -> sketch
  // -> normal, skipping sketch when isSketchEligible(state) is false (see
  // nextArrangerMode). Skipped while focus is in a text input — Tab's native
  // move-to-next-field behavior is more useful there than the arrangement's
  // own view-mode cycle (matches Delete/V/undo's same input-skip pattern).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'SET_ARRANGER_MODE', mode: nextArrangerMode(state) })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state, dispatch])
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: Clean — this was the last file referencing the old field/action.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors (pre-existing prettier-only warnings in unrelated files are fine).

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: All passing. (This session's own established pattern: native-engine spawn/socket tests occasionally flake on the first run — a single re-run always resolves it, not a regression.)

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`, or confirm it's already running), open the app, and confirm:
- A fresh/empty project starts in sketch mode (TransportBar's mode button reads "sketch") — it'll show the *old* per-rifff Timeline still, since `SketchStrip` doesn't exist until Task 9-10; that's expected for this task, just confirm the button/field itself is right.
- Tab cycles normal -> compact -> normal (sketch is skipped, or shows nothing new yet — same reason).
- Place a rifff, add a fade to it (Inspector), confirm Tab now cycles normal -> compact -> normal only (sketch stays skipped, tooltip explains why on hover).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Cycle Tab through the three-way arranger mode, skipping ineligible sketch"
```

---

### Task 9: Build the SketchStrip component (tiles, playhead, preview — no drag yet)

**Files:**
- Create: `src/renderer/src/components/SketchStrip.tsx`

**Context:** This task builds the read-only visual: uniform-size `PolarGlyph` tiles in sequence order, the orbiting-dot playhead (derived directly from `usePos()`, same pattern as the existing `Playhead.tsx` — no separate animation loop needed, since `usePos()` already re-renders at ~30Hz while playing), a subtle glow on the currently-playing tile, and click-to-select-and-preview (mirroring `Shelf.tsx`'s `handleTileClick` exactly). Drag-to-reorder, drag-in, and remove are Tasks 11-13.

- [ ] **Step 1: Write the component**

Create `src/renderer/src/components/SketchStrip.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { stemKey } from '@shared/types'
import type { Rifff } from '@shared/types'

export const TILE_SIZE = 64
export const TILE_GAP = 10

/** Sketch mode's own view — a single left-to-right sequence of every placed
 * rifff, packed edge to edge (see isSketchEligible: this is only ever
 * mounted when that's already true, so `startBar` is already contiguous
 * from 0 — this component just reads it, it doesn't enforce it). Each tile
 * is a uniform-size PolarGlyph (the same radial-waveform circle used in the
 * shelf and LORE library browser); duration is communicated only through
 * the orbiting playhead dot's lap speed, not tile size, so the strip stays
 * visually even regardless of how long each rifff actually is. */
export function SketchStrip(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const pos = usePos()

  // Sorted by startBar (not placedRifffsInOrder's own trackOrder-based row
  // order) — SEQUENCE_RIFFFS keeps the two in sync, but startBar is the
  // actual source of truth for playback order, so render from that
  // directly rather than trusting they never drift apart.
  const sequence = [...placedRifffsInOrder(state)].sort(
    (a, b) => (a.startBar ?? 0) - (b.startBar ?? 0)
  )

  const [previewingGroupId, setPreviewingGroupId] = useState<string | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewGenerationRef = useRef(0)
  const previewTokenRef = useRef(0)

  const stopTilePreview = useCallback(() => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  useEffect(() => {
    return () => stopTilePreview()
  }, [stopTilePreview])

  function handleTileClick(rifff: Rifff): void {
    dispatch({ type: 'SELECT', groupId: rifff.groupId })
    previewGenerationRef.current += 1
    const generation = previewGenerationRef.current
    stopTilePreview()
    if (previewingGroupId === rifff.groupId) {
      setPreviewingGroupId(null)
      return
    }
    setPreviewingGroupId(rifff.groupId)
    if (playing) dispatch({ type: 'PAUSE' })
    void startPreviewLoop(
      getAudioContext(),
      rifff.stems.map((s) => ({
        path: s.path,
        gain: state.vol[stemKey(rifff.groupId, s.slot)] ?? 1
      })),
      () => previewGenerationRef.current !== generation
    ).then((sources) => {
      if (previewGenerationRef.current !== generation) {
        stopPreviewSources(sources)
        return
      }
      previewSourcesRef.current.push(...sources)
      if (sources.length > 0) previewTokenRef.current = registerActivePreview(stopTilePreview)
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: TILE_GAP,
        padding: 24,
        flexWrap: 'wrap'
      }}
    >
      {sequence.map((rifff) => {
        const start = rifff.startBar ?? 0
        const isCurrent = playing && pos >= start && pos < start + rifff.barLength
        // 0..1 progress through this rifff's own play window — only
        // meaningful while isCurrent, but harmless to compute either way.
        const fraction = (pos - start) / rifff.barLength
        const angleRad = fraction * 2 * Math.PI - Math.PI / 2 // start at 12 o'clock
        const orbitRadius = 46 // just outside PolarGlyph's own outermost ring
        const dotX = 50 + orbitRadius * Math.cos(angleRad)
        const dotY = 50 + orbitRadius * Math.sin(angleRad)

        return (
          <div
            key={rifff.groupId}
            onClick={() => handleTileClick(rifff)}
            title={rifff.name}
            style={{
              position: 'relative',
              width: TILE_SIZE,
              height: TILE_SIZE,
              cursor: 'pointer',
              // Very subtle — intentionally minimal, first thing to cut if it
              // reads as too much once it's actually running.
              boxShadow: isCurrent ? '0 0 10px 1px color-mix(in srgb, var(--ra-text) 35%, transparent)' : 'none',
              opacity: state.sel === rifff.groupId || previewingGroupId === rifff.groupId ? 1 : 0.85
            }}
          >
            <PolarGlyph
              stems={rifff.stems}
              identityColor={typeColorVar(rifff.stems[0]?.type ?? 'fx')}
              size={TILE_SIZE}
            />
            {isCurrent && (
              <svg
                width={TILE_SIZE}
                height={TILE_SIZE}
                viewBox="0 0 100 100"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <circle cx={dotX} cy={dotY} r={2.5} fill="var(--ra-playhead)" />
              </svg>
            )}
          </div>
        )
      })}
      {sequence.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', padding: '8px 0' }}>
          drag rifffs in from the shelf or LORE library to start a sketch
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: Clean.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SketchStrip.tsx
git commit -m "Add SketchStrip: read-only sketch-mode tile view with orbiting playhead"
```

---

### Task 10: Wire SketchStrip into App.tsx's Timeline area

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import and branch on mode**

In `src/renderer/src/App.tsx`, add the import:

```ts
import { SketchStrip } from './components/SketchStrip'
```

In the `Timeline` component, wrap the existing return in a mode check. Replace:

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
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} />
      {placedRifffsInOrder(state).map((r) => (
        <RifffBlockRow key={r.groupId} groupId={r.groupId} onOpenContextMenu={onOpenClipMenu} />
      ))}
      {Array.from({ length: GHOST_ROW_COUNT }, (_, i) => (
        <div
          key={`ghost-${i}`}
          style={{
            height: GHOST_ROW_HEIGHT,
            borderBottom: '1px dashed var(--ra-border)'
          }}
        />
      ))}
      <Playhead />
      {dropBar !== null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: dropBar * PPB,
            width: 2,
            background: 'var(--ra-play-on)',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}
    </div>
  )
}
```
with:
```tsx
  if (state.mode === 'sketch') {
    return <SketchStrip />
  }

  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} />
      {placedRifffsInOrder(state).map((r) => (
        <RifffBlockRow key={r.groupId} groupId={r.groupId} onOpenContextMenu={onOpenClipMenu} />
      ))}
      {Array.from({ length: GHOST_ROW_COUNT }, (_, i) => (
        <div
          key={`ghost-${i}`}
          style={{
            height: GHOST_ROW_HEIGHT,
            borderBottom: '1px dashed var(--ra-border)'
          }}
        />
      ))}
      <Playhead />
      {dropBar !== null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: dropBar * PPB,
            width: 2,
            background: 'var(--ra-play-on)',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

- [ ] **Step 3: Manual verification**

Start the dev server, open the app on a fresh project (starts in sketch mode) — confirm the empty-state message shows. Drag a rifff from the shelf onto the sketch area (drop still goes to the old `handleDrop` path today, since sketch-specific drop handling is Task 12 — for now just confirm placing it via any other path, e.g. temporarily switch to normal mode with Tab, drop it there, switch back to sketch with Tab) and confirm its tile renders. Press play and confirm the orbiting dot appears on the currently-playing tile and the subtle glow shows.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Render SketchStrip for the Timeline area while in sketch mode"
```

---

### Task 11: Drag-to-reorder within SketchStrip

**Files:**
- Modify: `src/renderer/src/components/SketchStrip.tsx`

**Context:** Tiles become HTML5 drag sources (reusing the existing `'text/rifff-group-id'` payload type, same as `RifffBlockRow`/`CollapsedRifffRow`'s own reposition drag). The strip container computes an insertion INDEX from the drop `clientX` (nearest gap between tile midpoints), not a bar position — tiles are uniform size, so this is simple arithmetic, not `dragGrabOffset.ts`'s bar-position math (which assumes real timeline geometry that doesn't apply here).

- [ ] **Step 1: Add drag state, drag source, and insertion-index math**

In `src/renderer/src/components/SketchStrip.tsx`, add a `dropIndex` state and the index-computation helper near the top of the component body:

```tsx
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Nearest gap between tiles, by clientX — tiles are uniform width + a
  // fixed gap, so this is direct arithmetic against the container's own
  // left edge rather than needing per-tile getBoundingClientRect calls.
  function insertionIndexForClientX(clientX: number): number {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return sequence.length
    const relativeX = clientX - rect.left
    const slot = TILE_SIZE + TILE_GAP
    return Math.max(0, Math.min(sequence.length, Math.round(relativeX / slot)))
  }
```

- [ ] **Step 2: Wire the container's onDragOver/onDrop/onDragLeave**

Replace the outer `<div style={{ display: 'flex', ...}}>` opening tag's props (keep the style, just add handlers and the ref):

```tsx
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault()
        setDropIndex(insertionIndexForClientX(e.clientX))
      }}
      onDragLeave={() => setDropIndex(null)}
      onDrop={(e) => {
        e.preventDefault()
        const index = insertionIndexForClientX(e.clientX)
        setDropIndex(null)
        const draggedGroupId = e.dataTransfer.getData('text/rifff-group-id')
        if (!draggedGroupId || !sequence.some((r) => r.groupId === draggedGroupId)) return
        const withoutDragged = sequence.map((r) => r.groupId).filter((id) => id !== draggedGroupId)
        // index was computed against the FULL sequence (including the
        // dragged tile's own old slot) — if the drop lands after where it
        // used to be, removing it first shifts every later index down by
        // one, so the clamped insertion point needs the same adjustment.
        const oldIndex = sequence.findIndex((r) => r.groupId === draggedGroupId)
        const adjustedIndex = index > oldIndex ? index - 1 : index
        withoutDragged.splice(adjustedIndex, 0, draggedGroupId)
        dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: withoutDragged })
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: TILE_GAP,
        padding: 24,
        flexWrap: 'wrap'
      }}
    >
```

- [ ] **Step 3: Make each tile draggable and add the insertion-line indicator**

The indicator is a flex sibling positioned via the CSS `order` property, not an absolutely-positioned overlay — tiles wrap onto multiple lines (`flexWrap`), and a single absolute left/top pair can't represent "the gap before tile N" once wrapping is involved, but `order` naturally interleaves regardless of wrapping. `order` must be an integer (CSS rejects fractional values), so tiles get `order: index * 10` (0, 10, 20, ...) and the indicator sits at `order: dropIndex * 10 - 5` — always an integer, always strictly between two tiles' own order values (or before the first / after the last).

Change `sequence.map((rifff) => {` to `sequence.map((rifff, index) => {`, and update the tile's outer `<div>`:

```tsx
          <div
            key={rifff.groupId}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)}
            onClick={() => handleTileClick(rifff)}
            title={rifff.name}
            style={{
              order: index * 10,
              position: 'relative',
              width: TILE_SIZE,
              height: TILE_SIZE,
              cursor: 'pointer',
              boxShadow: isCurrent ? '0 0 10px 1px color-mix(in srgb, var(--ra-text) 35%, transparent)' : 'none',
              opacity: state.sel === rifff.groupId || previewingGroupId === rifff.groupId ? 1 : 0.85
            }}
          >
```

(Only the added `order: index * 10` line is new — the rest of that style object is unchanged from Task 9.)

After the `sequence.map(...)` closing, but still inside the container `<div>` (as a sibling to the empty-state message), add the insertion-line indicator:

```tsx
      {dropIndex !== null && (
        <div
          style={{
            order: dropIndex * 10 - 5,
            width: 2,
            height: TILE_SIZE,
            background: 'var(--ra-play-on)',
            pointerEvents: 'none'
          }}
        />
      )}
```

- [ ] **Step 4: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

- [ ] **Step 5: Manual verification**

With 3+ rifffs in the sketch strip, drag one to a different position (before the first, between two others, after the last) and confirm: the insertion-line indicator tracks the cursor, the tile lands in the new position on drop, and playback order (orbiting dot progression) reflects the new order.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SketchStrip.tsx
git commit -m "Add drag-to-reorder within SketchStrip"
```

---

### Task 12: Drag-in a new rifff from the shelf or LORE library

**Files:**
- Modify: `src/renderer/src/components/SketchStrip.tsx`

**Context:** `Shelf.tsx`'s tiles already set `'text/rifff-shelf-source-id'` on drag start (see its existing `onDragStart`), and `LoreLibraryBrowser.tsx` imports via a button click, not drag — a LORE-imported riff lands in the shelf first (unplaced), same as any drag-and-drop import, so "drag in from the LORE library" in practice means "drag its now-imported shelf tile into the strip," already covered by the shelf-source-id path. No separate LORE-specific handling is needed here.

- [ ] **Step 1: Extend the drop handler**

In `src/renderer/src/components/SketchStrip.tsx`'s container `onDrop`, add a branch above the existing `draggedGroupId` handling (which only covers reordering an already-placed tile) for a shelf-sourced drag:

```tsx
      onDrop={(e) => {
        e.preventDefault()
        const index = insertionIndexForClientX(e.clientX)
        setDropIndex(null)

        const shelfSourceId = e.dataTransfer.getData('text/rifff-shelf-source-id')
        if (shelfSourceId) {
          const source = state.rifffs[shelfSourceId]
          if (!source) return
          const groupIds = sequence.map((r) => r.groupId)
          if (source.startBar === undefined) {
            // Not yet placed anywhere — place it (startBar here is
            // immediately overwritten by the SEQUENCE_RIFFFS dispatch right
            // below; PLACE_ON_TIMELINE just needs a value, 0 is fine).
            dispatch({ type: 'PLACE_ON_TIMELINE', groupId: shelfSourceId, startBar: 0 })
            groupIds.splice(index, 0, shelfSourceId)
            dispatch({ type: 'SEQUENCE_RIFFFS', groupIds })
          } else {
            // Already placed elsewhere (e.g. dragged from the shelf a
            // second time) — an independent copy, same convention as the
            // normal Timeline's own shelf-drop handling.
            const action = pasteRifffAction(state, shelfSourceId, 0)
            if (!action || action.type !== 'PASTE_RIFFF') return
            dispatch(action)
            groupIds.splice(index, 0, action.rifff.groupId)
            dispatch({ type: 'SEQUENCE_RIFFFS', groupIds })
          }
          return
        }

        const draggedGroupId = e.dataTransfer.getData('text/rifff-group-id')
        if (!draggedGroupId || !sequence.some((r) => r.groupId === draggedGroupId)) return
        const withoutDragged = sequence.map((r) => r.groupId).filter((id) => id !== draggedGroupId)
        const oldIndex = sequence.findIndex((r) => r.groupId === draggedGroupId)
        const adjustedIndex = index > oldIndex ? index - 1 : index
        withoutDragged.splice(adjustedIndex, 0, draggedGroupId)
        dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: withoutDragged })
      }}
```

Add the import for `pasteRifffAction`:

```ts
import { placedRifffsInOrder, pasteRifffAction } from '../state/selectors'
```

- [ ] **Step 2: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

- [ ] **Step 3: Manual verification**

Drag a not-yet-placed shelf tile into the middle of an existing sketch sequence — confirm it lands at the drop position (not just appended), and the rifffs after it shift right (later startBar). Repeat dragging an *already-placed* shelf tile in — confirm it creates an independent duplicate rather than moving the original out of wherever it already was.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SketchStrip.tsx
git commit -m "Support dragging a new rifff into SketchStrip at a drop position"
```

---

### Task 13: Remove a tile (Delete/Backspace, right-click)

**Files:**
- Modify: `src/renderer/src/components/SketchStrip.tsx`

- [ ] **Step 1: Add the remove handler and wire it to right-click**

In `src/renderer/src/components/SketchStrip.tsx`, add a function near `handleTileClick`:

```tsx
  function removeTile(groupId: string): void {
    const remaining = sequence.map((r) => r.groupId).filter((id) => id !== groupId)
    dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId })
    dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: remaining })
  }
```

Add `onContextMenu` to each tile's outer `<div>`:

```tsx
            onContextMenu={(e) => {
              e.preventDefault()
              removeTile(rifff.groupId)
            }}
```

- [ ] **Step 2: Add Delete/Backspace handling for the selected tile**

Add an effect in `SketchStrip`, mirroring App.tsx's existing selected-clip delete handler (App.tsx's own Delete/Backspace effect stays as-is for Normal/Compact mode — this is sketch mode's equivalent, scoped to when a sketch tile is selected):

```tsx
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!state.sel || !sequence.some((r) => r.groupId === state.sel)) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      removeTile(state.sel)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.sel, sequence, dispatch])
```

Note: App.tsx's `Frame` component *also* has a Delete/Backspace handler that fires `REMOVE_FROM_TIMELINE` unconditionally whenever `state.sel` is set, regardless of mode — while in sketch mode this would double-fire alongside SketchStrip's own handler above (removing, then SketchStrip's `SEQUENCE_RIFFFS` follow-up would still run correctly against already-updated state, but App.tsx's copy runs *without* the repack step, potentially racing). Guard App.tsx's existing handler to skip while in sketch mode — in `src/renderer/src/App.tsx`'s `Frame` component, in the Delete/Backspace effect, change:

```ts
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!state.sel) return
```
to:
```ts
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!state.sel || state.mode === 'sketch') return
```

And update that effect's own dependency array from `}, [state.sel, dispatch])` to `}, [state.sel, state.mode, dispatch])`.

- [ ] **Step 3: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

- [ ] **Step 4: Manual verification**

Select a sketch tile, press Delete — confirm it's removed and everything after it shifts left (no gap). Right-click a different tile — confirm it's removed the same way without needing to select it first.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SketchStrip.tsx src/renderer/src/App.tsx
git commit -m "Add remove-tile (Delete/Backspace, right-click) to SketchStrip"
```

---

### Task 14: Inspector auto-follow during sketch-mode playback

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the import**

Add `groupIdAtPosition` and `usePos` to `App.tsx`'s existing imports:

```ts
import {
  loopLengthBars,
  pasteRifffAction,
  placedRifffsInOrder,
  channelMuteLetters,
  nextArrangerMode,
  groupIdAtPosition
} from './state/selectors'
```

```ts
import {
  StoreProvider,
  useAppState,
  useDispatch,
  useHistory,
  usePlaying,
  usePos
} from './state/StoreContext'
```

- [ ] **Step 2: Add the auto-follow effect**

In `Frame`, add `const pos = usePos()` alongside the existing `const playing = usePlaying()`, and add this effect (place it near the other keyboard/behavior effects):

```ts
  // Sketch mode only: while playing, the Inspector automatically shows
  // whichever rifff currently contains the playhead — no manual click
  // needed to follow along. Scoped to sketch mode specifically because it's
  // the only mode where "the currently playing rifff" is unambiguous
  // (Normal/Compact can have several playing across different rows at
  // once). Only dispatches SELECT when the playing rifff actually
  // CHANGES (a transition into a new one) — not on every ~30Hz position
  // tick — so a manual click on a different tile mid-playback sticks in
  // the Inspector until the next real transition, instead of snapping back
  // within the next tick.
  const autoFollowedGroupIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (state.mode !== 'sketch' || !playing) {
      autoFollowedGroupIdRef.current = null
      return
    }
    const current = groupIdAtPosition(state, pos)
    if (current && current !== autoFollowedGroupIdRef.current) {
      autoFollowedGroupIdRef.current = current
      dispatch({ type: 'SELECT', groupId: current })
    }
  }, [state, playing, pos, dispatch])
```

Add `useRef` to the existing `react` import at the top of `App.tsx` if it's not already imported (check the current import line — it currently imports `useEffect, useState`; add `useRef`):

```ts
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
```

- [ ] **Step 3: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: Clean.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: All passing (re-run once if only a native-engine spawn/socket test flakes — established pattern this session, not a regression).

- [ ] **Step 5: Production build**

Run: `npx electron-vite build`
Expected: Succeeds.

- [ ] **Step 6: Manual verification**

In sketch mode with 3+ rifffs sequenced, press play and confirm the Inspector switches to each rifff automatically as playback reaches it. While playing, click a *different* tile than the one currently playing — confirm the Inspector shows that one and stays there (doesn't snap back) until playback actually reaches a new rifff, at which point it should take over again.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Auto-follow the Inspector to the currently-playing rifff in sketch mode"
```

---

### Task 15: Final review and manual end-to-end pass

**Files:** none (verification only)

- [ ] **Step 1: Full verification suite**

```bash
npm run typecheck
npm run lint
npx vitest run
npx electron-vite build
```
Expected: All clean.

- [ ] **Step 2: Full manual walkthrough**

With the dev server running (restart it first — this plan touches `App.tsx`, which is renderer-only, so `electron-vite dev`'s HMR should already have every change live, but a clean restart rules out any stale-state doubt for this final pass):

1. Start a fresh project — confirm it opens directly in sketch mode.
2. Drag several rifffs from the shelf into the sketch strip, in some order.
3. Drag the LORE library button open, import a riff — confirm it lands in the shelf, then drag it into the strip too.
4. Reorder by dragging a tile to a new position.
5. Press play — confirm rifffs play one after another (not simultaneously), the orbiting dot tracks each one's own progress at a lap speed matching its bar length, the currently-playing tile gets the subtle glow, and the Inspector follows along automatically.
6. While playing, click a different (not-yet-playing) tile — confirm the Inspector shows it and doesn't snap back until playback naturally reaches a new rifff.
7. Remove a tile via Delete and via right-click — confirm both close the gap.
8. Press Tab — confirm it cycles sketch -> normal -> compact -> sketch (since the arrangement, having only ever been touched via SketchStrip's own constrained interactions, stays eligible throughout).
9. In Normal mode, add a fade to one of the rifffs, then press Tab repeatedly — confirm the cycle now skips sketch (normal -> compact -> normal), and hovering the mode button's tooltip explains why.
10. Remove the fade (or undo) — confirm sketch becomes reachable again.

- [ ] **Step 3: Report**

Summarize verification results. Flag anything that couldn't be checked automatically (all of Step 2 requires manual interaction — call this out explicitly rather than claiming it as verified).
