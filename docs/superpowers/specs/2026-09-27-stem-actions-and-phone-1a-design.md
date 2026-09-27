# The four stem actions on the phone, and layout 1a

Date: 2026-09-27
Status: decided in chat with Elling, then grounded against the real code; awaiting his walkthrough

Two coupled pieces. **Piece 1 is much smaller than it first looked** — see the correction
immediately below — and **Piece 2 is the actual work.**

Elling, on the phone remote, verbatim:

> "i think we want this to be as fully featured as the desktop discover, so pls add those things
> to the hold menu"

> "similar adjacent random and duplicate"

> "also we should add one click mute.. long press is the menu.. short is mute or unmute"

> "follow the patterns from the arrangement view for muted appearance"

And the design pass he picked: **layout 1a, "thumb console"**, for the phone's app state only.
The pair screen and the desktop's own remote modal are not touched — he said the other existing
screens are fine.

---

## The correction this spec exists to record

The work was briefed as "four new per-slot stem actions that do not exist anywhere in Discover
today." **That is wrong, and the spec must say so plainly rather than quietly building around
it.** All four already exist on the desktop, by those exact four names, as labelled buttons on
every Discover slot row:

`src/renderer/src/components/DiscoverPanel.tsx`, the slot row's 15-track grid
(`gridTemplateColumns` at `:3933`), tracks 11–15: a decorative dice icon, then
**similar** (`:4549`), **adjacent** (`:4579`), **random** (`:4602`), **duplicate** (`:4630`).
The dice sits there on purpose — its own comment (`:4511`) says it is there "to the left of the
similar/adjacent/random buttons... this will suggest that they are all randomizers."

So **there is no new desktop feature to design.** Nothing here invents a trait-distance metric,
a kind-shift ordering, a new ranking system or any new desktop UI. What Elling asked for is the
four buttons he can see on his Mac, reachable from his thumb. Piece 1 is therefore: **carry the
four existing operations, plus mute, over the phone API and into the phone's hold menu.**

Everything in §1 below is a *report of what the code already does*, not a decision being made
now. The questions that were posed as open — undo, locked slots, generation claims, what happens
when there is no candidate — are already answered in the code. The answers are recorded here so
the phone side can match them exactly instead of drifting.

---

# Piece 1 — the four actions, and mute, over the wire

## 1.1 What each button actually does today

Wiring, all in `DiscoverPanel.tsx` (props passed at `:2936-2944`, prop types at `:3363-3495`):

| button | prop | calls | what it is |
|---|---|---|---|
| **similar** (tooltip `same kind`) | `onReroll` | `rerollSlot(id)` `:2004` | a plain reroll keeping the slot's own kind set |
| **adjacent** (tooltip `nearby jam`) | *(none)* | opens `DiscoverNearbyPopover` locally | a **browser**, not a one-shot action |
| **random** (tooltip `any stem`) | `onRerollRandom` | `rerollRandomSlot(id)` `:2064` | a roll that ignores the kind pool entirely |
| **duplicate** (tooltip `duplicate`) | `onDuplicate` | `duplicateSlot(id)` `:1772` | an exact clone of the row, appended |

**similar** → `rerollSlot` → `pushUndoSnapshot()` → `rollForSlot(id, slot.kinds)` →
`pickForSlot` (the fetch/dedupe/bar/rank/pick half) → `commitSlotPick`. Ranking is
`rankCandidates` (`src/shared/discoverRanking.ts`): BPM closeness, plus a favourites boost, plus
one library-percentile term per requested *trait* kind — then `pickReroll` draws from a
chaos-sized pool, weighted by score. The label is looser than the tooltip: it means "another one
of this kind," not "near this particular stem." That is what it has always meant and it is not
being changed here.

**adjacent** is the odd one and is the only one that needed a decision. There is **no
`onAdjacent` prop.** The button's own `onClick` (`:4553`) sets local popover state
(`setNearbyMenu({ x, y })`); the popover then calls
`window.rifffApi.getAdjacentDiscoverCandidates(centerCandidate.riffCID, kinds, soundSource)`
(`DiscoverNearbyPopover.tsx:203`), draws up to four thumbnails per direction, and a tap on one
calls `onPick` → `swapSlotFromNearby(id, candidate)` (`DiscoverPanel.tsx:1809`). It is
*temporal* adjacency — other riffs from the same jam's own iteration sequence, newer and older
(`src/main/discoverAdjacency.ts:114`) — and it is conditionally rendered at all, only when
`nearbyAnchor !== null` (`:4551`, `:3758`).

The button is also **disabled-by-absence** rather than greyed: a slot with no candidate and no
recoverable seed riff simply has no `adjacent` button.

