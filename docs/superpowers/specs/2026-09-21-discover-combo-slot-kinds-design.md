# Discover: combination slot kinds — design

Date: 2026-09-21
Status: approved in brainstorming, awaiting spec review

## Goal

Let a Discover slot target more than one kind at once — Elling's own example: "warm and
rhythmic." Also fixes a reported bug: unticking "endlesss sounds" still returns Endlesss
drums, because mask kinds ignore the sound-source filter by design.

Builds on the single-kind architecture in
`2026-09-18-discover-trait-based-matching-design.md`.

## Semantics — one rule for every combination

- **Mask kinds (drums / bass / lead) are filters, combined with OR.** `drums + bass` = a drum
  stem *or* a bass stem.
- **Trait kinds (bass-heavy / rhythmic / bright / warm) are rankings, combined with AND.**
  `warm + rhythmic` = scores high on both; per-trait scores are summed.
- **Mixed = filter, then rank.** `drums + warm` = drum stems, warmest first.
- **bright and warm are mutually exclusive.** They are opposite targets on the same field
  (`spectralCentroidHz`); selecting one deselects the other.

## Data model

- A slot's `kind: DiscoverSlotKind` becomes `kinds: DiscoverSlotKind[]` — non-empty, no
  duplicates, never both `bright` and `warm`. A single-kind slot is `['drums']` and behaves
  exactly as today.
- Anything that stores or passes the old single `kind` (seeded slots, `DiscoverCandidate.slotKind`,
  IPC args) is normalized to the array shape; an old single value reads as a one-element set.
- Canonical order: mask kinds first, then trait kinds, each in `DISCOVER_SLOT_KIND_OPTIONS`
  order. Used for labels and for any cache/result keys (e.g. `DiscoverNearbyPopover`'s
  `resultKey`), so `warm+drums` and `drums+warm` are the same slot.
- Display label: canonical kinds joined with ` · ` (e.g. `drums · warm · rhythmic`).
- `discoverSlotKindToArrangeRole` for a set: the first mask kind's role if any, else the first
  trait kind's role (existing table unchanged).
- `DiscoverCandidate.traitValue: number | null` becomes per-trait values (e.g.
  `traitValues: Partial<Record<TraitKind, number | null>>`) so ranking can score each
  selected trait.

## Candidate pool

- **At least one mask kind selected:** the union of those mask kinds' existing pools
  (`getInstrumentMatchedStemCIDs` per kind, deduped). Trait kinds in the same set then rank
  within that pool — which requires each candidate's `StemFeatureCache` row. Candidates with
  no cached features stay eligible; their trait score is 0 (the existing null → 0 rule).
- **Trait kinds only:** every stem with a `StemFeatureCache` row, **tagged or not** — this
  drops today's "audio-in / unmasked only" restriction and the "mask and trait pools never
  overlap" invariant. The sound-source checkboxes (`soundSourceMatchesFilter`) still apply.
  The human-confirmed-role exclusion (`confirmedAnyRole`) is dropped with the invariant it
  protected.
- The duplicated `TRAIT_FIELD` tables in `discoverCandidates.ts` and `discoverAdjacency.ts`
  both need the same multi-trait treatment (or move to one shared table in `src/shared/`).
- `getRandomLibraryCandidate` and adjacency (`getAdjacentDiscoverCandidates`) take the kind set
  and follow the same filter-then-rank rule.

**To verify during planning:** that the overnight feature scan writes `StemFeatureCache` rows
for mask-tagged stems too (it appears to — `stemAutoClassify.ts` reads feature rows before its
mask short-circuit). If not, mask + trait combos rank by BPM alone for uncached stems.

## Ranking

`rankCandidates` takes `targetTraits: TraitTarget[]` (replacing the single `targetTrait`).
Score = BPM closeness + favourite boost + Σ `traitScore × TRAIT_SCORE_WEIGHT` over the selected
traits. Each trait weighs the same as a single trait does today (weight 1). `pickReroll` is
unchanged.

## Sound-source filter fix

With "endlesss sounds" unticked:
- the bottom row's `+ drums` / `+ bass` / `+ lead` buttons are disabled (30% opacity,
  `not-allowed`), and
- the same three chips are disabled in the slot picker.
An existing slot whose kinds include a mask kind keeps its current stem; rerolling it returns
"no match" rather than silently ignoring the filter.

## UI (option B from the mockups)

Mockups: https://claude.ai/artifact/LfyEt7sqU8REva2bfmaMs1

- **Bottom add row unchanged:** one click on `+ {kind}` adds a single-kind slot; `+ random`
  stays.
- **Slot kind label becomes a button** (`drums · warm ▾`). Clicking opens a popover anchored
  under it (same pattern as `DiscoverNearbyPopover`) with two labelled chip rows: `instrument`
  (drums / bass / lead) and `trait` (bass-heavy / rhythmic / bright / warm). Esc or an outside
  click closes it.
- Chip styling follows `tokens.css`: off = `--ra-border` border, `--ra-text-2` ink; on =
  `--ra-text` border and ink on `--ra-bg-row-active`; disabled = 30% opacity. No color.
- **Toggling a chip rerolls the slot immediately.** Rapid toggles: only the newest roll's
  result is applied (stale results discarded).
- Rules: the last active chip can't be turned off; bright/warm are exclusive; mask chips are
  disabled while "endlesss sounds" is off.
- **Locked slot:** the label shows, but the picker doesn't open.
- **`+ random` slot:** picker works; choosing kinds turns it into a normal kind-matched roll.
- **Label column widens 64px → ~110px**, ellipsis on overflow with the full combo as a tooltip.
  The add row's hardcoded `marginRight: 452` (mirrors the slot grid's column widths) is updated
  to match.

## Testing

- **`src/shared/` (TDD, vitest):** kinds normalization (old single → set, canonical order,
  dedupe), label formatting, bright/warm exclusivity toggle logic, last-chip guard,
  arrange-role resolution for a set, multi-trait `rankCandidates` scoring.
- **Main (`discoverCandidates.test.ts`, `discoverAdjacency` tests):** mask-union pools,
  trait-only pools now including tagged stems, mixed filter-then-rank, sound-source interplay
  (mask kinds → no match when "endlesss sounds" is off).
- **UI:** typecheck + lint; the picker itself needs Elling's manual walkthrough (no GUI tooling
  in the agent environment).

## Out of scope

- Weighting traits differently from each other within a combo.
- Excluding kinds ("warm but not rhythmic").
- The Discover loading-animation tweak (queued separately).
