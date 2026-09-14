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
actually sounds. A stem nobody has ever tidied has no better signal than that. But
`resolveStemRole` not using better signal doesn't mean better signal doesn't already exist
elsewhere in the app — three real pieces of it do, none wired into `resolveStemRole` itself,
and §6 below builds directly on all three rather than re-inventing any of them (see §9 for why
that distinction — extend vs. re-invent — is being treated as a standing priority, not just a
one-off correction here):
- **`Stems.PresetName` (`riffLibraryStore.ts`)** — a real, synced, free-text patch/preset name
  (e.g. "808 Kick," "Warm Pad") that `resolveStemRole` never looks at. A keyword lookup against
  preset names isn't hypothetical, either — `src/shared/presetNames.ts`'s
  `guessSoundTypeFromPresetName` already does exact-match, case-insensitive keyword lookup
  against ~250 known Endlesss pack preset names, and is already in production use today (the
  drag-and-drop import fallback, and LORE's own low-confidence-`instrumentMask` fallback) — it
  just only resolves to `SoundType` (8 buckets), not the finer `ArrangeRole`/`DrumSubRole`
  granularity Auto-Arrange's role step works in.
- **The canonical shared feature-extraction pipeline** — `src/shared/stemFeatures.ts`'s
  `StemFeatures`/`toFeatureArray`/`standardizeFeatures`, computed by
  `src/renderer/src/audio/stemFeaturesCache.ts`'s `getStemFeatures(path)` (transient density,
  bass energy ratio, spectral centroid, zero-crossing brightness, voiced fraction, pitch
  variance, 13 MFCCs). Confirmed by reading both call sites: this is the SAME pipeline both
  Tidy Up's clustering (`agglomerativeCluster.ts`) and Auto-Arrange's density/fill scoring
  (`stemDensityScore.ts`) already consume today — one shared source of real audio-content
  signal, not three independent ones.
- **A working, GLOBAL, incrementally-trained nearest-centroid classifier already exists —
  for `BusId` specifically.** `src/shared/busCentroids.ts`'s `BusCentroidStore`/`suggestBus`,
  persisted cross-project as `busCentroids.json` in Electron's `userData` directory
  (`src/main/busCentroidStore.ts`, whose own doc comment explicitly calls it out as
  "deliberately GLOBAL... the whole point of a classifier here is to generalize across every
  sketch the user tidies, not start over cold on each new one"). It trains on exactly the
  feature pipeline above, live, every time a user confirms a bus in Tidy Up
  (`ClusterStemsBrowser.tsx`'s `trainCentroids`), and already surfaces "suggested" bus
  assignments for un-clustered stems in that same screen today. This is real, shipped
  precedent that cross-project ML-lite classification already works in this codebase — for
  one category. §6 builds Phase 1 by extending this exact mechanism to the other two
  categories, rather than standing up a second, differently-shaped classifier next to it.

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
plumbing), not a small addition. Documented as this spec's own explicit Phase 2 (§7), kept
distinct from Phase 1 in the design (different technique, different risk) but — per Elling's
own call — built in the same implementation pass as Phase 1, not deferred to a future spec;
see §7 for what that trade-off actually gives up.

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

Two additions to `resolveStemRole`'s own guessing, in priority order above raw `SoundType` —
both extending an existing mechanism from Background rather than building a parallel one:

- **`PresetName` keyword matching**: extend `src/shared/presetNames.ts`'s existing
  `guessSoundTypeFromPresetName` table, not a second, parallel one — add an
  `ArrangeRole`/`DrumSubRole`-keyed lookup alongside its current `SoundType`-keyed lookup (same
  ~250-name table, same exact-match/case-insensitive convention), checked against the stem's
  `PresetName` before falling back to `SoundType`.
- **Nearest-centroid classification, extending `busCentroids.ts`'s own architecture — not a
  second, differently-shaped nearest-neighbor mechanism reading `StemCategories` rows
  directly.** `BusId` already has a working, trained, global classifier (Background); Phase 1
  does not re-derive `BusId` guesses from scratch. It generalizes two things about the
  existing mechanism instead:
  1. `recordConfirmedStem` gets called from §2's forward-capture write path (every
     `StemCategories` write, from Tidy Up, backfill, or anywhere else), not only from Tidy
     Up's own `trainCentroids` call site — so one store keeps training from every source of
     confirmed categorization, not just the screen it was first built for.
  2. The same running-centroid-plus-global-Welford-stats architecture gets two sibling
     stores, keyed by `ArrangeRole` and `DrumSubRole` instead of `BusId`, trained the same way
     from the same feature vectors (`getStemFeatures`/`toFeatureArray`/`standardizeFeatures` —
     Background).

  `StemCategories` stays the source-of-truth record of what a human actually confirmed for one
  stem; the centroid stores are the derived, aggregate classifiers trained *from* those
  confirmations — same relationship the `BusId` case already has today. This spec does not
  replace `StemCategories` with the centroid stores; the two serve different purposes and both
  stay (see §9).

