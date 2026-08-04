# Live Drag Preview: Shared State + Safe Live Volume/Fade Push

**Status:** approved, ready for implementation plan.

## Problem

Two related complaints trace back to the same root cause. `StemWaveformRow.tsx`/`CollapsedRifffRow.tsx`
hold every drag's in-progress preview value (volume, fade-in, fade-out, played-bars/length,
left-crop) in that component instance's own local `useState` — visible only to the row being
dragged, committed to shared store state (`state.vol`, `state.fadeIn`, `state.fadeOut`,
`state.playedBars`, `state.leftCrop`) only on mouse-up. Two symptoms follow:

1. **Sibling stems in an expanded rifff don't track a left/right handle drag live** —
   `playedBars`/`leftCropBars` are already GROUP-level (shared across every stem in a rifff),
   but since the live preview is per-component local state, only the dragged row's own render
   sees it mid-drag; other stems in the same group only "catch up" once the mouse-up dispatch
   lands.
2. **Volume changes don't reach the actual playing audio until mouse-up** — same mechanism:
   nothing pushes the in-progress value anywhere until the commit dispatch, so there's nothing
   for the engine-sync effect in `StoreContext.tsx` to react to mid-drag.

Fixing (1) is a pure rendering change: lift the preview value out of local state into
something every same-group component instance can read. Fixing (2) additionally requires
pushing that live value to the native engine while the project is playing — which surfaces a
second, independent, more serious problem:

**`PlaybackEngine::setProject()` has no cross-thread synchronization.** It reassigns
`currentProject` (a plain member) and rebuilds `channelGroups` (a map of pointers *into*
`currentProject`'s own vectors) on the message thread, with no lock or atomic of any kind,
while `renderBlock()` reads both directly on the real-time audio thread. At today's call
frequency (once per discrete user edit) this is a narrow, apparently-never-hit race window.
Pushing volume/fade changes live during a drag would call this same path at up to ~60Hz,
exercising that race far harder than anything exercised so far. This exact risk is already
flagged, unresolved, in `native-engine/PHASE3_FINDINGS.md:370-379` ("audibly choppy playback
under rapid volume/mute slider dragging... not confirmed, also not ruled out").

## Fix, part 1: shared live-drag-preview state (renderer)

New `AppState` fields, each mirroring an existing committed field's shape exactly (same key
type — stem-key for volume/fades, groupId for length/crop):

```ts
dragVol: Record<string, number>
dragFadeIn: Record<string, number>
dragFadeOut: Record<string, number>
dragPlayedBars: Record<string, number>
dragLeftCropBars: Record<string, number>
```

One generic action replaces what would otherwise be five near-identical ones:

```ts
| {
    type: 'SET_DRAG_PREVIEW'
    field: 'volume' | 'fadeIn' | 'fadeOut' | 'playedBars' | 'leftCropBars'
    key: string
    value: number | undefined // undefined clears the preview for that key
  }
```

Reducer maps `field` to the corresponding `drag*` slice, sets or deletes `key` in it. Added to
`TRANSIENT_ACTION_TYPES` (`history.ts`) — every mousemove during a drag dispatches this, and it
must never create an undo checkpoint (matches this codebase's existing rationale for why the
current mouse-up-only commit dispatches aren't transient: they're real edits; this one never is).

`StemWaveformRow.tsx`/`CollapsedRifffRow.tsx`: each of the five existing local `useState` preview
variables (`dragVolume`, `dragFadeIn`, `dragFadeOut`, `dragPlayedBars`, `dragLeftCropBars`) is
replaced by dispatching `SET_DRAG_PREVIEW` on every `mousemove` (inside each drag handler's
existing `onMove` callback, replacing the `setDragX(...)` call 1:1) and reading the value back
via `useAppSelector((s) => s.dragVol[stemKey] ?? s.vol[stemKey] ?? 1)` (etc.) instead of
`dragVolume ?? volume`. On drag-end: dispatch the existing commit action exactly as today
(`SET_VOLUME`/`SET_FADE_IN`/.../`SET_LEFT_CROP_BARS`), then dispatch `SET_DRAG_PREVIEW` with
`value: undefined` to clear the preview, so the committed value takes over cleanly with no stale
preview lingering.

Because these become real store reads instead of component-local state, every `StemWaveformRow`
instance sharing a `groupId` (i.e. every stem in the same expanded rifff) sees the same live
`dragPlayedBars[groupId]`/`dragLeftCropBars[groupId]` the instant it changes — fixing symptom
(1) with no additional plumbing beyond the state being shared in the first place.

## Fix, part 2: harden `PlaybackEngine`'s project handoff (native)

Mirrors `ChannelChainRegistry`'s existing atomic-pointer publish pattern
(`ChannelChainRegistry.h`/`.cpp`) exactly — this is applying an established, already-proven
convention in this codebase to a struct that never got it, not inventing new architecture.

`channelGroups` holds pointers into `currentProject.rifffs`, so the two can't be
independently atomic-swapped (that would reintroduce a race between the two swaps landing at
different times) — they're bundled into one immutable snapshot:

```cpp
struct ProjectSnapshot
{
    EngineProject project;
    std::map<juce::String, std::vector<const EngineRifff*>> channelGroups; // points into project.rifffs above, same lifetime

    // Per-channel accumulation scratch for renderBlock() -- moved here from being
    // PlaybackEngine's own members (PlaybackEngine.h:69-83) because setProject()
    // currently resizes them (sized/populated once per setProject(), one entry
    // per channelGroups entry) while renderBlock() concurrently reads/writes
    // them on the audio thread -- a SECOND instance of the exact same
    // unsynchronized-handoff race this whole fix exists to close, previously
    // unnoticed because it's less obviously connected to `currentProject` than
    // `channelGroups` is. `mutable`: renderBlock() reads `published` as
    // `const ProjectSnapshot*` but still needs to write into this reused
    // scratch space every block -- identical "logically const, physically
    // caching" reasoning PlaybackEngine.h already uses for these exact fields
    // today, just relocated. Still race-free: only one PlaybackEngine
    // instance-thread pairing ever touches a given published snapshot's
    // scratch space (the live audio thread between setProject calls, or
    // RenderExport's own single-threaded offline instance -- never both, per
    // renderBlock's own existing doc comment).
    mutable std::vector<std::vector<float>> scratchChannelL, scratchChannelR;
    mutable std::vector<juce::String> scratchChannelIds;
};
```

`PlaybackEngine` replaces its `EngineProject currentProject`, `std::map<...> channelGroups`, and
`scratchChannelL/R/Ids` members with `std::atomic<const ProjectSnapshot*> published`.

- `setProject()` (message thread): build a brand-new `ProjectSnapshot` on the heap (`new
  ProjectSnapshot{...}`), populate `project`, rebuild `channelGroups` pointing into *this new*
  snapshot's own `project.rifffs` (never the old one), `published.exchange(next)`, then hand the
  returned old pointer to a detached thread for deletion — `std::thread([old]() { delete old;
  }).detach();`, copied verbatim from `ChannelChainRegistry.cpp:57` (same reasoning: the audio
  thread's read is bounded/fast, so by the time the detached thread actually runs, the audio
  thread has certainly already moved on to the new pointer).
- `renderBlock()` (audio thread): `const auto* snap = published.load(std::memory_order_acquire);
  if (!snap) return;` once, at the top of the function; every subsequent reference to
  `currentProject`/`channelGroups` throughout the rest of `renderBlock` reads through `snap->`
  instead. One load per block, never mutates, matches `ChannelChainRegistry::chainFor`'s own
  documented convention ("never blocks, never allocates").
- `currentProjectForExport()` (message-thread-only, used by `RenderExport.cpp`): reads through
  the same `published` pointer — safe either way since export never runs concurrently with live
  playback, but kept consistent rather than leaving a second, different way to read the project.

Existing `PlaybackEngineTests.cpp` tests call `setProject` then `renderBlock` synchronously on
one thread — behavior must be unchanged for all of them (this refactor changes *how* the data is
stored, not what `renderBlock` computes from it). New test: a stress test that spins a background
thread calling `setProject` in a tight loop while the main test thread calls `renderBlock` in a
tight loop for some bounded duration, and asserts no crash — this can't prove the absence of a
race the way a thread-sanitizer build could, but it's the concrete, automatable minimum that
exercises the exact scenario the drag feature will hit, matching this codebase's own convention
of writing a regression test for every found race (e.g. the `Transport::stop()` deadlock test).

## Fix, part 3: throttled live push (renderer, safe now that part 2 lands)

`StoreContext.tsx`'s existing engine-sync `useEffect` (the one that calls `buildEngineProject` +
`engineLoadProject` whenever `state.vol`/`state.fadeIn`/`state.fadeOut`/etc. change) gains
`state.dragVol`, `state.dragFadeIn`, `state.dragFadeOut` in its dependency array — **not**
`dragPlayedBars`/`dragLeftCropBars`, so a length/crop drag never pushes to the engine mid-drag
(avoids any audible scheduling jump while the position might be inside the tile being resized;
those two stay commit-only exactly as they are today). `buildEngineProject.ts`'s stem volume/fade
construction prefers the drag value when present: `volume: state.dragVol[key] ??
state.vol[key] ?? 1` (and equivalently for fades).

