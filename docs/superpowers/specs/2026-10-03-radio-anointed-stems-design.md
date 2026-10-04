# Radio anointed stems: hooks that come back, dig, and build-ups sized to the change

**Date:** 2026-10-03
**Scope:** sssketch's Discover radio and ell.ing/radio, built together. The rules go in
`src/shared/` (TDD); each runtime only drives them.
**Builds on:**
- `2026-09-28-radio-controls-design.md` §6.4 (the hook as shipped), §6.5 (what stem-to-stem scoring
  needs), §8 (`more like this`: decay, bias-never-filter);
- `2026-10-02-radio-turnarounds-design.md` and `2026-10-03-radio-turnaround-combos-design.md` (the
  planner, the riser's gap, §0's theory);
- `2026-10-03-radio-pace-slider-design.md` (the level, the turnaround phrase that stays 16 bars,
  companions);
- `2026-10-03-radio-fold-follows-pace-design.md` (top landings on folded rows, release, carry);
- `2026-10-03-radio-readout-design.md` (status line, row labels, flashes).

## Why

Today the hook is a ROW flag that only makes radio change that row less often. Elling wants two
things it cannot do:

- a stem he points at becomes a recurring element: it leaves, and it comes BACK, and the return is
  an event;
- a way to say "more from around here" without freezing anything.

And, listening to the web radio: "the noise sweep almost oversells the change that's about to
come". A full riser before a one-row swap promises a drop that never arrives.

## Decisions (Elling and the coordinator, 2026-10-03)

1. **Roles are live:** set on a playing row, in both radios, by any web visitor; for this session
   only. No curated or persistent tags.
2. **Two roles: `hook` and `dig`.** No `anchor`: drums that stay forever are boring. "Main drums"
   is a hook on a drums row.
3. **Hook** (a toggle, the successor to "hold longer"; several rows may be hooks; 👍 still stars
   AND hooks):
   - the hooked STEM, not the row, stays 16-32 bars;
   - then it may leave on a phrase boundary with an echo throw (a dub exit, no build);
   - it is away 16-32 bars (drawn from {16, 24, 32}, weighted; never under 8 or over 64), scaled by
     the pace slider (shorter at ludicrous, longer at slow);
   - it returns on its own row on a phrase start, preferring a boundary where another change lands,
     so the return IS the drop. It may wait one more phrase when things have been calm, and comes
     back on time when busy;
   - at most ONE hook is away at a time, so drums and bass are never both out (that is a deliberate
     breakdown, not built here);
   - after about 3 return cycles a hook takes a longer rest;
   - while away, its row usually plays something else (radio picks), and sometimes drops out while
     the density arc is thinning;
   - row UI while away: the hooked stem's name dimmed, readout `hook · back in 16 bars`; tapping it
     brings the hook back early, at the next phrase start.
4. **Dig:** a new row toggle, one at a time (tapping another row moves it). While on, picks for ALL
   rows lean gently toward stems near the dug stem: same jam, close in time, similar traits. The
   desktop may add its riff-sequence adjacency. Readout `dig`.
5. **Build-ups sized to the change:**
   - nothing, or one ordinary row swap: no build, or a fill of at most a bar;
   - a hook back after a short absence (16 bars or less), or two rows changing: a short riser, no
     gap;
   - a hook back after a long absence (24 or more), drums or bass returning, three or more rows, or
     a density-arc step: a full riser and the gap;
   - never a full noise sweep before a single-row swap.

   This applies to the per-change gestures (`radioTransition.ts`) AND to phrase-end turnarounds: a
   riser at a phrase end where nothing changes should be rare.
