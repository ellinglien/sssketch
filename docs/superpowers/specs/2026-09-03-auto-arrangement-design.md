# Auto-Arrangement — Design

**Status:** approved by Elling, ready for planning
**Branch:** `auto-arrangement-exploration`

## Summary

A new interactive flow, triggered per-rifff, that takes an imported multi-stem Endlesss loop
(typically a handful of bars, e.g. 8 stems × 8 bars) and builds it out into a longer arrangement
by deciding when each stem enters, exits, or briefly "fills" around a transition. The whole
thing is three steps — confirm each stem's role, interactively build the arrangement with
weighted next-move suggestions, then commit the result to the timeline — and it produces
nothing but ordinary, already-editable timeline state. There is no separate "generated
arrangement" object: once applied, the result is just placement + mute-region automation you
can hand-edit exactly like anything built manually.

## Motivation

Endlesss rifffs are short, seamlessly-loopable jams, not full arrangements. Turning one into
something that plays like a finished track today means manually building every mute-region and
extending every stem's played length by hand. sssketch already has most of the raw material
needed to make this semi-automatic: reliable-when-present per-stem instrument tags, DSP-based
stem clustering (Tidy Up), decoded audio analysis caches, and a timeline model where "how long a
stem plays" and "when it's audible" are already independent, unclamped, arbitrary-bar-range
primitives. This design wires those together.

## Non-goals

