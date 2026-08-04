# Live Volume/Fade Fast Path (bypassing full project reload)

**Status:** approved, ready for implementation plan.

## Problem

The just-shipped live-drag-preview feature (see `docs/superpowers/specs/
2026-08-04-live-drag-preview-design.md`) makes volume/fade changes audible live during a drag by
re-running `buildEngineProject` + a full `engineLoadProject` reload whenever `state.dragVol`/
`dragFadeIn`/`dragFadeOut` change, throttled to at most once per animation frame. Manual testing
confirmed this actually works functionally, but also confirmed a real, audible problem: a full
reload rebuilds the native engine's entire scheduling state from scratch every time (a full
`EngineProject` copy, `channelGroups` rebuild, scratch-buffer resize) — even though only one
number changed. At up to ~60 reloads/second during a fast drag, this causes genuine audio
glitching and visible UI stutter, confirmed directly by listening/watching, not theoretical.

Waveform rendering resolution was considered and ruled out as the cause — the glitching tracks
with the audio pipeline's own per-drag-step cost, not visual detail level.

## Fix

A new, minimal IPC path updates just the live value, bypassing `buildEngineProject`/full project
reload entirely for volume and fade specifically (length/crop remain out of scope, as in the
original live-drag-preview design — they stay commit-on-release only).

### Native: `LiveParamOverrides`

New files `native-engine/Source/LiveParamOverrides.h`/`.cpp`. Holds three independently-published
maps — mirroring `PlaybackEngine`'s own already-proven `published` field pattern exactly (a plain
`std::shared_ptr<const std::unordered_map<juce::String, float>>` per field, accessed only via
`std::atomic_load_explicit`/`std::atomic_store_explicit` — not `std::atomic<std::shared_ptr<T>>`,
confirmed unavailable in this project's libc++ during the live-drag-preview work):

- `volume`, keyed by `stemKey` (matching `EngineStem::stemKey`, already on the wire format).
- `fadeIn`/`fadeOut`, each keyed by `groupId` (matching `EngineRifff::groupId`, already on the
  wire format).

Message-thread API: `setVolumeOverride(stemKey, value)`, `setFadeInOverride(groupId, value)`,
`setFadeOutOverride(groupId, value)` (each rebuilds a small new map — 1-8 entries typically,
matching however many stems are in the dragged rifff — and publishes it; dramatically cheaper
than a full project reload even with the per-call allocation, since nothing about the rest of the
project is touched), plus `clearAll()` (publishes three empty maps).

Audio-thread API: `volumeFor(stemKey)`, `fadeInFor(groupId)`, `fadeOutFor(groupId)`, each
returning `std::optional<float>` — `std::nullopt` means "no override, use the snapshot's own
committed value." One atomic load + one hash lookup each, called from inside `renderBlock`'s
existing per-stem/per-rifff loop.

`PlaybackEngine` owns one `LiveParamOverrides` instance. `renderBlock()`'s stem loop resolves
`effectiveVolume = overrides.volumeFor(stem.stemKey).value_or(stem.volume)` (replacing the
existing direct `stem.volume` reads in both the one-shot and tiled-loop branches), and
`fadeConfig`'s construction resolves `effectiveFadeInBars`/`effectiveFadeOutBars` the same way
from `rifff.groupId` before building `FadeConfig`.

### IPC: `set-live-param`

New message type, `IpcServer.cpp`: `{ type: 'set-live-param', payload: { field: 'volume' |
'fadeIn' | 'fadeOut', key: string, value: number | null } }` (`value: null` clears that one key —
kept for symmetry/testability, though the renderer's own drag handlers never need to send it, per
the handoff design below). Routes directly to the matching `LiveParamOverrides` setter — never
touches `EngineProject`/`setProject()` at all.