**random** → `rerollRandomSlot` → `pushUndoSnapshot()` → `rollRandomForSlot` →
`window.rifffApi.getRandomDiscoverCandidate(kinds, onlyOwnStems, username, soundSource)`. One
random jam, one random stem in it; no confirmed/classified pool scan, no ranking at all. The
`kinds` it is handed are only carried through as the slot's label and eventual bus mapping — they
do not filter. It *does* still honour the global sound-source and my-sounds toggles.

**duplicate** → `duplicateSlot` → `pushUndoSnapshot()` → appends `{ ...slot, id: freshSlotId() }`.
An exact copy — same kinds, same candidate, same gain, same lock, same `seedStem`. It does **not**
reroll. It lands **at the end of the list**, not next to its source. That placement is the
shipped behaviour (`:1776`) and this spec keeps it: the row order is the loop's layer order in
every other part of Discover, and a phone that silently re-orders the stack under a thumb is
worse than one that always grows downward — and on the phone the stack grows *upward* from the thumb
(§2.3), so "appended" means "the new row appears nearest the thumb," which is right.

## 1.2 The answers that were already in the code

**Undo.** Three of the four push an undo snapshot: `rerollSlot`, `rerollRandomSlot` and
`duplicateSlot` each call `pushUndoSnapshot()` as their first line. `swapSlotFromNearby` — the
commit half of **adjacent** — also pushes one (`:1810`). So **all four are undoable, one step
each**, and the phone's versions inherit that for free by calling the same functions.

The things that deliberately do *not* push a snapshot are `toggleLock`, `toggleSlotPreview`
(mute), `toggleSlotSolo`, `updateSlotGain` and `reclassifySlot` — none of them changes which stem
a slot holds. **Mute is therefore not undoable**, and the phone's new tap-to-mute must not make
it so. Radio also deliberately bypasses undo (`:1226-1230`) — "radio firing every twenty bars
would fill the undo stack with changes nobody actually made by hand." The phone's actions *are*
made by hand, so the radio exemption does not apply to them.

**Locked slots.** `slot.locked` is checked in exactly one place that matters here: `rerollAll`
skips locked slots. `rerollSlot`, `rerollRandomSlot`, `duplicateSlot` and `swapSlotFromNearby`
**do not check it at all**, and none of the four buttons is disabled when the slot is locked.
The lock's real meaning in this codebase is therefore *"roll all passes you by"* — a deliberate,
per-slot action always wins. (The only lock-gated control on the row is the kind picker, whose
tooltip literally reads `unlock first`, `:4400`.) **The phone matches this exactly**: the four
actions work on a locked row, and the phone shows no lock affordance at all, because the phone
has no `roll all`-exempting concept to explain. `roll all` from the phone already goes through
`rerollAll` and already skips locked slots.

**Generation claims.** `pickForSlot` claims a generation **before its first `await`**
(`:1828-1829`) and `rollRandomForSlot` does the same (`:2033-2034`); both write into the *same*
`rerollGenerationRef` map so a random roll landing after a newer normal reroll cannot overwrite
it, and vice versa. Every async path that lands a candidate on a slot must take a claim this way.
This matters for exactly one new function — the phone's one-tap **adjacent** (§1.4), which has an
`await` between "which slot" and "which stem" — and it reuses the pattern verbatim rather than
inventing a second guard.

**No candidate.** Each has its own already-shipped answer:
- **similar** on an empty pool: `pickForSlot` returns a pick whose `candidate` is `null`,
  `commitSlotPick` writes it with `hasRerolled: true`, and the row reads "no match." A genuine
  IPC/SQL throw leaves `hasRerolled` false so the row still reads as retriable (`:194-215`).
- **random** on an empty library: `getRandomDiscoverCandidate` returns `null`, same "no match"
  row.
- **adjacent** with nothing nearby: `getAdjacentDiscoverCandidates` returns
  `{ newer: [], older: [] }` and never throws. The desktop popover then shows an empty list. The
  phone's one-tap form has nothing to swap in, so it **leaves the slot exactly as it was** and
  says so on the status line (§2.9). It must not blank the row: a stem that is still playing is
  still the right stem.
- **duplicate** never queries anything, so it cannot fail. Duplicating an unresolved row clones
  an unresolved row.

In every one of these the previously-resolved audio keeps playing until something replaces it —
`reportSlotResolution`'s null branch is a deliberate no-op for exactly that reason (`:1002`).
Nothing on the phone may change that.

**Mute.** `toggleSlotPreview(id)` (`:955`) flips the slot's membership of `previewingSlotIds`,
writes the ref, sets the state and re-syncs the engine. No undo, no lock check. The desktop's
mute button is guarded by `hasStemToActOn` — it is not rendered until the slot has a candidate or
a resolved stem — and the phone honours the same guard by suppressing both gestures on an
unresolved row (§2.6).

## 1.3 One new route, not five

