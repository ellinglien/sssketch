# Shape Riff Technical Design and V1 Implementation Spec

**Status:** Implemented, and since extended well past this first slice. The fragment editor below
shipped first; Pitch (Transpose, Detune), Formant, Rate with Smooth and Raw, Reverse, per-stem
Rotate, Discover stem adding, the donor tray, and offline clip treatments ("interventions", baked
into a clip as one undo step) shipped after it on the same branch. Those later parts aren't
specified here beyond what the sections below say; the CHANGELOG's Unreleased section lists
them. The user-facing name is **EEEDIT**; the code keeps "Shape".

**Merged into master:** EEEDIT is always available (not behind the advanced features switch), its
preview swaps use the engine's swap dip, and its renders in `.shapes` are kept for good, since they
can't be rebuilt; only leftovers are cleaned (see CLAUDE.md).

Design and implementation reviews tightened atomic rendering, one-shot handling, source ownership,
provenance, gain restoration, keyboard capture, project-session identity, cleanup guarantees,
overwrite identity collisions, preview ownership, source-phase waveform display, late-result
cleanup, nearest-sample wrapping, and fractional output seam bounds. Live pointer feel and
listening QA remain manual validation items.

## Purpose

Shape Riff is a focused, non-destructive workspace for turning one existing rifff into a related
variation. It should make loops feel less block-like by allowing small changes _inside_ a rifff:
parts can enter late, leave early, fall silent briefly, move, repeat, reverse, or change pitch and
speed without replacing the complete musical state on bar one.

The intended experience is a small tape editor contained inside a single rifff, not a second song
timeline or a miniature general-purpose DAW.

## Musical problem

Several properties of the current rifff model can make music feel trapped in loops:

- changes tend to happen on bar one;
- switching rifffs replaces the complete musical state at once;
- all stems appear to share the same phrase length and repeat boundary;
- stems inherited unchanged between successive Endlesss rifffs retain the same internal
  performance;
- exact repetition makes transitions feel like adjacent blocks.

Cross Riffs already helps by blending stems from two rifffs. Shape Riff addresses the related
problem at a smaller scale: keep a rifff's identity while introducing deliberate exceptions into
individual stems.

Examples include a stem entering on bar three, a drum disappearing for one beat, the last hit
arriving late, a three-beat fragment repeating against a four-beat pulse, or a stem that was
unchanged in the original jam behaving differently in the second of two related rifffs.

## Entry and workspace

- Selecting exactly one rifff exposes an **Edit** action in the inspector. The workspace itself
  is called **Shape Riff**.
- Shape starts from a working copy. The source rifff remains untouched.
- The shelf remains visible so the shaped rifff can be auditioned against nearby rifffs quickly.
- Shelf preview and Shape playback have exclusive ownership: clicking a shelf rifff pauses Shape
  playback rather than mixing both previews together.
- The full song timeline does not need to remain visible. Whether Shape needs an explicit
  **Add to Timeline** action remains undecided; saving to the shelf is required.
- Saving creates a new rifff in the shelf by default rather than overwriting the source.
- The center-column stem-discovery controls from Cross Riffs should be available for adding or
  replacing material.
- Play/pause, tempo, undo, redo, solo, mute, whole-stem disable, and an original/edited A/B
  comparison should remain available.

## Editing model

Each stem is displayed as a waveform lane spanning the rifff. Editing operates on fragments of
that lane.

Initial editing vocabulary:

- **Split** — `Command-E` creates an edit boundary at the playhead or selection edge.
- **Move** — dragging moves a fragment within its stem lane.
- **Copy** — Option-drag copies a fragment elsewhere.
- **Duplicate** — `Command-D` places another copy directly after the selected fragment.
- **Disable** — `0` toggles the selected fragment's durable enabled state.
- **Reverse** — reverses the selected fragment.
- **Pitch** — transposes by semitones while preserving duration.
- **Rate** — changes playback speed and pitch together, changing the fragment's duration.

Selections and edit boundaries may use a musical grid, but must not be restricted to multiples
of four. Proposed snap choices are `BAR`, `BEAT`, `1/2`, `1/4`, `1/8`, and `OFF`. This permits
irregular interior repetition—such as duplicating a three-beat fragment—without introducing a
separate loop system.