- **Not fully automatic, one-click-and-done.** Explicitly interactive — the user picks between
  weighted candidate moves as the arrangement builds, rather than reviewing/fixing a finished
  result after the fact. (Considered and rejected in favor of this — see "Alternatives
  considered" below.)
- **Not a new audio-classification engine.** Role confirmation reuses the existing `Stem.type`
  field and Tidy Up's DSP clustering; it does not invent new classification logic, only a
  confirmation/adjustment layer over what already exists.
- **No new audio synthesis or processing.** "Fills" and transitions are existing stem material,
  exposed via existing mute-region scheduling — never new audio content.
- **No longer musical fade-in on sustained "enter" moves for v1.** Every mute-region boundary
  already gets an automatic 3ms declick ramp (see "Fades and transitions" below); a longer,
  intentionally musical swell-in is a real gap but is deferred — nothing clicks or pops either
  way, so this is a polish item to revisit once real results have been heard, not a blocker.
- **No decomposition into separate specs.** Role identification and the arrangement engine are
  a clean architectural boundary and could ship independently, but Elling chose to keep this as
  one spec/plan rather than split it (see "Alternatives considered").

## Existing capabilities this builds on

Confirmed by direct investigation of the current codebase before writing this spec:

- **Import** already handles multi-stem (including 8-stem) Endlesss loops via both drag-and-drop
  (`src/main/importRifff.ts`) and the direct Endlesss API path (`src/main/endlesssApi.ts`). No
  import work is needed for this feature.
- **`Stem.type`** (`src/shared/types.ts`) is a `SoundType` field — `'drums' | 'notes' | 'bass' |
  'extInst' | 'sampler' | 'fx' | 'extFx' | 'audioIn'` — populated from a layered fallback chain:
  real Endlesss `Instrument` bitmask (reliable but only resolves 4 of 8 types, and only present
  via the direct API / LORE warehouse import paths) → preset-name guess → sssketch's own
  bass/drum audio heuristic (`classifyStems.ts`) → `'fx'` default. **Drag-and-drop imports get
  no Endlesss metadata at all** and fall straight to the guess/default chain. This unreliability
  is exactly why role confirmation is a distinct, user-reviewable step rather than something
  auto-arrangement trusts blindly.
- **Stem bus clustering ("Tidy Up")** already does DSP-feature-based grouping (transient
  density, bass ratio, spectral centroid, ZCR brightness, voiced-fraction/pitch-variance, MFCCs)
  — currently only consumed for Ableton export track-packing, never for timeline placement. Auto
  Arrangement reuses this clustering as an additional role signal.
- **Analysis caches** (`src/renderer/src/audio/`): `peakCache.ts` (waveform peaks + zero-crossing
  "brightness", 128 buckets/file), `bandEnergyCache.ts` (per-band energy time series),
  `pitchCache.ts` (per-frame pitch contour). All decode-once, path-keyed, evict-on-rejection.
  These are the source for each stem's density/brightness score in Section "Role & density
  scoring" below.
- **`playedBars`** (`state/store.ts`) already lets any stem's audible length exceed its native
  `barLength` with no upper bound (only a `MIN_PLAYED_BARS = 0.25` floor) — the native engine
  (`PlaybackEngine.cpp`) already tiles/loops the stem's own audio to fill it, with seams
  declicked via `LoopSewing`. `SET_PLAYED_BARS` is an existing reducer action, already dispatched
  today from clip-resize UI. **No new mechanism is needed to extend an 8-bar loop to, say, 64
  bars** — this was the single biggest open risk going into this design and it turned out to
  already be solved.
- **`muteRegions`** (`state/store.ts`, `ADD_MUTE_REGION`) store arbitrary `{startBar, endBar}`
  spans, unclamped by native stem length, already scoped to the full extended `playedBars`
  window. This is the primitive the whole build-engine output translates into.
- **Fades and transitions**: every `muteRegions` boundary already gets an automatic 3ms linear
  micro-fade (`MuteRegionGain.cpp`, `kMuteMicroFadeSec`), independent of and multiplicative with
  the whole-clip `fadeIn`/`fadeOut` (which apply once, only at a placed clip's start/end). So
  every enter/exit/fill this feature schedules is click-free automatically, with no new engine
  work — see "Non-goals" for the one related gap (no longer musical swell).

## Flow

### 1. Role confirmation

Reads each stem's current `type` plus a computed density/brightness score (from
`bandEnergyCache`/`peakCache`) and presents one row per stem: role + a rough density label
("sparse" / "steady" / "dense"). The user can reassign a stem's role or exclude it from
arrangement entirely (e.g. a one-shot sample that shouldn't be treated as build/breakdown
material). Stems still at the unresolved `'fx'` default are flagged as uncertain rather than
silently trusted. This step produces one confirmed `{role, densityScore, included}` record per
stem — the input to step 2.

### 2. Interactive build

Builds the arrangement in fixed 8-bar steps (a hardcoded default for v1, not user-configurable —
a natural future enhancement if 8 bars turns out to be the wrong grain for some loops). State
carried between steps:
which stems are currently active, how long each has been in/out, and the running density (active
stem count weighted by individual density scores).

At each step the engine scores 2-3 candidate moves and presents them for the user to pick
between (or accept the top-weighted one and just skim the log afterward):

- **Enter** — stem joins the sustained active set going forward.
- **Exit** — stem leaves the sustained active set.
- **Fill** — stem gets a brief 1-2 bar audible window right before a transition, then returns to
  muted (or rolls into "enter" if it's about to join the sustained set anyway). Higher-
  brightness/transient-dense stems are favored as fill candidates; steady/sustained stems are
  not.

Move weighting factors: each stem's own density rank (sparse stems favored early/late in the
arrangement, dense stems favored mid-arrangement), role diversity (avoid stacking multiple
same-role stems into one window), and a soft overall-shape bias so total density trends up then
down across the run rather than wandering. This continues until density naturally returns near
its starting point (the outro condition) or the user ends it manually.

Nothing is written to timeline state during this step — cancelling at any point here is a clean
no-op.

### 3. Apply to timeline

Translates the finalized build sequence into dispatched actions, using only existing reducer
actions:

1. `PLACE_ON_TIMELINE` at the current playhead, if the rifff isn't already placed.
2. `SET_PLAYED_BARS` to extend the rifff/stems to the arrangement's total length.
3. Per stem, `ADD_MUTE_REGION` for each inactive span implied by its confirmed enter/exit/fill
   schedule.

**Re-running on a rifff that already has mute regions or an extended `playedBars`** (from a
previous run or manual edits): since `ADD_MUTE_REGION` is additive, applying on top without
clearing would stack/layer regions into a mess. Elling's call: **warn first** — if existing mute
regions or an extended played length are detected on affected stems, show a one-time warning
("this will replace N existing mute regions") before applying, rather than silently clearing or
silently layering on top.

## Architecture

- **Pure logic** (density/role scoring, the weighted move-candidate engine, and the "confirmed
  build sequence → list of actions to dispatch" translation) lives in `src/shared/`, framework-
  agnostic, real vitest TDD coverage per this codebase's convention.
- **New wizard UI** (role confirmation list + step-by-step move picker) lives in
  `src/renderer/src/components/`, typecheck/lint-verified only, per this codebase's convention
  that React components aren't directly unit tested here.
- **No new IPC surface, no new reducer actions, no native-engine changes.** Everything routes
  through `PLACE_ON_TIMELINE`, `SET_PLAYED_BARS`, and `ADD_MUTE_REGION`, all of which already
  exist and are already exercised by existing manual-UI code paths.

## Error handling & edge cases

- **Cancel mid-build**: no-op, nothing written until the final apply step (see above).
- **Uncertain roles**: flagged, not silently trusted (see role confirmation).
- **Too few stems** (1-2): not enough material for a real build/breakdown arc — the flow should
  say so plainly and offer a trivial/no-op result rather than pretending to construct one.
- **Re-run on an already-arranged rifff**: warn before replacing existing mute regions/played
  length (see "Apply to timeline").

## Testing

- Pure logic (`src/shared/`): real vitest TDD — scoring, move-weighting, and action-translation
  are all pure functions of their inputs and can be tested without mocking Electron.
- Wizard UI: typecheck + lint only; this environment has no GUI/audio interaction tooling, so a
  coding agent cannot itself click through the wizard or judge whether a generated arrangement
  sounds musically good — that's an explicit manual-walkthrough follow-up, not something the
  plan can claim to complete. Needs Elling running it against a real 8-stem Endlesss loop and
  listening to the result.
- Keep the timeline-apply step thin: the pure function decides which actions to dispatch, a
  small glue layer just dispatches them, so the interesting/risky logic stays covered by tests
  even though the dispatch glue itself isn't directly tested.

## Prior art / inspiration

Referenced during design, not implemented directly — recorded here for context on *why* the
shape of this feature looks the way it does:

- **Veena Studio's AI Arrangement Assistant (2026)** — closest direct product analog: takes
  existing loops/stems and structures them by analyzing musical content to decide entrances/
  exits/builds/drops, explicitly rejecting a rigid template approach. Confirms the
  "content-driven, not template-driven" direction taken here.
- **Foote's self-similarity-matrix / novelty-curve technique** — the standard academic technique
  for automatic structure/boundary detection. Not used directly (an 8-bar loop is too short and
  static internally for this to find much), but the general self-similarity concept informed
  scoring each stem's own density/repetitiveness rather than looking for structure within the
  loop's own bars.
- **AutoMashUpper's "mashability" score** (harmonic + rhythmic similarity + spectral balance) —
  a compatibility axis between two audio segments, distinct from a density/energy axis. Not
  built for v1 (see non-goals) but a natural extension if stem-pairing quality ever needs
  judging, not just density.
- **Automatic DJ "highlight detection" research** — algorithmic identification of a track's most
  climactic moment; conceptually informs where the density-shape bias should peak.
- **Ableton Live's Follow Actions** (Session View) — the direct UX/interaction precedent: a
  weighted set of candidate next moves at each step. This is the model step 2 translates into a
  step-by-step wizard rather than live clip-launching.

## Alternatives considered

- **Fully automatic, no manual step** — rejected; implies a much higher bar for algorithmic
  arrangement quality with no expectation of manual fixing, which isn't realistic for loop
  material with no inherent structure of its own.
- **One-shot proposal, then edit as a whole** — rejected in favor of step-by-step interaction,
  per Elling's explicit preference and the Follow Actions precedent.
- **Scoring-only, fully manual sequencing** — rejected as barely qualifying as automatic/semi-
  automatic arrangement; too much of the interesting work would stay manual.
- **Splitting into two specs** (role identification, then arrangement engine) — considered given
  the natural architectural boundary between the two, but Elling chose to keep this as one spec.

## Open follow-ups

- Manual walkthrough against a real 8-stem Endlesss loop is required before this can be
  considered done — musical quality can't be verified by a coding agent.
- Longer, musical fade-in on sustained "enter" moves (beyond the existing automatic 3ms declick)
  is a deferred polish item, worth revisiting once real arrangement output has been heard.
