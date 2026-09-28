# Performance mode — the machine offers, the hand chooses

Date: 2026-09-28
Status: drafted against the real code, the same day as
`docs/superpowers/specs/2026-09-28-radio-controls-design.md` and deliberately downstream of it;
awaiting Elling's review

## What he said

> "i'm pretty excited about this... i think this could even become a live performance thing...
> with a 'queue' of upcoming stems presented to the user to preview, and then selecting the next
> one, and having the radio handle the transitions ... or having a 'transition at next wrap'
> trigger or something."

## The one-sentence difference

**Radio is "leave it running". Performance mode is "play it".**

Radio is an autopilot: while the Discover preview plays, one unlocked audible layer rerolls itself
every so often and the user watches. Performance mode inverts the verbs. The machine still does
all the finding — that is the part a human cannot do at 45,000 stems — but the *choosing* moves to
the hand, and the machine's remaining job is to execute the change cleanly on the top of the loop.

The reference is Ableton's Session View with launch quantisation, with one thing changed: **the
clip slots fill themselves.** You are never hunting. Something is always on deck.

They share almost all their machinery. They are not the same product, and this document says
which behaviours belong to which. **Performance mode is a mode of Discover, not a pile of options
bolted onto radio** — the radio menu (`2026-09-28-radio-controls-design.md` §9) is where radio's
*taste* is configured, and nothing in this document goes in it.

---

## 0. The four verdicts, up front

Each of these was established by reading the code. They decide the shape of everything below, so
they go first.

### 0.1 The queue is mostly already there. It is a display problem.

`armRadioPick` (`DiscoverPanel.tsx:2293-2311`) already:

- picks the next slot (`pickRadioSlotId`),
- calls `pickForSlot` for it — the full candidate fetch, trait bar, BPM rank and pick,
- **warms the stem** by calling `resolveCandidateStem(pick.candidate)` and throwing the promise
  away, so the module-level `resolvedCandidateCache` holds a settled promise by the time the
  change lands,
- and parks the result in `radioPendingRef`.

It does this **a whole interval early**, which is 12–48 bars today and 2–36 bars after the other
spec's retune. There is already a warmed, ranked, ready next-thing sitting in a ref that nothing
renders.

**So the deck is not a new scheduler. It is `radioPendingRef`, made visible, and made per-slot
instead of one global.** That is the single most important cost finding in this document.

### 0.2 The wrap is already the trigger, and the two specs do not collide there

`advanceRadioClock` (`src/shared/radioSchedule.ts:95-118`) returns a step with **two independent
booleans**:

```ts
export interface RadioClockStep {
  clock: RadioClock
  wrapped: boolean   // the loop restarted between the previous tick and this one
  due: boolean       // wrapped && barsElapsed >= intervalBars
}
```

The radio-controls spec's §1.3 changes **`due` only** — it widens the gate from the whole loop's
wrap to the changing slot's own bar grid, and the signature becomes
`advanceRadioClock(clock, pos, loopBars, gridBars?)`. **`wrapped` survives untouched**, and it
still means exactly one thing: the preview loop restarted. Its own plan
(`docs/superpowers/plans/2026-09-28-radio-controls.md`, Task 8) already reads `step.wrapped`
directly to place a drop-out, so this is precedent rather than invention.

**Performance mode lands on `wrapped`. Radio lands on `due`.** That is the whole interface between
the two features, it is one field each, and neither has to know about the other.

This is also the musically correct split and it is the same argument the other spec makes at its
§0A.4: an 8-bar loop has eight downbeats and one place where the phrase restarts, and the re-one
tool exists precisely so that position 0 is a downbeat Elling curated by hand. **A gesture you
made with your hand lands on the one.** Radio's interval may land wherever the grid allows; a
human launch may not.

### 0.3 Performance mode introduces no new audio timing mechanism at all

The other spec's §0A is a long, load-bearing argument that **a rhythmic gesture fired from the
React tick is audibly wrong** — `pos` arrives at 30 Hz, and a drop-out that returns 40 ms late
sounds like a fault rather than arrangement. Its conclusion: a gesture must be expressed as
automation the engine already holds, armed a lap ahead.

**Read that verdict; do not re-derive it.** Performance mode obeys it by adding nothing:

- **A landing is a stem change, not a gesture.** The other spec says so explicitly at §0A.1: *"For
  a stem change that is forgivable: a new texture arriving 40 ms late still reads as arriving."*
  Radio already commits stem changes from the tick and that shipped. A launched change takes the
  exact same path — `commitSlotPick` → `setSlots` → `syncPreviewToEngine` → `load-project` — and
  inherits the exact same accepted lateness. No new claim is being made.
- **A transition is a gesture, and performance mode does not build one.** When the other spec's
  §5 transitions ship, a launched change gets whatever transition radio would have given the same
  change, through the same `previewState.stemAutomation` / `previewState.risers` arming.
  Performance mode chooses *which stem*; it never chooses *how the edge sounds*. Picking a
  transition per card is on the **not now** list.

So: **no `native-engine/` change, and no new scheduling primitive.** The one place this document
does touch the engine question is auditioning, and the answer there is no as well — §2.

### 0.4 Master plugin FX already process the Discover and radio preview

> "also would be great to have master effects on the whole radio or discover system... or have the
> master fx in the app affect that section too"

**Half of this already works, and it works better than "copied into the preview" would suggest.**
Three independent pieces of evidence:

- `Transport.cpp:581-582` and `:614-615` call `masterChain.process(numSamples, outL, outR)` on the
  summed output **unconditionally, for whatever project is loaded.** The Discover preview goes
  through the engine's own mixer, so it goes through the master chain.
- `load-project` **parses `masterChain` and then never applies it** (`IpcServer.cpp:220-273` calls
  only `setBpm`, `setLoopLengthBars`, `setProject`, `clearAll`, `updateChannelSet`, `setBpm`).
  Master plugins are loaded by their own `load-master-plugin` message (`:710`). **So the preview
  never reloads them and their live parameter state is preserved** — a reverb you tweaked by hand
  is still exactly as you left it when the preview starts.
