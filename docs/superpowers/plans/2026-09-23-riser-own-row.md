# A Riser Gets Its Own Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a placed noise riser a first-class arranger row — created on a row of its own from the arranger's empty space, with a name you can edit, a mute, a solo and one gain dial that is the riser's own `level`.

**Architecture:** `RiserClip` (`src/shared/riser.ts`) gains exactly two fields, `name` and `muted`. Everything else falls out of that: mute is "the riser does not go on the wire" (`buildEngineRisers` filters it, exactly the way a neutral toolkit already drops off), solo is the same scan widened to cover riser-only rows, the name lives on the riser because one riser owns one row, and the row's gain dial writes `SET_RISER_LEVEL` instead of `SET_VOLUME`. **No native-engine change and no wire-format change.** `EngineRiser` / `EngineProject.h` are untouched: a muted riser is simply absent from the `risers` array, which is a case the engine already handles (an empty array is its neutral fast path).

**Tech Stack:** TypeScript, React 19, Electron renderer, vitest.

**Source of the request (Elling, 2026-09-23):** *"instead of it being linked to a stem, i'd like a way to move the riser on its own, give it its own channel… currently i can only draw it in an existing channel, and only after or before the stem, it seems. give the riser all of the elements of a regular stem it's just drawn in."* He explicitly chose **one new row per riser** over a single shared risers lane, because he wants creating them to be easy.

**Previous work this builds on:** `docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md` (step 4, the riser) and `docs/superpowers/plans/2026-09-22-sssketchy-phase3.md` (the guided flow that places risers automatically).

---

## Findings that shaped this plan (read these first)

1. **Most of the "riser on its own row" machinery already exists and was verified against the real files.**
   - `RiserClip` already carries its own `channelId` (`src/shared/riser.ts:55`), independent of any rifff.
   - `channelHasAnyClip` (`src/renderer/src/state/store.ts:71`) already counts risers, so `ADD_RISER` keeps a riser-only channel in `channelOrder` and `REMOVE_RISER` / `MOVE_RISER` evict it when the last riser leaves.
   - `channelsInOrder` (`src/renderer/src/state/selectors.ts:76`) builds `riserChannelIds` and renders a riser-only row.
   - `ADD_RISER` (`store.ts:1787`) appends an unknown `riser.channelId` to `channelOrder` itself.

   So the row already renders. What is missing is a *gesture that mints one*, and the furniture on it.

2. **No native-engine change is needed, and none may be introduced.** `PlaybackEngine.cpp` gives every riser's `channelId` an entry in `channelGroups` and sums risers into the channel scratch buffer *before* that channel's plugin chain runs, so a riser-only row already gets a real channel with real inserts. Mute is implemented by **omitting the riser from `EngineProject.risers`**, which needs nothing new over there — the array is already variable-length and already legitimately empty. If you reach a point where a C++ change looks necessary, **stop and report it** rather than making it: the engine does not hot-reload and must be rebuilt and the app fully quit and relaunched (CLAUDE.md).

3. **There is no wire-format change either.** `EngineRiser` (`src/shared/buildEngineProject.ts:116`) and `EngineRiser` in `native-engine/Source/EngineProject.h` are the hand-synced pair CLAUDE.md warns about. `name` and `muted` are **renderer-side only** and deliberately never reach `buildEngineRisers`'s projection. Do not add them to `EngineRiser`. A name is a label; a mute is expressed as absence.

4. **Honest inventory of what `ChannelRow.tsx` actually gives a stem row** — the brief asks for "mute, solo, the fx/plugin-chain button, an editable name, and the meter". Read against the real file:

   | Furniture | Where it really lives | For a riser row |
   |---|---|---|
   | **m** (mute) | `ChannelRow.tsx:525`, dispatches `SET_CHANNEL_MUTE` | **Applies.** Today it writes `state.mute[stemKey(...)]` over the channel's rifffs' stems, so on a riser-only row it renders and does nothing. Task 2 makes it move the risers too. |
   | **s** (solo) | `ChannelRow.tsx:536`, dispatches `SOLO_CHANNEL` | **Applies**, same fix, both directions: soloing a riser row must mute the clips, and soloing a clip row must mute the risers. |
   | **fx** | `ChannelRow.tsx:547` | **Applies with nothing to do.** `CHANNEL_FX_BUTTON_ENABLED = false` (`ChannelRow.tsx:70`) hides it on *every* row today — a deliberate, reversible flag, not a bug. `ChannelChainPanel` and the engine's per-channel chain are keyed by plain `channelId`, so a riser row is already a full participant the moment that flag flips back. **Do not special-case it and do not flip the flag.** |
   | **r / x** (arm, remove) | `ChannelRow.tsx:560`/`605`, gated on `state.recordingChannelIds[channelId]` | **Does not apply.** These belong to a *recording* channel, which a riser row is not. Nothing to build. |
   | **the meter** | `ChannelRow.tsx:666`/`729` | **Does not apply, and this is worth stating plainly rather than faking:** the only meter in this app is the live **input-capture** VU overlay, drawn while a channel `isArmed` or is the gated-recording channel. There is **no per-channel playback output meter anywhere in the codebase** (no `VuMeter`/`MasterMeter` component exists), so a stem row does not have one either. Building one for risers would be inventing a feature the rest of the arranger does not have. |
   | **an editable name** | **Not in `ChannelRow` at all.** A clip's name bar (`RifffBlockRow.tsx:166`) *displays* `rifff.name`; clicking it expands the clip. Renaming happens in the **Inspector** (`Inspector.tsx:136`, `RENAME_RIFFF`). | **Applies, and goes further than a clip row does, on purpose:** a riser is not selectable (`state.sel` holds a `groupId`), so the Inspector has no riser view and never will without inventing one. The name bar strip above a riser block is currently an **empty spacer** (`RiserBlock.tsx:176`) — putting the editable name there costs no new chrome and lines up exactly with where a clip's name sits. |
   | **the gain dial** | `RowGainDial.tsx`, rendered by `StemWaveformRow.tsx:548` and `CollapsedRifffRow`, pinned at `right: 26` | **Applies.** Task 7. |

5. **One volume control, not two — and the swap fixes a real undo bug.** `RiserBlock.tsx:279` puts a bare `Dial` in the block's corner wired straight to `SET_RISER_LEVEL` on **every `onChange`**, and `SET_RISER_LEVEL` is *not* in `history.ts`'s `TRANSIENT_ACTION_TYPES` — so one drag of that knob is one undo checkpoint per mousemove today. `RowGainDial` exists precisely to avoid that (`onChange` writes a transient preview, `onCommit` fires the one real action). Moving the riser's level onto `RowGainDial` puts it where a stem row's gain is, removes the fighting second knob, **and** makes a level drag one undo step. The brief asked whether there is a reason this is wrong; there is not, and there is a second reason it is right.

6. **The live preview reuses `SET_DRAG_PREVIEW`, keyed by the riser's id.** `state.dragVol` is `Record<string, number>` keyed by `stemKey(groupId, slot)` = `` `${groupId}:${slot}` `` (`src/shared/types.ts:114`), so a `crypto.randomUUID()` riser id cannot collide with one. `SET_DRAG_PREVIEW` is already in `TRANSIENT_ACTION_TYPES` (`history.ts`), and `state.dragVol` is deliberately **not** in `StoreContext.tsx`'s engine-sync dependency list — so the whole drag costs zero engine reloads and zero undo entries, and the single `SET_RISER_LEVEL` on release costs exactly one of each. No new `AppState` field is needed. This is reuse, not a hack, and the doc comment in Task 7 says so.

7. **Naming lives on the riser, because one riser owns one row.** With one row per riser there is no separate "channel name" concept to invent — the riser's name *is* the row's label. The default is numbered (`riser 1`, `riser 2`, …) and is assigned **in the reducer's `ADD_RISER`**, not in `createRiser`: only the reducer can see the other risers, and only the reducer stays correct inside a `BATCH` that adds several at once (`history.ts`'s `BATCH` branch re-enters `reducer` per action, so the second riser sees the first one's name already taken). `createRiser` leaves `name: ''` meaning "unnamed, number me".

8. **Colour: the riser row's glyph gets none, and the m button's red is the only colour on it.** `tokens.css` spends colour "only on things that carry audio information (stem waveforms/glyphs, the playhead, mute/danger state)", and `typeColorVar(soundType)` is the only sanctioned source — but it takes a `SoundType`, and a riser has none. Giving one would claim an instrument identity the riser does not have, and `RiserBlock`'s own doc comment (`RiserBlock.tsx:44-49`) already made this call for the block itself: "No colour at all… a riser is chrome-plus-shape, not a stem with a sound type." The name bar therefore uses `--ra-text-2`, the same weight/size a clip's name uses. The **one** colour a riser row ever shows is `--ra-mute-on` on the m button when muted — a state colour `tokens.css` explicitly sanctions. Muting the riser itself is shown by **dimming** the hatch/sweep/swell, which is this app's established "grey means quieter/off" language (see `StemWaveformRow.tsx`'s `{!muted && …}` colour layer).

9. **Adding two required fields to `RiserClip` breaks four test fixtures that build one as an object literal.** They are, exactly:
   - `src/main/exportToolkitAudio.test.ts:99`
   - `src/main/nativeExport.test.ts:1094`
   - `src/main/reaper/buildRppProject.test.ts:114` (the `riser()` helper)
   - `src/main/ableton/buildAlsXml.test.ts:1743`

   Every other test builds risers with `createRiser(...)` and needs no change. Task 1 fixes all four in its own commit. **Make the fields required, not optional** — `normaliseRiser` runs on every reducer write and `normaliseLoadedRisers` runs on every load, so they are genuinely always present, and optional fields would push `?? 'riser'` fallbacks into the render path forever.

