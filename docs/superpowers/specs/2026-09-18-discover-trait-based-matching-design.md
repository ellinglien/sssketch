# Discover Trait-Based Matching — Design

**Goal:** Replace Discover's discrete-ArrangeRole candidate matching (drums/
bass/lead/backing/aux/textureFx/fill/vocal, resolved by a fallible embedding
classifier) with matching on a small set of cheap, already-cached, continuous
audio traits — bass-heavy, rhythmic, bright/warm — so a slot's candidates are
ranked by real, explainable closeness on a trait that's basically free to
compute, rather than a discrete guess that's frequently wrong.

**Architecture:** A new `DiscoverTraitTag` type (`'bassHeavy' | 'rhythmic' |
'bright' | 'warm'`), distinct from the existing `ArrangeRole` used elsewhere
in the app (Tidy Up, auto-arrange, DAW export). `DiscoverSlot.role: ArrangeRole`
becomes `DiscoverSlot.trait: DiscoverTraitTag`. Candidate selection and
ranking read straight off `StemFeatureCache`'s already-cached numeric columns
(`bassEnergyRatio`, `transientDensity`, `spectralCentroidHz`/`zcrBrightness`)
— no embedding comparison, no classifier, no new background scan. A stem
still needs exactly one `ArrangeRole`/`BusId` at the point it's actually
placed into the timeline (autoArrangeEngine's diversity weighting and DAW
export both depend on it) — a fixed `DiscoverTraitTag -> BusId` table handles
that translation at placement time, not before.

**Tech Stack:** No new dependencies. Reuses `StemFeatureCache` (already
populated by the existing background feature-extraction scan) as the sole
data source — this whole feature reads columns that already exist.

---

## Background

A long live-debugging session (2026-09-18) traced Discover's "wrong stuff in
the wrong slot" complaints to their real root: `getDiscoverCandidates`'s
candidate pool is filtered entirely by a discrete `ArrangeRole`, itself
resolved by an embedding-similarity classifier trained against a small,
occasionally-contaminated confirmed pool. A same-day fix (instrument-mask
short-circuit for stemAutoClassify.ts) meaningfully improved but did not
eliminate the problem — a later example showed a 6-slot build where 5 of 6
slots held content Elling identified by ear as "actually drums," regardless
of their assigned role.

Elling's own reframing: "maybe instead of a specific type of stem, we try to
do it some other way... something the app is clearly good at finding...
strong bass, rhythmic... stuff like that" — followed by a direct, repeated
priority on cost ("if it means trimming the processing time a lot we can go
that way," "again, a focus on speed would be ideal... using what would be
cheap and fast").

Investigation found `discoverRanking.ts`'s `rankCandidates` scores candidates
on BPM closeness ONLY — no audio-similarity signal is used for ranking today,
despite `StemFeatureCache` already holding exactly the kind of continuous,
cheap descriptors ("strong bass" = `bassEnergyRatio`, "rhythmic" =
`transientDensity`) this reframing asks for. The discrete role filter was
doing 100% of the "relevance" work upstream of that ranking, and it's the
part that's unreliable.

## Tags (v1: exactly 3, confirmed)

| Tag | Source field | What it means |
|---|---|---|
| `bassHeavy` | `bassEnergyRatio` (StemFeatures) | High low-frequency energy relative to the rest of the spectrum |
| `rhythmic` | `transientDensity` (StemFeatures) | High density of sharp onsets/transients — percussive, pulse-driven material |
| `bright` / `warm` | `spectralCentroidHz` or `zcrBrightness` (StemFeatures) | One spectral-brightness axis, two poles — `bright` targets the high end, `warm` targets the low end of the SAME underlying measurement, not two independent tags |

Deliberately NOT included in v1, but cheap to add later off the same cache
(noted for the backlog, not built now):
- `tonal` ← `voicedFraction` (clear pitch vs. noise/percussive content)
- `wobbly`/`steady` ← `pitchVarianceCents` (pitch stability)

A stem with no cached `StemFeatureCache` row yet (not extracted) is simply
not a candidate for ANY trait until the existing background feature-scan
catches up to it — same "absent = not yet eligible" convention
`BASE_ELIGIBILITY_WHERE` already uses elsewhere in this codebase, no new
"pending" UI needed.

## Behavior

- **Slot creation**: the current per-role "+ drums / + bass / ..." button
  row is replaced with "+ bass-heavy / + rhythmic / + bright / + warm" (4
  buttons for 3 tags, since bright/warm are opposite targets on one axis).
  Clicking one creates a slot targeting that tag and rolls it immediately,
  same interaction shape as today — only the label vocabulary changes.
- **Candidate pool**: for a `bassHeavy`-targeting slot, candidates are every
  stem with a cached `StemFeatureCache` row (subject to the same
  "only my stems"/favourites toggles already in Discover's toolbar) —
  no upstream filter by any discrete category at all. `rhythmic`/`bright`/
  `warm` slots work the same way, each keyed to its own source field.
- **Ranking**: `rankCandidates` gets a second scoring term — normalized
  distance-from-target on the slot's own trait field, combined with the
  existing BPM-closeness term (same additive-score-with-tunable-weight
  shape already used for `FAVOURITE_BOOST`). "Target" for a fresh roll is
  the extreme of the relevant field's real observed range (e.g. `bassHeavy`
  ranks by raw `bassEnergyRatio` descending) — there's no per-slot numeric
  dial in v1, just "give me more of this trait," matching the button-based
  interaction of today's role buttons.
- **Similar/adjacent/random**: same three buttons, same meaning shift as
  slot creation — "similar" now means "close on this slot's own trait value
  to what's currently loaded," not "same discrete role." No new UI.
- **Export/placement**: when a slot's stem is added to the shelf or
  timeline, `DiscoverTraitTag -> BusId` (a fixed table: `bassHeavy -> bass`,
  `rhythmic -> drums`, `bright -> lead`, `warm -> aux`) assigns the
  `ArrangeRole`/`BusId` autoArrangeEngine and DAW export already require —
  same "cheap, good-enough, not perfect" tradeoff as the instrument-mask
  short-circuit shipped earlier the same day, not a new classifier.

## Data flow

```
StemFeatureCache (existing, already populated)
        |
        v
getDiscoverCandidates (rewritten: no ArrangeRole filter, no
StemAutoCategory/instrument-mask candidate widening -- every stem with a
StemFeatureCache row is eligible for every trait)
        |
        v
rankCandidates (existing BPM term + new trait-distance term)
        |
        v
DiscoverSlot.trait: DiscoverTraitTag (renamed/retyped from .role: ArrangeRole)
        |
        v  (only at add-to-shelf/add-to-timeline)
DiscoverTraitTag -> BusId (new fixed table)
        |
        v
existing ArrangeRole/BusId-consuming code (autoArrangeEngine, DAW export) --
UNCHANGED
```

## What does NOT change

- `ArrangeRole`, `BusId`, `SOUND_TYPE_TO_ARRANGE_ROLE`, `ARRANGE_ROLE_TO_BUS`,
  Tidy Up's own role picker (`ClusterStemsBrowser.tsx`), the auto-arrange
  role-confirmation step (`AutoArrangeRoleStep.tsx`), and
  `stemAutoClassify.ts`'s whole classification pipeline (including today's
  instrument-mask short-circuit) — all untouched. This redesign is scoped to
  how DISCOVER selects and ranks candidates; the rest of the app's role
  taxonomy and classification machinery keeps working exactly as it does
  today for Tidy Up/auto-arrange/export.