### Durable fragment disable

The user-facing term is **Disable**, not region mute. Mute and Solo are temporary monitoring
controls elsewhere in the app; Disable is a saved musical decision.

Pressing `0` with one or more fragments selected toggles their disabled state. Disabled fragments
remain visible and visibly recede so their positions and contents can be understood and restored.
Pressing `0` again re-enables them. Whole-stem Disable uses the same durable concept while
preserving the fragment-level states underneath it.

This terminology intentionally differs from the older Arrange `muteRegions` proposal. Shape's
fragment state should not be presented as Mute even if some lower-level playback machinery can
eventually be shared.

### Monophonic lane behavior

The proposed default is one audible layer per stem lane. Moving or copying a fragment onto an
occupied region should replace or split the destination material rather than silently stacking
two copies and increasing volume. Layering should require another stem lane.

Exact collision, replacement, and fragment-length behavior still needs interaction design before
implementation.

## Pitch, rate, and sound character

Pitch and playback rate are separate controls:

- **Pitch** uses semitone values and preserves timing.
- **Rate** reads the source at a different speed. `1/2x` makes the material an octave lower and
  twice as long; `2x` makes it an octave higher and half as long. Initial quick actions should at
  least include `1/2x`, `1x`, and `2x`, with wider values available for extreme results.

Rate processing has two quality modes:

- **Smooth** uses high-quality, anti-aliased resampling.
- **Raw** deliberately uses crude or minimally interpolated sample reading so extreme rates retain
  the harsh, crispy, pitch-dependent aliasing associated with early tracker playback. This is not
  merely a static bitcrusher or sample-rate reducer applied afterward.

Changing a fragment's rate changes its visible duration. How that expansion interacts with later
fragments—overwrite, trim, or optional ripple—is an open interaction question and must be made
explicit rather than guessed during implementation.

### Later sound experiments

Two timing-preserving ideas are worth retaining for later exploration but are not part of the
initial feature commitment:

- **Rate Shape:** playback speed varies inside a selection while the source and destination
  endpoints remain fixed. Slowing down in one portion requires catching up elsewhere. Raw mode
  would make the aliasing pattern change with the instantaneous speed. Possible shapes include
  Brake, Catch Up, Dip, Surge, Ratchet, and Wobble.
- **Raw Clock:** a variable sample-and-hold clock creates a moving staircase texture while source
  progression and overall duration remain fixed. It can optionally be linked to Pitch or Rate.

The order of Pitch and Raw Rate processing produces different sounds, but processing-order UI is
also deferred. (Pitch, Rate, Smooth/Raw and Formant themselves have shipped; Rate Shape, Raw Clock
and processing order have not.)

## Non-destructive source and reset behavior

Original audio is immutable.

- Splits, positions, copies, disabled states, reverse, pitch, and rate are stored as an edit
  recipe referencing the source audio.
- Preview processing should be real-time where practical.
- If playback requires materialization, it creates a separate derived cache file and never
  overwrites or replaces the source master.
- Export may render the final result once at full quality.
- Repeated editing must not repeatedly re-encode or degrade the source.

Every lane provides **Reset Stem**. It removes all Shape edits from that lane—cuts, moves,
duplicates, disabled fragments, reverse, pitch, and rate—and restores the stem exactly as it was
when the source rifff entered Shape.

"Original" therefore means the source rifff's incoming state, including intentional Re-1 or
phase adjustments already belonging to that rifff. It does not mean jumping back to the raw
import's historical alignment.

A smaller **Reset Fragment** may clear processing on the current fragment while retaining its
position and boundaries. Its exact scope remains to be designed. Undo and redo cover recent
mistakes; Reset Stem is the unconditional recovery path.

## Explicitly deferred

- A dedicated Loop operation. Repetition should initially be built visibly through Duplicate or
  Option-drag copies.
- A hierarchy of repeated passes such as `A -> A -> A' -> A''`.
- Independent long-form stem phrase engines outside the fixed rifff workspace.
- Early entrance of stems from the next timeline rifff or permeable timeline boundaries.
- A full song timeline inside Shape.
- Automatic intention modes such as Build, Strip, Resolve, or Lead Into.