10. **The guided flow currently does the opposite of one-row-per-riser, deliberately, and that decision is being reversed.** `coachRiserChannelId` (`src/renderer/src/state/coachTensionApply.ts:90`) reuses the last flow-placed riser's row so "a track with three drops would not grow three riser rows". Elling has now chosen one row per riser for hand-placed risers, and guided and hand-placed risers must behave identically ("nothing marks it as sssketchy's" — phase 3's finding 3). So the function is **deleted** and both call sites in `SssketchyTensionPanel.tsx` mint a fresh channel id. Task 11.

11. **A muted riser must also stay out of the DAW exports, or the export lies.** The audio side is free: `exportToolkitAudio.ts`'s `risers.wav` is rendered through `buildEngineProject`, so it silently loses muted risers once Task 4 lands. But `buildRppProject.ts:832` and `buildAlsXml.ts:1333` read `state.risers` **directly** and would place a clip pointing at audio that is no longer in the file. One shared helper, `audibleRisers`, is used by all of them (Task 5). `loopLengthBars` (`selectors.ts:491`) deliberately still counts muted risers, matching the fact that muting a stem does not shorten the arrangement either.

12. **React components are not unit-tested in this codebase** (CLAUDE.md, "Testing conventions"). Tasks 7, 8, 9 and 10 therefore have **no component tests** — that is deliberate, not an omission. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests (which is exactly why Task 3 extracts the mute/solo derivations out of `ChannelRow` into tested pure functions), and then by Elling's manual walkthrough (Task 12). This environment has no GUI or audio tooling — **do not claim any UI or audio behaviour was tested.**

13. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` in a React effect (`react-hooks/set-state-in-effect`), on render-time impurity (`react-hooks/purity`, e.g. a bare `Date.now()` in a component body), and requires an **explicit return type on every function**, including inline ones. Prettier's `printWidth` is 100. All code below already satisfies these. `npm run lint` has **4 known pre-existing prettier warnings in unrelated files**; that is the baseline, not something this plan fixes.

14. **Baseline before Task 1:** 2341 tests / 157 files passing, `npm run typecheck` clean, `npm run lint` 0 errors + those 4 warnings. Branch `auto-arrangement-exploration`.

15. **Out of scope, stated so nobody adds it silently:** dragging a riser vertically onto a *different* row. `beginMove` (`RiserBlock.tsx:91`) only changes `startBar`, and `MOVE_RISER` already accepts an optional `channelId` for whenever that is built. With one row per riser it is no longer the thing being asked for.

## File map

| File | Change |
|---|---|
| `src/shared/riser.ts` | `RiserClip.name` + `.muted`; `RISER_NAME_PREFIX`; `nextRiserName`; `audibleRisers`; `normaliseLoadedRisers`; `createRiser`/`normaliseRiser` updated |
| `src/shared/riser.test.ts` | TDD for all of the above |
| `src/main/exportToolkitAudio.test.ts`, `src/main/nativeExport.test.ts`, `src/main/reaper/buildRppProject.test.ts`, `src/main/ableton/buildAlsXml.test.ts` | the four object-literal riser fixtures gain the two fields |
| `src/renderer/src/state/store.ts` | `RENAME_RISER`, `SET_RISER_MUTE`; `ADD_RISER` numbers an unnamed riser; `SET_CHANNEL_MUTE`/`SOLO_CHANNEL` cover risers |
| `src/renderer/src/state/store.test.ts` | reducer tests for all of the above |
| `src/renderer/src/state/selectors.ts` | `channelAllMuted`, `channelIsSoloed` (extracted from `ChannelRow` so they are testable) |
| `src/renderer/src/state/selectors.test.ts` | TDD for the two |
| `src/shared/buildEngineProject.ts` | `buildEngineRisers` drops muted risers via `audibleRisers` |
| `src/shared/buildEngineProject.test.ts` | a muted riser is absent from the wire |
| `src/main/reaper/buildRppProject.ts`, `src/main/ableton/buildAlsXml.ts`, `src/main/exportToolkitAudio.ts`, `src/main/nativeExport.ts` | use `audibleRisers` |
| `src/main/reaper/buildRppProject.test.ts`, `src/main/ableton/buildAlsXml.test.ts` | a muted riser gets no export clip |
| `src/renderer/src/state/serialize.ts` | `normaliseLoadedRisers` on load |
| `src/renderer/src/state/serialize.test.ts` | round trip + a pre-`name`/`muted` save |
| `src/renderer/src/components/RowGainDial.tsx` | a third `GainDialTarget` kind, `riser` |
| `src/renderer/src/components/RiserBlock.tsx` | editable name bar, row gain dial, mute dimming, corner dial removed |
| `src/renderer/src/components/ChannelRow.tsx` | uses the two new selectors |
| `src/renderer/src/App.tsx` | "add riser on a new row" on the empty-space menu |
| `src/renderer/src/state/coachTensionApply.ts`, `…/coachTensionApply.test.ts`, `src/renderer/src/components/SssketchyTensionPanel.tsx` | one row per guided riser; `coachRiserChannelId` deleted |

---

### Task 1: `RiserClip` gains a name and a mute

**Files:**
- Modify: `src/shared/riser.ts`
- Test: `src/shared/riser.test.ts`
- Modify (fixtures only): `src/main/exportToolkitAudio.test.ts:99`, `src/main/nativeExport.test.ts:1094`, `src/main/reaper/buildRppProject.test.ts:114`, `src/main/ableton/buildAlsXml.test.ts:1743`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/riser.test.ts`, and add `RISER_NAME_PREFIX`, `audibleRisers`, `nextRiserName` and `normaliseLoadedRisers` to the existing `from './riser'` import block at the top of that file:

```ts
describe('riser names', () => {
  it('leaves a new riser unnamed, for the reducer to number', () => {
    expect(createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }).name).toBe('')
  })

  it('takes a name when one is handed to it', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0, name: 'lift' })
    expect(riser.name).toBe('lift')
  })

  it('numbers from one when nothing is named yet', () => {
    expect(nextRiserName({})).toBe(`${RISER_NAME_PREFIX} 1`)
  })

  it('skips every number already taken, whatever order they are in', () => {
    const risers = {
      a: { ...createRiser({ id: 'a', channelId: 'c', startBar: 0 }), name: 'riser 2' },
      b: { ...createRiser({ id: 'b', channelId: 'c', startBar: 0 }), name: 'riser 1' }
    }
    expect(nextRiserName(risers)).toBe('riser 3')
  })

  it('ignores a hand-typed name that is not a default one', () => {
    const risers = {
      a: { ...createRiser({ id: 'a', channelId: 'c', startBar: 0 }), name: 'the big one' }
    }
    expect(nextRiserName(risers)).toBe('riser 1')
  })

  it('trims a name and keeps an empty one empty', () => {
    const base = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 })
    expect(normaliseRiser({ ...base, name: '  lift  ' }).name).toBe('lift')
    expect(normaliseRiser({ ...base, name: '   ' }).name).toBe('')
  })
})

describe('riser mute', () => {
  it('starts unmuted', () => {
    expect(createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }).muted).toBe(false)
  })

  it('normalises anything that is not literally true to false', () => {
    const base = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 })
    expect(normaliseRiser({ ...base, muted: true }).muted).toBe(true)
    expect(normaliseRiser({ ...base, muted: false }).muted).toBe(false)
  })
})

describe('audibleRisers', () => {
  it('leaves out every muted riser', () => {
    const risers = {
      a: createRiser({ id: 'a', channelId: 'ch1', startBar: 0 }),
      b: { ...createRiser({ id: 'b', channelId: 'ch2', startBar: 4 }), muted: true }
    }
    expect(audibleRisers(risers).map((riser) => riser.id)).toEqual(['a'])
  })

  it('sorts by start bar, then by id, so a render never drifts by a few ULPs', () => {
    const risers = {
      late: createRiser({ id: 'late', channelId: 'ch1', startBar: 32 }),
      zz: createRiser({ id: 'zz', channelId: 'ch1', startBar: 0 }),
      aa: createRiser({ id: 'aa', channelId: 'ch1', startBar: 0 })
    }
    expect(audibleRisers(risers).map((riser) => riser.id)).toEqual(['aa', 'zz', 'late'])
  })

  it('normalises on the way out', () => {
    const risers = {
      bad: { ...createRiser({ id: 'bad', channelId: 'ch1', startBar: 0 }), lengthBars: NaN }
    }
    expect(audibleRisers(risers)[0].lengthBars).toBe(MIN_RISER_LENGTH_BARS)
  })
})

describe('normaliseLoadedRisers', () => {
  it('gives a save from before names existed a numbered one, deterministically', () => {
    const saved = {
      b: { id: 'b', channelId: 'chb', startBar: 4, lengthBars: 4, startCutoffValue: 0.3,
        endCutoffValue: 0.95, curve: [], level: 0.6 },
      a: { id: 'a', channelId: 'cha', startBar: 0, lengthBars: 4, startCutoffValue: 0.3,
        endCutoffValue: 0.95, curve: [], level: 0.6 }
    }
    const loaded = normaliseLoadedRisers(saved)
    expect(loaded.a.name).toBe('riser 1')
    expect(loaded.b.name).toBe('riser 2')
    expect(loaded.a.muted).toBe(false)
  })

  it('keeps a name that is already there and numbers around it', () => {
    const saved = {
      a: { id: 'a', channelId: 'cha', startBar: 0, lengthBars: 4, startCutoffValue: 0.3,
        endCutoffValue: 0.95, curve: [], level: 0.6, name: 'riser 1', muted: true },
      b: { id: 'b', channelId: 'chb', startBar: 4, lengthBars: 4, startCutoffValue: 0.3,
        endCutoffValue: 0.95, curve: [], level: 0.6 }
    }
    const loaded = normaliseLoadedRisers(saved)
    expect(loaded.a.name).toBe('riser 1')
    expect(loaded.a.muted).toBe(true)
    expect(loaded.b.name).toBe('riser 2')
  })

  it('gives a riser with no channel a row of its own rather than dropping it', () => {
    const loaded = normaliseLoadedRisers({ a: { id: 'a', startBar: 0 } })
    expect(loaded.a.channelId).toBe('a')
    expect(loaded.a.lengthBars).toBe(RISER_DEFAULTS.lengthBars)
  })

  it('returns an empty record for a project saved before risers existed', () => {
    expect(normaliseLoadedRisers(undefined)).toEqual({})
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/riser.test.ts`
Expected: FAIL — `nextRiserName is not a function`, `audibleRisers is not a function`, `normaliseLoadedRisers is not a function`, plus TS errors on the unknown `name`/`muted` properties.