- `discoverAdjacency.ts`'s temporal-adjacency browsing (`findRiffForStemPath`
  et al.) — still resolves a role today via `resolveStemArrangeRole`; this
  spec doesn't require changing that call site's OWN candidate-scoping logic
  beyond whatever a later plan finds necessary to keep it consistent with
  the new slot shape (flagged as a real integration point for the
  implementation plan to work out file-by-file, not resolved here).
- The persisted riff/instrument-index cache, startup gate, background-scan
  concurrency fix, and "+sample" button shipped earlier the same day — all
  independent of this change.

## Error handling

- A stem with no `StemFeatureCache` row: excluded from every trait's
  candidate pool (see "Tags" above) — never a crash, never a "0 candidates"
  dead end unless genuinely nothing in the library has been feature-scanned
  yet (same as today's "library not yet scanned" experience).
- `DiscoverTraitTag -> BusId` mapping is a plain, total function (every tag
  has exactly one entry) — no fallback/null case to handle.

## Testing

- `discoverRanking.ts`'s new trait-distance term: pure function, unit
  tested the same way `rankCandidates`'s existing BPM term already is
  (`discoverRanking.test.ts`).
- `getDiscoverCandidates`'s rewritten (trait-based, not role-based) query:
  unit tested against `discoverCandidates.test.ts`'s existing `:memory:`
  db fixture pattern, extended with `StemFeatureCache` rows instead of
  `StemCategories`/`StemAutoCategory`/`Instrument` mask rows.
  `getInstrumentMatchedStemCIDs`/instrument-mask-widening logic in that
  file is removed entirely for Discover's own candidate query (it's a
  role-based concept this redesign replaces) — NOT removed from
  `stemAutoClassify.ts`, which keeps using the mask for its own,
  unrelated purpose (Tidy Up/export role assignment).
- `DiscoverTraitTag -> BusId` mapping: a trivial table, tested with one
  assertion per tag.
- React component changes (`DiscoverPanel.tsx`'s button row,
  `DiscoverSlotRow.tsx`'s label): verified via typecheck + lint + manual
  walkthrough, per this codebase's own established convention — no new
  automated UI tests.

## Deferred / explicitly out of scope

- The two additional cheap tags (`tonal`, `wobbly`/`steady`) — noted above,
  not built in this pass.
- A per-slot numeric target dial (e.g. "somewhat bass-heavy" vs. "extremely
  bass-heavy") — v1 only ever targets the extreme end of a trait's field.
- Any change to `discoverAdjacency.ts`'s own candidate scoping beyond what
  the implementation plan finds strictly necessary to keep it working
  against the new slot shape.
- Re-deriving/improving `stemAutoClassify.ts`'s classifier itself — this
  redesign routes around it for Discover's own matching, it doesn't fix or
  replace it for Tidy Up/export.
