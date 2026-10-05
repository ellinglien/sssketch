# Radio intensity arc: build, breakdown, drop

**Date:** 2026-10-05
**Scope:** sssketch's Discover radio and ell.ing/radio, built together. The rules go in
`src/shared/` (TDD); each runtime only drives them. The desktop's analysis pipeline gains one
measurement (loudness), and the web index export carries the result.
**Builds on:**
- `2026-10-01` density arc (`src/shared/radioDensity.ts`, web `step.ts` `densityAtWrap`);
- `2026-10-02-radio-turnarounds-design.md` (§0's theory, the planner, the riser and the gap);
- `2026-10-03-radio-anointed-stems-design.md` (sized builds §4, the payoff §4.7, hooks §2, resting
  rows as built);
- `2026-10-03-radio-pace-slider-design.md` (the turnaround phrase stays 16 bars at every pace);
- `2026-10-03-radio-fold-follows-pace-design.md` and `2026-10-03-radio-fold-v2-design.md` (bend);
- `2026-09-22-discover-promise-vs-delivery-design.md` (library percentiles, feature versions);
- `2026-09-22-background-efficiency-design.md` (one decode per stem, the needs answer, batched
  writes);
- `2026-10-03-radio-readout-design.md` and `2026-10-03-sssketch-radio-view-design.md` (the status
  line, the strip).

## Why

The density arc moves the row COUNT: 2 rows grow to 4 or 5 over 96-192 bars and thin back. It
never asks what the rows are. A peak of five sleepy stems and a trough of two pounding ones read
the same to it, so the radio has no sections: nothing builds toward a moment, and nothing falls
away so that something can come back. Sized builds (anointed stems §4) made the riser and the gap
honest, but there is still no shape for them to serve. The anointed spec left the deliberate
breakdown out of scope (its Out of scope, handoff open thread 4); this is it.

## Decisions (Elling, 2026-10-05)

1. **Intensity is led by rhythm.** Busier drums and heavier bass drive it ("that's where the
   buildups come from"). Loudness or fullness and brightness ride along with smaller weight.
2. **A per-stem score, 0-1, from analysis:** rhythmic busyness (transient density, rhythmic
   strength) and low-end weight (bass energy, loudness) mostly; a little loudness or fullness and
   brightness. Role-weighted: the score counts most on drums and bass rows.
3. **A new measurement: loudness,** computed in the decode the desktop already does (no second
   decode), versioned so existing libraries backfill in the background, and baked into the web
   index export.
4. **The shape is build and drop, with an occasional bigger peak:**
   - **build**, over 2-4 phrases: picks for drums and bass lean busier and heavier, and rows are
     added;
   - **breakdown**, on the one, for 1-2 phrases: drums thin or drop, the bass leaves, pads and
     leads carry it;
   - **the return (the drop):** drums and bass back, with the full riser and gap. Sized builds make
     it the big moment, and hooks prefer to come back there;
   - every few cycles, **a bigger peak:** higher for longer, and a deeper drop.
5. **`density` becomes `off / arc / intensity`.** `intensity` replaces the row-count arc while it
   is chosen, and extends it: it drives the row count too.
6. **Two dials:**
   - `energy` (0-100): where it sits, from gentle with long breakdowns to driving with short ones;
   - `drama` (0-100): how far it swings, from a subtle swell to the full breakdown and drop.
7. **`build` and `drop` buttons** next to `turn`: force the next phase now.
8. **Both radios.** The readout shows the phase (`building ↑`, `breakdown`, `drop`), lowercase,
   at phone width.
9. **It fits with** sized builds (the drop is a large payoff), hooks (they prefer to return at the
   drop), fold (it bends harder near peaks), pace (independent: the arc moves in phrases), throws
   (aimed into the drop) and turnarounds.

## 0. The theory, and what it decides

Tags as in the anointed spec: **[EV]** an empirical study; **[SRC]** a scholarly source that is
not an experiment; **[LORE]** producer and DJ practice; **[INF]** our own inference. No source gives
any of the numbers below. Every number is [INF], to tune by ear.

- **The low end is the lever.** A breakdown removes "most importantly the bass and the bass drum",
  and the drop is their return (Solberg 2014, *Dancecult* 6(1), p.67; turnarounds §0). A louder
  bass drum makes dancers move more (Van Dyck, Moelants, Demey, Deweppe, Coussement & Leman 2013,
  "The impact of the bass drum on human dance movement", *Music Perception* 30(4)). [EV] Lower
  pitches carry rhythm: timing is perceived better in the low register (Hove, Marie, Bruce &
  Trainor 2014, *PNAS* 111(28)). [EV]
  - *So:* the score is led by rhythm and low end (§2), the lean counts most on drums and bass rows
    (§2.3), and the breakdown takes drums and bass out (§4).
- **Event density drives the urge to move.** Across genres, event density and beat salience
  predict how much music makes people want to move (Madison, Gouyon, Ullén & Hörnström 2011, *J.
  Exp. Psych.: HPP* 37(5)). [EV]
  - *So:* busyness (transient density and rhythmic strength) is the score's biggest part.
- **Loudness raises arousal, as a smaller term.** Acoustic intensity causes perceived changes in
  arousal (Dean, Bailes & Schubert 2011, *PLoS ONE* 6(4) e18591). [EV]
  - *So:* loudness and fullness are in the score at a smaller weight, because stem loudness in an
    Endlesss archive also reflects how each jammer set their gain. [INF]
- **Build by adding layers.** EDM sections are built and taken apart by adding and removing loops
  that are already playing (Butler 2006, *Unlocking the Groove*). [SRC] Layers enter after 2, 4, 8,
  16 or 32 bars (Solberg p.66; turnarounds §0). [SRC]
  - *So:* the build adds rows one at a time on phrase starts. Each one arrives with a filter in or a
    bloom, not a gap (§3.4).
- **Contrast, and a matched build.** The drop works through its contrast with the breakdown, and
  through a build matched to it. Listeners report the peak at the drop, and disappointment when
  the pacing misjudges it (Solberg 2014; Solberg & Jensenius 2016, *Empirical Musicology Review*
  11(3-4)). [EV] Preparation should be proportional to the event (Huron 2006, *Sweet Anticipation*,
  ch. 1-2). [SRC]
  - *So:* the riser and the gap belong to the drop. Every other phrase end in the cycle is held to
    `medium` at most (§5.1).
- **Release is return.** The release is the return to the basic groove (Iler 2011, p.ix;
  turnarounds §0). [SRC]
  - *So:* breakdown rows come back with their own stems by default. Sometimes a heavier one comes
    back in their place (§4.4; open question 4).
- **The second break routine is the stronger.** A track has about two break routines, and the
  second is the stronger (Solberg p.66; Solberg & Dibben 2019, *Music Perception* 36(4), p.373). [EV]
  - *So:* every few cycles, a bigger peak (§3.3).
- **Contract the spectrum, then expand it.** Energy moves into the highs before the return
  (Solberg pp.70-71). [EV]
  - *So:* a breakdown that keeps the melodic rows is already a contracted spectrum. The drop
    restores the lows.

## 1. What exists today (verified)

**The density arc** (`src/shared/radioDensity.ts`):
- constants `DENSITY_MIN` 2, `DENSITY_MAX` 5 (:40-41), `DENSITY_PEAK` 4-5, `DENSITY_TROUGH` 2-3,
  `DENSITY_LEG_BARS` 96-192 (:43-46);
- `advanceDensityLeg` (:80): one step per wrap once the leg's bars are in, with `waits` under sized
  builds (a step waits for a phrase start);
- `nextArcKind` (:116) adds in starter order: drums, bass, lead, warm, drums;
- `pickArcRemoval` (:172) takes the stalest radio-added row, and never the last heard drums or bass
  row (`lastOfItsKind`).
- The setting is `RadioDensity = 'off' | 'arc'` (`radioSchedule.ts:1057`), default `arc`, optional
  on `RadioSettings` (:1092). It is set by the strip's `density` chips (`radioStripModel.ts`, the
  picks group).
- **Web:** `WebRadioSettings.densityArc` (`src/radio/settings.ts`) is on, with the same numbers.
  The web never sets `density`, so `radioDensityOf` reads `arc`. `densityAtWrap`
  (`step.ts:2903`), `startAdd`, `startRemove`, `removalVictim` (:2990) and `densityTick` (:3047)
  implement it. There is no density control in either web mode.
- **Desktop:** `densityTick` / `densityAtWrap` (`DiscoverPanel.tsx:10069`, :10090),
  `arcRemovalCandidate` (:10148), `arcAddRow` (:10183). It adds rows (`radioAdded`) and removes
  only those.

**Resting rows** (anointed stems, as built). A row can be silent without being removed, as radio's
own silence and not a mute:
- web: `RadioRow.resting` (`step.ts:273`), `landRest` (:2444), `restEnds` (:2461), and `sounding()`
  (:4206) driving radio, the planner, fold and clash;
- desktop: `radioRestingRef` (`DiscoverPanel.tsx:3083`), dropped from the previewing mix at the
  line (:6939), rejoined by `radioRestEnds` (:4774) or by hand (`radioRestReturnsByHand`).
- Both are owned by hooks today: a resting row returns only through its hook.

**Stem features** (`src/shared/stemFeatures.ts`), from one decode (`analyzeStemOnce.ts`), run in a
worker (`stemAnalysis.ts:68`) on **channel 0 only** (`stemFeaturesCache.ts`, `featuresFromDecoded`):
- `transientDensity`: onsets per second, from 20 ms RMS jumps (`typeGuess.ts`);
- `rhythmicStrength`: `min(1, td / 4) * onsetRegularity` (v2);
- `bassEnergyRatio`: low-pass RMS (200 Hz) over full RMS. **A ratio: a quiet stem and a loud one
  with the same balance score the same;**
- `spectralCentroidHz` (3-band) and `spectralCentroidFftHz` (v2);
- `zcrBrightness`, pitch, MFCC.
- **No level of any kind is stored.**
- `STEM_FEATURE_VERSION = 2`. The needs answer (`src/main/stemAnalysisNeeds.ts`) parses
  FeaturesJSON per chunk to find old rows, and the ambient scans re-extract them.

**Library percentiles.**
- `traitQuantiles.ts`: 101-point tables per field (`buildQuantileTable` :59), `percentileOf` (:109),
  and `tableForField` (:80), which builds a preferred-only field's table only once
  `min(200, half the rows)` carry it.
- `src/main/traitQuantileCache.ts` builds them over every StemFeatureCache row, paged, plus an
  in-memory per-stem `TraitValueTable` of the five trait fields.
- A candidate carries percentiles only for the kinds its slot asked for, plus `alsoTraits`
  (fold's clash, `discoverCandidates.ts:863`).
- Web: the export (`ell.ing/radio scripts/export-index.mjs`, `src/index/traitPercentiles.ts`) bakes
  four percentiles per stem into `traits`. The index has 66,462 records, 65,285 with traits, and is
  2.2 MB gzipped.

**Picks.**
- `rankCandidates` (`discoverRanking.ts`) sums BPM closeness (max 1), the favourite boost (1.5),
  1 per requested trait, clash, and dig (0.75). Then `pickReroll` draws score-proportionally from a
  chaos-sized head.
- Desktop `pickForSlot` (`DiscoverPanel.tsx:8770`, ranking at :9001); web `pickStem`
  (`src/radio/pick.ts`).
- Both run: faves draw, dig's near draw, sample (up to 1000), dedupe, `applyTraitBar`, rank.

**Builds.**
- `radioBuildTier` makes an arc step, a low-end return, 3+ rows or a long hook return `large`
  (`radioBuildSize.ts:120`).
- `radioPhraseEndBuild` promotes a `medium` phrase end to `large` after `PROMOTE_PHRASES` (:267).
- A gap is drawn with `TURNAROUND_GAP_CHANCE` 0.75 (`radioTurnaround.ts:962`).

**Hooks.** A return lands at W without the calm wait when `changeAtNextWrap`
(`radioHooks.ts:463`, :569). Nothing pulls a return forward (the anointed spec's Out of scope).

**The turn chips** label `drum drop` as `drop` (`TURNAROUND_MOVE_LABEL`, `radioTurnaround.ts:588`).
That is the opposite of what "the drop" means here. Decided: the chips become `drums out` and
`low out` (open question 1).

## 2. The per-stem intensity score

### 2.1 The parts

Every part is a **library percentile** in [0, 1] (`percentileOf` over a quantile table built over the
whole library on the desktop, or over the exported stems on the web, exactly as traits are), so the
score is relative to the library, not to absolute units.

| part | made of | weight |
|---|---|---|
| **busy** | 0.6 · pct(`transientDensity`) + 0.4 · pct(`rhythmicStrength`) | **0.40** |
| **low** | 0.5 · pct(`bassEnergyRatio`) + 0.5 · pct(`lowLevelDb`) | **0.35** |
| **full** | 0.5 · pct(`loudnessLufs`) + 0.5 · pct(`activeFraction`) | **0.15** |
| **bright** | the `bright` percentile (`spectralCentroidFftHz`, else `spectralCentroidHz`) | **0.10** |

```
intensity = 0.40 busy + 0.35 low + 0.15 full + 0.10 bright
```

- **Led by rhythm:** busy is the largest part. Rhythm and low end make 0.75; loudness, fullness and
  brightness ride along at 0.25 (Decision 1).
- **Missing values renormalise.**
  - Inside a part, a missing input drops out and the others' weights are rescaled. A row without
    `rhythmicStrength` (version 1) has busy = pct(`transientDensity`). Before the backfill, low =
    pct(`bassEnergyRatio`).
  - A missing part drops out and the top-level weights are rescaled. Before the backfill, `full`
    is missing entirely, so a stem scores (0.40 busy + 0.35 low + 0.10 bright) / 0.85, with low
    counting only its bass ratio.
  - With neither busy nor low, the score is `null`: unscored.
- **Tables.** The three new fields' tables follow the preferred-only rule (`tableForField`): a table
  exists once 200 rows (or half the library) carry the field. Until then, the field counts as
  missing for every stem. So a half-backfilled library never compares a measured stem with
  nothing.
- **Not role-specific.** One formula for every stem. A drums pool and a pads pool sit at different
  heights of the same scale, and §2.3 ranks inside the pool, so that difference never matters to a
  pick.
- `stemIntensityScore(values, tables)` in a new `src/shared/radioIntensity.ts`. Pure, no randomness.

### 2.2 Where the score is computed

- **Desktop:** in main, beside the trait percentiles.
  - `getDiscoverCandidates` gains `alsoIntensity?: boolean`, after `only`. The same IPC carries it,
    like `alsoTraits`.
  - When set, every candidate gains `intensity: number | null`. The values come from the in-memory
    `TraitValueTable`, which grows by three columns (`lowLevelDb`, `loudnessLufs`,
    `activeFraction`; the other inputs are already in it), and from the quantile tables, which
    grow by those three fields.
  - Absent (every roll but radio's under intensity), nothing is attached and the payload is
    today's.
  - `attachDiscoverTraits` (dig's near pool) takes the same flag.
- **Web:** at export time.
  - `IndexRecord` gains `x?: number`, the score rounded to 3 places, present when not null. It is a
    separate key, not in `traits`, because `traits` passes straight through as
    `traitPercentiles`.
  - Roughly 10 bytes a record raw, about +150-200 KB on the 2.2 MB gzipped index. To be measured.
  - `header.coverage` gains `intensity` and `loudness` counts.
  - `pickStem`'s `toCandidate` sets `intensity: r.x ?? null`.

### 2.3 The lean on picks

Inside the existing pipelines, after `applyTraitBar` and before `rankCandidates`, in both
`pickForSlot` and `pickStem`. It runs only while radio runs with `density: intensity`.

**The target.** The arc gives a target `τ` in [0, 1] for the coming landing (§3.2).

**Rank inside the pool.**
- Each scored candidate's `r` is its rank by score within the pool being ranked, scaled to [0, 1]
  (ties take the middle of their run, as `percentileOf` does).
- This turns "busier" into "busier among what this slot can play": a drums pool at `τ` 0.9 leans
  to its own busiest drums, and a pads pool to its fullest pads.
- Unscored candidates have no rank.

**The role weight** of the slot's kinds (the largest over its kinds):

| kind | drums | bass | bassHeavy | rhythmic | lead | bright | warm |
|---|---|---|---|---|---|---|---|
| weight `w` | 1 | 1 | 0.8 | 0.8 | 0.35 | 0.35 | 0.25 |

**1. The band draw**, like the faves draw:
- one draw `< INTENSITY_BAND_CHANCE · w · d` (`INTENSITY_BAND_CHANCE` 0.5, `d` = drama / 100)
  keeps only the candidates with `|r - τ| <= 0.25`;
- when fewer than `max(8, ceil(pool / 8))` would remain, it keeps the pool as it was (logged
  `[radio-intensity] band too small`). This is `applyTraitBar`'s back-off;
- the draw is made only while intensity runs, and after dig's near draw.

**2. The ranking term.** `rankCandidates` gains `intensity?: RankIntensity` (`{ target, weight }`)
and adds, for every candidate:

```
INTENSITY_WEIGHT · weight · closeness
weight    = w · (0.4 + 0.6 d)
closeness = 1 - |r - τ|      (unscored: 0.5, neutral)
```

- `INTENSITY_WEIGHT` is 1, so the term is at most 1: as much as one trait, under the favourite
  boost (1.5).
- Absent: no term, and the ranking is identical.

**Never starved.**
- The band backs off.
- The term only adds. Nothing reaches zero weight, and `pickReroll`'s chaos head is unchanged.
- An unscored pool (no features) ranks as today, plus a constant.
- Faves-only and dig near pools are leaned inside themselves, through the same code.

## 3. The arc

### 3.1 State and clock

`RadioIntensityArc` (new `src/shared/radioIntensityArc.ts`):

```
phase      'build' | 'breakdown' | 'drop'
phrases    the phase's length in phrases, drawn at its start
done       phrase starts passed in this phase
big        this cycle is a bigger peak
untilBig   cycles until the next big one
peakRows   the row count this cycle's build heads for
depth      the breakdown's depth, decided at its decide wrap (§4.1)
rests      rows the breakdown silenced
renew      rows that come back on a fresh pick at the drop
forced     a button's request, landing at the next top
```

- **The phrase** is the turnaround phrase, as hooks count it:
  `P = turnaroundPhraseLaps(turnaroundPhraseBars, loopBars)`. It is 16 bars at every pace (pace
  §1).
- **A phrase start** is a wrap where the new `turnaroundLap` is 0. Phases change only on phrase
  starts. The buttons are the one exception (§6).
- **Two moments per event,** as hooks have:
  - **prepare**, at the phrase start before: warm what the event needs (renewal picks, a carry row);
  - **decide**, at the wrap starting the phrase's last lap (the turnaround roll's wrap, the
    clock's `turnaroundLapStarts`). Decided events are binding.
  - With a one-lap phrase (loops of 16 bars or more), prepare and decide fall on the previous
    wraps.
- **Order at the wrap:** lap bookkeeping, **density / intensity**, hooks, fold step, turn, then the
  turnaround roll and the early decision. The arc runs where the density arc runs, so hooks see
  `dropAtNextWrap` and the roll's forecast sees the arc's event.
- **Held** (web hold, desktop pause): the arc clock stops and nothing is decided, as hooks do.

### 3.2 Phases, lengths and targets

With `e = energy / 100` and `d = drama / 100`:

```
mid   = 0.35 + 0.30 e
swing = 0.15 + 0.35 d
τ_hi  = min(1, mid + swing)          big: min(1, τ_hi + 0.15)
τ_lo  = max(0, mid - swing)
```

| phase | lengths, in phrases (drawn uniformly) | target `τ` for picks |
|---|---|---|
| **build** | e < 0.34: {3, 4}; to 0.66: {2, 3, 4}; above: {2, 3}. Big: +1. Raised to fit its row steps (§3.4) | rises by phrase: τ_lo + (τ_hi - τ_lo)·(k + 1) / phrases in phrase k |
| **breakdown** | e < 0.34: 2; to 0.66: {1, 2}; above: 1 | τ_lo (for the rows still playing) |
| **drop** (the ride after the return) | e < 0.34: 1; to 0.66: {1, 2}; above: {2, 3}. Big: +1 | τ_hi |

**At the knots** (16-bar phrases, 120 bpm, so one phrase is 32 s):

| energy · drama | τ_lo → τ_hi | a cycle (mean) | at the top (build's last phrase and the drop) |
|---|---|---|---|
| 0 · 0 | 0.20 → 0.50 | 6.5 phrases, 3.5 min | about 30% |
| 50 · 60 (default) | 0.14 → 0.86 | 6 phrases, 3.2 min | about 40% |
| 100 · 100 | 0.15 → 1.00 | 6 phrases, 3.2 min | about 58% |

- **Energy moves where the time goes,** not the cycle's length: low energy spends it building and
  in long breakdowns; high energy rides the top.
- **Drama moves how far the targets and the rows swing,** and the breakdown's depth (§4.1).

### 3.3 The bigger peak

- `untilBig` is drawn from {3, 4} cycles. The first cycle after radio starts is never big.
- **A big cycle:**
  - the build is +1 phrase, and its peak is `DENSITY_MAX` rows (the web's `densityArc.max`);
  - `τ_hi` is +0.15;
  - the breakdown is one depth deeper (§4.1);
  - the drop rides +1 phrase.
- **Draws:** one at each cycle's start, and only when `untilBig` reaches 0 (the redraw).

### 3.4 Rows through the cycle

The arc keeps the density arc's one-row-at-a-time, phrase-start-only steps (`radioArcStepWaits`
under sized builds). It drives the same add and remove paths: web `startAdd` / `startRemove`,
desktop `arcAddRow` / the arc exit.

- **The peak:** `peakRows` = 4 when e < 0.5, else 5; `DENSITY_MAX` when big. Clamped to the arc's
  min and max.
- **Strip back:** at the build's first phrase start, one row leaves, by the arc's own
  `pickArcRemoval`: stalest, radio-added, never the last drums or bass. A build therefore starts
  from about a row under the peak.
- **Add:** at each later phrase start of the build, one row joins (`nextArcKind`) until the count
  reaches `peakRows`. Each arrives with a filter in or a bloom (`densityArrival`). The fifth place
  in the starter order is a second drums row: the top of a big build gets busier drums.
- **Fit:** `phrases` is raised to at least (adds + 1) when stripping back, else adds. The first
  build after radio starts goes from `DENSITY_MIN` (2 rows: drums, bass) and strips nothing.
- The breakdown rests rows (§4); it removes none. The drop brings them back, so the count at the
  drop is the count at the build's end.

### 3.5 Seeded determinism

- **Web:** every arc draw comes from the step's one stream (`c.rnd`) at fixed points, in order:
  1. a cycle start: the big redraw (only when due);
  2. each phase start: its length;
  3. the breakdown's decide wrap: nothing (rows are chosen by rule, §4.1);
  4. the drop's decide wrap: one renewal draw per returning drums or bass row, in row order (§4.4).
- **Desktop:** `Math.random`, as the rest of its radio.
- **Picks:** the band draw comes after dig's, from the pick's own random.

## 4. The breakdown

### 4.1 Which rows go silent

Rows **rest**, the mechanism hooks already use, owned now by either a hook or the arc. They are
not removed: the same rows come back at the drop.

**The depth,** from drama (a big cycle goes one level deeper; `full` stays `full`):

| drama | depth | what goes silent at the breakdown's one |
|---|---|---|
| under 25 | **swell** | nothing rests. The playing rows' picks lean to τ_lo for the phase, and the phrase end before it is a `thinning` turnaround (wash, dip) |
| 25-59 | **thin** | every bass row; every drums row but one, the kept one being the lowest-scored (the sparsest; unknown reads 0.5, ties to the stalest) |
| 60+ | **full** | every drums row and every bass row |

**A row is "low"** when its kinds include `drums` or `bass`. A combination row counts.
`bassHeavy` and `rhythmic` trait rows do not.

**Never silence: at least one row keeps sounding.**
1. A row that is not low, sounding, and not resting for a hook is a carrier.
2. With no carrier at the decide wrap, the arc **adds a carry row** at the breakdown's one when it
   can (`nextArcKind` restricted to `lead` then `warm`, prepared a phrase ahead, arriving with a
   bloom).
3. If it cannot (no free place, or the pick is not warm), the depth falls to `thin`, keeping the
   sparsest drums row.
4. A bed of one drums and one bass row with nothing to add keeps its drums and rests only the bass.
5. Checked again at the line: if every other row has been muted since the decision, the rest is
   withdrawn (the desktop already does this for hook rests, `DiscoverPanel.tsx:6929-6937`).

**Rows never rested:**
- locked (desktop padlock);
- soloed, or outside the user's solo;
- already muted by the user;
- under a manual change or a swap-now for that line;
- a hook resting (it already is).

**His rows on the desktop rest too** (unlocked ones). The density arc removes only rows radio
added, because removing is an edit. Resting is radio's own silence, and it ends at the drop.

### 4.2 The last-drums and last-bass rule, relaxed on purpose

`pickArcRemoval`'s `lastOfItsKind` and the hooks' `lastLowHeard` keep the bed's drums and bass from
being removed. A breakdown deliberately breaks that, and only that:
- **It is a separate function,** `radioBreakdownRests(rows, depth)`, never `pickArcRemoval`.
  Removal keeps its rule unchanged.
- **It is bounded in time:** it lasts the breakdown's `phrases`. A safety ends it after
  `phrases + 1` phrase starts in any case (logged `[radio-intensity] breakdown overran`).
- **It is bounded in reach:** one carrier always sounds (§4.1).
- **The user ends it for a row:** unmuting or soloing a resting row puts it back at once, and it
  is no longer the arc's. The desktop's `radioRestReturnsByHand` path learns the arc owner.
- **Stopping ends it:** radio off (desktop), stop (web), a course change, or switching `density`
  away from `intensity` put rested rows back with their own stems at the next top. Off and stop
  put them back at once, as hooks do.
- During a breakdown, `lastOfItsKind` and `lastLowHeard` read resting rows as unheard, as they do
  for hook rests. Nothing else is removed or rested in a breakdown: the arc takes no steps, and
  hook exits wait (§5.2).

### 4.3 Into the breakdown

- **Decided** at the decide wrap before the breakdown's phrase start W: the depth, the rows, and
  their exits.
- **Drums leave with an echo throw** ending on W's downbeat. This is the hook exit's
  (`radioHookExitThrow`, anointed §2.5): it ignores `NEVER` for drums, and counts on the throw
  clock (`noteRadioExitThrow`). One throw per breakdown, on the first resting drums row in row
  order, not one per row.
- **Bass leaves dry** (anointed Decided 5).
- **The phrase end before W** is rolled with the forecast's new `arcRole: 'breakdown'` (§5.1):
  - tier `medium`, arc `thinning`;
  - the resting rows are passed as `TurnaroundRow.exiting`, so no move silences them before their
    throw, and a wash prefers them;
  - no gap ever: a gap before silence is a broken promise.
- **Pace:** radio's own turnover continues on the carrying rows (they are the only eligible ones).
  Resting rows are excluded, as `sounding()` already excludes them.

### 4.4 The drop

- **Decided** at the decide wrap before the drop's phrase start W (the breakdown's end).
- **Returning rows:**
  - every row the breakdown rested comes back at W;
  - **renewal:** each returning drums or bass row comes back on a fresh pick with chance
    `0.25 + 0.5 d` (one draw each, in row order), leaned to τ_hi at full weight (§2.3);
  - renewal picks are armed and warmed at the prepare moment, a phrase ahead;
  - a renewal pick not warm by the decide wrap falls back to the row's own stem, with no draw;
  - the default stays the row's own stem: release is return (§0, open question 4).
- **The forecast** has `lowEndReturn` (the rows were silent in the lap before W) and `arcRole:
  'drop'`.
- **The build** is a phrase-end turnaround rolled at `large`, exempt from the budget (§5.1), with
  `TurnaroundInput.drop`:
  - the riser is the lead move whenever the riser family is on and fits (no draw for it);
  - the gap is drawn with chance 1 at drama 50 and up, else `TURNAROUND_GAP_CHANCE` (one draw
    either way, as today);
  - the riser's length is the longest the planner allows (min of half the loop and 4 bars).
- **Swell depth** (nothing rested): the "drop" is the renewals plus the lean. It is at most
  `medium`, so there is no gap. That is the subtle swell (Decision 6).
- **Turnarounds `off`** (or the riser family off): the drop has no build. Returning rows land as a
  joining cut, as hook returns onto resting rows do. The listener's switch is respected.
- **Fold:** a returning row plays straight from its first beat (anointed §5). A folded row the
  breakdown rested was released at the breakdown's one (`radioFoldRelease`).

## 5. How it fits

### 5.1 Sized builds and the payoff

`RadioChangeForecast` gains an optional `arcRole?: 'build' | 'strip' | 'breakdown' | 'drop'`.
Absent, every function is today's.

| arcRole | tier | payoff met | build arc | budget |
|---|---|---|---|---|
| `build` (an arc add in the build) | **medium** at most, not `large` as an `arcStep` makes today | medium | growing | as today |
| `strip` (the build's strip-back) | medium | medium | thinning | as today |
| `breakdown` | medium | medium | thinning | as today; never a gap |
| `drop` | **large** | large | growing | **exempt** from the once-a-phrase rule and the 8-bar spacing |

**Every other phrase end in an intensity cycle is capped at `medium`,** and promotion
(`PROMOTE_PHRASES`) is off. This covers a long-away hook return mid-build and three rows in the
bar band. The gap belongs to the drop: about one per cycle, roughly every 3-4 minutes. Today's
promotion rate is 8-12 an hour.

A per-change `large` gesture (an 8-beat riser, no gap) at the bar band stays as it is.

### 5.2 Hooks

`RadioHooksStepInput` gains optional `dropAtNextWrap?: boolean` and `inBreakdown?: boolean`.
Absent, it is today's.
- **They prefer the drop:**
  - a return due within one phrase after the drop's W is decided for W (up to a phrase early), with
    no calm wait;
  - a return due during the breakdown waits for the drop when the drop is at most 2 phrases away,
    else it returns as today.
- **No exit is decided** for a breakdown's or a drop's W, or during a breakdown.
- **A hooked-in low row in a breakdown is rested by the arc.** Its hook stays `in` with its clock
  stopped, and it comes back at the drop with its stem. The hook's own cycle then resumes.
- An away hook's substitute is an ordinary row: the breakdown may rest it.

### 5.3 Fold

- **It bends harder near peaks.** The fold step's `fold` (bend) input becomes
  `clamp(bend + 25 · d · (2τ - 1), 0, 100)`, read at each step. That is about ±15 at the default
  drama: less bend in a breakdown (clarity), more at the drop.
- The fold machine stays pure and seeded. Its decisions change only because its input does, and
  only under intensity.
- Rested rows read as not audible, so the anchor moves (anointed §5). A folded row is released when
  it rests.

### 5.4 Pace

- Independent. The arc moves in turnaround phrases, which the slider never changes.
- At ludicrous, the rows still churn every bar, now inside the arc's targets (the lean). At slow,
  a cycle can pass with only a few of radio's own changes. The arc's steps, rests and returns are
  its own, on phrase starts.

### 5.5 Throws

- **The breakdown's exit throw** (§4.3).
- **Aimed into the drop.** In the breakdown's last phrase, `ThrowTick` gains `dropAt?`. A regular
  throw falling due in that phrase waits until it can end on the drop's downbeat, on a carrying
  row.
- No regular throw lands on a resting row (`radioThrowRows`, as built).

### 5.6 Turnarounds and the turn

- Phrase ends inside a build roll as today, at `medium` at most (§5.1). The arc reads `growing`
  through the build, `thinning` into the breakdown, `steady` in the ride.
- **A turn** pressed for the drop's W merges with it: the drop's turnaround is the turn (one per
  top). A turn elsewhere is unchanged.

### 5.7 The density arc

- **Switching `arc` → `intensity`** mid-run: the machine starts in `build` at the next phrase start
  from the count as it is (fit, §3.4). The density leg is dropped.
- **Switching `intensity` → `arc` or `off`:** rested rows come back at the next top (a joining
  cut). An arc leg starts `growing` from the count (`arc`).
- **`intensity` replaces `DensityLeg`** while it is chosen. The add, remove and rest paths are
  shared.

## 6. The buttons: `build` and `drop`

Both are next to `turn`. They land on the next **loop top**, as turn and manual changes do, never
mid-loop (even in the bar band). They only work while intensity runs: the desktop greys them
(strip rule) with the tooltip `with density intensity`; the web shows them only then. While one
waits, its label reads `building` or `dropping`, as `turning` does.

**`build`: go up now.**

| pressed in | what happens |
|---|---|
| drop (the ride) | the ride ends: the build starts at the next top (its strip-back there) |
| build | it hurries: the next add lands at the next top, and the build's remaining phrases halve (at least 1) |
| breakdown | the drop is brought to the next phrase start whose decide wrap has not passed |

**`drop`: the drop at the next top.**

| pressed in | what happens |
|---|---|
| breakdown | the rested rows return at the next top. Its build is a turn sized `large` with the payoff "low end back": a riser fitted to the lap, and the gap by drama (§4.4) |
| build or drop | **a quick drop:** the lap before the top plays the planner's `low drop` (drums and bass out, up to 2 bars), with the gap by drama, and they are back on the one. The build's rest and the breakdown are skipped. Then a fresh ride |

- After a forced drop, the cycle continues from the ride: the next build, and `untilBig` counting
  on. Renewals need a phrase of warming, so a quick drop returns the same stems.
- Pressed in the last lap before the top (too late to arm), it takes the top after.
- **The phone** gets both buttons beside its turn: `POST /api/arc` with `{ action: 'build' |
  'drop' }`, and `RemoteTurnView`'s sibling `arc?: { phase, canBuild, canDrop }`.

## 7. The loudness measurement

### 7.1 What

Three numbers, from **all channels** of the decoded buffer. Today's features read channel 0 only,
and a loudness that ignored the right channel would be wrong for stereo stems.

- **`loudnessLufs`:** integrated loudness, ITU-R BS.1770-4 (as EBU R 128 uses it).
  - K-weighting: the pre-filter shelf and the RLB high-pass, designed for the buffer's sample rate
    by the standard bilinear transform, so 44.1 and 48 kHz agree.
  - 400 ms blocks with 75% overlap, channel energies summed (weight 1 each), an absolute gate at
    -70 LUFS, and a relative gate at -10 LU.
  - `null` when no block passes (silence).
- **`lowLevelDb`:** the level below about 150 Hz, in dBFS: the mean square over the whole stem,
  ungated, after a 2nd-order Butterworth low-pass. That is how much low end a loop puts down over
  its length, so a sparse kick weighs less than a rolling bassline. `null` for silence.
  - `bassEnergyRatio` stays as it is: a balance, not a level.
- **`activeFraction`:** the share of the 100 ms hops whose block is within 20 LU of `loudnessLufs`
  and above -70 LUFS. Fullness: how much of the loop is sounding. In [0, 1].

### 7.2 Where (one decode, the rule kept)

- **A pure function** `stemLevelFeatures(channels: Float32Array[], sampleRate)` in
  `src/shared/stemLevel.ts`, run in the existing analysis worker (`stemAnalysisWorker.ts`):
  - a new message kind, `'level'`, receives the channels (transferred). `'full'` gains an optional
    `channels` so a fresh extraction does both in one message;
  - the buffer is the one `analyzeStemOnce` (and `stemFeaturesCache.ts`'s
    `extractAndPersist`) already decoded. There is no second read or decode. The worker gets the
    second channel's samples as a copy, which is transient.
- **Stored in the feature row** (FeaturesJSON). `StemFeatures` gains `loudnessLufs?`,
  `lowLevelDb?`, `activeFraction?` and `levelVersion?`.
  - They are **not** part of `toFeatureArray`. The classifier's centroids and clustering are
    unchanged, as for the v2 fields.
- **A fresh extraction** (any stem with no current feature row) includes the level pass and writes
  `levelVersion: STEM_LEVEL_VERSION` (1).

### 7.3 Versioning and backfill

- **A sub-version, not a feature-version bump.**
  - Bumping `STEM_FEATURE_VERSION` would re-run pitch tracking, MFCC and onsets for every stem.
  - The level pass needs only the decode and a few biquads. So the version is `levelVersion`, and
    `STEM_FEATURE_VERSION` stays 2.
- **The needs answer** gains `level: boolean` (`src/shared/stemAnalysisNeeds.ts`):
  - true when the feature row is current but its `levelVersion` is below `STEM_LEVEL_VERSION`;
  - false when `features` is true (the fresh extraction does both);
  - main already parses FeaturesJSON per chunk to answer `features`
    (`stemAnalysisNeeds.ts`, `currentFeatureStemCIDs`), and reads the version in the same parse.
- **`analyzeStemOnce`:** `needs.level` alone decodes once and runs only the level pass.
  - The write queue gets a `level` entry.
  - `writeStemAnalysisResults` merges it into the existing FeaturesJSON row (read, merge, write)
    in the same budgeted transaction. It never touches `featureVersion` or any other field.
  - `afterStemFeatureRowWritten` fires, so the `TraitValueTable` and the quantile tables' growth
    counter see the new fields. The tables rebuild at 5% growth (`traitQuantileCache.ts`).
- **It rides the ambient scans that already run,** and their consent gates (memory: whole-library
  and overnight scans are consent-gated). There is no new scan.
- **Cost:**
  - one decode per stem, as the v2 rescan was. On this machine the decode and the USB/ExFAT read
    dominate;
  - the math is three biquads per sample per channel plus block sums: tens of ms for a 30 s
    stereo stem, in the worker;
  - measured with the dev `[work]` counters (`decode:*`, a new `analysis:level`). No number is
    claimed here.
- **Before the backfill reaches a stem,** its score renormalises without the new parts (§2.1). The
  arc works from day one, and gets better as the scan proceeds.
- **The web** re-exports the index (`npm run export-index`) once the desktop's backfill has covered
  the archive. The header's coverage says how far it got. Uploading and deploying wait for
  Elling's go-ahead.

## 8. Settings, persistence, migration, defaults

- **`RadioDensity = 'off' | 'arc' | 'intensity'`;** `RADIO_DENSITY_OPTIONS` gains it.
  - `normalizeRadioDensity` accepts it.
  - The desktop default stays `arc` (Elling switches by ear).
  - An older app reading a saved `intensity` normalises it to `arc`. That is a harmless downgrade,
    and nothing else in the file changes meaning.
- **`RadioSettings` gains `energy?: number` and `drama?: number`** (0-100, whole). They are
  optional for the same reason as `density` and `faves`. `normalizeRadioSettings` sets them:
  defaults 50 and 60, clamped and rounded.
- **The strip** (`radioStripModel.ts`):
  - picks group, right after `density`: two `slider` controls, `energy` and `drama`, setting
    `energy` / `drama`. They are greyed with density not intensity (tooltip
    `with density intensity`), in line with "greyed, not hidden";
  - play group, after `turn`: `panel('build')` and `panel('drop')`;
  - `RADIO_STRIP_HINTS.density` gains a sentence: `intensity builds, breaks down and drops, led by
    drums and bass`;
  - the coverage test's `STATES` already iterates `RADIO_DENSITY_OPTIONS`, and its every-key check
    then requires the two sliders.
- **Web:**
  - full mode gets a `density` chip group (`off`, `arc`, `intensity`) and the two dials, as
    knobs beside faves and source;
  - `build` and `drop` go in the turn group;
  - prefs: `localStorage['radio.density']`, `['radio.energy']`, `['radio.drama']`, through a
    `densityPrefs.ts` like `pacePrefs.ts`;
  - simple mode gets no controls, and plays what is stored or the defaults;
  - `densityArc.on` follows: `off` turns it off, and `arc` and `intensity` both keep it on (its
    min, max and starter order bound the rows).
- **Web defaults** (open question 3, Decided): `density: intensity`, energy 50, drama 60, for
  everyone. `WEB_RADIO_DEFAULTS` gains `density`, `energy` and `drama`.
- **Nothing radio-side is persisted** beyond these three settings. The arc's state starts fresh with
  each run.

## 9. Readout and copy

Lowercase, no emoji. The words come from shared functions (`radioReadout.ts`), so both radios and
the phone say the same thing.

| where | words |
|---|---|
| status line, build | `building ↑ 3 → 5` (as today); a big cycle `building ↑↑ 3 → 5` |
| status line, breakdown | `breakdown · drop in 12 bars` (to the drop's planned top); below 360 px `breakdown · 12` |
| status line, drop | `drop · 5 rows` |
| held | `held · 4 rows` (as today) |
| `next` part | as today, plus `next: drop · 4 bars` once the drop is decided, and `next: row 2 rests` for breakdown rows |
| ruler end | the drop's turnaround label, e.g. `riser + gap` |
| flashes | `breakdown` and `drop` on their lines; `build` on a pressed build's top |
| row word, resting | `rests till the drop` (19 characters; the phone's short form `rests`) |
| buttons | `build` / `building`; `drop` / `dropping`; tooltips `build: go up now`, `drop: the drop at the next top` |
| dials | `energy` (tooltip `gentle to driving`), `drama` (tooltip `how far it swings`) |

`RadioReadoutArcState` gains `breakdown` and `drop`. Its input gains `dropInBars?` and `big?`.

## 10. Byte-identity and randomness

- **The guarantee:** with `density` not `intensity`, every shared function draws exactly what it
  drew before and returns the same:
  - `rankCandidates` without `intensity` is identical;
  - `pickStem` and `pickForSlot` make no band draw;
  - the forecast has no `arcRole`, and `radioBuildTier`, `radioPhraseEndBuild` and `rollTurnaround`
    are today's;
  - hooks get no `dropAtNextWrap` or `inBreakdown`;
  - fold gets the plain bend;
  - throws get no `dropAt`.
- **Proved** by the web's no-intensity action log against HEAD (60 runs, as the anointed checks
  ran), the fold fingerprint `0540eeea`, and seeded 10k-draw equality tests for each shared
  function with the option absent.
- **What does change for everyone:**
  - the desktop's background analysis (the level pass and its backfill). Feature rows gain fields.
    No existing field or percentile changes: `TRAIT_FIELDS` is untouched, and the intensity tables
    are separate;
  - the web index gains `x`, which nothing reads without intensity.
- **Draw order under intensity** is §3.5. Picks: faves, dig, band.

## 11. Architecture

### Shared (`sssketch/src/shared/`, TDD)

- **`radioIntensity.ts` (new):**
  - `INTENSITY_FIELDS`, `INTENSITY_WEIGHTS`, `stemIntensityScore`;
  - `INTENSITY_ROLE_WEIGHT`, `radioIntensityRoleWeight`;
  - `RankIntensity`, `intensityPoolRanks`, `applyIntensityBand`, `INTENSITY_BAND_CHANCE`,
    `INTENSITY_WEIGHT`;
  - `radioBedIntensity` (for sims and tests).
- **`radioIntensityArc.ts` (new):**
  - `RadioIntensityArc`, `newRadioIntensityArc`, `radioIntensityTargets(e, d, big)`,
    `drawIntensityPhrases`;
  - `stepRadioIntensityArc(state, input)`. It returns the next state plus `prepare`, `decided`
    (strip, add, breakdown with rows and throw, drop with renewals) and `target`;
  - `radioBreakdownRests`, `pressRadioIntensity(state, 'build' | 'drop', where)`.
- **`stemLevel.ts` (new):** `stemLevelFeatures`, K-weighting and low-pass coefficients by sample
  rate.
- **Changed:**
  - `stemFeatures.ts` (fields, `STEM_LEVEL_VERSION`), `stemAnalysis.ts`, `stemAnalysisNeeds.ts`
    (`level`), `stemAnalysisWrite.ts` (`level`);
  - `traitQuantiles.ts` (tables for `INTENSITY_FIELDS`, beside `TRAIT_FIELDS`, not inside it);
  - `discoverCandidate.ts` (`intensity?`), `discoverRanking.ts` (`intensity`);
  - `radioSchedule.ts` (density option, `energy`, `drama`, normalise);
  - `radioBuildSize.ts` (`arcRole`), `radioTurnaround.ts` (`drop`), `radioHooks.ts` (two inputs),
    `radioThrows.ts` (`dropAt`);
  - `radioReadout.ts`, `radioStripModel.ts`, `remoteState.ts`.
- Every shared change keeps `ell.ing/radio`'s `npm run typecheck` green (`noUnusedLocals`).

### sssketch desktop

- **main:**
  - `stemAnalysisNeeds.ts` (`level`), `stemAnalysisResultsWriter.ts` (the merge);
  - `traitQuantileCache.ts` (three columns, the new tables);
  - `discoverCandidates.ts` (`alsoIntensity`), `index.ts` + preload (the IPC parameter);
  - `remoteServer.ts` (`/api/arc`).
- **renderer audio:** `analyzeStemOnce.ts` (`needs.level`), `stemFeaturesCache.ts` (channels to the
  worker), `stemAnalysisWorker.ts` / `stemAnalysisClient.ts` (`'level'`), `analysisWriteQueue.ts`.
- **`DiscoverPanel.tsx`:**
  - `intensityArcRef` beside `densityLegRef` (:2941);
  - `densityTick` / `densityAtWrap` (:10069, :10090) branch on `intensity`;
  - rests through `radioRestingRef` with an owner (hook or arc), `radioRestEnds` /
    `radioRestReturnsByHand` (:4774, :4811);
  - the forecast's `arcRole` in `radioForecastNow` (:3875) and the roll (:3589-3860);
  - the hook step's two inputs (:4917);
  - the fold step's bend (:5118);
  - `pickForSlot`'s band and term (:9001), and `alsoIntensity` on its fetches (:8850-8880);
  - the buttons and the readout (:5731).
- **No engine (C++) change:** rests are the preview mix, and the riser and gap already exist. The
  `EngineProject` wire format is untouched.

### ell.ing/radio

- **`step.ts`:**
  - `RadioState.intensity`;
  - `densityAtWrap` (:2903) branches; `RadioRow.resting` gains an owner (`'hook' | 'arc'`), with
    `restEnds` and `landRest` taught the arc;
  - `forecastAt` (:1720) and `rollTurnaroundAt` (:1492) carry `arcRole` and `drop`;
  - `hooksAtWrap` (:2594) gets the inputs; `foldAtWrap` (:3714) gets the bend;
  - new events `build` and `drop`.
- `pick.ts` (band, term, `x` to `intensity`), `controller.ts` (events; throws' `dropAt`),
  `settings.ts` (defaults).
- `ui/full.ts` + `fullModel.ts` (chips, dials, buttons, words), `ui/densityPrefs.ts` (new),
  `main.ts`.
- `src/index/shapeRecord.ts` (`x`), `traitPercentiles.ts` (or a sibling `intensityScores.ts`: tables
  for `INTENSITY_FIELDS`, `stemIntensityScore` per stem), `buildIndex.ts` (coverage),
  `scripts/export-index.mjs` (header comment).

## 12. Timing risks

1. **Order at the wrap** (§3.1): intensity before hooks before fold before the roll. A test pins it
   in the web trace, and the desktop mirrors it.
2. **A renewal pick not warm at the decide wrap:** the row's own stem returns, with no draw. The
   drop is still `large` (the low end returns either way). It never oversells.
3. **A rested row muted, locked or removed during the breakdown:** it is simply not there at the
   drop. If it was the only low row, the drop's forecast loses `lowEndReturn` at the next forecast
   rebuild. If the roll already happened, it is logged `[radio-build] oversold`, as today.
4. **Loop length changing in a breakdown:** the phrase is recomputed each wrap (`P`). The
   breakdown's length is in phrases, so it keeps its meaning.
5. **Desktop pause and resume:** the arc counts the wraps the lap clock sees. A resume does not
   double-count (fold's and hooks' rule).
6. **The breakdown's echo throw and a turnaround's silencing move on the same row:** `exiting`
   keeps the planner off it. A test checks `turnaroundSilencedRowIds(plan)` never includes a
   breakdown row.
7. **A button and an armed turnaround on the same top:** the button's turn replaces the armed one
   while it can still be taken back (the turn spec's arm-and-clear path). Otherwise it takes the
   next top.

## 13. Testing

### Shared (sssketch vitest, TDD)

- **`stemLevel.test.ts`:**
  - a 997 Hz sine at -20 dBFS: mono reads -23.0 LUFS (±0.1); stereo, identical channels, reads
    -20.0;
  - the same at 44.1 and 48 kHz within 0.1 LU;
  - half the stem silent: the loudness is unchanged (gating) and `activeFraction` is about 0.5;
  - `lowLevelDb`: a 50 Hz sine against a 5 kHz sine at equal level, at least 30 dB apart;
  - silence gives nulls;
  - the EBU Tech 3341 cases 1-2 if generated in-test.
- **`radioIntensity.test.ts`:**
  - the weights at every part combination, and renormalisation with each input missing;
  - null with neither busy nor low;
  - the role weights; pool ranks with ties;
  - the band's back-off, and no band draw while off;
  - the term's bounds (0 to 1);
  - `rankCandidates` without `intensity` identical over 10k seeded pools;
  - an unscored pool ranks as today plus a constant.
- **`radioIntensityArc.test.ts`:**
  - phase lengths at the energy knots, and the fit rule;
  - phases change only on phrase starts, at loops of 1, 2, 3, 4, 5, 8, 16 and 32 bars;
  - prepare a phrase ahead, decide a lap ahead, binding;
  - the big cadence (every 3-4 cycles; never the first) and what big changes;
  - targets at the knots;
  - the depth table, and the "never silence" property over 10k random beds (locks, solos, mutes,
    combination rows, hooks): at least one carrier always sounds;
  - the breakdown's time limit;
  - the buttons in every phase; held freezes the clock;
  - no draws and an unchanged state with density not intensity;
  - the draw order of §3.5.
- **Builds, hooks, fold, throws, readout:**
  - `arcRole` tiers, payoffs and the drop's budget exemption; no promotion under intensity;
  - `rollTurnaround` with `drop`: a riser lead, gaps at drama 50+, and draw-for-draw today without
    it;
  - hook returns pulled to the drop and held through a breakdown, and no exits there;
  - the bend formula;
  - `dropAt` aiming;
  - every new word at 22 characters or less where the row limit applies.
- **main (vitest):**
  - the `level` need;
  - the writer's merge keeps every other field and `featureVersion`;
  - the new tables follow the 200-row rule;
  - `alsoIntensity` attaches the score, and is absent otherwise.

### Web (vitest): seeded simulations

The `step.test.ts` Sim, 4-bar and 8-bar loops, 120 bpm. Four simulated hours per point of the
energy × drama grid {0, 50, 100}². Each run records per bar:
- the **sounding row count**;
- the **bed intensity**: the role-weighted mean score of the sounding rows (`radioBedIntensity`);
- the **low presence** (some sounding drums row, some sounding bass row);
- the **phase**;
- the turnaround at each phrase end (size, riser, gap).

Measured and asserted (first targets, [INF], to tune by ear):
- **Never silent:** no bar with zero sounding rows, at any point of the grid.
- **The low end is missing only by design:** both drums and bass absent only inside a breakdown or
  a turnaround move.
- **The shape:**
  - at the default point, the bed intensity's mean in the drop phase is at least 0.2 above the
    build's first phrase;
  - the mean within builds rises phrase by phrase (Spearman over phrases > 0);
  - breakdown phrases carry the lowest low presence.
- **The lean works:** at the default point, the mean pool rank of drums and bass picks is at least
  0.65 in the drop and at most 0.45 in the build's first phrase.
- **The drop is the moment:** every drop with something rested has a `large` turnaround with a
  riser lead; gaps at drama 50 and up are 100% of drops, and outside drops 0%.
- **Cycle lengths** match §3.2's table (±1 phrase in the mean). Big cycles come every 3-4.
- **Pick health:** null picks are no more frequent than in the no-intensity baseline. The band backs
  off in under 10% of draws.
- **Byte-identity:** with density absent, the action log is byte-identical to HEAD (60 runs).
- **`pick.test.ts`:** the band, the term and `x`.
- **`buildIndex.test.ts`:** `x` and coverage.
- **Offline renders** with headless Chrome (`check:engine`): the breakdown's echo rings over its
  line, and a drop under a riser and gap.

### Desktop

- Typecheck, lint and the shared tests. The panel glue has no tests, by convention.
- The backfill: run the dev scan on a library and read the `[work]` counters (decodes,
  `analysis:level`) before claiming any cost.
- **No agent can hear either radio, see the UI or hold a phone.** Elling's walkthrough:
  1. Density `intensity` at the defaults: over 5 minutes, a build (rows join, drums get busier),
     then on a phrase start the drums echo out and the bass goes, the pads carry, and 16-32 bars
     later the riser and gap bring them back as the drop.
  2. Drama 10: a swell, with nothing dropped out and no gap. Drama 100: full breakdowns.
  3. Energy 0: long builds, two-phrase breakdowns. Energy 100: short breakdowns, long rides.
  4. A bigger peak within about 15 minutes: five rows, a second drums layer, a deeper breakdown.
  5. `build` in the ride: the build starts at the next top. `drop` in a breakdown: the drop at the
     next top. `drop` while building: a quick low drop and back.
  6. A hook on the drums: it rests through the breakdown and is back on the drop. An away hook
     comes back at the drop.
  7. Fold on: more bend at the drop, less in the breakdown.
  8. Unmute a resting row (desktop): it plays at once, and the drop still lands for the others.
  9. The phone: build and drop work, and the words fit at 320 px.
  10. The backfill runs in the background without slowing the UI (the dev counters).

## Open questions for Elling (all Decided, 2026-10-05)

Elling answered all four on 2026-10-05. The implementation plan
(`docs/superpowers/plans/2026-10-05-radio-intensity-arc.md`) builds these answers.

1. **The turn chip `drop`** is a drum drop-out, the opposite of the drop.
   - **Decided: rename the chips to `drums out` and `low out`.** This is a copy change only:
     chips, row flashes, the ruler's turnaround label, the desktop strip and the phone's chips
     (all read `TURNAROUND_MOVE_LABEL`), and the web's full mode.
   - The move ids `drum drop` and `low drop` stay. They are on the phone's wire (`/api/turn`'s
     `move`) and in dozens of tests, so renaming them is not cheap, and nothing user-facing shows
     them.
   - A turn's ruler label with a two-word lead that cannot fit says the lead and the gap
     (`turn: drums out → gap`). The phone's 23-character limit holds.
2. **`drop` pressed while building or riding.**
   - **Decided: a quick drop.** Drums and bass go out for a bar or two (the planner's `low drop`
     in the lap before the top, the gap by drama), and they are back on the one. There is no full
     breakdown first. Then a fresh ride (section 6).
3. **Web default.**
   - **Decided: `intensity` for every visitor, energy 50, drama 60.**
   - The desktop stays on `arc` until Elling switches it.
4. **Drums and bass on the drop.**
   - **Decided: as proposed.** Each returning drums or bass row comes back on its own stem by
     default. With chance 25% + 50% × drama (55% at the default), it comes back on a fresh,
     heavier pick that is leaned to the top target at full weight and warmed a phrase ahead
     (section 4.4).

## Out of scope

- Fluoddity reacting to the phase (the web's simple-mode visuals). It could read the phase later.
- Drum rolls and snare builds in the riser: they need a retrigger in both engines (glitch phase 2).
- Key-aware picks: no index has a musical key (anointed §3.5).
- Auto-arrange's use of the arc.
- Per-role quantile tables: pool ranks (§2.3) make them unnecessary for picks.
- A tempo lift into the drop.
