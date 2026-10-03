# Radio fold mode: Autechre-inspired polymeter and clash

**Date:** 2026-10-02
**Scope:** sssketch Discover radio and ell.ing/radio, built together. Pure rules in `src/shared`.
**Phase:** 1 of 2. Glitch (retrigger, skip, slices) is phase 2, a separate spec that needs engine
work.

## Why

Elling wants an Autechre-inspired mode: unusual combinations, layers in different time
signatures, intertwined. The engine now loops stems at exact fractional lengths (commit
`ef966ab`), which is what polymeter needs.

## Decisions (Elling, 2026-10-02)

- **One mode with its own settings**, not scattered rows. Normal radio is untouched when the mode
  is off.
- **Phase 1 covers polymeter and phasing, odd meters, and unusual pairings.** Glitch comes later.
- **Seeded rules steered by faders, not dice.** A seed makes a session replayable.
- **Both radios**, with shared rules, like turnarounds.

## 0. The research, and what it decides

Read 2026-10-02.
- **Primary sources:**
  - Sound on Sound (Tingen, 2004);
  - Grooves (2001);
  - Index (2000);
  - Resident Advisor (2016);
  - Pitchfork (2018);
  - Nialler9 (2023);
  - FACT (2008);
  - Clash (2010).
- **Secondary sources:**
  - Mesker, "Analysis and recreation of key features in selected Autechre tracks 1998–2005", MA
    thesis, Macquarie (2008);
  - Ebner on Confield, Disquiet (2019);
  - the aepages wiki, for relayed quotes.

Tags: [P] is their own words, [S] is analysis, [I] is our inference.

- **Rules, not randomness.** "We don't use random operators because they're irritating to work
  with… How we play the system dictates how the system responds" (SOS) [P]. "I don't use
  random-number generators — I fuckin' hate 'em" (Grooves) [P].
  → *Decisions come from seeded, counter-based rules ("after 3 cycles of X, offset Y"), not fresh
  rolls.*
- **Faders on a generator.** "A sequencer is spitting out stuff and we're using our ears and the
  faders" (SOS) [P]. "Go from this beat to that beat over this amount of time, with this curve"
  (SOS) [P].
  → *Two macro faders. Lengths move along curves, never jump.*
- **Less generative than assumed.** Confield was about 10% generative, and Draft and Untilted are
  largely straight grids (aepages; Pitchfork 2005) [P, relayed].
  → *The mode moves between straight stretches and folded ones.*
- **Repetition on purpose.** "I'm going to loop this more than I should" (Nialler9) [P]. "Same loop,
  but they keep changing everything" (FACT) [P].
  → *Content changes slowly, and parameters drift constantly.*
- **Polymeter means clocks driving clocks.** Booth describes sequencers driving other sequencers
  "with a different timing" (SOS) [P]. "777" is a fixed 7-beat cycle of two 3.5-beat halves over a
  steady pulse (Mesker) [S]. "VI Scose Poise" is "dueling meters fall in and out of phase" (Ebner)
  [S].
  → *One anchor stays in 4/4, and one or two layers fold to odd cycles. Odd meter lives inside a
  layer, not over the whole track.*
- **Parameter space.** "If you consider each parameter to be an axis… like wandering around a
  fractal" (Nialler9) [P].
  → *A seed plus faders is a position in that space, and replaying a seed returns there.*
- **Clash** has no direct quote. The nearest is Booth's taste for sounds "slightly out of tune", and
  Rob running beats through different compressors and finding them "fucking funky" [P].
  → *The clash is in time and timbre, held together by shared processing. Never in key, because
  without pitch control a key clash reads as a mistake [I].*
- **Pitfalls to avoid:**
  - randomness with no memory;
  - everything odd at once, so nothing to phase against;
  - changing too often;
  - realignments too far apart to hear;
  - clicks at crop seams;
  - key clashes;
  - forgetting the straight material.

## 1. The mode

- **Name and switch.** `fold` (Autechre's "folding time"). It is a radio switch, `fold: off / on`,
  next to the radio controls, and it is only meaningful while radio is on.
- **The anchor.**
  - The longest audible drums or bass row is the anchor. It stays at full length, sets the loop
    top, and so keeps changes, turnarounds and turns anchored.
  - With no drums or bass row, the longest row is the anchor.
- **Folded layers.**
  - At most **two** rows are folded at once, never the anchor.
  - A row can fold only if it is short and rhythmic: kinds `drums`, `rhythmic`, `bright`, or a
    percussive stem type. It cannot be `lead`, `bass`, a hooked row, or longer than 4 bars.
  - Melodic and phrase-length stems are never cropped.
- **Lengths.**
  - A folded cycle is drawn from {3, 3.5, 5, 5.5, 7, 9} beats, never longer than the stem's own
    length.
  - It is allowed only if its realignment period with the anchor, the lowest common multiple in
    beats (on a 1/2-beat grid), is between **30 and 120 seconds** at the current tempo.
    - 7 beats against 16 realigns every 112 beats, about 56 s at 120 bpm: allowed.
    - 11 against 13 never realigns audibly: refused.
  - A cycle can start on a phase offset of 0, a 1/16, or a 1/8 triplet.
- **Curves.**
  - Folding steps the row's cycle from its full length toward the target over successive loop tops,
    for example 16 → 14 → 12 → 7 beats, in 2 to 4 steps.
  - Unfolding walks back the same way.
  - Each step lands on a loop top. A **10 ms micro-fade at the cycle seam** prevents clicks.
- **Realignment.** When a folded layer's cycle realigns with the anchor's loop top, that top is
  marked. The next layer change or turnaround prefers it, and the fold's own state change (fold
  further, unfold, or change length) happens on one.