`IpcServer.cpp`'s existing `load-project` handler gains one line: right after `engine.setProject
(project)`, calls `engine.liveOverrides().clearAll()`. This is the ENTIRE clearing mechanism —
see "Handoff at drag-end" below for why the renderer never needs to explicitly clear anything.

Electron main (`src/main/index.ts`)/preload (`src/preload/index.ts`)/`engineClient.ts` gain a
`window.rifffApi.engineSetLiveParam(field, key, value)` bridge, following the exact existing
pattern every other `engine*` IPC call already uses (e.g. `engineSetPosition`).

### Renderer wiring

`StemWaveformRow.tsx`/`CollapsedRifffRow.tsx`'s volume/fade drag handlers (already dispatching
`SET_DRAG_PREVIEW`/`SET_DRAG_PREVIEW_GROUP_VOLUME` on every mousemove, for the visual
preview/sibling-sync) additionally call a new rAF-coalesced `scheduleLiveParamSync` helper on
every mousemove — reusing the exact `pendingRef`/`dirtyRef` coalescing pattern already built and
proven for `StoreContext.tsx`'s own full-reload effect (see the live-drag-preview design's own
"Fix, part 3"), so a fast mouse (which can fire mousemove well above display refresh rate) still
caps engine-bound sends at ~60Hz. `SET_DRAG_PREVIEW` itself is untouched — it still drives the
visual preview and sibling-row sync exactly as before; this is a second, independent thing each
mousemove now also does.

`StoreContext.tsx`'s full-reload effect (the one throttled in the live-drag-preview plan's Task 7)
loses `state.dragVol`/`state.dragFadeIn`/`state.dragFadeOut` from its dependency array — they no
longer need to trigger a full reload, since the lightweight path now carries live audio instead.
`state.leftCrop` (the Task 7 bug fix) and the length/crop drag preview fields' continued absence
are both unaffected — this section only removes the three fields that the new fast path
supersedes. The committed fields (`state.vol`, `state.fadeIn`, `state.fadeOut`) stay in the
dependency array exactly as before — a drag's final commit still triggers exactly one full
reload, same as any other edit.

`buildEngineProject.ts`'s existing preference for `state.dragVol`/`state.dragFadeIn`/
`state.dragFadeOut` over the committed value (from the live-drag-preview plan's Task 6) is left
in place, not reverted — harmless now that nothing triggers a reload from those fields directly,
and still correct/useful as a fallback if a full reload happens to fire for an unrelated reason
while a drag is in progress (e.g. project bpm changes mid-drag).

### Handoff at drag-end (no explicit clear needed)

Worked through carefully to avoid a glitch at the exact moment of mouse release: if the renderer
explicitly cleared the live override the instant a drag ended, there'd be a real gap — the
commit's own full reload takes a moment (async IPC round-trip via the now-unchanged full-reload
effect) to land, and during that gap the engine would fall back to the OLD pre-drag committed
value, producing an audible blip back-and-forth right at release.

Instead: the live override is left in place, holding the exact final dragged value, for as long
as it takes the natural full reload (already guaranteed to fire, since `SET_VOLUME`/`SET_FADE_IN`/
`SET_FADE_OUT` are already in the full-reload effect's dependency array) to land and supersede it
via `clearAll()`. Since the override and the eventual reload always agree on the value by
construction, the handoff between them is inaudible — there is no window where the wrong value is
heard. This also makes the mechanism robust against undo/paste/anything else that changes
committed volume: those paths trigger a full reload too, which clears stale overrides as a matter
of course, not something each caller has to remember to do individually.

### Explicitly out of scope

- Length/crop (`playedBars`/`leftCropBars`) live push — unchanged from the live-drag-preview
  design's own scope decision; still commit-on-release only.
- Reworking `PlaybackEngine`'s existing `shared_ptr`-based project-snapshot mechanism itself
  (confirmed correct and stress-tested in the prior plan) — this fast path is additive, a
  parallel lookup `renderBlock` consults, not a change to how the project snapshot itself works.
- The previously-identified `useAppState()` broad-re-render-fan-out risk (visible UI stutter) —
  real per this same manual walkthrough, but a separate, renderer-only concern from the audio
  glitching this spec fixes. Worth its own follow-up if it's still noticeable once the audio
  glitching is gone (much of the reported "blinking"/sluggishness may simply have been masked by
  the same overloaded full-reload mechanism this spec removes from the hot path).

## Testing

- Native: new `LiveParamOverridesTests.cpp` — set/get/clear for each of the three maps
  independently, confirms `nullopt` when no override is set, confirms `clearAll()` empties all
  three.
- Native: `PlaybackEngineTests.cpp` gains cases confirming `renderBlock()` actually prefers a live
  override over the snapshot's own committed value when present, and falls back correctly when
  absent — mirroring the existing volume/fade tests' own fixture patterns.
- Native: a concurrent stress test mirroring the existing `setProject`/`renderBlock` one (same
  file), this time hammering `setVolumeOverride`/`renderBlock` concurrently, to the same standard
  of rigor the project-snapshot hardening was held to.
- Renderer: no new component tests, per this codebase's own convention (React components verified
  via typecheck/lint + manual walkthrough). The new `engineSetLiveParam` bridge function itself
  follows an existing, already-tested pattern (`engineSetPosition` etc.) with no new logic to
  unit-test on the TS side beyond what typecheck already covers.
- Manual walkthrough: repeat the live-drag-preview plan's own audio-glitch checks (live volume/
  fade dragging while playing, sustained fast dragging) and confirm the glitching reported in this
  round is actually gone, not just reduced.