- The master-chain effect in `StoreContext.tsx:776-796` is **not** ownership-gated, unlike
  `scheduleEngineSync` (`:575,586`). **So editing the master chain while the preview plays takes
  effect immediately.**

`DiscoverPanel.tsx:759-762` already says so in a doc comment. **He may simply not have realised.**

**Two real caveats, and they are the actual bug half of the request:**

1. **Channel FX do *not* reach the preview, although that same comment claims they do.** It says
   *"master/channel FX are audibly applied while auditioning too"*. The channel half is wrong:
   `channelId = state.channelOf[rifff.groupId] ?? rifff.groupId` (`buildEngineProject.ts:577`),
   the preview's `groupId` is a fresh `crypto.randomUUID()` minted per sync
   (`discoverRifffAssembly.ts:107`), and `previewState.channelOf` is `{}` because it comes from
   `initialState` — so the preview's channel id matches **no key** in `channelPlugins` and
   `channelChains.updateChannelSet([thatId])` gives it an empty chain. Copying `channelPlugins`
   into `previewState` has no effect at all.
2. **The project's reverb settings do not reach it either.** `previewState` is
   `{ ...initialState, bpm, masterChain, channelPlugins, rifffs, vol, stretch }` — `state.reverb`
   is not in that list, so the preview uses `DEFAULT_REVERB` rather than the project's room size,
   damping and pre-delay. **One more word in that spread fixes it**, and §4A needs it anyway.

---

## 1. The deck

### 1.1 Per slot, not one shared queue

Rejected: a single "up next" queue of three cards for the whole mix.

- A card with no slot has **no kind**. Discover's entire candidate pipeline is keyed on a slot's
  `kinds` (`slotKindsKey` decides the SQL pool before any ranking runs). A shared queue would have
  to invent a kind for each card, and then the user would have to say where it goes — two
  decisions where the point of the feature is to reduce it to one.
- **The big performance move is impossible with a shared queue.** "A whole new bed lands together"
  means arming several slots at once. A shared queue can only launch one thing at a time by
  construction.
- A card sitting under its own row already answers *where does it go* without a word of UI.

So: **one deck per slot.** In slot order, directly under each slot row.

### 1.2 Depth one, with `skip` — and why not three

Phase 1 ships **one card per slot**: literally the pick radio already made, rendered.

The argument for depth 1 is that **`skip` gets you most of what depth 3 gets you.** If you do not
like what is on deck, tap `skip` and a fresh one arrives — `pickForSlot` plus a warm, exactly what
`armRadioPick` already does, typically a few hundred milliseconds. Depth only saves you the wait,
and it costs a candidate fetch, a resolve and a decode per extra card per slot, multiplied by
however many slots are open.

Depth **2** is a later phase (§7, phase 3) and **2 is the cap.** Three cards across four slots is
twelve stems on screen, which is not a deck, it is a library browser — and Discover already has
one of those.

### 1.3 Where candidates come from, and refill

The same place radio's do: `pickForSlot(slotId, slot.kinds)` (`DiscoverPanel.tsx:1971`) — the
candidate query, the trait bar, `rankCandidates`, `pickReroll`. **No second ranking, no second
pool, no "performance-only" scoring.** Whatever the radio-controls spec's §7 `reach` setting ends
up doing to that call, the deck inherits for free, because it is the same call.

A slot's card is refilled immediately whenever it empties — on `arm` (the card leaves the deck to
land), on `skip`, and on the card landing. Refilling immediately rather than at the next boundary
is the whole lead-time argument from `armRadioPick`'s own doc comment: the warm needs the gap.

**Entering performance mode fires one `pickForSlot` per slot, concurrently.** That is N candidate
queries at once against a ~45,000-stem library. It is not new: `rerollAll`
(`DiscoverPanel.tsx:2253-2262`) already awaits `rollForSlot` for every unlocked slot, and the
`similar all` button in the actions row does exactly this today. The pattern is shipped. It is
named here so nobody is surprised by a burst of queries on the mode toggle.

### 1.4 What a card shows

Four things, and all four already render elsewhere on the same screen:

| on the card | where it already comes from |
|---|---|
| the stem's name | `candidate.presetName`, the row's own label |
| its kind | `slotKindsLabel(slot.kinds)` / the resolved stem's sound type |
| its waveform | `<Waveform path={…} color={typeColorVar(stem.type)} />` (`Waveform.tsx:12`) |
| the trait bars | `buildMatchMeter` (`@shared/discoverMatchMeter`, used at `DiscoverPanel.tsx:3836`) |

**No new visual vocabulary.** A card is a slot row's own information at card size. The trait bars
are on it because they are the one thing that answers "will this fit" without hearing it, which in
phase 1 is the only answer available at all (§2).

### 1.5 Where it lives on screen

Three options, two rejected:

- **Inside the slot row.** Not possible. The row is a 15-track grid with explicit `gridColumn` on
  every child and a long doc comment (`DiscoverPanel.tsx:4067-4105`) about the class of bug that
  renumbering it causes, and the radio-controls spec is already claiming track 6 — the 14 px
  spacer — for its `hook` / `more` / `less` strip. There is no room and taking some would collide.
- **A top-level mode** beside `sketch` / `arrange` / `map` (`App.tsx:424,2662`). Wrong category:
  those three are modes of the **timeline**. Discover is a panel over everything, and performance
  mode is a mode of Discover. Promoting it would mean Discover-in-a-timeline-mode, which is not a
  thing this app has.
- **Phone only.** Wrong as the *first* move, right as a later one. Making the whole feature depend
  on the phone stack means Elling cannot iterate on it at the desk, and the phone is the surface
  most likely to need several passes.

**Decision: each slot gets an expanded sub-row holding its card.** `--ra-bg-row-sub` (`#0e0e0e`)
already exists in `tokens.css` and is documented there as "expanded stem sub-row" — this is the
codebase's own idiom for exactly this, not a new one. Performance mode expands every slot's
sub-row; leaving it collapses them all. **Nothing in the slot row itself moves**, which is the
only property that keeps this from fighting the other spec.