### 7. Auto-classification accuracy — Phase 2 (built in the same implementation as Phase 1)

Real learned audio embeddings: YAMNet (14MB, Apache 2.0, official TensorFlow.js export) run
via `onnxruntime-web`, in the renderer, on the same Web-Audio-decoded PCM the existing
analysis caches already work from — no new decode path, no involvement from the native JUCE
engine (this is offline batch analysis, not real-time playback). A new path-keyed cache
(matching `peakCache.ts`'s own convention) stores each stem's embedding vector; nearest-
neighbor search over embeddings then **augments** §6's hand-crafted-feature classification,
rather than replacing it: an embedding-based match is preferred whenever a stem's embedding
has already been computed, with §6's hand-crafted-feature/centroid classification as the
fallback for a stem whose embedding hasn't been extracted yet (first scan of a large library,
or extraction still running in its Web Worker) — the same layered-fallback shape
`resolveStemRole` already uses today (`busId` → `SoundType`), not a new pattern. Both
classification confidence and the discover screen's own ranking (§4) prefer the embedding
result when one exists.

**Originally scoped as a separate future spec, evaluated only after Phase 1 shipped and proved
accuracy was still a real problem — Elling's own call was to build both together instead,**
skipping that "confirm it's needed first" checkpoint in exchange for having the stronger
classifier from day one. What that gives up, worth stating plainly rather than glossing over:
Phase 1 alone (§6) is a small, low-risk addition to code that already exists (`presetNames.ts`,
`busCentroids.ts`); Phase 2 is a genuinely separate subsystem (new WASM runtime dependency,
~14MB model file to bundle, worker-thread plumbing) landing without the checkpoint that would
have confirmed the hand-crafted-feature version wasn't already good enough on its own. The
implementation plan should sequence Phase 2's tasks after Phase 1's are working end-to-end
(Phase 1's classifier needs to exist for Phase 2's fallback path above to have something to
fall back to), but both ship in this one implementation, not a follow-up.

### 8. The discover screen

**SUPERSEDES this section's own original framing below (kept struck-through-in-spirit, not
deleted, so the "seed vs. unprompted" split this replaces is visible in context) — revised
2026-09-15 after live-testing Plan B2 surfaced a much more concrete reference and Elling's own
direct steer on where this belongs in the app. Confirmed by direct code read, not assumed, same
discipline as the rest of this spec.**

**Original framing (superseded):** *A new, standalone screen off the gear menu — separate from
Tidy Up/LibraryBrowser/Auto-Arrange. Seed-based (pick a stem, see compatible library-wide
matches) and unprompted (browse proactively-surfaced combos with no seed) as two distinct
modes; placing a result meant importing and placing ONE stem at a time.*

#### 8.0 Why this changed

Elling's own reference, mid-session, while live-testing Plan B2: Aria Labs' **Upcycle** — a
slot-based loop builder (one stem per category slot, each independently lockable, a "reroll
slot"/"reroll all" mechanic, a chaos↔safe looseness control, and a way to commit the current
loop out to a DAW). This single mechanic elegantly **unifies** the original "seed-based vs.
unprompted" split rather than needing two modes: locking a slot IS the seed concept (pin what
you like, reroll the rest around it), and an all-unlocked grid IS the unprompted case. One
screen, one mechanic, not two.

