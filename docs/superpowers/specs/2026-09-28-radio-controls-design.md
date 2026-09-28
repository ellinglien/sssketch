# Radio controls — transitions, drop-outs, and making the pace mean what it says

Date: 2026-09-28
Status: drafted against the real code, two days after radio mode shipped and Elling actually
used it; awaiting his walkthrough

## What happened

Radio mode shipped 2026-09-26 (`docs/superpowers/specs/2026-09-26-radio-mode-design.md`,
commits `a0c70c6`…`2695cc5`). He used it. In order, verbatim:

> "radio mode seems quite slow to me"

then, after seeing why:

> "it's really interesting as it is honestly!"

> "maybe have a way to select 'keep this one for a while' or .. 'this is the hook' or something"

> "sure .. or long fade transitions even? more parameters .. maybe even a menu"

> "right now the top stem has been playing for the full length, about 5 minutes, no change..
> this is good for consistency but i'd love to have some control" … "ah! it changed"

> "as it's running, like.. 'more like this' ... 'less like this'"

and then, still listening, the sentence that reorders this whole document:

> "honestly, this is actually pretty cool right now.. listening back. **maybe transitions would
> be the coolest new idea to focus on building**"

> "yep, holes = good. drop out the drums for a few beats or something"

> "also make sure to transition on the proper beat... that's key"

> "not just the downbeat, the proper start of the loop, i think"

So: it works, he likes it, it is too slow, a layer can sit untouched for five minutes by bad
luck, and **the thing he wants next is for the changes to sound like moves rather than swaps** —
landing on the top of the loop, or not at all.

---

## 0. The feasibility verdict, up front

This is the fact everything downstream depends on, so it goes first rather than in an appendix.
It was established by reading the code, not by inference.

> ### The Discover preview is not a special serialization path. Toolkit automation and risers already reach it. **No `native-engine/` change is needed for any transition in this document.**

`syncPreviewToEngine` (`DiscoverPanel.tsx:763-950`) does not have its own project builder. It
assembles a throwaway **full `AppState`** from `initialState` with `bpm`, `masterChain` and
`channelPlugins` copied and `rifffs` replaced by the one preview rifff (`:887-895`), and then
calls **the same `buildEngineProject`** the real arrangement uses.

And `buildEngineProject` reads exactly two fields that the preview currently leaves empty:

```ts
state.stemAutomation?.[key]        // buildEngineProject.ts:519
buildEngineRisers(state.risers ?? {})   // buildEngineProject.ts:616
```

`initialState` supplies `{}` for both (`store.ts:569,571`). **They are empty because nobody has
ever populated them in the preview, not because they are unreachable.** Writing them in
`previewState` is a one-line change on each, and the whole built-in sound toolkit arrives in the
Discover preview with it.

What that unlocks, all with zero native work:

- **Per-clip `volume`, `filterCutoff` and `reverbSend` automation lanes**, bar-keyed
  (`AutomationPoint = { bar, value }`), clip-relative to `originBar`, evaluated per block and
  smoothed per sample through a ~15 ms `ParamSmoother` (`AutomationCurve.h`,
  `PlaybackEngine::applyStemToolkit`). Shipped 2026-09-22, tested, and it exports correctly.
- **Noise risers.** And a correction worth making loudly, because it changes a cost estimate:
  **risers are generated live in the engine**, per sample, by `NoiseRiser.cpp`, straight into the
  channel's bus (`PlaybackEngine.cpp:624-634`). They are rendered audio only on *export*. A riser
  in the preview is a `RiserClip` in `previewState.risers` and nothing else — no file, no render,
  no cache.
- **A live per-stem gain with no project reload at all.** `scheduleLiveParamSync('volume', …)`
  (`DiscoverPanel.tsx:1127-1134`, `liveParamSync.ts`, rAF-coalesced) already drives
  `LiveParamOverrides` through the shipped `set-live-param` IPC handler
  (`IpcServer.cpp:320-346`). Discover's gain drag uses it today. **This is how a drop-out and a
  hole are done, and they cost one IPC message each.**
- **A `load-project` preserves the transport position.** Structurally — `IpcServer.cpp`'s handler
  never calls `transport.setPosition`. A slot change is already a cut, not a restart.

### The three real constraints

1. **A curve repeats every lap.** `originBar` is 0 for the preview clip and the transport wraps
   at `loopLengthBars`, so automation drawn at bars 6–8 of an 8-bar loop fires again on every
   lap. **Every transition is therefore a two-step cycle: one `load-project` to arm it, one to
   clear it.** Because `isStemToolkitNeutral` drops the entire `toolkit` key when nothing is
   drawn (`buildEngineProject.ts:567`), the cleared project is bit-identical to what would have
   been sent without this feature at all. That is the safety property the whole design rests on.
2. **Two stems at once is the expensive case, and only some transitions need it.** A crossfade or
   a filter-out→filter-in needs the outgoing stem still in the project while the incoming one
   plays, which collides with three renderer-side 1:1 assumptions (§5.4). **The hole, the
   drop-out, the duck, the filter-in, the bloom and the riser need none of them** — they act on
   stems that are already there. That boundary, not the engine, is what decides what ships first.
3. **A `volume` curve makes `EngineStem.volume` inert** (`PlaybackEngine.cpp:325-329`,
   `volumeAutomated`), so a stem carrying one stops responding to `updateSlotGain`'s live-param
   path. The gain is already folded through `scaleCurveByGain`
   (`buildEngineProject.ts:251-256`), and the arm/clear cycle removes the curve when the
   transition ends, so this is contained — but it must not be discovered late.

**What is genuinely not available today:** a pre-rendered one-shot (a reverse tail, a tape stop,
a stutter) needs a clip in the preview rifff that is not a library stem, which is the same 1:1
blocker plus a file and a cache. Designed and costed in §5.5, deferred.

---

## 0A. "On the proper beat" — the requirement that decides the architecture

> "also make sure to transition on the proper beat... that's key"
> "not just the downbeat, the proper start of the loop, i think"

This is the hard requirement of the whole document and everything below is designed backwards
from it. **It disqualifies the obvious implementation**, so it goes before the design rather than
inside it.

### 0A.1 A gesture fired from the React tick is audibly wrong, every time

Radio's clock is a `useEffect` keyed on `pos`, and `pos` arrives at **30 Hz** — `IpcServer.cpp`
starts a 33 ms timer on `"play"`. The 2026-09-26 spec already recorded the consequence honestly
(§2.3): a commit is *"tens of milliseconds late"* — a React render, an rAF, `buildEngineProject`,
then an `engineLoadProject` round trip.

For a **stem change** that is forgivable: a new texture arriving 40 ms late still reads as
arriving. For a **rhythmic gesture it is not.** A drop-out that returns 40 ms after the loop
restarts does not sound like arrangement, it sounds like a dropout in the bad sense, and the
entire value of the feature is that the drums come back exactly on the one.

**No amount of tuning fixes this.** The jitter is the transport of the message, not the accuracy
of the decision. So the architecture has to put the gesture **on the audio timeline in advance**
and let the engine perform it, rather than sending a message at the moment.

### 0A.2 Three candidate mechanisms. Only one is real today.

| # | mechanism | real today? |
|---|---|---|
| 1 | **Express the gesture as automation in the project the engine already plays** | **YES** |
| 2 | A scheduled-event API on the engine ("mute slot N at bar X") | **No — would be native-engine work** |
| 3 | Pre-render the gesture into a one-shot audio file | Partly — see §5.5 |

**(2) does not exist.** `IpcServer.cpp` dispatches twenty-eight message types — `load-project`,
`play`, `pause`, `stop`, `set-position`, `set-loop-region`, `set-live-param`, the device and
plugin and recording families, `render-export`, `bake-stem`, `quit` — and **every single one is
immediate.** Nothing in the IPC surface takes a bar number or a time. Adding one would be a new
message type, a scheduling queue on the audio thread, and a wire-format change across the
hand-synced `EngineProject` / `buildEngineProject.ts` pair — plus a rebuild-and-relaunch loop with
no automated test for the thing being changed. **Not needed, and therefore not done.**

**(1) is real, and it is why §0's finding is load-bearing rather than a nicety.** Toolkit
automation reaches the preview project. That makes a gesture part of the *material* rather than a
*message*: the engine already holds the curve when the moment comes, so the 30 Hz tick is nowhere
in the path.