- **Pace in fold mode.**
  - Layer changes slow to every **16–64 bars**, replacing the pace window while the mode is on. The
    user's pace setting comes back when the mode is turned off.
  - Turnarounds still fire at phrase ends.
- **Drift.** Seeded slow curves move each row's filter cutoff (±, never closed), reverb send, and
  the dub-echo send, over **32–128 bars per sweep**. Content holds while parameters move.
- **Straight versus folded.** The rules alternate a **straight stretch** (no folds) with a
  **folded stretch**. The `fold` fader sets the share and length of folded stretches. Straight
  stretches are part of the music.

## 2. Controls

All copy is lowercase.

- **`fold` (0–100), "how folded".**
  - **0:** always straight. The mode then only slows pace and adds drift.
  - **Low:** one layer at a time, mild lengths (7 or 9 against 16 or 8), short folded stretches.
  - **High:** two layers, odder lengths (3.5, 5.5), half-beat offsets, longer folded stretches.
- **`clash` (0–100), "how mismatched".**
  - **0:** the picker's normal matching.
  - **Higher:** the picker inverts its match on rhythmic strength and brightness. Bass energy and
    harmonic content stay matched.
  - A clashing pair gets a static low-pass (about 0.5) on the brighter of the two, so they don't
    fight in one band.
  - Above 50, the master glue and saturation lean in slightly (a small offset, never past the
    listener's own setting by more than 0.15).
- **`seed`.**
  - Shown as a 6-character code.
  - `new` draws one, and typing or pasting one replays it.
  - Replay is exact for the rules. Picks depend on the library too, so the same seed on a changed
    library can choose different stems. The panel tooltip says so.
- **Surfaces:**
  - sssketch radio menu: a `fold` section with the switch, two sliders and the seed;
  - web full mode: the same, next to the turnaround toggles;
  - phone remote: the on/off switch only.
- **Defaults:** `fold` 40, `clash` 25, mode off.

## 3. Architecture

- **Shared, pure, tested in sssketch.**
  - **`src/shared/radioFold.ts`**, a seeded state machine. Its input is the rows (id, kinds, bar
    length, hooked, audible), the anchor, the tempo, `fold`, the seed, and a wrap counter. Its
    output, per loop top, is:
    - each row's `cycleBeats` and `phaseOffsetBeats`, or full length;
    - realignment marks;
    - stretch state;
    - drift curve targets.
  - A small seeded PRNG (a mulberry32-style generator) lives in the shared module. All randomness
    flows from the seed and counters. **The same seed and the same event sequence give the same
    decisions.**
  - **The `clash` weighting** goes into the candidate picker's match, in the shared picker module.
    It inverts the match on rhythm and brightness traits, with an amount from 0 to 1.
  - `radioFoldAllowedCycles(anchorBeats, bpm)` holds the realignment-window rule.
  - The settings `foldMode`, `fold`, `clash` and `foldSeed` go in `RadioSettings`, normalised and
    migrated with defaults.
- **sssketch.**
  - A row's fold becomes its stem's loop length:
    - `barLength = cycleBeats / 4`;
    - `durationSec` is scaled by the same ratio;
    - the offset goes into the existing `offsetSteps`.
    This is passed through the existing project build.
  - **First plan task:** an engine test proving a cropped stem (`barLength` and `durationSec`
    scaled together) loops its first N beats at tempo, with an offset. If it doesn't, the plan adds
    the minimal engine support, plus the 10 ms seam fade.
  - Drift curves go on the existing stem automation lanes.
  - Pace is overridden while the mode is on.
- **ell.ing/radio.**
  - `rowVoice` / `schedule` loop a folded row at `cycleBeats` with its offset, using the existing
    timed sources.
  - `step.ts` consults `radioFold` at each wrap.
  - Drift goes through the existing automation.
  - The full-mode UI follows the turnaround toggles' pattern, remembered per visitor
    (`radio.fold`).
- **Turns and turnarounds** work unchanged on the anchor's loop top. A folded row counts as an
  ordinary row for their guards.

## 4. Testing

- **Shared:**
  - same seed, same decisions, over many wraps;
  - no fold on an anchor, melodic, hooked or long row;
  - at most two folded;
  - every chosen cycle within the realignment window at the tempo;
  - curves step toward their target and land on loop tops;
  - realignment marks are correct for sample anchors and cycles (7 against 16, 5 against 8,
    3.5 against 16);
  - straight and folded stretches alternate, with `fold` 0 always straight;
  - the clash weighting keeps bass and harmony matched;
  - settings normalise.
- **Engine (sssketch, `--test`):**
  - a cropped stem loops its first N beats exactly, with an offset;
  - the seam fade has no discontinuity above threshold.
- **Web:**
  - `step.ts` applies fold decisions at wraps;
  - an offline render check shows a folded row repeating every N beats;
  - prefs persist.
- **Elling's walkthrough:**
  1. Fold on at `fold` 40: one layer drifts against the beat and audibly realigns about every
     30–120 s.
  2. Folding and unfolding are gradual, with no clicks at seams.
  3. Straight stretches return.
  4. `clash` high sounds mismatched but not out of key.
  5. Copying a seed and replaying it gives the same behaviour.
  6. Turnarounds and turns still land on the one.
  7. Turning the mode off restores normal pace and lengths.

## Out of scope (phase 2 and later)

- **Glitch:**
  - retrigger with an accelerating interval (Gantz Graf);
  - read-position skips on a sub-bar grid;
  - step gating;
  - freeze;
  - the `skip` fader.
  All of these need engine work in both runtimes.
- Global tempo ramps and per-layer rate offsets (Reich-style phasing).
- An odd meter for the whole radio (every stem cropped to 5 or 7 beats).
- Fold in auto-arrange.