The server has exactly seven routes today (`src/main/remoteServer.ts`: `pair`, `state`, `loop`,
`roll`, `keep`, `add-slot`, `remove-slot`). Five near-identical new ones would be five near-identical
`typeof body.slotId === 'string'` blocks. Instead: **one** route.

```
POST /api/slot-action   { slotId: string, action: 'mute'|'similar'|'adjacent'|'random'|'duplicate' }
```

`src/shared/remoteState.ts` gains the trust boundary for it, in the same shape as the existing
`parseRemoteSlotKinds`:

```ts
export type RemoteSlotAction = 'mute' | 'similar' | 'adjacent' | 'random' | 'duplicate'
export function parseRemoteSlotAction(value: unknown): RemoteSlotAction | null
```

An unrecognised string is **not** coerced, dropped or best-guessed — it fails the whole request
with a 400, exactly as an unknown kind does. `RemoteCommand` gains one member:

```ts
| { kind: 'slot-action'; slotId: string; action: RemoteSlotAction }
```

That keeps the union's "five verbs, and nothing else" doc comment honest by making it six verbs
with one enumerated payload, rather than ten verbs. The comment's "deliberately still NOT here"
list is updated: per-slot **gain**, the matching dial, chaos, the roll filters, favourites-only,
undo/redo and the match meter all stay off the phone. Mute comes *off* that list.

This makes eight routes. The CSP comment in `remotePage.ts` that says "the seven API routes"
must be updated with them; no new *kind* of resource is added, so `REMOTE_PAGE_CSP` itself does
not change and must not.

## 1.4 The one genuinely new renderer function: one-tap `adjacent`

The desktop's `adjacent` is a scrolling thumbnail browser. That does not fit a 2×2 action sheet
of 64px buttons, and it should not be ported as one — the phone's whole premise is
"one thumb, arm's length, dark room." So the phone's `adjacent` is the **one-tap form of the same
thing**: fetch the same adjacency window, pick one of it, commit it through the same
`swapSlotFromNearby` the popover commits through.

This is the only place the phone is not literally the desktop, and it is a deliberate
compression, not a second implementation: same IPC, same candidate type, same commit, same undo
step.

```
rollAdjacentForSlot(id):
  slot   = slotsRef.current.find(id)          // must exist
  anchor = slot.candidate                     // no anchor -> do nothing (matches the desktop's
                                              //   "no adjacent button at all" state)
  claim a generation in rerollGenerationRef   // BEFORE the await, same as rollRandomForSlot
  mark the slot rolling (rerollingSlotIds)
  window.rifffApi.getAdjacentDiscoverCandidates(anchor.riffCID, slot.kinds, soundSource)
  if the claim is stale -> write nothing
  pick = pickAdjacentCandidate(older, newer, anchor.stemCID, Math.random)
  if pick === null -> leave the slot alone
  swapSlotFromNearby(id, pick)                // pushes the undo snapshot, as on the desktop
  clear the rolling mark if the claim is still ours
```

The pick itself is **pure and lives in `src/shared/`** — `pickAdjacentCandidate` in a new
`src/shared/discoverAdjacentPick.ts`, generic over `{ stemCID: string }` so it never imports from
`src/main/`, with an injected `random: () => number`. Two reasons, both hard: this repo's
`react-hooks/purity` rule **errors** on `Math.random()` inside a component-scoped function (which
is why `freshSlotId` and `randomDiscoverSlotKind` already live at module scope), and a pure
function is the only part of this that can actually be unit-tested.

Its rules, stated so they are not re-derived:
- **Order: `older` first, then `newer`** — chronological, matching the popover's own
  older→"earlier" / newer→"later" mapping.
- **Drop the anchor's own `stemCID`** so "adjacent" can never hand back the stem already in the
  slot.
- **Uniform random** over what is left. Not nearest-first: all four of these are randomisers (the
  dice icon on the desktop row says exactly that), and adjacency's value is "something else from
  that moment in that jam," not "the closest possible thing."
- Empty in, `null` out. Never throws.

**It does not increment the rolled counter.** The desktop's popover pick does not, and the two
counters the phone shows (`kept`, `rolled`) should keep meaning what they mean on the Mac.

## 1.5 Mute, and the peaks, in the pushed state

`src/shared/remoteState.ts`'s `remoteStateFromSlots` is the whole privacy boundary and it grows
two fields on `RemoteSlotView`:

```ts
muted: boolean            // !snapshot.audible
peaks: number[] | null    // 64 integers 0..100, or null when the stem has not been analysed yet
```

**`muted`, not `audible`.** The snapshot's own field is `audible` (`CoachSlotSnapshot.audible`,
`src/shared/coachClimax.ts:52`) because the guided flow asks "is this in the mix." The phone
shows a *mute state*, and inverting once at the boundary is better than the page inverting it at
four call sites.

**The peaks are genuinely available, and cost nothing.** Verified, not assumed:

