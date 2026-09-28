# Performance mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `perform` mode inside Discover where every slot has a warmed candidate on deck, a tap
arms it, and it lands on the top of the loop — with radio still running the layers you did not arm.

**Architecture:** Two phases, each landing on its own. **Phase 1 is the deck**: one pure module
(`src/shared/performanceDeck.ts`) holding the card state machine and the set arithmetic, plus
wiring in `DiscoverPanel.tsx` that reuses the calls radio already makes — `pickForSlot`,
`resolveCandidateStem`, `commitSlotPick` — and lands on the `wrapped` field `advanceRadioClock`
already returns. **Phase 2 is the cue**: pre-listening a card through the renderer's own shipped
Web Audio loop player (`src/renderer/src/audio/previewLoop.ts`) on a second output device, which
needs no engine work at all. No new scheduler, no new IPC, no new engine message.

**Tech Stack:** TypeScript, React 19, Electron renderer, Web Audio, vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-performance-mode-design.md` (2026-09-28). Its §8 "not
now" list is the scope boundary — **if something is not named as in, it is out.**

**Elling's brief, verbatim:** *"i'm pretty excited about this... i think this could even become a
live performance thing... with a 'queue' of upcoming stems presented to the user to preview, and
then selecting the next one, and having the radio handle the transitions ... or having a
'transition at next wrap' trigger or something."*

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. This was established
by reading it, not assumed — see Finding 4, and the spec's §2.2 for the full cost of the thing
that is being avoided. `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md)
and **this plan changes neither.** If you conclude a native-engine change is needed, **STOP and
report it rather than planning one.**

**THIS PLAN RUNS AFTER `docs/superpowers/plans/2026-09-28-radio-controls.md`.** That plan is
modifying the same two files (`src/shared/radioSchedule.ts`, `DiscoverPanel.tsx`) right now.
Rebase onto it, do not race it. Finding 2 is the one interface point between them.

**Baseline (verified on `master`, 2026-09-28, commit `85e482e`, by running it):**

```
Test Files  198 passed (198)
     Tests  3165 passed (3165)
```

`npm run typecheck` reports 0 errors. `npm run lint` reports 0 errors and **4 pre-existing
prettier warnings** — those 4 are the baseline, not something to fix and not something to add to.

> **The absolute test counts quoted in later tasks (199 files / 3193 tests / 3201 tests) are
> relative to that `85e482e` baseline and assume nothing else landed in between.** The
> radio-controls plan adds test files of its own, so if it lands first — and it should — those
> numbers will be higher. **Re-measure `npm test` on whatever commit you actually start from and
> treat that as the baseline.** The invariant this plan is accountable for is the *delta*: **one
> new test file** (`src/shared/performanceDeck.test.ts`), **28 new tests** by the end of Phase 1
> and **36** by the end of Phase 2, and **zero tests newly failing**. Check the delta, not the
> total.

**`src/main/remoteServer.test.ts` (10 tests) is FLAKY in the full parallel run and green in
isolation** — it binds a real HTTP port and a colliding worker takes the whole file down. If the
full suite reports failures only in that file, re-run it alone
(`npx vitest run src/main/remoteServer.test.ts`) and treat a clean isolated run as green. **No
other file may fail.**

---

## Findings that shaped this plan — read these before Task 1

1. **The deck already exists internally.** `armRadioPick` (`DiscoverPanel.tsx:2293-2311`) already
   calls `pickForSlot` for the next slot and then `resolveCandidateStem(pick.candidate)`,
   **discarding the promise on purpose** to warm the module-level `resolvedCandidateCache`
   (`:95`, keyed `` `${riffCID}:${stemCID}` ``). Its doc comment: *"The warm is the load-bearing
   half … Without it a radio change would land hundreds of milliseconds -- or a whole download --
   after the downbeat it was scheduled for."* **The deck is those same two calls, run per slot
   instead of once, with the result rendered.** Do not write a second picker.

2. **`advanceRadioClock` returns `wrapped` and `due` as separate fields, and this plan uses
   `wrapped`.** After the radio-controls plan's Task 3 the signature is
   `advanceRadioClock(clock, pos, loopBars, gridBars?)` and `due` is gated on a grid boundary, but
   `wrapped` still means one thing only: the preview loop restarted (`pos` decreased). That plan's
   own Task 8 already reads `step.wrapped` to place a drop-out, so this is precedent. **A launched
   change lands on `wrapped`. Radio lands on `due`. Never mix them** — the whole point of a launch
   is that it lands on the top of the loop the re-one tool curated, not on an arbitrary grid cell.

3. **A landing is a stem change, not a rhythmic gesture, and that distinction is already settled.**
   `docs/superpowers/specs/2026-09-28-radio-controls-design.md` §0A.1 disqualifies firing a
   *gesture* from the 30 Hz React tick and says why, and §0A.1 also says a *stem change* from the
   tick is accepted: *"a new texture arriving 40 ms late still reads as arriving."* Radio ships
   that today. **This plan adds no audio-timing mechanism. Do not add one, and do not "improve"
   the existing one.**

4. **The engine cannot cue, and finding that out is done.** One `AudioDeviceManager`
   (`Transport.h:224`), opened `initialiseWithDefaultDevices(1, 2)` (`Transport.cpp:49`); the
   device callback returns early below two output channels and never touches a third
   (`Transport.cpp:450-454`); every channel is summed unconditionally into one master pair
   (`PlaybackEngine.cpp:668-680`); `renderBlock(float*, float*)` (`PlaybackEngine.h:61`) and
   `PluginChain::process(int, float*, float*)` (`PluginChain.h:150`) are hard stereo; one
   transport, one project (`Main.cpp:239-252`). Zero occurrences of `cue`, `pre-listen`,
   `audition` or `monitor bus` in any C++ source. **Phase 2 does not need any of this** — see
   Finding 5.

5. **The renderer already has a second audio path, shipped and in daily use.**
   `getAudioContext()` (`src/renderer/src/audio/peakCache.ts:171`) and `startPreviewLoop` /
   `stopPreviewSources` (`src/renderer/src/audio/previewLoop.ts`) — a gapless multi-stem Web Audio
   loop player with a baked loop micro-fade and `loopStart`/`loopEnd` pinned to `durationSec`.
   Shelf, LibraryBrowser, ProjectLibraryBrowser and BeatPicker all play through it. It goes to the
   **system default output**; the engine goes to whatever `set-output-device` was pointed at, via
   the already-shipped `AudioDeviceModal.tsx` / TransportBar settings menu. **Two devices, already
   separately addressable. That is the cue.**

6. **`useThrowawayStemPreview` is not a cue path and must not be used as one.** It calls
   `claimEngine('tidy-up-library-preview')` — an exclusive token — replaces `state.rifffs`
   entirely and loads the result. Its own doc comment makes the exclusivity a requirement:
   *"starting one stops the previous one entirely … Neither path may regress to letting a previous
   audition ring on underneath a new one"* (a real reported bug). Touching it would stop the live
   mix. **Leave it alone.**

7. **`commitSlotPick` is a functional `setSlots`, so N launches in one tick are one project load.**
   `setSlots((prev) => prev.map(...))` (`:2086`) composes; one state update is one render; the
   preview sync is rAF-coalesced (`scheduleSyncPreviewToEngine`, `:652`). And `load-project`
   **preserves the transport position** — its handler (`IpcServer.cpp:220-273`) never calls
   `transport.setPosition`. So "a whole new bed lands together" needs nothing built for it. **Call
   `commitSlotPick` once per landing slot, synchronously, in the same tick.**

8. **Eligibility now lives in `src/shared/`, and `armed` does NOT belong in it.**
   `isRadioEligibleSlot(slot)` (`src/shared/radioSchedule.ts:167`) was extracted on 2026-09-28
   fixing a live report (*"if i start radio with stems already there.. it seems to not
   transition"*) — a seeded slot carries `seedStem` and no `candidate`. Its doc comment: *"so the
   next thing that needs to ask 'may radio touch this layer' cannot get a third answer."* Being
   armed is a performance-mode fact, not a turnability fact. **Compose it one level up, in
   `radioEligibleSlotIds()` (`:2270`), so radio with performance mode off is bit-identical.**

9. **Radio must NOT call `rerollSlot`.** `rerollSlot` (`:1834`) calls `pushUndoSnapshot()`. Radio
   commits through `commitSlotPick` directly, exactly as `rerollAll` bypasses the wrapper. **A
   launch and a `put back` are performances, not edits. Neither writes undo history.**

10. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Tasks 4–8 and 11–12
    have **no component tests**, deliberately. They are verified by `npm run typecheck`,
    `npm run lint` and the suite staying green, then by Elling. **This environment has no GUI and
    no audio output** — do not claim a card was tapped, a change was heard on the one, or a cue was
    audible in headphones.

11. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React
    effect (`react-hooks/set-state-in-effect`; the established workaround is deferring through
    `void Promise.resolve().then(...)`), on render-time impurity (`react-hooks/purity` — no
    `Math.random()`, `Date.now()` or `performance.now()` inside a component-scoped function), and
    requires an **explicit return type on every function**, inline ones included. Prettier:
    `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

12. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`): near-black monochrome,
    Silkscreen, **no `border-radius` anywhere**, lowercase copy, no emoji, no exclamation marks,
    colour only on things carrying audio information. **Buttons are two words maximum or an icon.
    Tooltips are two or three words.** One `data-tooltip="…"` per node, never alongside `title`.
    The only colour this feature adds anywhere is a card's waveform, via `typeColorVar(stem.type)`.