- [ ] **Step 3: Write the implementation**

In `src/shared/riser.ts`, add the two fields to the end of the `RiserClip` interface (after `level`):

```ts
  /** What this riser's ROW is called. A riser owns a whole arranger row now
   * (one row per riser -- Elling, 2026-09-23: "give the riser ... its own
   * channel"), so the riser's name IS the row's label and there is no
   * separate channel-name concept to invent. EMPTY means "unnamed, number
   * me": the reducer's ADD_RISER fills it with nextRiserName, because that
   * is the only place that can see the other risers -- and the only place
   * that stays correct inside a BATCH adding several at once. */
  name: string
  /** Silences this riser. Renderer-side ONLY: there is no `muted` on
   * EngineRiser, and there must not be. A muted riser is simply ABSENT from
   * the wire (see audibleRisers / buildEngineRisers), which is the same
   * "absence is load-bearing" trick a neutral toolkit already uses, and it
   * is why muting a riser needs no native-engine change at all.
   *
   * A riser has no stems, so state.mute -- keyed by stemKey -- has nothing
   * to key it by. This flag is the riser's half of the channel's m button;
   * store.ts's SET_CHANNEL_MUTE and SOLO_CHANNEL move both halves together. */
  muted: boolean
```

Add, just below `RISER_DEFAULTS`:

```ts
/** The stem of every default riser name -- "riser 1", "riser 2", ... Lower
 * case with no punctuation, matching this app's copy rules (tokens.css). */
export const RISER_NAME_PREFIX = 'riser'
```

Replace `createRiser` with:

```ts
export function createRiser(fields: {
  id: string
  channelId: string
  startBar: number
  lengthBars?: number
  /** Left out by every caller today. Naming happens in the reducer, not
   * here -- see RiserClip.name. */
  name?: string
}): RiserClip {
  const lengthBars = Math.max(MIN_RISER_LENGTH_BARS, fields.lengthBars ?? RISER_DEFAULTS.lengthBars)
  return normaliseRiser({
    id: fields.id,
    channelId: fields.channelId,
    startBar: Math.max(0, fields.startBar),
    lengthBars,
    startCutoffValue: RISER_DEFAULTS.startCutoffValue,
    endCutoffValue: RISER_DEFAULTS.endCutoffValue,
    curve: defaultRiserCurve(
      RISER_DEFAULTS.startCutoffValue,
      RISER_DEFAULTS.endCutoffValue,
      lengthBars
    ),
    level: RISER_DEFAULTS.level,
    name: fields.name ?? '',
    muted: false
  })
}
```

In `normaliseRiser`'s returned object, add two entries after `curve` (keeping `level` where it is):

```ts
    name: typeof riser.name === 'string' ? riser.name.trim() : '',
    muted: riser.muted === true,
```

Add, after `normaliseRiser`:

```ts
/** The next unused default riser name for this project. Skips every number
 * already taken (in any order, and ignoring hand-typed names, which are
 * nobody's business to renumber around), so deleting "riser 2" and adding
 * one gets "riser 2" back rather than a forever-climbing counter. */
export function nextRiserName(risers: Record<string, RiserClip>): string {
  const taken = new Set(Object.values(risers).map((riser) => riser.name))
  let n = 1
  while (taken.has(`${RISER_NAME_PREFIX} ${n}`)) n += 1
  return `${RISER_NAME_PREFIX} ${n}`
}

/**
 * Every riser that should actually SOUND -- normalised, unmuted, earliest
 * first with `id` as the tiebreak.
 *
 * The one place the mute rule lives, used by the wire (buildEngineRisers)
 * and by both DAW exports (buildRppProject, buildAlsXml) so a muted riser
 * cannot be silent in the rendered audio while still getting a clip in the
 * .rpp/.als that points at it.
 *
 * The ordering is load-bearing in the same quiet way the stem loop's is: the
 * engine sums risers into their channel in the order it receives them, and
 * float addition is not associative, so an unstable order (which
 * Object.values over a record is, across a save/load round trip) would make
 * a project's render differ from itself by a few ULPs for no reason.
 */
export function audibleRisers(risers: Record<string, RiserClip>): RiserClip[] {
  return Object.values(risers)
    .map(normaliseRiser)
    .filter((riser) => !riser.muted)
    .sort((a, b) => a.startBar - b.startBar || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** One riser exactly as it might come off disk: every field optional,
 * because a `.sssketchproj` saved before a field existed simply does not
 * have it, and one that has been hand-edited might be missing anything. */
export type PersistedRiser = Partial<RiserClip> & { id?: string }

/**
 * Every saved riser, brought up to today's shape -- run once at load time
 * (serialize.ts's deserializeProject).
 *
 * The reducer normalises on every write and buildEngineRisers normalises
 * again on the way out, but neither of those has run yet at the moment a
 * project is opened: without this, a riser saved before `name` existed would
 * render its row label as literally "undefined" until something happened to
 * dispatch against it.
 *
 * Keys are walked in sorted order so the numbers a project picks up on its
 * first open are the same every time, rather than depending on JSON key
 * order.
 */
export function normaliseLoadedRisers(
  risers: Record<string, PersistedRiser> | undefined
): Record<string, RiserClip> {
  if (!risers) return {}
  const out: Record<string, RiserClip> = {}
  for (const id of Object.keys(risers).sort()) {
    const saved = risers[id]
    if (saved === null || typeof saved !== 'object') continue
    const normalised = normaliseRiser({
      id,
      // A riser with no channel gets a row of its own, named after itself --
      // which is exactly the one-row-per-riser rule everything else here
      // follows, rather than silently dropping it.
      channelId: saved.channelId ?? id,
      startBar: saved.startBar ?? 0,
      lengthBars: saved.lengthBars ?? RISER_DEFAULTS.lengthBars,
      startCutoffValue: saved.startCutoffValue ?? RISER_DEFAULTS.startCutoffValue,
      endCutoffValue: saved.endCutoffValue ?? RISER_DEFAULTS.endCutoffValue,
      curve: saved.curve ?? [],
      level: saved.level ?? RISER_DEFAULTS.level,
      name: saved.name ?? '',
      muted: saved.muted ?? false
    })
    out[id] = normalised.name === '' ? { ...normalised, name: nextRiserName(out) } : normalised
  }
  return out
}
```

- [ ] **Step 4: Fix the four object-literal fixtures**

Each of these builds a riser as a bare object and will now fail to typecheck. Add `name` and `muted` to each.

`src/main/exportToolkitAudio.test.ts` — in the `const riser = { … }` at line 99, after `level: 0.6,`:

```ts
  name: 'riser 1',
  muted: false
```

`src/main/nativeExport.test.ts` — in the `const riser = { … }` inside `describe('risers in an isolated render', …)` at line 1094, after `level: 0.6,`:

```ts
    name: 'riser 1',
    muted: false
```

`src/main/reaper/buildRppProject.test.ts` — in the `riser(overrides)` helper at line 114, after `level: 0.6,` and **before** `...overrides`:

```ts
    name: 'riser 1',
    muted: false,
```

`src/main/ableton/buildAlsXml.test.ts` — in the riser literal at line 1743, after `level: 0.6`:

```ts
              ,
              name: 'riser 1',
              muted: false
```

