# Fine-Grained State Selectors Design

## Background

`StateCtx` (`StoreContext.tsx`) holds the entire `AppState` object as one React
Context value, and `useAppState()` simply returns `useContext(StateCtx)`. Every
component that calls it re-renders whenever *any* dispatch changes *any* field of
`AppState` — a volume-drag tick, a mute toggle, a fade adjustment, anything —
regardless of whether that component reads the specific field that changed.

This is fine for single-instance panels (Inspector, Shelf, TransportBar), which
re-render once per dispatch no matter what. It's a real problem for
`ChannelRow`, `RifffBlockRow`, `StemWaveformRow`, and `CollapsedRifffRow` —
components rendered once *per clip/stem*, all of which call `useAppState()`
directly. On any project with a nontrivial clip count, every dispatch forces a
full re-render of every clip and stem in the timeline, not just the one
affected. This was confirmed as a real, measurable contributor to sluggish
visuals during playback and editing (a related but distinct bug — `Frame`
subscribing to the 30Hz position tick just to feed a sketch-mode-only effect —
was already found and fixed separately; this is the same class of problem,
systemic rather than tied to one effect).

`React.memo` alone cannot fix this: a memoized component still re-renders
when it directly consumes a changed Context, regardless of whether its props
changed. Only removing the direct `useAppState()` subscription — and replacing
it with something that can bail out per-field — actually helps.

## Scope

This pass covers exactly the four per-clip/per-stem components:
`ChannelRow.tsx`, `RifffBlockRow.tsx`, `StemWaveformRow.tsx`,
`CollapsedRifffRow.tsx`. Every other component keeps using `useAppState()`
unchanged — their re-render cost doesn't multiply by project size, so a
selector migration there wouldn't pay for itself. `useAppState()` itself is
not removed or deprecated; it remains the right tool for broad consumers.

## Architecture

### The store bridge

A small module-level mirror of the reducer's own state, added directly to
`StoreContext.tsx` (not a separate file — it's tightly coupled to
`StoreProvider`'s own lifecycle, and this file is already the hub for every
context/hook this app's renderer state exposes):

```ts
let currentState: AppState = initialState
const listeners = new Set<() => void>()

function subscribeToState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getStateSnapshot(): AppState {
  return currentState
}
```

`StoreProvider` syncs `currentState = state` **directly in its render body**
(not in an effect) — safe because React always finishes a parent's own render
before rendering its children, so any `useAppSelector` call in a descendant
sees the up-to-date mirror by the time it runs, within the same render pass.
A separate `useEffect(() => { for (const l of listeners) l() }, [state])`
notifies subscribers *after* commit, which is the correct timing for
triggering their own re-renders — you cannot synchronously trigger another
component's re-render mid-render.

This bridge is purely a passive mirror. It does not change the existing
`useReducer(historyReducer, ...)`/`dispatch`/undo pipeline in any way — that
remains the single source of truth; the bridge just observes its output.

### The selector hook

```ts
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

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

This needs one new dependency: **`use-sync-external-store`**, the small
package React's own team maintains specifically for building
selector-based external-store subscriptions on top of the core
`useSyncExternalStore` hook (React 19, already in use here, natively
supports the base hook, but not the selector/equality-check wrapper — that's
what this package adds). It's the same building block Redux, Zustand, and
Jotai all use internally for exactly this pattern. A hand-rolled version was
considered and rejected: getting the memoization/equality-check logic exactly
right (avoiding stale closures, correctly memoizing across re-renders without
introducing infinite-update loops) has enough sharp edges that reimplementing
it isn't worth the risk for something this small, standard, and low-risk to
depend on instead.

Default `isEqual` is `Object.is` (reference equality) — correct for the
common case of selecting a primitive field (`state.mute[key]`, a boolean) and
also correct for selecting a whole sub-object (`state.rifffs[groupId]`)
*because the reducer already preserves reference stability for untouched
entries* (verified: `TOGGLE_MUTE`/`SET_VOLUME` spread only the specific field
touched, e.g. `{ ...state, mute: { ...state.mute, [key]: ... } }` — `rifffs`
and every other untouched top-level field keep their existing reference). No
custom equality function is needed for this migration's selectors.

## Migration

Each of the four components currently does `const state = useAppState()` and
then reads several distinct fields off it. Each becomes several individual
`useAppSelector(...)` calls, one per field actually read — e.g.
`StemWaveformRow.tsx`'s `const state = useAppState()` followed by reading
`state.rifffs[groupId]`, `state.mute[key]`, `state.vol[key]`,
`state.fadeIn[groupId]`, `state.fadeOut[groupId]`, `state.volumeDragMode`
becomes six separate `useAppSelector` calls, each bailing out independently.
This is more verbose than one broad `useAppState()` read, but that verbosity
is the whole point — it's what lets each field's changes stay isolated from
the others.

`dispatch` itself (`useDispatch()`) is unaffected — it already comes from a
separate, stable context (`DispatchCtx`) and was never part of this problem.

## Testing

This project has no React component-rendering test infrastructure at all
(no `@testing-library/react`, no jsdom/happy-dom test environment) — matches
this codebase's documented convention that React components are verified via
typecheck + lint + manual walkthrough, not direct rendering tests. Adding
that infrastructure is out of scope for this fix; the design instead splits
testable-as-pure-logic from React-dependent wiring:

**Unit-tested** (`StoreContext.test.ts`, a new file — no test file exists
for this module today), covering the store bridge as plain, React-free
pub-sub logic:

- `subscribeToState` registers a listener that fires when the state mirror
  changes, and the returned unsubscribe function stops further notifications.
- `getStateSnapshot` returns the current mirrored state.
- Both are exported from `StoreContext.tsx` (alongside the existing hook
  exports) specifically so `StoreContext.test.ts` can call them directly
  with plain listener spies — no React rendering involved. There's no
  standalone "publish" function to test separately; the only way the
  mirror's value changes is via `StoreProvider`'s own render-body
  assignment, which is exercised by the same manual walkthrough that
  verifies the rest of `StoreProvider`.

**Not unit-tested, verified by manual walkthrough** (matches existing
convention): `useAppSelector` itself (thin wiring around
`useSyncExternalStoreWithSelector`, a well-tested React-maintained
primitive — the risk surface here is the bridge feeding it, which *is*
tested, not the hook's own plumbing) and the four component migrations.

## Manual verification checklist

Not automatable in this environment (no GUI interaction tooling):

1. On a project with a meaningful number of placed clips, drag a volume
   fader/fade handle on one clip while watching the rest of the timeline —
   other clips' rows should not visibly re-render/flicker.
2. Play back the project and confirm visuals feel responsive (the original
   complaint this work responds to) — this is the primary success criterion,
   though "feels responsive" is inherently subjective without a profiler in
   this environment.
3. Confirm mute/volume/fade/select interactions on the four migrated
   components still work correctly and stay in sync with the rest of the UI
   (Inspector, TransportBar) — no stale-value regressions from the
   selector migration.
4. Confirm undo/redo still works correctly across all four components'
   interactions — the migration must not affect the existing
   dispatch/history pipeline in any way.