**This also forces a correction to an earlier draft of this document.** A drop-out driven by
`scheduleLiveParamSync('volume', …)` — an rAF-coalesced IPC message fired from the position tick —
is exactly the disqualified implementation. It is cheap, it works, and it would sound wrong.
**§4 uses a volume automation curve instead.** The live-param path stays what it is: the right
tool for a gain drag, where the human hand is already the jitter.

### 0A.3 The timing budget, in real numbers

With mechanism (1), a gesture's edge is resolved by the engine, not by the renderer:

- **`applyStemToolkit` evaluates the curve once per block**, at the block's own end bar
  (`PlaybackEngine.cpp:719`). At 48 kHz that is **5.3 ms at a 256-sample buffer, 10.7 ms at 512** —
  the buffer size is user-settable (`get-buffer-size`/`set-buffer-size`), so quote the range, not a
  number.
- **The value then drives a one-pole `ParamSmoother`**, `kAutomationSmoothingSec = 0.015`
  (`AutomationCurve.h:166`) — a 15 ms ramp.

Against the honest thresholds — under ~5 ms inaudible, ~20 ms noticeable on drums, 40 ms broken —
that lands inside the acceptable band, and it does so **deterministically**: there is no 30 Hz
jitter anywhere in it, because arming happens a whole lap early and only the performance is
timed.

One thing to state precisely, because it is the difference between "tight" and "not ready":
**the 15 ms smoother is a ramp, not a delay.** A returning drum layer's onset is sample-aligned
to the loop top; its first 15 ms is amplitude-ramped up. The transient is not pushed late, it
fades in over a window shorter than every anti-click fade this app already ships (`FadeGain`'s
~3 ms, the phone's 15 ms `MUTE_RAMP`, `LoopBoundaryFade`). That is a *good* property, not a
tolerated one — a hard gain step on a sounding source pops.

**The rule this sets for the plan: if a gesture cannot be expressed as a curve the engine already
holds, it does not ship.** Loose is not an option; not-yet is.

### 0A.4 The anchor is the top of the loop, and the mechanism agrees

> "not just the downbeat, the proper start of the loop, i think"

An 8-bar loop has eight downbeats and one place where the phrase restarts. That one is what the
ear counts to, and in this app it is not an arbitrary index: the **re-one** tool exists precisely
so a stem's audio is rotated to start at the true beginning of the looped phrase. Position 0 of a
Discover preview loop is a downbeat Elling has curated by hand.

So **every gesture is anchored to the loop top** — the wrap — and never to an arbitrary bar line.

The mechanism does not merely permit this, it insists on it. A toolkit curve is **clip-relative**
(`originBar`, which for a preview clip at `startBar: 0` is 0) and the transport wraps at
`loopLengthBars`, so **a curve repeats every lap and can only be anchored to the loop top.** The
thing that looked like the awkward constraint in §0.1 is the thing that makes the musical
requirement free.

Two consequences, both explicit:

- **The reference is the loop's wrap, not any individual stem's.** `loopBars` is
  `maxBarLength` — `Math.max(...resolvedBarLengths)` — which is exactly the `loopLengthBars` the
  engine was given. A 2-bar hat under an 8-bar pad has four wraps of its own per lap; **none of
  them is the anchor.** The lap is.
- **Durations count backwards from the return, never forwards from the trigger.** A two-beat
  drop-out *ends* at the loop top, so it begins two beats before it. This is stated as a rule
  rather than an implementation note because getting it the other way round is the single most
  likely way to build this and have it sound broken.

### 0A.5 The change interval and the gesture anchor are different things, and they do not conflict

This is the tension the slowness fix appears to create, and it resolves cleanly:

> **§1's grid is about when the *change interval* may land. The loop top is where *gestures* land.
> A stem may change at bar 4 of 8; a drop-out still ends at bar 1.**

The 2026-09-26 quantisation was the right anchor for a gesture and the wrong one for an interval,
and it was only ever used for the interval. §1 frees the interval onto a finer grid and leaves the
wrap alone. **Do not let the bar-grid work loosen the gesture anchor** — and note the happy side
effect: because changes now usually land somewhere other than the wrap, a change and a gesture
rarely collide at all.

### 0A.6 How often is a wrap an event?

Every lap is too often for a gesture — a move that happens every eight bars is a rhythm, not a
move. And there is no second clock: radio rolls **once per interval**, exactly where it already
rolls the next pick, and if the roll succeeds the gesture is placed at the next wrap that is not
the wrap the change itself lands on.

At `mid` (6–12 bars) with an 8-bar loop there is typically one or two wraps per interval, so "one
roll per interval" is already close to "at most one gesture per lap" without any extra machinery.

---

## 1. Why it is slow, and the one-line fix

This still lands **first and alone**, ahead of everything else in this document, because it is
the thing he actually complained about and because it will make every transition in §5 sound
better before a line of transition code is written.

### 1.1 The pace numbers were never wrong. The quantisation was.

`advanceRadioClock` (`src/shared/radioSchedule.ts:95`) gates the commit on:

```ts
due: wrapped && barsElapsed >= clock.intervalBars
```

`wrapped` is the **whole preview loop** restarting — `pos` decreasing between two position
ticks, against `loopBars = Math.max(...resolvedBarLengthsRef.current.values())`, the longest
resolved slot in the mix. So a drawn interval is not the interval. The effective interval is:

```
ceil(drawn / loopBars) * loopBars
```

At 120 bpm in 4/4 a bar is two seconds. With an 8-bar loop and the default `mid` pace (12–24
bars), the only reachable outcomes are 16 and 24 bars — **32 to 48 seconds**. `fast` (6–12)
collapses onto 8 or 16 bars, **16 to 32 seconds**, which is not fast by any reading of the word.
A 16-bar loop doubles it again. And only one layer changes per interval (deliberately, and it
stays), so four slots need four intervals for a full turnover: **two to three minutes**.

The original spec did not miss this; it is written down at its §2.2 and explicitly accepted, on
the assumption that Endlesss rifffs are usually 1–4 bars so the rounding would be small. **That
assumption is wrong for the loop that actually matters.** The preview loop is not one rifff's
bar length, it is the *maximum* over every resolved slot — taken over all of them and not just
the audible ones (`DiscoverPanel.tsx:786-800`, deliberately, so muting cannot resize the loop).
Four slots from four jams, one of which is 8 bars, gives an 8-bar loop. In practice the rounding
is not a rounding. It is usually a doubling.

**The musical argument for quantising was right and is kept. The boundary it chose was wrong.**

### 1.2 The phone already solved this, and the reasoning is on disk

`src/main/remotePage.ts` shipped a per-stem **swap grid** (`e0abb0e`, `19a0c66`): five chips —
`own loop`, `loop end`, `8 bars`, `4 bars`, `2 bars` — deciding where a handover may land. Two
edges are already settled there and are not re-litigated:

- **A grid longer than the loop is capped to the loop** — `if (step > bars) step = bars`.
- **A grid that does not divide the loop steps down to the largest divisor** —
  `while (step > 1 && bars % step !== 0) step = step - 1`. From its own comment
  (`remotePage.ts:985-992`): *"4 over a 6-bar loop becomes 3, 8 over a 12-bar loop becomes 6, 4
  over an 8-bar loop stays 4. Every boundary is then the same place in the loop on every cycle
  and the downbeats stay where they were. It can never step below 1, which divides everything."*

And on which option to pick first (`remotePage.ts:680-684`): *"`own loop` is what per-stem
replacement made possible: the most musical boundary for a stem changing under eleven others is
its own cycle. … this is the one to try first."*

The desktop is in the identical position. Radio already changes exactly one slot at a time.
**The most musical boundary for a stem changing under three others is its own cycle**, not the
longest other stem's cycle.

### 1.3 The fix

Radio commits on the **changing slot's own bar length**, clamped and stepped down to a divisor of
the loop, instead of on the whole loop's wrap. In `advanceRadioClock`, "wrapped" becomes "crossed
a grid boundary", and a wrap is always one because 0 is always on the grid:

```ts
const crossed = wrapped || Math.floor(pos / gridBars) > Math.floor(clock.lastPos / gridBars)
due: crossed && barsElapsed >= clock.intervalBars
```

Passing `gridBars === loopBars` reproduces today's behaviour exactly. That is what makes it safe:
the old behaviour is one argument value away and stays reachable as a setting (§3).

**The grid never makes changes more frequent than the pace.** It is a gate, not a trigger — the
interval still has to elapse. All it does is stop the pace being silently rounded up.

If the changing slot's own bar length is unknown at the tick (nothing resolved, a non-integer
length), the grid falls back to the whole loop, which is today's behaviour. Nothing new can
break. The commit is still tens of milliseconds late (spec 2.3, unchanged, still accepted).