1. Every resolved Discover slot already renders `<Waveform path={resolvedStem.path} …>`
   (`DiscoverPanel.tsx:4240`, and again at `:4273` for the colour layer).
2. `Waveform.tsx:3,39-46` reads `peekPeaks(path)` synchronously and falls back to `getPeaks(path)`.
3. `src/renderer/src/audio/peakCache.ts` is path-keyed and memoised, backed first by a
   **persistent** cross-session cache (`getStemPeaksCache`) and only then by a decode. It exposes
   `peekPeaks(path): number[] | null` — a synchronous read of the settled map — added precisely so
   a new consumer of an already-decoded path does not pay for a microtask, let alone a decode.

So the renderer's existing remote-push effect (`DiscoverPanel.tsx:1482-1493`) can call
`peekPeaks(stem.path)` for each slot and get 128 buckets that **some other part of the same
screen already computed**. No second decode, no new endpoint, no new IPC. When a peek comes back
`null` (the row mounted this tick and has not settled yet) the effect kicks
`void getPeaks(path).then(...)` to bump a small counter in state, which re-runs the push — and
that call is itself a cache hit the moment the row's own `<Waveform>` lands. This is the one
place in the design where the phone causes work on the Mac, and the work is a `Map.get`.

**Quantisation.** `quantiseRemotePeaks(peaks, buckets = 64)` — a new pure function in
`src/shared/remotePeaks.ts`: downsample by **max** (never average — an average of a drum hit and
the silence around it draws a quiet drum hit, same rule `peaksFromChannel` and the phone's own
`peaksFromBuffer` already follow), then scale to integers `0..100`. 128 → 64 because the page
draws ~64 buckets across a phone-width row and a 1:1 send would be twice the payload for
sub-pixel detail. 64 integers is roughly 200 bytes per slot; at the existing 700 ms poll and a
realistic six slots that is under 2 KB/s on a LAN, which is nothing.

**Is this a privacy regression?** No. The brief's inventory line — "it cannot see... waveforms of
individual stems" — was a statement of *fact about the current build*, not a rule. The rule, in
`remoteStateFromSlots`' own words, is **no path, no CID, nothing about the library**. Sixty-four
quantised amplitude buckets are not a path, do not identify a file, and cannot be turned back
into one. `remoteState.test.ts`'s two standing assertions (`JSON.stringify(state)` contains
neither `/Users/` nor the stem CID) keep holding, and gain a third: the peaks that leave are
integers in `0..100` and nothing else.

The signature becomes
`remoteStateFromSlots(slots, meta, peaksBySlotId?: ReadonlyMap<string, readonly number[]>)` —
keyed by **slot id**, not by path, so a path cannot enter the function through the new door
either.

---

# Piece 2 — the phone page, layout 1a

Only the **app state** of `src/main/remotePage.ts` is rewritten. `remoteNoticePage`, the pair
screen markup, `REMOTE_PAGE_CSP`, `acceptsHtml`, the two notice constants and the whole pairing
script are untouched.

## 2.1 What 1a is

A thumb console. Everything you use lives in the bottom third; everything you read lives at the
top; the middle is the loop, and it grows *upward* into the empty space as you add to it.

```
  sssketch                              kept 3 · rolled 41
  last kept · misty kestrel
  ┌────────────────────────────────────────────────────┐
  │                                                    │
  │              (empty, until there is more)          │
  │                                                    │
  │  drummy   │ wooden thud     ▁▃▇▅▂▇▃▁▂▅▇▃ │   x     │
  │  bassish  │ low slouch      ▂▂▅▃▂▂▅▃▂▂▅▃ │   x     │
  │  sparkly  │ glass ladder    ▁▂▁▄▁▂▁▄▁▂▁▄ │   x     │
  └────────────────────────────────────────────────────┘
  ┌────────────────────────────────────────────────────┐
  │                      new stem                      │   120px, 1px solid #ededed
  └────────────────────────────────────────────────────┘
  ┌───────────┐┌───────────┐┌──────────────────────────┐
  │   play    ││   keep  hold││        roll all        │   52px
  └───────────┘└───────────┘└──────────────────────────┘
                   mac playing
```

## 2.2 The top: four grey lines become two

Today the app state opens with four stacked grey lines: eyebrow `sssketch`, h1 `side quest`,
counts, and the kept-name. 1a collapses them:

- **Line 1**, a flex row: `sssketch` on the left (10px `#6a6a6a`), `kept N · rolled N` on the
  right (same size and colour).
- **Line 2**, the status line: a transient message for ~2000 ms, then falling back to
  `last kept · <name>`, or to nothing if nothing has been kept this session. 11px `#8f8f8f`,
  `min-height` reserved so the stack never jumps.

`side quest` leaves the app state. It stays on the pair screen, which is where it is doing work —
it is the name of the thing you are about to connect to. Once you are connected you are looking
at your own loop and the title is furniture.