Also per direct steer: this is **not** a standalone gear-menu screen. "Import" today is exactly
one thing — the `import` button on `Shelf.tsx` (`Shelf.tsx:362-374`, `onOpenLibrary` prop,
wired in `App.tsx:2073`), which calls `openRiffLibrary()` (`App.tsx:1424-1427`) to open
`LibraryBrowser.tsx` (`App.tsx:2184`), the modal that already browses/filters/imports synced
Endlesss/LORE content. Discover becomes a **new tab/mode inside that same modal** ("browse" vs.
"discover"), reached through the existing import button — not a new gear-menu entry alongside
Tidy Up/Auto-Arrange/Draw Arrangement (`App.tsx:695-719`).

`LibraryBrowser.tsx` is already ~2020 lines. Per this spec's own "design for isolation" — and
so Discover doesn't become a fourth thing crammed into an already-large file the way Tidy Up's
own picker outgrew its original 5-button width earlier this session — Discover's own UI lives
in a new sibling component (`DiscoverPanel.tsx`) that `LibraryBrowser.tsx` renders when its own
new tab state selects "discover," not inlined into the existing file.

#### 8.1 The loop builder

A stacked-rack layout (rows, not cards) — matching the row-based pattern every other list in
this app already uses (`ChannelRow`, `ClusterRow`, `LibraryBrowser`'s own riff rows), rather
than introducing a card-grid pattern found nowhere else in sssketch. Confirmed by a real
side-by-side mockup shown to and picked by Elling over a card-grid alternative.

- **Slots**: one stem per slot, each tagged with one of the 8 `ArrangeRole` values
  (`ARRANGE_ROLE_OPTIONS`, `shared/stemRole.ts` — same taxonomy Tidy Up's own picker already
  uses, not a new one). Duplicates allowed (e.g. two `drums` slots for a layered kit). "add
  slot" appends a new, initially-empty slot with a role the user picks from that same 8-value
  set.
- **Lock**: a per-slot toggle. A locked slot survives "reroll all" untouched; an unlocked slot
  gets a fresh candidate. This is the ENTIRE "seed" mechanism from the original framing above —
  no separate seed UI needed.
- **Reroll slot / reroll all**: replaces that slot's (or every unlocked slot's) current stem
  with a freshly-selected candidate — see 8.2 for selection.
- **Target tempo/key**: always the CURRENT project's (`AppState.bpm`, and whatever key/scale
  context the project already carries) — no separate BPM/Key controls on the screen itself,
  unlike Upcycle's own standalone-tool framing. Discover is for building into a project you
  already have open, not a tool used independent of one.
- **Persistence**: the in-progress loop (which slots exist, which are locked, what's currently
  in each) persists for the app session — survives closing and reopening the Discover tab, lost
  on quit. No "Saved Sets" browser (Upcycle has one; out of scope here, YAGNI unless real use
  demonstrates the need).