(Write it as a normal trailing addition — `level: 0.6,` then the two lines — rather than a leading comma; the shape above is only to show where it goes.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/shared/riser.test.ts src/shared/buildEngineProject.test.ts`
Expected: PASS, all files.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/riser.ts src/shared/riser.test.ts \
  src/main/exportToolkitAudio.test.ts src/main/nativeExport.test.ts \
  src/main/reaper/buildRppProject.test.ts src/main/ableton/buildAlsXml.test.ts
git commit -m "feat(riser): a riser carries its own name and its own mute

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 2: The reducer names risers, renames them, and mutes them with the row

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/state/store.test.ts`:

```ts
describe('a riser on its own row', () => {
  function withRiser(id: string, channelId: string): AppState {
    return reducer(initialState, {
      type: 'ADD_RISER',
      riser: createRiser({ id, channelId, startBar: 0 })
    })
  }

  it('numbers an unnamed riser as it lands', () => {
    const state = withRiser('r1', 'ch-r1')
    expect(state.risers['r1'].name).toBe('riser 1')
  })

  it('numbers a second one without repeating the first', () => {
    let state = withRiser('r1', 'ch-r1')
    state = reducer(state, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'r2', channelId: 'ch-r2', startBar: 8 })
    })
    expect([state.risers['r1'].name, state.risers['r2'].name]).toEqual(['riser 1', 'riser 2'])
  })

  it('keeps a name the caller asked for', () => {
    const state = reducer(initialState, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'r1', channelId: 'ch-r1', startBar: 0, name: 'the lift' })
    })
    expect(state.risers['r1'].name).toBe('the lift')
  })

  it('renames one, trimming what was typed', () => {
    const state = reducer(withRiser('r1', 'ch-r1'), {
      type: 'RENAME_RISER',
      id: 'r1',
      name: '  into the drop  '
    })
    expect(state.risers['r1'].name).toBe('into the drop')
  })

  it('ignores a rename to nothing rather than leaving a blank row', () => {
    const before = withRiser('r1', 'ch-r1')
    expect(reducer(before, { type: 'RENAME_RISER', id: 'r1', name: '   ' })).toBe(before)
  })

  it('mutes and unmutes one directly', () => {
    let state = reducer(withRiser('r1', 'ch-r1'), {
      type: 'SET_RISER_MUTE',
      id: 'r1',
      muted: true
    })
    expect(state.risers['r1'].muted).toBe(true)
    state = reducer(state, { type: 'SET_RISER_MUTE', id: 'r1', muted: false })
    expect(state.risers['r1'].muted).toBe(false)
  })

  it('mutes the risers on a row when the row is muted', () => {
    let state = withRiser('r1', 'ch-r1')
    state = reducer(state, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'r2', channelId: 'other', startBar: 0 })
    })
    state = reducer(state, { type: 'SET_CHANNEL_MUTE', channelId: 'ch-r1', muted: true })
    expect(state.risers['r1'].muted).toBe(true)
    expect(state.risers['r2'].muted).toBe(false)
  })

  it('solos a riser row by muting every other riser', () => {
    let state = withRiser('r1', 'ch-r1')
    state = reducer(state, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'r2', channelId: 'other', startBar: 0 })
    })
    state = reducer(state, { type: 'SOLO_CHANNEL', channelId: 'ch-r1' })
    expect(state.risers['r1'].muted).toBe(false)
    expect(state.risers['r2'].muted).toBe(true)
  })

  it('un-solos back to everything audible on a second press', () => {
    let state = withRiser('r1', 'ch-r1')
    state = reducer(state, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'r2', channelId: 'other', startBar: 0 })
    })
    state = reducer(state, { type: 'SOLO_CHANNEL', channelId: 'ch-r1' })
    state = reducer(state, { type: 'SOLO_CHANNEL', channelId: 'ch-r1' })
    expect(state.risers['r1'].muted).toBe(false)
    expect(state.risers['r2'].muted).toBe(false)
  })

  it('leaves the risers record untouched when there are none to solo', () => {
    const before = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    const after = reducer(before, { type: 'SOLO_CHANNEL', channelId: 'nope' })
    expect(after.risers).toBe(before.risers)
  })
})
```

`makeRifff` (the file's own fixture factory, `store.test.ts:10`), `AppState`, `initialState`, `reducer` and `createRiser` are all already imported or defined at the top of `store.test.ts` — no import changes are needed for these tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t 'a riser on its own row'`
Expected: FAIL — TS errors on the unknown action types `RENAME_RISER` / `SET_RISER_MUTE`, and `riser 1` assertions failing because `ADD_RISER` does not name anything yet.

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/state/store.ts`, widen the `@shared/riser` import (line 13):

```ts
import {
  MIN_RISER_LENGTH_BARS,
  nextRiserName,
  normaliseRiser,
  type RiserClip
} from '@shared/riser'
```

Add two action types, immediately after the `SET_RISER_LEVEL` line (`store.ts:705`):

```ts
  /** This riser's row label. A blank rename is ignored rather than leaving
   * an unlabelled row -- EditableText already discards one, this is the
   * belt-and-braces half. */
  | { type: 'RENAME_RISER'; id: string; name: string }
  /** This riser's own mute. A riser has no stems, so state.mute cannot hold
   * it; muting is what keeps it off the wire entirely (audibleRisers). */
  | { type: 'SET_RISER_MUTE'; id: string; muted: boolean }
```

Add this helper next to `channelHasAnyClip` (near `store.ts:71`):

```ts
/** Every riser on one channel, muted or unmuted together. Returns the SAME
 * record when nothing changed, so a mute on a riserless row cannot trigger
 * StoreContext's engine-sync effect (which depends on state.risers) for
 * nothing. */
function setRisersMutedOnChannel(
  risers: Record<string, RiserClip>,
  channelId: string,
  muted: boolean
): Record<string, RiserClip> {
  let changed = false
  const next: Record<string, RiserClip> = {}
  for (const [id, riser] of Object.entries(risers)) {
    if (riser.channelId === channelId && riser.muted !== muted) {
      next[id] = { ...riser, muted }
      changed = true
    } else {
      next[id] = riser
    }
  }
  return changed ? next : risers
}
```

Replace the body of `case 'ADD_RISER'` (`store.ts:1787-1802`) with:

```ts
    case 'ADD_RISER': {
      const normalised = normaliseRiser(action.riser)
      // An unnamed riser is numbered HERE rather than in createRiser,
      // because this is the only place that can see the other risers -- and
      // the only place that stays correct inside a BATCH adding several at
      // once (history.ts re-enters this reducer per action, so the second
      // riser already sees the first one's name taken).
      const riser =
        normalised.name === ''
          ? { ...normalised, name: nextRiserName(state.risers) }
          : normalised
      // A riser keeps its own row alive (see channelHasAnyClip), so a riser
      // landing on a channel nobody has placed a clip on yet has to put that
      // channel into channelOrder itself -- otherwise channelsInOrder would
      // render it in first-seen fallback position rather than where the user
      // dropped it.
      const channelOrder = state.channelOrder.includes(riser.channelId)
        ? state.channelOrder
        : [...state.channelOrder, riser.channelId]
      return {
        ...state,
        channelOrder,
        risers: { ...state.risers, [riser.id]: riser }
      }
    }
```

Add two cases immediately after `case 'SET_RISER_LEVEL'` (`store.ts:1867`):

```ts
    case 'RENAME_RISER': {
      const existing = state.risers[action.id]
      if (!existing) return state
      const name = action.name.trim()
      if (name === '') return state
      return { ...state, risers: { ...state.risers, [action.id]: { ...existing, name } } }
    }

    case 'SET_RISER_MUTE': {
      const existing = state.risers[action.id]
      if (!existing) return state
      if (existing.muted === action.muted) return state
      return {
        ...state,
        risers: { ...state.risers, [action.id]: { ...existing, muted: action.muted } }
      }
    }
```

Replace the `return` of `case 'SET_CHANNEL_MUTE'` (`store.ts:1459`) with:

```ts
      // A riser has no stems, so state.mute has nothing to key it by: its
      // own `muted` flag is the other half of this row's m button. Without
      // this, a riser-only row's m button renders, lights up, and changes
      // nothing audible.
      const risers = setRisersMutedOnChannel(state.risers, action.channelId, action.muted)
      return { ...state, mute, risers }
```

Replace `case 'SOLO_CHANNEL'` (`store.ts:1462-1480`) with:

```ts
    case 'SOLO_CHANNEL': {
      const rifffList = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
      const channelOfRifff = (r: Rifff): string => state.channelOf[r.groupId] ?? r.groupId
      const riserList = Object.values(state.risers)
      // Risers join the "is this already the only thing audible" scan on the
      // same terms the clips do -- otherwise soloing a riser-only row would
      // look like a no-op to the toggle and never turn back off.
      const alreadySoloed =
        rifffList.every((rifff) =>
          rifff.stems.every((stem) => {
            const expectedMuted = channelOfRifff(rifff) !== action.channelId
            return !!state.mute[stemKey(rifff.groupId, stem.slot)] === expectedMuted
          })
        ) && riserList.every((riser) => riser.muted === (riser.channelId !== action.channelId))
      const mute = { ...state.mute }
      for (const rifff of rifffList) {
        for (const stem of rifff.stems) {
          mute[stemKey(rifff.groupId, stem.slot)] = alreadySoloed
            ? false
            : channelOfRifff(rifff) !== action.channelId
        }
      }
      // Same identity guard as setRisersMutedOnChannel's: a project with no
      // risers must not get a fresh (equal) record and a needless engine
      // reload out of every solo press.
      let risers = state.risers
      if (riserList.length > 0) {
        risers = {}
        for (const riser of riserList) {
          risers[riser.id] = {
            ...riser,
            muted: alreadySoloed ? false : riser.channelId !== action.channelId
          }
        }
      }
      return { ...state, mute, risers }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "feat(riser): name a riser as it lands, and mute it with its row

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 3: The row's m/s state becomes two tested pure functions

`ChannelRow.tsx` computes `allMuted` and `soloed` inline in two `useMemo`s over the whole project. Both need to learn about risers, and React components are not unit-tested here (finding 12) — so the rules move to `selectors.ts` where they can be.

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/state/selectors.test.ts`, adding `channelAllMuted` and `channelIsSoloed` to the existing `from './selectors'` import block:

```ts
describe('channelAllMuted', () => {
  const clip = {
    groupId: 'g1',
    name: 'g1',
    bpm: 120,
    barLength: 4,
    startBar: 0,
    stems: [{ slot: 1, name: 's', path: '/a.wav', durationSec: 8, barLength: 4 }]
  }

  it('is false for a row with nothing on it', () => {
    expect(channelAllMuted({ rifffs: [], channelRisers: [], mute: {} })).toBe(false)
  })

  it('is true when every stem on the row is muted', () => {
    expect(channelAllMuted({ rifffs: [clip], channelRisers: [], mute: { 'g1:1': true } })).toBe(
      true
    )
  })

  it('is false when a riser on the row is still audible', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 })
    expect(
      channelAllMuted({ rifffs: [clip], channelRisers: [riser], mute: { 'g1:1': true } })
    ).toBe(false)
  })

  it('is true for a riser-only row whose riser is muted', () => {
    const riser = { ...createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }), muted: true }
    expect(channelAllMuted({ rifffs: [], channelRisers: [riser], mute: {} })).toBe(true)
  })
})

