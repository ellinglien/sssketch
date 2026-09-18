# Discover Trait-Based Matching — Design

**Goal:** Replace Discover's candidate matching — today entirely gated by a
discrete `ArrangeRole` resolved through a fallible embedding classifier —
with two cheap, reliable signals instead: Endlesss's own performer-set
instrument mask (drums/bass/notes — ground truth, free to read) wherever
it applies, and a small set of continuous audio traits already sitting in
`StemFeatureCache` (bass-heavy, rhythmic, bright/warm) for everything the
mask can't cover (audioIn, unmasked). No embedding comparison, no
classifier, anywhere in Discover's own matching path.

**Architecture:** A new `DiscoverSlotKind` type replaces `DiscoverSlot.role:
ArrangeRole`:

```ts
type DiscoverSlotKind =
  | 'drums' | 'bass' | 'lead'              // mask-filtered
  | 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'  // trait-filtered
```

`drums`/`bass`/`lead` candidates are filtered directly by the Endlesss
`Instrument` bitmask column on `Stems` (drums bit, bass bit, notes bit
respectively) — a plain integer check, no `StemFeatureCache` dependency at
all, so it works for every synced stem regardless of feature-scan progress.
`bassHeavy`/`rhythmic`/`bright`/`warm` candidates are drawn ONLY from stems
the mask can't confidently place (audioIn-masked or unmasked) — the three
mask-based slots already own every reliably-drums/bass/notes-masked stem, so
the trait slots never compete with them for the same content — and ranked by
the relevant `StemFeatureCache` column. A stem still needs exactly one
`ArrangeRole`/`BusId` at the point it's placed into the timeline
(autoArrangeEngine's diversity weighting and DAW export both depend on it) —
a fixed `DiscoverSlotKind -> ArrangeRole` table handles that at placement
time; for the 3 mask-based kinds this mapping is exact identity (`drums ->
drums`, `bass -> bass`, `lead -> lead`), since the mask bit already IS the
right answer.

**Tech Stack:** No new dependencies. Reuses the `Instrument` mask column
(already synced) and `StemFeatureCache` (already populated by the existing
background feature-extraction scan) — every signal this feature reads
already exists today.

---

## Background

A long live-debugging session (2026-09-18) traced Discover's "wrong stuff in
the wrong slot" complaints to their real root: `getDiscoverCandidates`'s
candidate pool is filtered entirely by a discrete `ArrangeRole`, itself
resolved by an embedding-similarity classifier trained against a small,
occasionally-contaminated confirmed pool. A same-day fix (instrument-mask
short-circuit for `stemAutoClassify.ts` — trust the mask directly for
drums/bass/notes, skip the fallible embedding guess for those) meaningfully
improved but did not eliminate the problem for DISCOVER specifically, since
Discover's own candidate query still widens its pool with (still-fallible)
`StemAutoCategory`/embedding-derived rows on top of mask-matched ones. A
later example showed a 6-slot build where 5 of 6 slots held content Elling
identified by ear as "actually drums," regardless of their assigned role.

Elling's own reframing: "maybe instead of a specific type of stem, we try to
do it some other way... something the app is clearly good at finding...
strong bass, rhythmic... stuff like that" — followed by a direct, repeated
priority on cost ("if it means trimming the processing time a lot we can go
that way," "again, a focus on speed would be ideal... using what would be
cheap and fast"). A first pass at this design went ALL-IN on continuous
traits, dropping the mask entirely — Elling's own correction: "maybe I'm
throwing the baby out with the bathwater here... using Endlesss's mappings
directly whenever they're reliable would be fine too, and that'd be
cheap... so Endlesss: drums, notes, bass would be easy to link up" — landing
on this hybrid: mask first wherever it's reliable, traits only for what's
left.

## Slot kinds (v1: 3 mask-based + 4 trait-based)

| Slot kind | UI label | Filter | Source |
|---|---|---|---|
| `drums` | drums | `Instrument` mask, drums bit | `Stems.Instrument` (already synced) |
| `bass` | bass | `Instrument` mask, bass bit | `Stems.Instrument` |
| `lead` | lead | `Instrument` mask, notes bit | `Stems.Instrument` — labeled "lead" (familiar vocabulary, matches `SOUND_TYPE_TO_ARRANGE_ROLE.notes`), not raw "notes" |
| `bassHeavy` | bass-heavy | `bassEnergyRatio`, ranked descending | `StemFeatureCache` |
| `rhythmic` | rhythmic | `transientDensity`, ranked descending | `StemFeatureCache` |
| `bright` | bright | `spectralCentroidHz`/`zcrBrightness`, ranked toward the high end | `StemFeatureCache` |
| `warm` | warm | same field as `bright`, ranked toward the low end — one axis, two opposite targets, not two independent measurements | `StemFeatureCache` |

`audioIn` is deliberately excluded from the mask-based slots — direct
correction from the same debugging session: "audio in stems can indeed be
drums though, so no" — it's not a reliable signal by itself, so audioIn-
masked stems fall through to the trait-based slots instead, same as
genuinely unmasked ones.

Deliberately NOT included in v1, but cheap to add later off the same cache
(noted for the backlog, not built now):
- `tonal` ← `voicedFraction` (clear pitch vs. noise/percussive content —
  the natural place a future "vocal-ish" trait would live, since `vocal`
  itself isn't one of the 3 reliable mask categories)
- `wobbly`/`steady` ← `pitchVarianceCents` (pitch stability)

A stem with no cached `StemFeatureCache` row yet is simply not a candidate
for any TRAIT-based slot until the existing background feature-scan catches
up to it — same "absent = not yet eligible" convention
`BASE_ELIGIBILITY_WHERE` already uses elsewhere in this codebase. This does
NOT affect the 3 mask-based slots at all, since they never touch
`StemFeatureCache` — a freshly-synced, not-yet-feature-scanned drums-masked
stem is still immediately eligible for the `drums` slot.

## Behavior

- **Slot creation**: the current per-role "+ drums / + bass / + lead / +
  backing / + aux / + textureFx / + fill / + vocal" button row (8 buttons)
  becomes "+ drums / + bass / + lead / + bass-heavy / + rhythmic / + bright
  / + warm" (7 buttons). Clicking one creates a slot of that kind and rolls
  it immediately, same interaction shape as today — only the label set
  changes.
- **Candidate pool**: `drums`/`bass`/`lead` slots query `Stems.Instrument`
  directly (a plain mask-bit check, same shape as
  `instrumentMaskCentroidBackfill.ts`'s own eligibility query) — no
  `StemAutoCategory`/embedding widening at all. `bassHeavy`/`rhythmic`/
  `bright`/`warm` slots query `StemFeatureCache`, restricted to stems whose
  own mask is EITHER `audioIn` OR unset (never drums/bass/notes-masked —
  those already belong to the 3 mask slots above, so the two candidate
  pools never overlap). Both respect the existing "only my stems"/
  favourites toolbar toggles unchanged.
- **Ranking**: `drums`/`bass`/`lead` slots rank by BPM closeness only,
  exactly as today (no change to `rankCandidates` needed for these three).
  `bassHeavy`/`rhythmic`/`bright`/`warm` slots add a second scoring term —
  normalized distance-from-target on the slot's own trait field, combined
  with the existing BPM-closeness term (same additive-score-with-tunable-
  weight shape already used for `FAVOURITE_BOOST`). There's no per-slot
  numeric dial in v1 — a trait slot always targets the extreme of its own
  field's real observed range ("give me more of this trait"), matching the
  simple button-based interaction of the mask slots.
- **Similar/adjacent/random**: same three buttons on every slot kind, same
  underlying pool/ranking rules as slot creation above — "similar" on a
  `drums` slot still means "another drums-masked stem, closest BPM"; on a
  `bassHeavy` slot it means "another audioIn/unmasked stem, closest on
  bassEnergyRatio (+ BPM)." No new UI beyond the slot-kind label change.
- **Export/placement**: when a slot's stem is added to the shelf or
  timeline, `DiscoverSlotKind -> ArrangeRole` assigns the role
  autoArrangeEngine/DAW export require. For the 3 mask-based kinds this is
  exact identity (`drums -> drums`, `bass -> bass`, `lead -> lead`) — the
  mask bit already IS the correct answer, no approximation. For the 4
  trait-based kinds it's a fixed, approximate table (`bassHeavy -> bass`,
  `rhythmic -> drums`, `bright -> lead`, `warm -> aux`) — same "cheap,
  good-enough, not perfect" tradeoff as the instrument-mask short-circuit
  shipped earlier the same day, not a new classifier.

## Data flow

```
Stems.Instrument (already synced)          StemFeatureCache (already populated)
        |                                            |
        v                                            v
  drums/bass/lead slots:                    bassHeavy/rhythmic/bright/warm
  direct mask-bit filter                    slots: audioIn/unmasked pool,
        |                                    ranked by the relevant field
        v                                            |
  rankCandidates (BPM only,                          v
  unchanged for these 3)                    rankCandidates (BPM + new
        |                                    trait-distance term)
        |                                            |
        +--------------------+---------------------+
                              |
                              v
              DiscoverSlot.kind: DiscoverSlotKind
              (renamed/retyped from .role: ArrangeRole)
                              |
                              v  (only at add-to-shelf/add-to-timeline)
              DiscoverSlotKind -> ArrangeRole
              (identity for the 3 mask kinds, a fixed
              approximation table for the 4 trait kinds)
                              |
                              v
    existing ArrangeRole/BusId-consuming code (autoArrangeEngine,
    DAW export) -- UNCHANGED
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
- `getInstrumentMatchedStemCIDs`'s underlying IDEA (mask-bit filtering)
  survives and is central to this redesign — but its CALL SHAPE changes:
  today it's one of three pool-widening sources merged with
  `StemCategories`/`StemAutoCategory` results; in the new design, for
  `drums`/`bass`/`lead` slots, the mask filter IS the whole pool, with no
  `StemAutoCategory`/embedding widening layered on top at all.
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

- A stem with no `StemFeatureCache` row: excluded from every trait-based
  slot's candidate pool (see "Slot kinds" above) — never a crash. The 3
  mask-based slots are unaffected by this at all.
- `DiscoverSlotKind -> ArrangeRole` mapping is a plain, total function
  (every kind has exactly one entry) — no fallback/null case to handle.

## Testing

- `discoverRanking.ts`'s new trait-distance term: pure function, unit
  tested the same way `rankCandidates`'s existing BPM term already is
  (`discoverRanking.test.ts`).
- `getDiscoverCandidates`'s rewritten query: unit tested against
  `discoverCandidates.test.ts`'s existing `:memory:` db fixture pattern.
  Mask-based slots get simple `Instrument`-bit fixture tests (mirroring
  `instrumentMaskCentroidBackfill.test.ts`'s own style); trait-based slots
  get `StemFeatureCache`-seeded fixture tests. A test proving the two pools
  never overlap (a drums-masked stem never appears as a `bassHeavy`
  candidate, an audioIn-masked stem never appears as a `drums` candidate)
  is worth having explicitly, given that invariant is the whole point of
  the split.
- `DiscoverSlotKind -> ArrangeRole` mapping: a trivial table, tested with
  one assertion per kind (including the 3 identity mappings).
- React component changes (`DiscoverPanel.tsx`'s button row,
  `DiscoverSlotRow.tsx`'s label): verified via typecheck + lint + manual
  walkthrough, per this codebase's own established convention — no new
  automated UI tests.

## Deferred / explicitly out of scope

- The two additional cheap traits (`tonal`, `wobbly`/`steady`) — noted
  above, not built in this pass.
- A per-slot numeric target dial (e.g. "somewhat bass-heavy" vs. "extremely
  bass-heavy") — v1 only ever targets the extreme end of a trait's field.
- Any change to `discoverAdjacency.ts`'s own candidate scoping beyond what
  the implementation plan finds strictly necessary to keep it working
  against the new slot shape.
- Re-deriving/improving `stemAutoClassify.ts`'s classifier itself — this
  redesign routes around it for Discover's own matching, it doesn't fix or
  replace it for Tidy Up/export.
