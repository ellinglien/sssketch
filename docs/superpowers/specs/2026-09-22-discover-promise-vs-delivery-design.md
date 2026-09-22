# Discover: closing the gap between what a kind promises and what a roll delivers

Date: 2026-09-22
Status: decisions made in chat; awaiting spec review

## Problem

A slot labelled `drummy · sparkly` often gets a stem that isn't very drummy or very sparkly.
Four causes, found while building combination slots:

1. **Traits are pool-relative.** A trait roll ranks a random ~1,000-stem slice and picks its
   "sparkliest" — a dull slice still produces a winner. Nothing is sparkly in library terms.
2. **Unanalysed stems slip in.** A stem the overnight feature scan hasn't reached has no trait
   values; it scores 0 on the trait term but can still be picked on tempo alone (mask + trait
   combos especially).
3. **Coarse measurements.** sparkly/buttery use a centroid built from 3 band energies;
   rhythmic counts transients (noise scores as high as groove).
4. **No visibility or correction.** The user can't see how well a pick matched, or fix a wrong
   drummy/bassish/leadesque guess from Discover.

## Phase 1 — library-wide bars, analysed stems only (no UI)

- **Library percentiles.** Main process computes, per trait field (bassEnergyRatio,
  transientDensity, spectralCentroidHz), a quantile table (101 breakpoints) over ALL
  StemFeatureCache rows. Built lazily with yielding (never one long synchronous block —
  see the 2026-09-21 freeze fixes), cached in memory, rebuilt when the feature-row count has
  grown ≥ 5% since the last build.
- **Candidates carry percentiles.** Alongside `traitValues`, each candidate gets
  `traitPercentiles: Partial<Record<DiscoverTraitKind, number | null>>` in [0, 1], already
  direction-adjusted (buttery = low centroid → high percentile). Computed in main from the
  quantile table.
- **The bar (user choice: top 40%).** A requested trait requires percentile ≥ 0.6. Every
  requested trait must pass (AND).
- **Too few pass → relax quietly (user choice).** If fewer than `MIN_POOL` (12) candidates pass,
  lower the bar in 0.1 steps (0.5, 0.4, … 0) until enough pass. The bar actually used is
  returned so Phase 2's meter can show it honestly.
- **Analysed stems only.** When any trait is requested, candidates without trait values are
  dropped — unless that leaves fewer than `MIN_POOL`, in which case they're kept after the
  analysed ones (same "relax, don't fail" rule).
- **Ranking.** Within the passing pool, trait scores use library percentiles (not pool
  min-max). BPM closeness, favourites boost and the matching dial behave as today.
- **Where the logic lives.** Bar + relaxation + analysed-only filtering is one pure function in
  `src/shared/` (TDD), applied in the renderer between `getDiscoverCandidates` and
  `rankCandidates`. Quantile building/lookup is pure too (`src/shared/`), fed by main.

## Phase 2 — match meter and reclassify (UI)

- **Why-it-matched source per mask kind.** Candidates for drummy/bassish/leadesque carry
  `kindSource: 'tag' | 'confirmed' | 'guess'` (Endlesss instrument tag / Tidy Up confirmation /
  overnight classifier). Main already knows which rule admitted each stem.
- **Meter on each slot.** A compact readout per requested kind next to the slot's label, e.g.
  `drummy: tag · sparkly ▮▮▮▮▯`. Trait bars show the stem's library percentile; a relaxed pick
  shows fewer bars honestly. Hover gives the numbers.
- **Reclassify (user choice: reclassify, don't skip).** Clicking a mask kind's source opens a
  small picker of roles (drummy / bassish / leadesque and the other Tidy Up roles). Choosing one
  records a Tidy Up-style confirmation (StemCategories, same write path Tidy Up uses, source
  `discover`). The slot keeps its stem; its label/meter update; future rolls and the
  classifier's training set use the correction.

## Phase 3 — better measurements (user approved a full re-analysis)

- **Real spectral centroid** from the FFT frames the MFCC pass already computes (replacing the
  3-band approximation) for sparkly/buttery.
- **Onset regularity** (how evenly spaced transients are) added; rhythmic ranks on regularity ×
  density instead of density alone.
- **Versioned features.** A feature version stored with each cached row; the background scan
  re-extracts stems whose version is old. Old values stay usable until replaced, so nothing
  degrades during the rescan. Percentile tables rebuild as rows are replaced (Phase 1's ≥ 5%
  rule).

## Out of scope

- Per-slot trait "level" targets (the earlier "how rhythmic" idea) — the bar + meter come first.
- Changing the add-row / checkbox UI.

## Testing

- Phase 1: pure shared functions TDD (quantiles, percentile lookup, bar/relax/analysed-only);
  main tests for percentiles attached to candidates; re-profile to confirm no new main-process
  stalls.
- Phase 2: shared/main tests for `kindSource` and the reclassify write; UI by manual walkthrough.
- Phase 3: feature tests on synthetic audio (a bright vs dark tone, a regular vs irregular click
  train); versioned-rescan test.