Actual sends are coalesced with `requestAnimationFrame` rather than firing on every dependency
change directly — a ref holds the latest state, the effect schedules at most one pending rAF
callback, and the callback (when it fires) reads the ref's *current* value rather than whatever
was captured at schedule time, so a burst of mousemove-driven dispatches between frames collapses
into a single flush of the latest value, capped at the display's own refresh rate regardless of
how fast the drag itself fires.

**Also fixed, found adjacent to this exact effect while tracing it:** `state.leftCrop` (the
*committed* value, not the new draft) is missing from this effect's dependency array today — a
real, pre-existing bug where a left-crop change doesn't sync to the engine at all, not even on
mouse-up. Small, directly in-scope fix alongside this work.

## Explicitly out of scope

- Live engine push for `playedBars`/`leftCropBars` (length/crop) — stays commit-on-mouse-up only,
  per the scheduling-jump risk noted above. Only the visual sibling-sync (part 1) applies to
  these two fields.
- A general "any future live-parameter" abstraction beyond volume/fade — YAGNI; the throttle and
  dependency-array wiring is specific to the two fields actually requested.

## Testing

- `store.test.ts`: `SET_DRAG_PREVIEW` reducer coverage — sets/clears each of the five `drag*`
  slices independently, confirms it never touches the corresponding committed field.
- `StemWaveformRow.tsx`/`CollapsedRifffRow.tsx`: no direct component tests, per this codebase's
  own convention — verified manually (playing back audio while dragging volume, and watching
  sibling stems track a length/crop drag live in the expanded view).
- Native: existing `PlaybackEngineTests.cpp` suite must pass unchanged (behavioral regression
  check), plus the new concurrent `setProject`/`renderBlock` stress test described above.
