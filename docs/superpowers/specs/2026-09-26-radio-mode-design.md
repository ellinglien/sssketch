# Radio mode — Discover, with a clock

Date: 2026-09-26
Status: drafted from Elling's one-line brief, grounded against the real code; awaiting his walkthrough

## What he asked for

> "what about a radio mode --- kind of like discovery, layers and layers of stems from the
> library, play them for x bars .. something kinda like that"

Then: brainstorm it and start building. So this has to be executable tonight, not admired.

The shape put back to him, which he did not object to, and which this spec takes as its starting
point rather than as gospel:

> Radio is **Discover with a clock**: the slots that already exist, but every so often one
> rerolls on its own.

Everything below is an argument for how little has to be built to get that, and an honest
account of the one hard question underneath it (what "every x bars" actually counts against).

**The shortest true summary of this feature: Discover, plus a scheduler, plus a pin flag — and
the pin flag already exists.** If that sounds too small to be a feature, that is the point.

---

## 1. What already exists, and what that means

Discover today is a panel of **slots**. `DiscoverSlot` (`DiscoverPanel.tsx:154`) carries
`kinds`, `locked`, `candidate`, `gain`, `hasRerolled`. Slots roll through `rollForSlot(id,
kinds)` (`DiscoverPanel.tsx:1679`): one `getDiscoverCandidates` IPC call, a
dedupe-against-other-slots pass, `applyTraitBar`, `rankCandidates` (against `state.bpm`), then
`pickReroll(ranked, chaos)`. `rerollAll()` (`:1901`) walks every slot and **skips the locked
ones**. All of it stays exactly as it is.

Four things fall out of reading that code, and all four of them are gifts:

### 1.1 Pinning already shipped. It is called `locked`.

The instinct radio creates — *"keep that bassline, change the rest"* — is `slot.locked`, the
padlock already on every row (`DiscoverPanel.tsx:3661`, tooltip `lock`/`unlock`), already
honoured by `rerollAll`. **Radio honours it the same way and adds no UI at all.** This is the
single largest piece of the feature and it costs nothing.

What radio changes is not the mechanism but the *stakes*: today lock means "leave this alone
when I hit the dice"; with radio running it means "this is the part of the loop I have decided
on." Same flag, and it needs no new copy to say so.

### 1.2 A layer can be swapped without restarting the loop. That was fought for already.

`syncPreviewToEngine` (`DiscoverPanel.tsx:722`) rebuilds the whole throwaway preview project and
sends it with `engineLoadProject`, but the seek-to-zero-and-play is gated behind
`if (!previewLoadedRef.current)` (`:887`). A rebuild of an **already-loaded** preview just keeps
playing through it. The engine's `Transport` is not restarted; `positionBars` is untouched.

More than that: `reportSlotResolution`'s `null` branch (`:1002-1026`) is a deliberate no-op
precisely so a slot **keeps playing its last resolved stem through the whole reroll window**
instead of dropping out and back in. The comment quotes Elling: *"imagine it a live composition
tool... ensure it's smooth and doesn't interrupt the flow."*

That work was done in September for hand-clicked rerolls. Radio is the feature it was secretly
for.

### 1.3 The loop's own bar length is already computed, twice.

`maxBarLength` = `Math.max(...resolvedBarLengthsRef.current.values())`, computed in
`syncPreviewToEngine` (`:812`) and again for the playhead (`:2610`). It is deliberately taken
over **every resolved slot, not just the audible ones**, so muting does not resize the loop —
and it is what goes to the engine as `loopLengthBars`. So the loop length in bars is a value
this panel already holds.

### 1.4 The playhead position, in bars, is already in this component.

This is the answer to the hard question, and it is in section 2.

---

## 2. The hard question: what does "every x bars" count against?

Honestly answered, because a wrong answer here is the difference between radio feeling like a
musician and radio feeling like a kitchen timer.

### 2.1 There is no bar event. There is a 30 Hz position stream, and it is enough.