describe('channelIsSoloed', () => {
  const riserHere = createRiser({ id: 'here', channelId: 'ch1', startBar: 0 })
  const riserThere = createRiser({ id: 'there', channelId: 'ch2', startBar: 0 })

  it('is true for a riser-only row when every other riser is muted', () => {
    expect(
      channelIsSoloed({
        channelId: 'ch1',
        channelGroupIds: new Set<string>(),
        rifffs: {},
        risers: { here: riserHere, there: { ...riserThere, muted: true } },
        mute: {}
      })
    ).toBe(true)
  })

  it('is false while another row is still audible', () => {
    expect(
      channelIsSoloed({
        channelId: 'ch1',
        channelGroupIds: new Set<string>(),
        rifffs: {},
        risers: { here: riserHere, there: riserThere },
        mute: {}
      })
    ).toBe(false)
  })

  it('is false for a clip row while a riser elsewhere is still audible', () => {
    const clip = {
      groupId: 'g1',
      name: 'g1',
      bpm: 120,
      barLength: 4,
      startBar: 0,
      stems: [{ slot: 1, name: 's', path: '/a.wav', durationSec: 8, barLength: 4 }]
    }
    expect(
      channelIsSoloed({
        channelId: 'ch1',
        channelGroupIds: new Set(['g1']),
        rifffs: { g1: clip },
        risers: { there: riserThere },
        mute: {}
      })
    ).toBe(false)
  })
})
```

Add `import { createRiser } from '@shared/riser'` to the top of `selectors.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts -t 'channel'`
Expected: FAIL — `channelAllMuted is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/state/selectors.ts`, widen the riser import (line 10):

```ts
import { riserEndBar, type RiserClip } from '@shared/riser'
```

Append to the file:

```ts
/**
 * Is everything on this arranger row silent -- the state the row's `m`
 * button lights up for.
 *
 * Lives here rather than inline in ChannelRow because a riser row's mute is
 * the one piece of this feature that can actually be got wrong quietly (a
 * button that lights up and changes nothing), and React components are not
 * unit-tested in this codebase. Takes narrow explicit fields, not AppState,
 * so ChannelRow keeps its fine-grained useAppSelector reads.
 *
 * An EMPTY row is never "all muted": there is nothing to have silenced, and
 * lighting the button on a bare recording row would be a lie. This matches
 * the `rifffs.length > 0 &&` guard this rule already had.
 */
export function channelAllMuted(fields: {
  /** This row's PLACED rifffs (ChannelRow's own `rifffs` prop). */
  rifffs: Rifff[]
  /** This row's risers (risersOnChannel). */
  channelRisers: RiserClip[]
  mute: Record<string, boolean>
}): boolean {
  const { rifffs, channelRisers, mute } = fields
  if (rifffs.length === 0 && channelRisers.length === 0) return false
  return (
    rifffs.every((rifff) => rifff.stems.every((s) => !!mute[stemKey(rifff.groupId, s.slot)])) &&
    channelRisers.every((riser) => riser.muted)
  )
}

/**
 * Is this row the only audible thing in the project -- the state the row's
 * `s` button lights up for, and the same definition SOLO_CHANNEL's own
 * "alreadySoloed" check uses so the toggle and the light cannot disagree.
 *
 * When the project has exactly one row this is trivially true even with
 * nothing "soloed" -- the same accepted edge case SOLO_GROUP has always had,
 * not a new one.
 */
export function channelIsSoloed(fields: {
  channelId: string
  /** The groupIds of this row's placed rifffs. */
  channelGroupIds: Set<string>
  /** EVERY rifff in the project, placed or not -- the scan genuinely needs
   * all of them, since "soloed" is a statement about everything else. */
  rifffs: Record<string, Rifff>
  /** EVERY riser in the project, for the same reason. */
  risers: Record<string, RiserClip>
  mute: Record<string, boolean>
}): boolean {
  const { channelId, channelGroupIds, rifffs, risers, mute } = fields
  const clipsAgree = Object.values(rifffs).every((rifff) => {
    if (rifff.startBar === undefined) return true
    const inThisChannel = channelGroupIds.has(rifff.groupId)
    return rifff.stems.every(
      (s) => !!mute[stemKey(rifff.groupId, s.slot)] === !inThisChannel
    )
  })
  if (!clipsAgree) return false
  return Object.values(risers).every((riser) => riser.muted === (riser.channelId !== channelId))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "feat(riser): a row's mute and solo state, as tested pure rules

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 4: A muted riser does not go on the wire

**Files:**
- Modify: `src/shared/buildEngineProject.ts:309-323`
- Test: `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing risers `describe` block in `src/shared/buildEngineProject.test.ts`:

```ts
  it('leaves a muted riser off the wire entirely, rather than sending it silent', () => {
    const risers = {
      on: createRiser({ id: 'on', channelId: 'ch1', startBar: 0 }),
      off: { ...createRiser({ id: 'off', channelId: 'ch2', startBar: 4 }), muted: true }
    }
    expect(buildEngineRisers(risers).map((riser) => riser.id)).toEqual(['on'])
  })

  it('sends no risers at all when every one of them is muted', () => {
    const risers = {
      off: { ...createRiser({ id: 'off', channelId: 'ch1', startBar: 0 }), muted: true }
    }
    expect(buildEngineRisers(risers)).toEqual([])
  })
```

If `buildEngineRisers` is not already imported in that file, add it to the existing `from './buildEngineProject'` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/buildEngineProject.test.ts -t 'muted riser'`
Expected: FAIL — `expected [ 'on', 'off' ] to deeply equal [ 'on' ]`.

- [ ] **Step 3: Write the implementation**

In `src/shared/buildEngineProject.ts`, widen the riser import (line 19):

```ts
import { audibleRisers, type RiserClip } from './riser'
```

`normaliseRiser` is no longer referenced in this file once `buildEngineRisers` changes; remove it from that import if nothing else uses it (grep before deleting).

Replace `buildEngineRisers` and the last paragraph of its doc comment with:

```ts
/**
 * Projects the placed risers down to the wire, earliest first.
 *
 * A MUTED riser is simply not here. That absence is load-bearing, and it is
 * the whole reason muting a riser needs no native-engine change: a riser has
 * no stems, so there is no EngineStem.muted to set, and EngineRiser
 * deliberately has no `muted` field of its own (it is the hand-synced twin
 * of EngineRiser in native-engine/Source/EngineProject.h -- see CLAUDE.md --
 * and adding a field would mean a C++ change and a rebuild for something
 * "send one fewer array entry" already expresses). Same shape as a cleared
 * toolkit dropping its `toolkit` key (isStemToolkitNeutral): the engine's own
 * neutral path is already the one that runs when nothing is there.
 *
 * Ordering, normalisation and the mute rule all live in audibleRisers
 * (@shared/riser), so the wire and both DAW exports cannot disagree about
 * which risers exist -- see its own doc comment for why the order matters.
 */
export function buildEngineRisers(risers: Record<string, RiserClip>): EngineRiser[] {
  return audibleRisers(risers).map((riser) => ({
    id: riser.id,
    channelId: riser.channelId,
    startBar: riser.startBar,
    lengthBars: riser.lengthBars,
    startCutoffValue: riser.startCutoffValue,
    endCutoffValue: riser.endCutoffValue,
    level: riser.level,
    curve: riser.curve
  }))
}
```

Also add one line to `EngineRiser`'s own doc comment (`buildEngineProject.ts:104-115`), after the "Field-for-field identical to RiserClip" sentence:

```
 * Two RiserClip fields are deliberately NOT here: `name` (a row label, which
 * the engine has no use for) and `muted` (expressed as absence -- see
 * buildEngineRisers).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "feat(riser): a muted riser drops off the wire, no engine change

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 5: A muted riser does not get an export clip either

**Files:**
- Modify: `src/main/reaper/buildRppProject.ts:832`
- Modify: `src/main/ableton/buildAlsXml.ts:1333`
- Modify: `src/main/exportToolkitAudio.ts:148`
- Modify: `src/main/nativeExport.ts:322`
- Test: `src/main/reaper/buildRppProject.test.ts`, `src/main/ableton/buildAlsXml.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/reaper/buildRppProject.test.ts`, inside the existing riser `describe` block:

```ts
  it('gives a muted riser no item, since the rendered risers.wav has no riser in it', () => {
    const state = emptyAppState({
      bpm: 120,
      risers: {
        'riser-1': riser({ id: 'riser-1', startBar: 4, lengthBars: 2, muted: true }),
        'riser-2': riser({ id: 'riser-2', startBar: 12, lengthBars: 4 })
      }
    })
    const { tracks } = tracksOf(buildRppProject(state, new Map(), automationOptions('risers.wav')))
    const riserTracks = trackNamed(tracks, 'risers')
    expect(riserTracks).toHaveLength(1)
    expect(findAllChildren(riserTracks[0], 'ITEM')).toHaveLength(1)
  })

  it('emits no risers track at all when every riser is muted', () => {
    const state = emptyAppState({
      bpm: 120,
      risers: { 'riser-1': riser({ id: 'riser-1', muted: true }) }
    })
    const { tracks } = tracksOf(buildRppProject(state, new Map(), automationOptions('risers.wav')))
    expect(trackNamed(tracks, 'risers')).toHaveLength(0)
  })
```

(`emptyAppState`, `riser`, `tracksOf`, `trackNamed`, `automationOptions` and `findAllChildren` are all already defined/imported in that file — see the `describe('buildRppProject: risers', …)` block at line 797, which these two sit beside.)

In `src/main/ableton/buildAlsXml.test.ts`, inside the existing `describe('risers', …)` block (line 1738), after the test already there:

```ts
    it('gives a muted riser no ableton clip, so no risers track at all', () => {
      const state = toolkitState({
        risers: {
          r1: {
            id: 'r1',
            channelId: 'rifff-1',
            startBar: 4,
            lengthBars: 2,
            startCutoffValue: 0.3,
            endCutoffValue: 0.95,
            curve: [],
            level: 0.6,
            name: 'riser 1',
            muted: true
          }
        }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
        mode: 'bake',
        toolkitAudio: { bakedClips: new Map(), riserFileName: 'risers.wav' }
      })
      const { tracks } = tracksOf(xml)
      const riserTrack = findAllChildren(tracks, 'AudioTrack').find((t) => {
        const name = findChild(childArray(t, 'AudioTrack'), 'Name')!
        return attrs(findChild(childArray(name, 'Name'), 'EffectiveName')!)['@_Value'] === 'risers'
      })
      expect(riserTrack).toBeUndefined()
    })
```

(The track-finding idiom above is copied verbatim from the test directly preceding it, minus its trailing `!`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/reaper/buildRppProject.test.ts src/main/ableton/buildAlsXml.test.ts -t 'muted riser'`
Expected: FAIL — a `risers` track is produced for the muted riser.

- [ ] **Step 3: Write the implementation**

`src/main/reaper/buildRppProject.ts` — add `import { audibleRisers } from '@shared/riser'` (the file already imports from `@shared/riser`; extend that import), then replace lines 832-834:

```ts
  // audibleRisers, not Object.values: a muted riser is not in the rendered
  // risers.wav (buildEngineRisers left it off the wire), so an item pointing
  // at it would be an item pointing at silence. Same ordering, from the same
  // one place, as the wire uses.
  const risers = audibleRisers(state.risers ?? {})
```

`src/main/ableton/buildAlsXml.ts` — add the same import, then replace lines 1333-1335:

```ts
    // See buildRppProject's own note: a muted riser is not in risers.wav.
    const risers = audibleRisers(state.risers ?? {})
```

`src/main/exportToolkitAudio.ts` — add `audibleRisers` to the `@shared/riser` import (add the import if absent), then replace line 148:

```ts
  // Muted risers are already absent from what the engine would render, so a
  // project whose only risers are muted must not spend a whole extra engine
  // render producing a silent risers.wav nothing references.
  const hasRisers = audibleRisers(state.risers ?? {}).length > 0
```

`src/main/nativeExport.ts` — add the same import, then replace line 322 inside `renderRisersIfAny`:

```ts
  if (audibleRisers(state.risers ?? {}).length === 0) return undefined
```

Neither of those last two gets a unit test: both are guards inside functions that spawn and drive a real engine subprocess, and this codebase verifies that layer by manual walkthrough (CLAUDE.md, "Testing conventions"). Say so in your report rather than mocking the engine to reach them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/reaper/buildRppProject.test.ts src/main/ableton/buildAlsXml.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/reaper/buildRppProject.ts src/main/reaper/buildRppProject.test.ts \
  src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts \
  src/main/exportToolkitAudio.ts src/main/nativeExport.ts
git commit -m "feat(riser): a muted riser leaves the .rpp and .als too

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 6: A project saved before names and mutes still opens

**Files:**
- Modify: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('noise risers in the saved file', …)` block in `src/renderer/src/state/serialize.test.ts`:

```ts
  it('round-trips a named, muted riser', () => {
    let state = reducer(initialState, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'riser-1', channelId: 'ch1', startBar: 12, lengthBars: 8 })
    })
    state = reducer(state, { type: 'RENAME_RISER', id: 'riser-1', name: 'into the drop' })
    state = reducer(state, { type: 'SET_RISER_MUTE', id: 'riser-1', muted: true })

    const { state: restored } = deserializeProject(JSON.parse(serializeProject(state)))

    expect(restored.risers['riser-1'].name).toBe('into the drop')
    expect(restored.risers['riser-1'].muted).toBe(true)
  })

  it('numbers a riser saved before names existed, and leaves it audible', () => {
    const state = reducer(initialState, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'riser-1', channelId: 'ch1', startBar: 12 })
    })
    const saved = JSON.parse(serializeProject(state))
    delete saved.risers['riser-1'].name
    delete saved.risers['riser-1'].muted

    const { state: restored } = deserializeProject(saved)

    expect(restored.risers['riser-1'].name).toBe('riser 1')
    expect(restored.risers['riser-1'].muted).toBe(false)
    expect(restored.risers['riser-1'].startBar).toBe(12)
  })