13. **The slot row's grid is off limits.** `DiscoverPanel.tsx:4105` is a 15-track
    `gridTemplateColumns` with explicit `gridColumn` on every child and a 40-line doc comment
    (`:4067-4104`) about the bug class that renumbering causes — and the radio-controls plan is
    claiming track 6 for its `hook` toggle. **Add no track and move no child.** The deck goes in a
    sibling sub-row below the row's grid, using `--ra-bg-row-sub` (`#0e0e0e`, defined in
    `tokens.css` as "expanded stem sub-row").

14. **The stretch ratio formula, needed by Phase 2.** `buildEngineProject.ts:439-446`:
    `secPerBarAtProjectTempo = (60 / bpm) * 4`, `stemNativeSecPerBar = durationSec / barLength`,
    `ratio = stemNativeSecPerBar / secPerBarAtProjectTempo`, and a resolve is skipped entirely when
    `Math.abs(ratio - 1) < 0.001` (`:458`). **The cue must use this, or every cue is at the wrong
    tempo** — which is the single most likely way to build Phase 2 and have it be useless.

15. **`ResolvedCandidateStem` is not a `Stem`.** It is `{ author, name, type, path, durationSec,
    barLength, creationTime? }` (`DiscoverPanel.tsx:82-94`). So the card's waveform colour is
    `typeColorVar(stem.type)`, **not** `stemColorVar(...)` — that one takes a `Stem` and is what
    the row itself uses at `:4450`. Add `typeColorVar` to the existing
    `import { stemColorVar } from '../theme/typeColor'`.

16. **No Web Audio under vitest.** `src/renderer/src/audio/analyzeStemOnce.test.ts` opens with
    *"No OfflineAudioContext / Worker under vitest's node environment"*. That is why Phase 2's only
    testable piece (`cueStartOffsetSec`) lives in `src/shared/performanceDeck.ts` and why
    `cueLoop.ts` has no test file. **Do not create `cueLoop.test.ts`.**

## Known limits, accepted on purpose (do not "fix" these)

- **A launch lands tens of milliseconds after the loop top** — a React render, an rAF,
  `buildEngineProject`, one `engineLoadProject` round trip. Same as every radio change since
  2026-09-26. Finding 3.
- **There is no pre-listen in Phase 1.** `put back` is the answer, and it is a deliberate one
  (spec §2.5).
- **A cue is not phase-locked to the engine** and drifts within a lap. It is re-anchored on every
  wrap, which bounds it. Good enough to judge a stem, not to judge tightness. Spec §2.3.
- **A cue is the raw stretched stem** — no plugins, no reverb, no master chain.
- **Nothing is persisted.** No `DiscoverSettings` field, no migration, no `vitest.config.ts`
  change. Slot ids are minted fresh each session so a stored arm would name a slot that is gone.
- **Entering performance mode fires one `pickForSlot` per slot at once.** Not new — the `similar
  all` button (`rerollAll`, `:2253`) already does exactly this.

## File map

| File | Change |
|---|---|
| `src/shared/performanceDeck.ts` | **NEW** — `DeckCardStatus`, `DeckCardState`, `PerformanceAutopilot`, `PERFORMANCE_AUTOPILOT_OPTIONS`, `DEFAULT_PERFORMANCE_AUTOPILOT`, `deckCardStatus`, `isArmable`, `nextArmedSet`, `prunedArmedSet`, `landingSlotIds`, `radioEligibleUnderPerform`, `cueStartOffsetSec` |
| `src/shared/performanceDeck.test.ts` | **NEW** — full TDD |
| `src/renderer/src/audio/cueLoop.ts` | **NEW** (Phase 2) — start/stop one cue voice on the shared `AudioContext`. No test file (Finding 16). |
| `src/renderer/src/components/DiscoverPanel.tsx` | the `perform` button, the `autopilot` chips, the deck state + refill, the sub-row card, arm/disarm/skip, the wrap landing, `put back`, the `cue` chip |

**Nothing else is touched. No file is deleted. `vitest.config.ts` is NOT edited. `native-engine/`
is NOT edited. `src/main/` is NOT edited. `src/preload/` is NOT edited.**

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/performanceDeck.test.ts   # one file
npm test                                            # full suite
npm run typecheck
npm run lint
```

---

# Phase 1 — the deck

Tasks 1 through 9. At the end of Task 9 the app has a usable performance instrument with no cue
and no phone.

---

## Task 1: The card state machine

**Files:**
- Create: `src/shared/performanceDeck.ts`
- Create: `src/shared/performanceDeck.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/performanceDeck.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERFORMANCE_AUTOPILOT,
  PERFORMANCE_AUTOPILOT_OPTIONS,
  deckCardStatus,
  isArmable,
  type DeckCardState
} from './performanceDeck'

function card(overrides: Partial<DeckCardState> = {}): DeckCardState {
  return { slotId: 'slot-1', hasCandidate: true, resolved: true, armed: false, ...overrides }
}

describe('performance autopilot', () => {
  it('offers exactly auto and hold, in that order', () => {
    expect(PERFORMANCE_AUTOPILOT_OPTIONS).toEqual(['auto', 'hold'])
  })

  it('defaults to auto, so doing nothing leaves radio as it was', () => {
    expect(DEFAULT_PERFORMANCE_AUTOPILOT).toBe('auto')
  })
})

describe('deckCardStatus', () => {
  it('is picking while no candidate has come back yet', () => {
    expect(deckCardStatus(card({ hasCandidate: false, resolved: false }))).toBe('picking')
  })

  it('is warming once there is a candidate but no resolved stem', () => {
    expect(deckCardStatus(card({ hasCandidate: true, resolved: false }))).toBe('warming')
  })

  it('is ready only when the stem is resolved', () => {
    expect(deckCardStatus(card())).toBe('ready')
  })

  it('stays picking if a resolved flag somehow arrives without a candidate', () => {
    // Defensive: resolution is always downstream of a candidate, so this
    // pairing is nonsense. It must not read as ready.
    expect(deckCardStatus(card({ hasCandidate: false, resolved: true }))).toBe('picking')
  })
})

