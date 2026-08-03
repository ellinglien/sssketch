# Fine-Grained State Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `ChannelRow`, `RifffBlockRow`, `StemWaveformRow`, and `CollapsedRifffRow` (rendered once per clip/stem) from re-rendering on every dispatch anywhere in the app — only when a field they actually read changes.

**Architecture:** A `useAppSelector(selector)` hook, built on `useSyncExternalStoreWithSelector`, added to `StoreContext.tsx` alongside a small passive mirror of the reducer's own state. The four components migrate from one broad `useAppState()` read to several individual `useAppSelector` calls. `clipGeometry`/`resolvePlayedBars` (which take the whole `AppState`) gain narrow field-based siblings so the migrated components don't need a full state object to call them.

**Tech Stack:** TypeScript, React 19 (`useSyncExternalStore`), Vitest.

Full design context: `docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md`.

---

### Task 1: Install `use-sync-external-store`

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm, not hand-edited)

- [ ] **Step 1: Install the runtime package and its types**

Run:
```bash
npm install use-sync-external-store
npm install --save-dev @types/use-sync-external-store
```

- [ ] **Step 2: Run the project's own typecheck and lint to confirm nothing broke**

Run: `npm run typecheck && npm run lint`
Expected: no errors (this task doesn't touch any app source yet, so this should be identical to before). Real confirmation that the package and its types resolve correctly comes from Task 2, which actually imports and uses `useSyncExternalStoreWithSelector` — a standalone scratch-file check here would be redundant with that and more likely to produce a false failure from its own ad-hoc tsc flags than to catch anything real.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add use-sync-external-store dependency"
```

---

### Task 2: Store bridge + `useAppSelector` hook

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`
- Test: `src/renderer/src/state/StoreContext.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/state/StoreContext.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { subscribeToState, getStateSnapshot, __setStateForTest } from './StoreContext'

describe('subscribeToState / getStateSnapshot', () => {
  it('getStateSnapshot returns the current mirrored state', () => {
    const fakeState = { bpm: 140 } as ReturnType<typeof getStateSnapshot>
    __setStateForTest(fakeState)
    expect(getStateSnapshot()).toBe(fakeState)
  })

  it('calls a subscribed listener when notified', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToState(listener)
    __setStateForTest({ bpm: 150 } as ReturnType<typeof getStateSnapshot>)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('stops calling a listener after it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToState(listener)
    unsubscribe()
    __setStateForTest({ bpm: 160 } as ReturnType<typeof getStateSnapshot>)
    expect(listener).not.toHaveBeenCalled()
  })

  it('supports multiple independent subscribers', () => {
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const unsubscribeA = subscribeToState(listenerA)
    const unsubscribeB = subscribeToState(listenerB)
    __setStateForTest({ bpm: 170 } as ReturnType<typeof getStateSnapshot>)
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(1)
    unsubscribeA()
    unsubscribeB()
  })
})
```

This introduces a `__setStateForTest` export — a thin wrapper that sets `currentState` and notifies listeners, used ONLY by this test file to exercise the bridge without needing a real React render. It's the test-only equivalent of what `StoreProvider`'s render body + effect do together in the real app (see Step 2 below) — production code never calls it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/StoreContext.test.ts`
Expected: FAIL — `subscribeToState`, `getStateSnapshot`, `__setStateForTest` aren't exported from `./StoreContext` yet.

- [ ] **Step 3: Implement the store bridge**

In `src/renderer/src/state/StoreContext.tsx`, add this block right after the `DispatchableAction` type definition and before `const StateCtx = createContext<AppState>(initialState)`:

```ts
// A passive mirror of the reducer's own state (history.present, below),
// letting components subscribe to specific fields via useAppSelector
// instead of the whole AppState via useAppState()/StateCtx -- see
// docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
// This does NOT change the reducer/dispatch/undo pipeline in any way; it
// only observes its output. StoreProvider keeps this in sync (see its own
// render body below) -- nothing else should ever call __setStateForTest,
// which exists purely so this bridge's own tests don't need a real React
// render to exercise it.
let currentState: AppState = initialState
const stateListeners = new Set<() => void>()

export function subscribeToState(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

export function getStateSnapshot(): AppState {
  return currentState
}

export function __setStateForTest(state: AppState): void {
  currentState = state
  for (const listener of stateListeners) listener()
}
```

- [ ] **Step 4: Sync the bridge from `StoreProvider`**

Find (near the top of `StoreProvider`, currently):
```ts
  const [history, rawDispatch] = useReducer(historyReducer, initialState, createHistoryState)
  const state = history.present
```

Replace with:
```ts
  const [history, rawDispatch] = useReducer(historyReducer, initialState, createHistoryState)
  const state = history.present
  // Keeps the store bridge (subscribeToState/getStateSnapshot, above) in
  // sync with this render's state, synchronously -- safe because React
  // always finishes a parent's own render before rendering its children,
  // so any useAppSelector call in a descendant sees this value by the time
  // it runs, within the same render pass. Notifying subscribers (so THEIR
  // OWN re-renders happen) has to wait for the effect below instead --
  // you can't synchronously trigger another component's re-render
  // mid-render.
  currentState = state
  useEffect(() => {
    for (const listener of stateListeners) listener()
  }, [state])
```

- [ ] **Step 5: Add the `useAppSelector` hook**

Find:
```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppState(): AppState {
  return useContext(StateCtx)
}
```

Replace with:
```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppState(): AppState {
  return useContext(StateCtx)
}

/** Subscribes to one specific slice of AppState instead of the whole
 * object -- only re-renders the calling component when THIS selector's
 * result actually changes (per isEqual, default reference equality), not
 * on every dispatch anywhere in the app. See useAppState() above for the
 * broad-read alternative, still the right tool for components whose
 * render cost doesn't multiply by project size (Inspector, Shelf,
 * TransportBar, etc.) -- this hook is for the ones that do (ChannelRow,
 * RifffBlockRow, StemWaveformRow, CollapsedRifffRow). See
 * docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md. */
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppSelector<T>(
  selector: (state: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  return useSyncExternalStoreWithSelector(
    subscribeToState,
    getStateSnapshot,
    getStateSnapshot,
    selector,
    isEqual
  )
}
```

- [ ] **Step 6: Add the import**

Find:
```ts
import { initialState, type Action, type AppState } from './store'
```

Replace with:
```ts
import { initialState, type Action, type AppState } from './store'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/StoreContext.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 8: Run the full suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed. `useAppSelector` isn't consumed anywhere yet (that's Tasks 4-7), so no "unused export" error is expected — it's a normal exported function, not a local unused variable.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx src/renderer/src/state/StoreContext.test.ts
git commit -m "Add store bridge and useAppSelector hook"
```

---

### Task 3: Field-based `clipGeometry`/`resolvePlayedBars` variants

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

`clipGeometry`/`resolvePlayedBars` take the whole `AppState`, and are also used by `loopLengthBars`/`pasteRifffAction` (which legitimately need full state — they're not part of the per-component re-render problem). Rather than changing their signatures (which would ripple into those other callers for no benefit), this task adds narrow, field-based siblings that the four components will call instead, and rewrites the originals as thin wrappers around them — zero behavior change for every existing caller.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/state/selectors.test.ts`, find the existing `describe('resolvePlayedBars', ...)` block and add a new one immediately before it:

```ts
describe('resolvedPlayedBarsFromFields', () => {
  it('returns the override when one is set', () => {
    expect(resolvedPlayedBarsFromFields(12, 8)).toBe(12)
  })

  it('falls back to the rifff bar length when no override is set', () => {
    expect(resolvedPlayedBarsFromFields(undefined, 8)).toBe(8)
  })
})

describe('resolvePlayedBars', () => {
```

A `describe('clipGeometry', ...)` block already exists in this file. Add the new `describe('clipGeometryFromFields', ...)` block immediately before it:

```ts
describe('clipGeometryFromFields', () => {
  it('matches clipGeometry exactly for a plain, unstretched-off, no-offset clip', () => {
    const bars = clipGeometryFromFields(4, 0, 4, undefined, 8, true, 150, 150, 24)
    expect(bars).toEqual({ leftPx: 96, widthPx: 192 })
  })

  it('applies the sub-bar nudge offset', () => {
    // offsetSteps=-8 at snapDiv=4 is -2 bars -> leftPx shifts by -2*24=-48
    const bars = clipGeometryFromFields(4, -8, 4, undefined, 8, true, 150, 150, 24)
    expect(bars.leftPx).toBe(96 - 48)
  })

  it('scales widthPx by the bpm ratio when stretch is off', () => {
    // stretch off: shownBars = playedBars * (rifffBpm/stateBpm) = 8 * (150/100) = 12
    const bars = clipGeometryFromFields(0, 0, 4, undefined, 8, false, 150, 100, 24)
    expect(bars.widthPx).toBe(12 * 24)
  })

  it('uses the playedBars override over the rifff bar length', () => {
    const bars = clipGeometryFromFields(0, 0, 4, 16, 8, true, 150, 150, 24)
    expect(bars.widthPx).toBe(16 * 24)
  })
})
```

Add `resolvedPlayedBarsFromFields` and `clipGeometryFromFields` to the existing `from './selectors'` import at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: FAIL — `resolvedPlayedBarsFromFields`/`clipGeometryFromFields` aren't exported from `./selectors` yet.

- [ ] **Step 3: Implement, preserving existing behavior exactly**

In `src/renderer/src/state/selectors.ts`, find:

```ts
export function resolvePlayedBars(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}
```

Replace with:

```ts
/** The played-bars override/fallback logic on its own, so a caller that
 * already has these two fields via individual selectors (see
 * useAppSelector, StoreContext.tsx) doesn't need a full AppState just to
 * call resolvePlayedBars. resolvePlayedBars below is now a thin wrapper
 * around this. */
export function resolvedPlayedBarsFromFields(
  playedBarsOverride: number | undefined,
  rifffBarLength: number
): number {
  return playedBarsOverride ?? rifffBarLength
}

export function resolvePlayedBars(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return resolvedPlayedBarsFromFields(state.playedBars[groupId], rifff.barLength)
}
```

Find:

```ts
export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvePlayedBars(state, groupId)
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? playedBars : playedBars * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}
```

Replace with:

```ts
/** clipGeometry's own formula, parameterized by individual fields instead
 * of a full AppState -- see resolvedPlayedBarsFromFields's doc comment
 * for why. clipGeometry below is now a thin wrapper around this. */
export function clipGeometryFromFields(
  startBar: number,
  offsetSteps: number,
  snapDiv: number,
  playedBarsOverride: number | undefined,
  rifffBarLength: number,
  stretchOn: boolean,
  rifffBpm: number,
  stateBpm: number,
  ppb: number
): ClipGeometry {
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifffBarLength)
  const shownBars = stretchOn ? playedBars : playedBars * (rifffBpm / stateBpm)
  return { leftPx: startBar * ppb + offsetPx, widthPx: shownBars * ppb }
}

export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const stretchOn = state.stretch[groupId] ?? true
  return clipGeometryFromFields(
    start,
    offsetSteps,
    snapDiv,
    state.playedBars[groupId],
    rifff.barLength,
    stretchOn,
    rifff.bpm,
    state.bpm,
    ppb
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS — the new tests, AND every pre-existing test in this file (`resolvePlayedBars`, `clipGeometry`, and everything else), since `resolvePlayedBars`/`clipGeometry`'s own behavior is unchanged (they now delegate to the new functions instead of inlining the logic, but compute identical results).

- [ ] **Step 5: Run the full suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Add field-based clipGeometry/resolvePlayedBars variants"
```

---

### Task 4: Migrate `RifffBlockRow.tsx`

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`

This is the simplest of the four migrations — good to do first since it exercises the new hook/selector pattern against real component code before tackling the more involved ones. No new tests (matches this codebase's convention: React components aren't unit-tested directly).

- [ ] **Step 1: Update the imports**

Find:
```ts
import { useAppState, useDispatch, useZoom } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { clipGeometry } from '../state/selectors'
import { ROW_HEIGHT } from './StemWaveformRow'
import { suppressNextSyntheticClick } from './dragUtils'
```

Replace with:
```ts
import { useAppSelector, useDispatch, useZoom } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { clipGeometryFromFields } from '../state/selectors'
import { SNAP_DIVS } from '../state/store'
import { ROW_HEIGHT } from './StemWaveformRow'
import { suppressNextSyntheticClick } from './dragUtils'
```

- [ ] **Step 2: Replace the state reads**

Find:
```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  // A one-shot always has exactly one stem (enforced by importOneShot) --
  // there's nothing extra an expanded per-stem view would show that
  // CollapsedRifffRow doesn't already, and CollapsedRifffRow is the only
  // place the one-shot-aware trim/stretch resize handles are wired (see
  // oneShotResize.ts) -- StemWaveformRow's own handles are still the
  // bar-snapped playedBars/RESIZE_LEFT ones, which would be wrong for a
  // one-shot.
  const isOneShot = rifff.stems.length === 1 && !!rifff.stems[0].oneShot
  const expanded = !!state.exp[groupId] && !isOneShot
  const color = identityColor(rifff)
  const ppb = useZoom()
  const geo = clipGeometry(state, groupId, ppb)
```

Replace with:
```ts
  const dispatch = useDispatch()
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const selected = useAppSelector((s) => s.sel === groupId)
  const expandedFlag = useAppSelector((s) => !!s.exp[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const bpm = useAppSelector((s) => s.bpm)
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  // A one-shot always has exactly one stem (enforced by importOneShot) --
  // there's nothing extra an expanded per-stem view would show that
  // CollapsedRifffRow doesn't already, and CollapsedRifffRow is the only
  // place the one-shot-aware trim/stretch resize handles are wired (see
  // oneShotResize.ts) -- StemWaveformRow's own handles are still the
  // bar-snapped playedBars/RESIZE_LEFT ones, which would be wrong for a
  // one-shot.
  const isOneShot = rifff.stems.length === 1 && !!rifff.stems[0].oneShot
  const expanded = expandedFlag && !isOneShot
  const color = identityColor(rifff)
  const ppb = useZoom()
  const geo = clipGeometryFromFields(
    rifff.startBar ?? 0,
    offsetSteps,
    SNAP_DIVS[snapIdx],
    playedBarsOverride,
    rifff.barLength,
    stretchOn,
    rifff.bpm,
    bpm,
    ppb
  )
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RifffBlockRow.tsx
git commit -m "Migrate RifffBlockRow to fine-grained state selectors"
```

---

### Task 5: Migrate `ChannelRow.tsx`

**Files:**
- Modify: `src/renderer/src/components/ChannelRow.tsx`

This one reads `state.mute` and `state.rifffs` as whole maps (its solo-detection logic genuinely needs to scan every rifff in the project, not just this channel's own) — selecting them as whole objects via `useAppSelector` still helps: this component will now re-render only when mute state or the rifffs map actually changes, not on every dispatch (a volume drag, fade adjustment, tempo change, etc. no longer touches it).

- [ ] **Step 1: Update the import**

Find:
```ts
import { useAppState, useDispatch } from '../state/StoreContext'
```

Replace with:
```ts
import { useAppSelector, useDispatch } from '../state/StoreContext'
```

- [ ] **Step 2: Replace the state reads**

Find:
```ts
  const [chainPanelOpen, setChainPanelOpen] = useState(false)
  const state = useAppState()
  const dispatch = useDispatch()

  const allMuted = useMemo(
    () =>
      rifffs.length > 0 &&
      rifffs.every((r) => r.stems.every((s) => state.mute[stemKey(r.groupId, s.slot)])),
    [rifffs, state.mute]
  )

  // Mirrors SOLO_GROUP/SOLO_CHANNEL's own "alreadySoloed" definition in
  // store.ts: every stem in this channel unmuted, every stem in every other
  // PLACED channel muted. When there's only one channel on the timeline
  // this is trivially true even with nothing "soloed" -- same accepted edge
  // case the pre-existing SOLO_GROUP check already has, not a new one.
  //
  // Scans EVERY rifff in the whole project, not just this channel's own --
  // memoized so that scan only re-runs when mute state or the project's own
  // rifff set actually changes, not on every unrelated render (this
  // component's own useAppState() subscription means it re-renders on every
  // dispatch, e.g. a volume drag or plugin selection elsewhere).
  const soloed = useMemo(() => {
    const channelGroupIds = new Set(rifffs.map((r) => r.groupId))
    return Object.values(state.rifffs).every((r) => {
      if (r.startBar === undefined) return true
      const inThisChannel = channelGroupIds.has(r.groupId)
      return r.stems.every((s) => !!state.mute[stemKey(r.groupId, s.slot)] === !inThisChannel)
    })
  }, [rifffs, state.rifffs, state.mute])
```

Replace with:
```ts
  const [chainPanelOpen, setChainPanelOpen] = useState(false)
  const dispatch = useDispatch()
  // Read as whole maps, not per-key -- the solo check below genuinely needs
  // every rifff/mute entry in the project, not just this channel's own. This
  // still helps: this component now only re-renders when mute state or the
  // rifffs map actually changes, not on every dispatch anywhere (a volume
  // drag, fade adjustment, tempo change, etc. no longer touches it). See
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const mute = useAppSelector((s) => s.mute)
  const rifffsMap = useAppSelector((s) => s.rifffs)

  const allMuted = useMemo(
    () =>
      rifffs.length > 0 &&
      rifffs.every((r) => r.stems.every((s) => mute[stemKey(r.groupId, s.slot)])),
    [rifffs, mute]
  )

  // Mirrors SOLO_GROUP/SOLO_CHANNEL's own "alreadySoloed" definition in
  // store.ts: every stem in this channel unmuted, every stem in every other
  // PLACED channel muted. When there's only one channel on the timeline
  // this is trivially true even with nothing "soloed" -- same accepted edge
  // case the pre-existing SOLO_GROUP check already has, not a new one.
  //
  // Scans EVERY rifff in the whole project, not just this channel's own --
  // memoized so that scan only re-runs when mute state or the project's own
  // rifff set actually changes.
  const soloed = useMemo(() => {
    const channelGroupIds = new Set(rifffs.map((r) => r.groupId))
    return Object.values(rifffsMap).every((r) => {
      if (r.startBar === undefined) return true
      const inThisChannel = channelGroupIds.has(r.groupId)
      return r.stems.every((s) => !!mute[stemKey(r.groupId, s.slot)] === !inThisChannel)
    })
  }, [rifffs, rifffsMap, mute])
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ChannelRow.tsx
git commit -m "Migrate ChannelRow to fine-grained state selectors"
```

---

### Task 6: Migrate `StemWaveformRow.tsx`

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Update the imports**

Find:
```ts
import { useState } from 'react'
import { useDispatch, useAppState, usePlaying } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { sqrtGain } from '@shared/mixGain'
import { clipGeometry, resolvePlayedBars } from '../state/selectors'
```

Replace with:
```ts
import { useState } from 'react'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { MIN_PLAYED_BARS, SNAP_DIVS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { sqrtGain } from '@shared/mixGain'
import { clipGeometryFromFields, resolvedPlayedBarsFromFields } from '../state/selectors'
```

- [ ] **Step 2: Replace the state reads and the `clipGeometry`/`resolvePlayedBars` calls**

Find:
```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const playedBarsKey = groupId
  const muted = !!state.mute[key]
  const volumeDragMode = state.volumeDragMode
  const volume = state.vol[key] ?? 1
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0
```

Replace with:
```ts
  const dispatch = useDispatch()
  const playing = usePlaying()
  const key = stemKey(groupId, slot)
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const muted = useAppSelector((s) => !!s.mute[key])
  const volumeDragMode = useAppSelector((s) => s.volumeDragMode)
  const volume = useAppSelector((s) => s.vol[key] ?? 1)
  const fadeIn = useAppSelector((s) => s.fadeIn[groupId] ?? 0)
  const fadeOut = useAppSelector((s) => s.fadeOut[groupId] ?? 0)
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const bpm = useAppSelector((s) => s.bpm)
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const playedBarsKey = groupId
```

Find:
```ts
  const resolvedPlayedBars = resolvePlayedBars(state, groupId)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const stemGeo = clipGeometry(state, groupId, ppb)
  const baseStartBar = rifff.startBar ?? 0
```

Replace with:
```ts
  const resolvedPlayedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifff.barLength)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const stemGeo = clipGeometryFromFields(
    rifff.startBar ?? 0,
    offsetSteps,
    SNAP_DIVS[snapIdx],
    playedBarsOverride,
    rifff.barLength,
    stretchOn,
    rifff.bpm,
    bpm,
    ppb
  )
  const baseStartBar = rifff.startBar ?? 0
```

- [ ] **Step 3: Update the one stale comment referencing the removed `state` variable**

Find:
```ts
    // That bar-span is widthPx/ppb, NOT displayedPlayedBars -- they only
    // agree when stretch is on. With stretch off, clipGeometry renders at
    // shownBars = playedBars * (rifff.bpm / state.bpm), a different value
    // than displayedPlayedBars (which is always the played-bars count,
    // never tempo-adjusted) -- using the wrong one here silently used the
    // wrong bar-span for any un-stretched stem, still landing off target.
```

Replace with:
```ts
    // That bar-span is widthPx/ppb, NOT displayedPlayedBars -- they only
    // agree when stretch is on. With stretch off, clipGeometry renders at
    // shownBars = playedBars * (rifff.bpm / bpm), a different value than
    // displayedPlayedBars (which is always the played-bars count, never
    // tempo-adjusted) -- using the wrong one here silently used the wrong
    // bar-span for any un-stretched stem, still landing off target.
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors. Pay attention to any remaining `state.` reference reported as undefined — there should be none (this task's greps found every usage; if typecheck disagrees, re-grep `state\.` and `\bstate\b` in this file and resolve any remaining ones the same way).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "Migrate StemWaveformRow to fine-grained state selectors"
```

---

### Task 7: Migrate `CollapsedRifffRow.tsx`

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`

- [ ] **Step 1: Update the imports**

Find:
```ts
import { useState } from 'react'
import { useAppState, useDispatch, usePlaying, useZoom } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { clipGeometry, resolvePlayedBars } from '../state/selectors'
```

Replace with:
```ts
import { useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, useZoom } from '../state/StoreContext'
import { MIN_PLAYED_BARS, SNAP_DIVS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { clipGeometryFromFields, resolvedPlayedBarsFromFields } from '../state/selectors'
```

- [ ] **Step 2: Replace the top-of-component state reads**

Find:
```ts
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  // Shadows the name every existing PPB reference in this file already
  // uses -- see zoomMath.ts/useZoom's own doc comments for what this value
  // actually is (base PPB * the current zoom multiplier).
  const PPB = useZoom()
  const rifff = state.rifffs[groupId]
  const firstStem = rifff.stems[0]
  const color = typeColorVar(firstStem?.type ?? 'fx')
  const isOneShot = rifff.stems.length === 1 && !!firstStem.oneShot
  const oneShotStem = isOneShot ? firstStem : null
  const secPerBar = (60 / state.bpm) * 4
  const volumeDragMode = state.volumeDragMode
  // One button for the whole group rather than exposing each stem's own mute
  // individually (unlike the expanded view) — collapsing already hides
  // per-stem detail, so "all muted" / "not all muted" is the only distinction
  // that makes sense at this level. Filled = at least one stem still
  // unmuted (clicking mutes everything); hollow = the whole group is
  // already muted (clicking unmutes everything) — same filled-means-active
  // convention as every other mute dot in this app.
  const allMuted = rifff.stems.every((stem) => state.mute[stemKey(groupId, stem.slot)])
  // Representative volume for the envelope's own drag-start/display value —
  // same "first stem stands in for the group" convention as the geometry
  // below. Actually adjusting the envelope dispatches SET_GROUP_VOLUME,
  // which sets every stem to the same value in one atomic edit, so this
  // representative value becomes exactly correct the moment it's touched.
  const volume = state.vol[stemKey(groupId, firstStem.slot)] ?? 1
```

Replace with:
```ts
  const dispatch = useDispatch()
  const playing = usePlaying()
  // Shadows the name every existing PPB reference in this file already
  // uses -- see zoomMath.ts/useZoom's own doc comments for what this value
  // actually is (base PPB * the current zoom multiplier).
  const PPB = useZoom()
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  // `mute` is read as the whole map (not per-stem) because allMuted below
  // needs every one of this rifff's own stems' mute values together --
  // still narrower than before, since this only re-renders on a mute
  // change now, not on every dispatch.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const bpm = useAppSelector((s) => s.bpm)
  const volumeDragMode = useAppSelector((s) => s.volumeDragMode)
  const mute = useAppSelector((s) => s.mute)
  const firstStem = rifff.stems[0]
  const color = typeColorVar(firstStem?.type ?? 'fx')
  const isOneShot = rifff.stems.length === 1 && !!firstStem.oneShot
  const oneShotStem = isOneShot ? firstStem : null
  const secPerBar = (60 / bpm) * 4
  // One button for the whole group rather than exposing each stem's own mute
  // individually (unlike the expanded view) — collapsing already hides
  // per-stem detail, so "all muted" / "not all muted" is the only distinction
  // that makes sense at this level. Filled = at least one stem still
  // unmuted (clicking mutes everything); hollow = the whole group is
  // already muted (clicking unmutes everything) — same filled-means-active
  // convention as every other mute dot in this app.
  const allMuted = rifff.stems.every((stem) => mute[stemKey(groupId, stem.slot)])
  // Representative volume for the envelope's own drag-start/display value —
  // same "first stem stands in for the group" convention as the geometry
  // below. Actually adjusting the envelope dispatches SET_GROUP_VOLUME,
  // which sets every stem to the same value in one atomic edit, so this
  // representative value becomes exactly correct the moment it's touched.
  const volume = useAppSelector((s) => s.vol[stemKey(groupId, firstStem.slot)] ?? 1)
```

- [ ] **Step 3: Replace the `resolvePlayedBars`/`clipGeometry` calls**

Find:
```ts
  const playedBarsKey = groupId
  const resolvedPlayedBars = resolvePlayedBars(state, groupId)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const baseStartBar = rifff.startBar ?? 0

  const geo = clipGeometry(state, groupId, PPB)
```

Replace with:
```ts
  const playedBarsKey = groupId
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const resolvedPlayedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifff.barLength)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const baseStartBar = rifff.startBar ?? 0

  const geo = clipGeometryFromFields(
    baseStartBar,
    offsetSteps,
    SNAP_DIVS[snapIdx],
    playedBarsOverride,
    rifff.barLength,
    stretchOn,
    rifff.bpm,
    bpm,
    PPB
  )
```

- [ ] **Step 4: Update the remaining `state.bpm` usages (one-shot width calculations)**

Find:
```ts
  const widthPx = isOneShot
    ? oneShotWidthBars(oneShotDragPreview?.durationSec ?? oneShotCommittedDurationSec, state.bpm) *
      PPB
```

Replace with:
```ts
  const widthPx = isOneShot
    ? oneShotWidthBars(oneShotDragPreview?.durationSec ?? oneShotCommittedDurationSec, bpm) * PPB
```

Find:
```ts
  const oneShotWaveformNativeWidthPx = oneShotWidthBars(oneShotWaveformNativeSec, state.bpm) * PPB
```

Replace with:
```ts
  const oneShotWaveformNativeWidthPx = oneShotWidthBars(oneShotWaveformNativeSec, bpm) * PPB
```

Find:
```ts
  const oneShotWaveformTrimStartPx = oneShotWidthBars(oneShotWaveformTrimStartSec, state.bpm) * PPB
```

Replace with:
```ts
  const oneShotWaveformTrimStartPx = oneShotWidthBars(oneShotWaveformTrimStartSec, bpm) * PPB
```

Find (inside `handleOneShotLeftEdgeStart`):
```ts
        finalStartBar = Math.max(
          0,
          startPosBar + oneShotWidthBars(committedDurationSec - finalDurationSec, state.bpm)
        )
```

Replace with:
```ts
        finalStartBar = Math.max(
          0,
          startPosBar + oneShotWidthBars(committedDurationSec - finalDurationSec, bpm)
        )
```

- [ ] **Step 5: Update the remaining `state.mute` usages (JSX render)**

Find:
```ts
            {isOneShot && oneShotStem
              ? !state.mute[stemKey(groupId, oneShotStem.slot)] && (
```

Replace with:
```ts
            {isOneShot && oneShotStem
              ? !mute[stemKey(groupId, oneShotStem.slot)] && (
```

Find:
```ts
              : rifff.stems
                  .filter((stem) => !state.mute[stemKey(groupId, stem.slot)])
```

Replace with:
```ts
              : rifff.stems
                  .filter((stem) => !mute[stemKey(groupId, stem.slot)])
```

- [ ] **Step 6: Update the two fade reads**

Find:
```ts
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0
```

Replace with:
```ts
  const fadeIn = useAppSelector((s) => s.fadeIn[groupId] ?? 0)
  const fadeOut = useAppSelector((s) => s.fadeOut[groupId] ?? 0)
```

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors. As with Task 6, if typecheck reports a leftover `state.` reference, re-grep `state\.` and `\bstate\b` in this file (there should be none left — Steps 2-6 above account for every occurrence found during planning) and resolve it the same way.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "Migrate CollapsedRifffRow to fine-grained state selectors"
```

---

### Task 8: Full verification and manual walkthrough

- [ ] **Step 1: Run the full test suite, typecheck, and lint one more time**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed, matching the last known-good counts from Task 3 (adjusted for the 8 new `StoreContext.test.ts`/`selectors.test.ts` tests added in Tasks 2-3).

- [ ] **Step 2: Manual verification**

Not automatable in this environment (no GUI interaction tooling):

1. On a project with a meaningful number of placed clips, drag a volume fader/fade handle on one clip while watching the rest of the timeline — other clips' rows should not visibly re-render/flicker.
2. Play back the project and confirm visuals feel responsive — the original complaint this work responds to.
3. Confirm mute/volume/fade/select interactions on all four migrated components still work correctly and stay in sync with the rest of the UI (Inspector, TransportBar) — no stale-value regressions from the selector migration.
4. Confirm undo/redo still works correctly across all four components' interactions.
5. Confirm a stem/rifff with stretch toggled OFF still renders and resizes correctly (exercises the `rifffBpm`/`stateBpm` ratio path in `clipGeometryFromFields`).
6. Confirm a one-shot sample (`CollapsedRifffRow`'s one-shot path) still trims/stretches correctly.