```

(`JSON.parse` returns `any`, so the two `delete`s need no cast and `deserializeProject` accepts the result — this is exactly the idiom the neighbouring legacy tests in this file already use.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts -t 'riser'`
Expected: FAIL — `expected undefined to be 'riser 1'`.

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/state/serialize.ts`, add to the imports:

```ts
import { normaliseLoadedRisers } from '@shared/riser'
```

and add one line in `deserializeProject`, immediately after `state.rifffs = snapBarLengthNoise(state.rifffs)` (line 363):

```ts
  // Risers came before their `name` and `muted` fields did, and a
  // `.sssketchproj` is plain JSON people can and do hand-edit -- so every
  // saved riser is brought up to today's shape here, once, before anything
  // renders it. Without this a pre-2026-09-23 project's rows would be
  // labelled "undefined" until something happened to dispatch against them.
  state.risers = normaliseLoadedRisers(state.risers)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/serialize.ts src/renderer/src/state/serialize.test.ts
git commit -m "feat(riser): old projects load with named, audible risers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 7: The row gain dial learns about risers

**No component test** — `RowGainDial` is a React component (finding 12). Verified by typecheck, lint, and the manual walkthrough in Task 12.

**Files:**
- Modify: `src/renderer/src/components/RowGainDial.tsx`

- [ ] **Step 1: Add the third target kind**

Replace the `GainDialTarget` union and its doc comment (`RowGainDial.tsx:19-28`):

```ts
/** Whose gain this dial moves. An EXPANDED rifff shows one row per stem, so
 * each dial owns exactly its own stem; a COLLAPSED one draws its stems as a
 * single block, so its one dial moves the whole rifff together -- the same
 * rule SET_GROUP_VOLUME/SET_GROUP_MUTE and the collapsed automation lane
 * already follow, rather than a third convention. Either way the gain is
 * STORED per stem (state.vol, keyed by stemKey), so expanding a collapsed
 * clip afterwards reveals per-stem dials that can then diverge.
 *
 * A RISER is the odd one out and deliberately shares this control anyway: it
 * has no stem and no state.vol entry, so its number is RiserClip.level and
 * its commit is SET_RISER_LEVEL. It gets this dial rather than a knob of its
 * own because a riser now owns a whole arranger row (2026-09-23), and one
 * row should have exactly one level control in exactly one place -- the
 * riser's old corner knob (RiserBlock.tsx) was removed in the same change
 * rather than shipping two that fight. */
export type GainDialTarget =
  | { kind: 'stem'; stemKey: string }
  | { kind: 'group'; groupId: string; representativeStemKey: string }
  | { kind: 'riser'; riserId: string }
```

- [ ] **Step 2: Read the right value and write the right action**

Replace the selector block (`RowGainDial.tsx:74-84`):

```ts
  const dispatch = useDispatch()
  const key =
    target.kind === 'stem'
      ? target.stemKey
      : target.kind === 'group'
        ? target.representativeStemKey
        : target.riserId
  const stemGain = useAppSelector((s) => s.vol[key] ?? 1)
  // A riser's level is on the riser, not in state.vol. Read unconditionally
  // (null for the other two kinds) so the hook order stays fixed, which is
  // what a conditional useAppSelector would break.
  const riserLevel = useAppSelector((s) =>
    target.kind === 'riser' ? (s.risers[target.riserId]?.level ?? null) : null
  )
  // ?? not ||: a riser dialled to 0 is a real value, not "unset".
  const committed = riserLevel ?? stemGain
  // The in-progress drag, for every kind. A riser reuses state.dragVol keyed
  // by its own id: dragVol keys are stemKeys (`${groupId}:${slot}`), so a
  // crypto.randomUUID riser id cannot collide with one, SET_DRAG_PREVIEW is
  // already transient in history.ts, and state.dragVol is deliberately NOT
  // in StoreContext's engine-sync deps -- so a riser level drag costs zero
  // undo checkpoints and zero engine reloads until it lands. (Before this,
  // the riser's corner knob dispatched SET_RISER_LEVEL on every mousemove,
  // which is one undo checkpoint per mousemove -- a real bug this fixes.)
  const preview = useAppSelector((s) => s.dragVol[key] ?? null)
  // Only a group dial needs this (to fan its live value out across every
  // stem); reading it for the other kinds too keeps the hook order fixed.
  const groupStems = useAppSelector((s) =>
    target.kind === 'group' ? s.rifffs[target.groupId].stems : null
  )
  const gain = preview ?? committed
```

Add a branch at the top of `handleChange` (before the `target.kind === 'stem'` branch):

```ts
    if (target.kind === 'riser') {
      // No scheduleLiveParamSync: the engine has no live-override path for a
      // generated riser (liveParamSync's params are all per-stem), so the
      // new level becomes audible on the commit's own project reload. The
      // knob and the block's drawn swell both track the drag from dragVol.
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value })
      return
    }
```

And the matching branch at the top of `handleCommit`:

