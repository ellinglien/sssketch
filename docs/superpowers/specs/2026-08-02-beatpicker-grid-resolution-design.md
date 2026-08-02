# Beat Picker Grid Resolution Design

## Background

`BeatPicker.tsx`'s clickable beat grid is hardcoded to quarter-note resolution:
`totalBeats = rifff.barLength * 4`, one clickable position per quarter-note beat, regardless
of the arranger's own global snap-grid setting (`state.snapIdx` / `SNAP_DIVS = [4, 8, 16, 32]`
in `store.ts`, the same "snap 1/N" control already exposed in `TransportBar.tsx`). A user
picking a downbeat that actually falls between two quarter notes (e.g. an eighth-note offset)
has no way to select it — the nearest available click lands on the wrong beat.

Notably, the underlying offset math this feeds — `offsetStepsForBeatIndex` and
`rotationSecondsForStem` (`selectors.ts`) — already takes `snapDiv` as a parameter and
already handles a fractional `beatIndex` correctly (it's a `Math.round` over a real-valued
formula, not an integer-only computation). The gap is entirely in `BeatPicker.tsx`'s own grid
generation, which never offers a fractional `beatIndex` to click in the first place. This
design closes that gap by deriving the grid's resolution from the same global snap setting,
rather than introducing a new, separate resolution control.

## Grid resolution

`snapDiv = SNAP_DIVS[state.snapIdx]` (already read in `BeatPicker.tsx`). Define
`subdivisionsPerBeat = snapDiv / 4` (an integer for every value in `SNAP_DIVS`: 1, 2, 4, or
8) and `totalSubdivisions = totalBeats * subdivisionsPerBeat`, where `totalBeats` itself
stays exactly as it is today (`rifff.barLength * 4`) — it remains the musically meaningful
"quarter notes in this loop" count used for the label (see "Labels" below), while
`totalSubdivisions` becomes the new clickable-grid density.

The grid-rendering loop (`Array.from({ length: totalBeats }, ...)`, currently ~line 1000)
changes to iterate `totalSubdivisions`. For subdivision index `i` (`0..totalSubdivisions-1`),
the corresponding fractional beat index is `i / subdivisionsPerBeat`. That value is what gets
passed to `pickBeat()` — `pickBeat`'s own body is untouched, since it already just forwards
`beatIndex` into `offsetStepsForBeatIndex(beatIndex, snapDiv)` and
`rotationSecondsForStem(steps, snapDiv, s)`, both of which handle the fractional input
correctly today with no code change.

At the default snap setting (`snapIdx = 2`, i.e. `snapDiv = 16`), `subdivisionsPerBeat = 4`,
so a 2-bar rifff (today: 8 clickable positions) becomes 32. At `snapDiv = 4` (coarsest
setting), `subdivisionsPerBeat = 1` and the grid is identical to today's behavior.

## Highlighting the current pick

Today: `currentBeat = Math.round((-currentSteps * 4) / snapDiv)`, compared against each
button's (always-integer) `beatIndex` for the highlight. With fractional `beatIndex` values
in play, comparing floats for equality is fragile. Since one `offsetSteps` unit is, by
definition, exactly one `1/snapDiv`-of-a-bar increment — the same unit as one subdivision —
the highlighted subdivision index is simply `Math.round(-currentSteps)`, compared directly
against the integer loop variable `i`, not against the derived fractional `beatIndex`. No
float-equality comparison anywhere in the new code.

## Tap-along (spacebar downbeat marking)

`markDownbeatRef.current()` (~line 519) independently computes its own beat index from
elapsed free-play time, at the same hardcoded quarter-note resolution
(`beatsInLoop = rifff.barLength * 4`). This is updated to match the grid's resolution exactly
— `beatsInLoop` becomes `totalSubdivisions`, the resulting `subdivisionIndex` is divided by
`subdivisionsPerBeat` before being passed to `offsetStepsForBeatIndex`, mirroring the click
path. Without this, tapping along would stay locked to quarter notes while clicking gained
finer resolution, which would be an inconsistent, confusing split between the two input
methods for the same picker.

## Preview playhead sweep

The sweep effect (~line 397, `totalBeats * ...` converting a `previewingBeat` value into a
seconds offset for the animated playhead line) requires no change — it already computes
`riffDurationSec / totalBeats` and multiplies by `previewingBeat`, and both remain correct
unmodified now that `previewingBeat` can hold a fractional value (it's a continuous
time-position calculation already, not an integer-indexed one).

## Labels

- Per-button tooltip (`title={\`beat ${beatIndex + 1}\`}`): unchanged expression — now
  naturally renders fractional values (e.g. "beat 3.5") since `beatIndex` itself is
  fractional. No new formatting logic.
- Footer text (`loop begins at beat ${currentBeat + 1} of ${totalBeats}`): `currentBeat`
  changes from an integer subdivision-of-4 count to the same fractional-quarter-note value
  used for the tooltip (`subdivisionIndex / subdivisionsPerBeat`), and `totalBeats` stays the
  unchanged quarter-note-count denominator — so this reads e.g. "beat 3.5 of 8", staying
  musically meaningful rather than exposing raw subdivision counts to the user.

## Visuals

Gridline styling keeps its existing two-tier look: bar boundaries (`i % snapDiv === 0`) get
the strong border (`--ra-border-strong`); every other subdivision line — including the new
in-between quarter-note-beat lines — uses the existing minor-gridline style
(`--ra-grid-minor`), same as today. No new visual tier is introduced; this stays a resolution
change, not a redesign of the picker's look.

## Testing

The math this depends on (`offsetStepsForBeatIndex`, `rotationSecondsForStem`) is already
fully unit-tested in `selectors.test.ts` and is not modified by this change — those tests
continue to pass unmodified, and no new test cases are needed there since fractional-input
correctness is exactly what those tests already exercise indirectly (their existing behavior
IS the fractional-safe behavior this design relies on).

`BeatPicker.tsx` itself has no automated test today (this codebase's established convention:
React components are verified via typecheck + lint + manual walkthrough, not direct
component tests — see `CLAUDE.md`'s Testing Conventions). This change follows that same
convention; no new test infrastructure is introduced for it.

## Manual verification checklist

1. At the default snap setting, a 2-bar rifff's beat picker shows 32 clickable positions
   instead of 8; clicking one and confirming (bake) produces the expected offset.
2. Cycling the transport bar's snap-grid button to `1/4` while the beat picker is open (or
   before opening it) shrinks the grid back to one position per quarter note, matching
   today's current behavior exactly.
3. The highlighted "current pick" gridline lines up with whichever subdivision was actually
   picked, at every snap setting — not just the nearest quarter note.
4. Tapping along with Space (free-play + mark) can now land on and correctly mark a
   half/quarter/eighth-subdivision position, not just whole quarter-note beats.
5. The footer text ("loop begins at beat X of Y") shows a fractional beat number when a
   non-quarter-note position is picked, and stays a whole number when a quarter-note position
   is picked.
6. Baking a fractional-beat pick (Inspector "re-pick beat" → confirm) produces audio that
   audibly starts on the correct beat, not rounded to the nearest quarter note.
7. Bar-boundary gridlines are still visually distinct (strong border) from the finer
   in-between lines at every snap setting.