These may remain valuable future directions, but they are not needed to validate whether
fragment-level shaping solves the immediate musical problem.

## Open product decisions after the first slice

- How later Rate edits interact with the v1 fixed rifff length.
- How the playhead, region selection, and fragment selection share pointer gestures.
- Whether Pitch and Rate apply destructively to fragment boundaries or remain continuously
  adjustable parameters.
- Whether Add to Timeline belongs in Shape or all results should flow through the shelf.
- The precise visual treatment for selected and disabled fragments.

## First validation slice

A useful initial prototype should be deliberately narrow:

1. Open one rifff in Shape while keeping the shelf visible.
2. Split a stem fragment with `Command-E`.
3. Move, Option-copy, or `Command-D` duplicate it with snap and Snap Off.
4. Toggle durable fragment Disable with `0`.
5. Reset the complete stem to its incoming state.
6. Save the result as a new shelf rifff while preserving the source.

Pitch, Smooth/Raw Rate, Reverse, and Cross-style stem discovery can follow once the fragment data
model, playback, reset, and save-as-new safety model are proven.

## Technical architecture for the first slice

### Scope boundary

The first implementation is the complete safe fragment-editing foundation:

1. open and close Shape from a single selected rifff;
2. preserve the shelf and exclusive preview ownership;
3. split, move, Option-copy, duplicate, Disable, undo, redo, Reset Stem, and Reset Riff;
4. snap at bar, beat, half-beat, quarter-beat, eighth-beat, or Off;
5. preview the edited result through the native engine;
6. compare the original and shaped result;
7. atomically materialize every lane and save a new ordinary rifff to the shelf;
8. retain enough provenance on each materialized stem to reopen its edit recipe later.

V1 accepts ordinary tiled stems only. A rifff containing a one-shot or an already-trimmed
one-shot cannot enter Shape and receives a specific explanation. The native one-shot playback path
uses seconds-based trims and ignores tiled crop fields, so pretending it follows the same bar
mapping would move or split it incorrectly. One-shot normalization is a later feature, not a silent
fallback.

This slice deliberately does not pretend that Pitch, Rate, Reverse, or Discover insertion are
implemented. Their controls must not appear as inert or misleading UI. They build on the same
fragment recipe after the editor foundation has proven that source mapping, preview, reset, and
save are correct.

### Draft model

Pure draft logic lives in `src/shared/shape.ts` so it can be developed test-first without React,
Electron, or audio mocks.

```ts
interface ShapeFragment {
  id: string
  sourceStartBars: number
  sourceEndBars: number
  destStartBars: number
  disabled: boolean
}

interface ShapeLane {
  id: string
  source: Omit<Stem, 'slot'>
  gain: number
  disabled: boolean
  fragments: ShapeFragment[]
}

interface ShapeDraft {
  id: string
  projectKey: string
  sourceGroupId: string
  sourceName: string
  targetBpm: number
  loopBars: number
  lanes: ShapeLane[]
  past: ShapeSnapshot[]
  future: ShapeSnapshot[]
  revision: number
}
```

All coordinates are bars relative to the source rifff's own beginning. A fragment references an
immutable source interval and places it at a destination interval of the same duration in v1.
The initial lane contains one fragment mapping `[0, loopBars)` to `[0, loopBars)`, including the
source stem's natural repeats when its own `barLength` is shorter than the rifff.

Every committed edit pushes exactly one complete lane snapshot. Pointer drags preview locally and
commit once on pointer-up; they must not create one undo checkpoint per mousemove.

### Fragment invariants

- `sourceEndBars > sourceStartBars`.
- `destStartBars >= 0`.
- `destStartBars + fragmentLength <= loopBars`.
- Source coordinates stay within `[0, loopBars]`; a short source stem naturally tiles inside that
  range.
- Fragments in one lane do not overlap at the destination.
- A move or copy uses overwrite-style tape semantics: destination material under the placed
  fragment is split or trimmed away; material outside the destination remains unchanged.
- Moving first removes the selected fragment from its old destination, then performs the same
  overwrite insertion as Copy. Copy leaves the source fragment intact.
- Disabled fragments still occupy their destination intervals. They are not holes into which an
  underlying fragment can sound.