```ts
    if (target.kind === 'riser') {
      dispatch({ type: 'SET_RISER_LEVEL', id: target.riserId, level: value })
      dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      return
    }
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck clean; lint 0 errors and the 4 known pre-existing prettier warnings.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RowGainDial.tsx
git commit -m "feat(riser): the row gain dial can drive a riser's level

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 8: The riser block gets a name bar, the row's dial, and a mute look

**No component test** (finding 12).

**Files:**
- Modify: `src/renderer/src/components/RiserBlock.tsx`

- [ ] **Step 1: Swap the imports and drop the corner-dial constants**

Replace the import block at the top of `RiserBlock.tsx` (lines 1-8):

```ts
import { useState } from 'react'
import { MIN_RISER_LENGTH_BARS, RISER_DEFAULTS, riserCutoffAt, riserEnvelopeAt } from '@shared/riser'
import { AutomationLane } from './AutomationLane'
import { EditableText } from './EditableText'
import { RowGainDial } from './RowGainDial'
import { startPointerDrag } from './dragUtils'
import { ROW_HEIGHT } from './StemWaveformRow'
import { NAME_BAR_HEIGHT } from './RifffBlockRow'
import { useAppSelector, useDispatch, useZoom } from '../state/StoreContext'
```

Delete the `LEVEL_DIAL_MIN_WIDTH_PX` and `DIAL_SIZE` constants (lines 20-26) entirely, and delete the `const showLevelDial = …` line (line 166).

Add one line to the component's own doc comment, after the "All of it in `--ra-text` at low opacity. No colour at all…" paragraph:

```
 * That no-colour rule now covers the row's LABEL too: a clip's name bar is
 * tinted with its first stem's type colour (stemDisplayColorVar), and
 * typeColorVar's only legitimate input is a SoundType -- which a riser does
 * not have, and must not be given one just to have a hue. The name sits in
 * --ra-text-2. The only colour a riser row ever shows is the m button going
 * --ra-mute-on, which tokens.css sanctions as a state colour.
```

- [ ] **Step 2: Rebuild the render tree**

Replace the whole `return ( … )` of `RiserBlock` with the following. Everything inside the block (`svg`, hatch, swell, sweep, edge handles, `AutomationLane`) is unchanged except that the hard-coded `riser` `<span>` label and the `showLevelDial` `<span>` are gone, and the `svg` now dims when muted.

```tsx
  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--ra-border-soft)' }}>
      {/* The same NAME_BAR_HEIGHT + ROW_HEIGHT stack a clip's row uses, so a
          riser sits on exactly the lane a clip would and rows stay aligned
          whether they hold clips, risers or both. Spacer first, name bar
          positioned absolutely over it -- exactly RifffBlockRow's own
          arrangement. */}
      <div style={{ height: NAME_BAR_HEIGHT }} />
      {/* The riser's name, which is also this ROW's name: one riser owns one
          row now, so there is no separate channel label to invent. Editable
          in place rather than in the Inspector (where a clip is renamed)
          because a riser is not selectable -- state.sel holds a groupId --
          so the Inspector has no riser view to put it in. Sized/weighted
          like a clip's own name, minus the type colour (see this file's
          doc comment). */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenContextMenu(e.clientX, e.clientY, riser.id)
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: leftPx,
          width: widthPx,
          height: NAME_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--ra-s-1)',
          overflow: 'hidden',
          background: 'var(--ra-bg-row)',
          zIndex: 2
        }}
      >
        <EditableText
          value={riser.name}
          onCommit={(name) => dispatch({ type: 'RENAME_RISER', id: riser.id, name })}
          title="click to rename"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--ra-text-2)',
            width: '100%'
          }}
        />
      </div>
      {/* Flex row, matching StemWaveformRow's own shape exactly: the lane
          takes the space, and RowGainDial's zero-height sticky anchor rides
          the right edge beside the channel's m/s letters. */}
      <div style={{ display: 'flex', height: ROW_HEIGHT }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div
            data-riser-id={riser.id}
            onMouseDown={beginMove}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onContextMenu={(e) => {
              // Stopped here so it never falls through to the Timeline's own
              // background menu, which would offer "add riser on a new row"
              // on top of the riser already under the cursor.
              e.preventDefault()
              e.stopPropagation()
              onOpenContextMenu(e.clientX, e.clientY, riser.id)
            }}
            title={`${riser.name} · ${lengthBars} bars · drag to move · drag an edge to resize · right-click to remove`}
            style={{
              position: 'absolute',
              top: 0,
              left: leftPx,
              width: widthPx,
              height: ROW_HEIGHT,
              background: 'var(--ra-bg-row)',
              border: `1px solid ${hovered ? 'var(--ra-border-strong)' : 'var(--ra-border)'}`,
              cursor: 'grab',
              overflow: 'hidden'
            }}
          >
            <svg
              width={widthPx}
              height={ROW_HEIGHT}
              viewBox={`0 0 ${widthPx} ${ROW_HEIGHT}`}
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                display: 'block',
                pointerEvents: 'none',
                // Muted reads as DIMMER, this app's established "grey means
                // quieter/off" language (StemWaveformRow drops its colour
                // layer for the same reason) -- the block keeps its outline
                // so a muted riser is still a thing you can grab, not a
                // hole in the row. The red lives on the row's m button.
                opacity: riser.muted ? 0.3 : 1
              }}
            >
              {/* unchanged: defs/pattern, hatch rect, swell polygon, sweep
                  polyline -- copy them across verbatim */}
            </svg>
            {/* unchanged: the two edge handles, and the automationMode
                AutomationLane -- copy them across verbatim */}
          </div>
        </div>
        {/* The riser's LEVEL, in the same place every other row keeps its
            gain (RowGainDial, pinned at the row's right edge beside the m/s
            letters) instead of a second knob in the block's corner. One row,
            one level control. */}
        <RowGainDial
          target={{ kind: 'riser', riserId: riser.id }}
          defaultGain={RISER_DEFAULTS.level}
          ariaLabel={`level for ${riser.name}`}
        />
      </div>
    </div>
  )
```

**Copy the `<defs>`/`<pattern>`/`<rect>`/`<polygon>`/`<polyline>` children and the two edge-handle/`AutomationLane` blocks across unchanged from the current file** — they are ~70 lines of correct drawing code with their own comments, and retyping them is how a detail gets lost. Only the three things named above (the label span, the level-dial span, the svg's new `opacity`) actually change inside the block.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck clean; lint 0 errors and the 4 known warnings.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RiserBlock.tsx
git commit -m "feat(riser): a riser row gets a name you can edit and one level dial

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 9: The channel row's m and s work on a riser-only row

**No component test** (finding 12) — the rules themselves are tested in Task 3.

**Files:**
- Modify: `src/renderer/src/components/ChannelRow.tsx:132-192`

- [ ] **Step 1: Use the tested rules**

Add to the imports at the top of `ChannelRow.tsx`:

```ts
import { channelAllMuted, channelIsSoloed } from '../state/selectors'
```

`stemKey` is no longer used in this file once the two `useMemo`s below are replaced — remove it from the `@shared/types` import if nothing else references it (grep first).

Replace the `riserIds` memo (lines 139-142) and both derivation memos (lines 169-192) with:

```ts
  const channelRisers = useMemo(
    () => risersOnChannel(allRisers, channelId),
    [allRisers, channelId]
  )
  const riserIds = useMemo(() => channelRisers.map((riser) => riser.id), [channelRisers])

  // Both rules live in selectors.ts, where they are unit-tested -- a riser
  // row's m/s are the one part of this that can be wrong quietly (a button
  // that lights up and changes nothing), and components are not tested here.
  const allMuted = useMemo(
    () => channelAllMuted({ rifffs, channelRisers, mute }),
    [rifffs, channelRisers, mute]
  )
  const soloed = useMemo(
    () =>
      channelIsSoloed({
        channelId,
        channelGroupIds: new Set(rifffs.map((r) => r.groupId)),
        rifffs: rifffsMap,
        risers: allRisers,
        mute
      }),
    [channelId, rifffs, rifffsMap, allRisers, mute]
  )
```

Nothing about the m/s buttons themselves changes: `SET_CHANNEL_MUTE` and `SOLO_CHANNEL` already carry the risers as of Task 2.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck clean; lint 0 errors and the 4 known warnings.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ChannelRow.tsx
git commit -m "feat(riser): m and s light up correctly on a riser-only row

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 10: Right-clicking below the rows adds a riser on a new row

**No component test** (finding 12).

**Files:**
- Modify: `src/renderer/src/App.tsx:168-171` (the prop's doc comment) and `:2046-2079` (`openPasteMenu`)

- [ ] **Step 1: Correct the prop's doc comment**

`handleContextMenu` (`App.tsx:366`) already resolves `channelId` by walking up to the nearest `[data-channel-id]`, and the ghost rows below the last channel (`App.tsx:468`) carry no such attribute — so a right-click down there already arrives with `channelId === null`. That is the natural home for the new gesture. Replace the `onOpenPasteMenu` doc comment (`App.tsx:168-170`):

```ts
  /** Opens the arranger's own background menu -- paste, and "add riser
   * here" when the right-click landed on a real channel row. `channelId` is
   * null for a right-click on the empty space below the rows, where the
   * menu instead offers a riser on a brand new row of its own. */
```

- [ ] **Step 2: Add the branch**

Replace the `if (channelId) { … }` block in `openPasteMenu` (`App.tsx:2052-2067`) with:

```ts
    if (channelId) {
      items.push({
        label: 'add riser here',
        onClick: () =>
          dispatch({
            type: 'ADD_RISER',
            // crypto.randomUUID, like every other freshly-minted id in this
            // file. It is also the riser's NOISE SEED (the engine hashes it
            // -- see riserSeedFor in NoiseRiser.h), so it has to be unique
            // and it has to be stable for the riser's whole life: two risers
            // sharing an id would sound like one doubled, and a riser whose
            // id changed would change texture under the user.
            riser: createRiser({ id: crypto.randomUUID(), channelId, startBar: bar })
          })
      })
    } else {
      // The empty space below the last row -- the one place a right-click
      // carries a bar but no row, which makes it exactly the right home for
      // "put a riser on a row of its own" (Elling, 2026-09-23: "give the
      // riser ... its own channel", one row per riser, because he wants
      // making them to be easy). ADD_RISER puts the new channel id into
      // channelOrder itself, so the row appears at the bottom, where the
      // click was.
      //
      // TWO ids, not one reused: the riser's id is a noise seed with its own
      // stability contract (above), and the channel id is a row identity
      // that the reducer matches against channelOf/channelOrder. Keeping
      // them separate means neither ever has to care what the other means.
      items.push({
        label: 'add riser on a new row',
        onClick: () =>
          dispatch({
            type: 'ADD_RISER',
            riser: createRiser({
              id: crypto.randomUUID(),
              channelId: crypto.randomUUID(),
              startBar: bar
            })
          })
      })
    }
