# Library-Wide Discover — Design

## Goal

Elling's own framing: Aria Labs' "Upcycle" scans a whole sample library and helps you find new
combinations you wouldn't have tried by hand. Build the same idea against a user's *entire
synced Endlesss library* — not just whatever's on the current timeline — prioritizing stems
that have already been hand-categorized (via Tidy Up or Auto-Arrange), and improving how well
sssketch can auto-guess a stem's role for everything that *hasn't* been touched by a human yet.

## Background — what exists today

**The riff library is already a real, persistent, library-wide SQLite database**
(`src/main/riffLibrarySchema.ts`'s `warehouse.db3`, opened via `openOwnRiffLibraryDb()`) —
`Jams`/`Riffs`/`Stems` (synced from every jam/shared-feed a user has ever touched, via
`riffLibrarySync.ts`) plus `Tags` (`RiffCID`, `OwnerJamCID`, `Favour`, `Note` — the one
existing piece of hand-curated, library-wide, per-*riff* data). This spec's own new table
(§1) follows that exact same "another table in the same DB" pattern, just per-*stem* instead
of per-riff.

**Hand-categorization exists today, but is trapped per-project, and asymmetrically so.**
Confirmed by direct code read, not assumed:
- Tidy Up's bus assignment (`AppState.busOf: Record<string, BusId>`, `BusId = 'drums' |
  'bass' | 'lead' | 'backing' | 'aux'`) is a normal, persisted `AppState` field — saved inside
  whichever `.sssketchproj` file happened to be open when it was assigned, and nowhere else.
- Auto-Arrange/Draw Arrangement's role-confirmation step (`AutoArrangeRoleStep.tsx`) lets a
  user correct a stem's `ArrangeRole`/`DrumSubRole` (`src/shared/stemRole.ts`), but that
  correction is held only in the wizard's own component state for the duration of that one
  session — `AppState` has no `arrangeRoleOf`/`drumSubRoleOf` field at all. It is **never
  persisted anywhere**, not even to the current project's own save file. This is a real,
  confirmed asymmetry that shapes §3 below: bus history can be recovered from old project
  files; role/drum-sub-role history cannot, because it never existed to recover.

**Today's automatic classification (`resolveStemRole`, `src/shared/stemRole.ts`) is weak by
construction.** It uses exactly two inputs: `busId` if the stem has been tidied (in which
case the guess is really just that hand-confirmed bus, relabeled), otherwise `stem.type`
(`SoundType`) — eight coarse, Endlesss-self-reported categories (`drums` / `notes` / `bass` /
`extInst` / `sampler` / `fx` / `extFx` / `audioIn`) representing whichever instrument button
the *original creator* happened to click when recording, not anything about how the stem
actually sounds. A stem nobody has ever tidied has no better signal than that. Two things
already exist, unused, that change this:
- `Stems.PresetName` (`riffLibraryStore.ts`) — a real, synced, free-text patch/preset name
  (e.g. "808 Kick," "Warm Pad") that `resolveStemRole` never looks at.
- `src/renderer/src/audio/`'s existing per-stem analysis caches (`peakCache.ts`,
  `bandEnergyCache.ts`, `pitchCache.ts`) and `stemDensityScore.ts`'s density/fill scoring —
  all renderer-side, Web-Audio-decode-based, cache-by-file-path. Real audio-content signal,
  already built, currently used only for waveform rendering and auto-arrange's own weighting.

**Existing compatibility-adjacent logic worth reusing conceptually:** `autoArrangeEngine.ts`'s
`roleDiversityBonus` already favors bringing in a role not yet represented among active
stems — the same "complementary, not redundant" instinct this spec's own ranking (§4) wants,
just applied across the whole library instead of within one build.

**Researched, not guessed:** Aria Labs' own Upcycle explicitly markets "No AI" and fully local
analysis — the same tier of technique (hand-crafted DSP features: spectral/energy/pitch
signatures) this spec proposes for Phase 1 (§6), not a weaker compromise. Sononym's own
five-axis similarity model (Overall/Spectrum/Timbre/Pitch/Amplitude) maps closely onto
sssketch's *already-built* analysis layer. Learned audio embeddings (the tier Algonaut Atlas
2 and Splice use) score meaningfully higher on real instrument-recognition benchmarks, and
are feasible to run fully locally in this exact stack — confirmed via research: YAMNet
(14MB, Apache 2.0, official TensorFlow.js export) via `onnxruntime-web`, running in the
renderer on the same decoded audio the existing caches already use — but this is a genuinely
separate subsystem (new WASM runtime dependency, a bundled model file, worker-thread
plumbing), not a small addition. Scoped as this spec's own explicit Phase 2 (§7), not folded
invisibly into Phase 1.

## Design

### 1. `StemCategories` — a new, persistent, library-wide table

A new table in the same `warehouse.db3` `riffLibrarySchema.ts` already owns, keyed by
`StemCID` (categorization is fundamentally a per-*stem* fact, unlike `Tags`' own per-riff
scope):

```sql
CREATE TABLE IF NOT EXISTS StemCategories (
  StemCID TEXT PRIMARY KEY,
  ArrangeRole TEXT,
  DrumSubRole TEXT,
  BusId TEXT,
  Source TEXT NOT NULL,        -- 'tidyup' | 'autoarrange' | 'drawarrange' | 'backfill'
  SourceProject TEXT,          -- project file path this came from, for provenance/conflicts
  UpdatedAt INTEGER NOT NULL   -- unix seconds
);
```

A row can have `ArrangeRole`/`DrumSubRole` set without `BusId` (an auto-arrange role
correction that was never tidied) or vice versa (a tidied stem never run through
auto-arrange) — both are genuinely independent, partial signals worth keeping.

### 2. Forward capture — every future hand-categorization gets persisted here too

Two existing user actions gain a second write, alongside their existing `AppState` one:

- **Tidy Up's bus assignment** (`ASSIGN_TO_BUS`/`ASSIGN_STEMS_TO_BUS`, `store.ts`): the same
  dispatch that updates `state.busOf` also fires a new IPC call
  (`window.rifffApi.upsertStemCategories(entries)`) writing `BusId`/`Source: 'tidyup'`/
  `UpdatedAt: now` for each assigned stem.
- **Auto-Arrange/Draw Arrangement's role-confirmation** (`AutoArrangeRoleStep.tsx`'s
  `onConfirm`): every *included* stem's confirmed `ArrangeRole`/`DrumSubRole` gets the same
  treatment (`Source: 'autoarrange'` or `'drawarrange'`). This is new behavior — today this
  data reaches nowhere at all once the wizard closes (see Background) — and is the only way
  role/drum-sub-role data ever becomes recoverable going forward.

A stem categorized more than once (e.g. tidied, then later re-tidied differently) simply
overwrites its own row — `UpdatedAt` naturally reflects "most recent wins" without needing
special-case logic, matching how §3's own backfill conflict resolution works.

### 3. Backfill — recovering categorization already trapped in old project files

A one-time (safely re-runnable) main-process migration: scan every `.sssketchproj` file
under the project library folder (`projectLibrary.ts`), read each one's saved `busOf`, and
upsert into `StemCategories` with `Source: 'backfill'` and `UpdatedAt` taken from the
project file's own last-modified time. Where two different old projects categorized the same
`StemCID` differently, the more-recently-modified project's file wins — same "later timestamp
wins" rule §2 already uses for forward writes, applied consistently.

**Only `busOf` is backfillable.** `ArrangeRole`/`DrumSubRole` corrections were never saved to
any project file (Background) — there is nothing to recover for them. This asymmetry is
expected and stated plainly in the migration's own summary/report, not hidden.

### 4. Compatibility ranking — "compatible + complementary"

For two stems (from anywhere in the library) to be suggested together:
- **Compatible**: close/same key and tempo — `Riffs.BPMrnd`/`Root`/`Scale`, already synced
  and stored per riff.
- **Complementary**: different roles preferred over the same role, mirroring
  `roleDiversityBonus`'s own existing logic (Background) — reused conceptually, not by
  literally calling that function, since it currently operates over one in-progress build's
  `activeStemKeys`, not a library-wide candidate pool.
- **Prioritized by confidence**: a `StemCategories` row (hand-confirmed, any `Source`) always
  ranks above a stem sssketch has only ever auto-guessed at — directly answering Elling's own
  "prioritize stuff that's categorized by hand."

### 5. Creator/ownership scope

A synced library is full of *collaborative* jams — plenty of stems weren't created by the
user at all. Reuses the exact filtering mechanism `LibraryBrowser.tsx` already has for this,
rather than inventing a second one: `Stems.CreatorUserName` (already synced per-stem),
`riffLibraryUsername` (the existing "which username is 'you'" setting), and
`computeOwnerFraction` (`shared/riffLibraryTypes.ts`). Discover defaults to suggesting only
stems where `CreatorUserName` matches the user's own username — mirroring
`onlyContainsUser`'s own existing default-off, explicit-opt-in shape, just inverted here to
default-*on* for safety, since silently mixing in a collaborator's audio without it being
obvious whose it is is worse than a smaller default suggestion pool. An explicit toggle
widens scope to the whole library, any creator.

### 6. Auto-classification accuracy — Phase 1 (ships with everything else above)

Two additions to `resolveStemRole`'s own guessing, in priority order above raw `SoundType`:

- **`PresetName` keyword matching**: a small, explicit keyword→role/drum-sub-role table
  (kick/snare/hat/clap/bass/vox/pad/lead/etc.) checked against the stem's `PresetName` before
  falling back to `SoundType`.
- **Nearest-neighbor from `StemCategories`**: for a stem with no `StemCategories` row at all,
  compute its existing hand-crafted feature signature (reusing `bandEnergyCache`/`pitchCache`/
  `stemDensityScore`'s output, not new analysis) and find its closest already-categorized
  neighbors by that signature — inferring a role from what it most resembles, weighted by how
  close the match is. Gets better the more the library gets used normally; not a separate
  "training" step.

### 7. Auto-classification accuracy — Phase 2 (separately scoped upgrade, not v1)

Real learned audio embeddings: YAMNet (14MB, Apache 2.0, official TensorFlow.js export) run
via `onnxruntime-web`, in the renderer, on the same Web-Audio-decoded PCM the existing
analysis caches already work from — no new decode path, no involvement from the native JUCE
engine (this is offline batch analysis, not real-time playback). A new path-keyed cache
(matching `peakCache.ts`'s own convention) stores each stem's embedding vector; nearest-
neighbor search over embeddings then either replaces or augments §6's hand-crafted-feature
version for both classification confidence and the discover screen's own ranking (§4).
Extraction runs in a Web Worker so a first-time scan of a large library doesn't block the UI.
Built and evaluated only after Phase 1 ships and it's clear whether accuracy is actually
still a real problem in practice — this section documents the *shape* of that upgrade so it's
not a vague future maybe, but building it is explicitly not part of this spec's own plan.

### 8. The discover screen

A new, standalone screen off the gear menu — separate from Tidy Up/LibraryBrowser/Auto-Arrange,
which were all just reworked or extended this session and shouldn't absorb more scope.

- **Seed-based**: pick one stem (from the current timeline, or the library browser) as a
  starting point; the screen shows compatible/complementary stems from anywhere in the
  library, ranked per §4.
- **Unprompted**: browse proactively-surfaced multi-stem combinations with no seed needed —
  the harder of the two ranking problems, but requested explicitly rather than assumed.
- **Placing a result**: clicking a suggested stem imports it (constructing a new
  single-stem clip — the same shape `buildArrangeReplaceActions`' own output already uses,
  see `pasteStemWindowAction`/`pasteStemAction` in `state/selectors.ts`) and places it on the
  current timeline via the existing `PLACE_ON_TIMELINE` mechanism. The discover screen is a
  real way to build, not just a browser.

## Future reuse (not this spec's own scope)

Every piece of analysis this spec adds — §6's `PresetName` matching and nearest-neighbor
classifier, §7's YAMNet embeddings — is written as standalone, reusable logic (matching how
`bandEnergyCache`/`pitchCache`/`stemDensityScore` already work today), not code baked into the
discover screen specifically. That means Tidy Up's own bus-clustering could, in the future,
call the same similarity function discover uses instead of (or alongside) whatever it
clusters on today — real, low-cost reuse once this exists, not something this spec needs to
build. Re-one (loop-start/downbeat detection, `BeatPicker.tsx`) is a related but genuinely
different analysis problem — onset/rhythm detection, not timbral classification — worth a
future look with the same "build it reusable" mindset, but not something this spec's own
techniques directly solve; noted here so it isn't lost, not proposed as in scope.

## Non-goals

- **No manual `StemCategories` editing UI.** It's a byproduct of normal Tidy Up/Auto-Arrange
  use (§2/§3), not a new standalone tagging interface.
- **No cross-machine sync** of the new table — local to whichever `warehouse.db3` a user
  already has, same as everything else in `riffLibraryStore.ts` today.
- **No role/drum-sub-role backfill** — established in Background/§3 as genuinely impossible,
  not merely deferred.
- **Phase 2 (§7) is design-only in this spec** — evaluated and built as its own follow-up
  once Phase 1 is real, not bundled into this implementation.

## Testing

`StemCategories` read/write functions, the backfill migration's conflict resolution, the
`PresetName` keyword matcher, the nearest-neighbor classifier, and the compatibility-ranking
function are all real `src/shared/`-or-`src/main/`-style pure/testable logic — TDD'd per this
codebase's convention. The discover screen's own UI (both modes, plus the "place on timeline"
action) is typecheck+lint-verified only, per this codebase's standing convention for React
components with no way to click-test a discovery/browsing flow in this environment — needs
Elling's own manual walkthrough, same as every other UI feature built this session.