Depth 2 later puts two cards side by side in the same sub-row. No layout change when it arrives.

---

## 2. Auditioning — the honest section, and it is the crux

This is where the feature is either cheap or expensive, so it gets the most words and the plainest
ones.

### 2.1 `useThrowawayStemPreview` is not it, and it is worth saying why loudly

It was worth reading, and the answer is no. `src/renderer/src/state/useThrowawayStemPreview.ts`
does **the opposite** of pre-listen:

- it calls `claimEngine('tidy-up-library-preview')` — an **exclusive** ownership token,
- it builds `previewState` from `initialState` with `rifffs` **entirely replaced** by one throwaway
  rifff,
- it calls `engineLoadProject` and `dispatch({ type: 'PLAY' })`.

Its own doc comment states the invariant as a requirement rather than a limitation:

> *"each audition hands the engine a project containing exactly the stems being auditioned and
> nothing else, and starting one stops the previous one entirely. … Neither path may regress to
> letting a previous audition ring on underneath a new one"* — a real reported bug ("tidy up often
> plays multiple stems at once").

Using it to audition a candidate would **stop the live mix**. It is a solo-in-isolation path,
deliberately, and pre-listen is the one thing it is designed not to be. **The hardest piece is not
already solved by this route.**

### 2.2 The engine cannot cue, and that is a project of its own

Verified by reading `native-engine/Source/`:

- There is exactly **one** `AudioDeviceManager` in the whole engine (`Transport.h:224`), opened
  with `deviceManager.initialiseWithDefaultDevices(1, 2)` (`Transport.cpp:49`) — one input, **two**
  outputs, the only place an output channel count is ever requested.
- The device callback **bails below two channels and never touches a third**
  (`Transport.cpp:450-454`): it grabs `outputChannelData[0]` and `[1]` and returns early
  otherwise. Channels 2+ are never written, never cleared, never referenced.
- Every channel's audio is summed **unconditionally into the single master pair**
  (`PlaybackEngine.cpp:668-680`), then the reverb wet on top (`:684`), then the master chain
  (`Transport.cpp:581,614`). `ChannelChainRegistry` is a plugin-insert registry, not a routing
  matrix, and `PluginChain::process(int, float*, float*)` (`PluginChain.h:150`) is hard stereo.
- One `PlaybackEngine`, one `Transport`, one project, one playhead (`Main.cpp:239-252`).
- Zero occurrences of `cue`, `pre-listen`, `audition`, `monitor bus` or `aux` in any C++ source.
  Not even a stub.
- Of the **29** message types `IpcServer.cpp` dispatches, `set-output-device`
  (`IpcServer.cpp:377`) takes a device **name** and nothing else — no channel pair, no bus.

> ### Adding a cue bus to the engine is not a flag. It is a signature change to `PlaybackEngine::renderBlock`, `Transport::renderLoopAware` and its six call sites, the device callback, `openDefaultDevice`, `setOutputDevice`, `ReverbBus::endBlock`, `PluginChain::process` and `RenderExport.cpp` — plus a new per-stem routing field through the hand-synced `EngineProject` / `buildEngineProject.ts` pair.

Flagging that loudly, as the brief asked: the engine **does not hot-reload**, so every iteration
on it is a `cmake --build`, a Cmd+Q and a relaunch, and there is no automated test for the thing
being changed. **It is not in this design, in any phase.**

### 2.3 But a cue does not need the engine, and the path is already shipped

The renderer has a complete, independent, second audio path that is in daily use:

- `getAudioContext()` (`src/renderer/src/audio/peakCache.ts:171`) — one shared `AudioContext`.
- `startPreviewLoop(ctx, stems, isCancelled)`
  (`src/renderer/src/audio/previewLoop.ts`) — decodes every stem in parallel, starts them in one
  synchronous pass (its doc comment is about the desync bug that staggering caused), bakes a loop
  micro-fade, pins `loopStart`/`loopEnd` to `durationSec` so two stems of the same bar length
  cannot drift apart, and returns the sources.
- `stopPreviewSources`, plus a module-level single-active-preview registry so a new preview always
  supersedes an old one.

Shelf, LibraryBrowser, ProjectLibraryBrowser and BeatPicker all play audio through it today. **It
goes to the system default output. The engine goes wherever `set-output-device` was pointed.**

And the app already ships the UI for pointing it: `AudioDeviceModal.tsx`, the TransportBar settings
menu (`TransportBar.tsx:409,1049`), over `engine-list-output-devices` / `engine-set-output-device`
(`src/preload/index.ts:256,260`).

> **So the cue is: point the engine at the interface feeding the room, leave the system default as
> the headphones, and press `cue` on a card.** Two separate devices, already separately
> addressable, with no engine work, no `setSinkId`, no device permission prompt and no new IPC.

This is the answer to the brief's question, and it is a real one. Four limits, each stated rather
than discovered later:

1. **It is not phase-locked.** `source.start(0)` begins now; the engine is somewhere else in its
   lap. The renderer knows `pos` in bars at 30 Hz, so the cue starts at the matching offset
   (`source.start(0, offsetSec)`) and re-anchors on every wrap the tick reports, which bounds the
   drift to one lap. That puts it within a tick — about 33 ms, plus the `AudioContext`'s own output
   latency. **Good enough to judge what a stem is and whether it fits. Not good enough to judge
   whether it is tight.** Say that in the tooltip's spirit and never claim otherwise.
2. **It must play the stretched file.** The engine time-stretches stems to the project tempo;
   `previewLoop.ts` plays a decoded file as-is. The cue resolves through the same
   `resolveStretchedForPlayback` the preview already uses (`useThrowawayStemPreview.ts` imports it),
   and passes `durationSec` so the loop point is bar-exact. Skip this and every cue is at the wrong
   tempo — which is the single most likely way to build this and have it be useless.
3. **No plugins, no reverb, no master chain.** The cue is the raw stem, not the stem as the mix
   will render it. That is acceptable: you are deciding *which* stem, not mastering it.