```

Right-clicking **on** an existing row is unchanged, deliberately: a riser next to a clip on a shared row is still a thing somebody might want, and the brief asked for that gesture to keep working exactly as it does.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck clean; lint 0 errors and the 4 known warnings.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(riser): right-click below the rows to add a riser on its own row

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 11: The guided flow puts each riser on its own row too

Phase 3's `coachRiserChannelId` reuses the last flow-placed riser's row, on the reasoning that "a track with three drops would otherwise grow three riser rows". Elling has now chosen one row per riser, and guided and hand-placed risers must be indistinguishable — so the function goes.

**Files:**
- Modify: `src/renderer/src/state/coachTensionApply.ts:79-97` and `:99-107`
- Modify: `src/renderer/src/state/coachTensionApply.test.ts:9`, `:148-164`
- Modify: `src/renderer/src/components/SssketchyTensionPanel.tsx:7`, `:93-96`, `:113-140`

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/state/coachTensionApply.test.ts`, delete the whole `describe('coachRiserChannelId', …)` block (lines 148-164) and remove `coachRiserChannelId` from the import at line 9. Then add, inside the existing `describe('buildCoachTensionActions -- the riser', …)` block (line 118):

```ts
  it('lands unnamed, so the reducer numbers it like any hand-placed riser', () => {
    const { actions } = buildCoachTensionActions(placed(), section, 'riser', ids)
    const [action] = actions
    if (action.type !== 'ADD_RISER') throw new Error('expected ADD_RISER')
    expect(action.riser.name).toBe('')
    const after = actions.reduce(reducer, placed())
    expect(after.risers['riser-1'].name).toBe('riser 1')
  })
```

(`placed()`, the `section` const and the `ids` const are the file's own fixtures, at lines 44, 35 and 56; `reducer` is already imported there — the test at line 139 already uses `actions.reduce(reducer, state)`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachTensionApply.test.ts`
Expected: FAIL — the file no longer compiles, because `coachRiserChannelId` is still exported and still imported by `SssketchyTensionPanel.tsx`; and `action.riser.name` is `''` only once Task 1 landed (it has, so that half passes).

- [ ] **Step 3: Delete the shared-row rule**

In `src/renderer/src/state/coachTensionApply.ts`:

- Delete `coachRiserChannelId` entirely (lines 79-97).
- Remove `lastAppliedRiserId` from the `@shared/coachTension` import (line 32) — grep the file first to confirm nothing else uses it.
- Replace the `ids` paragraph of `buildCoachTensionActions`'s doc comment (lines 99-107) with:

```ts
/**
 * Switches one offer ON.
 *
 * `ids.riserId` and `ids.channelId` are minted by the caller (crypto.
 * randomUUID, like every other freshly-minted id in the renderer) and
 * injected rather than generated here, so this stays a pure function with
 * pinnable output. Both are ALWAYS fresh: one riser owns one arranger row
 * (Elling, 2026-09-23), and a flow-placed riser has to behave exactly like a
 * hand-placed one -- nothing here marks it as sssketchy's. This used to
 * reuse the previous flow riser's row (coachRiserChannelId, removed in the
 * same change) so three drops made one riser row rather than three; the
 * one-row-per-riser rule replaced that, and the two must not diverge again.
 */
```

- [ ] **Step 4: Update the panel**

In `src/renderer/src/components/SssketchyTensionPanel.tsx`:

- Remove `coachRiserChannelId` from the import at line 7.
- In the toggle callback, replace line 95 with:

```ts
        channelId: crypto.randomUUID()
```

- In `addAll`, replace its doc comment's last sentence and the row-reuse bookkeeping. Delete `let riserChannelId = coachRiserChannelId(state, coach.tension)`, delete `const channelId = riserChannelId ?? crypto.randomUUID()`, delete `if (built.riserId !== null) riserChannelId = channelId`, and pass `channelId: crypto.randomUUID()` directly:

```ts
  /** "add all of these" -- the step's primary move, and the one bulk
   * application in this phase. Built as ONE batch so the whole pass is a
   * single undo step. Every riser in it gets a row of its own, exactly like
   * one added by hand from the arranger's right-click menu. */
  const addAll = useCallback((): void => {
    if (coach === null) return
    const actions: Action[] = []
    for (const boundary of coachBoundaries(coach)) {
      const section = coach.sections[boundary.index]
      if (section === undefined) continue
      for (const kind of boundary.offers) {
        if (tensionIsApplied(coach.tension, boundary.index, kind)) continue
        const built = buildCoachTensionActions(state, section, kind, {
          riserId: crypto.randomUUID(),
          channelId: crypto.randomUUID()
        })
        if (built.actions.length === 0) continue
        actions.push(...built.actions, {
          type: 'COACH_APPLY_TENSION',
          sectionIndex: boundary.index,
          kind,
          riserId: built.riserId
        })
      }
```

(Leave the rest of `addAll` — the closing loop, the dispatch, the dependency array — exactly as it is.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/coachTensionApply.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/coachTensionApply.ts \
  src/renderer/src/state/coachTensionApply.test.ts \
  src/renderer/src/components/SssketchyTensionPanel.tsx
git commit -m "feat(riser): sssketchy gives each riser its own row too

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

### Task 12: Full verification, and the walkthrough only Elling can do

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npm test
npm run typecheck
npm run lint
```

Expected:
- `npm test` — every file passing, at **2341 plus roughly 40 new tests, minus the 3 that tested `coachRiserChannelId`**, across the same **157 files** (no test file is created or deleted by this plan). Do not treat the exact number as a target; do treat a total *below* 2341 as a signal that something was deleted that should not have been, and find it before moving on.
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 4 pre-existing prettier warnings in unrelated files.

- [ ] **Step 2: Confirm the engine really was not touched**

```bash
git diff --stat master...HEAD -- native-engine/
```

Expected: **no output.** If there is any, stop and report it — this plan asserts no engine change is needed, and a change there means the assertion was wrong and the whole build/relaunch story (CLAUDE.md) applies.

- [ ] **Step 3: Write the walkthrough note for Elling**

This environment has no GUI or audio tooling, so a coding agent cannot click through the app — **say that explicitly in your report rather than claiming any of the following was tested.** The list Elling needs to walk, in `npm run dev`:

1. Right-click in the empty space below the last row → **add riser on a new row** → a new row appears at the bottom with a riser on it, labelled `riser 1`.
2. Do it again → `riser 2`, on its own second row.
3. Right-click on an existing clip row → still says **add riser here**, still lands on that row.
4. Click the riser's name → type → Enter. Click away mid-edit → commits. Escape → reverts.
5. Drag the riser's body left/right, drag each edge — unchanged from before, and one undo step each.
6. Turn the row's gain dial (right edge, beside m/s) → the block's swell wedge tracks it live. One Cmd+Z takes the whole drag back, not one step per pixel.
7. Confirm there is **no second knob** in the block's corner any more.
8. Press **m** on the riser row → the block dims, the button goes red, and the riser goes silent on playback. Press again → back.
9. Press **s** on the riser row → only the riser sounds. Press again → everything back.
10. Press **s** on a *clip* row while a riser exists → the riser goes silent too.
11. Save, quit, reopen → names, mutes and rows all come back.
12. Open a project made **before** today → its risers are named `riser 1`, `riser 2`, …, all audible, on the rows they were already on.
13. Export a `.rpp` and a `.als` with one riser muted and one not → the risers track holds one item, and it is the audible one.
14. Run sssketchy's phase three on a track with two drops → two riser rows, each with its own name, each behaving exactly like a hand-placed one.

- [ ] **Step 4: Commit (only if anything was touched in this task)**

If steps 1-3 required no changes, there is nothing to commit and that is the expected outcome. Say so in the report.

---

## Self-review

**Spec coverage.** Every numbered item in the brief maps to a task: (1) the new-row gesture → Task 10; (2) the row furniture, enumerated honestly including the two items that genuinely do not apply → finding 4, built in Tasks 8 and 9; (3) mute as absence on the wire plus a solo scan that covers riser-only rows → Tasks 2, 3, 4; (4) one volume control, the corner dial removed → Tasks 7 and 8; (5) naming, with the default decided and where it is assigned → Tasks 1, 2, 8; (6) persistence with a pre-change project, and no wire change at all → Tasks 4, 6; (7) the guided flow following the same one-row-per-riser rule → Task 11.

**Placeholders.** None. The two places this plan says "copy it across verbatim" (the riser SVG's children in Task 8, and the existing test helpers in Tasks 5 and 11) point at named, existing code in named files rather than describing code that does not exist yet — the alternative was retyping 70 lines of correct drawing code, which is how a detail gets lost.

**Type consistency.** `RiserClip.name` / `.muted` (Task 1) are read by `nextRiserName`, `audibleRisers`, `normaliseLoadedRisers` (Task 1), `setRisersMutedOnChannel`, `RENAME_RISER`, `SET_RISER_MUTE` (Task 2), `channelAllMuted`, `channelIsSoloed` (Task 3), `buildEngineRisers` (Task 4), the four export call sites (Task 5), `deserializeProject` (Task 6) and `RiserBlock` (Task 8) under exactly those spellings throughout. `GainDialTarget`'s new member is `{ kind: 'riser'; riserId: string }` in both Task 7 (where it is defined) and Task 8 (where it is passed). `SET_RISER_LEVEL` is the pre-existing action and keeps its pre-existing `{ id, level }` shape.