`IpcServer.cpp` starts a 33 ms timer on `"play"` (`kPositionTimerId`, `IpcServer.cpp:283`) and
pushes `{"type":"position-update","payload":{"pos": transport.currentPositionBars()}}`
(`:168-173`). Main relays it (`index.ts:1756-1762`, `subscribeToPositionUpdates`), preload
bridges it (`onEnginePositionUpdate`, `preload/index.ts:485`), and `StoreContext.tsx:969-973`
does this:

```ts
const owner = engineOwnershipRef.current.current
if (owner === 'discover-preview' || owner === 'tidy-up-library-preview') {
  dispatch({ type: 'SET_POS', pos })
  return
}
```

— i.e. while Discover owns the engine, the engine's own already-wrapped bar position is written
**verbatim** into `state.pos`, deliberately skipping the renderer-side wrap that belongs to the
real arrangement.

And `DiscoverPanel.tsx:396` already reads it: `const pos = usePos()`, with a doc comment that
says outright *"while a Discover preview is loaded, this IS the preview loop's own position."*
It is already used to draw `playheadPct` (`:2610-2618`).

**So: `(pos, maxBarLength)` is "where we are in the loop, in bars, out of N." Both are already
in this component, at 30 Hz, and DiscoverPanel already re-renders at that rate.** Radio's clock
is a `useEffect` keyed on `pos` and costs nothing new.

What does **not** exist, and is not being added:

- No `loop-wrapped` event, no `bar-tick` event. A wrap is observable only as `pos` decreasing
  between two ticks. That is fine — it is unambiguous at 30 Hz against any loop longer than
  ~33 ms.
- No position ticks while paused. The engine stops the timer on `"pause"`. **Radio's clock
  therefore stops when the transport stops, for free, and resumes where it was.** That is the
  correct behaviour and we did not have to write it.
- No engine-side scheduling of a project swap. See 2.3.

### 2.2 The change lands on the loop boundary, not on an arbitrary bar. That is a decision.

`maxBarLength` for a real Discover loop is an Endlesss rifff's bar length — 1, 2, 4, sometimes
8. A change dropped at bar 7 of an 8-bar loop is a splice. A change dropped at the wrap is a new
section.

So: **radio counts bars, and commits at the first loop wrap at or after the count is reached.**
The dial is still in bars, because that is what he asked for, but the effective interval is
`ceil(drawn / loopBars) * loopBars`.

This is not a limitation that got noticed late and rationalised. It is the better musical answer
and it is also the cheaper one, and those coinciding is the reason to take it.

**The cost, stated plainly:** with a long loop and a short pace the quantisation can collapse
the whole window onto one value — an 8-bar loop at `fast` (6–12 bars) always fires at 8, and
radio is metronomic again. Accepted. Endlesss rifffs are usually 1–4 bars, where the window
survives with three or four distinct outcomes. If it bites, the fix is to widen `fast`, not to
abandon the quantisation.

### 2.3 The commit is one frame plus an IPC round trip late. Not sample-accurate. Say so.

The full chain from "radio decides" to "the new stem is audible" is:

`getDiscoverCandidates` (IPC, main-process SQL) → `pickReroll` → `setSlots` →
`DiscoverSlotRow`'s resolve effect → `resolveCandidateStem` (which may *download* the riff) →
`reportSlotResolution` → `scheduleSyncPreviewToEngine` (rAF-coalesced) → `buildEngineProject` →
`engineLoadProject` (IPC).

Fired at the wrap, that lands hundreds of milliseconds — possibly seconds, if the stem has to
download — into the next loop. Unacceptable.

**The fix is prefetch, and it is free because `resolveCandidateStem` is already memoised.**
`resolvedCandidateCache` (`DiscoverPanel.tsx:95`) is a module-level
`Map<string, Promise<ResolvedCandidateStem | null>>` keyed `riffCID:stemCID`. Radio calls
`resolveCandidateStem(candidate)` itself the moment it picks one, and throws the promise away.
By the time it commits the candidate onto the slot, the row's own resolve effect hits a
*settled* promise.