6. **Every turnaround is paid off** (Elling, after this spec was first written: "a turnaround feels
   like a letdown kinda if there isn't a somewhat dramatic change to the current state"). The
   pairing goes both ways: a fired turnaround, any move, brings a noticeable change on its wrap,
   sized to it; a phrase end where nothing can change gets no turnaround (§4.7).

## 0. The theory, and what it decides

Tags: **[EV]** an empirical study; **[SRC]** a scholarly source that is not an experiment
(musicology, analysis); **[LORE]** producer and DJ practice; **[INF]** our own inference. No source
gives any of the numbers below; every number is [INF], to tune by ear.

- **The return of a part is itself a hook.** Burns' typology of hooks in recorded popular music
  lists arrangement hooks alongside melodic ones: an instrument dropping out and coming back, a riff
  re-entering, the drums returning after a break (Burns 1987, "A typology of 'hooks' in popular
  records", *Popular Music* 6(1)). [SRC]
  - *So:* a hook is not a stem that never leaves. It leaves, and its return is the event (§2).
- **Preparation proportional to the event.** Huron's ITPRA model separates the tension response
  before an expected event from the reaction to it. Preparation is costly, so listeners (and
  composers) scale the build-up to how important and how certain the outcome is (Huron 2006, *Sweet
  Anticipation*, ch. 1-2). [SRC] A build that promises more than arrives gives a negative
  prediction response; one that arrives with nothing before it loses the anticipatory pleasure.
  [INF from SRC]
  - *So:* the size of the build follows the size of the change (§4). A noise sweep before a
    one-row swap is a promise broken.
- **Contrast, and a matched build.** In EDM the drop works through contrast with the breakdown and
  through a build whose length and intensity match the drop that follows. Listeners report the
  peak at the drop, and disappointment when the pacing misjudges it (Solberg 2014, "'Waiting for
  the bass to drop': Correlations between intense emotional experiences and production techniques
  in build-up and drop sections of electronic dance music", *Dancecult* 6(1); Solberg & Jensenius
  2016, "Pleasurable and intersubjectively embodied experiences of electronic dance music",
  *Empirical Musicology Review* 11(3-4)). [EV]
  - *So:* the full build (a riser and the gap) is kept for the changes big enough to be a drop: a
    long absence ending, the low end coming back, several rows at once.
- **Moderate predictability.** Liking is an inverted U over predictability (Gold, Pearce,
  Mas-Herrero, Dagher & Zatorre 2019, *J. Neuroscience* 39(47)). Pleasure is highest for surprise
  in a predictable context, or for confirmation in an uncertain one (Cheung, Harrison, Meyer,
  Pearce, Haynes & Koelsch 2019, *Current Biology* 29(23)). Groove shows the same inverted U for
  syncopation (Witek, Clarke, Wallentin, Kringelbach & Vuust 2014, *PLoS ONE* 9(4)). [EV]
  - *So:* when it has been calm (low uncertainty), a return may come a phrase late (a mild
    surprise). When it has been busy (high uncertainty), it comes back exactly on time (§2.6).
- **Repetition, and wearing out.** Repetition is how music becomes familiar and is enjoyed (Margulis
  2014, *On Repeat*, OUP). [SRC] Mere exposure raises liking up to a point, then over-exposure
  lowers it: an inverted U over exposures (Zajonc 1968; Szpunar, Schellenberg & Pliner 2004, *J.
  Exp. Psych.: LMC* 30(2)). [EV]
  - *So:* a hook cycles, and after about three returns it rests longer, so it is not worn out in
    one session (§2.6).
- **Dub's exits are echoed out.** In dub the mixer drops parts out and brings them back as the
  structure of the version, and a part leaving is often thrown into the echo, its repeats carrying
  it out (Veal 2007, *Dub: Soundscapes and Shattered Songs in Jamaican Reggae*, Wesleyan). [SRC]
  The bass is muted dry rather than echoed: a delayed bass smears the low end. [LORE]
  - *So:* a hook leaves with an echo throw and no build; a bass hook leaves dry (§2.5).
- **8-, 16- and 32-bar units.** EDM is built in hypermeasures of 8, 16 and 32 bars (Butler 2006,
  *Unlocking the Groove*). [SRC] Producers put fills before small changes and risers before section
  changes. [LORE]
  - *So:* hook events sit on 8-bar lines and returns on 16-bar phrase starts (§2.2). A one-row
    swap gets at most a fill-sized gesture (§4).

## 1. What exists today (verified)

**The hook is a row flag.** `src/shared/radioSlotFlags.ts`:
- `RadioSlotFlag = 'hook' | 'replace-soon'` (:54), one flag per slot id, not persisted (:36-39).
- `HOOK_HOLD_FACTOR = 8` (:82) divides the row's draw weight in `pickRadioSlotId`
  (`radioSchedule.ts:812`, via `radioSlotFlagWeightFactor` :134). `REPLACE_SOON_FACTOR = 4` (:129).
- At most one hook: `toggleRadioHook` (:163) releases any other.
- 👍 is `likeRadioSlot` (:191): it stars, and hooks the slot if it can.
- `forgetRadioSlotFlagOnChange` (:252) clears only `replace-soon`.

**Where the hook is read:**
- Fold: `radioFoldCanFold` refuses a hooked row (`radioFold.ts:190`; `RadioFoldRow.hooked` :164).
- Turnarounds: `TurnaroundRow.hooked` (`radioTurnaround.ts:248`) keeps a hooked melodic row first
  for the stop.
- Density arc:
  - web `removalVictim` never removes a hooked row (`ell.ing/radio src/radio/step.ts:1659`);
  - desktop `pickArcRemoval` skips `ArcRow.held` (`radioDensity.ts:134`, :163), fed from the flag
    at `DiscoverPanel.tsx:8376`.
- Desktop panel: `:725`, `:3818`, `:3892`, `:8456`, `:11304` (the 👍's "holding" fill).
- Web: the `hook` event (`step.ts:661-662`), turnaround and fold rows (:1233, :2164, :2267), and
  `likes.ts:39`.

**There is no hook button.** On both radios 👍 replaced the star and "hold longer" on 2026-10-01
(`DiscoverPanel.tsx:11316-11318`, `:12042-12051`; web `src/ui/full.ts:30`: mute, solo, skip, like,
dislike; the web's 👍 calls `toggleHook` only to turn it on, `main.ts:590`). Today the row UI can
set a hook but not release it, except by hooking another row.

**Picks:**
- Desktop `pickForSlot` (`DiscoverPanel.tsx:7186`): faves draw, `fetchPool`, dedupe,
  `applyTraitBar`, then `rankCandidates` (:7329) and `pickReroll` (:7351).
- Web `pickStem` (`src/radio/pick.ts:286`): the same pipeline over the in-memory index. The faves
  draw (:328) goes through `drawPool(keep)`, then `rankCandidates` (:341).
- `rankCandidates` (`discoverRanking.ts:78`) sums: BPM closeness (max 1), `FAVOURITE_BOOST` 1.5
  (:40), `TRAIT_SCORE_WEIGHT` 1 per requested trait (:51), and clash. `pickReroll` (:204) draws
  score-proportionally from a chaos-sized head of the ranking.

**What a candidate knows about where it came from:**
- Desktop `DiscoverCandidate` (`discoverCandidate.ts`): `jamCID`, `riffCID`, `riffCreationTime`,
  and `traitPercentiles`, but only for the kinds the slot asked for (controls spec §6.5).
- Web `IndexRecord` (`src/index/shapeRecord.ts`): `id`, `jam`, `t`, `bpm`, `bars`, `mask`, `role`,
  and `traits` (all four percentiles when analysed). Its `key` is the object FileKey, **not a
  musical key**. Neither runtime knows any stem's musical key.
- Adjacency (desktop only): `getAdjacentDiscoverCandidates(centerRiffCID, kinds, source, creator)`
  (`main/discoverAdjacency.ts:115`) walks the same jam's riffs by CreationTime, up to 4 matching
  riffs each way. `pickAdjacentCandidate` (`shared/discoverAdjacentPick.ts:29`) picks uniformly.

**Builds today:**
- The per-change palette `pickTransition` (`radioTransition.ts:101`) draws a kind from a table by
  temperament and the row's kinds (:67-83). At `bold` every table gives `riser` 0.1, whatever the
  change. `radioGestureBeats` (`radioManualChanges.ts:20`) makes a riser 8 beats.
- Phrase-end turnarounds (`rollTurnaround`, `radioTurnaround.ts:609`) are rolled at the start of
  the phrase's last lap. Their inputs are `TURNAROUND_CHANCE` (:53), the arc's weights (:235, riser
  3 when growing), riser lengths of 1, 2 or 4 bars (:348), and the gap 3 in 4
  (`TURNAROUND_GAP_CHANCE`, :864). Nothing in the roll knows what lands on its wrap.

**Throws** (`radioThrows.ts`): one every 16-32 bars, never on drums or bass (`NEVER`, :30), aimed
to end on a coming transition's downbeat (`stepThrows` :129, `turnaroundThrowAim` :244). The
desktop drives the same rules through `@shared/discoverThrows`.

**Phone** (`remoteState.ts:345`): `RemoteSlotAction` is mute, solo, similar, adjacent, random,
duplicate. No like or hook.

## 2. The hook

### 2.1 What is hooked

A hook is a **stem on its home row**: `{ rowId, stemId }`, set by the row's hook toggle or by 👍,
on the stem the row is playing. It lives in a new `RadioHooksState` (`src/shared/radioHooks.ts`),
not in `RadioSlotFlags`: a flag is about the present stem and dies with it, while a hook outlives
its stem's absences.

- **A row holds at most one hook. Several rows may have one**, at most `radioHooksMax(rows) = max(1, floor(rows / 2))` (2 at 4 or 5 rows, 4 at
  8). Hooking beyond the cap releases the oldest hook, preferring one that is in. Releasing an away
  hook cancels its return.
- **States:** `in` (playing on its row), `away` (its row plays a substitute), `resting` (away, and
  its row is silent).
- An away hook's stem counts as used for dedupe (both `usedElsewhere` sets), so no other row picks
  it while it is out.
- While a hook is in, radio's own turnover never changes its row. That row is left out of
  `pickRadioSlotId`'s eligible list and out of companions (`radioHookTurnoverExcluded`), and only
  the hook's own cycle takes the stem out. This replaces the divisor of 8.

### 2.2 Lines and the hook clock

- **The phrase** is the TURNAROUND phrase (`radioCadence.turnaroundPhraseBars`: the web's 16, the
  desktop's `phrase` chip, or 16 when that is 0), counted in laps as turnarounds count it:
  `P = turnaroundPhraseLaps(phraseBars, loopBars)` (`radioTurnaround.ts:72`), with the lap from
  `RadioClock.turnaroundLap`. The pace slider never moves it, so hooks and turnarounds share one
  phrase at every pace.
- **A phrase start** is a wrap where the new `turnaroundLap` is 0.
- **A half line** is a wrap where `P` is even and the new `turnaroundLap` is `P / 2`.
- **Hook lines** are phrase starts and half lines. At the default 16 bars they are every 8 bars:
  every top of an 8-bar loop, and every top of a 16-bar or longer loop.
- **Exits land on hook lines. Returns land only on phrase starts.** Both are loop tops, at every
  pace (even in the bar band), so a hook never enters or leaves mid-loop.
- **The hook clock:** each hook keeps `bars`, the bars played in its current state. It grows by
  `loopBars` at each wrap while radio runs and is not held. `targetBars` is the state's drawn
  length. An event is due at the first line (or, for a return, phrase start) at which `bars`
  reaches `targetBars`.

### 2.3 Lengths, scaled by the pace slider

Drawn from weighted menus, multiplied by the pace scale, rounded to the nearest multiple of 8 bars
(ties up), and clamped to 8-64:

| | menu (bars) | weights |
|---|---|---|
| **stay** (in) | 16, 24, 32 | 0.25, 0.35, 0.40 |
| **away** | 16, 24, 32 | 0.40, 0.35, 0.25 |
| **long rest** (after 3 returns) | 48, 64 | 0.5, 0.5 |

`radioHookPaceScale(level)` interpolates geometrically between knots `[level, scale]`:
`[0, 1.5]`, `[25, 1.25]`, `[50, 1]`, `[70, 0.75]`, `[90, 0.5]`, `[100, 0.5]`.

| pace | scale | stay / away can be | long rest |
|---|---|---|---|
| slow (0) | 1.5 | 24, 40, 48 | 64 |
| mid (25, desktop default) | 1.25 | 24, 32, 40 | 64 |
| fast (50, web default) | 1 | 16, 24, 32 | 48, 64 |
| 70 | 0.75 | 16, 16, 24 | 40, 48 |
| ludicrous (90+) | 0.5 | 8, 16, 16 | 24, 32 |

Because a return waits for a phrase start, a realised absence is rounded up to the phrase. That is
the point: the return lands where the phrase turns.

### 2.4 The cycle, and when things are decided

Every hook event has two moments, both at wraps (`stepRadioHooks`, run once per wrap):

1. **Prepare**, one line before the event: when the next line will be the one where `bars` reaches
   `targetBars`.
   - For an exit, the substitute is armed: radio's ordinary pick for the row's kinds, avoiding the
     hooked stem, warmed as `armRadioPick` warms.
   - For a return, the hooked stem is re-warmed (on the web, re-stretched if the tempo moved).
   - This leaves at least 8 bars, or one lap, for a fetch.
2. **Decide**, at the wrap that starts the lap ending on the event line. This is the same moment
   the phrase turnaround is rolled and fold's lap-ahead step runs, and the hook step runs BEFORE
   both (§10). Once decided, an event is binding: it lands at its line.

A hook whose event cannot be decided (a condition below fails, or the stem is not warm) tries
again at the next line (an exit) or the next phrase start (a return). It never lands between them.

**One away at a time.** No exit is decided while any hook is away, resting, or has a decided exit
or return. When several hooks are due to leave, the one with the most `bars` in goes (ties: row
order). No draw.

### 2.5 The exit: an echo throw, no build

**Conditions:**
- the hook is in and due;
- no other hook is out (§2.4);
- the home row is eligible (`isRadioEligibleSlot`: unlocked, audible, not rerolling);
- radio is not held;
- the substitute is warm, unless the exit rests.

**Rest or substitute.** The exit rests (the row goes silent) only when all of these hold:
- the density arc is thinning, with count above target;
- the row is not the last heard row of drums or of bass (the arc's own `lastOfItsKind` rule, over
  heard rows);
- and one draw `< HOOK_REST_CHANCE` (0.5). The draw is made only when the first two hold.

Otherwise the row takes the substitute, landing as a `cut`. The echo is the gesture.

**The echo throw:**
- On the home row, ending on the exit line's downbeat: `radioHookExitThrow` builds a `ThrowPlan`
  from `drawThrowBeats` and `drawThrowEcho` (`radioThrows.ts:95`, :101), at
  `at = line - beats * 60 / bpm`.
- It ignores `NEVER` for drums: dub echoes drums out, and the delay's 200 Hz high-pass in its
  feedback loop thins the kick. A row whose kinds include `bass` exits dry (§0).
- The throw clock counts it: `noteRadioExitThrow(state, endsAt, tailSec)` sets `busyUntil` and
  zeroes `barsSince`, and draws nothing. So the regular throws keep their rate and never stack on
  an exit.
- A resting exit throws too, and its row's gain drops at the line, after the send has closed. The
  send is post-fader (combos spec §1), so the echo rings on into the silence.

**No build.** An exit adds nothing to the change size (§4). If a phrase-end turnaround is armed on
the same line, the exiting row is passed to the planner as `TurnaroundRow.exiting`:
- no drop, stop or gap silences it before the line, so its throw is heard;
- it is the wash's preferred row when a wash is drawn (a reverb swell on a part going out is dub
  too).

**Draws, in order:** the rest draw (only when eligible), the throw's beats, timing and feedback
(only when it throws), then the absence (§2.6).

### 2.6 The return: on a phrase start, the drop

At the exit's decision, the absence is drawn:
- `long rest` when this hook's `returns` has reached `HOOK_RETURNS_BEFORE_REST` (3), and `returns`
  goes back to 0;
- `away` otherwise.

**Return conditions, at the decide wrap for phrase start W:**
- the hook is away or resting, and `bars` will reach `targetBars` by W;
- the home row is eligible. Radio's own rest silence does not count as "not audible"; a user mute,
  a lock or a solo elsewhere does, and the return waits;
- the hooked stem is warm.

**Busy, calm, and the one wait:**
- **Another change at W** (radio's change predicted or decided there, a companion, a manual change
  queued for W, or an arc step): the hook returns at W. No draw.
- **Otherwise, if it has been calm** (at most `HOOK_CALM_LANDINGS` (1) row landings, of any kind, in
  the last phrase), the hook has not waited yet this absence, and one draw `< HOOK_CALM_WAIT_CHANCE`
  (0.5): it waits one phrase (`targetBars` grows by the phrase, `waited = true`). The draw is made only when calm and not yet waited.
- **Otherwise** it returns at W.

**On return:**
- the state is `in`, `bars` 0, and `targetBars` a stay draw;
- `returns` + 1, `waited` false;
- the change commits as any landing does (turn + 1, `changedAt`).

The size of the build around it is §4's job. A long absence, or a drums or bass hook, makes the
return a large change, which is what makes it the drop.

**Bring back.** Tapping an away hook's dimmed name (or the phone's row) sets `targetBars = bars`
and skips the calm wait. It lands on the next phrase start whose decide wrap has not passed: the
next one, or the one after it when tapped inside the last lap before it.

### 2.7 Taps and other hands on a hooked row

| what | hook in | hook away / resting |
|---|---|---|
| hook toggle | releases it (the stem stays, now ordinary) | releases it: the return is cancelled and the substitute stays; a resting row gets a fresh radio pick, landing as a cut at the next top |
| 👍 | stars or un-stars; already hooked | stars or un-stars the substitute only: a row holds at most one hook, and this one is coming back |
| 👎 (change next) | releases the hook and marks the row `replace-soon` (one flag per slot, as today) | marks the substitute; the hook is untouched |
| manual change (similar, adjacent, random, swap-now, Cmd, phone) | **clears the hook**: the hooked stem is gone, and a hook is about that stem | replaces the substitute; the hook still returns. A manual change decided for the return's own line wins its row, and the return moves to the next phrase start |
| padlock | inert (the padlock already stops radio); exit waits | the return waits until unlocked |
| row removed | hook forgotten (`pruneRadioHooks`) | hook forgotten |
| radio off (desktop) / stop (web) | hooks kept and inert; a fresh stay is drawn when radio starts | away and resting hooks are dropped; the row keeps what it plays |
| hold (web) | the hook clock stops; nothing is decided | same |

Hook events land through each runtime's manual-change landing path (they are loop-top changes with
staging and take-back). They are marked `source: 'hook'`, so they never trigger the "manual change
clears the hook" rule, and never clear `replace-soon` on another row.

## 3. Dig

### 3.1 The anchor

- One dug row at a time. Tapping `dig` on another row moves it; tapping it again turns it off.
- **The dig follows the row.** Its anchor is the stem that row plays now, or the row's hooked stem
  when it has a hook (in or away). When radio changes that row, the anchor moves to the new stem.
- A third of picks come from near the anchor (§3.2), the dug row's own included. So the row tends
  to stay in its jam and walks through it, while the other rows lean after it. This is digging
  through one crate.
- The anchor is
  `RadioDigAnchor { stemId, jamCID, t (seconds, nullable), traits (percentiles, partial), riffCID? }`.
  Web: from the record. Desktop: from the candidate (`riffCreationTime`, `traitPercentiles`,
  `riffCID`).
- It applies to radio's picks, including substitutes and arc adds, and to manual rolls while radio
  is on. With radio off it is kept, inert and hidden, like the row's other radio controls.

### 3.2 The near draw

It is modelled on the faves draw, which is proven (`discoverFaves.ts`, `pick.ts:328`). After the
faves draw, and only when it did NOT go favourites-only:
- one draw `< DIG_NEAR_SHARE` (1/3) makes the pick near-only;
- if no unused candidate fits, it falls back to a normal pick (logged `no near fits`).

The draw is made only while dig is on.

- **Web near pool:** `drawPool(keep)` with
  `keep = r.jam === anchor.jamCID && |r.t - anchor.t| <= DIG_NEAR_SEC` (3 hours). With no unused
  candidate, it widens once to the whole jam. With `t` unknown on either side, it is the whole jam.
  The source dial, dedupe, trait bar and ranking all apply, exactly as for faves.
- **Desktop near pool:** `getAdjacentDiscoverCandidates(anchor.riffCID, kinds, source, creator)`,
  the riff-sequence neighbours, then dedupe, bar and ranking. Its candidates carry paths already.
  No main-process change.

### 3.3 The ranking term

`rankCandidates` gains `dig?: RankDig` (`{ jamCID, t, traits, nearRiffCIDs? }`). Every candidate
gains `DIG_WEIGHT * closeness`:

```
closeness = 0.5 * sameJam + 0.3 * timeNear + 0.2 * traitNear
sameJam   = candidate.jamCID === dig.jamCID ? 1 : 0
timeNear  = 1 when nearRiffCIDs has candidate.riffCID (desktop's adjacency window);
            else exp(-|candidate.riffCreationTime - dig.t| / DIG_TIME_SCALE_SEC) when both known
            (DIG_TIME_SCALE_SEC = 6 h, across jams too: the same week in another jam is near);
            else 0
traitNear = 1 - mean |candidate.p[k] - dig.traits[k]| over trait kinds both know;
            0.5 (neutral) when there is none
```

- **`DIG_WEIGHT = 0.75`:** under one trait (1) and the favourite boost (1.5), over nothing else. A
  lean, not a sort.
- **The near draw does most of the work; the term keeps the other two picks in three leaning.** On
  the desktop the trait part is usually neutral, because candidates carry only their slot's kinds
  (controls §6.5). Its dig is mostly jam and riff adjacency, by design: no new IPC.
- **Absent `dig`:** no term at all, and the ranking is identical.

### 3.4 How it composes

| with | rule |
|---|---|
| faves dial | the faves draw first: favourites-only wins the pool and dig only ranks inside it. Otherwise the near draw, then the boost as today |
| BPM | additive beside it, as every term is; tempo is still stretched |
| trait bar | applies to the near pool too; its `minPool` back-off keeps a small pool alive |
| clash (fold) | additive: the two sum |
| artist mode | the near pool keeps the creator filter (the adjacency call takes `creator`); it never leaves the artist |
| source dial | the near pool is drawn through the same source roll (`drawPool`) |
| dedupe | near candidates on other rows are skipped, as with faves |
| hook | an away hook's stem stays used; a dug row with a hook anchors on the hook |

### 3.5 Left out, with reasons

- **Musical key:** no index has one (§1). It would need key detection: a feature bump and a full
  library rescan (controls §7A.2's reason for skipping `upbeat`).
- **Role:** the pool is already cut by the row's kinds, and dig crosses rows. A drums row cannot
  usefully match a bass stem's role.

## 4. Build-ups sized to the change

### 4.1 The forecast

For a loop top W, each runtime fills a `RadioChangeForecast` from what it knows when the decision
is made. Rows that change or join at W, excluding hook exits (dub, no build) and arc removals:

```
rows          radio's change + its companions + manual changes queued for W + a hook return
              + an arc add
hookReturn    { awayBars } for a hook returning at W, else null
lowEndReturn  a row with drums or bass among its kinds, silent in the lap before W and heard
              after it (a hook return on such a row, a rest ending, an arc add)
arcStep       'add' | 'remove' | null at W
course        a desktop course change at W (every row at once)
```

**Where each part comes from, at the phrase-end roll** (the start of the lap ending at W: the
earliest point, with the least certainty):
- radio's change: decided (`s.led` / the desktop's led change ref) at W, with its companions; or,
  not yet decided, predicted by `radioChangeDueAtNextWrap` with the pick armed, counting the armed
  companions;
- manual: web `s.manual` entries at W; the desktop's manual queue for the next top;
- hooks: decided at this same wrap, just before (§2.4), so exact;
- arc: web `s.adding` / `s.removing` landing at W, or ready to; the desktop's arc refs, the same
  way.

**At a per-change decision** (`decide` on the web, the due branch and early decision on the
desktop) the forecast is rebuilt, and the change itself is now certain.

### 4.2 The tiers

`radioBuildSize(forecast, { hookScale, barsSinceBuild, barsSinceLargeBuild, phraseBars })`:

```
large   lowEndReturn || course || arcStep !== null || rows >= 3
        || (hookReturn && hookReturn.awayBars > 16 * hookScale)
medium  hookReturn (shorter) || rows === 2
small   rows === 1
none    otherwise
```

**The budget** (Huron: a build that comes too often stops meaning anything; Solberg: pacing). A
build is any riser, per-change or turnaround part. A large build is a turnaround rolled at `large`
that fired.
- `large` falls to `medium` when the last large build was less than a phrase ago;
- `medium` or `large` falls to `small` when the last build was less than 8 bars ago -- except a
  phrase end's `large` (`radioPhraseEndBuild`), which only the once-a-phrase rule limits, so a
  cheap mid-phrase riser at a high pace cannot eat the phrase start's big moment.

A turnaround rolled at `large` that fires resets the large count whether or not it has a riser
(`radioNoteTurnaround`); only a riser counts for the 8-bar spacing.

The runtime keeps the two bar counts on its own play clock.

**The arc for the build:** `growing` when the tier comes from a hook return, a low-end return,
three or more rows, an arc add or a course change. `thinning` when it comes only from an arc
removal (a thinning mix softens; it doesn't drop: turnarounds §0). Otherwise the leg's own arc, as
today.

### 4.3 The per-change gestures

`pickTransition(temperament, kinds, random, size?)` and `radioGestureBeats(kind, dropOutBeats,
size?)`:

| tier | riser | other kinds |
|---|---|---|
| small | weight 0 | as today (a hole is a 1-, 2- or 4-beat drop-out: the fill) |
| medium | today's weight, 4 beats | as today |
| large | weight x2, 8 beats (today's riser) | as today |

- The weights renormalise, and there is still exactly one draw. `off` is still `cut`, and
  `subtle`'s tables have no riser at any tier.
- **A hook return's own change** draws from its tier with `filter in` and `bloom` removed: a return
  lands full (turnarounds §0, "release is return"). So it is a cut, a hole on the outgoing
  substitute, a riser, or a duck.
- **Drum roll:** Elling's medium tier names one, but the engines have no retrigger. That is glitch
  phase 2 (handoff open thread 2). Until then medium's build is the short riser or a hole.

### 4.4 Phrase-end turnarounds

`TurnaroundInput.size?: RadioBuildSize` (absent: today, draw for draw):

| tier | chance | riser weight | riser cap | gap | moves layered |
|---|---|---|---|---|---|
| none | the rate | x0.15 | 4 beats | never | at most 2 |
| small | the rate | x0.15 | 4 beats | never | at most 2 |
| medium | the rate | x1 | 8 beats | never | depth's odds |
| large | 1 (unless `off`) | x2 | depth's cap | `TURNAROUND_GAP_CHANCE` | depth's odds |

- **Lengths:** the riser's drawn length is clamped with the same `Math.min` as today (`radioTurnaround.ts:536`), so
  there are no extra draws.
- **Layering:** the "at most 2" cap truncates and renormalises `TURNAROUND_LAYER_ODDS` inside the
  layering's own seeded random (`turnaroundLayerRandom`), so the caller's stream is unchanged.
- **Memory:** `large` rolls fresh: the memory (diminution, never two in a row) is skipped, so a
  riser, stop, wash or dip at the last phrase end cannot leave the biggest moment with nothing or
  with a halved repeat. At `none` and `small` a diminution keeps at most two moves.
- **Chance:** `large` makes the phrase end fire, at every rate but `off`. Large boundaries are at
  least a phrase apart (the budget), so this is about one turnaround per hook cycle.
- **`none` and `small`:** they keep their drops, stops, lifts and washes. A turnaround is the
  phrase-end fill (turnarounds §0) and stays one. Only the riser is made rare, short and gapless.
  So "a riser at a phrase end with no change" draws at roughly a seventh of today's weight, and never the full
  sweep.
- **Turns** (the button and chips) ignore the size: a turn is asked for. They do take the payoff
  rule (§4.7).
- **With the payoff rule (§4.7),** a phrase end that fires always brings at least a `medium`
  change, so it is rolled at `medium` or above; `none` and `small` remain for a roll the budget
  downgrades.
- **Small or locked beds get no phrase-end fills.** With nothing landing at the wrap and at most
  one spare row (a bed of one or two rows, or every other row locked, hooked in or under a manual
  change), no `medium` payoff can be assembled, so the phrase end is skipped and draws nothing
  (Decision 6: no payoff, no turnaround). Turns still play there, as fills with no gap.
- **Turnarounds `off`:** a large change gets only its per-change gesture (at most an 8-beat riser,
  no gap). The gap is a turnaround's, so it needs turnarounds on. Both radios default to on.

### 4.5 Big moments on phrase starts

- Hook returns already land on phrase starts (§2.2).
- **Arc steps** (web `densityTick`, desktop's arc) now also wait for a phrase start, at most one
  phrase past being ready. Legs are 96-192 bars, so the wait is invisible to the arc. This makes
  every `large` event meet the phrase-end turnaround, and the build lands where the drop is.
- Three or more rows mid-phrase (pace 70 and up, companions) get the per-change palette at
  `large`: an 8-beat riser, no gap, and the budget still applies.

### 4.6 What can go wrong, and the direction it fails

The roll reads a forecast a lap ahead. When it oversells (a predicted change not warm in time, a
return cancelled by a tap after it was decided), a build plays without its payoff. That is the
failure Elling heard, now rarer, never larger than today, and logged (`[radio-build] oversold`).
When it undersells (a manual change queued after the roll), the change lands with less build than
it earned, which is the gentler failure. Hook events are decided before the roll and are binding,
so the biggest builds are the reliable ones.

### 4.7 Every turnaround is paid off (Decision 6)

**The payoff a turnaround needs:** `large` when it leaves a gap (the silence before the one is the
biggest promise radio makes); `medium` for any other move. A turn's too.

**What pays off** (`radioPayoffMet`, rows counting every row that changes or joins at the wrap):

| need | met by |
|---|---|
| `medium` | 2 or more rows, a hook back, a density-arc step, the low end back, a course change |
| `large` | 3 or more rows, a hook back with another row, the low end back (drums or bass returning), a course change |

**At the phrase end's roll** (sized builds on; the start of the lap ending at W):

1. `f` = the forecast of what already lands at W (§4.1).
2. `spare` = the rows the runtime could add at W, each warm and eligible:
   - radio's armed pick, when it is not already landing at W (pulled forward: decided now, early);
   - its companions;
   - **spare picks** (at most 2), armed and warmed at the phrase start before, for rows radio may
     change (not a hooked-in row, not a row with a manual change, not the pending pick's).
3. `radioPhraseEndBuild(f, spare, budget)`:
   - **skip** when `f` plus every spare row cannot meet `medium`: no turnaround at this phrase end,
     no draw, memory null (logged `[radio-build] no payoff`);
   - **size** = `f`'s tier raised to `medium`, then the budget (§4.2);
   - **payoff** = the largest payoff `f` plus the spares can meet. `rollTurnaround` draws a gap
     only when it is `large` (`TurnaroundInput.payoff`).
4. The rate draws as today; at `large` the phrase end always fires (§4.4).
5. **When it fires,** the runtime assembles the payoff the plan needs
   (`radioTurnaroundPayoffNeed(plan)`), adding `radioPayoffShortfall(f, need)` rows in order: radio's
   armed pick (pulled forward as an early decision), its companions, then spares (riding radio's
   change as companions: cuts, landing or taken back with it). With no armed pick ready, the first
   spare is radio's change.

**Pace.** A pulled-forward pick IS radio's change: an early decision, so the interval restarts when
it lands. A payoff never adds a change on top of radio's own. Below the pace slider's bar band, a
phrase end offers radio's pick and the spares only when radio's next change is due within about a
phrase of the wrap (`radioPayoffInReach`: the interval still to run is at most the bars to the wrap
plus one turnaround phrase); otherwise only what already lands at the wrap counts, and with nothing
there the phrase end takes the skip path (no turnaround, no draw). So at a slow pace a payoff brings
radio's next change forward by at most a phrase, and adds rows to it; it never makes a change radio
was not about to make. In the bar band (changes every few bars) the offer is unchanged. A turn
(asked for) is offered everything, at any pace.

**Fold.** Payoff rows are companions: the fold's carry and release rules for companions apply
(fold-follows-pace).

**The turn button.** A turn brings a payoff too, assembled the same way. A turn with nothing to
change still plays (it was asked for), as a fill: no gap (`payoff: 'none'`). (Planning decision;
Elling can ask for `nothing to turn` instead.)

**Readout.** The payoff is radio's change with companions, so `next` already names it:
`next: row 2 +2 → cut · 4 bars`.

**Byte-identity.** With `sizedBuilds` absent, none of this runs: no spares are armed, no pick is
pulled forward, `rollTurnaround` gets no `payoff`.

**Failure direction.** A spare or the pulled pick can become ineligible after the roll (a mute, a
lock): the payoff is then smaller than promised (logged `[radio-build] oversold`), never larger.

## 5. Interactions

- **Fold:**
  - `RadioFoldRow.hooked` means "a hook is IN on this row", so a hook in never folds. A substitute
    is ordinary and may fold.
  - A return is decided at the wrap whose fold step decides the landing lap, and the hook step runs
    first. So that step already sees the row as `hooked` with the hook's `stemId`, and lets the
    row go (fold-follows-pace's anticipated top landing). The return plays straight from its
    first beat and never carries a fold.
  - An exit off a hooked row leaves a straight row.
  - The anchor (`radioFoldAnchor`) is recomputed each step, so a resting drums row simply stops
    being the anchor.
- **Pace:** the scale (§2.3); every event on lines and phrase starts at every level; the bar band
  never moves a hook. At ludicrous a hook cycles about every 16-32 bars.
- **Companions:** a hooked-in row is never a companion. A return may land with radio's change and
  its companions; they all count toward `rows`.
- **Turnarounds:** `TurnaroundRow.hooked` is "hook in". `exiting` is new (§2.5). `size` is new
  (§4.4).
- **The turn button:** unchanged. A turn on a return's phrase start plays its move, and the return
  lands with it.
- **Throws:**
  - the exit throw reuses the aimed-throw shape and draws, and counts on the throw clock (§2.5);
  - regular throws may land on a hooked-in row as on any row (not drums or bass);
  - an aimed throw before a return's phrase start is aimed as today (`turnaroundThrowAim` when a
    turnaround is armed).
- **Density arc:**
  - the arc never removes a row whose hook is in (as today), nor the home row of an away or
    resting hook (it is reserved for the return);
  - **"a hook away isn't a row":** the arc counts rows on the bed (the substitute counts once) and
    never the away hook. A resting row counts as not heard;
  - `lastOfItsKind` reads heard rows, so a resting drums hook protects the remaining drums row;
  - `ArcRow.held` becomes `reserved` (in, away or resting).
- **Held and stopped:** §2.7. On the web, hold freezes the hook clock and decisions, as it freezes
  `barsElapsed`.
- **Swap-now and manual changes:** §2.7. A manual change on a hooked-in row clears the hook; on an
  away row it replaces the substitute.
- **The phone remote:**
  - `RemoteSlotAction` gains `'hook'` and `'dig'` (toggles), and `'back'` (bring an away hook
    back);
  - each remote row gains `role: { hook: 'in' | 'away' | 'resting' | null; dig: boolean }` and
    `hookBarsAway: number | null`;
  - the phone shows the same row words as the desktop (§6).

## 6. Readout and copy

Lowercase, no emoji. Row words come from shared functions, so both radios and the phone say the
same thing.

| where | words |
|---|---|
| row, hook in | `hook` |
| row, exit decided | `hook · out next` |
| row, away or resting | `hook · back in 16 bars` (to the planned phrase start, updating after a calm wait); `hook · back next` once decided |
| row, dug | `dig`; with a hook, `hook · dig` (away: `hook · back in 16 bars · dig` wraps, or drops `· dig` where it won't fit) |
| row, the away hook's name | the hooked stem's label, dimmed, beside what is playing; tap: bring back |
| flashes | `hook out`, `hook back`, `dig` (on set) |
| status line `next` | `next: row 2 → hook back · 4 bars`, `next: row 2 → hook out · 4 bars` |
| tooltips | hook: `hook: it leaves and comes back` / `release hook`; dig: `dig: lean toward this` / `stop digging`; the dimmed name: `bring it back` |

- **Phone width (320 px):** a row's role text is at most 22 characters (`hook · back in 64 bars`).
  Below 360 px it shortens to `back in 16`. The status line's `next` part is the same width as an
  arc step's today.
- **Buttons:**
  - desktop: two new 18 px tracks APPENDED after 👎 (16 hook, 17 dig), so no `gridColumn`
    renumbers (the grid comment at `DiscoverPanel.tsx:11310` explains why);
  - web full mode: two icon buttons after dislike (`full.ts` `RowAction` gains `hook`, `dig`);
  - icons: Phosphor `Repeat` (it keeps coming back) and `Shovel`;
  - monochrome, with the padlock's inverted fill when on, shown only while radio runs (controls
    §6.4's rules);
  - simple mode on the web has no rows, so no roles: 👍 there stays as it is.

## 7. Randomness, determinism, byte-identity

- **The guarantee** is the one the combos spec gave for `combine`: with **no hook and no dig set,
  and `sizedBuilds` absent**, every shared function draws exactly what it drew before and returns
  the same. The web's seeded step traces are then byte-identical, and the fold fingerprint
  `0540eeea` holds.
- **No roles means no draws.** `stepRadioHooks` with no hooks returns its input and draws nothing.
  The near draw happens only while dig is on.
- **`sizedBuilds`** is a new optional `RadioSettings` field. Absent, `pickTransition`,
  `radioGestureBeats`, `rollTurnaround` and the arc's timing are exactly today's. Every tier only
  reweights or clamps; none adds a draw.
  - **It is on by default in both radios** (desktop `normalizeRadioSettings`, web
    `WEB_RADIO_DEFAULTS`). So the sound changes for everyone, roles or not; that is Decision 5. The
    old traces are pinned with it absent.
- **Hook draws, in order, per wrap, in row order:**
  - an exit: the rest draw (if eligible), the throw's three (if it throws), the absence;
  - a return: the calm wait (if calm and not yet waited), then, when it returns, the stay;
  - a set (toggle or 👍): the stay.

  All from the runtime's one stream (`c.rnd` on the web).
- **Dig's draw** is one per pick, after the faves draw.
- **The payoff (§4.7)** draws only through what it uses: arming spares draws their rows
  (`pickRadioSlotIds`) and picks, at the phrase start, and only with sizedBuilds on; pulling radio's
  pick forward draws its gesture as an early decision does.

## 8. Migration of today's hook

- **`RadioSlotFlag` becomes `'replace-soon'` only.**
  - removed: `HOOK_HOLD_FACTOR`, `toggleRadioHook`, `radioHookSlotId`, and the `hook` branch of
    `radioSlotFlagWeightFactor`;
  - `likeRadioSlot` keeps its star rule but its hold moves to `likeRadioStem(hooks, rowId, stemId,
    opts)` in `radioHooks.ts`, which hooks (cap rule) and never un-hooks;
  - `pickRadioSlotId` keeps its signature; the hooked-in rows are already out of `eligible`.
- **Every reader in §1 switches to `radioHookInRow(hooks, rowId)`** (fold, turnarounds, the stop
  keeper) or `radioHookReservesRow` (both arcs). These are one-line changes at the cited lines.
- **Web:**
  - the `hook` event toggles the hook on the row's playing stem;
  - new events: `dig` (row), `hookBack` (row);
  - `likes.ts:39` reads the hooks state.
- **Nothing to migrate on disk.** Hooks were never persisted, and neither are these.
- **Tests that pinned the old hook** (the 4.0 / 9.7 turns measurements in `radioSlotFlags.ts`'s
  comments, `radioSlotFlags.test.ts`, and web traces with a hook set) change deliberately. The
  replace-soon table stays as measured.

## 9. Architecture

### Shared (`sssketch/src/shared/`, TDD)

- **`radioHooks.ts` (new):**
  - types `RadioHook`, `RadioHooksState`, `RadioHookEvent`;
  - constants `HOOK_STAY`, `HOOK_AWAY`, `HOOK_LONG_REST`, `HOOK_RETURNS_BEFORE_REST`,
    `HOOK_REST_CHANCE`, `HOOK_CALM_LANDINGS`, `HOOK_CALM_WAIT_CHANCE`, `HOOK_PACE_SCALE_KNOTS`;
  - functions `radioHooksMax`, `radioHookPaceScale`, `drawRadioHookBars`, `radioHookLine`,
    `toggleRadioHookStem`, `likeRadioStem`, `bringRadioHookBack`, `forgetRadioHookOnManualChange`,
    `pruneRadioHooks`, `radioHookInRow`, `radioHookReservesRow`, `radioHookTurnoverExcluded`,
    `stepRadioHooks`;
  - row words: `radioHookRowWords`.
  - `stepRadioHooks(state, input)` takes:
    - the wrap's lap info: `loopBars`, the new `turnaroundLap`, `P`;
    - `paceLevel` and `held`;
    - the rows: id, stemId, kinds, eligible, heard, last-of-low-kind;
    - warm checks;
    - `changeAtNextWrap`, `calmLandings`, `arcThinning`;
    - `bpm`, `nextWrapAt` and `random`.

    It returns the next state plus `prepare` (rows to arm or warm) and `decided` events (exit:
    rest, throw plan; return), which the runtime lands.
- **`radioDig.ts` (new):** `RadioDigAnchor`, `toggleRadioDig`, `radioDigAnchorOf`,
  `digNearDraw`, `isNearForDig`, `DIG_NEAR_SHARE`, `DIG_NEAR_SEC`, `DIG_TIME_SCALE_SEC`,
  `DIG_WEIGHT`, `radioDigCloseness`.
- **`radioBuildSize.ts` (new):** `RadioChangeForecast`, `RadioBuildSize`, `radioBuildSize`,
  `radioBuildArc`, the tier tables of §4.3-4.4, and `BUILD_SPACING_BARS` (8).
- **Changed:**
  - `radioSlotFlags.ts` (§8);
  - `radioSchedule.ts` (`RadioSettings.sizedBuilds?`, normalise);
  - `radioTransition.ts` (`pickTransition` size);
  - `radioManualChanges.ts` (`radioGestureBeats` size; `drawManualTransitions` passes it);
  - `radioTurnaround.ts` (`size`, `TurnaroundRow.exiting`);
  - `radioThrows.ts` (`radioHookExitThrow`, `noteRadioExitThrow`);
  - `discoverRanking.ts` (`dig`);
  - `radioDensity.ts` (`ArcRow.reserved`, `heard`; arc steps wait for a phrase start under
    `sizedBuilds`);
  - `radioReadout.ts` (row role input, `hook out` / `hook back` as next kinds, flash words);
  - `radioNextLanding.ts` (hook events land);
  - `remoteState.ts` (§5).
- Every shared change keeps `ell.ing/radio`'s `npm run typecheck` green (`noUnusedLocals`).

### ell.ing/radio

- **`step.ts`:**
  - `RadioState.hooks`, `.dig`, `.landingsByLap` (the last P laps), `.lastBuildBar`,
    `.lastLargeBuildBar`;
  - `hooksAtWrap` between `densityAtWrap` and `foldAtWrap` (:866-875);
  - hook events land as manual-path changes marked `hook`;
  - the forecast for `rollTurnaroundAt` (:1190) and `decide` (:944, :974);
  - the exit throw goes out as a `throw` action;
  - `removalVictim` (:1653) reads `radioHookReservesRow`.
- **`pick.ts`:** the near draw and the `dig` ranking option in `pickStem`.
- `controller.ts` (the new events), `ui/full.ts` + `fullModel.ts` (buttons, row words, the dimmed
  name), `ui/icons.ts`, `likes.ts`, `settings.ts` (`sizedBuilds: true`).

### sssketch desktop

- **`DiscoverPanel.tsx`:**
  - `radioHooksRef` / state, `radioDigRef`, landing counts, build bars;
  - the wrap step beside `radioFoldAtWrap`, run before it;
  - hook events through the manual queue (`mergeStageChanges`);
  - the forecast at the turnaround roll (:3500-3660) and the per-change draws (:4633, :4862,
    :5772);
  - `pickForSlot`'s near draw and `dig` option;
  - row tracks 16-17;
  - the readers in §1.
- `remoteServer.ts` / `remotePage.ts`: the actions and the row role.

## 10. Timing risks

1. **Order at the wrap.** It must be: lap bookkeeping, density, **hooks**, fold step, turn, then
   turnaround roll and the early decision.
   - Hooks before fold, so the fold step sees a decided return as hooked (§5).
   - Hooks before the roll, so the forecast is exact for hook events.
   - A test pins the order in the web trace, and the desktop mirrors it beside `radioFoldAtWrap`.
2. **The return's stem not ready at W** (a slow fetch, a tempo change, a flaky network on the
   web). The return was decided, so the build is armed.
   - The stem lands at the first wrap after it is ready, as every web change does (it never lands
     mid-lap).
   - The forecast oversold, which is logged. The prepare stage, a line ahead, makes this rare.
3. **Desktop pause and resume.** The hook clock counts wraps the lap clock sees, and a resume does
   not double-count: the same rule as fold's origins.
4. **A substitute landing late.** It lands, and the hook's away clock counts from the exit line,
   not from the landing.
5. **Loop length changing while a hook is away.** The lines are recomputed each wrap from the new
   `P` and `turnaroundLap`. A target in bars, not laps, keeps its length.
6. **Same-tick taps** (bring back, then release, in one tick) are applied in event order through
   the reducer on the web, and the panel's state setter order on the desktop. Release wins over a
   bring back made before it.
7. **The exit throw and an armed turnaround gap.** The throw must close before any fader drop on
   its row. `exiting` keeps the planner off that row, and a test checks
   `turnaroundSilencedRowIds(plan)` never includes it.
8. **The payoff, decided a lap ahead.** Spares are warmed a phrase ahead (from the phrase start),
   so the roll counts only warm rows. A row muted or locked between the roll and the wrap leaves
   the payoff short: logged as oversold, the turnaround plays (it is already on the engine).

## 11. Testing

- **Shared (TDD, sssketch vitest):**
  - **`radioHooks.test.ts` (new):**
    - lines at loops of 1, 2, 3, 4, 5, 6, 8, 16 and 32 bars;
    - the pace scale at the knots, and rounding and clamps at every anchor;
    - the menus' frequencies (seeded, 10k);
    - one away at a time with three hooks; the cap and oldest-first release;
    - an exit only on a line, a return only on a phrase start;
    - prepare one line ahead, decide one lap ahead, binding once decided;
    - rest only when thinning and not the last low row, and its draw only then;
    - bass exits dry;
    - the calm wait: only when calm, at most once, no draw when busy;
    - the long rest after 3 returns, then the count resets;
    - bring back: the next phrase start, or the one after inside the last lap;
    - every row of §2.7's table;
    - no draws and an unchanged state with no hooks;
    - the draw order of §7.
  - **`radioDig.test.ts` (new):**
    - closeness parts and the neutral trait;
    - `nearRiffCIDs` overrides time;
    - the near draw's rate and fallback, and that it draws only while on;
    - composition order with `favesDraw`.
  - **`discoverRanking.test.ts`:** absent `dig` gives an identical ranking over seeded pools; the
    term's bounds (0 to 0.75).
  - **`radioBuildSize.test.ts` (new):**
    - every tier from forecasts, and the awayBars threshold by pace;
    - the budget downgrades;
    - the build arc.
  - **Transitions and turnarounds:**
    - `pickTransition` and `radioGestureBeats` with no size give identical draws over 10k seeds;
    - small never gives a riser; medium's riser is 4 beats; one draw at every tier;
    - a return's draw is never `filter in` or `bloom`;
    - `rollTurnaround` with no size is draw for draw today;
    - none and small: the riser about 0.15 times as often, at most 4 beats, never gapped, at most
      2 moves;
    - large fires at `rare` and `often` but not `off`, and gaps about 3 in 4;
    - `exiting` is never silenced.
  - **`radioThrows.test.ts`:**
    - the exit throw ends on the line;
    - `noteRadioExitThrow` holds off the next regular throw and draws nothing.
  - **Readout:** every row word at 22 characters or less; the short forms; `next` with hook kinds.
- **Web (vitest):**
  - **`step.test.ts`:**
    - with no roles and `sizedBuilds` absent, the existing seeded traces are byte-identical;
    - a hook's full cycle in a seeded trace: set, exit with a `throw` action on the line, away,
      return on a phrase start, the turnaround at that wrap rolled at `large`;
    - the wrap order;
    - the arc never removes a reserved row;
    - hold freezes the hook clock;
    - a return whose stem is late.
  - **`pick.test.ts`:** the near pool `keep`, the widening, and the faves composition.
  - Offline renders with headless Chrome (`spike/engine-check`): the exit echo rings over the line,
    and a return under a riser and gap.
- **Desktop:** typecheck, lint and the shared tests. The panel glue has no tests, by convention.
- **No agent can hear either radio, see the UI or hold a phone.** Elling's walkthrough:
  1. Hook a drums row at fast. It stays 16-32 bars, then leaves on a line with an echo; another
     drums part plays.
  2. 16-32 bars later it comes back on a phrase start, with a riser and a gap: it lands as the drop.
  3. Two hooks: only one is ever out.
  4. At slow, the cycles are long. At ludicrous, quick.
  5. Calm (slow pace): a return sometimes comes a phrase late. Busy: on time.
  6. Tap the dimmed name: back at the next phrase start.
  7. Dig a row. Over a few minutes, more of the picks come from that jam, and the dug row wanders
     through it.
  8. Plain radio, no roles: one-row swaps never get the full sweep, and risers mostly come with
     bigger moments.
  8a. Every turnaround is followed by a real change on its one: two rows or more, three or more
     after a gap. With every row padlocked, phrase ends play nothing.
  9. The phone: hook, dig and bring back work, and the words fit at 320 px.

## Decided (Elling, 2026-10-03, approving this spec)

1. **A manual change on a hooked row clears the hook** (the hook is about that stem). Not chosen:
   the new stem becomes the hook.
2. **Dig follows the row,** re-anchoring when that row changes, so it wanders through the jam. Not
   chosen: pinned to the stem tapped.
3. **Sized builds are on for everyone,** roles or not (plain radio changes too): fewer risers, the
   big ones where a lot changes, and every turnaround paid off (§4.7). Still to tune by ear: the
   0.15 riser factor, the x2 at large, large always firing a turnaround, the payoff sizes.
4. **The hook cap:** half the rows, oldest released first (one that is in before one that is away).
5. **A bass hook leaves dry; drums leave with an echo.**

## Out of scope

- A deliberate breakdown (drums and bass out together), and the breakdown → build → drop section
  (handoff open thread 4).
- Drum rolls as a build: they need a retrigger in both engines (glitch phase 2).
- Curated or persistent roles, and hearts as groups.
- Musical key in dig (§3.5).
- Auto-arrange's use of hooks or build sizing.
- Steering radio's own change onto a hook's return line. The return prefers lines where changes
  already land, and pulls nothing.
