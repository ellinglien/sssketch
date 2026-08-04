# Tiled Clip Left-Handle Crop Trim

**Status:** approved, ready for implementation plan.

## Problem

Dragging a tiled/looped clip's LEFT resize handle already keeps the clip's right edge fixed —
`RESIZE_LEFT` (`src/renderer/src/state/store.ts`) atomically updates both `playedBars` (shrinks/
grows) and the rifff's own `startBar` (moves forward/backward by the same bar delta) in one
dispatch. But it never touches the clip's loop phase (`off[groupId]`, the group-level
`offsetSteps`), and playback (`PlaybackEngine.cpp`) maps an absolute bar position `P` to loop
content via `(P - startBar - offsetBars) mod barLength`. Moving `startBar` alone shifts that
mapping, so instead of the remaining pattern continuing exactly where it would have played
before, it restarts from its own beginning at the new boundary — cropping "1234" from the left
by one bar shows "1" again at the new start rather than "2" continuing into "234".

## Fix

`RESIZE_LEFT`'s existing bar delta already has a name in the current implementation
(`StemWaveformRow.tsx`'s `grow`: positive when the left handle is dragged left/extending
backward, negative when dragged right/cropping). Worked out by hand against a concrete 4-bar
example ("1234", `barLength=4`, `offsetSteps=0`, `startBar=0`) and verified both directions:

- **Crop from left by 1 bar** (`grow = -1`): `startBar` moves from 0 to 1 (per existing code).
  For the remaining content to read as "234" (not restart at "1"), `offsetSteps` must become
  `-1` bar's worth of steps (i.e. `offsetSteps_old + grow`, in bars, converted via the current
  `snapDiv`) — confirmed by direct substitution into the playback formula, bar-by-bar.
- **Extend left by 1 bar** (`grow = +1`): `startBar` moves from 0 to -1. The SAME formula
  (`offsetSteps_old + grow`) produces the newly-revealed bar showing "4" — the loop's own
  wraparound content, i.e. "41234" — matching what a continuously-looping pattern would show if
  you could see one more repeat before the original start. Confirmed by the same substitution.

Both directions are handled by one single rule: **`offsetSteps` changes by `grow` bars
(converted to grid steps via the clip's current `snapDiv`), in the OPPOSITE direction to
`startBar`'s own change** (`startBar` moves by `-grow`, `offsetSteps` moves by `+grow` — their
sum, `startBar + offsetBars`, stays invariant, mod `barLength`, which is exactly the algebraic
condition for "the same absolute bar position keeps showing the same loop content").

## Scope

- **Only `RESIZE_LEFT`** (the reducer action) and its one dispatch site
  (`StemWaveformRow.tsx`'s `handleLeftResizeStart`) change. `RESIZE_LEFT` gains a new field on
  its action payload, `offsetSteps: number` — the new absolute value to write into
  `off[groupId]`, computed by the dispatch site the same way it already computes `finalStartBar`
  (using the same `grow` it already tracks).
- **Right-edge resize is unaffected.** `startBar` never moves for a right-edge drag (only
  `playedBars` changes via `SET_PLAYED_BARS`), so by the same invariant (`startBar + offsetBars`
  constant), `offsetBars` doesn't need to move either — already correct today, confirmed by the
  same derivation with `deltaStartBar = 0`.
- **One-shot/recorded clips are unaffected.** They use `trimStartSec`/`trimEndSec` directly
  (`CollapsedRifffRow.tsx`, `oneShotResize.ts`), which is inherently crop-correct by
  construction — there's no loop-phase concept for a single non-tiling sample, so nothing here
  applies to them.
- **Only the group-level offset** (`off[groupId]`) is touched — not any per-stem offset override
  (`off[stemKey(groupId, slot)]`) an individual stem might have been separately, deliberately
  tuned to. `RESIZE_LEFT` already only ever touched group-level `playedBars`/`startBar`, never
  per-stem fields, so this keeps the same scope.
- No native engine or IPC changes — `offsetSteps` already flows through the existing
  `buildEngineProject.ts` → native playback pipeline; this only changes what value gets written
  to it from the renderer's own reducer.
- `off[groupId]` is already stored unclamped (existing `SET_OFFSET_STEPS` doc comment: "a stem's
  true downbeat can legitimately be many bars into its own audio"), so the new value from this
  formula (which can go negative, or beyond `barLength`) needs no new clamping — the native side
  already wraps it into `[0, barLength)` at read time (`PlaybackEngine.cpp`'s existing
  `std::fmod` + negative-correction on `rawOffsetBars`).

## Testing

`RESIZE_LEFT`'s reducer case gets new unit test coverage in `store.test.ts` (or wherever its
existing tests live) confirming: given a starting `off[groupId]` value and a `RESIZE_LEFT`
dispatch with a known `bars`/`startBar`/`offsetSteps`, the resulting state has all three fields
updated together in one atomic action (matching the existing "one undo step, not two"
invariant). `StemWaveformRow.tsx`'s `handleLeftResizeStart` itself isn't unit-tested (matches
this codebase's existing convention: drag-handler wiring in React components is verified by
manual walkthrough, not automated — see CLAUDE.md's own testing-conventions section), so the
plan's own manual-verification step should include dragging a tiled clip's left handle both
directions and confirming the audible/visible content continues rather than restarting.