---

## 2. The pace, retuned

With the rounding gone the published numbers finally describe the behaviour — which means they
now describe the wrong behaviour, because they were chosen while being silently doubled.

Keep the shape: **each pace is a 2:1 window of bars, redrawn after every change.** Retune where
the windows sit:

| pace | bars, before | bars, after | at 120 bpm, after |
|---|---|---|---|
| `slow` | 24–48 | **18–36** | 36–72 s |
| `mid` (default) | 12–24 | **6–12** | 12–24 s |
| `fast` | 6–12 | **2–4** | 4–8 s |

A clean 3× ladder with 2:1 windows at every rung. **The new `mid` is the old `fast`'s numbers** —
that is the honest accounting. What he heard as "quite slow" at `mid` was 32–48 s; `mid` now
genuinely delivers what the old `mid` only claimed. And `fast` is 2–4 bars because, with `own
loop` as the grid, 2–4 bars is finally reachable rather than rounded to 8.

`mid` stays the default.

**Not a slider.** A number in bars invites being read as *the* number, and the whole point of the
pace is that there is no number — there is a range, redrawn every time, so you cannot count along
with it. A slider labelled "14 bars" undoes that in the reader's head even if the code still draws
a range around it. Three chips place the window coarsely, which is all the placement a
press-and-listen control needs.

---

## 2A. How many channels radio starts with

> "yes, and see if more channels are feasible.. lots ideally... but maybe slider up to 8?"

**This is a small piece of work, not a capability question.** Checked rather than assumed:

- `addSlot` has **no cap whatsoever**. He ran twelve slots earlier today.
- `EngineRifff.stems` is an unbounded vector on both sides of the wire — no engine change.
- Radio already uses **every** eligible slot; nothing about the scheduler is fixed at four.
- The only thing fixed at four is `RADIO_STARTER_KINDS = ['drums','bass','lead','warm']`
  (`DiscoverPanel.tsx:278`) — the bed radio lays down when started on an empty panel.

So: **a starter size control, four to eight, defaulting to four.** Presented as **channels**,
which is his word and the performance-instrument framing this whole session has been moving
toward.

**It does not cap the panel.** Nothing stops him adding a ninth, twelfth or twentieth slot by hand
today and that stays true. The slider sets what radio *starts* with, not what Discover *allows*.
Stated explicitly so nobody implements a ceiling that does not currently exist.

### 2A.1 What fills channels five through eight

Not a repeat of the first four. Every prefix of this order has to sound like a band on its own,
because the slider grows the bed from the left:

| # | kind | why |
|---|---|---|
| 1–4 | `drums` `bass` `lead` `warm` | shipped — the smallest set that sounds like a band |
| 5 | `drums` | a **second** percussion layer. A groove gets its top end from hats and perc sitting over the kick-and-snare bed; this is the single biggest improvement per slot. |
| 6 | `bright` | the counterweight to `warm` — a high end that is not the lead |
| 7 | `rhythmic` | a texture chosen for *movement* rather than instrument; what fills the space between the bed and the lead |
| 8 | `lead` | a counter-line. Two melodic voices, not two basses — two basses fight, two leads converse. The dedupe pass (`:2016-2021`) keeps it from drawing the same stem. |

### 2A.2 Three consequences he should not have to discover

- **More channels means each one turns over less often.** One change per interval across six
  layers is half the rate of three, which directly worsens the five-minute drought he reported.
  **This is the strongest argument yet for `even` being the default turnover mode (§6.2) rather
  than an option** — the two features make each other worse or better depending on that one
  decision.
- **Keeping is capped at 20, and it already says so.** `MAX_RIFFF_STEM_SLOTS = 20`
  (`src/shared/riffStemSlots.ts:19`, raised from 8 this morning by the `RiffStemsExtra` side
  table) binds only when a group is **kept** into the library, and `riffLibraryWriter.ts:112-119`
  already warns by name rather than truncating silently. **Nothing to fix** — silent truncation at
  8 was exactly the `add to timeline` bug he hit, and it was fixed properly.
- **The phone has a byte budget.** `STEM_BUDGET_BYTES = 160 MiB` (`remotePage.ts:1211`) against
  ~6.14 MB per 16-second stereo stem puts the edge around twenty stems. Eight is comfortable.
  Noted rather than left to be found.

---

## 3. Where a change lands: the grid as a setting

§1.3 ships with no UI and no setting — the grid is the changing slot's own loop, full stop. Once
the menu exists (§7) it becomes a chip row with the phone's own five options and the phone's own
words, because two surfaces doing the same thing should say it the same way.

| chip | grid |
|---|---|
| `own loop` | the changing slot's own bar length — **default** |
| `loop end` | the whole preview loop — exactly what shipped 2026-09-26 |
| `8 bars` / `4 bars` / `2 bars` | clamped and stepped down, per §1.2 |

Row label: `change on`.

**The default changes from what shipped, on purpose.** The phone kept `loop end` as its default
because a value was already stored on his phone and a default that moved under him would be a
surprise. Here the reverse holds: this is a brand-new field with nothing stored anywhere, and the
surprise would be shipping a fix for "radio is too slow" whose default is still the slow thing.

---

## 4. Drop-outs — the free one, and possibly the best one

> "yep, holes = good. drop out the drums for a few beats or something"

This is **not** a transition. A transition decorates a stem change; a drop-out has no stem change
at all. Radio occasionally mutes one layer for a few beats and brings it back, and that is the
whole feature.

It is worth building first, ahead of every transition, for four reasons:

- **It is the simplest thing that meets §0A.** One `volume` curve, on one stem, ending at the
  loop top. No second stem, no rendering, no engine change, no new wire field.
- **It is pure arrangement.** Dropping the drums for two beats before the loop restarts is the
  single most recognisable move in electronic music, and it requires nothing to be chosen,
  fetched or rendered.
- **It makes radio sound like it is playing rather than shuffling.** A stem change is a new
  ingredient. A drop-out is a decision. That is the quality he keeps circling.
- **It builds the hole for free.** §5.2's `hole` transition is this exact machinery with the
  return pinned to the change's own bar instead of an arbitrary one.

### 4.1 Which layer

Not uniform-random. **Drums and bass only**, weighted 3:1 toward drums.

Dropping a pad or a texture is close to inaudible and would read as a bug rather than a gesture —
the move works because the ear is *counting* on the thing that disappears. Drums is the classic;
bass is the other one, because its absence sets up a return. A slot's kinds are already known
(`DiscoverMaskKind = 'drums' | 'bass' | 'lead'`, `src/shared/discoverSlotKind.ts:104`), so this
costs a filter and nothing else.

`lead` is deliberately out: dropping the melody for two beats is a real move, but it is also
exactly what a mistake sounds like, and the difference depends on material this cannot see.
Trait-only slots (`chonky`/`rhythmic`/`sparkly`/`buttery`) have no instrument identity at all and
are out for the same reason. Both are on the **not now** list rather than forgotten.

If no slot is drums or bass, there are no drop-outs. Silence about it is correct — a message
explaining why a gesture did not happen would be worse than the gesture not happening.

### 4.2 It returns at the top of the loop, so it is a curve and it is measured backwards

Per §0A.4, the anchor is the loop top. A drop-out **ends at the wrap** and therefore **begins
`lengthBeats` before it**. Durations count backwards from the return, never forwards from the
trigger.

Concretely, the whole feature is one `volume` curve on the dropped stem, in loop-relative bars,
written into `previewState.stemAutomation[stemKey(groupId, slotIndex)]`:

| bar | value | why |
|---|---|---|
| `0` | `1` | the return — the curve resets here on every wrap, which *is* the anchor |
| `loopBars - dropBars` | `1` | full gain right up to the edge |
| `loopBars - dropBars + ε` | `0` | a short ramp down, not a step — a hard gain step on a sounding source pops |
| `loopBars` | `0` | silent through to the wrap |

Read what that gets for free: **the curve can only be anchored to the loop top**, because it is
clip-relative and the transport wraps at `loopLengthBars`. The awkward constraint from §0.1 —
"a curve repeats every lap" — is precisely the property that makes the musical requirement
automatic. There is no bar arithmetic to get wrong and no wrap to detect.

The **return is a 15 ms ramp, not a 15 ms delay** (§0A.3): the stem's onset is sample-aligned to
the wrap and only its first 15 ms is amplitude-ramped, which is shorter than every anti-click fade
this app already ships.