So the real commit latency is: a React render, an rAF, `buildEngineProject`, and one
`engineLoadProject` round trip. Tens of milliseconds. Audibly "on the downbeat", not
sample-accurately on it.

**Making it sample-accurate would need a native-engine change** — a "swap this project at bar
N" message and a scheduled `setProject` in `Transport`. That is a real feature with real
value and it is **explicitly out of scope**. What it would buy: the difference between a swap
that lands a hair late and one that lands exactly. What it would cost: the C++ boundary, a
rebuild-and-relaunch loop with no automated test for the thing being changed, and a wire-format
change across the hand-synced `EngineProject` / `buildEngineProject.ts` pair. Not tonight, and
not for this.

### 2.4 When to prefetch: immediately after the previous change.

Not "two bars before the boundary." As soon as radio commits a change it picks the *next* slot
and the *next* candidate and warms it, then waits out the interval. That gives the prefetch the
entire interval as lead time — 12 to 48 bars, 24 seconds to a minute and a half — which is
enough for a cold stem to download.

The cost of deciding that early: by commit time the world may have moved. The chosen slot may
have been removed, locked, or muted. **At commit, radio re-checks eligibility; if the pending
slot is no longer eligible, it drops the pick and re-picks immediately** — resolving a few
hundred milliseconds late is strictly better than swapping a slot the user just locked.

