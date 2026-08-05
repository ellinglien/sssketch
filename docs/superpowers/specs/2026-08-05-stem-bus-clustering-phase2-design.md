# Stem Bus Clustering — Phase 2: Feature Extraction, Clustering, Labelling UI

**Date:** 2026-08-05
**Status:** design agreed in conversation, approved by user
**Depends on:** Phase 1, already shipped — `docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md`,
`docs/superpowers/plans/2026-08-05-stem-bus-clustering-implementation.md` (`busOf`, `ASSIGN_TO_BUS`,
`packIntoTracks`, the bus-partitioned Ableton export)

## The problem

Phase 1 shipped a working bus-clustering export (5 fixed buses, non-overlapping stems packed onto
shared Ableton tracks), but there's no way yet to actually *assign* a stem to a meaningful bus —
every stem defaults to `aux`. What phase 1 users are observing as "clustering" is really just
`packIntoTracks`'s time-based packing (stems that happen not to overlap land on the same track),
not grouping by what a stem actually sounds like. This phase adds real audio-feature-based
grouping: extract a feature vector per stem, cluster unsupervised, let the user audition and label
each cluster into one of the 5 existing buses.

## Scope

**In scope:** feature extraction (two new features — voiced fraction/pitch variance, MFCCs — plus
reuse of existing ones), agglomerative clustering, a new "cluster stems" labelling UI reachable
from its own standalone button, fanning out `ASSIGN_TO_BUS` (already built) once a cluster is
confirmed.

**Explicitly out of scope, deferred to phase 3:** auto-slotting a newly-imported stem into an
*already-labelled* cluster from a prior run, using saved cluster centroids. This depends on
centroids that only exist after a first phase-2 run has happened, so it's a natural follow-up, not
part of this phase. (Low-confidence new stems should fall back to `aux`, same as today, rather than
forcing a bad guess — established now so it isn't re-litigated in phase 3.)

## Feature vector

Reuses several already-computed, already-cached functions, and adds two new pieces:

| Feature | Source | Status |
|---|---|---|
| `transientDensity` | `src/shared/typeGuess.ts:44` | existing, reused as-is |
| `bassEnergyRatio` | `src/shared/typeGuess.ts:36` | existing, reused as-is |
| spectral centroid | `src/shared/bandEnergy.ts:41` (`computeBandEnergy`) | existing, reused as-is |
| ZCR brightness | `src/renderer/src/audio/peakCache.ts` (`getBrightness`) | existing, reused as-is |
| voiced fraction + pitch variance | `src/shared/pitchContour.ts` (`computePitchContour`) | **new**, derived from an existing cache |
| MFCCs (13 coefficients) | new `src/shared/mfcc.ts`, built on existing `magnitudeSpectrum()` | **new** |

**Voiced fraction + pitch variance**: confirmed by reading `pitchContour.ts` directly — unvoiced
frames are literally represented as `0` in `PitchContour.freqHz` (this was the design doc's own
flagged open question from phase 1's research; it's resolved). `voicedFraction =
count(freqHz≠0)/numFrames`. Pitch variance is computed in **cents** (log-frequency space) around
the mean of the voiced frames, not raw Hz — raw Hz variance isn't musically meaningful (an octave
spans wildly different Hz ranges depending on register; cents normalizes for that).

**MFCCs**: the single biggest new chunk of DSP code in this phase. Pipeline, per stem: frame the
decoded audio (same windowing convention as `pitchContour.ts`) → `magnitudeSpectrum()` (already
exists) per frame → apply a mel filterbank (new — a fixed set of overlapping triangular filters
spaced on the mel scale, ~15 lines) → log of each mel-band energy → DCT (new — a small, standard
transform distinct from the FFT already in `fft.ts`, ~15 lines) → keep the first 13 coefficients →
average across all frames into one fixed-length 13-number vector per stem (the clustering step
needs one vector per stem, not one per frame).

All ~20 resulting numbers (7 scalar features + 13 MFCC coefficients) get **z-score standardized**
across the whole population of stems being clustered together before clustering runs — raw scales
differ wildly (e.g. `transientDensity` is roughly 0–1, MFCC coefficients can be tens in either
direction), and clustering on unstandardized features would let the largest-magnitude feature
dominate the distance metric.