4. **One output device is a footgun.** With the engine on the default device, a cue comes out of
   the same speakers as the mix and the audience hears it. The answer is that **`cue` is off by
   default and turned on by one chip**, with the tooltip `second output only`. Auto-detecting the
   condition would mean reading the system default's identity from the renderer, which needs
   `enumerateDevices` labels, which needs a permission this app has never asked the renderer for —
   **so it is not designed here on an unverified behaviour.** A chip the performer sets once while
   soundchecking is honest and costs nothing.

### 2.4 The phone is the other cue device, and in one way the better one

It is a device already in the performer's hand with headphones already in it. And the machinery is
there: since 2026-09-27 the phone **holds every stem as its own decoded buffer and mixes them in
Web Audio** (`2026-09-27-phone-per-stem-mixer-design.md`, shipped) — its own `AudioContext`, its own
`GainNode` per stem, its own output. Adding a candidate as a phone-only voice is `remotePage.ts`
plus `remoteStemRenderer.ts` plus one route, and **no engine work either.**

The caveat is worse there, not better, and it is written down in the code: `remotePage.ts:1294`
— *"Nothing about its position comes from the Mac: no position messages, no clock sync"* — and
`:2144` — *"state.playing is the MAC's transport, shown and never obeyed."* The phone runs a
faithful copy of the mix on **its own** clock from one fixed `origin`. In closed headphones that is
internally coherent and perfectly usable. Against the room in one ear it will flange.

**Phase 5, and a phase rather than a prerequisite.**

### 2.5 What phase 1 does instead, and why it is still worth using

Phase 1 has no pre-listen. That is a real gap and the design does not paper over it. It closes the
gap from the other end:

**`put back`.** When a slot lands a change, its row offers `put back` until the next wrap: one tap
re-commits the stem that was there. Cost is one remembered field per slot — the outgoing
`candidate` (or `seedStem`) — committed through `commitSlotPick` like everything else.

That turns the phase-1 loop into **offer → choose → land → keep or put back**, which is a real
instrument. Crude, as the brief asked for, and performable: a wrong choice costs one lap, not a
stopped set. It is also **not** Cmd+Z — radio writes no undo history by design
(`2026-09-26-radio-mode-design.md` §3.4) and neither does this; `put back` is a forward commit that
happens to restore.

---

## 3. Arming and the trigger

### 3.1 The gesture

Tap a card → that slot is **armed**. The card fills with `--ra-bg-row-active` and the slot row
shows a rule filling toward the next wrap. At the wrap, the card's candidate is committed and the
deck refills.

Tap an armed card again → **disarmed**, silently, with no sound and no consequence. Changing your
mind must cost nothing, or the feature is a commitment device rather than an instrument.

### 3.2 A card cannot be armed until its stem has resolved

This is the one correctness rule the whole feature rests on, so it is a rule and not an
optimisation.

A card has three states:

| state | meaning |
|---|---|
| `picking` | `pickForSlot` is in flight — nothing to show yet |
| `warming` | a candidate exists; `resolveCandidateStem` has not settled |
| `ready` | the stem is resolved and cached; the card is tappable |

**`warming` cards are visible but not tappable.** The reason is §3.3: if an unresolved card could
be armed, a four-slot launch would land three stems at the wrap and the fourth whenever its
download finished, which is the exact failure the whole "land on the one" requirement exists to
prevent. Warming the deck ahead is what buys the guarantee, and refusing the tap is what enforces
it.

The lead time is real: the deck is picked and warmed the moment performance mode opens, and
refilled the moment a card leaves. By the time a hand reaches a card it has normally been settled
for many bars.

### 3.3 Arming several at once — the big move, and it is free

Because arming is per slot, several slots can be armed at the same time. At the wrap they **all
commit in the same deferred tick**, inside the same `void Promise.resolve().then(...)` radio
already uses (`DiscoverPanel.tsx:1240-1253`).

Why that is enough, mechanically:

- `commitSlotPick` is a functional `setSlots((prev) => prev.map(...))` (`:2086`), so N calls in one
  tick compose into **one** state update.
- One state update is one render, and the preview sync is rAF-coalesced
  (`scheduleSyncPreviewToEngine`, `:652`).
- So N armed slots become **one `buildEngineProject` and one `load-project`**.
- And `load-project` **preserves the transport position** — the handler
  (`IpcServer.cpp:220-273`) never calls `transport.setPosition`. A four-layer change is a cut, not
  a restart.

**A whole new bed landing together is one project load, and it needs nothing built for it.** That
is the strongest argument for arming being per-slot rather than a shared queue.

No cap on how many may be armed. Every armed slot re-checks eligibility at the wrap the same way
radio's pending pick does (`:1233`, *"the slot may since have been removed, locked or muted"*) —
a slot that stopped being eligible drops its arm rather than forcing a change the user has since
argued against.

### 3.4 What it shows while armed

The slot row already has the precedent: radio draws a progress rule under its button
(`radioProgress`, `DiscoverPanel.tsx:2966`, hidden with `visibility` rather than unmounted so the
grid cannot reflow). An armed slot's rule uses the same treatment and fills toward the **wrap**:
`pos / loopBars`, derived at render time from the 30 Hz tick that is already re-rendering this
panel for the playhead.

That is display only, and display from the tick is fine — it is the same information the playhead
already carries. **Nothing audible is ever triggered from it** (§0.3).

Monochrome, per the tokens: `--ra-bg-row-active` fill and `--ra-text` ink, like the padlock and
like the other spec's `hook` toggle. Colour on this screen is for waveforms and the playhead.

---

## 4. Autopilot versus manual

**Default: radio keeps running as the bed, and arming overrides it for that slot.** The brief
proposed this; here is the argument.

**For.** The product idea is *the machine offers, the human chooses*. If the machine stops the
moment you take one decision, performance mode is Discover with extra steps — you would have to
keep four layers alive by hand, which is more hands than there are. And Elling's own verdict on
radio was *"honestly, this is actually pretty cool right now"*: the bed is the part that already
works, and this should sit on top of it rather than replace it. It also degrades perfectly: do
nothing and you have radio; arm one card and you have radio plus one decision.