describe('isArmable', () => {
  it('is true for a ready card', () => {
    expect(isArmable(card())).toBe(true)
  })

  it('is false while warming -- the whole guarantee that a launch lands together', () => {
    expect(isArmable(card({ resolved: false }))).toBe(false)
  })

  it('is false while picking', () => {
    expect(isArmable(card({ hasCandidate: false, resolved: false }))).toBe(false)
  })

  it('is true for an already-armed ready card, so a second tap can disarm it', () => {
    expect(isArmable(card({ armed: true }))).toBe(true)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: FAIL — `Failed to resolve import "./performanceDeck"`.

- [ ] **Step 3: Implement**

Create `src/shared/performanceDeck.ts`:

```ts
// src/shared/performanceDeck.ts
//
// Performance mode's pure half -- docs/superpowers/specs/2026-09-28-
// performance-mode-design.md. Radio is "leave it running"; performance
// mode is "play it": every slot has a warmed candidate on deck, a tap arms
// it, and it lands on the top of the loop.
//
// Everything schedulable about WHEN already lives in radioSchedule.ts and
// is not duplicated here -- a launch lands on the `wrapped` field
// advanceRadioClock already returns, while radio lands on `due` (spec
// 0.2). What lives here is the card state machine and the set arithmetic
// around arming, which is where the correctness rules are and therefore
// where the tests need to be.

/** A card's three states. `warming` is visible and NOT tappable: if an
 * unresolved card could be armed, a four-slot launch would land three
 * stems at the wrap and the fourth whenever its download finished, which
 * is the exact failure "land on the one" exists to prevent (spec 3.2). */
export type DeckCardStatus = 'picking' | 'warming' | 'ready'

/** Whether radio keeps turning unarmed layers over while performance mode
 * is on. Literal values double as their own UI text, the same convention
 * RADIO_PACE_OPTIONS uses, so there is no label table. */
export type PerformanceAutopilot = 'auto' | 'hold'

export const PERFORMANCE_AUTOPILOT_OPTIONS: PerformanceAutopilot[] = ['auto', 'hold']

/** `auto` is the default because doing nothing must leave radio exactly as
 * it was -- performance mode sits on top of the bed rather than replacing
 * it (spec 4). */
export const DEFAULT_PERFORMANCE_AUTOPILOT: PerformanceAutopilot = 'auto'

/** One slot's card, as far as the pure logic cares. Deliberately carries no
 * DiscoverCandidate and no ResolvedCandidateStem: both live in the
 * renderer/main boundary, and this module stays importable from anywhere. */
export interface DeckCardState {
  slotId: string
  /** pickForSlot has returned a non-null candidate for this card. */
  hasCandidate: boolean
  /** resolveCandidateStem has settled with a real stem for that candidate. */
  resolved: boolean
  armed: boolean
}

export function deckCardStatus(card: DeckCardState): DeckCardStatus {
  if (!card.hasCandidate) return 'picking'
  return card.resolved ? 'ready' : 'warming'
}

/** Whether a tap on this card may do anything at all. An already-armed
 * card is armable because the second tap disarms it -- cancelling must
 * always be free (spec 3.1). */
export function isArmable(card: DeckCardState): boolean {
  return deckCardStatus(card) === 'ready'
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/performanceDeck.ts src/shared/performanceDeck.test.ts
git commit -m "a card is picking, warming, or ready -- and only ready can be armed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 2: Arming and pruning the armed set

**Files:**
- Modify: `src/shared/performanceDeck.ts`
- Modify: `src/shared/performanceDeck.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/performanceDeck.test.ts` (and extend the import list at the top with
`nextArmedSet` and `prunedArmedSet`):

```ts
describe('nextArmedSet', () => {
  it('arms a ready card that was not armed', () => {
    const armed = new Set<string>()
    expect([...nextArmedSet(armed, card({ slotId: 'a' }))]).toEqual(['a'])
  })

  it('disarms a card that was armed', () => {
    const armed = new Set(['a', 'b'])
    expect([...nextArmedSet(armed, card({ slotId: 'a', armed: true }))]).toEqual(['b'])
  })

  it('arms several slots independently -- the whole-new-bed move', () => {
    let armed: ReadonlySet<string> = new Set<string>()
    armed = nextArmedSet(armed, card({ slotId: 'a' }))
    armed = nextArmedSet(armed, card({ slotId: 'b' }))
    armed = nextArmedSet(armed, card({ slotId: 'c' }))
    expect([...armed].sort()).toEqual(['a', 'b', 'c'])
  })

  it('refuses to arm a warming card', () => {
    const armed = new Set<string>()
    expect([...nextArmedSet(armed, card({ slotId: 'a', resolved: false }))]).toEqual([])
  })

  it('returns the SAME set when nothing changed, so React does not re-render', () => {
    const armed = new Set<string>()
    expect(nextArmedSet(armed, card({ slotId: 'a', resolved: false }))).toBe(armed)
  })

  it('still disarms a card that stopped being ready while it was armed', () => {
    // A stem can un-resolve (a cache eviction, a failed re-resolve). Being
    // unable to CANCEL would be much worse than being unable to arm.
    const armed = new Set(['a'])
    expect([...nextArmedSet(armed, card({ slotId: 'a', armed: true, resolved: false }))]).toEqual(
      []
    )
  })
})

describe('prunedArmedSet', () => {
  it('drops arms for slots that no longer exist', () => {
    const armed = new Set(['a', 'gone'])
    expect([...prunedArmedSet(armed, ['a', 'b'])]).toEqual(['a'])
  })

  it('returns the SAME set when every arm is still live', () => {
    const armed = new Set(['a', 'b'])
    expect(prunedArmedSet(armed, ['a', 'b', 'c'])).toBe(armed)
  })

  it('handles an empty armed set without allocating', () => {
    const armed = new Set<string>()
    expect(prunedArmedSet(armed, [])).toBe(armed)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: FAIL — `nextArmedSet is not exported by ./performanceDeck` (or `is not a function`).

- [ ] **Step 3: Implement**

Append to `src/shared/performanceDeck.ts`:

```ts
/** Toggle one slot's arm.
 *
 * Disarming is ALWAYS allowed, even for a card that stopped being ready
 * while it was armed -- being unable to cancel is much worse than being
 * unable to arm, and a stem can un-resolve (a cache eviction, a failed
 * re-resolve). Arming is allowed only for a ready card (isArmable).
 *
 * Returns the SAME set reference when nothing changed. This matters: the
 * armed set is React state read by every row, and a fresh Set on every
 * ignored tap would re-render the whole panel for nothing. */
export function nextArmedSet(
  armed: ReadonlySet<string>,
  card: DeckCardState
): ReadonlySet<string> {
  if (armed.has(card.slotId)) {
    const next = new Set(armed)
    next.delete(card.slotId)
    return next
  }
  if (!isArmable(card)) return armed
  const next = new Set(armed)
  next.add(card.slotId)
  return next
}

/** Drop arms for slots that have since been removed.
 *
 * Called on every commit, the same way the radio-controls spec prunes its
 * own recency map, and for the same reason: a removed slot's entry would
 * otherwise be stranded forever. A re-added slot gets a fresh id anyway
 * (freshSlotId / crypto.randomUUID), so an arm can never be resurrected.
 *
 * Same-reference-when-unchanged rule as nextArmedSet. */
export function prunedArmedSet(
  armed: ReadonlySet<string>,
  liveSlotIds: readonly string[]
): ReadonlySet<string> {
  if (armed.size === 0) return armed
  const live = new Set(liveSlotIds)
  let dropped = false
  for (const id of armed) {
    if (!live.has(id)) {
      dropped = true
      break
    }
  }
  if (!dropped) return armed
  const next = new Set<string>()
  for (const id of armed) if (live.has(id)) next.add(id)
  return next
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/performanceDeck.ts src/shared/performanceDeck.test.ts
git commit -m "arming is a toggle that costs nothing to undo, and a dead slot loses its arm

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 3: What lands, and what radio is still allowed to touch

**Files:**
- Modify: `src/shared/performanceDeck.ts`
- Modify: `src/shared/performanceDeck.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/performanceDeck.test.ts` (extend the import list with `landingSlotIds` and
`radioEligibleUnderPerform`):

```ts
describe('landingSlotIds', () => {
  const cards = [
    card({ slotId: 'a', armed: true }),
    card({ slotId: 'b', armed: true }),
    card({ slotId: 'c', armed: false })
  ]

  it('lands every armed, ready, still-eligible slot', () => {
    expect(landingSlotIds(cards, new Set(['a', 'b']), ['a', 'b', 'c'])).toEqual(['a', 'b'])
  })

  it('lands nothing when nothing is armed', () => {
    expect(landingSlotIds(cards, new Set(), ['a', 'b', 'c'])).toEqual([])
  })

  it('drops an arm whose slot stopped being eligible -- locked or muted since', () => {
    // The pick was made a whole interval ago and the world may have moved.
    // Radio already re-checks this at its own boundary (DiscoverPanel
    // :1233); a launch re-checks it the same way.
    expect(landingSlotIds(cards, new Set(['a', 'b']), ['b'])).toEqual(['b'])
  })

  it('drops an arm whose card is no longer ready', () => {
    const warming = [card({ slotId: 'a', armed: true, resolved: false })]
    expect(landingSlotIds(warming, new Set(['a']), ['a'])).toEqual([])
  })

  it('drops an arm with no card at all', () => {
    expect(landingSlotIds([], new Set(['a']), ['a'])).toEqual([])
  })

  it('returns them in card order, so a launch is deterministic', () => {
    expect(landingSlotIds(cards, new Set(['b', 'a']), ['a', 'b', 'c'])).toEqual(['a', 'b'])
  })
})

describe('radioEligibleUnderPerform', () => {
  it('hands radio everything when performance mode is off', () => {
    expect(radioEligibleUnderPerform(['a', 'b', 'c'], new Set(), 'auto', false)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('ignores hold entirely when performance mode is off', () => {
    // hold is a performance-mode posture. With the mode off it must not
    // reach radio at all, or turning the mode off would leave radio frozen.
    expect(radioEligibleUnderPerform(['a', 'b'], new Set(['a']), 'hold', false)).toEqual(['a', 'b'])
  })

  it('withholds an armed slot under auto -- your decision is not stolen', () => {
    expect(radioEligibleUnderPerform(['a', 'b', 'c'], new Set(['b']), 'auto', true)).toEqual([
      'a',
      'c'
    ])
  })

  it('withholds everything under hold -- only what you arm ever changes', () => {
    expect(radioEligibleUnderPerform(['a', 'b', 'c'], new Set(), 'hold', true)).toEqual([])
  })

  it('leaves the list untouched under auto with nothing armed', () => {
    const eligible = ['a', 'b']
    expect(radioEligibleUnderPerform(eligible, new Set(), 'auto', true)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: FAIL — `landingSlotIds is not a function`.

- [ ] **Step 3: Implement**

Append to `src/shared/performanceDeck.ts`:

```ts
/** Which armed slots actually commit at this wrap.
 *
 * Three filters, each for a reason already established elsewhere:
 * - still armed,
 * - still READY (spec 3.2 -- an unresolved stem would land late and break
 *   the one thing a launch promises, that several layers arrive together),
 * - still eligible. The card was picked a whole interval ago and the slot
 *   may since have been removed, locked or muted; radio re-checks exactly
 *   this at its own boundary (DiscoverPanel.tsx:1233, "resolving a few
 *   hundred milliseconds late is strictly better than swapping a layer the
 *   user just locked") and a launch is held to the same rule.
 *
 * Card order, not armed-set order, so a launch is deterministic and a test
 * can assert it. */
export function landingSlotIds(
  cards: readonly DeckCardState[],
  armed: ReadonlySet<string>,
  eligibleNow: readonly string[]
): string[] {
  const eligible = new Set(eligibleNow)
  return cards
    .filter((c) => armed.has(c.slotId) && isArmable(c) && eligible.has(c.slotId))
    .map((c) => c.slotId)
}

/** Radio's eligible set, narrowed by performance mode.
 *
 * Composed HERE rather than inside isRadioEligibleSlot (radioSchedule.ts):
 * being armed is a fact about performance mode, not about whether a layer
 * is turnable, and that predicate's own doc comment exists to stop a third
 * answer to "may radio touch this layer" appearing. Two questions, two
 * places -- and with `performing` false this returns its input untouched,
 * so radio with the mode off is bit-identical to what shipped.
 *
 * - `auto`: radio keeps the bed moving, minus whatever you have armed.
 * - `hold`: radio commits nothing. The deck still refills, because refilling
 *   is driven by cards being consumed, not by eligibility. */
export function radioEligibleUnderPerform(
  eligible: readonly string[],
  armed: ReadonlySet<string>,
  autopilot: PerformanceAutopilot,
  performing: boolean
): string[] {
  if (!performing) return [...eligible]
  if (autopilot === 'hold') return []
  return eligible.filter((id) => !armed.has(id))
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Run the full suite, typecheck and lint**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: `Test Files 199 passed (199)` / `Tests 3193 passed (3193)`; typecheck 0 errors; lint 0
errors and the 4 pre-existing prettier warnings, unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/shared/performanceDeck.ts src/shared/performanceDeck.test.ts
git commit -m "what lands at the wrap, and what radio is still allowed to touch

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 4: The `perform` button and the autopilot chips

No behaviour yet — the toggle and its one chip row, so the next tasks have somewhere to hang.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Add the import**

Add to the imports at the top of `DiscoverPanel.tsx`, beside the existing `@shared/radioSchedule`
import block:

```ts
import {
  DEFAULT_PERFORMANCE_AUTOPILOT,
  PERFORMANCE_AUTOPILOT_OPTIONS,
  type PerformanceAutopilot
} from '@shared/performanceDeck'
```

- [ ] **Step 2: Add the state, directly under radio's own state block**

Immediately after `const [radioProgress, setRadioProgress] = useState(0)` (`:1184`):

```ts
  // --- performance mode (docs/superpowers/specs/2026-09-28-performance-
  // mode-design.md)
  //
  // Radio is "leave it running". Performance mode is "play it": every slot
  // gets a warmed card on deck, a tap arms it, and it lands on the top of
  // the loop. It is a SUB-MODE of radio, not a peer -- it needs radio's
  // clock, and two independent switches driving one clock is a state
  // machine nobody asked for. So the button is offered only while radio is
  // on, and turning it on turns radio on.
  const [performOn, setPerformOn] = useState(false)
  // Mirror, for the same stale-closure reason radioOnRef exists: the
  // position-tick effect and the async deck refill both run from closures
  // that can be a render behind. Written through an effect, never during
  // render (react-hooks/purity).
  const performOnRef = useRef(false)
  useEffect(() => {
    performOnRef.current = performOn
  }, [performOn])
  const [autopilot, setAutopilot] = useState<PerformanceAutopilot>(DEFAULT_PERFORMANCE_AUTOPILOT)
  const autopilotRef = useRef<PerformanceAutopilot>(DEFAULT_PERFORMANCE_AUTOPILOT)
  useEffect(() => {
    autopilotRef.current = autopilot
  }, [autopilot])

  /** The perform button. Turning it on with radio off turns radio on too --
   * the deck has nothing to land against without a clock. Turning it off
   * clears every arm; an arm is a live intention, and there is nowhere for
   * it to wait. */
  function togglePerform(): void {
    if (performOn) {
      performOnRef.current = false
      setPerformOn(false)
      return
    }
    if (!radioOnRef.current) toggleRadio()
    performOnRef.current = true
    setPerformOn(true)
  }
```

- [ ] **Step 3: Add the button, beside the radio button in the actions row**

Immediately after the `radio` button's closing `</button>` (the one whose `background` is
`radioOn ? 'var(--ra-play-on)' : 'transparent'`, `:2949`), add:

```tsx
        <button
          onClick={togglePerform}
          data-tooltip={performOn ? 'stop perform' : 'perform'}
          style={{
            visibility: radioOn ? 'visible' : 'hidden',
            background: performOn ? 'var(--ra-bg-row-active)' : 'transparent',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border-strong)',
            font: 'inherit',
            fontSize: 'var(--ra-fs-9)',
            padding: '4px 8px',
            cursor: 'pointer'
          }}
        >
          perform
        </button>
```

`visibility` rather than unmounting, so the actions row cannot reflow when radio starts — the same
trick the progress rule already uses at `:2966` and for the same documented reason.

- [ ] **Step 4: Add the autopilot chip row**

Directly after the block that renders the radio pace chips (`{radioOn && (` … `)}` at `:2978`),
add:

```tsx
        {performOn && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-3)' }}>autopilot</span>
            {PERFORMANCE_AUTOPILOT_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={(): void => setAutopilot(option)}
                style={{
                  background: autopilot === option ? 'var(--ra-bg-row-active)' : 'transparent',
                  color: autopilot === option ? 'var(--ra-text)' : 'var(--ra-text-3)',
                  border: '1px solid var(--ra-border)',
                  font: 'inherit',
                  fontSize: 'var(--ra-fs-9)',
                  padding: '2px 6px',
                  cursor: 'pointer'
                }}
              >
                {option}
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, the 4 pre-existing prettier warnings unchanged. If prettier complains about
the new blocks, run `npx prettier --write src/renderer/src/components/DiscoverPanel.tsx` and
re-check that the warning count is still 4.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "a perform button beside radio, and one chip row for who is driving

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 5: The deck — state, refill, and the card on screen

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Add the deck state and the refill, under the perform state from Task 4**

```ts
  /** One slot's card. `pick` is exactly what pickForSlot returned, so
   * committing it is the same commitSlotPick call radio makes -- there is
   * no second commit path. `stem` is filled in when resolveCandidateStem
   * settles, and its presence IS the `ready` state (spec 3.2). */
  interface DeckEntry {
    pick: SlotPick
    stem: ResolvedCandidateStem | null
  }

  // slotId -> card. State, not a ref: every card is rendered. Refills are
  // async and land through setDeck, so React owns the identity.
  const [deck, setDeck] = useState<Map<string, DeckEntry>>(new Map())
  const deckRef = useRef<Map<string, DeckEntry>>(new Map())
  useEffect(() => {
    deckRef.current = deck
  }, [deck])
  // Slots with a pickForSlot in flight, so the refill effect below cannot
  // fire a second one for the same slot on the next render. A ref, because
  // it is read and written inside the async refill itself.
  const deckFillingRef = useRef<Set<string>>(new Set())

  /** Pick and warm one slot's card. The same two calls armRadioPick makes
   * (DiscoverPanel.tsx:2300-2307) -- pickForSlot, then resolveCandidateStem
   * -- except the resolved stem is KEPT rather than discarded, because the
   * card has to show it and a tap has to be refused until it exists.
   *
   * Every await is followed by a performOnRef check: leaving the mode
   * during a real IPC round trip must not repopulate a deck nobody is
   * looking at. */
  async function fillDeckSlot(slotId: string): Promise<void> {
    if (deckFillingRef.current.has(slotId)) return
    deckFillingRef.current.add(slotId)
    try {
      const slot = slotsRef.current.find((s) => s.id === slotId)
      if (!slot) return
      const pick = await pickForSlot(slotId, slot.kinds)
      if (!performOnRef.current) return
      if (pick === null || pick.candidate === null) return
      setDeck((prev) => new Map(prev).set(slotId, { pick, stem: null }))
      const stem = await resolveCandidateStem(pick.candidate)
      if (!performOnRef.current) return
      if (stem === null) {
        // A null deletes its own cache entry (resolveCandidateStem :144) and
        // the card is dropped, so the refill effect below simply tries
        // again. Same soft degradation every other Discover path takes.
        setDeck((prev) => {
          const next = new Map(prev)
          next.delete(slotId)
          return next
        })
        return
      }
      setDeck((prev) => {
        const existing = prev.get(slotId)
        // Superseded by a later fill (a skip landed while this resolved) --
        // leave the newer card alone.
        if (!existing || existing.pick !== pick) return prev
        return new Map(prev).set(slotId, { pick, stem })
      })
    } finally {
      deckFillingRef.current.delete(slotId)
    }
  }

  // Keep every slot's card filled. Runs on entering the mode (one
  // pickForSlot per slot, concurrently -- not new, `similar all` already
  // does exactly this via rerollAll) and whenever a card is consumed by a
  // landing or dropped by a skip.
  //
  // Leaving the mode empties the deck: a stale card would name a candidate
  // ranked against a trait bar and a tempo that may both have moved.
  useEffect(() => {
    if (!performOn) {
      if (deckRef.current.size > 0) setDeck(new Map())
      return
    }
    for (const slot of slots) {
      if (deck.has(slot.id)) continue
      void fillDeckSlot(slot.id)
    }
    // `slots` and `deck` are the real dependencies; fillDeckSlot is
    // re-created every render and reads through refs on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performOn, slots, deck])
```

> **Note on the `setDeck(new Map())` inside the effect.** This repo errors on a synchronous
> `setState` in an effect (Finding 11). If `react-hooks/set-state-in-effect` fires here, wrap it
> the way radio already does: `void Promise.resolve().then(() => setDeck(new Map()))`. Run the lint
> and follow what it says rather than guessing.

- [ ] **Step 2: Thread the card into `DiscoverSlotRow`**

Add three props to the `DiscoverSlotRow` call site (inside the `slots.map(...)` that renders the
rows), and the matching three entries to its destructured parameter list and its inline props
type:

```tsx
            deckStem={deck.get(slot.id)?.stem ?? null}
            deckName={deck.get(slot.id)?.pick.candidate?.presetName ?? null}
            performing={performOn}
```

```ts
  /** This slot's card, once its stem has resolved -- null while picking or
   * warming. Performance mode only; always null with the mode off. */
  deckStem: ResolvedCandidateStem | null
  /** The card's stem name, available one step earlier than `deckStem` so
   * the card can say what is coming while it is still downloading. */
  deckName: string | null
  performing: boolean
```

- [ ] **Step 3: Render the sub-row**

Inside `DiscoverSlotRow`'s returned `<>…</>`, immediately after the row's closing `</div>` (the
15-track grid), add:

```tsx
      {performing && (
        <div
          style={{
            background: 'var(--ra-bg-row-sub)',
            borderBottom: '1px solid var(--ra-border-soft)',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 34
          }}
        >
          {deckStem === null ? (
            <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-3)' }}>
              {deckName === null ? 'finding one' : `${deckName} — loading`}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-2)', minWidth: 110 }}>
                {deckStem.name}
              </span>
              <div style={{ flex: 1, height: 18, position: 'relative' }}>
                <Waveform path={deckStem.path} color={typeColorVar(deckStem.type)} opacity={0.6} />
              </div>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 4: Add the `typeColorVar` import**

Change `import { stemColorVar } from '../theme/typeColor'` (`:11`) to:

```ts
import { stemColorVar, typeColorVar } from '../theme/typeColor'
```

`ResolvedCandidateStem` is not a `Stem`, so `stemColorVar` does not typecheck against it
(Finding 15).

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 4 prettier warnings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "every slot shows what is coming next, warmed before you look at it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 6: Arm, disarm and skip

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Extend the import**

```ts
import {
  DEFAULT_PERFORMANCE_AUTOPILOT,
  PERFORMANCE_AUTOPILOT_OPTIONS,
  deckCardStatus,
  isArmable,
  nextArmedSet,
  prunedArmedSet,
  type DeckCardState,
  type PerformanceAutopilot
} from '@shared/performanceDeck'
```

- [ ] **Step 2: Add the armed set and the three actions, under the deck state**

```ts
  const [armedSlotIds, setArmedSlotIds] = useState<ReadonlySet<string>>(new Set())
  const armedSlotIdsRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    armedSlotIdsRef.current = armedSlotIds
  }, [armedSlotIds])

  /** One slot's card as the pure module sees it. The single place the
   * renderer's two-field DeckEntry is translated into the shared module's
   * flag shape, so `ready` can never mean two things. */
  function deckCardStateFor(slotId: string): DeckCardState {
    const entry = deckRef.current.get(slotId)
    return {
      slotId,
      hasCandidate: entry?.pick.candidate != null,
      resolved: entry?.stem != null,
      armed: armedSlotIdsRef.current.has(slotId)
    }
  }

  /** Tap a card. Arms a ready one, disarms an armed one, does nothing to a
   * warming one -- all three decided by nextArmedSet, which returns the
   * same set reference when nothing changed so an ignored tap costs no
   * render. */
  function toggleArm(slotId: string): void {
    setArmedSlotIds((prev) =>
      nextArmedSet(prev, { ...deckCardStateFor(slotId), armed: prev.has(slotId) })
    )
  }

  /** Throw this card away and pick another. Disarms first: skipping an
   * armed card must not leave an arm pointing at a card that is gone.
   * The refill effect notices the empty slot and fills it. */
  function skipCard(slotId: string): void {
    setArmedSlotIds((prev) => {
      if (!prev.has(slotId)) return prev
      const next = new Set(prev)
      next.delete(slotId)
      return next
    })
    setDeck((prev) => {
      if (!prev.has(slotId)) return prev
      const next = new Map(prev)
      next.delete(slotId)
      return next
    })
  }

  // An arm for a slot that has since been removed is stranded state. Pruned
  // whenever the slot list changes, exactly as the radio-controls spec
  // prunes its own recency map and for the same reason.
  useEffect(() => {
    setArmedSlotIds((prev) => prunedArmedSet(prev, slots.map((s) => s.id)))
  }, [slots])
```

> Same `set-state-in-effect` caveat as Task 5 for that last effect. `prunedArmedSet` returns the
> same reference when nothing changed, so the updater is a no-op in the common case — but if lint
> objects, defer it through `void Promise.resolve().then(...)`.

- [ ] **Step 3: Add the two buttons to the sub-row**

Extend `DiscoverSlotRow`'s props with `armed`, `onToggleArm` and `onSkipCard`:

```ts
  /** This slot has a card armed to land at the next loop top. */
  armed: boolean
  onToggleArm: () => void
  onSkipCard: () => void
```

Pass them at the call site:

```tsx
            armed={armedSlotIds.has(slot.id)}
            onToggleArm={(): void => toggleArm(slot.id)}
            onSkipCard={(): void => skipCard(slot.id)}
```

And add them inside the sub-row's `deckStem !== null` branch, after the waveform:

```tsx
              <button
                onClick={onToggleArm}
                data-tooltip={armed ? 'cancel' : 'at next top'}
                style={{
                  background: armed ? 'var(--ra-bg-row-active)' : 'transparent',
                  color: 'var(--ra-text)',
                  border: `1px solid ${armed ? 'var(--ra-border-strong)' : 'var(--ra-border)'}`,
                  font: 'inherit',
                  fontSize: 'var(--ra-fs-9)',
                  padding: '2px 8px',
                  cursor: 'pointer'
                }}
              >
                {armed ? 'armed' : 'arm'}
              </button>
              <button
                onClick={onSkipCard}
                data-tooltip="another one"
                style={{
                  background: 'transparent',
                  color: 'var(--ra-text-3)',
                  border: '1px solid var(--ra-border)',
                  font: 'inherit',
                  fontSize: 'var(--ra-fs-9)',
                  padding: '2px 8px',
                  cursor: 'pointer'
                }}
              >
                skip
              </button>
```

`isArmable` and `deckCardStatus` are imported but only used in the panel body; if lint reports
either as unused after this task, leave the import and complete Task 7, which uses both.

- [ ] **Step 4: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 4 prettier warnings.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "one tap arms it, a second tap takes it back, and skip asks for another

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 7: Landing on the loop top, and radio playing the deck

The task where it becomes an instrument.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Narrow radio's eligible set**

Change `radioEligibleSlotIds()` (`:2270`) so the armed exclusion composes on top of the shared
predicate rather than inside it (Finding 8). Keep the existing body and wrap the result:

```ts
  function radioEligibleSlotIds(): string[] {
    const turnable = slotsRef.current
      .filter((s) =>
        isRadioEligibleSlot({
          locked: s.locked,
          audible: previewingSlotIdsRef.current.has(s.id),
          hasCandidate: s.candidate !== null,
          hasSeedStem: s.seedStem !== undefined,
          rerolling: rerollingSlotIds.has(s.id)
        })
      )
      .map((s) => s.id)
    // Composed here, not inside isRadioEligibleSlot: being armed is a fact
    // about performance mode, not about whether a layer is turnable. With
    // the mode off this returns `turnable` untouched, so radio is
    // bit-identical to what shipped.
    return radioEligibleUnderPerform(
      turnable,
      armedSlotIdsRef.current,
      autopilotRef.current,
      performOnRef.current
    )
  }
```

Add `radioEligibleUnderPerform` to the `@shared/performanceDeck` import.

> If the radio-controls plan has already rewritten this function, keep **its** body verbatim and
> only wrap the returned array in `radioEligibleUnderPerform`. Do not re-derive its filter.

- [ ] **Step 2: Land armed cards at the wrap**

Inside the position-tick effect (`:1204-1257`), immediately after
`radioClockRef.current = step.clock` and **before** the `if (!step.due) return`, add:

```ts
    // A LAUNCH LANDS ON `wrapped`, NOT ON `due`. The radio-controls spec
    // widens `due` onto a sub-loop grid; a launch is a gesture the hand
    // made and it belongs on the top of the loop -- which, because of the
    // re-one tool, is a downbeat Elling curated rather than an arbitrary
    // bar line (spec 0.2, and radio-controls 0A.4).
    if (step.wrapped && performOnRef.current && armedSlotIdsRef.current.size > 0) {
      const cards = slotsRef.current.map((s) => deckCardStateFor(s.id))
      const landing = landingSlotIds(cards, armedSlotIdsRef.current, radioEligibleSlotIdsRaw())
      const entries = landing.map((id) => ({ id, entry: deckRef.current.get(id) }))
      // Deferred through the same resolved-promise tick radio's own commit
      // uses -- this repo ERRORS on a synchronous setState inside an effect.
      // ALL of these commits land in ONE tick on purpose: commitSlotPick is
      // a functional setSlots, so N calls compose into one state update, one
      // render, one rAF-coalesced syncPreviewToEngine and ONE load-project.
      // That is what makes a whole new bed arrive together (spec 3.3).
      void Promise.resolve().then(() => {
        if (!performOnRef.current) return
        for (const { id, entry } of entries) {
          if (!entry) continue
          putBackRef.current.set(id, previousFor(id))
          commitSlotPick(id, entry.pick)
        }
        setArmedSlotIds((prev) => {
          if (landing.length === 0) return prev
          const next = new Set(prev)
          for (const id of landing) next.delete(id)
          return next
        })
        setDeck((prev) => {
          if (landing.length === 0) return prev
          const next = new Map(prev)
          for (const id of landing) next.delete(id)
          return next
        })
      })
    }
```

- [ ] **Step 3: Add the raw eligibility helper the landing uses**

`radioEligibleSlotIds()` now withholds armed slots, which is exactly wrong for deciding whether an
*armed* slot may land. Split it, keeping one filter:

```ts
  /** Every layer radio COULD turn over, before performance mode narrows it.
   * A launch checks against this one: an armed slot is withheld from radio
   * precisely so it can land itself, and asking the narrowed set whether an
   * armed slot is eligible would always say no. */
  function radioEligibleSlotIdsRaw(): string[] {
    return slotsRef.current
      .filter((s) =>
        isRadioEligibleSlot({
          locked: s.locked,
          audible: previewingSlotIdsRef.current.has(s.id),
          hasCandidate: s.candidate !== null,
          hasSeedStem: s.seedStem !== undefined,
          rerolling: rerollingSlotIds.has(s.id)
        })
      )
      .map((s) => s.id)
  }
```

and reduce `radioEligibleSlotIds()` to:

```ts
  function radioEligibleSlotIds(): string[] {
    return radioEligibleUnderPerform(
      radioEligibleSlotIdsRaw(),
      armedSlotIdsRef.current,
      autopilotRef.current,
      performOnRef.current
    )
  }
```

- [ ] **Step 4: Make radio commit the deck card instead of its own pending pick**

In the same effect's `due` branch, replace the body of the deferred commit so that, while
performance mode is on, radio plays what is already on deck rather than picking a second time:

```ts
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      if (performOnRef.current) {
        // Performance mode: radio plays the card you did not take. One pick
        // per slot, not two -- and he watches it take the offer, which is
        // the right story for "the machine offers and, if you say nothing,
        // it chooses for you."
        const slotId = pickRadioSlotId(eligibleNow, radioLastSlotRef.current)
        const entry = slotId === null ? undefined : deckRef.current.get(slotId)
        if (slotId !== null && entry && entry.stem !== null) {
          putBackRef.current.set(slotId, previousFor(slotId))
          commitSlotPick(slotId, entry.pick)
          radioLastSlotRef.current = slotId
          setDeck((prev) => {
            const next = new Map(prev)
            next.delete(slotId)
            return next
          })
        }
        return
      }
      if (pending !== null && eligibleNow.includes(pending.slotId)) {
        commitSlotPick(pending.slotId, pending.pick)
        radioLastSlotRef.current = pending.slotId
      }
      void armRadioPick()
    })
```

Add `pickRadioSlotId` to the `@shared/radioSchedule` import if it is not already there (it is used
by `armRadioPick`, so it should be).

- [ ] **Step 5: Add the armed countdown rule**

In `DiscoverSlotRow`'s sub-row, when `armed` is true, add a rule that fills toward the wrap.
Extend the props with `wrapPct: number` and pass `wrapPct={maxBarLength > 0 ? (pos % maxBarLength) / maxBarLength : 0}`
at the call site — `pos` and `maxBarLength` are both already in scope there (`:439`, and the
`maxBarLength` the rows are already given).

```tsx
              {armed && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 1,
                    width: `${Math.round(wrapPct * 100)}%`,
                    background: 'var(--ra-text-2)'
                  }}
                />
              )}
```

Give the sub-row `position: 'relative'` so the rule anchors to it.

Monochrome on purpose: colour on this screen is spent on waveforms and the playhead, and a
countdown carries no audio information (Finding 12).

- [ ] **Step 6: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 4 prettier warnings. `putBackRef` and `previousFor` do not exist yet — **Task 8
adds them.** If you want a green typecheck at the end of this task rather than the next, add Task 8
Step 1 now and commit both together.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "an armed card lands on the top of the loop, and several land together

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 8: `put back`

The phase-1 answer to having no pre-listen: a wrong choice costs one lap, not a stopped set.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Remember what was there**

Under the deck state:

```ts
  /** slotId -> the pick that was playing before the last landing, so one
   * tap can restore it. A REF, not state: it is written from inside the
   * position-tick effect's deferred commit and read by a button, and it
   * drives no layout of its own beyond the button's presence (which is
   * derived from `justLanded` below).
   *
   * This is NOT undo. Radio writes no undo history (2026-09-26 spec 3.4)
   * and neither does a launch -- `put back` is a forward commitSlotPick
   * that happens to restore, exactly like every other Discover change. */
  const putBackRef = useRef<Map<string, SlotPick>>(new Map())
  // Which slots may currently be put back -- state, because a button
  // appears and disappears with it. Cleared at the next wrap, so the offer
  // lasts exactly one lap.
  const [justLanded, setJustLanded] = useState<ReadonlySet<string>>(new Set())

  /** The pick a slot is currently playing, as a SlotPick, so it can be
   * re-committed later. A seeded slot has no candidate and no pickBar, and
   * commitSlotPick handles `candidate: null` by clearing pickBar -- but it
   * also clears seedStem, so a seeded slot genuinely cannot be put back and
   * is deliberately not offered the button (see justLanded below). */
  function previousFor(slotId: string): SlotPick {
    const slot = slotsRef.current.find((s) => s.id === slotId)
    return {
      candidate: slot?.candidate ?? null,
      barUsed: slot?.pickBar?.barUsed ?? null,
      barRequested: slot?.pickBar?.barRequested ?? 0
    }
  }

  /** Re-commit what was playing before. A forward commit at the next
   * render, not at the next wrap: the point of `put back` is that it is
   * immediate -- you already heard the wrong thing, and waiting a lap to
   * undo it is the opposite of a fix. */
  function putBack(slotId: string): void {
    const previous = putBackRef.current.get(slotId)
    if (!previous || previous.candidate === null) return
    putBackRef.current.delete(slotId)
    setJustLanded((prev) => {
      const next = new Set(prev)
      next.delete(slotId)
      return next
    })
    commitSlotPick(slotId, previous)
  }
```

- [ ] **Step 2: Mark and expire the offer**

In the position-tick effect, inside the deferred commit added in Task 7 Step 2, after the
`for (const { id, entry } of entries)` loop, add:

```ts
        setJustLanded(new Set(landing.filter((id) => putBackRef.current.get(id)?.candidate != null)))
```

and in the same effect, at the top of the `step.wrapped` branch, expire the previous lap's offer
before anything else:

```ts
    if (step.wrapped && justLandedRef.current.size > 0) {
      void Promise.resolve().then(() => setJustLanded(new Set()))
    }
```

with the usual mirror:

```ts
  const justLandedRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    justLandedRef.current = justLanded
  }, [justLanded])
```

Order matters: expire first, then the landing below re-populates it for the slots that just
changed. Otherwise a landing's own offer would be wiped by the same wrap that created it.

- [ ] **Step 3: The button**

Extend `DiscoverSlotRow` with `canPutBack: boolean` and `onPutBack: () => void`, passed as
`canPutBack={justLanded.has(slot.id)}` and `onPutBack={(): void => putBack(slot.id)}`, and render
it in the sub-row **outside** the `deckStem === null` branch so it is available while the next card
is still being found:

```tsx
          {canPutBack && (
            <button
              onClick={onPutBack}
              data-tooltip="previous stem"
              style={{
                background: 'transparent',
                color: 'var(--ra-text-2)',
                border: '1px solid var(--ra-border)',
                font: 'inherit',
                fontSize: 'var(--ra-fs-9)',
                padding: '2px 8px',
                cursor: 'pointer'
              }}
            >
              put back
            </button>
          )}
```

- [ ] **Step 4: Typecheck, lint and the full suite**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: 0 errors; 4 prettier warnings; `Test Files 199 passed (199)` / `Tests 3193 passed
(3193)`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "a wrong choice costs one lap, because the last one is still there

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 9: Phase 1 checkpoint

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npm test
npm run typecheck
npm run lint
```

Expected, exactly: `Test Files 199 passed (199)`, `Tests 3193 passed (3193)`, typecheck 0 errors,
lint 0 errors and **4** prettier warnings. If `src/main/remoteServer.test.ts` is the only failure,
re-run it alone and treat a clean isolated run as green.

- [ ] **Step 2: Confirm nothing forbidden was touched**

```bash
git diff --name-only 85e482e..HEAD
```

Expected: only `docs/superpowers/**`, `src/shared/performanceDeck.ts`,
`src/shared/performanceDeck.test.ts`, `src/renderer/src/components/DiscoverPanel.tsx` — plus
whatever the radio-controls plan touched if it landed first. **`vitest.config.ts`,
`native-engine/`, `src/main/` and `src/preload/` must not appear.**

- [ ] **Step 3: Write the walkthrough for Elling and say plainly what was not verified**

An agent cannot click a card, cannot hear a change land on the one, and cannot tell whether the
deck refills fast enough to keep up with a hand. **Say so.** Hand him this, verbatim:

1. Open Discover, press `radio`, let it start. Press `perform`.
2. Every slot should grow a second row under it: a name, a waveform, `arm`, `skip`.
3. Press `skip` on one. A different stem should arrive within a second or two.
4. Press `arm` on one. The button should read `armed` and a thin rule should fill along the bottom
   of that sub-row.
5. It should change **on the top of the loop**, not mid-phrase. That is the whole feature — if it
   lands anywhere else, stop and report it.
6. Press `arm` on three slots at once, then wait. All three should change **together**, on the
   same downbeat.
7. Press `put back` right after a change. The previous stem should come straight back.
8. Set `autopilot` to `hold`. Nothing should ever change unless you arm it.
9. Set it back to `auto`. Radio should resume turning over the layers you have **not** armed —
   and it should be playing the card that was on deck for that slot.

- [ ] **Step 4: Commit the checkpoint if anything was fixed**

Nothing to commit if everything passed.

---

# Phase 2 — the cue

Tasks 10 through 13. Pre-listen through the renderer's own Web Audio path (Finding 5), on a second
output device. **No engine work** (Finding 4).

---

## Task 10: `cueStartOffsetSec`

**Files:**
- Modify: `src/shared/performanceDeck.ts`
- Modify: `src/shared/performanceDeck.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/performanceDeck.test.ts` (extend the import list with `cueStartOffsetSec`):

```ts
describe('cueStartOffsetSec', () => {
  it('starts at the top when the transport is at the top', () => {
    expect(cueStartOffsetSec(0, 4, 8)).toBe(0)
  })

  it('starts halfway through a stem whose loop the transport is halfway through', () => {
    expect(cueStartOffsetSec(2, 4, 8)).toBe(4)
  })

  it('tiles a short stem under a longer loop, like the engine does', () => {
    // A 2-bar hat under an 8-bar loop repeats four times a lap. At bar 5
    // the hat is one bar into its own second-to-last pass.
    expect(cueStartOffsetSec(5, 2, 4)).toBe(2)
  })

  it('is exact at the stem loop point rather than wrapping to its own length', () => {
    expect(cueStartOffsetSec(4, 4, 8)).toBe(0)
  })

  it('returns 0 for a stem with no bar length', () => {
    expect(cueStartOffsetSec(3, 0, 8)).toBe(0)
  })

  it('returns 0 for a stem with no duration', () => {
    expect(cueStartOffsetSec(3, 4, 0)).toBe(0)
  })

  it('returns 0 for a position that is not a finite number', () => {
    expect(cueStartOffsetSec(Number.NaN, 4, 8)).toBe(0)
    expect(cueStartOffsetSec(Number.POSITIVE_INFINITY, 4, 8)).toBe(0)
  })

  it('returns 0 for a negative position rather than a negative offset', () => {
    // AudioBufferSourceNode.start() throws on a negative offset, and a
    // thrown cue would be a silent failure in the one place silence is
    // indistinguishable from working.
    expect(cueStartOffsetSec(-1, 4, 8)).toBe(0)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: FAIL — `cueStartOffsetSec is not a function`.

- [ ] **Step 3: Implement**

Append to `src/shared/performanceDeck.ts`:

```ts
/** Where in a candidate's own audio a cue should start, so it lines up with
 * the loop the engine is already playing.
 *
 * `posBars` is the transport's position, already wrapped against the
 * preview loop's length. `stemBars` is the candidate's OWN bar length,
 * which may be shorter than the loop -- the engine tiles a 2-bar hat four
 * times under an 8-bar loop, so a cue has to tile the same way or it will
 * be in the wrong place three laps out of four.
 *
 * `durationSec` must be the duration of the file that will actually be
 * PLAYED -- the stretched one when a stretch was applied (buildEngineProject
 * .ts:333-341 makes the same point about the engine's own timing math).
 *
 * Every degenerate input returns 0 rather than throwing or going negative:
 * AudioBufferSourceNode.start() throws on a negative offset, and a thrown
 * cue is silent, which is indistinguishable from a cue that is simply not
 * loud enough. */
export function cueStartOffsetSec(
  posBars: number,
  stemBars: number,
  durationSec: number
): number {
  if (!Number.isFinite(posBars) || posBars < 0) return 0
  if (!(stemBars > 0) || !(durationSec > 0)) return 0
  return ((posBars % stemBars) / stemBars) * durationSec
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/shared/performanceDeck.test.ts`
Expected: PASS, 36 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/performanceDeck.ts src/shared/performanceDeck.test.ts
git commit -m "a cue starts where the loop already is, tiling a short stem the way the engine does

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 11: `cueLoop.ts`

**Files:**
- Create: `src/renderer/src/audio/cueLoop.ts`

**No test file** — Web Audio does not exist under vitest's node environment (Finding 16), and the
one piece of arithmetic worth testing is already in `performanceDeck.ts`. Do not create
`cueLoop.test.ts`.

- [ ] **Step 1: Write it**

```ts
// src/renderer/src/audio/cueLoop.ts
//
// Performance mode's pre-listen -- docs/superpowers/specs/2026-09-28-
// performance-mode-design.md 2.3.
//
// THE WHOLE TRICK: this does not go through the native engine at all. It
// plays one stem on the renderer's own shared AudioContext (peakCache's
// getAudioContext), which outputs to the SYSTEM DEFAULT device, while the
// engine outputs to whatever set-output-device was pointed at. Two devices,
// already separately addressable, so pre-listen costs no engine work --
// which matters, because the engine is one AudioDeviceManager opened with
// two output channels and a callback that returns early below two
// (Transport.cpp:49,450), and giving it a cue bus would be a signature
// change through renderBlock, renderLoopAware, PluginChain::process and the
// hand-synced EngineProject pair.
//
// FOUR LIMITS, none of them fixable here:
// 1. It is NOT phase-locked. It starts at the offset the 30Hz position tick
//    last reported and is re-anchored on every wrap, which bounds the drift
//    to one lap. Good enough to judge what a stem is; not good enough to
//    judge whether it is tight.
// 2. It must play the STRETCHED file or it is at the wrong tempo. The caller
//    resolves that (buildEngineProject.ts:439-446 is the ratio formula).
// 3. No plugins, no reverb, no master chain. It is the raw stem.
// 4. With one output device the audience hears it. That is why the cue chip
//    is off by default and its tooltip says `second output only`.
import { getAudioContext } from './peakCache'
import { startPreviewLoop, stopPreviewSources } from './previewLoop'

export interface CueHandle {
  stop: () => void
}

/** Start cueing one stem, replacing whatever was cueing before.
 *
 * Deliberately NOT registered with previewLoop's own activePreview registry:
 * that registry exists so starting a Shelf preview stops a LORE preview, and
 * a cue is a different thing -- it plays UNDER a running mix on a different
 * device, and being silenced by an unrelated browser preview would be a bug
 * rather than the courtesy it is everywhere else. The caller owns exactly
 * one CueHandle and stops it itself.
 *
 * `offsetSec` comes from cueStartOffsetSec (@shared/performanceDeck).
 * `durationSec` must be the PLAYED file's duration, so the loop point is
 * bar-exact -- previewLoop.ts documents the drift that a buffer-length loop
 * point causes between two stems of the same bar length. */
export async function startCue(
  path: string,
  durationSec: number,
  offsetSec: number,
  gain: number,
  isCancelled: () => boolean
): Promise<CueHandle | null> {
  const ctx = getAudioContext()
  const sources = await startPreviewLoop(ctx, [{ path, gain, durationSec }], isCancelled)
  if (sources.length === 0) return null
  if (isCancelled()) {
    stopPreviewSources(sources)
    return null
  }
  // startPreviewLoop starts every source at 0. Seeking is a restart at the
  // offset -- AudioBufferSourceNode has no seek, and a source can only be
  // started once. Stopping and re-starting one node is cheap because the
  // buffer is already decoded and peakCache/previewLoop's own decode is
  // memoised by path.
  if (offsetSec > 0) {
    stopPreviewSources(sources)
    const seeked = ctx.createBufferSource()
    const first = sources[0]
    if (first.buffer === null) return null
    seeked.buffer = first.buffer
    seeked.loop = true
    seeked.loopStart = 0
    seeked.loopEnd = Math.min(durationSec, first.buffer.duration)
    const gainNode = ctx.createGain()
    gainNode.gain.value = gain
    seeked.connect(gainNode)
    gainNode.connect(ctx.destination)
    seeked.start(0, Math.min(offsetSec, seeked.loopEnd))
    return {
      stop: (): void => {
        stopPreviewSources([seeked])
        gainNode.disconnect()
      }
    }
  }
  return {
    stop: (): void => stopPreviewSources(sources)
  }
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 4 prettier warnings.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/cueLoop.ts
git commit -m "pre-listen goes out the renderer's own audio path, not the engine's

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 12: The `cue` chip, wired

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: State and the resolver**

Under the perform state:

```ts
  // Off by default and turned on once, deliberately: with one output device
  // a cue comes out of the same speakers as the mix and the audience hears
  // it (spec 2.3, limit 4). Auto-detecting that would need enumerateDevices
  // labels, which need a permission this renderer has never asked for, so
  // it is a chip rather than a guess.
  const [cueEnabled, setCueEnabled] = useState(false)
  const [cueSlotId, setCueSlotId] = useState<string | null>(null)
  const cueHandleRef = useRef<CueHandle | null>(null)
  const cueGenerationRef = useRef(0)

  function stopCue(): void {
    cueGenerationRef.current += 1
    cueHandleRef.current?.stop()
    cueHandleRef.current = null
    setCueSlotId(null)
  }

  /** Start (or restart) the cue for one slot's card, at the position the
   * transport is at right now. Called on tapping `cue` and again on every
   * wrap, which re-anchors it and bounds the drift to one lap. */
  async function startCueFor(slotId: string): Promise<void> {
    const entry = deckRef.current.get(slotId)
    const stem = entry?.stem
    if (!stem) return
    const myGeneration = ++cueGenerationRef.current
    cueHandleRef.current?.stop()
    cueHandleRef.current = null
    // The SAME ratio buildEngineProject computes (:439-446), so the cue is
    // at the project's tempo rather than the file's. Skipping this is the
    // single most likely way to build a useless cue.
    const secPerBar = (60 / bpm) * 4
    const ratio = stem.durationSec / stem.barLength / secPerBar
    let path = stem.path
    let durationSec = stem.durationSec
    if (Math.abs(ratio - 1) >= 0.001) {
      try {
        const stretched = await resolveStretchedForPlayback(stem.path, ratio)
        path = stretched.path
        durationSec = stretched.durationSec
      } catch (err) {
        // Same fallback buildEngineProject takes (:476-481): play it at its
        // native tempo rather than not at all.
        console.error('DiscoverPanel: cue stretch failed, using native tempo:', err)
      }
    }
    if (cueGenerationRef.current !== myGeneration) return
    const handle = await startCue(
      path,
      durationSec,
      cueStartOffsetSec(pos, stem.barLength, durationSec),
      1,
      () => cueGenerationRef.current !== myGeneration
    )
    if (cueGenerationRef.current !== myGeneration) {
      handle?.stop()
      return
    }
    cueHandleRef.current = handle
  }

  function toggleCue(slotId: string): void {
    if (cueSlotId === slotId) {
      stopCue()
      return
    }
    setCueSlotId(slotId)
    void startCueFor(slotId)
  }

  // A cue must never outlive the panel or the mode.
  useEffect(() => {
    if (!performOn || !cueEnabled) stopCue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performOn, cueEnabled])
  useEffect(() => {
    return () => {
      cueGenerationRef.current += 1
      cueHandleRef.current?.stop()
      cueHandleRef.current = null
    }
  }, [])
```

Imports: `import { startCue, type CueHandle } from '../audio/cueLoop'`, and add `cueStartOffsetSec`
to the `@shared/performanceDeck` import. `resolveStretchedForPlayback` is already imported
(`:12`).

- [ ] **Step 2: Re-anchor on every wrap**

In the position-tick effect, inside the `step.wrapped` branch (before the landing block):

```ts
    if (step.wrapped && cueHandleRef.current !== null && cueSlotIdRef.current !== null) {
      // Re-anchored every lap. The renderer's AudioContext and the engine's
      // transport are independent clocks; without this the cue drifts
      // without bound. With it, the error can never exceed one lap.
      void startCueFor(cueSlotIdRef.current)
    }
```

with the usual mirror beside the others:

```ts
  const cueSlotIdRef = useRef<string | null>(null)
  useEffect(() => {
    cueSlotIdRef.current = cueSlotId
  }, [cueSlotId])
```

- [ ] **Step 3: The global chip and the per-card button**

Add a chip beside the `autopilot` row, inside the same `{performOn && (` block:

```tsx
            <button
              onClick={(): void => setCueEnabled((prev) => !prev)}
              data-tooltip="second output only"
              style={{
                background: cueEnabled ? 'var(--ra-bg-row-active)' : 'transparent',
                color: cueEnabled ? 'var(--ra-text)' : 'var(--ra-text-3)',
                border: '1px solid var(--ra-border)',
                font: 'inherit',
                fontSize: 'var(--ra-fs-9)',
                padding: '2px 6px',
                cursor: 'pointer'
              }}
            >
              cue
            </button>
```

Extend `DiscoverSlotRow` with `cueOffered: boolean`, `cueing: boolean` and `onToggleCue: () => void`,
passed as `cueOffered={cueEnabled}`, `cueing={cueSlotId === slot.id}`,
`onToggleCue={(): void => toggleCue(slot.id)}`, and render it in the sub-row beside `arm`:

```tsx
              {cueOffered && (
                <button
                  onClick={onToggleCue}
                  data-tooltip={cueing ? 'stop cue' : 'hear it'}
                  style={{
                    background: cueing ? 'var(--ra-bg-row-active)' : 'transparent',
                    color: 'var(--ra-text)',
                    border: '1px solid var(--ra-border)',
                    font: 'inherit',
                    fontSize: 'var(--ra-fs-9)',
                    padding: '2px 8px',
                    cursor: 'pointer'
                  }}
                >
                  cue
                </button>
              )}
```

- [ ] **Step 4: Typecheck, lint and the full suite**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: 0 errors; 4 prettier warnings; `Test Files 199 passed (199)` / `Tests 3201 passed
(3201)`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "hear the next one in the headphones while the room hears the mix

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 13: Phase 2 checkpoint

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npm test
npm run typecheck
npm run lint
git diff --name-only 85e482e..HEAD
```

Expected: `Test Files 199 passed (199)`, `Tests 3201 passed (3201)`, 0 typecheck errors, 0 lint
errors and 4 prettier warnings, and a file list containing no `vitest.config.ts`, no
`native-engine/`, no `src/main/`, no `src/preload/`.

- [ ] **Step 2: Hand Elling the cue walkthrough, and state what could not be checked**

**An agent cannot verify any of this.** There is no audio output and no second device in this
environment. Do not claim the cue was heard, do not claim it was in tempo, and do not claim the
drift is acceptable. Say that plainly, then hand him:

1. In the transport settings menu, point the engine's output at the interface feeding the
   speakers. Leave the Mac's **system** output on the headphones.
2. In Discover, press `radio`, then `perform`, then the `cue` chip.
3. Press `cue` on one slot's card. You should hear that stem **in the headphones only**, at the
   project's tempo, roughly in phase with the mix.
4. If it is at the wrong tempo, the stretch resolve is wrong — report it, do not adjust by ear.
5. If the audience hears it, the engine and the system default are the same device. That is the
   footgun the chip exists for.
6. Press `cue` again to stop it. Press `arm` and let it land, and the cue should stop on its own
   when the card leaves the deck.
7. Say whether being roughly in phase rather than locked is good enough to decide with. **That
   question decides whether phase-locking ever needs designing**, and it is not a question
   anything but your ears can answer.

---

## Self-review

Run against the spec after Task 13:

- **§1 the queue** — Tasks 5 (deck, refill, card), 6 (skip). Depth 2 is spec §7 phase 3, its own
  plan, correctly absent here.
- **§2 auditioning** — Tasks 10–12. The honest verdict is Findings 4, 5 and 6 and it is carried
  into `cueLoop.ts`'s own header comment so it cannot be lost.
- **§3 arming and the trigger** — Tasks 6 (arm/disarm), 7 (land on `wrapped`, several together,
  the countdown rule). §3.2's "warming cards are not tappable" is Task 1's `isArmable` and Task 3's
  `landingSlotIds`.
- **§4 autopilot vs manual** — Tasks 1 (the constants), 3 (`radioEligibleUnderPerform`), 4 (the
  chips), 7 (composition at the call site, per Finding 8).
- **§5 the phone** — spec §7 phase 4, its own plan. Correctly absent.
- **§6 the screens** — Tasks 4 and 5. No slot-row track is added or moved (Finding 13).
- **§2.5 `put back`** — Task 8.
- **§7 session-only** — no `DiscoverSettings` field anywhere in this plan. Confirmed by the file
  map and by Task 13's `git diff --name-only`.

Type consistency to re-check before starting: `DeckCardState` (Task 1) is the shape
`deckCardStateFor` builds (Task 6) and `landingSlotIds` consumes (Tasks 3, 7). `SlotPick` is
`{ candidate, barUsed, barRequested }` (`DiscoverPanel.tsx:238`) and is what `previousFor` (Task 8)
returns and `commitSlotPick` takes. `CueHandle` (Task 11) is what `cueHandleRef` holds (Task 12).

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-28-performance-mode.md`. Two execution
options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast
   iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch
   execution with checkpoints.

Whichever is chosen: **land `docs/superpowers/plans/2026-09-28-radio-controls.md` first.** Both
plans modify `src/shared/radioSchedule.ts` and `DiscoverPanel.tsx`, and Finding 2 assumes that
plan's Task 3 signature.