- **Radial waveforms, not linear ones — reusing `PolarGlyph.tsx`, not a new component.** Direct
  request. Confirmed by code read: this codebase already has exactly this — `PolarGlyph`
  (`components/PolarGlyph.tsx`), a concentric-ring SVG glyph (three band-energy rings —
  bass/mid/treble — plus a pitch-contour line) already in production use for a rifff's own
  identity glyph in `Shelf.tsx:330-334` and `LibraryBrowser.tsx:1892` (a whole riff's `stems`
  array in, one composite glyph out). Each Discover slot renders `<PolarGlyph stems={[stem]}
  identityColor={stemColorVar(stem)} size={...} />` — the single-stem case is already a valid
  input shape, nothing new needed there. `PolarGlyph` itself has no click/scrub interaction of
  its own in either existing call site (the click handling wraps the button/row AROUND it,
  same as `Shelf.tsx`'s own `<button>` wrapper) — Discover's own "click to preview" follows that
  same established pattern rather than porting `Waveform.tsx`'s linear click-to-scrub-by-x-
  position logic, which has no natural radial equivalent. As a bonus this component's own
  `stems: Stem[]` shape already generalizes to "every stem in the loop at once," so an optional
  composite glyph at the top of the panel (all current slots' stems together) is a natural,
  ~zero-new-code extension worth including — one glance at what the whole loop "looks like"
  together, not just each slot individually.

#### 8.2 Candidate ranking and the reroll mechanism

A reroll must not be either extreme: always picking the single best-ranked candidate makes
"reroll" feel broken (nothing changes once you've seen the best option); picking uniformly at
random from every eligible candidate ignores §4's own compatibility ranking entirely (directly
contradicts Elling's own "prioritize stuff that's categorized by hand"). Reroll therefore does
a **weighted-random pick from a ranked top-K pool** — candidates scored by §4's own
compatible+complementary+confidence ranking (key/tempo closeness, role diversity, a
`StemCategories` row outranking an auto-guess), then one is picked from the top K, weighted
toward the higher-ranked end rather than uniformly.

The **Chaos ↔ Safe slider** (from the Upcycle reference) is the user-facing control over this:
"safe" narrows K and steepens the weighting toward the very top of the ranking (closer to
always-best); "chaos" widens K and flattens the weighting (closer to uniform-random across a
looser compatibility bar). This is new selection logic, not a reuse of an existing function —
§4's own ranking function needs to return a scored, orderable candidate LIST (not just a single
best pick) for this to have something to sample from.

#### 8.3 The library-wide candidate query — the largest genuinely new piece of this plan

Confirmed by direct code read: **no existing function already answers "compatible candidates,
library-wide, filterable by role."** `listRiffs(jamCID, filters)` (`riffLibraryStore.ts:255`)
is scoped to exactly one jam (`WHERE OwnerJamCID = ?`, via `dbForJam(jamCID)`) and its
`RiffFilters` (`shared/riffLibraryTypes.ts:78-104`) — `bpmMin/bpmMax`, `root/scale`, `userName`,
`onlyContainsUser` — has no `BusId`/`ArrangeRole` filter at all, because `listRiffs` never joins
against `StemCategories` (that table is only ever read per-stem, via
`getStemCategory(db, stemCID)`, `stemCategoriesStore.ts:147`). Building Discover's candidate
pool needs genuinely new code:

1. Enumerate every synced jam (`listJams()`), not one.
2. Per jam, join `Stems`/`Riffs` against `StemCategories` (role + confidence) and, per §7, 
   `StemEmbeddingCache` (embedding, when present) — reusing `getConfirmedEmbeddings`'s own
   per-axis query shape (`main/embeddingMatch.ts`) as the closest existing precedent for a
   bulk `StemCategories`-joined read, even though that function itself is scoped to
   confirmed+embedded rows only and would need a sibling, not a direct reuse, for "every stem
   with at least a role guess."
3. Filter by ownership, reusing `computeOwnerFraction` (`riffLibraryTypes.ts:168-175`) exactly
   as `listRiffs` already does (`riffLibraryStore.ts:341`) and as `LibraryBrowser.tsx:824`
   already exposes via its own "only my stems" toggle (`onlyContainsMe`) — same mechanism, same
   default-on-for-safety posture as §5.
4. Filter/score by BPM/key closeness against the current project's own values (8.1).

This is real, non-trivial backend work — the implementation plan should give it its own
dedicated phase, sequenced before the UI that consumes it (same "don't build the picker before
the data it picks from exists" ordering §7 already used for Phase 1 vs. Phase 2).

#### 8.4 Placing a loop — "plunk in arranger"

Adds the current loop **alongside** whatever's already on the current timeline (confirmed
directly, not assumed to be "replace" or "new project") — as one new group of stems, not
touching anything already placed.

Confirmed by direct code read: there is **no existing single-call mechanism for placing several
stems as one cohesive unit.** `pasteStemAction`/`pasteStemWindowAction`
(`state/selectors.ts:579-668`) each take one `(state, sourceGroupId, slot, startBar[,
barLength])` and build a `Rifff` with exactly one stem; `PLACE_ON_TIMELINE`
(`state/store.ts:348`, reducer `:569-586`) takes one `groupId`. Placing a multi-stem loop today
would mean N separate dispatches, one per stem — and per this codebase's own established
convention (`ASSIGN_STEMS_TO_BUS`, `store.ts:351,633-638`, added specifically so confirming a
whole Tidy Up cluster is one undo step, not one per stem — commit `2fa4995`), undo granularity
is exactly "one dispatched action," full stop. Plunking a 4-slot loop as N separate
`PASTE_RIFFF`/`PLACE_ON_TIMELINE` dispatches would cost 4+ undo steps for what should read as
one build action. This needs a **new batch action type** (e.g. `PLACE_LOOP_ON_TIMELINE`,
carrying every locked/rerolled slot's stem + its own target slot/channel) so plunking a loop is
one undo step — new reducer work, not a reuse of the existing single-stem path.

#### 8.5 Scan consent and progress

The one screen that genuinely needs features/embeddings for stems nobody has ever placed on any
timeline, so this is where the ambient background scan (§9 — built for PLACED stems only in the
Plan A/B2 foundation work) would need to extend to the whole synced library. Per Elling's own
direct requirement, raised live while testing Plan B2's placed-stems-only scan: **a whole-
library scan is a different order of magnitude (his own library: 52,493 stems) and must not
start silently the way the small, placed-stems-only scan does.**

- **When**: a one-time consent prompt the first time the "discover" tab is opened, before any
  whole-library scan starts. Accepted once, never asked again (a settings-menu toggle,
  alongside the gear/settings menu's existing "change save location"/"change riff archive
  location" items, `TransportBar.tsx:689-740`, lets it be turned off/on again later).
- **Declining**: Discover stays usable, but its candidate pool is limited to whatever's already
  been analyzed from ordinary placed-stem use (§9's existing small scan) — never a silent
  full-library scan. A visible, plain-language note explains why results are limited and how to
  turn scanning on.
- **Progress, once accepted**: an ambient, non-blocking "analyzed X of Y in scope" indicator
  (the one piece of Upcycle's own UI kept close to verbatim — its bottom-bar analysis-progress
  readout is a good, proven pattern for exactly this) — not a blocking spinner; the loop builder
  works throughout with whatever's already analyzed, same layered-fallback posture §7 already
  established (embedding → centroid → preset name → SoundType default) for a single stem's own
  classification.

#### 8.6 Error and empty states

- A slot with no qualifying candidate (chaos/safe set too tight, or genuinely nothing
  compatible exists yet) shows a clear "no match" state, not a crash or a silently-stuck
  spinner — "reroll slot" simply retries against the same query.
- If scanning was declined (or hasn't had time to run) and the candidate pool for a role is
  entirely empty, the empty state says so explicitly ("nothing analyzed yet for this role") —
  distinct from "no match," so a brand-new/cold-start user understands *why*, not just an empty
  row.

#### 8.7 Non-goals (this section specifically)

- No Upcycle-style "Saved Sets" (multiple named, persisted loop configurations) — session
  persistence (8.1) is the whole of what's built here.
- No independent BPM/Key controls on the Discover tab itself (8.1) — always the current
  project's.
- No manual candidate-pool tuning UI beyond the Chaos↔Safe slider (8.2) — no separate
  key-tolerance/tempo-tolerance controls, at least for a first version.

### 9. Phase 3 — consolidating overlapping analysis infrastructure (ongoing priority)

Elling's own framing, worth stating as a standing principle rather than a one-off note: as
sssketch keeps growing, merging pre-existing similar processes and scans should be treated as
a priority whenever new analysis work is being designed — not a someday cleanup task, and not
something to defer to "after it ships." §6 above is itself the first real application of that
discipline, not a future intention: it was written by first checking whether Phase 1's
proposed classifier already existed in some form (it did, for `BusId`) and extending that
instead of adding a second one next to it. This section documents what's now confirmed shared,
what's confirmed genuinely separate and should stay that way, and what to re-check the next
time analysis/matching code is proposed anywhere in this app.

**Already unified — build on these, don't reintroduce them:**
- **Feature extraction**: `getStemFeatures`/`StemFeatures`/`toFeatureArray`/
  `standardizeFeatures` (`stemFeatures.ts` + `stemFeaturesCache.ts`) is the one real
  audio-content signal in this codebase. Tidy Up's clustering, Auto-Arrange's density/fill
  scoring, and this spec's own Phase 1/Phase 2 classifiers (§6/§7) all consume it. Any future
  per-stem analysis feature should extend this pipeline (a new derived value on `StemFeatures`,
  or a new cache alongside `stemFeaturesCache.ts` decoding the same audio) before reaching for
  a fresh decode-and-analyze path of its own.
- **Cross-project classification**: `busCentroids.ts`'s running-centroid architecture, already
  proven live in Tidy Up for `BusId`, is what §6 extends to `ArrangeRole`/`DrumSubRole` rather
  than duplicating. Any future "guess a category for something new based on what's been
  confirmed before" need in this app should be asked against this same architecture first.
- **Scan orchestration — real, in-scope work for this spec, not just a note.** Beyond sharing
  `getStemFeatures` itself, `AutoArrangeRoleStep.tsx` and `ClusterStemsBrowser.tsx` each
  independently re-implement the identical wrapper around it: a `useEffect` running
  `Promise.allSettled(stems.map(s => getStemFeatures(s.path)...))`, the same "analyzing N
  stems…" loading state, and the same `Promise.allSettled`-not-`Promise.all` reasoning (one bad
  stem's rejection shouldn't block every other stem's analysis). The discover screen (§8) needs
  this exact same orchestration to run §6's nearest-centroid classification over its own
  candidate pool — a third consumer of the identical pattern, not a hypothetical future one.
  This spec's implementation extracts a shared hook (e.g. `useStemFeatureScan(stems)`,
  returning `{loading, featuresByPath}` or equivalent) that all three screens use, each keeping
  its own downstream step on top — density/fill scoring, clustering, or nearest-centroid
  classification respectively. `AutoArrangeRoleStep.tsx` and `ClusterStemsBrowser.tsx` get
  migrated onto it as part of this work, not left duplicated alongside a third copy.
- **Persistent, cross-session feature caching — extending the same unification, not a separate
  system.** `getStemFeatures` (`stemFeaturesCache.ts`) today caches only in renderer memory
  (a plain `Map`, wiped on every reload) — so even with the shared scan hook above, EVERY fresh
  app session re-decodes and re-analyzes a stem the first time any screen touches it. Elling's
  own framing: individual screens shouldn't each have "their own scanning feature" at all, not
  even a shared-but-still-per-screen-triggered one — stems should be scanned once, ever, ahead
  of any screen needing them, so opening Tidy Up/Auto-Arrange/discover doesn't visibly wait on
  analysis at all in the common case. This means `getStemFeatures`'s cache moves from
  renderer-memory-only to a durable, library-wide store (a new `StemFeatureCache` table in the
  same `warehouse.db3`, keyed by `StemCID` — same home as `StemCategories`, same per-stem-row
  shape) that `getStemFeatures` checks first, computing (and persisting) only on a genuine
  miss. A stem whose `path` doesn't resolve to a real `StemCID` (a locally-dropped file,
  one-shot, or in-app recording — see §1's own `StemCID`-derivation discussion) has nothing to
  key persistence by, so it keeps today's renderer-memory-only behavior; this only changes
  anything for real library stems.

  Persistence alone only helps once a stem has been scanned at least once, though — the
  visible first-time wait Elling wants gone entirely still needs something to trigger
  extraction BEFORE a screen needs it, not just remember the result after. An ambient,
  app-wide background pass — mounted once at the top level, independent of whether Tidy Up or
  Auto-Arrange happen to be open — proactively calls `getStemFeatures` for every stem currently
  placed on the timeline that isn't cached yet, lightly throttled so it doesn't compete with
  real interaction. By the time a user actually opens Tidy Up or Auto-Arrange, whatever's
  already on the timeline has typically been scanned and persisted already, and the shared
  hook's own loading state resolves instantly (cache hit) rather than triggering a visible
  wait. This is deliberately scoped to PLACED stems, not the whole synced library (which can
  run to thousands of stems never placed on any timeline) — scanning the entire library ahead
  of time is the discover screen's own concern (§8), since library-wide candidates are the
  first place this app actually needs features for stems nobody has placed anywhere yet; it
  reuses this exact same persistent store and extends the background pass to the whole
  library rather than building a second caching mechanism. Unlike this section's own
  placed-stems-only pass, that library-wide extension is NOT silent — see §8.5 for the
  one-time consent prompt this specifically requires (raised directly by Elling during
  Plan B2's own live testing, after this smaller placed-stems-only pass was already shipped
  and working silently, precisely because a whole-library pass is a different order of
  magnitude of cost).

**Confirmed genuinely separate, and should stay that way — this is not something to force
together:** Tidy Up's `agglomerativeCluster.ts` (average-linkage agglomerative clustering,
explicitly documented as O(n³), "fine for realistic stem counts (a few hundred at most)") and
this spec's own library-wide nearest-centroid matching are not the same algorithm doing the
same job with different names — they solve genuinely different problems at genuinely different
scales. Tidy Up clusters everything currently on one project's timeline (at most a few hundred
stems) with no prior labels at all. Discover matches one query against a whole library
(potentially thousands of stems) that already has *some* labeled examples to classify against.
The shared feature vectors make both possible; the O(n³) clustering algorithm itself does not
scale to the second problem, and the centroid/nearest-neighbor approach doesn't solve the
first (it needs labeled examples to compare against, which is exactly what Tidy Up's raw
timeline doesn't have yet). Keep both algorithms — don't try to unify them into one just
because they now share a feature pipeline underneath.

**Left for a future look, not solved here:** Re-one (loop-start/downbeat detection,
`BeatPicker.tsx`) is a related but genuinely different analysis problem — onset/rhythm
detection, not timbral classification — that deserves the same "check for reuse before
building new" scrutiny in its own future design, but isn't something this spec's own
techniques (timbral/spectral feature classification) directly solve. Noted here so it isn't
lost, not proposed as in scope for this spec.

## Non-goals

- **No manual `StemCategories` editing UI.** It's a byproduct of normal Tidy Up/Auto-Arrange
  use (§2/§3), not a new standalone tagging interface.
- **No cross-machine sync** of the new table — local to whichever `warehouse.db3` a user
  already has, same as everything else in `riffLibraryStore.ts` today.
- **No role/drum-sub-role backfill** — established in Background/§3 as genuinely impossible,
  not merely deferred.

## Testing

`StemCategories` read/write functions, the backfill migration's conflict resolution, the
`PresetName` keyword matcher, the centroid classifiers (§6), the embedding nearest-neighbor
search and its augment/fallback selection logic (§7), and the compatibility-ranking function
are all real `src/shared/`-or-`src/main/`-style pure/testable logic — TDD'd per this
codebase's convention, same as Phase 1's classifier. §8's own new additions split the same way:
the library-wide candidate query (§8.3, `src/main/`) and the weighted-top-K reroll selection
(§8.2, `src/shared/`) are pure/testable logic and get real tests; the new `DiscoverPanel.tsx`
UI (slots, lock, reroll, the Chaos↔Safe slider) and the new `PLACE_LOOP_ON_TIMELINE` batch
reducer action (§8.4 — the reducer case itself is testable store logic, same convention as
`ASSIGN_STEMS_TO_BUS`'s own test coverage; only the UI that dispatches it is
typecheck+lint-only) are typecheck+lint-verified only, per this codebase's standing convention
for React components with no way to click-test a discovery/browsing flow in this environment —
needs Elling's own manual walkthrough, same as every other UI feature built this session.

**Phase 2 (§7) specifically** — the actual YAMNet extraction and `onnxruntime-web` integration
is Electron/Web-Worker-dependent, real-model-loading code, not pure logic: per this codebase's
convention for things a coding agent can't automate (real plugin scanning, live playback —
root `CLAUDE.md`'s Testing conventions), extraction accuracy and worker-thread behavior need
Elling's own manual walkthrough against real library stems, not a mocked model. The nearest-
neighbor comparison logic *over* an embedding vector, once extracted, is ordinary pure logic
and gets normal unit tests same as §6's classifiers.

The §9 `useStemFeatureScan` extraction carries real regression risk of its own: it's not new
code, it's a refactor of the scan step inside two already-shipped, working screens (Tidy Up,
Auto-Arrange). Typecheck+lint-verified only, same as the rest of this spec's UI work — but
Elling's manual walkthrough of this spec explicitly needs to confirm both Tidy Up's clustering
and Auto-Arrange's role step still analyze stems and reach their "analyzing stems..." →
results transition exactly as before, not just that the new discover screen works.