- Stable ordering is by `destStartBars`, then fragment id.

The overwrite helper must correctly preserve the source-to-destination offset when trimming the
left or right side of an existing fragment. That math is a pure function with focused tests.

### Selection and keyboard routing

Shape owns its shortcuts only while its fullscreen workspace is mounted and only when focus is not
inside an input or textarea.

- Clicking a fragment selects it without changing playback.
- Clicking the ruler moves the Shape playhead.
- `Command-E` splits the selected fragment at the playhead when the playhead is strictly inside
  it.
- `Command-D` duplicates the selected fragment immediately after itself only when a full copy fits
  in the rifff.
- `0` toggles selected fragments' durable disabled state.
- Delete/Backspace removes selected fragments from the lane but never deletes the source rifff or
  shelf item.
- Escape clears fragment selection; a second Escape may close Shape.
- Space owns Shape play/pause and must stop propagation before global transport handlers act.
- `Command-S` invokes Shape's single-flight **Add to Shelf** action. It never runs the underlying
  project save while a session-only Shape draft is open.

The workspace must not reuse Sketch or Shelf's global handlers. Mount order is not a safety
mechanism. While Shape is open, its capture listener always reserves Delete, Backspace, `0`,
Command-E, Command-D, Command-Z, Shift-Command-Z, Command-S, Space, and Escape with
`preventDefault` and `stopImmediatePropagation`, even when the Shape operation is a no-op. This
prevents an empty fragment selection from falling through and deleting the selected source rifff
from Shelf or Sketch.

### Strict render and preview pipeline

Shape does not project every fragment as an ordinary tiled engine clip. That tempting reuse has
two unacceptable consequences: the ordinary renderer adds a first/last fade to every synthetic
clip, so merely splitting an otherwise continuous waveform creates a notch; and its tolerant
load/stretch behavior can silently produce a correctly sized but missing or mistimed render.

Instead, a dedicated native **Shape renderer** reads one lane recipe and writes one complete dry
lane WAV. It is used for both preview and final materialization, so the auditioned and saved audio
come from the same algorithm.

Before native rendering, main-process code resolves each source to the target tempo with the
existing Rubber Band path. Shape uses a strict resolver: any required stretch failure aborts the
job rather than falling back to native tempo. The dedicated native operation then:

1. decodes the complete resolved source and fails if it is missing, empty, or undecodable;
2. allocates exactly `loopBars * 240 / targetBpm` seconds of output at the chosen sample rate;
3. maps each destination sample through its owning fragment to the corresponding tiled source
   sample;
4. leaves disabled fragment intervals silent;
5. writes float32 WAV and checks the writer's return value;
6. reports decoded input format, written frame count, sample rate, and output duration;
7. treats every mismatch or non-finite coordinate as failure.

Split boundaries are UI metadata, not automatically audible splices. The render planner coalesces
adjacent fragments when destination continuity and source continuity are both exact, even if a
visible edit boundary remains. Such a split must render sample-identically to the unsplit recipe.
At a true discontinuity—movement, duplication from another source location, Disable boundary, or
gap—the renderer applies the established short declick envelope. It must not fade a continuous
boundary. Output loop-edge treatment is tested after the materialized WAV is loaded through the
ordinary playback cache, so a saved/reopened rifff cannot accumulate an unintended audible second
seam treatment.

Preview rendering writes UUID-scoped temporary assets. A generation-guarded controller loads the
latest successful preview as an ordinary throwaway rifff through the existing engine. Older
renders are discarded and cleaned if a newer draft revision wins. Rendering happens after a
short debounce and after committed gestures, never once per pointer-move.

Shape gains a new `shape-preview` engine owner and joins StoreContext's throwaway-preview position
policy so the real arrangement length cannot force-seek its playhead. Preview load still requires
the normal ownership check immediately before and after every await.

Shelf preview receives a synchronous `onBeforePreview` handoff. It invalidates Shape's render/load
generation and releases or stops Shape ownership _before_ Shelf begins its asynchronous native
stop and Web Audio decode. A delayed Shape render or load can therefore never dispatch Play after
a Shelf click. This race is covered with deferred-promise tests.

### Shelf and inspector integration