**Arming is early and clearing is late**, and neither is timing-critical: radio writes the curve
during the lap *before* the one it fires on, and removes it on the lap after. A 33 ms jitter in
when the curve is armed has exactly zero effect on when it fires, which is the entire point of
§0A.

**Not on the lap the change lands on** — a drop-out on top of a swap is two events in one place
and neither reads. Since §1's grid usually puts a change somewhere other than the wrap, the
collision is rare by construction (§0A.5).

### 4.3 Length, weighted

| length | weight |
|---|---|
| 1 beat | 0.2 |
| 2 beats | **0.5** |
| 4 beats (a full bar) | 0.3 |

Two beats is the safe default and the most common; a full bar is the dramatic one. It is a
weighted draw rather than a setting because **a fixed length is a rhythm and a varied length is a
gesture** — the same argument as the pace windows, applied one level down.

4/4 is assumed, as everywhere else in Discover.

### 4.4 Frequency: rare, and rare is the default

> "drums drop out rarely... rarely i think. since it's working quite well currently."

That reasoning is the design constraint, not just a number: he likes radio as it is and does not
want a gesture competing with the material. So this is an **occasional event, not a recurring
feature of the groove**, and sparse is the default rather than something he has to go and find.

No second clock. After each committed change, radio rolls **once** for whether the coming interval
contains a drop-out:

| chip | probability per interval | mean gap at `mid` |
|---|---|---|
| `off` | 0 | — |
| `rare` | **0.15** — default | ~60 bars |
| `often` | 0.4 | ~22 bars |

The middle column is the checkable number. `mid` draws 6–12 bars, mean 9, so at p = 0.15 the mean
gap between drop-outs is 9 / 0.15 = **60 bars — about two minutes at 120 bpm**. `often` gives
~22 bars, around forty-five seconds.

Erring sparse is deliberate. If it happened every lap it would be a rhythm, not a gesture, and the
point of the feature would be gone. One every couple of minutes is an event you notice.

### 4.5 Guards, each with its reason

- **Never drop the only audible layer.** Fewer than two audible slots, no drop-out. A drop-out
  that leaves silence is a different and much riskier move (§4.7).
- **A user-muted layer is already out.** Not eligible — "dropping" it is a no-op that wastes the
  gesture.
- **A locked layer *is* eligible.** This is the one that needs saying: **the padlock protects the
  choice, not the arrangement.** It means "do not change which stem this is", and a drop-out does
  not change which stem it is. Dropping a locked drum layer for two beats is exactly the move,
  and refusing to would be the wrong reading of the flag.
- **The hook (§6) is never dropped.** It is the thing being built around; dropping the centre is
  a breakdown, which is a bigger move and is not this.

### 4.6 What happens if a change falls due mid-drop

Nothing bad, and for a structural reason rather than a rule: **a `load-project` re-sends the whole
automation state.** If radio commits a change while a drop-out curve is armed, the rebuild either
carries that curve through unchanged (the dropped slot is not the changing one) or drops it with
the stem that left. There is no override to be snapped, because §0A moved this off the live-param
path.