`flash(text)` grows a rest state: instead of clearing to `''` after its timeout it calls
`restStatus()`, which writes `last kept · <name>` or `''`. The timeout goes from 1400 ms to
2000 ms — at arm's length in a dark room 1400 was short.

## 2.3 The rows, bottom-aligned

`.wrap` becomes a flex column with `min-height: 100dvh` (with a `100vh` line before it as the
fallback — iOS Safari's collapsing toolbar is exactly what `dvh` exists for), and the rows
container takes `margin-top: auto`. New stems therefore appear **nearest the thumb** and the
stack grows up into empty space. This is also why `duplicate` appending at the end (§1.1) is
right here and would have been wrong in a top-aligned list.

Each row is a grid: **`84px | 1fr | 44px`**, `min-height: 50px`, `background #0a0a0a`,
`border 1px solid #222222`, `margin-bottom: 6px`.

- **Column 1** — the kind label, 11px, coloured by the stem's sound type from the existing
  8-entry `TYPE_COLORS` table in `remotePage.ts`. The design's extra colours are stand-ins and
  are ignored; nothing is added to the palette.
- **Column 2** — the stem name (11px `#ededed`, ellipsised, one line) above **that stem's own
  waveform**: an 18px `<canvas>`, 64 buckets, drawn from the `peaks` array in the pushed state.
  Unresolved rows draw `…` for the name and a flat 1px rule for the waveform, which is what the
  master track already does when it has nothing (`remotePage.ts:563-566`).
- **Column 3** — the remove button. 44px wide, **48px tall** (it keeps its own tap target even
  though the row's minimum is 50px), label `x`, arming to `sure` on first tap exactly as the
  78px `remove` button does today. Two taps, because the phone has no undo. The 4-second lapse
  timer and the "disarm when the slot it points at is gone" guard both survive verbatim.

## 2.4 Muted rows: the absence of colour

**The house pattern, from `StemWaveformRow.tsx:325-360`**, in that file's own words: a grey
waveform layer at `var(--ra-text-3)` is drawn *always*; the full-colour layer sits on top and is
"suppressed entirely while muted, since mute always wins"; and the same comment explicitly
refuses opacity-dimming, keeping the shape "unclipped/full height, so the waveform reads normally
instead of looking dimmed." `ChannelRow.tsx:212` reinforces it — a muted channel reads by a
changed *background*, not just a coloured border. `RiserBlock.tsx:381` does use `opacity: 0.3`,
and is the exception: a riser is a drawn-in block, not a stem. The phone's slot rows are stems,
so `StemWaveformRow` is the pattern to follow.

**"Gray means quieter/off." Mute is expressed by removing colour, never by lowering opacity.**

The mapping onto the phone row falls out exactly, and it needs no new colour:

- **The kind label drops from its sound-type colour to `#6a6a6a`.** That is not an arbitrary
  grey — `#6a6a6a` is the hand-copied literal of `--ra-text-3` (`tokens.css:27`), which is
  precisely the colour the desktop's always-visible grey layer is drawn in. The muted phone row
  is the desktop's grey layer with the colour layer suppressed, using the same value.
- **The waveform becomes the grey layer too.** This overturns one assumption worth stating: the
  page's *master* waveform is monochrome on purpose, and its own comment says why — "this is the
  whole loop mixed down, not a typed stem, so there is no sound type for it to be the colour of"
  (`remotePage.ts:568-570`). A **per-stem** waveform is a typed stem, so it *does* have a colour,
  and it should carry it: a waveform is audio information, which is the one thing the tokens
  permit colour on. So an audible row's waveform is drawn in `TYPE_COLORS[soundType]`; a muted
  row's is drawn in `#6a6a6a`. One canvas, one colour resolved from the mute flag — there is no
  second layer to draw and no clip-path hole to punch, because the phone has no per-slot gain
  control and never will (§1.3).
- **Nothing else changes.** The name stays `#ededed`, the border stays `#222222`, the background
  stays `#0a0a0a`, the `x` stays exactly as it was, and both gestures keep working. A muted row
  is present and rollable — it is a stem you are not listening to, not a stem you deleted. No
  opacity, no hatch, no strikethrough, no badge.

Unresolved rows use `#6a6a6a` for the kind label as well, which is correct by the same logic:
there is no sound type yet, so there is no colour to spend.

## 2.5 No master waveform

1a has none, and the stack of per-stem waveforms is the picture instead. (The design's prose
mentions a 236px master waveform that doubles as a play toggle; its own markup has none. Going
with the markup.)

So `#track`, `#wave`, `WAVE_BUCKETS`, `peaksFromBuffer`, `setWavePeaks`, `clearWavePeaks`,
`drawWave`, `wavePeaks`/`wavePeaksLoopId`/`waveDrawnCol`/`waveDirty` and `markWaveDirty` all go.
Roughly 90 lines of the 2026-09-26 loop-audio work is deleted, deliberately.

**The playhead survives, and must.** It is the only motion on the page and it is how you know the
phone is actually playing. It becomes a single 1px `#c56164` line absolutely positioned across
the *rows container* (which gains `position: relative`), driven by the same `tick()` /
`audioCtx.currentTime` clock as now, hidden whenever nothing is sourced. Unclickable in the same
two independent ways as today — `pointer-events: none` and no listener of any kind. **It is an
indicator. Do not add a seek.** `tick()` loses its per-column redraw bookkeeping and just moves
`lineEl.style.left`.

## 2.6 Two gestures on one row

**Short tap → mute/unmute. Long press (450 ms) → the stem action sheet.** This is the one real
interaction hazard on the page and the arbitration is specified exactly:

State per in-flight press: `holdSlotId`, `holdTimer`, `holdFired`, `holdMoved`, `holdX`, `holdY`.

- **`pointerdown` on the row.** Guard first: `if (e.target.tagName === 'BUTTON') return` — the
  `x` lives inside the row's grid and must start neither gesture. Then record `holdX`/`holdY`
  from `e.clientX`/`e.clientY`, clear `holdFired`/`holdMoved`, and start a 450 ms timer.
- **The timer fires** → `holdFired = true`, a 10 ms haptic, and the action sheet opens for that
  slot. The haptic is guarded: `if (navigator.vibrate) { try { navigator.vibrate(10) } catch (e) {} }`
  — iOS Safari does not implement it, and an unguarded call on a browser that half-implements it
  throws.
- **`pointermove`** → if `Math.abs(e.clientX - holdX) > 10 || Math.abs(e.clientY - holdY) > 10`,
  cancel the timer and set `holdMoved = true`. Ten pixels: a scroll starts well inside that, a
  stationary thumb never leaves it.
- **`pointercancel` / `pointerleave`** → cancel the timer, set `holdMoved = true`. The scroll the
  browser stole must not come back as a mute.
- **`pointerup`** → cancel the timer; **if `holdFired || holdMoved`, do nothing.** Firing the long
  press must not also fire the tap on release, and this is the line that guarantees it. Otherwise
  it is a tap: send `{ slotId, action: 'mute' }`.
- **The row carries no `click` listener at all.** There is no click/pointerup double-fire to
  suppress, which matters because the page **may not call `preventDefault()`** — see §2.10.
- **An unresolved row (no stem name) does neither**, matching the desktop's `hasStemToActOn`
  guard on its own mute button.

**iOS selection.** A 450 ms press on text raises the selection callout and the magnifier. That is
suppressed in **CSS**, not JS: `.row { -webkit-user-select: none; user-select: none;
-webkit-touch-callout: none; }`. `touch-action: manipulation` is already global and stays.

**The tap paints optimistically.** The poll is up to 700 ms behind, and a mute you cannot hear
land is indistinguishable from a tap that missed. So the tap flips `muted` on the local row
immediately, re-renders, and lets the next poll correct it. `renderRows`' change key must include
each row's `muted` (and its `peaks`) or the optimistic paint is swallowed by the
`if (key === lastRowsKey) return` guard that exists to stop a poll eating a tap.

## 2.7 `new stem`, and the kind picker as a bottom sheet

A **120px, full-width** `new stem` button sits directly under the stack. It is the **only
`#ededed`-bordered control on the page** — that is its entire hierarchy, in a typeface that has
no bold. It inverts on press (`background #ededed`, `color #050505`).

Tapping it opens the kind picker as a **bottom sheet**: an overlay at `rgba(5,5,5,0.72)` with a
panel on `#0a0a0a` and a `#3a3a3a` top border, anchored to the bottom with
`padding-bottom: env(safe-area-inset-bottom)`. Inside:

- eyebrow `what kind`, then the 3 mask chips
- eyebrow `what it feels like`, then the 4 trait chips
- a two-up row: `never mind` · `add slot`

Chips keep everything they have today: 42px min-height, three per row, 10px type, inverting when
lit, and — critically — **`pendingMask = KIND_TOGGLE[pendingMask][index]` remains the only thing
that ever computes a selection.** The embedded table is `buildSlotKindToggleTable()`, built by
calling the real `toggleSlotKind`, and `remotePage.test.ts` asserts there are exactly three
writes to `pendingMask` in the whole script. The sheet must not add a fourth. `never mind` closes
without clearing the selection; `add slot` is the existing handler unchanged, including
`if (kinds.length === 0) return` and `api('/api/add-slot', { kinds: kinds })`.

The old collapsed/expanded `picker-toggle` mechanism goes away — a sheet is its own collapse.
The empty-state line (`pick what you want below, then add it`) stays, in the empty space above
the stack, pointing at the `new stem` button. It says what to do next rather than reporting
emptiness, which is the property its test guards.

## 2.8 The three-up row, and hold-to-keep

Below `new stem`, a 52px three-up row: **`play` · `keep` · `roll all`**.

`play` and `roll all` are the existing handlers, unchanged; `play` still owns the iOS
user-gesture AudioContext creation and must stay a plain click handler for that reason.

**`keep` is hold-to-keep, 700 ms.** Keeping is the one irreversible-feeling thing on the page and
it is now sitting under a thumb that is also tapping rows to mute them.

- A `<span class="fill">` inside the button, `position: absolute; left: 0; top: 0; bottom: 0;
  width: 0; background: #ededed`. On `pointerdown`: `transition: width 700ms linear`, then
  `width: 100%`. On any cancel: `transition: none; width: 0`.
- The label sits above it in a `<span>` with `mix-blend-mode: difference`, and the button gets
  `isolation: isolate` so the blend is scoped to the button. White-on-black text over a sweeping
  white fill inverts to black-on-white as the fill passes under it. **It is an inversion, not a
  colour** — the fill is `#ededed`, which is already the page's text colour.
- A small `hold` hint sits beside the label, 9px `#6a6a6a`.
- At 700 ms: `api('/api/keep', {})`, a 10 ms haptic (same guard), `flash('kept')`, reset the fill.
- Cancelled by `pointerup` before 700 ms, by `pointerleave`, by `pointercancel`, and by a move
  beyond the same 10px slop. Same arbitration shape as the row, so there is one mental model on
  the page and not two.

## 2.9 The stem action sheet

Same bottom-sheet treatment as the kind picker — same overlay, same panel, same top border, so
"a sheet came up from the bottom" means one thing.

- A header: the slot's kind label (in its sound-type colour, or `#6a6a6a` when muted — it is the
  same row, so it reads the same way) and the stem name under it.
- A **2×2 grid of 64px buttons**: **similar** · **adjacent** · **random** · **duplicate**, each
  with a small hint line under the label at 9px `#6a6a6a`:
  - `similar` — `another like it`
  - `adjacent` — `same jam`
  - `random` — `anything at all`
  - `duplicate` — `one more row`
- `never mind` underneath, full width.

Each button POSTs `{ slotId, action }` to `/api/slot-action`, closes the sheet, and flashes one
word on the status line: `rolling`, `nearby`, `rolling`, `copied`. Per §1.4, an `adjacent` with
nothing nearby leaves the row alone; the Mac cannot report that back over this surface, so the
flash says `nearby` on the way out and the row simply does not change — which, given the row is
still playing the stem you were already listening to, reads correctly.

**All four are offered on every resolved row, including a locked one**, because that is what the
desktop does (§1.2). `adjacent` is offered even when the Mac would find nothing; the desktop
hides the button in that case, but the desktop knows `nearbyAnchor` and the phone deliberately
does not know anything about the library. Hiding it would require shipping a "has a riff anchor"
flag to the phone for no gain over a no-op.

Only one sheet can be open at a time; opening either closes the other. A row that vanishes from
under an open action sheet closes it, the same way an armed remove disarms when its slot is gone.

## 2.10 The foot, and the thing the design asked for that the page will not do

The foot line is centred, 10px `#6a6a6a`.

The design asks for `mac mini · <interface>`. **The page will not say that**, and the reason is
the same principle the Host guard is built on: `REMOTE_WRONG_ADDRESS_NOTICE` deliberately refuses
to name the address it expected, because "something reaching this server under the wrong name
learns nothing about it." A machine name and an interface name are not addresses, but they are
new facts about the Mac leaving it, for decoration. The page has never had them and
`RemoteState` has no field for them.

So the foot keeps the existing `macEl` semantics, moved down and centred: it shows `mac playing`
while the Mac's own transport is running and nothing otherwise. That is the one fact about the
Mac the page already has, it is genuinely useful (it explains why you can hear two things at
once — the phone's audio and the Mac's are independent on purpose), and it costs nothing.

## 2.11 Constraints that bound every line of the page

Restated because they are all load-bearing and a rewrite is exactly when they get lost:

- **CSP is fixed and unchanged.** `default-src 'none'` and no `img-src`: **no images at all,
  not even a data: URI.** Canvas, CSS and text only. No external anything, no iframes, no forms,
  no `<base>`.
- **Silkscreen, embedded base64, no bold and no italic.** Hierarchy comes from size, colour,
  spacing and inversion only.
- **`* { border-radius: 0 }`** stays global. **`touch-action: manipulation`** stays global.
- **The palette, and nothing added to it:** ground `#050505`, raised `#0a0a0a`, text `#ededed`,
  secondary `#8f8f8f`, eyebrow `#6a6a6a`, border-strong `#3a3a3a`, border `#222222`, playhead
  `#c56164`, and the 8-entry sound-type table already in the file.
- **The script dialect: no arrow functions, no `??`, no `?.`.** Enforced by
  `src/main/remotePage.test.ts`.
- **No `preventDefault` anywhere in the script.** `remotePage.test.ts`'s "last resort" block
  asserts `expect(SCRIPT).not.toContain('preventDefault')` over the *entire* script, not just the
  error listener. This is why §2.6's selection suppression is CSS and why the row has no click
  listener.
- **Copy: lowercase, no emoji, no exclamation marks, buttons two words maximum or an icon.**
- **Tap targets ~42px minimum** even where the type is 10px.
- **390×844, iOS Safari and Brave, `env(safe-area-inset-*)` top and bottom.**

## 2.12 What the existing page tests force

`remotePage.test.ts` is the only automated coverage this string has, and a rewrite must land
against it rather than around it. The assertions that survive verbatim and must not be weakened:

- exactly one `fetch('/api/pair'` in the whole page, and the QR query-param regex
- `history.replaceState(null, '', location.pathname)`
- the embedded `buildSlotKindToggleTable()` JSON, `pendingMask = KIND_TOGGLE[pendingMask][index]`,
  and **exactly three** `pendingMask = ` writes
- every kind's `"l"` label and `"k"` value
- `if (kinds.length === 0) return` and `api('/api/add-slot', { kinds: kinds })` as the only add
- `api('/api/remove-slot', { slotId: slot.id })` as the only remove, still two-tap, still lapsing
  (`armedRemoveTimer = setTimeout(`), still disarming on a vanished slot (`if (!stillThere) disarmRemove()`)
- `if (key === lastRowsKey) return`
- `pick what you want below, then add it`, and neither `no slots` nor `nothing here`
- every button label lowercase, no `!`, two words maximum
- `id="broke" hidden`, `window.addEventListener('error'`, and **no `preventDefault`**

Assertions that must change, and why:
- `drop.textContent = armed ? 'sure' : 'remove'` → `'sure' : 'x'`. The 78px `remove` becomes the
  44px `x` of the 1a grid; `sure` still fits in 44px at 10px Silkscreen.
- The runtime-label list `['stop', 'play', 'sure', 'remove']` → `['stop', 'play', 'sure', 'x']`.
- The button-label regex is `<button[^>]*>([^<]*)</button>` and so **cannot see a button
  containing elements**. `keep` now contains a fill span and a hint span, so it drops out of that
  scan silently. Its labels (`keep`, `hold`) go in the runtime list explicitly so the two-words
  rule still covers them, and the same applies to any row-built button.
- `pickerEl.hidden = false`, `emptyEl.hidden = state.slots.length > 0` and
  `loopEl.hidden = state.slots.length === 0` describe the old always-visible picker and the old
  `#loop` block. 1a keeps `#empty` with the same rule, drops the always-visible picker (the sheet
  replaces it) and keeps a `#loop` wrapper around the three-up row with the same hidden rule —
  `play`, `keep` and `roll all` still act on a loop that does not exist until there is a slot, and
  three dead buttons are what made the first screen feel like a dead end. The `new stem` button
  stays visible at all times: it is the one thing you *can* do with nothing on screen.

New assertions worth having, all of them things that would silently break:
- the gesture arbitration exists at all: the 450 ms timer, the `holdFired || holdMoved` bail on
  `pointerup`, the `e.target.tagName === 'BUTTON'` guard, and the 700 ms keep timer
- `/api/slot-action` is posted with an action from the enumerated five and nothing else
- `navigator.vibrate` is guarded rather than called bare
- the page contains no `<img` and no `url(data:image`

---

## Not now

Named so the boundary is a boundary. If it is not above, it is out.

- **No new desktop UI.** Not a fifth action, not a relabel, not a reorder of the 15-track row.
  The desktop already has what Elling asked for.
- **No change to what `similar`, `random` or `duplicate` mean.** Their labels are looser than
  their behaviour in places (`similar` is "same kind," not "near this stem"; `duplicate` is an
  exact clone, not a fresh roll). If Elling wants those reshaped, that is its own conversation
  with its own spec — doing it inside a "put them on the phone" change would ship a behaviour
  change he did not ask for, to the surface he uses most.
- **No per-slot gain, lock, solo, favourite, chaos, matching dial, roll filters, undo/redo,
  reclassify or match meter on the phone.** Every control competes with the verbs that matter on
  a thumb-sized screen.
- **No phone-side kind editing of an existing slot.** Add and remove only, as today.
- **No seek on the playhead.**
- **No machine name or interface name over the wire** (§2.10).
- **No native-engine change.** Nothing here reaches `native-engine/`. If an implementer concludes
  otherwise, stop and report it.
- **No `vitest.config.ts` change.** Nothing here opens a database.