Every new per-stem feature computation follows this codebase's own established caching convention
(`peakCache.ts`/`bandEnergyCache.ts`/`pitchCache.ts`): key by path, decode once, evict on
rejection — no new caching mechanism invented.

## Clustering algorithm

Agglomerative, average linkage, Euclidean distance on the standardized feature vector.

Implementation detail that makes the chosen "global slider" UX cheap: agglomerative clustering
naturally produces a full merge sequence (N stems as N singleton clusters, merging pairwise down to
1 cluster, one merge at a time, in order of increasing distance). That whole sequence is computed
**once**. The slider doesn't re-run clustering on every drag — it just "cuts" the already-computed
merge sequence at whatever cluster count is currently selected, so dragging the slider is an
instant lookup, not a re-computation.

## Labelling UI

A new standalone "cluster stems" button/entry point (not folded into the Ableton export flow) opens
a modal, matching this app's existing `ProjectLibraryBrowser.tsx`/`LoreLibraryBrowser.tsx` pattern.

- **One row per cluster**, sorted by clip count descending; a small tail of low-count clusters is
  visually de-emphasized/collapsed rather than given equal prominence ("label the biggest first,
  ignore the tail," from phase 1's original design doc).
- **Waveform thumbnails per member stem are the primary signal**, not audio playback — a strip of
  small per-stem waveform previews (reusing the existing `Waveform` component + `peakCache.ts`, no
  new rendering/caching infrastructure) lets the user visually judge "do these actually look alike"
  at a glance. This was a deliberate correction mid-design: an earlier version of this UI relied on
  soloing and listening to the whole cluster to judge quality, which doesn't scale and is slow —
  visual pattern-matching across thumbnails is the fast first-pass check, listening is the
  slower confirmation step for when a call is unclear.
- **Click/drag-to-scrub any individual thumbnail** for a targeted listen at a specific point —
  reuses this app's own existing scrub-on-click convention (the same interaction
  `StemWaveformRow.tsx`'s waveform body already provides in the main timeline), not a new
  interaction paradigm.
- **"Solo all" per cluster** (reusing phase 1's `soloState()` helper directly — it already supports
  multiple simultaneous target keys) plays every member stem in that cluster together, for a final
  whole-cluster sanity check once thumbnails alone aren't conclusive.
- **Provenance shown as plain text**, not a confidence percentage — `"clustered"` / `"from preset
  name"` / `"unknown"` (the last for very small/singleton clusters with no other signal). Different
  provenance sources are trusted differently by the user; a number obscures that distinction rather
  than surfacing it.
- **Global slider for cluster count** (not per-row split/merge) — changing it re-populates the row
  list from the precomputed merge sequence (see above). Any bus assignments already confirmed
  before moving the slider are **not** retroactively undone by a later slider move — only rows
  still visible get relabelled; already-dispatched `ASSIGN_TO_BUS` actions for stems in clusters
  that have since been merged/split stand as committed edits, same as any other undo-able action.
- **Number keys 1–5 assign a bus**, arrow keys move focus between rows — from phase 1's original
  design doc, unchanged.

## Data flow

Feature extraction needs decoded audio (`decodeAudioData`, a browser/Web Audio API), so — same as
every existing per-stem analysis cache in this codebase — it runs in the **renderer**, not the main
process. Clustering itself (pure numeric computation on already-extracted feature vectors) also
runs renderer-side; no IPC round trip is needed for either step.

Confirming a cluster's bus assignment (via a number key or clicking a bus chip) dispatches
`ASSIGN_TO_BUS` (already built in phase 1) once per member stem in that cluster — real,
undo-able edits, identical in kind to every other per-stem action already in this reducer.

## Testing

Per this codebase's own convention: pure logic (`mfcc.ts`, the voiced-fraction/pitch-variance
derivation, the agglomerative clustering algorithm) is TDD by default, in `src/shared/`. The
labelling UI component itself isn't directly unit-tested (this codebase's established convention
for React components) — verified via typecheck + lint + the underlying pure logic's own tests, with
manual walkthrough explicitly flagged as needed and not something a coding agent can perform itself
(no GUI/audio interaction tooling in this environment).