The one case worth naming: a change committed *during* the silent window of a slot that is itself
being dropped. Radio does not schedule that (§4.2's "not the lap the change lands on"), and if it
somehow happened the new stem would simply arrive already silent and return at the wrap with
everything else — which is, if anything, a good accident.

A change that *deliberately* lands while the drums are out is a real and better idea, and it needs
the two-stem machinery to be worth doing properly. **Not now**, named.

A change that deliberately *lands while the drums are out* could be excellent. It is also not
reliably achievable through `clearAll()` and belongs with the two-stem work. **Not now**, named.

### 4.7 Also not now: the breakdown

Mute everything except the hook for a bar, then rebuild. It pairs beautifully with the hook and
it is the one that would make radio sound like it has intent. It is also several simultaneous
drop-outs plus a rebuild order plus the "never silence" guard inverted, and it deserves its own
design rather than a paragraph at the bottom of this one.

---

## 5. Transitions

> "maybe transitions would be the coolest new idea to focus on building"

He said "fades", but the app already ships the materials a transition is actually made of: a
filter sweep, a reverb send, a volume curve per clip, and noise risers
(`docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md`). Per §0, all four reach the
Discover preview today. So the design question is not *how long is the fade* — it is **what kinds
of move can radio make with what already exists.**

### 5.1 The mechanic: arm, then clear

Every transition is the same two-step cycle, and it exists because of constraint §0.1 (a curve
repeats every lap):

1. **Arm — early, and not timing-critical.** Radio commits the pick as usual (`commitSlotPick` →
   `setSlots` → `syncPreviewToEngine` → `load-project`) and `syncPreviewToEngine` additionally
   writes `previewState.stemAutomation` and/or `previewState.risers` for the chosen transition.
   Because the curve is loop-relative, **it fires at the loop top whether it was armed a second or
   a hundred milliseconds beforehand** — the 30 Hz jitter is entirely outside the timed path
   (§0A).
2. **Clear.** On a later lap, one more `syncPreviewToEngine` with the automation gone.

Because `isStemToolkitNeutral` drops the whole `toolkit` key when nothing is drawn, **the cleared
project is byte-for-byte what would have been sent without this feature**. That is the property
that makes the feature safe to ship: when it is off, or between transitions, nothing about the
preview has changed.

A transition's length is **clamped to half the loop**, so a curve can never run into the wrap it
is anchored to — the same rule, for the same reason, that `FadeGain.cpp:33-51` already applies to
clip fades. Belt and braces: any `load-project` re-sends the whole automation state, so the worst
case is a transition cut short rather than one stuck on.

**Every transition is anchored to the loop top**, per §0A.4 — a `filter in` opens *from* the wrap,
a `riser` closes *into* it, a `hole` ends *at* it. None of them is expressible against an
arbitrary bar, and none of them wants to be.

### 5.2 The palette that ships — one stem, no blockers

Everything here acts on stems that are **already in the project after the commit**, so none of it
touches the 1:1 assumptions in §5.4.

| transition | what it does | mechanism |
|---|---|---|
| `cut` | nothing | today's behaviour, and the right answer for a lot of material |
| `hole` | the outgoing layer drops a beat or two before the loop restarts; the new one lands in the space | §4's `volume` curve, with the change committed at the same wrap. **Free once §4 ships.** |
| `filter in` | the new layer sweeps open from closed over a bar | one `filterCutoff` curve on the incoming stem, lowpass |
| `bloom` | the new layer arrives drenched and dries out | one `reverbSend` curve on the incoming stem, high → 0 |
| `duck` | every *other* audible layer dips and recovers, so the new one lands in space | one `volume` curve per other stem |
| `riser` | a noise sweep into the change | a `RiserClip` in `previewState.risers`, ending on the change bar |

The riser is the only one needing an extra reload, because it must be audible *before* the change
it announces. Radio already knows its next pick a whole interval early (`armRadioPick`), so it
arms the riser at a grid boundary `riserBars` ahead. One extra `load-project` per riser, and the
riser is generated live by `NoiseRiser.cpp` — no file, no render, no cache.

**`filter in` is the recommended flagship.** It is the app's own signature move, it is usually
more musical than a fade, and it needs exactly one curve on one stem that is already in the
project. If only one transition ever ships, it should be that one — with `hole` beside it,
because `hole` is free.

### 5.3 Global, per-kind, or varied? All three, in the right places

The naive options are both wrong:

- **One fixed transition** is a rhythm. The same move every time is the exact failure the pace
  windows exist to avoid; it would be perverse to randomise *when* a change happens and then make
  *how* it happens perfectly predictable.
- **A per-kind matrix** is musically right — a drum layer cutting while a pad blooms is obviously
  correct — but it is a grid the user has to fill in, which is a lot of UI for a control that is
  supposed to be pressed and then listened to.

**The resolution: the menu chooses a temperament, and the changing slot's kind chooses the
weights inside it.**

| chip | meaning |
|---|---|
| `off` | always `cut` — exactly today |
| `subtle` | **default** — mostly `cut` and `hole`, occasional `filter in` |
| `bold` | the full palette, `riser` and `duck` included |

Within a temperament, radio draws weighted by the changing slot's kind: a `drums` slot weights
`cut` and `hole` heavily and `bloom` near zero; a pad-ish or trait slot weights `filter in` and
`bloom`. That is per-kind musicality with zero per-kind UI, and — importantly — the weighting
table is a pure function in `src/shared/`, so it is testable, arguable, and adjustable without
touching a component.

### 5.4 Deferred: anything needing both stems at once

A `crossfade`, a `filter out → filter in`, and an `overlap` all need the outgoing stem still
present while the incoming one plays. That is expressible — `EngineRifff.stems` is unbounded on
both sides of the wire and `syncPreviewToEngine` already passes `members.length` as `maxMembers`
uncapped (`:860`) — but it collides with three renderer-side 1:1 assumptions, named here so they
cannot be discovered late:

1. **`slotIndexById` is a `Map<string, number>`** (`:929-932`). A slot present twice collapses to
   the last index and silently breaks `updateSlotGain`'s live-param targeting. This is the real
   structural blocker and needs a shape change, something like
   `Map<string, { current: number; outgoing?: number }>`.
2. **`setRemoteLoop(project, members.map(m => m.id))`** (`:916-921`) pairs a phone row to its
   stem's audio by list position and, per its own comment, *drops the whole pairing if the two
   lengths ever disagree*. A duplicated id produces a duplicate phone row. The phone mixer shipped
   two days ago; breaking it is not an acceptable price for a desktop crossfade.
3. **Any unrelated `load-project` mid-transition snaps it**, via `clearAll()`. The §5.1 clamp
   handles the scheduled case; a hand gain-drag or a mute during a crossfade is a separate rule to
   write.

Worth saying plainly: **the crossfade is not the interesting one.** It is the obvious one. `hole`
and `filter in` are cheaper *and* better, and they are both in §5.2.

### 5.5 Deferred: pre-rendered one-shots

A **reverse tail** (the outgoing stem's last bar, reversed, into the change), a **tape stop**
(varispeed down over a beat) and a **stutter** (the last beat repeated, accelerating) are all
impossible live — there is no pitch or delay DSP in the engine to do them with — and all trivial
as a baked file.

And radio has the lead time to bake one. `armRadioPick` already chooses the next stem and warms
it through `resolveCandidateStem` a whole interval early, so both the incoming and outgoing stems
are known and on disk before the boundary. The offline machinery exists too: `src/main/
rubberband.ts` with its `<userData>/stretch-cache/`, and `remoteStemRenderer.ts`'s `afconvert`
pipeline with a content-keyed byte cache. A transition file should be cached and keyed exactly
like those — the same stem pair recurs, and a rendered tape stop is a pure function of its input.

What blocks it is not the render. It is **placing a clip in the preview rifff that is not a
library stem** — the same 1:1 assumptions as §5.4, plus a real file path that
`assembleDiscoverRifff` has no member type for. And the honest fallback rule is already
established by the phone's own swap: **if the render is not ready by the boundary, take the plain
one and carry on.** Never wait, never stall the change.

`tape stop` is the one that will make him laugh the first time it fires, and that is a real
reason to build it. It is not a reason to build it third.

### 5.6 Ruled out, one sentence each

- **Delay throws** — there is no delay anywhere in the engine.
- **Pitch risers on the stem itself** — no pitch automation on the wire; the noise riser is the
  supported shape and it is already free.
- **Anything needing new real-time DSP in the engine** — out by the standing constraint, and
  unnecessary given §0.

---

## 6. Who changes next: turnover, and the hook

### 6.1 The five-minute drought is not a bug, and it is not luck either

`pickRadioSlotId` (`radioSchedule.ts:127`) remembers one thing: it avoids the slot it changed
last, then draws uniformly. With four eligible slots that is 1-in-3 per interval, so surviving
seven intervals untouched has probability (2/3)⁷ ≈ 6%. At a ~40 s effective interval that is a
~4.7-minute hold, and at 6% it is not rare — over a twenty-minute session it is close to
certain that *some* layer does it.

**A memoryless draw produces droughts. That is what memoryless means.** It is a property that
needs to become a choice, which is exactly what he said, including the part where he liked it.

### 6.2 `even` and `random`

- **`even` (default)** — bias toward the least-recently-changed eligible slot.
- **`random`** — today's behaviour, kept verbatim, because he called the long hold "good for
  consistency".

`even` is the default because a five-minute hold he did not ask for reads as broken — his first
sentence about it was a complaint, and "ah! it changed" only arrived after he had already decided
something was wrong. The deliberate way to hold a layer is the hook, and `even` plus a hook gives
both: everything cycles predictably while the thing he chose stays. That pairing is the strongest
argument for either of them and the reason they are designed together.

### 6.3 `even` is a weighting, not a rotation

Strict round-robin is audible. Four layers turning over in the same order forever is a pattern,
and a pattern is precisely what the pace windows exist to avoid.

So `even` is a **weighted draw by staleness**:

```
staleness(id) = turn - (changedAt.get(id) ?? turn)
weight(id)    = (staleness(id) + 1) / (id === hookSlotId ? HOOK_HOLD_FACTOR : 1)
```

`turn` is a logical counter incremented once per committed change — not wall time, so it stops
with the transport for free, exactly like the clock. A slot that just changed has weight 1; one
that has waited six turns has weight 7. The longer a drought runs, the harder it works against
itself, so droughts get short without any single turn becoming certain.

`random` is the same machinery with every base weight pinned to 1. One code path, one set of
tests.

"Never the same one twice running" survives untouched — under `even` the last-changed slot
already has the lowest weight, but the hard exclusion is shipped behaviour, it is free, and
removing it is a change nobody asked for.

**An unknown id counts as "just changed"** (`?? turn`, weight 1). That is correct rather than
convenient: `addSlot` performs a new slot's own first roll, so a slot radio has never touched has
in fact just changed. The map needs no seeding and a cold start falls back to a uniform draw.

**The map is pruned to the live slot ids on every commit**, the same way `radioEligibleSlotIds`
re-reads `slotsRef` rather than trusting a snapshot. A removed slot's entry is dropped rather
than stranded, and a re-added slot gets a fresh id anyway (`freshSlotId`), so recency can never be
resurrected.

### 6.4 The hook: one feature, not two

> "maybe have a way to select 'keep this one for a while' or .. 'this is the hook' or something"

The two phrasings are one gesture. "Keep this one for a while" is what it *does*; "this is the
hook" is what it *means*. Two buttons for the same tap would force him to choose between two
nearly identical outcomes before he could press either. It is called **`hook`**, because the name
carries the intent and "keep for a while" only describes the mechanism.

**It is not the padlock, and the difference is one line:**

> The padlock is never. The hook is rarely.

A slot can be both; the padlock wins, because "never" contains "rarely". The hook mark survives
under a lock and resumes when the lock comes off — a lock is a temporary override of eligibility,
not an instruction to forget which layer is the centre of the track.

The hold is the `HOOK_HOLD_FACTOR = 8` divisor already in §6.3's formula. That is the entire
implementation, and it is a good one rather than a lazy one:

- **It composes with `even` for free.** The hook's staleness keeps growing while it waits, so it
  climbs back toward eligibility on its own and eventually does turn over. It stays much longer
  than everything else without ever being frozen.
- **It works under `random` too**, where every base weight is 1 and the hook is simply drawn an
  eighth as often. No second code path.
- **"Does it ever turn over?" is yes**, which is the right answer — a hook that never turns over
  *is* the padlock, and the padlock is already there.

**At most one.** A track has one hook; two hooks is two centres, which is no centre. Marking a
second unmarks the first, silently. It is a radio button in the literal sense.

**Marked** by an 18 px toggle on each slot row, immediately right of the padlock, in the 14 px
spacer that is already there (`DiscoverPanel.tsx`, `gridColumn: 6`). Lit with
`--ra-bg-row-active` and `--ra-text`, **not a colour**: colour here is spent only on things
carrying audio information, and the padlock directly beside it is monochrome — two adjacent state
toggles disagreeing about colour is noise. Tooltip `make hook` / `release hook`. Visible only
while radio is on, hidden with `visibility` rather than unmounted so the row grid cannot reflow —
the same trick the progress rule already uses (`:2966`), and the row grid's own doc comment
(`:4090-4104`) is a long, hard-won warning about exactly that class of bug.

**Not persisted.** Slot ids are minted fresh each session, so a stored hook id would name a slot
that does not exist.

### 6.5 Should the hook also pull the other layers toward it?

Not yet, and here is exactly what it would take.

**Nothing in this codebase scores one stem against another stem.** Every scorer is
candidate-against-a-target-*profile*: `rankCandidates` takes a scalar `targetBpm`, abstract
`targetTraits` and a favourites set (`discoverRanking.ts:73`); `applyTraitBar` takes a library
percentile; `pickAdjacentCandidate` does not score at all. The only cross-slot behaviour is the
**negative** dedupe at `:2016-2021`.

And the data is absent when it is needed: `traitPercentiles` are populated only for the trait
kinds a slot was rolled for (`discoverCandidates.ts:1065`), so a `['drums']` slot's candidates
arrive with `{}`. A mask-only hook has nothing numeric to be compared against.

Four things would have to be built — a hook-fit scorer, full trait coverage on every candidate
regardless of kind, the same for the hook's own stem, and a new `rankCandidates` term. That is a
change to the *candidate pipeline*, a different file and a different blast radius from the
*scheduler*, measured against ~45,000 stems nobody has timed this against.

**One mark, two effects, shipped in that order.** The hold ships; the gravity waits behind §8,
which needs most of the same machinery and has a clearer payoff. One cheap signal for whoever
gets there: `candidate.jamCID === hook.jamCID` is already on every candidate and costs nothing —
stems from the same jam were played together by actual people.

---

## 7. Reach: how far it wanders

Radio calls the same `pickForSlot` the row's `similar` button calls. But Discover already ships
three per-slot operations that, in the right order, are a distance dial:

| chip | what radio calls | what it means |
|---|---|---|
| `similar` | `pickForSlot` — kinds + trait bar + BPM rank + chaos | **default**, today's behaviour |
| `adjacent` | the headless nearby path | another stem from the **same jam**, recorded around the same moment |
| `random` | the random-candidate path | anywhere in the library matching the kind |

Same three words the rows already use; a second vocabulary for the same three operations would be
worse than useless.

Two verified facts make it cheap. **The headless `adjacent` already exists** —
`rollAdjacentForSlot` (`:1903`) was built for the phone on 2026-09-27 precisely because a popover
does not fit a phone; it needs no user and no choice, calling `getAdjacentDiscoverCandidates` then
`pickAdjacentCandidate` (`src/shared/discoverAdjacentPick.ts:29`, pure, injectable random, already
tested). And **"adjacent" means same jam, neighbouring in recorded time** — `discoverAdjacency.ts`
walks that jam's riffs in `CreationTime` order and never leaves it. For radio that is a *good*
property: it is the one signal in the app that two stems were played together by people.

Radio cannot reuse the three shipped entry points directly, because all three commit and two push
an undo snapshot (§10). It needs **pick-only** variants, which is the same split `pickForSlot` was
already carved out of `rollForSlot` for on 2026-09-26 — precedent, not invention.

**Degradation:** `adjacent` returns null when the slot has no anchor or its jam has no eligible
neighbours; radio falls back to `similar` for that turn rather than idling. A reach setting that
silently stops radio changing anything is worse than one that quietly does the ordinary thing.

`chaos` (App.tsx:1512, the "matching" dial) is a different axis and is untouched.

---

## 7A. Character — a mood on everything radio picks

> "or an 'upbeat' or 'downbeat' filter .. or dark or light or whatever.. whatever preferences we
> could adjust for the randomization"

A third, distinct kind of steering. Worth naming all three side by side, because the difference is
the design:

| control | says |
|---|---|
| a slot's **kinds** | *what a layer is* — drums, bass, lead |
| **`more like this`** (§8) | *go toward that particular stem* |
| **character** | *whatever you pick, pick it in this mood* — across every slot at once |

### 7A.1 It maps onto trait machinery that already exists

The trait kinds are `bassHeavy`, `rhythmic`, `bright`, `warm`, every candidate can already carry a
direction-adjusted library percentile per kind, and `rankCandidates` already consumes them as an
additive term (`TRAIT_SCORE_WEIGHT = 1`). And `DISCOVER_TRAIT_DIRECTION` already reads `bright` as
high and `warm` as low **on the same underlying field**, which means the app already models one of
these as a two-ended axis rather than two separate tags.

Two axes ship:

| axis | chips | underlying |
|---|---|---|
| **dark ↔ light** | `dark` · `any` · `light` | spectral centroid — `warm` low, `bright` high |
| **sparse ↔ busy** | `sparse` · `any` · `busy` | `rhythmic` — `rhythmicStrength`, falling back to `transientDensity` |

`any` is the default and the off state. Word pairs, never a number — `dark … light`, not
`brightness: 0.3`.

**`bassHeavy` is deliberately not a third axis.** As a *global* bias it is incoherent: you want the
bass layer heavy and the lead not, which is a per-kind statement, and per-kind character is a
matrix, not a chip. It stays available per-slot as the `chonky` kind, which is where it belongs.

### 7A.2 `upbeat ↔ downbeat` does not ship, and the reason matters

It is the one he named first and it is the one that does not map.

"Upbeat" versus "downbeat" is about *where accents sit relative to the beat* — syncopation, swing,
whether the weight is on the one or the and. Every rhythm feature this app has measures **amount,
not placement**: `transientDensity` counts onsets, `rhythmicStrength` measures how strongly they
pulse, and `onsetRegularity` is `1 − CoV` of the inter-onset intervals, which is *evenness*, not
phase. Nothing measures onset position against a beat grid, because nothing does beat tracking.

Adding it means a new field on `StemFeatures`, which bumps `STEM_FEATURE_VERSION` — and a version
bump **triggers a full library rescan**, as the 2026-09-22 versioned FFT/rhythm work already
demonstrated against a ~45,000-stem backlog. A character chip is not worth a rescan.

**Left out, named, with the reason.** The tempting proxy — reading "upbeat" as "faster" — is also
out: radio already ranks against `state.bpm` and time-stretches everything to it
(`stretch: {[groupId]: true}`), so tempo is pinned and unavailable as a character axis.

### 7A.3 A bias, never a filter — and the precise reason that is not just a word

A hard filter empties the pool on a small library and radio stalls. A weighting always returns
something. That distinction is not a matter of tuning here; it is a matter of **which existing
function the character goes through**, and getting it wrong silently produces the filter:

- **`applyTraitBar` filters.** It is a library-percentile threshold with a `minPool: 12` backoff
  and a `step: 0.1` loosening (`traitBar.ts:79`). A character axis routed through it *is* a hard
  filter with a safety net.
- **`rankCandidates` biases.** `targetTraits` adds `Σ percentile` as one more additive score term
  beside `BPM_FALLOFF` and `FAVOURITE_BOOST`, and `pickReroll` then draws from a chaos-sized slice
  of the ranking (`discoverRanking.ts:73,172`).

**The character bias goes through `rankCandidates` only, and never through `applyTraitBar`.** At
the extreme the ranking is sorted almost entirely by that trait and `pickReroll` still returns
something. **A character setting can never stall radio**, and that is a structural guarantee
rather than a tuned one.

Both axes may be set at once. The "driven into a corner where nothing matches" risk is a property
of filters; with additive terms the worst case is a strongly-sorted list.

### 7A.4 How it composes

- **With per-slot kinds:** they operate at different stages. The kind set decides the SQL pool;
  the character reorders what comes back. **A drums slot stays drums, it just picks a darker
  drums.** Nothing to reconcile.
- **With `more like this`:** they **sum**, as additive terms, exactly as every existing term in
  `rankCandidates` composes. Worth saying what that means in practice: `more like this` decays to
  nothing in about ten changes (§8.4) and the character axis does not, so **the nudge is temporary
  and the mood is a setting** — over a session the character wins by default. That is the right
  relationship between the two and it needs no arbitration rule.

### 7A.5 The one real cost, and why it ships with §8

Same wall as §8.6, and this is the load-bearing finding: **a candidate's `traitPercentiles` are
populated only for the trait kinds its slot asked for** (`discoverCandidates.ts:1065`). A
`['drums']` slot's candidates arrive with `{}`, so there is nothing for a `dark` bias to read.

The obvious shortcut — append the character trait to the `kinds` sent to main — is wrong twice
over: it would feed `applyTraitBar` (§7A.3, turning the bias into a filter) and, for a trait-only
slot, it would change which SQL pool is built at all. So it needs an **explicit new parameter** on
the candidate request — extra traits to attach percentiles for, which do not join the pool
construction and do not join `targetTraits` for the bar — rather than an overloaded existing one.

That is a main-process change, and it is **the same widening `more like this` needs** (§8.6):
extra scoring inputs that must not change the pool. Building them together is strictly cheaper
than building either alone, which is why they share a phase (§10, phase G).

---

## 8. `more like this` / `less like this`

> "as it's running, like.. 'more like this' ... 'less like this'"

The live counterpart to the hook. The hook says *keep this*; this says *go that way*. Designed
here, planned separately (§8.7).

### 8.1 There is already a learned-centroid mechanism, and it is the wrong store

`src/main/categoryCentroidStore.ts` and `categoryCentroidTraining.ts` are real, and underneath
them `src/shared/categoryCentroids.ts` has everything the arithmetic needs: running-mean centroids
kept in raw feature space, shared **global Welford stats** with `standardize(vector, stats)` built
on them, `euclideanDistance`, and a 19-dimension vector (`toFeatureArray`,
`src/shared/stemFeatures.ts:64` — six scalars plus 13 MFCCs) persisted per stem in
`StemFeatureCache` and reachable from the renderer today as
`window.rifffApi.getStemFeatureCache(path)`.

**Reuse the arithmetic. Do not write into that store.** `recordConfirmedCategory` trains a
*classifier* — which bus a stem belongs on, what role it plays — and every write calls
`noteAutoClassifyTrainingChanged()` and re-wakes the overnight classifier. A taste signal ("I like
this bassline tonight") is not a classification fact, and folding one into the other would quietly
corrupt Tidy Up's suggestions, the overnight role guesses and the bus clustering, in a way nobody
would ever connect back to having tapped `more` on a row.

`store.global` *is* legitimately shared: those stats describe the stem population, not any
category and not any taste. Read them; write nothing.

### 8.2 Point at a row. Steer that row's kind.

Three options, two rejected:

- *The layer that just changed* — rejected: radio would have to mark which row that was, and "a
  highlight on the row that just changed" is on radio's own not-now list. It also confines the
  control to a window after a change, the opposite of "as it's running".
- *One global pair steering everything* — rejected on the material: a taste vector built from a
  bass stem would drag the drums slot toward bass-shaped things. That is a smear, not a nudge.
- *Per row, biasing only that slot* — rejected because the slot turns over: you nudge, the layer
  changes a minute later, and the bias is attached to a stem that is gone.

So the bias is keyed by the row's **kind set** (`slotKindsKey`, already the pool key). Tapping
`more` on the bass row steers every future bass pick — including after that slot itself turns
over — and leaves the drums alone. **A nudge never crosses a kind**; the kind set decides the SQL
pool before any of this runs, and the nudge only reorders what comes back.

### 8.3 `less` is not the opposite of `more`

"More like this" pulls toward somewhere. "Less like this" pushes away from somewhere, and "not
that" is nearly everything.

**Rejected: an exclusion radius.** A radius in 19-dimension standardized space has no intuition
attached — nobody, including whoever picks the number, knows how many stems it swallows. In a
small per-kind pool it can empty the pool, at which point radio silently stops changing that
layer, and the failure looks exactly like the drought in §6.1 this document is trying to kill.

**Shipped: a block plus a de-weighting.**

1. **Block that exact stemCID for the session** — guaranteed, legible, and what anyone means the
   first time they press it: you never hear that one again tonight.
2. **A soft penalty** proportional to nearness to its vector, folded in as one more additive term
   beside `BPM_FALLOFF` and `FAVOURITE_BOOST`.

A penalty cannot starve the pool. The worst case is a different ranking order; `pickReroll` still
returns something. That property is the entire reason for the choice.

### 8.4 It decays, and that is why it does not persist

The `more` target is an EMA over the pointed-at vectors, α = 1/3, so it remembers roughly the last
three nudges rather than averaging the whole night into mush. The **strength** of both terms
decays by 0.8 per committed change and switches off below 0.1 — about ten changes, three or four
minutes at `mid`. A nudge colours the next few minutes and then radio is itself again.

The number is taste; the shape is not. A bias that lasts forever stops being a nudge and becomes a
filter, and a filtered radio stops surprising him, which is the only reason to run one.

**Session-only.** The clean argument: decay and persistence are incompatible. A bias engineered to
be gone in ten changes has nothing left to save by the time the app quits, so persisting it would
mean removing the decay — and that turns this into a taste model, a much bigger feature, a
different product, and one that would silently change what the hand-clicked dice do too.

### 8.5 Two taps, no dialog, legible from a sofa

Two 18 px buttons per row, `more` and `less`, in the same radio-only strip as the `hook` toggle —
so a row grows one strip while radio is on, not three unrelated controls. Tooltips `more like
this` / `less like this`. A tap flashes the button's background to `--ra-bg-row-active` for a beat
and does nothing else: no dialog, no confirmation, no toast, no undo. Pressing twice is not an
error, it is a stronger opinion.

### 8.6 The one real cost: the features are not on the wire

`DiscoverCandidate` carries `traitPercentiles` only for the trait kinds its slot asked for, and
`{}` otherwise. The 19-dimension vector is not on the wire at all, and widening every candidate by
19 doubles across a whole pool is a payload change nobody has measured.

The right shape is to score **in main**, where `getStemFeatureCache` and the DB already are: send
the taste vectors with the candidate request, get back one scalar per candidate, fold it into
`rankCandidates`. The renderer needs one IPC round trip per tap to fetch the pointed-at stem's own
vector — one stem, not a pool, through an API that already exists, for a path the row already has.

Files that would move: `discoverCandidates.ts`, the `get-discover-candidates` handler, the preload
signature, `discoverRanking.ts`, `DiscoverPanel.tsx`, and a new pure `src/shared/radioTaste.ts`
holding the EMA, the decay and the scoring — with `standardize` and `euclideanDistance`
**exported** from `categoryCentroids.ts` rather than copied, since there are already two private
copies of `euclideanDistance` in this codebase and a third would be a failure.

### 8.7 Why it is a separate plan

Not length. Its cost is unmeasured against a real library: nobody has timed a per-candidate
distance computation in main over a ~45,000-stem pool, and the answer decides whether this is a
ranking term or a pre-filter. A plan cannot honestly specify code whose shape depends on a
measurement that has not been taken. **Task one of that plan is the measurement.**

---

## 9. The menu

> "more parameters .. maybe even a menu"

Five chip rows do not fit on the Discover actions row, and the constraint he set earlier holds:
**radio stays something you press and listen to.** The controls live behind the radio button, not
spread across the Discover screen.

A popover, `src/renderer/src/components/DiscoverRadioMenu.tsx`, modelled line for line on
`DiscoverKindPicker.tsx` — the same screen-coordinate anchoring, the same viewport clamp in a
`useLayoutEffect`, the same click-outside-plus-Escape dismissal with an `ignoreRef` for the button
that opened it, the same `row(label, chips)` shape, the same `--ra-bg-bar` panel with a
`--ra-border-strong` edge and no `border-radius`.

Opened by a small chevron immediately right of `radio`, `data-tooltip="radio settings"`, visible
only while radio is on.

| row | chips |
|---|---|
| `pace` | slow · mid · fast |
| `change on` | own loop · loop end · 8 bars · 4 bars · 2 bars |
| `channels` | 4 · 5 · 6 · 7 · 8 (what radio *starts* with — §2A) |
| `transitions` | off · subtle · bold |
| `drop-outs` | off · rare · often |
| `turnover` | even · random |
| `reach` | similar · adjacent · random |
| `dark … light` | dark · any · light |
| `sparse … busy` | sparse · any · busy |

`channels` is a chip row rather than a literal slider: five values, each two characters wide, is
smaller and more precise than a slider and it matches every other row in the menu. He said
"slider"; the thing he wants is a number between four and eight, and chips give him that in one
tap instead of a drag.

**The pace chips move off the actions row into the menu.** That is the argument for the menu
existing at all rather than just somewhere to put new things: the row currently grows three chips
whenever radio is on; afterwards it grows one chevron and keeps the `radio` button and the
progress rule. **The row gets simpler as the feature gets richer.** The progress rule stays as it
is — knowing a change is coming is most of the pleasure.

### 9.1 Where the settings live

`DiscoverSettings` (`src/main/discoverSettingsStore.ts` — a plain JSON file in `userData`, not
SQLite) gains one nested object rather than six more flat fields:

```ts
radio: {
  pace: RadioPace
  grid: RadioGrid
  channels: number            // 4..8, clamped on load
  transitions: RadioTransitions
  dropOuts: RadioDropOuts
  turnover: RadioTurnover
  reach: RadioReach
  character: { tone: RadioTone; density: RadioDensity }   // 'dark'|'any'|'light', 'sparse'|'any'|'busy'
}
```

**Existing files must migrate, not throw.** `radioPace` is already on disk as a top-level field
for anyone running 1.3.0. `loadDiscoverSettings` reads `parsed.radio` when present and otherwise
builds it from the legacy top-level `parsed.radioPace`, through the same `normalizeRadioPace`
shape that already exists — an unrecognised value becomes the default rather than throwing,
exactly as `normalizeTraitMatchBar` and `normalizeRadioPace` already do.

Nesting also collapses the prop threading. Today `radioPace` and `onRadioPaceChange` are threaded
individually through `App.tsx` → `LibraryBrowser.tsx` → `DiscoverPanel.tsx`; eight settings that
way is sixteen props. One `radioSettings` object plus one
`onRadioSettingsChange(patch: Partial<RadioSettings>)` is two, and it routes through App's
existing merging `updateDiscoverSettings` — which exists because "saving a partial object used to
be fine with one field, but would silently wipe `traitMatchBar`" (App.tsx:1656-1658).

---

## 10. What ships, in what order

Sequenced so each stop leaves the app working and useful, and so **the thing he actually
complained about does not wait behind the thing that is most fun to build.**

| phase | what | where |
|---|---|---|
| **A** | §1 the grid + §2 the retuned paces. No setting, no UI. | this plan, first, **alone** |
| **B** | §4 drop-outs, at `rare`. No setting, no UI. | this plan |
| **C** | §9 the menu; §3 the grid, §4.4 the drop-out rate and §2A the channel count become chips; the settings migrate | this plan |
| **D** | §6 turnover + the hook | this plan |
| **E** | §5.2 transitions, the one-stem palette | this plan |
| **F** | §7 reach | its own plan |
| **G** | §7A character **and** §8 `more like this` — one plan, because they need the same widening (§7A.5) | its own spec + plan |
| **H** | §5.4 two-stem transitions, then §5.5 pre-rendered one-shots | its own spec + plan |

Phases A and B ship **no setting and no UI at all**, deliberately: both are changes of default
behaviour that he can hear by pressing the button he already has, and neither needs a decision
from him first. Making them configurable is Phase C's job, once there is somewhere to put the
chips. The stated risk is that B is more intrusive than A — but at `rare` it is one event every
two minutes, and if that is still wrong it is one phase away from being a chip whose first value
is `off`.

D comes before E because the hook is the thing a drop-out must never drop (§4.5), because both are
pure `src/shared/` logic with no engine question attached, and because §2A's channel slider makes
the drought worse in exactly the way `even` fixes.

F, G and H are separated for engineering reasons, not length: G's shape depends on a measurement
nobody has taken (§8.7), and H depends on the three 1:1 assumptions in §5.4 which each need their
own care.

---

## 11. Not now

Named so they stay named. Anything not on this list and not above is out.

- **The breakdown** — mute everything but the hook, then rebuild. §4.7; deserves its own design.
- **Dropping out a `lead` or a trait-only layer.** §4.1.
- **A change that deliberately lands mid-drop-out.** §4.6; needs the two-stem machinery.
- **Crossfade, filter out, overlap.** §5.4. Not the interesting ones.
- **Reverse tail, tape stop, stutter.** §5.5. `tape stop` is the fun one and it still waits.
- **Delay throws, pitch risers on the stem, any new real-time DSP.** §5.6.
- **A custom pace window** (a slider in bars). §2.
- **Per-slot pace.** Carried over from 2026-09-26 and still out.
- **Per-kind transition UI** — the weights do this without a matrix. §5.3.
- **The hook pulling other layers toward it.** §6.5 — designed, costed, waiting.
- **More than one hook.** §6.4.
- **An `upbeat ↔ downbeat` character axis.** §7A.2 — no feature measures onset *placement*, and
  adding one bumps `STEM_FEATURE_VERSION` and triggers a full library rescan.
- **A `bassHeavy` character axis.** §7A.1 — incoherent as a global bias; it lives per-slot as
  `chonky`.
- **A cap on how many slots Discover allows.** §2A — there is none today and none is being added.
- **A persisted taste model.** §8.4.
- **`more like this` on the phone.** The phone re-renders a file per change (2026-09-26 spec 3.7);
  the nudge belongs where the live engine is.
- **Radio rerolling kinds**, not just stems. Still out.
- **More than one layer per change**, or a "change everything" pace. Still out.
- **Undo for radio changes.** §12; the padlock and now the hook are the tools.
- **A history of what radio played**, and a "put the last one back" button.
- **A highlight on the row that just changed.** Still out, and §8.2 depends on it staying out.
- **Sample-accurate swaps.** Needs engine-side scheduling. Still out.
- **Radio over a real arrangement**, outside Discover.
- **Key/scale awareness.** Discover still has none.

## 12. Constraints that do not move

- **Radio writes no undo history.** `rerollSlot`, `rerollRandomSlot` and `swapSlotFromNearby` all
  call `pushUndoSnapshot()`; radio commits through `commitSlotPick` directly, exactly as
  `rerollAll` bypasses `rerollSlot` to take one snapshot for a whole batch. Firing every few bars
  would fill the stack and make Cmd+Z useless for the edits he made by hand. **A drop-out and a
  transition write no history either** — they are not edits, they are performance. **And the reach
  operations in §7 must be pick-only variants for this reason**, since all three shipped entry
  points commit and two of them snapshot.
- **Eligibility now lives in one place, and nothing here moves it.** While this was being
  written, `isRadioEligibleSlot` (`src/shared/radioSchedule.ts`) was extracted as the single
  predicate, fixing a live report — *"if i start radio with stems already there.. it seems to not
  transition"*. The old inline filter tested `s.candidate !== null`, which is false for every slot
  seeded from a rifff or the shelf and never since rerolled, so starting radio on a loop he had
  already built made every layer ineligible and radio idled forever with no way to tell that apart
  from a long interval. **Everything in this document weights *within* the eligible set or changes
  *when* it is consulted; nothing adds or removes an eligibility condition.** The one exception is
  the drop-out, which has its own, deliberately different rule (§4.1, §4.5 — notably it *includes*
  locked slots).
- **The shipped eligibility conditions**: unlocked ∧ audible ∧ has a candidate or a seed stem ∧
  not mid-roll, never the
  same slot twice running. The grid changes *when*; turnover and the hook change the *weights
  within* the eligible set; reach changes *what is fetched*; a transition changes *how it sounds*;
  a drop-out touches no candidate at all and has its own, different eligibility (§4.1, §4.5 — note
  it deliberately includes locked slots).
- **`vitest.config.ts` is not touched.** `discoverSettingsStore.ts` is a plain JSON file and opens
  no database; the CI exclusion list exists because better-sqlite3 crashes vitest workers on
  GitHub's macOS runners, and nothing here opens one.
- **No `native-engine/` changes in any phase**, including every transition — established by
  reading it (§0), not assumed. `EngineProject` and `buildEngineProject.ts` are a hand-synced pair
  and **neither changes**: every transition here uses fields that are already on the wire and
  already parsed.

## 13. Testing, honestly

- `src/shared/radioSchedule.ts` is pure and TDD'd, as `src/shared/` is by convention here. The
  grid math, the retuned windows, the staleness weighting and the hook divisor all live there and
  all take an injected `random: () => number`. **The drought from §6.1 gets a real test**: a seeded
  generator under which the old uniform draw strands one slot for seven consecutive picks, and
  under which `even` does not.
- Two new pure modules, both TDD'd: `src/shared/radioDropOut.ts` (which layer, how long, how
  often, the curve, every guard from §4.5) and `src/shared/radioTransition.ts` (the
  temperament-times-kind weighting from §5.3, and the curve builders).
- **A curve is a value, which is what makes the hard requirement testable.** `AutomationPoint[]`
  is plain data, so "a two-beat drop-out on an 8-bar loop returns to full gain at bar 0 and leaves
  at bar 7.5" is an exact `toEqual`, not a timing observation. **Every §0A claim about where a
  gesture lands is asserted on the curve**, in `src/shared/`, with no engine and no clock
  involved. The timing budget itself (block quantisation, the 15 ms smoother) is a property of
  already-shipped, already-tested engine code and is not re-tested here.
- `discoverSettingsStore.ts` gains a nested object and a migration from the legacy flat
  `radioPace`. Both are tested in its existing test file, which asserts whole objects with
  `toEqual` — **every existing assertion in it breaks and must be updated**, not worked around.
- **`DiscoverPanel.tsx` and `DiscoverRadioMenu.tsx` are React components and are not unit-tested
  in this codebase.** The menu, the hook toggle, the chips, the clock wiring, the drop-out's
  live-param calls and the transition arm/clear cycle are verified by `npm run typecheck`,
  `npm run lint`, the full suite staying green, and then by Elling actually listening to it. This
  environment has no GUI or audio tooling. **Nobody working this plan may claim radio was heard,
  that a button was clicked, or that a timing was observed.**
