# Timeline Zoom (and Removing Compact Mode) Design

## Background

The arranger timeline's horizontal scale (`PPB`, pixels-per-bar) is a hardcoded module constant (`24`, in `src/renderer/src/components/Ruler.tsx`), imported directly by six files (`Ruler.tsx` itself, `App.tsx`, `CollapsedRifffRow.tsx`, `Playhead.tsx`, `CompactRifffBlock.tsx`, `RifffBlockRow.tsx`, `StemWaveformRow.tsx`). There's no zoom today — the only alternate horizontal scale is a second hardcoded constant, `COMPACT_PPB` (`2`), used only in the arranger's separate `'compact'` view mode. Horizontal panning already works via the timeline's native `overflowX: 'auto'` scroll container (`scrollContainerRef` in `App.tsx`).

This adds continuous, DAW-style horizontal zoom, and removes `'compact'` mode entirely — once zoom covers "see more of the timeline at once," a separate, deliberately-simplified fixed-scale mode is redundant.

## Zoom

`Cmd+scroll` (not plain scroll) zooms the timeline horizontally, matching the verified real-world convention across major DAWs (Ableton Live: `Cmd/Ctrl+scroll` = horizontal zoom, `Option/Alt+scroll` = vertical zoom, plain scroll = normal scroll; FL Studio: `Ctrl+scroll` = horizontal zoom; Logic Pro: `Option+Cmd+scroll` = horizontal zoom) rather than the opposite (plain scroll = zoom), which no major DAW actually uses. Plain scroll keeps doing exactly what it does today — nothing about existing pan behavior changes.

**Cursor-anchored:** whichever bar is under the mouse cursor stays under the cursor as the zoom level changes, matching Ableton's own behavior. The `onWheel` handler computes the bar under the cursor using the *current* PPB before applying the zoom change, then adjusts the scroll container's `scrollLeft` after the multiplier updates so that same bar lands back under the cursor at the *new* PPB.

**Range:** the zoom multiplier is clamped to `[0.25, 4]` (6px/bar to 96px/bar at the base 24px/bar), applied as `zoom = clamp(zoom * (1 - deltaY * ZOOM_SENSITIVITY), MIN_ZOOM, MAX_ZOOM)` on each wheel tick.

**Reset:** `Cmd+0` resets the multiplier to `1.0` (the current default 24px/bar), matching the standard "reset zoom" convention used broadly across creative and browser apps.

**Not persisted:** the zoom multiplier is a viewing preference, not project data — it lives as plain `useState` in `StoreProvider` (`src/renderer/src/state/StoreContext.tsx`), alongside `pos`/`playing`, *not* in the undo-tracked main reducer. It resets to `1.0` on every app launch, same as `volumeDragMode` and the arranger mode itself already do (see their own "Not persisted" doc comments in `store.ts`).

## Architecture: making PPB reactive

A new `ZoomCtx` (React context) + `useZoom()` hook, following this codebase's existing pattern of small, single-purpose contexts (`PosCtx`, `PlayingCtx`, etc. in `StoreContext.tsx`) specifically to avoid forcing unrelated components to re-render on every state change. `useZoom()` returns the current effective PPB (`24 * zoomMultiplier`).

Every one of the six files currently doing `import { PPB } from './Ruler'` switches to `const ppb = useZoom()` instead. The underlying `PPB` constant in `Ruler.tsx` becomes the *base* value the zoom multiplier is applied to, no longer imported directly anywhere else.

## Removing compact mode

`'compact'` is a full `ArrangerMode` value (`store.ts`) that swaps in an entirely separate, simplified rendering path (`CompactRifffBlock.tsx` — small fixed-size tiles, no waveform/envelope/resize-handle detail) instead of just being a smaller version of the normal clip view. Removing it:

- **`src/renderer/src/state/store.ts`**: `ArrangerMode` narrows from `'normal' | 'compact' | 'sketch'` to `'normal' | 'sketch'`.
- **`src/renderer/src/state/selectors.ts`**: `nextArrangerMode` (driven by `ARRANGER_MODE_ORDER`, currently `['normal', 'compact', 'sketch']`) simplifies to a 2-state toggle — `normal <-> sketch`, staying on `normal` when `isSketchEligible(state)` is false, same as today's "never land on an unreachable mode" behavior, just with one fewer state to cycle through.
- **`src/renderer/src/components/CompactRifffBlock.tsx`**: deleted entirely.
- **`src/renderer/src/components/RifffBlockRow.tsx`**: the `compact` local (`state.mode === 'compact'`), its early-return branch to `<CompactRifffBlock>`, and its own `ppb = compact ? COMPACT_PPB : PPB` ternary are all removed — this file's `ppb` becomes unconditionally `useZoom()`.
- **`src/renderer/src/App.tsx`**: the `ppb = state.mode === 'compact' ? COMPACT_PPB : PPB` and `ghostRowHeight = state.mode === 'compact' ? COMPACT_ROW_HEIGHT : GHOST_ROW_HEIGHT` ternaries both collapse to their normal-mode branch unconditionally (`ppb` becomes `useZoom()`); the now-unused `COMPACT_ROW_HEIGHT` import is removed.

No other feature (sketch mode, DAW-mode channels, plugin chains, LORE import, etc.) reads or branches on `'compact'` — confirmed by grep across the renderer source; this is a self-contained removal.

## Testing

The zoom math — multiplier clamping at `[0.25, 4]`, the cursor-anchor scroll-compensation calculation, and reset-to-`1.0` — is extracted into a small pure-function module (matching this codebase's established convention: see `oneShotResize.ts`, `dragGrabOffset.ts`) with full unit test coverage. The actual `onWheel`/`Cmd+0` keyboard wiring isn't covered by an automated test (no React interaction-test harness exists in this codebase yet) — same precedent as every other drag/gesture feature built this session; verified manually instead.

Compact-mode removal is verified structurally: `tsc --noEmit` and `eslint` will catch any leftover reference to the deleted `ArrangerMode` value, `CompactRifffBlock` import, or now-dead `compact`/`COMPACT_PPB`/`COMPACT_ROW_HEIGHT` locals, and the full `vitest` suite confirms nothing else broke.

## Manual verification checklist

Not automatable in this environment (no GUI interaction tooling):
1. `Cmd+scroll` over the timeline zooms in/out smoothly; the bar under the cursor visibly stays under the cursor throughout.
2. Plain scroll (trackpad or scrollbar) still pans exactly as before — no change in feel.
3. `Cmd+0` snaps back to the default zoom level from any zoomed-in/out state.
4. Zoom stops changing at the min/max bounds rather than continuing indefinitely or glitching.
5. Tab (or the TransportBar mode button) now cycles only between Normal and Sketch mode — Compact is gone from the cycle entirely.
6. Every clip interaction (drag, resize, mute, envelope, one-shot trim/stretch) still works correctly at multiple zoom levels, not just the default.
7. Zoom resets to default after quitting and relaunching the app (confirming it's correctly not persisted).