(The dedupe-against-other-slots pass inside the roll reads `slots` at *pick* time, so it can be
a whole interval stale. That pass is already documented as "a variety heuristic, not a
correctness guarantee" (`:1725-1733`). It stays a heuristic.)

---

## 3. The rest of the decisions

### 3.1 One layer at a time

Everything changing together is just a new loop on a timer. One at a time lets a bed you
recognise evolve under you — which is the entire difference between radio and a shuffle button.

**Eligible** = unlocked **and** currently in the preview mix (`previewingSlotIds`) **and** has a
candidate already **and** is not mid-reroll (`rerollingSlotIds`). A muted slot is not part of
what you are listening to, so changing it would be a change you cannot hear.

**Never the same slot twice running**, when two or more are eligible. Uniform random among the
rest. That is the whole variety rule — a fancier least-recently-changed rotation is *not now*.

If nothing is eligible (everything locked, everything muted, one slot only and it is locked),
radio idles: the clock keeps running, the commit is a no-op, it tries again at the next
boundary. It does not error and it does not switch itself off.

### 3.2 Kinds are respected. A drum layer stays a drum layer.

Radio rerolls through the same `kinds` the slot already has, because it calls the same pick
logic `rerollSlot` does. Free. A mode where radio also rerolls a slot's *kind* — where the
sparkly layer becomes a bassish one — is a different and more chaotic feature. *Not now.*

### 3.3 The interval: a window, not a number

Exactly every N bars reads as mechanical. A change landing somewhere in a window feels like
something is making decisions.

Three paces, each a 2:1 range of bars:

| pace | bars | at 120 bpm, 4/4 |
|---|---|---|
| `slow` | 24–48 | 48 s – 96 s |
| `mid` (default) | 12–24 | 24 s – 48 s |
| `fast` | 6–12 | 12 s – 24 s |

After each change, radio draws a fresh uniform integer in the range. **The 2:1 ratio is the
decision; the absolute numbers are taste.** 2:1 is wide enough that you cannot count along with
it, and narrow enough that it never feels stalled at the top of the range or frantic at the
bottom. A 4:1 range would give you a change at 6 bars and then nothing for 24, which reads as
broken rather than as loose.

`mid` is the default because a radio that changes something every half-minute is the thing he
described.

The pace persists, in `DiscoverSettings` (`discoverSettingsStore.ts` — a plain JSON file in
`userData`, already threaded through `App.tsx`'s `updateDiscoverSettings` merge), because
re-picking it every launch is an annoyance with a four-line fix.

### 3.4 Radio does not write undo history

`rerollSlot` calls `pushUndoSnapshot()`. Radio firing every twenty bars would fill the undo
stack with snapshots nobody asked for and make Cmd+Z useless for the edits the user actually
made by hand.

**So radio does not go through `rerollSlot`.** It goes through the pick-and-commit path
directly — exactly as `rerollAll` already bypasses `rerollSlot` to take one snapshot for a whole
batch (`:1914-1917`).

Consequence, stated rather than hidden: **you cannot undo a radio change.** The tool for "I
liked that one" is the padlock, pressed before it goes. This is the same bargain a real radio
makes and it is why pinning is load-bearing rather than a nicety.

### 3.5 Tempo across jams: reuse, invent nothing

There is no `targetBpm` state anywhere; the identifier appears only as `rankCandidates`'
parameter name, and what is passed is `state.bpm` (`DiscoverPanel.tsx:1747`). That is already
the whole tempo story:

- `rankCandidates({ targetBpm: bpm })` scores every candidate by `|riffBpm - bpm|` against
  `BPM_FALLOFF = 40`, so a wildly-off-tempo stem is unlikely to be drawn at all.
- Whatever is drawn is time-stretched anyway: the preview project sets
  `stretch: { [rifff.groupId]: true }` (`:848`) and `buildEngineProject` recomputes each stem's
  ratio against `bpm` on every call.
- `seedBpm`'s auto-`SET_TEMPO` is gated on `!previewLoadedRef.current` (`:762`), which is
  already `true` whenever radio is running, so **radio can never yank the tempo.**

Radio changes none of this. It is one more caller of a path that already handles it.

### 3.6 Starting from nothing lays down a bed

Radio with zero slots would be a button that does nothing, and the thing he wants is to press
one button and have music happen.

So: **starting radio on an empty panel adds four slots first** — `drums`, `bass`, `lead`,
`warm` — through the existing `addSlot`, which does its own first roll per slot. Four because
it is the smallest set that sounds like a band rather than like a loop.

Radio does not otherwise decide how many layers there are. Add and remove slots while it runs;
it uses whatever is there. Ten layers is a legal radio. (`rerollAll` already has a matching
precedent for the empty case: it adds a slot rather than silently doing nothing —
`:1902-1912`.)

### 3.7 Mac first. The phone is not a radio.

Part 2 of the discovered-library work put a page on the LAN (`remoteServer.ts`,
`remotePage.ts`) that shows Discover's current loop and can roll, keep, add and remove. The Mac
plays live through the engine, so a layer can change underneath a running transport. **The phone
does not.** `setRemoteLoop(project)` hands main a project which it fingerprints and renders to a
file on demand; the phone fetches and plays that file. Every radio change is a new fingerprint,
a new render, and a fresh fetch — a seam every twenty bars.

So: **no radio controls on the phone, and radio is not something the phone can usefully
listen to.** What does keep working, unchanged and for free: the phone's state snapshot
(`setRemoteState`, pushed from the effect at `DiscoverPanel.tsx:1339`) already re-pushes on every
slot change, so the sofa sees what radio did; and `keep` from the phone still catches whatever
is currently up. Radio on the Mac, caught from the sofa, is a real workflow and it needs no code.

### 3.8 `keep` is how you catch one

Unchanged. `keepGroup()` (`:2191`) saves the current group as a rifff in the `discovered` room.
Radio generates candidates; keep is how you catch one. Radio does not pause on keep and does not
need to — `keep` reads the group as it is at the instant it is pressed, and if a layer turns
over a second later the saved group is still the one you heard.

---

## 4. What it looks like

Tokens are the law (`styles/tokens.css`): near-black monochrome, Silkscreen, no `border-radius`,
lowercase copy, no emoji, no exclamation marks, colour only on things carrying audio
information. Tooltips two or three words. Buttons two words maximum, or an icon.

Three additions, all in the Discover actions row (`DiscoverPanel.tsx:2318`, the row that holds
the dice, `keep`, `add to shelf`, `add to timeline`):

1. **A `radio` toggle button**, left of the dice. Off: transparent, `--ra-border-strong`,
   `--ra-text`. On: `--ra-play-on` / `--ra-play-on-ink`, exactly like the existing play/stop
   button at `:2357` — the transport is audio information and so is this. Label `radio` both
   ways; the lit state says the rest. Tooltip `auto reroll`.

2. **Three pace chips** — `slow`, `mid`, `fast` — shown only while radio is on, so the row is
   unchanged for anyone not using it. The selected one gets `--ra-bg-row-active`; the others are
   flat. No tooltip: the labels are the whole meaning.

3. **A 2 px progress rule** directly under the radio button, width tracking the fraction of the
   current interval elapsed, `--ra-text-3` on `--ra-border`. Monochrome, deliberately — this is
   chrome, not audio information. It exists because knowing a change is coming is most of the
   pleasure, and because a number that jitters at 30 Hz is worse than a line that does.

Nothing else. No new panel, no new row, no badge on the slot that changed, no countdown text.

---

## 5. Not now

Named so they stay named, and so that anything not on this list and not above is out:

- **Radio on the phone.** Seams, per 3.7.
- **Sample-accurate swaps.** Needs native-engine scheduling. Per 2.3.
- **Crossfading a swap.** The engine's `FadeGain` anti-click micro-fade is all there is; a real
  crossfade between two projects is an engine feature.
- **Radio rerolling kinds**, not just stems.
- **More than one layer per change**, or a "change everything" pace.
- **A least-recently-changed rotation.** Uniform-minus-the-last-one is enough.
- **Per-slot pace** — a layer that turns over faster than the others.
- **Undo for radio changes.** Per 3.4; lock is the tool.
- **A history of what radio played**, and a "put the last one back" button.
- **Auto-keep** when a group survives N changes without being touched.
- **Radio over a real arrangement**, outside Discover.
- **Key/scale awareness.** Discover has none today (a kept group is saved with `Root`/`Scale`
  NULL, deliberately); radio inherits that and does not fix it.
- **A highlight on the row that just changed.**

## 6. Known limits, accepted on purpose

- **A long loop at a fast pace is metronomic**, per 2.2.
- **The commit is tens of milliseconds late**, per 2.3.
- **A radio change is not undoable**, per 3.4.
- **The next pick is decided a whole interval in advance**, so its dedupe-against-other-slots
  pass is stale by up to that long, per 2.4. Already a heuristic.
- **A prefetched stem that fails to resolve** (network, since-deleted riff) leaves
  `resolveCandidateStem` returning `null` and deleting its own cache entry; the slot keeps its
  previous stem and radio simply tries again at the next boundary. No error surfaces. That is
  the same degradation every other Discover path already takes.
- **Radio keeps rolling with nothing eligible**, per 3.1, rather than switching itself off. A
  user who locks everything and wonders why nothing changes has locked everything.

## 7. No native-engine changes

Nothing in this design reaches `native-engine/`. Confirmed by reading it: the engine already
pushes `position-update` in bars at 30 Hz and already wraps its own clock against
`loopLengthBars`, which for a Discover preview is the preview rifff's own `barLength`. Radio
needs a clock and a scheduler, and both are renderer-side.

`EngineProject` and `buildEngineProject.ts` are a hand-synced pair and **neither changes.**

## 8. Testing, honestly

- `src/shared/radioSchedule.ts` is pure — the paces, the interval draw, the bar clock, the slot
  choice — and is TDD'd, as `src/shared/` is by convention here.
- `discoverSettingsStore.ts` gains one field, tested in its existing test file. It is a JSON
  file, not SQLite, so nothing changes in `vitest.config.ts`'s CI exclusion list.
- **`DiscoverPanel.tsx` is a React component and is not unit-tested in this codebase.** The
  radio button, the pace chips, the clock effect and the prefetch are verified by `npm run
  typecheck`, `npm run lint`, the full suite staying green, and then by Elling actually
  listening to it. This environment has no GUI or audio tooling. Nobody working this plan may
  claim radio was heard.