**Against, and the guard that answers it.** Radio changing a layer you were reaching for is a
stolen decision. One clause fixes it: **a slot with an armed card is not eligible for radio that
turn.** And radio never rerolls a card out from under you, because the deck card *is* what radio
would have played — same `pickForSlot`, same warm.

**Where that clause goes matters.** As of 2026-09-28 the answer to "may radio turn this layer
over" lives in one shared place: `isRadioEligibleSlot(slot)`
(`src/shared/radioSchedule.ts:167`), extracted while fixing a live report — *"if i start radio
with stems already there.. it seems to not transition"* — because the component's own filter
tested `s.candidate !== null` and every slot seeded from a rifff or the shelf carries a
`seedStem` instead. Its doc comment says why it is shared: *"so the next thing that needs to ask
'may radio touch this layer' cannot get a third answer."*

**Do not add `armed` to it.** Being armed is not a fact about whether a layer is turnable — it is
a fact about performance mode, which `isRadioEligibleSlot` knows nothing about and should not.
The exclusion belongs one level up, where the component composes the eligible set:
`radioEligibleSlotIds()` (`DiscoverPanel.tsx:2270`) filters the shared predicate's result by
`!armedSlotIds.has(s.id)`. Two questions, two places, and radio's own behaviour with performance
mode off is bit-identical.

One free consequence of that same fix, worth naming: **a seeded slot is eligible now**, so it
gets a deck card like any other. Performance mode over a loop Elling already built works from the
first tap.

**And the other posture, because a set is not a bed: `hold`.** One chip row with two values.

| chip | meaning |
|---|---|
| `auto` | **default** — radio keeps turning unarmed layers over |
| `hold` | radio commits nothing; only what you arm ever changes |

`hold` is two lines — skip the `due` branch, keep arming picks so the deck stays full — and it is
the difference between background music and playing. It ships in phase 1 for that reason.

**Where the chip lives: the perform strip, not the radio menu.** The radio menu
(`2026-09-28-radio-controls-design.md` §9) configures radio's taste — pace, grid, transitions,
drop-outs, turnover, reach. `auto`/`hold` is not a taste, it is which of two products is running.
A mode switch does not belong in a settings popover.

### 4.1 The three states, and they are all meaningful

| radio | perform | what it is |
|---|---|---|
| off | — | Discover, exactly as it was |
| on | off | radio, exactly as it is |
| on | on, `auto` | radio plus a deck you can override |
| on | on, `hold` | the machine offers and never acts |