`Frame` owns `shapeDraft` and `shapeOpen`, parallel to Cross. The draft is session-only and
discarded on close because nothing is durable until **Add to Shelf** succeeds. The immutable
editing-source id and opening selection are stored separately from Shelf's current audition
selection. Auditioning another shelf rifff may change shared highlighting, but closing Shape
restores the exact selection that opened it.

`Inspector` receives a Shape callback only when the shared Shelf/Sketch selection contains exactly
one valid rifff. Its action row shows **shape rifff** alongside **discover this rifff**. Cross
continues to appear only for exactly two selected rifffs.

Before opening Shape, the same all-or-nothing phase materialization used by Cross prepares the
source stems. This makes the draft's bar-zero audio exactly match what the user was hearing and
prevents runtime `off` state from being lost or double-applied.

The fullscreen Shape shell renders the ordinary Shelf above the editor. It receives the existing
shared selection and preview callbacks plus the synchronous preview handoff described above.

### Durable materialization and provenance

Saving does not add fragment semantics to the ordinary project playback path. Instead, each
logical Shape lane is rendered to one immutable WAV whose duration is exactly `loopBars` at the
target tempo. The resulting shelf rifff is therefore an ordinary rifff that every existing
playback, export, cache, and phase-correction path can already understand.

Materialization is dry and unity-gain: no master plugins, channel plugins, radio master stages,
arrangement automation, temporary Mute, or temporary Solo are baked into a lane. Original and
shaped A/B monitoring both pass through the same current monitoring chain exactly once. Lane gain
is not baked; the new shelf rifff receives an explicit per-stem `vol` map copied from the Shape
lanes, bypassing `ADD_TO_SHELF`'s default `sqrtGain(stemCount)` seeding. A durably disabled whole
lane is materialized normally but saved with gain zero and `laneDisabled: true` provenance, so
reopening Shape can restore the durable state without trying to recover audio from silence.

The renderer sends all lane projection states to one main-process operation. The main process:

1. allocates UUID-named temporary files under a durable `.shapes` directory beside the project
   library's existing `.bakes` directory;
2. renders every lane through the strict native Shape operation;
3. requires every source decode and required stretch to succeed, and validates float format,
   frame count, sample rate, actual duration, and write completion;
4. publishes all files by atomic rename only after every lane succeeded;
5. deletes every temporary and prematurely published file on failure;
6. returns no partial result.

This is a batch operation. A failure must not add a partly shaped rifff to the shelf.

Each saved stem carries optional Shape provenance in project JSON:

```ts
interface ShapeStemProvenanceV1 {
  version: 1
  source: ShapeSourceStem
  loopBars: number
  laneDisabled: boolean
  gain: number
  fragments: ShapeFragment[]
}
```

`path`, `durationSec`, and `barLength` describe the materialized WAV used by ordinary playback.
`phaseSourcePath` points to that materialized WAV with `phaseBars: 0`, so a later Re-1 operates on
the shaped audio rather than accidentally returning to pre-Shape source material. Shape
provenance is used only to reopen the edit recipe and restore a lane; old projects and unshaped
stems have no field and behave identically.

`ShapeSourceStem` is a nonrecursive copy of the source fields needed to render and describe the
baseline. It never contains another Shape provenance object. If the original dependency is
missing or undecodable, reopening fails visibly and leaves the materialized shaped rifff usable;
it never substitutes the rendered result while claiming Reset will reach the original.

Reset Stem reconstructs the lane from its immutable incoming source, not from its derived render.
Reset Riff does that for every lane as one undoable edit.

Re-1 after Shape establishes a new baseline. The baker operates on the materialized shaped WAV,
sets the new path/phase metadata, and clears the prior Shape provenance rather than retaining a
recipe whose coordinate zero no longer matches the audio. Opening Shape after that starts a fresh
one-fragment recipe from the re-oned incoming stem. Every Shape offspring receives a new
`phaseLinkId`.

### Async job identity and cleanup

Every open, preview, and save captures `{ projectSessionEpoch, draftId, revision, jobId }`.
`projectSessionEpoch` changes on New, Open, recovery restore, project duplicate/switch, or any
other project replacement; it is not derived from the persisted project seed. `draftId` changes on
every Shape open, even for the same source. `jobId` is unique for each render attempt.

The guard is checked before work, after every await, before publishing files, and immediately
before dispatching `ADD_TO_SHELF`. Close, unmount, project replacement, a superseding open, or a
newer render invalidates the job. Add to Shelf is single-flight. Published assets rejected by the
final renderer guard become unreferenced durable assets and are queued for conservative cleanup;
assets referenced by an accepted shelf result, project state, or undo history are never deleted.

### UI structure

The first workspace uses the existing visual language rather than introducing DAW chrome:

- a top toolbar with Shape, play/pause, original/shaped A/B, snap, undo, redo, Reset Riff, Add to
  Shelf, and close;
- the ordinary Shelf directly beneath the toolbar or at the existing top-of-frame height;
- a fixed-width lane-controls column with temporary Mute, temporary Solo, durable whole-lane
  Disable, and Reset Stem;
- one waveform ruler shared by the lanes;
- fragment boundaries, selected-fragment outline, disabled hatch/recession, and a dim read-only
  playhead using existing tokens;
- no rounded corners and no new chrome colors.

The fragment waveform should reflect its source interval, not redraw the entire source from bar
zero inside every moved fragment. This requires clipping and translating the existing repeated
waveform by the source-to-destination offset.

### Tests and verification

Pure TypeScript tests must cover:

- draft creation and reset;
- split edge rejection and correct source/destination halves;
- duplicate placement and end-of-rifff rejection;
- move/copy overwrite trimming on left, right, middle, and complete coverage;
- source-coordinate preservation when an existing fragment is trimmed;
- durable Disable toggling without deletion;
- undo/redo as one checkpoint per gesture;
- render planning, disabled omission, gains, duration anchoring, and coalescing a split that
  preserves continuous source/destination mapping;
- assembly of an ordinary rifff from a successful atomic materialization result;
- stale epoch/draft/revision/job guards preventing a late render from committing into another
  session or copied project;
- complete versioned provenance, whole-lane Disable, nonunity gain, and Re-1 clearing provenance;
- keyboard capture in both operative and no-op cases;
- Shelf takeover during stretch resolution, native render, and preview load.

Main-process tests should exercise atomic file publication through injected render/write helpers;
they must not mock all of Electron. Failure cases include missing or undecodable source, rejected
stretch, partial write, wrong frame count, rename failure, cancellation, and stale success.

Native tests use real generated buffers and assert identity for an untouched lane, identity for a
split without movement, fractional source coordinates, short-stem tiling, adjacent continuous
fragments, true discontinuities, all-disabled content, writer failure, and saved-WAV replay through
`StemBufferCache`. Run the native suite after rebuilding, plus full TypeScript tests, typechecks,
lint, and `git diff --check`.

Manual verification remains required for pointer gestures and live audio:

1. open Shape from one Sketch or Shelf selection;
2. compare original and shaped playback;
3. split, move, duplicate, and Disable fragments while playing;
4. verify Shelf preview takes over without double playback;
5. Reset Stem and undo/redo it;
6. save to Shelf, close Shape, preview the new rifff, and confirm the source rifff is unchanged;
7. save/reopen the project and confirm the shaped rifff still plays;
8. reopen Shape on the result and confirm its provenance reconstructs the editable lane.

## Follow-on DSP phases

The fragment recipe intentionally leaves room for processing fields without putting unimplemented
controls into v1:

```ts
pitchSemitones?: number
rate?: number
rateQuality?: 'smooth' | 'raw'
reversed?: boolean
```

Phase two adds Reverse and Free Rate. That requires native preview/export support for reading a
bounded source interval backward and at a variable rate, including Smooth band-limited and Raw
nearest/sample-hold modes. The output fragment duration is
`sourceDuration / abs(rate)` and collision rules reuse the first slice's overwrite helper.

Phase three adds time-preserving semitone Pitch. It needs an explicit high-quality algorithm and
latency/edge policy; simple resampling is not acceptable because that is already Free Rate.

Phase four can add Cross-style Discover insertion by creating a new lane with one immutable source
fragment. The existing Source and Matching settings remain shared with Cross/Discover.

Rate Shape and Raw Clock remain experiments until the simpler Free Rate and Pitch controls have
been auditioned musically.