**`perform` is offered only while radio is on**, and turning it on while radio is off turns radio
on. Performance mode needs radio's clock — two independent switches that both drive the same clock
is a state machine nobody asked for. The `perform` button is therefore visible only while radio is
on, hidden with `visibility` (the same rule the progress rule and the other spec's chevron use).

---

## 4A. Master effects over the whole mix

§0.4 covered the plugin half, which works. This is the half that does not exist: **a master
version of the built-in toolkit.** The toolkit — filter, reverb send, volume curve
(`2026-09-22-builtin-sound-toolkit-design.md`) — is strictly **per clip**, and that spec says so
deliberately: *"Channel-level filter/send settings from the first pass are dropped; there is no
channel scope for the toolkit any more."*

For a performance instrument this is the most valuable control there is. **Sweeping the whole mix
is more of a live move than swapping a layer.** So it belongs here, and it belongs in performance
mode rather than radio for one reason: **a master filter is played, not configured.**

The three controls have three different answers. That is the finding.

### 4A.1 Master reverb: free, and the mechanism is already exactly right

The engine's reverb is **one shared zita-rev1 instance for the whole mix, fed by per-stem sends**
(`ReverbBus.h:38-58`; a single `mutable ReverbBus reverbBus` on `PlaybackEngine`,
`PlaybackEngine.h:322`). Its settings are **already project-level and already on the wire**:
`EngineProject.reverb` = `{ roomSize, damping, preDelayMs }` (`toolkit.ts:110-124`).

So a master reverb is exactly what the brief guessed: **every stem's `reverbSend` raised
together**, plus copying `state.reverb` into `previewState` (§0.4, caveat 2). Sends are additive
and independent per clip — `reverbBus.addSend(numSamples, stemL, stemR, dsp.sendSmoother)`
(`PlaybackEngine.cpp:792`), post-fader, accumulated into one bus — so N equal sends into one bus
**is** a master send. There is nothing to approximate.

**No native work. This one ships** — with one honest qualification about how it is *moved*.

**It is a control you set, not one you sweep.** `set-live-param` has no reverb field (§4A.2), so
the only way to change a send is to rebuild and re-send the project. `updateSlotGain`'s own
comment says exactly why that is not acceptable per drag tick: it exists *"instead of a full
project rebuild per drag tick"*. So the master reverb dial **reports continuously on screen and
commits once on release** — one `load-project`, on pointer-up. That is right for reverb anyway,
which is a colour you choose rather than a gesture you perform. **The thing you sweep is the
filter, and that is §4A.3.**

### 4A.2 Master volume: use the live-param that already exists, not curves

The brief suggested master volume share an implementation with the radio drop-out. **It should
not, and the reason is a trap worth naming.**

A non-empty `volume` curve makes `EngineStem.volume` **inert** — `PlaybackEngine.cpp:325-329`
checks `volumeAutomated` and skips the live-override path entirely. So a master volume curve
written onto every stem would **disable every slot's gain drag and the phone's mute** for as long
as it ran. That is a much worse version of the single-stem interaction the radio-controls spec
already flagged as its constraint 3.

The right mechanism is already shipped: `set-live-param` with `field: 'volume'`, keyed by stemKey
(`IpcServer.cpp:343-344`, `LiveParamOverrides.h:79-82`), rAF-coalesced through `liveParamSync.ts`.
It is what the gain drag uses today. A master fader is N of those — one write per slot per frame,
each slot's own gain multiplied by the master value, so the fader scales the mix rather than
flattening it.

**One thing that must not be discovered late:** `load-project` calls
`engine.liveOverrides().clearAll()` (`IpcServer.cpp:259`). So any project reload — a slot landing,
a skip resolving, a mute — **wipes the master fader's overrides** and every slot snaps back to its
own gain. The master level therefore has to be **re-applied after every `syncPreviewToEngine`**,
not written once. That is a few lines, and it is the difference between a fader that works and
one that jumps back to unity every time a layer changes.

**The general rule, and it is the radio-controls spec's own §0A.2 restated one level up:**

> **A curve is for a gesture that must land on a beat. A live-param is for a hand on a control.**
> The drop-out is a curve because it has to return exactly on the one. A master fader is dragged,
> so it is a live-param. They share a concept, deliberately not a mechanism.

**No native work. This one ships too.**

### 4A.3 Master filter: build the real field. Do not fake it with N curves.

This is where the recommendation reverses the brief's hypothesis, and the brief explicitly asked
for that if it turned out to be the answer.

**First, the maths, because it is not the problem.** `ChannelFilter` wraps
`juce::dsp::StateVariableTPTFilter<float>` (`ChannelFilter.h:106`) — a 2nd-order TPT SVF, cutoff
log-mapped 20 Hz–20 kHz, Q 0.707–8.0 (`ChannelFilter.cpp:16-30`). It is **linear**, so
superposition is exact. **Resonance does not break it** — a fixed-Q linear filter is still linear.
**Nor does sweeping it**: superposition holds instant by instant for a linear *time-varying*
system, so N identically-swept filters summed genuinely equals one swept filter on the sum.

**The problem is that "identically" is only true by accident here.** Four properties would have to
hold, and in Discover today all four happen to, which is exactly what makes the fake dangerous:

| property | true in Discover today? | why it is incidental |
|---|---|---|
| every clip shares one `originBar`, so one curve means one thing | yes — every preview clip is `startBar: 0` with no crop and no offset, so `clipOriginBar` (`buildEngineProject.ts:220-229`) is 0 | curves are **clip-relative** (`PlaybackEngine.cpp:721`); any crop, move or re-one offset re-bases it per clip |
| every stem's smoothers sit at the same point on the sweep | yes — every sync mints a fresh `groupId`, so every `StemDspState` (keyed by stemKey, `PlaybackEngine.h:311`) is new and they all re-seed in lockstep | per-stem smoothers **freeze whenever a clip is not sounding** (every `continue` before `finishStem()`), so in general they drift apart by ~15 ms each time |
| no per-clip filter to collide with | yes — the preview has no toolkit at all (`initialState.stemFilters/stemSends/stemAutomation` are `{}`) | **each clip has exactly one filter and one cutoff curve.** A master curve would overwrite whatever the user drew, and log-mapped cutoffs do not compose |
| the cost is acceptable | probably — but see below | a non-neutral toolkit opts every clip off the direct-sum path onto the per-clip scratch-buffer path (`PlaybackEngine.cpp:113-131,341-361`) |

**On cost, since the brief asked rather than assumed.** The filter object is **held, not
per-block** — one `ChannelFilter` per clip, created lazily and kept (`PlaybackEngine.h:211-216`).
So the allocation is one-off. What does scale is per block, per stem: a scratch clear, a sum-back,
and a `tan()`-driven coefficient recompute every 64 samples (`ChannelFilter.h:100`). A Discover
preview is **one channel with up to 20 stems** (`MAX_RIFFF_STEM_SLOTS`), so that is up to 20× the
filter work for a result identical to one filter. Not fatal — this engine hosts VST3 plugins — but
it is 20× for nothing, and it is the honest number rather than a shrug.

**Two of those four properties are things another feature could remove without knowing they were
load-bearing.** The fresh-`groupId`-per-sync behaviour in particular is an implementation detail
of `assembleDiscoverRifff`, not a contract.

**So: build the real field.** It is much smaller than it sounds, and categorically smaller than
the cue bus in §2.2:

- One `ChannelFilter` and one `ParamSmoother` owned by `PlaybackEngine`, beside the `reverbBus` it
  already owns (`PlaybackEngine.h:322`).
- Applied at `PlaybackEngine.cpp:669-684`, between the channel-chain sum loop and
  `reverbBus.endBlock` — one insertion point that already exists.
- One new field beside `EngineProject.reverb` (`buildEngineProject.ts:194` / `EngineProject.h:237`)
  and its parse (`EngineProject.cpp`).

**No signature changes. No new output channels. No routing. No `renderBlock` rewrite.** Contrast
§2.2's cue bus, which needs all of those.

> **But it is still `native-engine/` work, and that must be flagged loudly and early, as the brief
> asked.** The engine does not hot-reload: every iteration is `cmake --build`, Cmd+Q, relaunch.
> `EngineProject` and `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and this changes
> both. **It therefore gets its own spec and its own plan, and it is the first native change
> either of today's two documents proposes.**

**If Elling wants it sooner and will take the trade, the N-curve fake is viable in Discover
specifically** — all four properties hold there today. It is written down here so the trade is his
to make with the costs visible, not so that it is the plan.

### 4A.4 What it looks like, and where it is played

One **master strip** above the slot list while performance mode is on: `reverb`, `level`, and
later `filter`. Continuous controls, so they use the existing `Dial` component
(`components/Dial.tsx`, already imported by `DiscoverPanel.tsx:6`), monochrome, no
`border-radius`, lowercase.

**The filter gets a cutoff control and a resonance knob beside it, not two lanes.** That shape is
already settled in this codebase, by Elling, for the per-clip case — resonance *was* a fourth
automation lane and was removed after he used it: *"that's confusing to have it separate from cut
though isn't it?"*, resolved as *"one filter lane you draw, with its resonance as a knob beside
it. That is also how Ableton's Auto Filter works"* (`toolkit.ts:31-45`). **The master filter
inherits that decision rather than re-litigating it.**

A swept master filter could also be **armed** like a card, landing its sweep on the loop top —
which is the one place performance mode's existing machinery and a master control meet. That is
deliberately **not now**: the dragged version is the one he described, and arming a sweep is a
second product on top of a control that does not exist yet.

## 5. The phone as the controller

Standing at a laptop is not performing. The phone is already a real mixer: per-stem audio, instant
mute and solo as a gain change, a per-row action sheet with `similar` / `adjacent` / `random` /
`duplicate` (`remotePage.ts:156-168`), and a kind picker.

The performance surface on it is small, and deliberately so:

- Each row's action sheet gains an **`on deck`** line — the card's name and kind — and one action,
  **`arm`** (or `disarm` when it is armed).
- That is **one enum value each through `parseRemoteSlotAction`** on the existing
  `/api/slot-action` route (`remoteServer.ts:450`). No new route, no new security surface: the
  route already takes `{ slotId, action }`, rejects an unknown action outright, and an id the Mac
  no longer has is already a harmless no-op.
- **The Mac does the landing.** The phone never schedules anything; it sets a flag, and the wrap
  that the Mac's own clock detects is what fires. That keeps one clock in the system, which is the
  same reasoning the phone's own swap grid already follows.
- `/api/state` gains the deck per slot so the sheet has something to show.

**Phase 4, and a phase, not a prerequisite.** Cue on the phone (§2.4) is further out still.

### 5.1 The phone is the right surface for the master filter, and it is the *last* move, not the obvious one

The argument for it is genuinely strong: a master filter wants a control you can move
continuously, and a thumb on a phone is that control. It is also the best answer anyone has to
"why does the phone exist".

**But the premise that the phone already has real-time gain control over the mix is not right,
and the difference is three pieces of work rather than one.** `setLevel`
(`remotePage.ts:938,1113`) writes a Web Audio `GainNode` **on the phone**, affecting only the
phone's own local mix. **No route ever carries a level to the Mac.** Every phone→Mac route
carries an enum or an id and nothing else: `/api/slot-action` (a fixed action word),
`/api/roll`, `/api/keep`, `/api/add-slot`, `/api/remove-slot` (`remoteServer.ts:401-455`). And the
phone **polls at 700 ms** with no push channel (`remotePage.ts:795,954`), which no amount of
tuning makes playable for a swept filter.

So a master filter played from the phone needs, in order:

1. the engine-side parameter (§4A.3 — native work, its own spec),
2. a route that carries a continuous value, which does not exist,
3. a low-latency transport to replace a 700 ms poll, which also does not exist.

**Right destination, wrong first step.** The master strip lands on the desktop (§4A.4), where
`Dial` and `liveParamSync` already exist and neither (2) nor (3) is needed; the phone gets it once
there is something for it to move.

---

## 6. What this does to the existing screens

- **Discover's slot rows: nothing.** No column is added, moved or renumbered. This is the
  constraint that decided §1.5 and it is not negotiable while the other spec is claiming track 6.
- **Discover's actions row: one button.** `perform`, beside `radio`, visible only while radio is
  on. The other spec is *removing* three pace chips from that row into a menu, so the net is
  simpler than today.
- **The slot list: one sub-row per slot while performance mode is on.** Using `--ra-bg-row-sub`,
  which exists for this.
- **The perform strip:** one chip row, `autopilot: auto · hold`, plus the `cue` chip once phase 2
  lands. Two rows at most, ever.
- **Everything else: untouched.** No new top-level mode, no change to `sketch`/`arrange`/`map`, no
  change to the timeline, the shelf or the arrangement map.

---

## 7. What ships, in what order

Sequenced so **each phase leaves the app working and useful on its own**, and so the smallest
thing Elling could actually perform with comes first.

| phase | what | where |
|---|---|---|
| **1** | **the deck.** `perform` toggle; one card per slot from radio's own pick; `arm` / `disarm` / `skip`; landing at the next wrap; `put back`; armed slots excluded from radio's roll; `auto` / `hold`. No cue, no phone, no settings. | this plan |
| **2** | **cue.** A `cue` chip per card: `startPreviewLoop` on the existing `AudioContext`, the stretched path, started at the current offset and re-anchored each wrap. Off by default. No engine work. | this plan |
| **3** | **the master strip.** §4A.1 master reverb and §4A.2 master level, both over the whole mix, plus the two §0.4 caveats fixed (the project's reverb settings reach the preview; the channel-FX claim in the doc comment corrected). No master filter yet. | this plan |
| **4** | **two on deck.** Depth 2 per slot, second card refilled behind the first. | its own plan |
| **5** | **the phone arms.** `on deck` and `arm` in the action sheet, over `/api/slot-action`. | its own plan |
| **6** | **the master filter.** §4A.3 — the real `EngineProject` field. **The first `native-engine/` change either of today's documents proposes.** | **its own spec + plan** |

**Phase 1 is usable with none of the others.** That is the point of the ordering and it is worth
saying plainly: the deck alone — see what is coming, choose it, land it on the one, put it back if
it was wrong, freeze the bed with `hold` — is a performance instrument. Everything after it makes
that instrument better without being needed for it to work.

Phase 2 is separated from phase 1 not because it is hard but because it is the only part with a
physical prerequisite: two output devices. Phase 1 must not depend on Elling having rigged one.

Phase 3 is in this plan because both of its controls are free (§4A.1, §4A.2) and because the two
caveats it fixes are one-line bugs that should not wait behind anything.

Phases 4 and 5 get their own plans for the usual reason — 4 multiplies the per-slot cost by two
and wants that measured against a real library first, and 5 is a different process, a different
security surface and a different device.

**Phase 6 gets its own spec, not just its own plan**, because it is native-engine work and every
other phase here is not. Mixing one native change into a plan whose standing constraint is "no
native changes" is how that constraint stops meaning anything.

**Performance mode is session-only.** Nothing about it is persisted: slot ids are minted fresh each
session (`crypto.randomUUID`), so a stored arm or a stored deck would name a slot that does not
exist. The same argument the other spec makes for the hook. **`DiscoverSettings` is not touched**
— which also means this feature does not participate in the `radioPace` → nested `radio` object
migration the radio-controls plan is performing on that file, and cannot collide with it.

---

## 8. Not now

Named so they stay named. Anything not on this list and not above is out.

- **A cue bus in the engine** — a second output pair, per-stem output routing, a monitor send.
  Costed in §2.2. Native work, no automated coverage, rebuild-and-relaunch per iteration.
- **A phase-locked cue of any kind.** Both available cue paths (§2.3, §2.4) run on a clock the
  engine does not drive. Locking one would mean either engine work or a sync protocol.
- **Depth beyond two on deck.** §1.2.
- **A shared cross-slot queue.** §1.1, rejected on the kind argument.
- **Choosing a transition per card.** Transitions belong to the radio-controls spec; performance
  mode inherits whatever it ships and picks no edge of its own. §0.3.
- **Scenes** — a named whole-bed snapshot you can recall, the real Session View move. `keep`
  already stores a group as a rifff in the `discovered` room and that is the nearest shipped thing.
  A launchable scene is a different feature with its own storage question.
- **MIDI or keyboard launch bindings.** The obvious next thing after the phone, and still out.
- **A setlist, or recording what was played.** There is no history of radio's picks either
  (`2026-09-28-radio-controls-design.md` §11) and this does not add one.
- **Undo for a launched change.** `put back` is the tool, exactly as the padlock is radio's.
- **Persisting the deck, the arms or the mode.** §7.
- **Cue on the phone.** §2.4.
- **A cross-fade between the outgoing and incoming stem on a launch.** That is the two-stem
  problem, already costed and deferred at `2026-09-28-radio-controls-design.md` §5.4, and it is
  the same three 1:1 assumptions there.
- **Auto-detecting whether the cue device is the same as the engine's.** §2.3, limit 4.
- **Arming a kind change, a mute or a lock to the wrap.** Only a stem change is launchable. Mute is
  already instant everywhere in this app and making it quantised would be a regression.
- **Faking the master filter as N per-clip `filterCutoff` curves.** §4A.3 — it would work in
  Discover today, on four accidents, two of which another feature could remove silently.
- **A master volume built from automation curves.** §4A.2 — it would make `EngineStem.volume`
  inert and kill every gain drag and the phone's mute while it ran.
- **Arming a master filter sweep to land on the loop top.** §4A.4. A second product on top of a
  control that does not exist yet.
- **Master resonance as an automation lane.** Settled already, per clip, by Elling
  (`toolkit.ts:31-45`); the master filter inherits the knob-beside-the-lane shape.
- **A master filter on the phone.** §5.1 — three pieces of work, two of which do not exist.
- **Channel FX reaching the Discover preview.** §0.4 caveat 1 is about correcting a doc comment
  that claims they do. Actually routing them would mean giving the preview a stable channel
  identity, which is a different change with its own consequences.
- **Bringing back channel scope for the toolkit.** Dropped on purpose by the 2026-09-22 spec and
  not reopened here.

---

## 9. Constraints that do not move

- **No `native-engine/` change in phases 1 through 5.** Established by reading it (§2.2, §4A),
  not assumed. `EngineProject` and `buildEngineProject.ts` are a hand-synced pair and neither is
  touched. **Phase 6 is the single exception, it is scoped to one field and one insertion point
  (§4A.3), and it has its own spec so that this constraint keeps meaning something everywhere
  else.**
- **A curve is for a gesture that must land on a beat; a live-param is for a hand on a control.**
  §4A.2. Do not build a dragged control out of automation curves, and do not build a
  land-on-the-one gesture out of live-params.
- **No new audio-timing mechanism.** A landing is a stem change on the same path radio already
  commits stem changes on; nothing rhythmic is ever fired from the React tick. §0.3, and the other
  spec's §0A is the authority on why.
- **`wrapped` is performance mode's trigger and `due` is radio's.** §0.2. The radio-controls spec
  changes `due` only; do not let either change touch the other's field.
- **`vitest.config.ts` is not touched.** Nothing here opens a database — the deck is renderer
  state, the cue is Web Audio, and no setting is persisted at all.
- **Radio's no-undo rule holds.** Every commit goes through `commitSlotPick` directly, never
  `rerollSlot` (which calls `pushUndoSnapshot`). A launch is a performance, not an edit.
- **Design tokens are the law** (`src/renderer/src/styles/tokens.css`): near-black monochrome,
  Silkscreen, **no `border-radius` anywhere**, lowercase copy, no emoji, no exclamation marks,
  colour only on things carrying audio information. **Buttons are two words maximum or an icon;
  tooltips are two or three words.** The only colour anywhere in this feature is the waveform on a
  card, through `typeColorVar`.

---

## 10. Testing, honestly

- **`src/shared/performanceDeck.ts` is pure and TDD'd**, as `src/shared/` is by convention here:
  the card state machine, which cards are armable, which armed slots actually land given the live
  eligibility set, and how `auto`/`hold` filters radio's eligible set. All of it is value-in,
  value-out, with no React and no Electron.
- **React components are not unit-tested in this codebase** (CLAUDE.md), and the deck, the cards,
  the sub-row and the buttons are React. They are verified by `npm run typecheck`, `npm run lint`
  and the full suite staying green — and then by Elling.
- **The cue cannot be verified by an agent at all.** This environment has no audio output and no
  second device. Whether a cue is audible in headphones while the mix goes to an interface, and
  whether ~33 ms of phase error is tolerable for judging a stem, are both questions only a human
  in a room can answer. **Say so; do not claim a cue was heard.**
- The same goes for every timing claim in this document. Nothing here can be heard by the thing
  that wrote it.
- **The master strip's own logic is pure and TDD'd** — how one master send value becomes N
  per-stem sends, and how one master level becomes N live-param writes, are both value-in,
  value-out functions in `src/shared/`. What cannot be tested is whether a master reverb at 0.4
  sounds like anything, which is the only question that matters about it.
- **Nobody has heard the N-curve master filter either**, so §4A.3's cost argument is a reading of
  the code and an arithmetic claim about linear systems, not a listening test. The recommendation
  against it rests on the four incidental properties, which are checkable by reading; if Elling
  overrules it on taste, that is a legitimate call on evidence this document cannot supply.
