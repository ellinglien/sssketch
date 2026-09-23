# sssketchy Phase 2 — sections, one at a time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the guided flow's `sections` placeholder into the real phase two: sssketchy asks what comes first, then, one section at a time, takes a name and a bar length, shows the locked climax's stems **all switched on** with the drops that section type usually makes merely *flagged*, previews just that section, places it on the timeline as ordinary editable clips in one undo step, and then asks what comes next until you choose an outro.

**Architecture:** Every decision is a pure function or a plain table in `src/shared/` — the section types and their default lengths, the suggested-drop table (keyed off the Discover kind sets the locked climax carries), the transition table, and the phase-two state transitions. The renderer half is three thin pieces: a tested action builder that turns a finished section into the arranger's own `PLACE_LOOP_ON_TIMELINE` / `MOVE_TO_CHANNEL` / `SET_PLAYED_BARS` actions, an engine-preview hook modelled on the two that already exist, and one new panel component. **No native-engine changes at all.**

**Tech Stack:** TypeScript, React 19, Electron renderer, vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-sssketchy-guided-track-design.md` — build order step 3, the section headed "## Phase 2 — sections, one at a time" (**revised 2026-09-22; that revision is the whole point of this plan**).

**Previous plans:** `docs/superpowers/plans/2026-09-22-sssketchy-framework.md` (build order 1) and `docs/superpowers/plans/2026-09-22-sssketchy-phase1.md` (build order 2). Read phase 1's "Findings" section before starting; everything it established still holds.

---

## Findings that shaped this plan (read these first)

1. **THE RULE OF THIS PHASE — everything on, the user subtracts.** Every section starts as the **full** locked climax loop with every stem playing. The app never removes a stem by itself. The stems a section type usually loses are **flagged as a hint on the toggle**, plus **one button** that applies all of those flags at once — and nothing is applied until that button (or an individual toggle) is clicked.

   This is the **one place in the entire feature where the app asserts anything musical**, and the everything-on framing is exactly what keeps that legitimate (spec): *"a suggestion you can ignore costs nothing when it is wrong, whereas a pre-applied default is a decision made for you that you have to notice and undo."*

   **Do not "simplify" this into a default.** If you find yourself writing `droppedPaths: suggestedDropPaths(type, climax)` anywhere in a *constructor* — `newCoachSectionDraft`, a reducer case, a component's initial state — you have broken the feature. A fresh draft's `droppedPaths` is **always `[]`**. There is exactly one function in this plan that adds to it in bulk (`dropSuggestedCoachSectionStems`) and it is only ever reached from a user click. Task 5 has a test asserting precisely this; do not weaken it.

2. **The flags key off the roles Discover already tagged, never stem order or channel index.** The spec says this twice. `LockedClimaxStem.kinds` (a normalised `DiscoverSlotKind[]`, see `src/shared/coachClimax.ts`) is the only input to the suggested-drop table. There is no index arithmetic anywhere in Task 1.

3. **Everything sssketchy says states what a step is FOR.** Never a judgement about the music. Lowercase, no emoji, no exclamation marks, 3–4 rotated variants per line, chosen with `pickLineVariant(table, state.lineSeed)` — **never `Math.random`** (`src/shared/coachLines.ts` explains why: a random pick would rewrite the bubble under the reader on every re-render, and no test could pin a string). The existing copy avoids contractions ("there is a…", "that is the whole method") — match it.

4. **React components are not unit-tested in this codebase** (CLAUDE.md, "Testing conventions"). Tasks 10 and 11 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, and then by Elling's manual walkthrough at the end of this plan. This environment has no GUI or audio tooling — **do not claim any UI behaviour was tested.**

5. **Phase 1's Tasks 10–13 are being implemented by another agent while this plan is written.** `src/renderer/src/components/SssketchyCoach.tsx`, `SssketchyChecklist.tsx`, `src/renderer/src/App.tsx` and `DiscoverPanel.tsx` are all moving. Task 11 therefore describes its changes to `SssketchyCoach.tsx` and `App.tsx` as **behaviour plus exact integration points**, not as pasteable diffs. **Re-read both files before editing them.** Everything in Tasks 1–10 is either a new file or a file phase 1 has already finished with (`coach.ts`, `coachSteps.ts`, `coachLines.ts`, `coachClimax.ts`, `coachPhase1.ts`, `store.ts`, `history.ts`, `selectors.ts`).

6. **The arranger's write path, and what "one undo step per section" really requires.** `buildArrangeReplaceActions` (`src/renderer/src/state/selectors.ts:810`) is the function the spec names, and it is the right *model* — but it cannot be called literally here, and this is the one place the plan departs from the spec's letter. It exists to **replace clips that are already on the timeline**: it reads `state.rifffs[groupId]` for every moved stem, emits window copies, and finishes with one `DELETE_RIFFFS` of every source it touched. Phase 2 has no such source — the locked climax is a *value* on the coach state (file paths, roles and gains), not placed clips — and calling it once per section would delete the sections already placed.

   So Task 8 builds a section out of **the same three reducer actions `buildArrangeReplaceActions` itself emits**, in the same order, with the same channel-continuity trick:
   - `PLACE_LOOP_ON_TIMELINE` — whose own doc comment says it takes *"one groupId per Discover slot, each carrying exactly one Stem"*, which is exactly one clip per kept climax stem, and which is what `addToTimeline` in `DiscoverPanel.tsx` already dispatches for a Discover loop;
   - `MOVE_TO_CHANNEL` — for a stem that already has a lane from an earlier section, onto that lane's channel id. This is `buildArrangeReplaceActions`' own `firstCopyChannelId` trick (`selectors.ts:852-882`), and without it each section would spray its stems across a fresh set of channel rows;
   - `SET_PLAYED_BARS` — the right-edge resize, so a 4-bar loop tiles out to fill a 16-bar section.

   All of it goes out in **one `BATCH`**, which `history.ts:144` checkpoints exactly once. The result is ordinary clips: draggable, resizable, ungroupable, deletable, indistinguishable from hand-made work. One row per climax stem, sections laid out left to right, and **the gap where a stem was subtracted is visible in its own lane** — which is the subtraction story drawn on the timeline.

   `MOVE_TO_CHANNEL` resets `stretch` to `true` (see `placeOnTimeline`, `store.ts:149`); `PLACE_LOOP_ON_TIMELINE` also sets `stretch[groupId] = true`, so unlike `buildArrangeReplaceActions` there is no `TOGGLE_STRETCH` correction to make here. Do not add one.

7. **Section bar lengths and the arranger's own step grid agree for free.** `ARRANGE_STEP_BARS` is 4 (`src/shared/autoArrangeApply.ts`), and the spec's nudges are ±4/±8. Every default in Task 1 is a multiple of 4. Nothing here needs `ArrangeMoveRecord` or the step grid, but a section built by this flow lands on the same bar boundaries auto-arrange and draw-arrange use.

8. **Where the next section starts.** From the coach's own arithmetic — the previous section's `startBar + bars` — and, for the very first section, from `placedTimelineSpanBars(state)` (`selectors.ts:513`), which is "the furthest bar anything placed reaches, or 0 when the timeline is empty". That makes sections contiguous even when a section is entirely silent (every stem subtracted — allowed, and a real musical move), and keeps the first section from landing on top of a Discover loop the user already plunked down.

9. **The preview is a throwaway single-rifff engine project.** Exactly the shape `DiscoverPanel.tsx`'s `syncPreviewToEngine` builds: `{ ...initialState, bpm, masterChain, channelPlugins, rifffs: { [groupId]: { ...rifff, startBar: 0 } }, vol, stretch }`. Because `loopLengthBars(state)` is the furthest placed end (`selectors.ts:499`) and the only clip starts at bar 0, adding `playedBars: { [groupId]: draft.bars }` makes the engine's own loop exactly the section's length — which is "loops just that section". Engine ownership goes through `useEngineOwnership()` / `src/shared/engineOwnership.ts`, which gains a third owner id.

10. **Persistence is opt-out.** `serializeProject` rest-destructures the transient fields and stringifies the rest; `deserializeProject` builds `{ ...initialState, ...projectData }` and then runs `sanitiseLoadedCoach` (`src/renderer/src/state/serialize.ts:372`). Two new `CoachState` fields therefore persist for free, and a project saved **before phase 2 existed** — which has neither key — must load as `sections: []` / `draftSection: null`. That is Task 4 + Task 7, and it is the pattern phase 1's Task 8 established for `lockedClimax`.

11. **Phase 2 is a LOOP over a fixed step table.** The machine in `coach.ts` walks `coachStepOrder(flavour)` linearly. Three new rows replace the single `sections` placeholder — `p2-first`, `p2-section`, `p2-next` — and the loop back from `p2-next` to `p2-section` is a transition of its own (`startCoachSection`), not something `advanceCoach` does. `p2-section`'s entry in `outcomes` is simply rewritten each time round; that is correct, and the checklist showing one "carve a section" line for a repeating step is correct too.

12. **"do it for me" must never make a musical choice.** `p2-first` and `p2-next` therefore have **no moves at all** — which of intro/build/drop/breakdown/outro comes next is an answer only the user can give, exactly like the melodic-or-groove question (`coachSteps.ts:200`, "answering this for you would be the app making a decision about your track"). Only `p2-section` has moves, and they are the three visible buttons on the panel.

13. **Reaching the panel from the bubble needs the same bridge phase 1 built for Discover.** `src/renderer/src/state/coachDiscoverBridge.ts` is a 30-line module DiscoverPanel registers a handler with, so the bubble's "do it for me" can reach a function only that component can call. Task 9 mirrors it for the section panel. No queue this time: the panel is mounted exactly when those steps are current, so a request with no handler is dropped rather than stored.

14. **`type` is a reserved word in an action.** The new store actions carry `sectionType`, not `type` — `{ type: 'COACH_START_SECTION'; sectionType: CoachSectionType }`.

15. **Lint rules that will bite.** This repo errors on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect`) — see the `usePulse` comment in `SssketchyCoach.tsx` for the established workaround — and requires an **explicit return type on every function**, including inline ones. All code below already satisfies both. `npm run lint` has **4 known pre-existing prettier warnings in unrelated files**; that is the baseline, not something this plan fixes.

16. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, `docs/design.md`): near-black shell, Silkscreen, **no `border-radius` anywhere**, colour spent only on things carrying audio information. The one colour in the new panel is `typeColorVar(stem.type)` on a stem's own swatch — the single legitimate way to get a colour in this app. UI copy lowercase, no emoji, no exclamation marks.

## File map

| File | Change |
|---|---|
| `src/shared/coachClimax.ts` | `kindsCoverSet` — the one superset rule, extracted so phase 1 and phase 2 share it |
| `src/shared/coachClimax.test.ts` | tests for `kindsCoverSet` |
| `src/shared/coachPhase1.ts` | `slotCoversKindSet` delegates to `kindsCoverSet` (no behaviour change) |
| `src/shared/coachSections.ts` (new) | `CoachSectionType`, `CoachSection`, `CoachSectionDraft`, `CoachSectionOp`, the type/default-bars table, bar nudging, default names, **the suggested-drop table**, **the transition table**, lane ids, start bars, load repair |
| `src/shared/coachSections.test.ts` (new) | full TDD of the above, including the everything-on assertions |
| `src/shared/coachSteps.ts` | `CoachMoveAction` gains `section-op`; the three `p2-` rows replace the `sections` placeholder; `LATER_PHASE_ORDER` |
| `src/shared/coachSteps.test.ts` | updated for the three new ids |
| `src/shared/coachLines.ts` | `COACH_SECTION_LINE_TEMPLATES`, `COACH_NEXT_SECTION_LINE_TEMPLATES` |
| `src/shared/coachLines.test.ts` | the two new tables join the copy-rule sweep |
| `src/shared/coach.ts` | `CoachState.sections`, `CoachState.draftSection`, `startCoach`, `sanitiseLoadedCoach` |
| `src/shared/coach.test.ts` | updated for the new step ids and the two new fields |
| `src/shared/coachPhase2.ts` (new) | `startCoachSection`, `setCoachSectionName`, `nudgeCoachSectionBars`, `toggleCoachSectionStem`, `dropSuggestedCoachSectionStems`, `placeCoachSection`, `coachSectionLine` |
| `src/shared/coachPhase2.test.ts` (new) | full TDD of the above |
| `src/shared/engineOwnership.ts` | `'coach-section-preview'` joins the `EngineOwner` union |
| `src/renderer/src/state/store.ts` | six `COACH_*` section action types and reducer cases |
| `src/renderer/src/state/store.test.ts` | reducer tests for the six |
| `src/renderer/src/state/history.ts` | six entries in `TRANSIENT_ACTION_TYPES` |
| `src/renderer/src/state/serialize.test.ts` | round-trip of the two new fields + a pre-phase-2 project |
| `src/renderer/src/state/coachSectionPlacement.ts` (new) | `buildCoachSectionActions` — the arranger write path |
| `src/renderer/src/state/coachSectionPlacement.test.ts` (new) | placement tests against the real reducer |
| `src/renderer/src/state/coachSectionBridge.ts` (new) | `registerCoachSectionOp`, `requestCoachSectionOp`, `resetCoachSectionBridge` |
| `src/renderer/src/state/coachSectionBridge.test.ts` (new) | register/route/teardown tests |
| `src/renderer/src/state/useCoachSectionPreview.ts` (new) | the section preview hook |
| `src/renderer/src/components/SssketchySectionPanel.tsx` (new) | the phase-two panel |
| `src/renderer/src/components/SssketchyCoach.tsx` | renders the panel; phase-two line; routes `section-op` moves |
| `src/renderer/src/App.tsx` | one `data-coach-anchor="timeline"` attribute; one `section-op` case in the move handler |

## Commands used throughout (run from the repo root, `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/coachSections.test.ts   # one file
npx vitest run                                    # the whole suite
npm run typecheck                                 # tsc, node + web configs
npm run lint                                      # eslint --cache . (4 known prettier warnings)
```

Prettier settings the code below already follows: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

---

### Task 1: The section tables

The whole musical content of phase two, as data: what a section type is, how long it is by default, **which stems it usually loses**, and what usually follows it. Pure, no state, no React.

**Files:**
- Modify: `src/shared/coachClimax.ts`
- Modify: `src/shared/coachClimax.test.ts`
- Modify: `src/shared/coachPhase1.ts`
- Create: `src/shared/coachSections.ts`
- Create: `src/shared/coachSections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachSections.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import {
  COACH_FIRST_SECTION_TYPES,
  COACH_SECTION_DROP_SETS,
  COACH_SECTION_MAX_BARS,
  COACH_SECTION_MIN_BARS,
  COACH_SECTION_TRANSITIONS,
  COACH_SECTION_TYPES,
  coachSectionTypeDef,
  defaultSectionName,
  isCoachSectionType,
  newCoachSectionDraft,
  nextCoachSectionStartBar,
  nextSectionTypeSuggestions,
  nudgeSectionBars,
  sanitiseCoachSectionDraft,
  sanitiseCoachSections,
  sectionKeptStems,
  sectionLaneChannelIds,
  suggestedDropPaths,
  type CoachSection
} from './coachSections'

function stem(path: string, kinds: LockedClimaxStem['kinds']): LockedClimaxStem {
  return {
    path,
    name: path,
    author: 'e',
    type: 'fx',
    durationSec: 4,
    barLength: 4,
    kinds,
    role: 'aux',
    gain: 1
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: 0,
  stems: [
    stem('/kick.wav', ['drums']),
    stem('/bass.wav', ['bass']),
    stem('/harmony.wav', ['lead', 'warm']),
    stem('/hook.wav', ['lead', 'bright']),
    stem('/perc.wav', ['bassHeavy'])
  ]
}

describe('the section types', () => {
  it('are the five the spec names, in flow order', () => {
    expect(COACH_SECTION_TYPES.map((t) => t.id)).toEqual([
      'intro',
      'build',
      'drop',
      'breakdown',
      'outro'
    ])
  })

  it('carry a default length that is a whole number of four-bar steps', () => {
    for (const type of COACH_SECTION_TYPES) {
      expect(type.defaultBars % 4).toBe(0)
      expect(type.defaultBars).toBeGreaterThanOrEqual(COACH_SECTION_MIN_BARS)
      expect(type.defaultBars).toBeLessThanOrEqual(COACH_SECTION_MAX_BARS)
    }
    expect(coachSectionTypeDef('drop').defaultBars).toBe(16)
  })

  it('narrow a persisted string', () => {
    expect(isCoachSectionType('breakdown')).toBe(true)
    expect(isCoachSectionType('chorus')).toBe(false)
    expect(isCoachSectionType(7)).toBe(false)
  })
})

describe('nudgeSectionBars', () => {
  it('moves by the given step and clamps at both ends', () => {
    expect(nudgeSectionBars(8, 4)).toBe(12)
    expect(nudgeSectionBars(8, -4)).toBe(4)
    expect(nudgeSectionBars(8, 8)).toBe(16)
    expect(nudgeSectionBars(COACH_SECTION_MIN_BARS, -8)).toBe(COACH_SECTION_MIN_BARS)
    expect(nudgeSectionBars(COACH_SECTION_MAX_BARS, 8)).toBe(COACH_SECTION_MAX_BARS)
  })
})

describe('defaultSectionName', () => {
  it('is the type, and numbers repeats from the second one on', () => {
    expect(defaultSectionName('drop', [])).toBe('drop')
    const placed = [
      { type: 'drop' as const, name: 'drop' },
      { type: 'breakdown' as const, name: 'breakdown' }
    ]
    expect(defaultSectionName('drop', placed)).toBe('drop 2')
    expect(defaultSectionName('outro', placed)).toBe('outro')
  })
})

describe('a fresh section draft', () => {
  it('HAS EVERY STEM ON -- nothing is dropped until the user says so', () => {
    // The rule of this whole phase. If this test ever fails because a
    // constructor started pre-applying the suggestion table, the fix is in
    // the constructor, never here.
    const draft = newCoachSectionDraft('intro', [])
    expect(draft.droppedPaths).toEqual([])
    expect(sectionKeptStems(climax, draft.droppedPaths)).toHaveLength(climax.stems.length)
  })

  it('takes its name and length from the type', () => {
    const draft = newCoachSectionDraft('build', [])
    expect(draft.type).toBe('build')
    expect(draft.name).toBe('build')
    expect(draft.bars).toBe(coachSectionTypeDef('build').defaultBars)
  })
})

describe('the suggested-drop table', () => {
  it('flags harmony and the hook in an intro and an outro', () => {
    expect(suggestedDropPaths('intro', climax)).toEqual(['/harmony.wav', '/hook.wav'])
    expect(suggestedDropPaths('outro', climax)).toEqual(['/harmony.wav', '/hook.wav'])
  })

  it('flags only the hook in a build', () => {
    expect(suggestedDropPaths('build', climax)).toEqual(['/hook.wav'])
  })

  it('flags the kick and the bass in a breakdown', () => {
    expect(suggestedDropPaths('breakdown', climax)).toEqual(['/kick.wav', '/bass.wav'])
  })

  it('flags NOTHING in a drop -- that section is the whole loop', () => {
    expect(COACH_SECTION_DROP_SETS.drop).toEqual([])
    expect(suggestedDropPaths('drop', climax)).toEqual([])
  })

  it('reads the kinds Discover tagged, never the stem order', () => {
    const reversed: LockedClimax = { ...climax, stems: [...climax.stems].reverse() }
    expect(suggestedDropPaths('build', reversed)).toEqual(['/hook.wav'])
    // A stem with no kinds at all is never flagged -- there is nothing to
    // key off, so the app says nothing about it.
    const untagged: LockedClimax = { ...climax, stems: [stem('/mystery.wav', [])] }
    expect(suggestedDropPaths('intro', untagged)).toEqual([])
  })
})

describe('the transition table', () => {
  it('follows the spec: after build a drop, after a drop a breakdown or an outro', () => {
    expect(COACH_SECTION_TRANSITIONS.build).toEqual(['drop'])
    expect(COACH_SECTION_TRANSITIONS.drop).toEqual(['breakdown', 'outro'])
    expect(COACH_SECTION_TRANSITIONS.intro).toEqual(['build', 'drop'])
    expect(COACH_SECTION_TRANSITIONS.breakdown).toEqual(['build', 'drop'])
    // An outro ends phase two, so nothing follows it.
    expect(COACH_SECTION_TRANSITIONS.outro).toEqual([])
  })

  it('suggests the first section when nothing is placed yet', () => {
    expect(COACH_FIRST_SECTION_TYPES).toEqual(['intro', 'build'])
    expect(nextSectionTypeSuggestions([])).toEqual(['intro', 'build'])
  })

  it('suggests from the last placed section otherwise', () => {
    const sections: CoachSection[] = [
      { type: 'intro', name: 'intro', bars: 8, droppedPaths: [], startBar: 0, placedGroupIds: {} },
      { type: 'build', name: 'build', bars: 16, droppedPaths: [], startBar: 8, placedGroupIds: {} }
    ]
    expect(nextSectionTypeSuggestions(sections)).toEqual(['drop'])
  })
})

describe('placement arithmetic', () => {
  const sections: CoachSection[] = [
    {
      type: 'intro',
      name: 'intro',
      bars: 8,
      droppedPaths: ['/hook.wav'],
      startBar: 12,
      placedGroupIds: { '/kick.wav': 'g1', '/bass.wav': 'g2' }
    }
  ]

  it('starts the first section after everything already placed', () => {
    expect(nextCoachSectionStartBar([], 0)).toBe(0)
    expect(nextCoachSectionStartBar([], 12)).toBe(12)
  })

  it('starts every later section right after the previous one', () => {
    expect(nextCoachSectionStartBar(sections, 999)).toBe(20)
  })

  it('remembers which channel each stem already owns', () => {
    expect(sectionLaneChannelIds(sections)).toEqual({ '/kick.wav': 'g1', '/bass.wav': 'g2' })
  })

  it('keeps the FIRST lane a stem was given, not the newest one', () => {
    const twice: CoachSection[] = [
      ...sections,
      {
        type: 'drop',
        name: 'drop',
        bars: 16,
        droppedPaths: [],
        startBar: 20,
        placedGroupIds: { '/kick.wav': 'g9' }
      }
    ]
    expect(sectionLaneChannelIds(twice)['/kick.wav']).toBe('g1')
  })

  it('keeps the stems the user did not switch off, in climax order', () => {
    expect(sectionKeptStems(climax, ['/hook.wav', '/perc.wav']).map((s) => s.path)).toEqual([
      '/kick.wav',
      '/bass.wav',
      '/harmony.wav'
    ])
  })
})

describe('load repair', () => {
  it('turns nonsense into an empty list rather than throwing', () => {
    expect(sanitiseCoachSections(undefined)).toEqual([])
    expect(sanitiseCoachSections('nope')).toEqual([])
    expect(sanitiseCoachSections([{ type: 'chorus' }])).toEqual([])
  })

  it('repairs a hand-edited section', () => {
    expect(
      sanitiseCoachSections([
        { type: 'drop', name: 42, bars: -3, droppedPaths: ['/a', 7], startBar: -9 }
      ])
    ).toEqual([
      {
        type: 'drop',
        name: 'drop',
        bars: COACH_SECTION_MIN_BARS,
        droppedPaths: ['/a'],
        startBar: 0,
        placedGroupIds: {}
      }
    ])
  })

  it('repairs or discards a draft', () => {
    expect(sanitiseCoachSectionDraft(null)).toBeNull()
    expect(sanitiseCoachSectionDraft({ type: 'nope' })).toBeNull()
    expect(sanitiseCoachSectionDraft({ type: 'build' })).toEqual({
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: []
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachSections.test.ts`
Expected: FAIL — `Failed to resolve import "./coachSections"`.

- [ ] **Step 3: Extract the shared superset rule**

Add to `src/shared/coachClimax.ts`, right after `coachSlotRole`:

```ts
/**
 * The one superset rule every kind-set check in this feature shares: a set
 * of kinds COVERS a wanted set when it contains all of them.
 *
 * Superset, not overlap, is what keeps a {leadesque, buttery} harmony stem
 * from answering for a {leadesque, sparkly} hook -- and normalizeSlotKinds
 * allows at most one of sparkly/buttery in a set, so those two can never
 * collide. Phase one uses it to decide whether a step is satisfied
 * (slotCoversKindSet, ./coachPhase1.ts); phase two uses it to decide
 * whether a section type's suggested drop applies to a stem
 * (./coachSections.ts). One rule, one implementation.
 */
export function kindsCoverSet(
  kinds: readonly DiscoverSlotKind[],
  want: readonly DiscoverSlotKind[]
): boolean {
  if (want.length === 0) return false
  const owned = new Set(normalizeSlotKinds(kinds))
  return want.every((kind) => owned.has(kind))
}
```

Note the `want.length === 0` guard: an empty wanted set would otherwise be vacuously true for every stem, which for phase 2 would mean a drop section silently flagging everything.

Then in `src/shared/coachPhase1.ts`, change the import and the body of `slotCoversKindSet` (its doc comment already describes this rule — leave the comment, it now documents the caller's own null check):

```ts
import { kindsCoverSet, lockClimaxFromSlots, type CoachSlotSnapshot } from './coachClimax'
```

```ts
export function slotCoversKindSet(
  slot: CoachSlotSnapshot,
  want: readonly DiscoverSlotKind[]
): boolean {
  if (slot.stem === null) return false
  return kindsCoverSet(slot.kinds, want)
}
```

`normalizeSlotKinds` is already imported by `coachPhase1.ts` for `coveredKinds`; leave that import alone.

Add to `src/shared/coachClimax.test.ts`:

```ts
describe('kindsCoverSet', () => {
  it('is a superset test, not an overlap test', () => {
    expect(kindsCoverSet(['lead', 'bright'], ['lead'])).toBe(true)
    expect(kindsCoverSet(['lead'], ['lead', 'bright'])).toBe(false)
    expect(kindsCoverSet(['lead', 'warm'], ['lead', 'bright'])).toBe(false)
  })

  it('is false for an empty wanted set, never vacuously true', () => {
    expect(kindsCoverSet(['drums'], [])).toBe(false)
  })
})
```

(add `kindsCoverSet` to that file's existing import from `./coachClimax`).

- [ ] **Step 4: Write `coachSections.ts`**

Create `src/shared/coachSections.ts`:

```ts
/**
 * Phase two, as plain data: what a section IS, how long it is by default,
 * which stems that kind of section usually loses, and what usually follows
 * it.
 *
 * THE RULE THIS FILE EXISTS TO ENCODE (spec, "Phase 2 -- sections, one at a
 * time"): **everything is on, and the user subtracts.** A section is the
 * full climax loop until the person building it says otherwise. The table
 * below is the ONE place in this whole feature where the app asserts
 * anything musical, and it is kept legitimate by being a MARK rather than a
 * change: suggestedDropPaths only ever answers "which stems would this
 * section type usually lose", and nothing here ever puts one of those paths
 * into a draft. Applying them is a click (dropSuggestedCoachSectionStems,
 * ./coachPhase2.ts). A suggestion you can ignore costs nothing when it is
 * wrong; a pre-applied default is a decision you have to notice and undo.
 *
 * So: a fresh draft's droppedPaths is ALWAYS empty. If you are reading this
 * because you are about to seed it from the table, don't.
 *
 * The flags key off the kinds DISCOVER tagged each stem with, carried on the
 * locked climax (LockedClimaxStem.kinds) -- never stem order, never channel
 * index, which the spec rules out twice.
 */

import { kindsCoverSet, type LockedClimax, type LockedClimaxStem } from './coachClimax'
import type { DiscoverSlotKind } from './discoverSlotKind'

export type CoachSectionType = 'intro' | 'build' | 'drop' | 'breakdown' | 'outro'

/** What the section panel's own buttons do, as data rather than as
 * callbacks -- so a step row can list them under "stuck?" and the bubble's
 * "do it for me" can run one without src/shared/ knowing React exists. */
export type CoachSectionOp = 'drop-suggested' | 'preview' | 'place'

export interface CoachSectionTypeDef {
  id: CoachSectionType
  /** Shown on the panel's buttons and used as a section's default name.
   * Lowercase, like all UI copy in this app. */
  label: string
  /** A starting length, in bars, nudgeable by +/-4 and +/-8. Always a whole
   * number of ARRANGE_STEP_BARS (4), so a guided section lands on the same
   * boundaries auto-arrange and draw-arrange use. */
  defaultBars: number
}

const COACH_SECTION_TYPE_BY_ID: Record<CoachSectionType, CoachSectionTypeDef> = {
  intro: { id: 'intro', label: 'intro', defaultBars: 8 },
  build: { id: 'build', label: 'build', defaultBars: 16 },
  drop: { id: 'drop', label: 'drop', defaultBars: 16 },
  breakdown: { id: 'breakdown', label: 'breakdown', defaultBars: 8 },
  outro: { id: 'outro', label: 'outro', defaultBars: 8 }
}

export const COACH_SECTION_TYPES: readonly CoachSectionTypeDef[] = [
  COACH_SECTION_TYPE_BY_ID.intro,
  COACH_SECTION_TYPE_BY_ID.build,
  COACH_SECTION_TYPE_BY_ID.drop,
  COACH_SECTION_TYPE_BY_ID.breakdown,
  COACH_SECTION_TYPE_BY_ID.outro
]

/** Total by construction -- CoachSectionType is a closed union over this
 * record's own keys, so there is no "unknown type" branch to get wrong. */
export function coachSectionTypeDef(type: CoachSectionType): CoachSectionTypeDef {
  return COACH_SECTION_TYPE_BY_ID[type]
}

export function isCoachSectionType(value: unknown): value is CoachSectionType {
  return typeof value === 'string' && value in COACH_SECTION_TYPE_BY_ID
}

/** Four bars is the smallest section this flow will build (one
 * ARRANGE_STEP_BARS step); 64 is a deliberately generous ceiling so the
 * nudge buttons cannot run away. Its own number, not imported from
 * auto-arrange's own cap -- the two limits happen to match today and there
 * is no reason they must stay tied. */
export const COACH_SECTION_MIN_BARS = 4
export const COACH_SECTION_MAX_BARS = 64

/** The spec's "nudgeable +/-4/+/-8", in the order the panel renders them. */
export const COACH_SECTION_BAR_NUDGES: readonly number[] = [-8, -4, 4, 8]

export function nudgeSectionBars(bars: number, delta: number): number {
  const next = Math.round(bars + delta)
  return Math.max(COACH_SECTION_MIN_BARS, Math.min(COACH_SECTION_MAX_BARS, next))
}

/**
 * WHICH STEMS A SECTION TYPE USUALLY LOSES -- as kind SETS, matched by the
 * same superset rule phase one's step completion uses (kindsCoverSet). A
 * stem is flagged when its own kinds cover ANY one of the sets.
 *
 * Read straight off the spec: "intro and outro: harmony and hook; build: the
 * hook; breakdown: kick and bass; drop: nothing".
 *
 * Two deliberate choices in how that is expressed:
 *
 * - intro/outro drop BOTH harmony and hook, and both of those are leadesque
 *   slots (phase one arms {leadesque, buttery} for harmony and {leadesque,
 *   sparkly} for the hook), so ONE set -- ['lead'] -- says it exactly, and
 *   also catches a plain leadesque stem that is one or the other.
 * - build drops the hook ONLY, so it names the hook's full set, ['lead',
 *   'bright']. A plain leadesque stem is NOT flagged there: the app cannot
 *   tell a bare lead apart from the hook, and the honest thing to do with
 *   something it cannot tell is to say nothing. Under-flagging costs the
 *   user one click; over-flagging is the app asserting something it does
 *   not know.
 *
 * Nothing outside the kinds Discover really tagged is ever inferred: a
 * chonky (bassHeavy) supporting stem is not flagged in a breakdown, because
 * Discover tagged it as a trait, not as the bass.
 */
export const COACH_SECTION_DROP_SETS: Record<
  CoachSectionType,
  readonly (readonly DiscoverSlotKind[])[]
> = {
  intro: [['lead']],
  build: [['lead', 'bright']],
  drop: [],
  breakdown: [['drums'], ['bass']],
  outro: [['lead']]
}

/** What the panel writes next to a flagged toggle. Deliberately flat and
 * unrotated: it is a label on a control, not something sssketchy says. */
export const COACH_SUGGESTED_DROP_HINT = 'usually out here'

/** The one button that applies every flag at once. */
export const COACH_DROP_SUGGESTED_LABEL = 'drop the suggested ones'

/** True when this section type usually loses this stem. A MARK -- nothing
 * in this module ever acts on it. */
export function isSuggestedDrop(type: CoachSectionType, stem: LockedClimaxStem): boolean {
  return COACH_SECTION_DROP_SETS[type].some((want) => kindsCoverSet(stem.kinds, want))
}

/** Every flagged stem's path, in the locked climax's own order. */
export function suggestedDropPaths(type: CoachSectionType, climax: LockedClimax): string[] {
  return climax.stems.filter((stem) => isSuggestedDrop(type, stem)).map((stem) => stem.path)
}

/**
 * What usually comes after each section type (spec: "after build -> drop;
 * after drop -> breakdown or outro"). Offers, not a route: the panel also
 * always offers ending phase two, and nothing here auto-advances.
 *
 * outro's list is empty because choosing an outro is how phase two ends --
 * see placeCoachSection in ./coachPhase2.ts.
 */
export const COACH_SECTION_TRANSITIONS: Record<CoachSectionType, readonly CoachSectionType[]> = {
  intro: ['build', 'drop'],
  build: ['drop'],
  drop: ['breakdown', 'outro'],
  breakdown: ['build', 'drop'],
  outro: []
}

/** "sssketchy asks what comes first (suggests intro, or build for a short
 * sketch)" (spec). */
export const COACH_FIRST_SECTION_TYPES: readonly CoachSectionType[] = ['intro', 'build']

export function nextSectionTypeSuggestions(
  sections: readonly CoachSection[]
): readonly CoachSectionType[] {
  if (sections.length === 0) return COACH_FIRST_SECTION_TYPES
  return COACH_SECTION_TRANSITIONS[sections[sections.length - 1].type]
}

/** One section the user has finished and placed. Plain, persisted data. */
export interface CoachSection {
  type: CoachSectionType
  /** The user's own name for it; defaults to the type's label. */
  name: string
  bars: number
  /** The paths of the climax stems the user switched OFF. Everything not
   * listed here PLAYS. Storing the subtraction rather than the selection is
   * the everything-on rule written into the data itself: an empty list is
   * the full loop, and no stem can ever go missing by omission. */
  droppedPaths: string[]
  /** Where it really went on the timeline. */
  startBar: number
  /** climax stem path -> the groupId that stem was placed as, which is also
   * the channel row it created (PLACE_LOOP_ON_TIMELINE sets
   * channelOf[groupId] = groupId). Later sections reuse these so one stem
   * keeps one lane -- see sectionLaneChannelIds. */
  placedGroupIds: Record<string, string>
}

/** The section currently being carved. Same shape minus everything that
 * only exists once it has really been placed. */
export interface CoachSectionDraft {
  type: CoachSectionType
  name: string
  bars: number
  droppedPaths: string[]
}

/** "drop", then "drop 2" the second time. Counts by TYPE, not by name, so
 * renaming a section never renumbers a later one. */
export function defaultSectionName(
  type: CoachSectionType,
  sections: readonly { type: CoachSectionType }[]
): string {
  const label = coachSectionTypeDef(type).label
  const already = sections.filter((section) => section.type === type).length
  return already === 0 ? label : `${label} ${already + 1}`
}

/**
 * A new section, EVERYTHING ON.
 *
 * `droppedPaths: []` is not a default that happens to be empty -- it is the
 * feature. Do not seed it from COACH_SECTION_DROP_SETS here or anywhere
 * else; that table is a mark, and applying it is a click the user makes.
 */
export function newCoachSectionDraft(
  type: CoachSectionType,
  sections: readonly CoachSection[]
): CoachSectionDraft {
  return {
    type,
    name: defaultSectionName(type, sections),
    bars: coachSectionTypeDef(type).defaultBars,
    droppedPaths: []
  }
}

/** The stems that actually play in this section, in the locked climax's own
 * order. A path in droppedPaths that no longer matches any stem is simply
 * ignored. */
export function sectionKeptStems(
  climax: LockedClimax,
  droppedPaths: readonly string[]
): LockedClimaxStem[] {
  const dropped = new Set(droppedPaths)
  return climax.stems.filter((stem) => !dropped.has(stem.path))
}

/** climax stem path -> the channel row that stem already owns, taken from
 * the FIRST section that placed it. Keeping the first (not the newest) is
 * what makes one stem one lane for the whole song. */
export function sectionLaneChannelIds(sections: readonly CoachSection[]): Record<string, string> {
  const lanes: Record<string, string> = {}
  for (const section of sections) {
    for (const [path, groupId] of Object.entries(section.placedGroupIds)) {
      if (lanes[path] === undefined) lanes[path] = groupId
    }
  }
  return lanes
}

/** Where the next section goes: straight after the previous one, or --
 * for the very first -- after everything already on the timeline
 * (placedTimelineSpanBars, the caller's job to measure). Deriving later
 * sections from the coach's own numbers rather than from the timeline keeps
 * them contiguous even when a section is entirely silent, which is allowed:
 * subtracting every stem is a real musical move, not an error. */
export function nextCoachSectionStartBar(
  sections: readonly CoachSection[],
  fallbackBar: number
): number {
  if (sections.length === 0) return Math.max(0, Math.round(fallbackBar))
  const last = sections[sections.length - 1]
  return last.startBar + last.bars
}

function finiteBars(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(COACH_SECTION_MIN_BARS, Math.min(COACH_SECTION_MAX_BARS, Math.round(value)))
}

function loadedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((path): path is string => typeof path === 'string')
}

function loadedGroupIds(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [path, groupId] of Object.entries(value as Record<string, unknown>)) {
    if (typeof groupId === 'string' && groupId !== '') out[path] = groupId
  }
  return out
}

/**
 * Turns whatever a `.sssketchproj` actually contains into a section list --
 * the same repair-rather-than-trust rule the rest of the load path follows,
 * for the same reason: a project file is plain JSON people can and do
 * hand-edit, and a load must never throw. A section whose type is not one of
 * the five is dropped entirely rather than guessed at.
 */
export function sanitiseCoachSections(value: unknown): CoachSection[] {
  if (!Array.isArray(value)) return []
  const sections: CoachSection[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const loose = entry as Record<string, unknown>
    if (!isCoachSectionType(loose.type)) continue
    const startBar = typeof loose.startBar === 'number' && Number.isFinite(loose.startBar)
      ? Math.max(0, Math.round(loose.startBar))
      : 0
    sections.push({
      type: loose.type,
      name: typeof loose.name === 'string' && loose.name !== ''
        ? loose.name
        : coachSectionTypeDef(loose.type).label,
      bars: finiteBars(loose.bars, coachSectionTypeDef(loose.type).defaultBars),
      droppedPaths: loadedPaths(loose.droppedPaths),
      startBar,
      placedGroupIds: loadedGroupIds(loose.placedGroupIds)
    })
  }
  return sections
}

/** The in-progress section, or null. Same rules; an unusable draft is
 * discarded rather than repaired into a section the user never started. */
export function sanitiseCoachSectionDraft(value: unknown): CoachSectionDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (!isCoachSectionType(loose.type)) return null
  return {
    type: loose.type,
    name: typeof loose.name === 'string' && loose.name !== ''
      ? loose.name
      : coachSectionTypeDef(loose.type).label,
    bars: finiteBars(loose.bars, coachSectionTypeDef(loose.type).defaultBars),
    droppedPaths: loadedPaths(loose.droppedPaths)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/shared/coachSections.test.ts src/shared/coachClimax.test.ts src/shared/coachPhase1.test.ts`
Expected: PASS, all three files.

- [ ] **Step 6: Typecheck, lint and run the whole suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: typecheck clean, lint at its 4 known warnings, suite green.

- [ ] **Step 7: Commit**

```bash
git add src/shared/coachSections.ts src/shared/coachSections.test.ts \
  src/shared/coachClimax.ts src/shared/coachClimax.test.ts src/shared/coachPhase1.ts
git commit -m "$(cat <<'EOF'
The tables that say what a section usually loses

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 2: The three phase-two steps

Replaces the single `sections` placeholder row with the real loop: pick the first section, carve a section, choose what comes next.

**Files:**
- Modify: `src/shared/coachSteps.ts`
- Modify: `src/shared/coachSteps.test.ts`
- Modify: `src/shared/coach.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/shared/coachSteps.test.ts`, replace the three `'sections'` occurrences in the two `coachStepOrder` expectations (lines ~53 and ~65) with the three new ids, and update the two small tests that name the placeholder. The exact edits:

```ts
    expect(coachStepOrder('groove')).toEqual([
      'p1-flavour',
      'p1-low-end',
      'p1-harmony',
      'p1-drums',
      'p1-supporting',
      'p1-hook',
      'p1-balance',
      'p1-lock',
      'p2-first',
      'p2-section',
      'p2-next',
      'finish'
    ])
    expect(coachStepOrder('melodic')).toEqual([
      'p1-flavour',
      'p1-harmony',
      'p1-low-end',
      'p1-drums',
      'p1-supporting',
      'p1-hook',
      'p1-balance',
      'p1-lock',
      'p2-first',
      'p2-section',
      'p2-next',
      'finish'
    ])
```

```ts
  it('narrows a persisted string to a known step id', () => {
    expect(isCoachStepId('p2-section')).toBe(true)
    expect(isCoachStepId('sections')).toBe(false)
    expect(isCoachStepId('climax-loop')).toBe(false)
    expect(isCoachStepId(42)).toBe(false)
  })
```

Replace the `'leaves the two later-phase placeholders alone for their own plans'` test with:

```ts
  it('puts all three section steps in the arrangement phase', () => {
    expect(coachStepById('p2-first')?.phase).toBe('arrangement')
    expect(coachStepById('p2-section')?.phase).toBe('arrangement')
    expect(coachStepById('p2-next')?.phase).toBe('arrangement')
    expect(coachStepById('finish')?.phase).toBe('polish')
  })

  it('offers no moves on either question step -- those are the user’s call', () => {
    // Same reasoning as the melodic-or-groove question: picking which
    // section comes next would be the app deciding something about the
    // track, which is the one thing this feature does not do.
    expect(coachStepById('p2-first')?.moves).toEqual([])
    expect(coachStepById('p2-next')?.moves).toEqual([])
    expect(coachStepById('p2-first')?.primaryMoveId).toBeUndefined()
    expect(coachStepById('p2-next')?.primaryMoveId).toBeUndefined()
  })

  it('gives the section step its three panel moves', () => {
    const step = coachStepById('p2-section')
    expect(step?.moves.map((move) => move.action)).toEqual([
      { kind: 'section-op', op: 'drop-suggested' },
      { kind: 'section-op', op: 'preview' },
      { kind: 'section-op', op: 'place' }
    ])
    expect(step?.primaryMoveId).toBe('section-drop-suggested')
    // Nothing in phase two arms a Discover slot.
    expect(coachStepArmKinds(step!, null)).toBeNull()
  })
```

In the `resolveCoachStep` describe block near line 197, change the fixture's `id: 'sections'` to `id: 'p2-section'`.

In `src/shared/coach.test.ts` (~line 188), change `expect(crossed.stepId).toBe('sections')` to `expect(crossed.stepId).toBe('p2-first')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/coachSteps.test.ts src/shared/coach.test.ts`
Expected: FAIL — the order arrays still contain `'sections'`, and `coachStepById('p2-section')` is `undefined`.

- [ ] **Step 3: Add the move action kind**

In `src/shared/coachSteps.ts`, add the import and widen `CoachMoveAction`:

```ts
import type { CoachSectionOp } from './coachSections'
import type { DiscoverSlotKind } from './discoverSlotKind'
```

```ts
/** What a move actually DOES, as data rather than as a callback -- the
 * renderer switches on `kind` and nothing in src/shared/ knows that
 * Discover, React or Electron exist. 'add-slot' adds one Discover slot
 * targeting `kinds'; 'lock-climax' freezes the loop (see ./coachClimax.ts);
 * 'section-op' presses one of the phase-two panel's own buttons (see
 * ./coachSections.ts's CoachSectionOp), so the bubble's "stuck?" list and
 * the panel can never offer two different sets of moves. */
export type CoachMoveAction =
  | { kind: 'add-slot'; kinds: readonly DiscoverSlotKind[] }
  | { kind: 'lock-climax' }
  | { kind: 'section-op'; op: CoachSectionOp }
```

- [ ] **Step 4: Replace the placeholder row with three real ones**

In `src/shared/coachSteps.ts`, extend the `CoachStepId` union:

```ts
export type CoachStepId =
  | 'p1-flavour'
  | 'p1-low-end'
  | 'p1-harmony'
  | 'p1-drums'
  | 'p1-supporting'
  | 'p1-hook'
  | 'p1-balance'
  | 'p1-lock'
  | 'p2-first'
  | 'p2-section'
  | 'p2-next'
  | 'finish'
```

Add the anchor constant next to `DISCOVER_ADD_ROW`:

```ts
/** Every phase-two step stands next to the arranger's own scrolling
 * timeline -- which is also what makes him WALK when phase one ends
 * (spec: "walk = moving to another area (Discover -> timeline)"). The
 * attribute is on App.tsx's timeline scroll container. */
const TIMELINE = '[data-coach-anchor="timeline"]'
```

Replace the whole `sections` row in `COACH_STEPS` with these three:

```ts
  {
    id: 'p2-first',
    phase: 'arrangement',
    label: 'what comes first',
    lines: [
      'phase two: sections, one at a time. what comes first -- an intro, or straight into a build?',
      'now you carve. an intro is the usual opening; a build is the short-sketch opening.',
      'first section. intro eases in, build gets to the drop sooner. either is a fine start.',
      'pick what opens the track. nothing is permanent -- every section is ordinary clips after.'
    ],
    // No moves, deliberately: which section opens the track is an answer
    // only the user can give, exactly like the melodic-or-groove question.
    // "do it for me" stays disabled here and that is the point.
    moves: [],
    anchorSelector: TIMELINE
  },
  {
    id: 'p2-section',
    phase: 'arrangement',
    label: 'carve a section',
    lines: [
      'every stem from the locked loop is on. switch off what this section does not need.',
      'this section starts as the whole climax loop. subtracting is the only thing that changes it.',
      'name it, set its length, then turn things off. nothing comes out unless you take it out.',
      'the full loop is playing. the marked ones are what this kind of section usually loses.'
    ],
    // The panel's own three buttons, restated here so the bubble's "stuck?"
    // list and "do it for me" can never offer a different set of moves than
    // the panel shows. "drop the suggested ones" is the primary one because
    // it is the single shortcut the spec names -- and it still only ever
    // runs on a click, leaving the everything-on default until then.
    moves: [
      {
        id: 'section-drop-suggested',
        label: 'drop the suggested ones',
        action: { kind: 'section-op', op: 'drop-suggested' }
      },
      {
        id: 'section-preview',
        label: 'loop just this section',
        action: { kind: 'section-op', op: 'preview' }
      },
      {
        id: 'section-place',
        label: 'put it on the timeline',
        action: { kind: 'section-op', op: 'place' }
      }
    ],
    primaryMoveId: 'section-drop-suggested',
    anchorSelector: TIMELINE
  },
  {
    id: 'p2-next',
    phase: 'arrangement',
    label: 'what comes next',
    lines: [
      'that section is on the timeline, as ordinary clips. what comes next?',
      'down it goes. pick what follows, or stop here -- skip ends phase two.',
      'placed. the usual next moves are on the panel; an outro is what ends this phase.',
      'that is one section. keep going, or call the arrangement done and move to polish.'
    ],
    // Same reasoning as p2-first: what follows is the user's call.
    moves: [],
    anchorSelector: TIMELINE
  },
```

Update `LATER_PHASE_ORDER`:

```ts
/** Phase two's own loop plus phase three's remaining placeholder. The
 * answer to the melodic-or-groove question does not reach them.
 *
 * p2-section repeats: the flow walks p2-first -> p2-section -> p2-next and
 * then goes BACK to p2-section for as long as the user keeps choosing
 * another section (startCoachSection, ./coachPhase2.ts). This flat order is
 * still what advanceCoach's next/skip walks, so skipping from p2-next lands
 * on 'finish' -- which is exactly "stop arranging and go to polish". */
const LATER_PHASE_ORDER: readonly CoachStepId[] = ['p2-first', 'p2-section', 'p2-next', 'finish']
```

Finally update this file's own module doc comment: the paragraph saying `'sections'` and `'finish'` are placeholders becomes "the three 'p2-' rows are phase two, shipped 2026-09-22 (build order step 3); 'finish' is still a placeholder for build order step 4."

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/shared/coachSteps.test.ts src/shared/coach.test.ts`
Expected: PASS.

- [ ] **Step 6: Find every other place that named the old id**

```bash
grep -rn "'sections'" src | grep -v node_modules
```
Expected: no hits at all. If one remains (a test in `store.test.ts` or `serialize.test.ts` walking the flow to the end), update it to the new ids.

- [ ] **Step 7: Whole suite, typecheck, lint**

```bash
npx vitest run && npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/coachSteps.ts src/shared/coachSteps.test.ts src/shared/coach.test.ts
git commit -m "$(cat <<'EOF'
Three steps where the placeholder was, and one of them repeats

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 3: Two new line tables

The two phase-two lines that have to name the section they are about, so they are templates rather than finished strings — the same shape `COACH_SEEDED_LINE_TEMPLATES` already uses.

**Files:**
- Modify: `src/shared/coachLines.ts`
- Modify: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/shared/coachLines.test.ts`, add the two tables to the import and to the `tables` array in the `'the shared line tables'` describe block, then add:

```ts
describe('the section templates', () => {
  it('each name the section they are about', () => {
    for (const template of [...COACH_SECTION_LINE_TEMPLATES, ...COACH_NEXT_SECTION_LINE_TEMPLATES]) {
      expect(template).toContain('{section}')
    }
  })

  it('never pre-announce a change the user has not made', () => {
    // The everything-on rule, in the copy: nothing here may say a stem has
    // been removed, because nothing has been.
    for (const template of COACH_SECTION_LINE_TEMPLATES) {
      expect(template).not.toMatch(/i (removed|took out|dropped)/i)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: FAIL — `COACH_SECTION_LINE_TEMPLATES` is not exported.

- [ ] **Step 3: Add the tables**

Append to `src/shared/coachLines.ts`:

```ts
/** What the bubble says while a section is being carved. {section} is the
 * section's own name. Every variant states the same fact -- the whole loop
 * is playing and subtracting is the user's move -- because that fact is the
 * one thing about this step that is true of every track. Nothing here
 * claims a stem has been removed: nothing has been. */
export const COACH_SECTION_LINE_TEMPLATES: readonly string[] = [
  'the {section}. every stem from the loop is on -- switch off what it does not need.',
  '{section} next. the full climax loop is playing; take things out of it.',
  'this one is the {section}. it stays the whole loop until you turn something off.',
  'carving the {section}. marked stems are what this kind of section usually loses.'
]

/** What the bubble says once a section is on the timeline and the flow is
 * asking what follows. Reports the placement, which is a fact, and asks a
 * question -- never an opinion about what the track now needs. */
export const COACH_NEXT_SECTION_LINE_TEMPLATES: readonly string[] = [
  'the {section} is down, as ordinary clips. what comes next?',
  '{section} placed. pick what follows, or stop here.',
  'that is the {section} on the timeline. move it, resize it, redraw it -- or keep going.',
  '{section} done. an outro ends this phase; anything else keeps it running.'
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachLines.ts src/shared/coachLines.test.ts
git commit -m "$(cat <<'EOF'
Two more things to say, both about the step and neither about the song

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 4: Two new fields on `CoachState`

**Files:**
- Modify: `src/shared/coach.ts`
- Modify: `src/shared/coach.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/shared/coach.test.ts`:

```ts
describe('the phase-two fields', () => {
  it('start empty', () => {
    const coach = startCoach(T0)
    expect(coach.sections).toEqual([])
    expect(coach.draftSection).toBeNull()
  })

  it('survive a save and load', () => {
    const saved = {
      ...startCoach(T0),
      stepId: 'p2-section',
      sections: [
        {
          type: 'intro',
          name: 'intro',
          bars: 8,
          droppedPaths: ['/hook.wav'],
          startBar: 0,
          placedGroupIds: { '/kick.wav': 'g1' }
        }
      ],
      draftSection: { type: 'build', name: 'build', bars: 16, droppedPaths: [] }
    }
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.sections).toHaveLength(1)
    expect(loaded?.sections[0].droppedPaths).toEqual(['/hook.wav'])
    expect(loaded?.sections[0].placedGroupIds).toEqual({ '/kick.wav': 'g1' })
    expect(loaded?.draftSection).toEqual({
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: []
    })
  })

  it('load as empty from a project saved before phase two existed', () => {
    // Exactly what a phase-one .sssketchproj contains: no sections key,
    // no draftSection key.
    const phase1 = {
      status: 'active',
      stepId: 'p1-lock',
      outcomes: { 'p1-flavour': 'done' },
      phaseElapsedMs: { loop: 4 * MINUTE, arrangement: 0, polish: 0 },
      stepElapsedMs: 0,
      runningSince: T0,
      lineSeed: 3,
      flavour: 'groove',
      seededKinds: [],
      lockedClimax: null
    }
    const loaded = sanitiseLoadedCoach(phase1)
    expect(loaded?.sections).toEqual([])
    expect(loaded?.draftSection).toBeNull()
    expect(loaded?.stepId).toBe('p1-lock')
  })

  it('repairs a hand-edited section list rather than throwing', () => {
    const loaded = sanitiseLoadedCoach({
      ...startCoach(T0),
      sections: [{ type: 'nonsense' }, { type: 'drop', bars: 12 }],
      draftSection: 'not an object'
    })
    expect(loaded?.sections.map((s) => s.type)).toEqual(['drop'])
    expect(loaded?.draftSection).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: FAIL — `sections` is not a property of `CoachState`.

- [ ] **Step 3: Add the fields**

In `src/shared/coach.ts`, add the import:

```ts
import {
  sanitiseCoachSectionDraft,
  sanitiseCoachSections,
  type CoachSection,
  type CoachSectionDraft
} from './coachSections'
```

Add to the `CoachState` interface, after `lockedClimax`:

```ts
  /** Phase two's placed sections, in the order they went down (spec:
   * "sections built so far (type, bars, which stems play)"). Real persisted
   * project data: a half-finished guided track resumes with its arrangement
   * intact and the flow knowing where the next section goes. */
  sections: CoachSection[]
  /** The section currently being carved, or null when none is open. Its
   * droppedPaths is what "the user subtracts" writes to -- it starts empty,
   * always, because a section is the full climax loop until somebody says
   * otherwise. */
  draftSection: CoachSectionDraft | null
```

In `startCoach`, add `sections: [], draftSection: null` to the returned object.

In `sanitiseLoadedCoach`, add to the returned object:

```ts
    sections: sanitiseCoachSections(loose.sections),
    draftSection: sanitiseCoachSectionDraft(loose.draftSection)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: green. `store.test.ts`'s `initialState.coach` assertions are unaffected (that field is still `null`); any test that constructs a `CoachState` literal by hand will now fail typecheck and needs the two new fields — fix those by spreading `startCoach(T0)` rather than by listing fields.

- [ ] **Step 6: Commit**

```bash
git add src/shared/coach.ts src/shared/coach.test.ts
git commit -m "$(cat <<'EOF'
The flow remembers the sections, and the one it is still carving

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 5: The phase-two transitions

Every state change phase two can make, pure and tested. **This is where the everything-on rule is enforced in behaviour.**

**Files:**
- Create: `src/shared/coachPhase2.ts`
- Create: `src/shared/coachPhase2.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachPhase2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { suggestedDropPaths } from './coachSections'
import {
  coachSectionLine,
  dropSuggestedCoachSectionStems,
  nudgeCoachSectionBars,
  placeCoachSection,
  setCoachSectionName,
  startCoachSection,
  toggleCoachSectionStem
} from './coachPhase2'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

function stem(path: string, kinds: LockedClimaxStem['kinds']): LockedClimaxStem {
  return {
    path,
    name: path,
    author: 'e',
    type: 'fx',
    durationSec: 4,
    barLength: 4,
    kinds,
    role: 'aux',
    gain: 1
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: T0,
  stems: [
    stem('/kick.wav', ['drums']),
    stem('/bass.wav', ['bass']),
    stem('/harmony.wav', ['lead', 'warm']),
    stem('/hook.wav', ['lead', 'bright'])
  ]
}

function locked(): CoachState {
  return { ...startCoach(T0), stepId: 'p2-first', lockedClimax: climax }
}

describe('startCoachSection', () => {
  it('opens a draft with EVERY stem on', () => {
    const state = startCoachSection(locked(), T0 + MINUTE, 'intro')
    expect(state.stepId).toBe('p2-section')
    expect(state.draftSection).toEqual({
      type: 'intro',
      name: 'intro',
      bars: 8,
      droppedPaths: []
    })
  })

  it('does nothing at all without a locked climax', () => {
    const unlocked = startCoach(T0)
    expect(startCoachSection(unlocked, T0 + MINUTE, 'intro')).toBe(unlocked)
  })

  it('banks the time spent on the question and marks it done', () => {
    const state = startCoachSection(locked(), T0 + 3 * MINUTE, 'build')
    expect(state.outcomes['p2-first']).toBe('done')
    expect(state.phaseElapsedMs.arrangement).toBe(3 * MINUTE)
    expect(state.stepElapsedMs).toBe(0)
    expect(state.runningSince).toBe(T0 + 3 * MINUTE)
  })

  it('rotates the line on every new section', () => {
    const first = startCoachSection(locked(), T0, 'intro')
    const second = startCoachSection(first, T0, 'build')
    expect(second.lineSeed).toBe(first.lineSeed + 1)
  })
})

describe('editing the draft', () => {
  const open = startCoachSection(locked(), T0, 'build')

  it('renames', () => {
    expect(setCoachSectionName(open, 'the long build').draftSection?.name).toBe('the long build')
  })

  it('nudges the length by four and eight, clamped', () => {
    expect(nudgeCoachSectionBars(open, 8).draftSection?.bars).toBe(24)
    expect(nudgeCoachSectionBars(open, -4).draftSection?.bars).toBe(12)
    const tiny = nudgeCoachSectionBars(nudgeCoachSectionBars(open, -8), -8)
    expect(tiny.draftSection?.bars).toBe(4)
    expect(nudgeCoachSectionBars(tiny, -8).draftSection?.bars).toBe(4)
  })

  it('toggles one stem off and back on', () => {
    const off = toggleCoachSectionStem(open, '/hook.wav')
    expect(off.draftSection?.droppedPaths).toEqual(['/hook.wav'])
    expect(toggleCoachSectionStem(off, '/hook.wav').draftSection?.droppedPaths).toEqual([])
  })

  it('ignores a path that is not in the locked climax', () => {
    expect(toggleCoachSectionStem(open, '/not-here.wav')).toBe(open)
  })

  it('leaves everything alone when no draft is open', () => {
    const closed = locked()
    expect(setCoachSectionName(closed, 'x')).toBe(closed)
    expect(nudgeCoachSectionBars(closed, 4)).toBe(closed)
    expect(toggleCoachSectionStem(closed, '/hook.wav')).toBe(closed)
    expect(dropSuggestedCoachSectionStems(closed)).toBe(closed)
  })
})

describe('dropSuggestedCoachSectionStems', () => {
  it('applies every flag at once, and ONLY when called', () => {
    const open = startCoachSection(locked(), T0, 'intro')
    // The draft was untouched until this call. That is the whole rule.
    expect(open.draftSection?.droppedPaths).toEqual([])
    const dropped = dropSuggestedCoachSectionStems(open)
    expect(dropped.draftSection?.droppedPaths).toEqual(suggestedDropPaths('intro', climax))
    expect(dropped.draftSection?.droppedPaths).toEqual(['/harmony.wav', '/hook.wav'])
  })

  it('merges with what the user already switched off, without duplicating', () => {
    const open = toggleCoachSectionStem(startCoachSection(locked(), T0, 'intro'), '/harmony.wav')
    const dropped = dropSuggestedCoachSectionStems(open)
    expect(dropped.draftSection?.droppedPaths).toEqual(['/harmony.wav', '/hook.wav'])
  })

  it('is a no-op on a drop, which suggests nothing', () => {
    const open = startCoachSection(locked(), T0, 'drop')
    expect(dropSuggestedCoachSectionStems(open)).toBe(open)
  })
})

describe('placeCoachSection', () => {
  const open = startCoachSection(locked(), T0, 'intro')

  it('records the section and asks what comes next', () => {
    const placed = placeCoachSection(open, T0 + MINUTE, 0, { '/kick.wav': 'g1' })
    expect(placed.stepId).toBe('p2-next')
    expect(placed.draftSection).toBeNull()
    expect(placed.sections).toEqual([
      {
        type: 'intro',
        name: 'intro',
        bars: 8,
        droppedPaths: [],
        startBar: 0,
        placedGroupIds: { '/kick.wav': 'g1' }
      }
    ])
    expect(placed.outcomes['p2-section']).toBe('done')
  })

  it('ends phase two when the section was an outro', () => {
    const outro = startCoachSection(locked(), T0, 'outro')
    const placed = placeCoachSection(outro, T0 + MINUTE, 40, {})
    expect(placed.stepId).toBe('finish')
    expect(placed.outcomes['p2-next']).toBe('done')
  })

  it('keeps sections in the order they were placed', () => {
    const first = placeCoachSection(open, T0, 0, {})
    const second = placeCoachSection(startCoachSection(first, T0, 'build'), T0, 8, {})
    expect(second.sections.map((s) => s.type)).toEqual(['intro', 'build'])
  })

  it('does nothing without a draft', () => {
    const closed = locked()
    expect(placeCoachSection(closed, T0, 0, {})).toBe(closed)
  })
})

describe('coachSectionLine', () => {
  it('names the section being carved', () => {
    const open = startCoachSection(locked(), T0, 'drop')
    expect(coachSectionLine(open)).toContain('drop')
    expect(coachSectionLine(open)).not.toContain('{section}')
  })

  it('names the section just placed while asking what comes next', () => {
    const placed = placeCoachSection(startCoachSection(locked(), T0, 'intro'), T0, 0, {})
    expect(coachSectionLine(placed)).toContain('intro')
  })

  it('is null on every step that is not phase two', () => {
    expect(coachSectionLine(startCoach(T0))).toBeNull()
    expect(coachSectionLine(locked())).toBeNull()
  })

  it('is stable for one thought and rotates with the seed', () => {
    const open = startCoachSection(locked(), T0, 'drop')
    expect(coachSectionLine(open)).toBe(coachSectionLine(open))
    expect(coachSectionLine({ ...open, lineSeed: open.lineSeed + 1 })).not.toBe(
      coachSectionLine(open)
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachPhase2.test.ts`
Expected: FAIL — `Failed to resolve import "./coachPhase2"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachPhase2.ts`:

```ts
/**
 * Phase two's own transitions: opening a section, editing it, and putting it
 * down.
 *
 * Everything here is pure and every function takes the whole CoachState and
 * returns a new one, the same shape ./coachPhase1.ts uses. Time is injected
 * (`now`), never read from the clock -- see ./coach.ts's module doc.
 *
 * THE RULE (spec): **everything is on, the user subtracts.** A draft opens
 * with droppedPaths empty and stays that way until somebody toggles a stem
 * or presses "drop the suggested ones". dropSuggestedCoachSectionStems below
 * is the ONLY function in this codebase that adds the suggestion table's
 * output to a draft, and it exists to be called from a click. Nothing in
 * startCoachSection, and nothing in the reducer, may pre-apply it: a
 * suggestion you ignore costs nothing when it is wrong, a pre-applied
 * default is a decision you have to notice and undo.
 *
 * The loop back is here rather than in advanceCoach: phase two walks
 * p2-first -> p2-section -> p2-next and then RETURNS to p2-section for as
 * long as the user keeps choosing another section. startCoachSection is that
 * return, and it works from either question step because both do the same
 * thing -- mark the question answered and open a fresh, everything-on draft.
 */

import { coachLine, pauseCoach, type CoachOutcome, type CoachState } from './coach'
import {
  COACH_NEXT_SECTION_LINE_TEMPLATES,
  COACH_SECTION_LINE_TEMPLATES,
  pickLineVariant
} from './coachLines'
import {
  newCoachSectionDraft,
  nudgeSectionBars,
  suggestedDropPaths,
  type CoachSection,
  type CoachSectionType
} from './coachSections'

/**
 * Opens a fresh section. Dispatched by the panel from p2-first ("what comes
 * first") and from p2-next ("what comes next"), which are the same
 * transition seen twice.
 *
 * Refuses without a locked climax: there would be nothing to carve, and
 * storing a draft against no material would only produce a panel with an
 * empty stem list.
 */
export function startCoachSection(
  state: CoachState,
  now: number,
  type: CoachSectionType
): CoachState {
  if (state.lockedClimax === null) return state
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    outcomes: { ...banked.outcomes, [banked.stepId]: 'done' as CoachOutcome },
    stepId: 'p2-section',
    // Everything on. See this module's own doc comment.
    draftSection: newCoachSectionDraft(type, banked.sections),
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1,
    // One thought at a time -- a seeded note from phase one never follows
    // the user into phase two.
    seededKinds: []
  }
}

/** Takes no `now`: typing a name is not a step change and must not move the
 * clock or the line. */
export function setCoachSectionName(state: CoachState, name: string): CoachState {
  if (state.draftSection === null) return state
  return { ...state, draftSection: { ...state.draftSection, name } }
}

/** The spec's "+/-4/+/-8", clamped by nudgeSectionBars. Returns the state
 * untouched when the nudge would change nothing, so a button held at the
 * clamp does not churn React. */
export function nudgeCoachSectionBars(state: CoachState, delta: number): CoachState {
  if (state.draftSection === null) return state
  const bars = nudgeSectionBars(state.draftSection.bars, delta)
  if (bars === state.draftSection.bars) return state
  return { ...state, draftSection: { ...state.draftSection, bars } }
}

/**
 * One stem switched off, or back on. The ONLY per-stem change in phase two,
 * and it is always the user's own gesture.
 *
 * A path that is not in the locked climax is ignored rather than stored: a
 * dropped path that matches nothing would be invisible in the panel and
 * would survive in the saved project forever.
 *
 * Switching off the LAST stem is allowed. A silent section is a real
 * musical move (a bar of nothing before a drop), the placement builder
 * handles it by placing no clips, and the next section still starts after
 * it -- see nextCoachSectionStartBar.
 */
export function toggleCoachSectionStem(state: CoachState, path: string): CoachState {
  const draft = state.draftSection
  if (draft === null || state.lockedClimax === null) return state
  if (!state.lockedClimax.stems.some((stem) => stem.path === path)) return state
  const droppedPaths = draft.droppedPaths.includes(path)
    ? draft.droppedPaths.filter((dropped) => dropped !== path)
    : [...draft.droppedPaths, path]
  return { ...state, draftSection: { ...draft, droppedPaths } }
}

/**
 * "drop the suggested ones" -- the one button that applies every flag at
 * once (spec).
 *
 * This is the only bulk subtraction in the feature, and it only ever runs
 * from a click. Merges with whatever the user already switched off (so
 * pressing it after some manual toggles never un-drops anything), and
 * returns the state untouched when this section type suggests nothing --
 * which is exactly the drop, "everything plays".
 */
export function dropSuggestedCoachSectionStems(state: CoachState): CoachState {
  const draft = state.draftSection
  if (draft === null || state.lockedClimax === null) return state
  const suggested = suggestedDropPaths(draft.type, state.lockedClimax)
  if (suggested.length === 0) return state
  const droppedPaths = [...new Set([...draft.droppedPaths, ...suggested])]
  if (droppedPaths.length === draft.droppedPaths.length) return state
  return { ...state, draftSection: { ...draft, droppedPaths } }
}

/**
 * The draft becomes a placed section.
 *
 * `startBar` and `placedGroupIds` come from the caller, which has just built
 * the real arranger actions (buildCoachSectionActions,
 * src/renderer/src/state/coachSectionPlacement.ts) -- this records what
 * REALLY happened rather than recomputing it, so the flow's own idea of the
 * arrangement can never drift from the timeline.
 *
 * An outro ends phase two (spec: "Choosing outro ends phase 2") -- but only
 * once it has actually been built and placed, because an outro is a section
 * like any other, with its own suggested drops.
 */
export function placeCoachSection(
  state: CoachState,
  now: number,
  startBar: number,
  placedGroupIds: Record<string, string>
): CoachState {
  const draft = state.draftSection
  if (draft === null) return state
  const banked = pauseCoach(state, now)
  const section: CoachSection = {
    type: draft.type,
    name: draft.name,
    bars: draft.bars,
    droppedPaths: [...draft.droppedPaths],
    startBar,
    placedGroupIds
  }
  const finishing = draft.type === 'outro'
  const outcomes: Record<string, CoachOutcome> = { ...banked.outcomes, 'p2-section': 'done' }
  if (finishing) outcomes['p2-next'] = 'done'
  return {
    ...banked,
    sections: [...banked.sections, section],
    draftSection: null,
    outcomes,
    stepId: finishing ? 'finish' : 'p2-next',
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1,
    seededKinds: []
  }
}

/**
 * The phase-two thought on screen, or null when the flow is somewhere else
 * (the caller then falls back to coachLineFor, ./coachPhase1.ts).
 *
 * Returns ONE string, like every other line in this feature -- "a new step's
 * text replaces the old one; nothing stacks" (spec) applies just as much
 * inside phase two.
 */
export function coachSectionLine(state: CoachState): string | null {
  if (state.status === 'finished') return null
  if (state.stepId === 'p2-section' && state.draftSection !== null) {
    return pickLineVariant(COACH_SECTION_LINE_TEMPLATES, state.lineSeed).replace(
      '{section}',
      state.draftSection.name
    )
  }
  if (state.stepId === 'p2-next' && state.sections.length > 0) {
    const last = state.sections[state.sections.length - 1]
    return pickLineVariant(COACH_NEXT_SECTION_LINE_TEMPLATES, state.lineSeed).replace(
      '{section}',
      last.name
    )
  }
  return null
}
```

`coachLine` is imported but unused in the final shape — remove it from the import (`import { pauseCoach, type CoachOutcome, type CoachState } from './coach'`) so lint stays clean.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachPhase2.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/coachPhase2.ts src/shared/coachPhase2.test.ts
git commit -m "$(cat <<'EOF'
Everything on, and only a click ever takes something out

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 6: The six new store actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`
- Modify: `src/renderer/src/state/history.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/store.test.ts`, next to the existing coach reducer tests. That file already imports `reducer`, `initialState` and `type CoachSlotSnapshot`; add `type AppState` to its `./store` import if it is not there yet.

```ts
describe('the phase-two coach actions', () => {
  const climaxSlots: CoachSlotSnapshot[] = [
    {
      id: 's1',
      kinds: ['drums'],
      gain: 1,
      audible: true,
      rolling: false,
      stem: {
        path: '/kick.wav',
        name: 'kick',
        author: 'e',
        type: 'drums',
        durationSec: 4,
        barLength: 4
      }
    },
    {
      id: 's2',
      kinds: ['lead', 'bright'],
      gain: 0.8,
      audible: true,
      rolling: false,
      stem: {
        path: '/hook.wav',
        name: 'hook',
        author: 'e',
        type: 'fx',
        durationSec: 4,
        barLength: 4
      }
    }
  ]

  function lockedState(): AppState {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, { type: 'COACH_LOCK_CLIMAX', now: NOW, slots: climaxSlots, bpm: 120 })
    return state
  }

  it('opens a section with every stem on', () => {
    const state = reducer(lockedState(), {
      type: 'COACH_START_SECTION',
      now: NOW,
      sectionType: 'intro'
    })
    expect(state.coach?.stepId).toBe('p2-section')
    expect(state.coach?.draftSection?.droppedPaths).toEqual([])
  })

  it('renames, nudges, toggles and drops the suggested ones', () => {
    let state = reducer(lockedState(), {
      type: 'COACH_START_SECTION',
      now: NOW,
      sectionType: 'intro'
    })
    state = reducer(state, { type: 'COACH_SET_SECTION_NAME', name: 'the way in' })
    state = reducer(state, { type: 'COACH_NUDGE_SECTION_BARS', delta: 8 })
    expect(state.coach?.draftSection?.name).toBe('the way in')
    expect(state.coach?.draftSection?.bars).toBe(16)

    state = reducer(state, { type: 'COACH_TOGGLE_SECTION_STEM', path: '/kick.wav' })
    expect(state.coach?.draftSection?.droppedPaths).toEqual(['/kick.wav'])

    state = reducer(state, { type: 'COACH_DROP_SUGGESTED_STEMS' })
    expect(state.coach?.draftSection?.droppedPaths).toEqual(['/kick.wav', '/hook.wav'])
  })

  it('records a placed section and moves on', () => {
    let state = reducer(lockedState(), {
      type: 'COACH_START_SECTION',
      now: NOW,
      sectionType: 'intro'
    })
    state = reducer(state, {
      type: 'COACH_PLACE_SECTION',
      now: NOW,
      startBar: 0,
      placedGroupIds: { '/kick.wav': 'g1' }
    })
    expect(state.coach?.stepId).toBe('p2-next')
    expect(state.coach?.sections).toHaveLength(1)
    expect(state.coach?.sections[0].startBar).toBe(0)
  })

  it('every phase-two action is a no-op when no flow exists', () => {
    expect(
      reducer(initialState, { type: 'COACH_START_SECTION', now: NOW, sectionType: 'intro' }).coach
    ).toBeNull()
    expect(reducer(initialState, { type: 'COACH_SET_SECTION_NAME', name: 'x' }).coach).toBeNull()
    expect(reducer(initialState, { type: 'COACH_NUDGE_SECTION_BARS', delta: 4 }).coach).toBeNull()
    expect(
      reducer(initialState, { type: 'COACH_TOGGLE_SECTION_STEM', path: '/x' }).coach
    ).toBeNull()
    expect(reducer(initialState, { type: 'COACH_DROP_SUGGESTED_STEMS' }).coach).toBeNull()
    expect(
      reducer(initialState, {
        type: 'COACH_PLACE_SECTION',
        now: NOW,
        startBar: 0,
        placedGroupIds: {}
      }).coach
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — typecheck errors on the unknown action types.

- [ ] **Step 3: Add the actions and reducer cases**

In `src/renderer/src/state/store.ts`, add the imports:

```ts
import {
  dropSuggestedCoachSectionStems,
  nudgeCoachSectionBars,
  placeCoachSection,
  setCoachSectionName,
  startCoachSection,
  toggleCoachSectionStem
} from '@shared/coachPhase2'
import type { CoachSectionType } from '@shared/coachSections'
```

Add to the `Action` union, right after `COACH_LOCK_CLIMAX`:

```ts
  // Phase two (2026-09-22). `sectionType` rather than `type`, which is
  // already the action's own discriminant. COACH_PLACE_SECTION carries the
  // startBar and groupIds the caller REALLY used, because it is always
  // dispatched inside the same BATCH as the arranger actions that produced
  // them -- see history.ts's own note.
  | { type: 'COACH_START_SECTION'; now: number; sectionType: CoachSectionType }
  | { type: 'COACH_SET_SECTION_NAME'; name: string }
  | { type: 'COACH_NUDGE_SECTION_BARS'; delta: number }
  | { type: 'COACH_TOGGLE_SECTION_STEM'; path: string }
  | { type: 'COACH_DROP_SUGGESTED_STEMS' }
  | {
      type: 'COACH_PLACE_SECTION'
      now: number
      startBar: number
      placedGroupIds: Record<string, string>
    }
```

Add the reducer cases after `COACH_LOCK_CLIMAX`:

```ts
    case 'COACH_START_SECTION':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: startCoachSection(state.coach, action.now, action.sectionType)
          }

    case 'COACH_SET_SECTION_NAME':
      return state.coach === null
        ? state
        : { ...state, coach: setCoachSectionName(state.coach, action.name) }

    case 'COACH_NUDGE_SECTION_BARS':
      return state.coach === null
        ? state
        : { ...state, coach: nudgeCoachSectionBars(state.coach, action.delta) }

    case 'COACH_TOGGLE_SECTION_STEM':
      return state.coach === null
        ? state
        : { ...state, coach: toggleCoachSectionStem(state.coach, action.path) }

    // The one bulk subtraction in the feature, and it only ever arrives
    // from a click on "drop the suggested ones". Nothing else in this
    // reducer may apply the suggestion table.
    case 'COACH_DROP_SUGGESTED_STEMS':
      return state.coach === null
        ? state
        : { ...state, coach: dropSuggestedCoachSectionStems(state.coach) }

    case 'COACH_PLACE_SECTION':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: placeCoachSection(
              state.coach,
              action.now,
              action.startBar,
              action.placedGroupIds
            )
          }
```

In `src/renderer/src/state/history.ts`, add to `TRANSIENT_ACTION_TYPES` after `'COACH_LOCK_CLIMAX'`:

```ts
  // Phase two's own flow bookkeeping -- same category as every other
  // COACH_* entry above: where sssketchy is, not an edit to the project.
  'COACH_START_SECTION',
  'COACH_SET_SECTION_NAME',
  'COACH_NUDGE_SECTION_BARS',
  'COACH_TOGGLE_SECTION_STEM',
  'COACH_DROP_SUGGESTED_STEMS',
  // COACH_PLACE_SECTION is listed here so a stray direct dispatch cannot
  // push a checkpoint of its own -- but in real use it is ALWAYS dispatched
  // inside the same BATCH as the arranger actions that place the section's
  // clips (SssketchySectionPanel.tsx). The BATCH branch above runs before
  // this set is consulted, so that group gets exactly one checkpoint: the
  // clips and the flow's record of the section undo together, which is what
  // "one undo step per section" (spec) means.
  'COACH_PLACE_SECTION',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts \
  src/renderer/src/state/history.ts
git commit -m "$(cat <<'EOF'
Six things the flow can be told about a section

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 7: Persistence of the phase-two fields

`serializeProject`/`deserializeProject` need no change at all (see Finding 10) — this task proves that, including for a project saved before phase 2 existed.

**Files:**
- Modify: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the test**

Add to `src/renderer/src/state/serialize.test.ts`, next to the existing coach round-trip tests:

```ts
  it('round-trips a half-carved phase-two flow', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: T0 })
    state = reducer(state, {
      type: 'COACH_LOCK_CLIMAX',
      now: T0,
      bpm: 120,
      slots: [
        {
          id: 's1',
          kinds: ['drums'],
          gain: 1,
          audible: true,
          rolling: false,
          stem: {
            path: '/kick.wav',
            name: 'kick',
            author: 'e',
            type: 'drums',
            durationSec: 4,
            barLength: 4
          }
        }
      ]
    })
    state = reducer(state, { type: 'COACH_START_SECTION', now: T0, sectionType: 'intro' })
    state = reducer(state, {
      type: 'COACH_PLACE_SECTION',
      now: T0,
      startBar: 0,
      placedGroupIds: { '/kick.wav': 'g1' }
    })
    state = reducer(state, { type: 'COACH_START_SECTION', now: T0, sectionType: 'build' })
    state = reducer(state, { type: 'COACH_TOGGLE_SECTION_STEM', path: '/kick.wav' })

    const restored = deserializeProject(serializeProject(state, {}).json)
    expect(restored.coach?.sections).toEqual([
      {
        type: 'intro',
        name: 'intro',
        bars: 8,
        droppedPaths: [],
        startBar: 0,
        placedGroupIds: { '/kick.wav': 'g1' }
      }
    ])
    expect(restored.coach?.draftSection).toEqual({
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: ['/kick.wav']
    })
    // A loaded flow is always hidden and its clock always stopped.
    expect(restored.coach?.status).toBe('dismissed')
    expect(restored.coach?.runningSince).toBeNull()
  })

  it('a project saved before phase two existed loads with no sections', () => {
    const phase1 = JSON.parse(serializeProject(initialState, {}).json)
    phase1.coach = {
      status: 'active',
      stepId: 'p1-lock',
      outcomes: { 'p1-flavour': 'done' },
      phaseElapsedMs: { loop: 4 * MINUTE, arrangement: 0, polish: 0 },
      stepElapsedMs: 0,
      runningSince: T0,
      lineSeed: 2,
      flavour: 'groove',
      seededKinds: [],
      lockedClimax: null
    }
    expect('sections' in phase1.coach).toBe(false)
    const restored = deserializeProject(JSON.stringify(phase1))
    expect(restored.coach?.sections).toEqual([])
    expect(restored.coach?.draftSection).toBeNull()
    expect(restored.coach?.stepId).toBe('p1-lock')
  })
```

(Reuse whatever `T0` / `MINUTE` constants that file already defines; if it does not define `MINUTE`, inline `4 * 60_000`.)

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: PASS first time — no production change is needed. If it fails, the bug is in `sanitiseLoadedCoach` (Task 4), not here.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/state/serialize.test.ts
git commit -m "$(cat <<'EOF'
A half-carved arrangement survives the round trip, and so does an old save

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 8: Placement — the arranger write path

Turns a finished section into real arranger actions. Read Finding 6 before starting.

**Files:**
- Create: `src/renderer/src/state/coachSectionPlacement.ts`
- Create: `src/renderer/src/state/coachSectionPlacement.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/state/coachSectionPlacement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
import { buildCoachSectionActions } from './coachSectionPlacement'
import type { LockedClimax, LockedClimaxStem } from '@shared/coachClimax'
import type { CoachSection, CoachSectionDraft } from '@shared/coachSections'
import { stemKey } from '@shared/types'

function stem(path: string): LockedClimaxStem {
  return {
    path,
    name: path.replace('/', '').replace('.wav', ''),
    author: 'e',
    type: 'drums',
    durationSec: 4,
    barLength: 4,
    kinds: ['drums'],
    role: 'drums',
    gain: 0.5
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: 0,
  stems: [stem('/kick.wav'), stem('/bass.wav'), stem('/hook.wav')]
}

function draft(overrides: Partial<CoachSectionDraft> = {}): CoachSectionDraft {
  return { type: 'intro', name: 'intro', bars: 16, droppedPaths: [], ...overrides }
}

function apply(state: AppState, actions: ReturnType<typeof buildCoachSectionActions>): AppState {
  return actions.actions.reduce((next, action) => reducer(next, action), state)
}

describe('buildCoachSectionActions', () => {
  it('places one clip per kept stem, at bar 0 on an empty project', () => {
    const built = buildCoachSectionActions(initialState, climax, draft(), [])
    expect(built.startBar).toBe(0)
    const place = built.actions[0]
    expect(place.type).toBe('PLACE_LOOP_ON_TIMELINE')
    if (place.type !== 'PLACE_LOOP_ON_TIMELINE') throw new Error('unreachable')
    expect(place.stems).toHaveLength(3)
    expect(place.startBar).toBe(0)
    // One stem per rifff, slot 1 -- the shape this action documents.
    for (const rifff of place.stems) expect(rifff.stems.map((s) => s.slot)).toEqual([1])
    // The locked gain rides along in the vol map, keyed by stemKey.
    for (const rifff of place.stems) {
      expect(place.vol?.[stemKey(rifff.groupId, 1)]).toBe(0.5)
    }
  })

  it('stretches each clip to the section length', () => {
    const built = buildCoachSectionActions(initialState, climax, draft({ bars: 16 }), [])
    const resizes = built.actions.filter((a) => a.type === 'SET_PLAYED_BARS')
    expect(resizes).toHaveLength(3)
    for (const resize of resizes) {
      if (resize.type !== 'SET_PLAYED_BARS') throw new Error('unreachable')
      expect(resize.bars).toBe(16)
    }
  })

  it('leaves a subtracted stem off the timeline entirely', () => {
    const built = buildCoachSectionActions(
      initialState,
      climax,
      draft({ droppedPaths: ['/hook.wav'] }),
      []
    )
    expect(Object.keys(built.placedGroupIds)).toEqual(['/kick.wav', '/bass.wav'])
    const state = apply(initialState, built)
    const names = Object.values(state.rifffs).map((r) => r.stems[0].path)
    expect(names).toEqual(['/kick.wav', '/bass.wav'])
  })

  it('places nothing at all for a section with every stem switched off', () => {
    const built = buildCoachSectionActions(
      initialState,
      climax,
      draft({ droppedPaths: ['/kick.wav', '/bass.wav', '/hook.wav'] }),
      []
    )
    expect(built.actions).toEqual([])
    expect(built.placedGroupIds).toEqual({})
    expect(built.startBar).toBe(0)
  })

  it('starts after the previous section and reuses its channel rows', () => {
    const first = buildCoachSectionActions(initialState, climax, draft(), [])
    const afterFirst = apply(initialState, first)
    const sections: CoachSection[] = [
      {
        type: 'intro',
        name: 'intro',
        bars: 16,
        droppedPaths: [],
        startBar: 0,
        placedGroupIds: first.placedGroupIds
      }
    ]

    const second = buildCoachSectionActions(
      afterFirst,
      climax,
      draft({ type: 'drop', name: 'drop', bars: 8 }),
      sections
    )
    expect(second.startBar).toBe(16)

    const moves = second.actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')
    expect(moves).toHaveLength(3)

    const afterSecond = apply(afterFirst, second)
    // One channel per STEM, not one per section: the second section's clip
    // for /kick.wav sits on the row the first section's clip created.
    for (const path of ['/kick.wav', '/bass.wav', '/hook.wav']) {
      expect(afterSecond.channelOf[second.placedGroupIds[path]]).toBe(first.placedGroupIds[path])
    }
    // And the clips really are where the sections say they are.
    expect(afterSecond.rifffs[second.placedGroupIds['/kick.wav']].startBar).toBe(16)
    expect(afterSecond.playedBars[second.placedGroupIds['/kick.wav']]).toBe(8)
  })

  it('gives a stem its own new lane the first time it appears', () => {
    const first = buildCoachSectionActions(
      initialState,
      climax,
      draft({ droppedPaths: ['/hook.wav'] }),
      []
    )
    const afterFirst = apply(initialState, first)
    const sections: CoachSection[] = [
      {
        type: 'intro',
        name: 'intro',
        bars: 16,
        droppedPaths: ['/hook.wav'],
        startBar: 0,
        placedGroupIds: first.placedGroupIds
      }
    ]
    const second = buildCoachSectionActions(afterFirst, climax, draft({ type: 'drop' }), sections)
    const moves = second.actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')
    // The hook was not in the intro, so it has no lane to rejoin.
    expect(moves).toHaveLength(2)
    const afterSecond = apply(afterFirst, second)
    const hookGroup = second.placedGroupIds['/hook.wav']
    expect(afterSecond.channelOf[hookGroup]).toBe(hookGroup)
  })

  it('starts the first section after material already on the timeline', () => {
    const existing = buildCoachSectionActions(initialState, climax, draft({ bars: 8 }), [])
    const state = apply(initialState, existing)
    // No sections recorded, but the timeline is not empty -- e.g. a Discover
    // loop the user plunked down during phase one.
    const built = buildCoachSectionActions(state, climax, draft(), [])
    expect(built.startBar).toBe(8)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachSectionPlacement.test.ts`
Expected: FAIL — `Failed to resolve import "./coachSectionPlacement"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/state/coachSectionPlacement.ts`:

```ts
/**
 * One finished section -> real arranger actions.
 *
 * THE POINT (spec): "Placement reuses the arranger's existing write path, so
 * the result is ordinary, fully editable arrangement -- one undo step per
 * section." Nothing here invents a clip type, a flag, or a second-class
 * "guided" object. What comes out is exactly what Discover's own "add to
 * timeline" produces, laid out section by section.
 *
 * Why this is not a call to buildArrangeReplaceActions (selectors.ts), which
 * the spec names: that function REPLACES clips already on the timeline --
 * it reads state.rifffs for every moved stem and finishes with one
 * DELETE_RIFFFS of every source it touched. Phase two has no such source
 * (the locked climax is a value on the coach state: paths, roles and gains),
 * and calling it once per section would delete the sections already placed.
 * So this builds a section out of the same three actions THAT function
 * emits, in the same order, with the same channel-continuity trick:
 *
 *  - PLACE_LOOP_ON_TIMELINE, one single-stem Rifff per kept stem, which is
 *    exactly what that action's own doc comment describes ("one groupId per
 *    Discover slot, each carrying exactly one Stem") and what
 *    DiscoverPanel's addToTimeline already dispatches;
 *  - MOVE_TO_CHANNEL for any stem that already owns a lane from an earlier
 *    section, onto that lane -- buildArrangeReplaceActions' own
 *    firstCopyChannelId trick (selectors.ts). Without it, PLACE_LOOP_ON_
 *    TIMELINE's channelOf[groupId] = groupId would give every section a
 *    fresh set of rows and the arrangement would read as a staircase
 *    instead of one row per stem;
 *  - SET_PLAYED_BARS, which is the right-edge resize, so a four-bar loop
 *    tiles out to fill a sixteen-bar section.
 *
 * Unlike buildArrangeReplaceActions this needs no TOGGLE_STRETCH correction:
 * both PLACE_LOOP_ON_TIMELINE and MOVE_TO_CHANNEL's shared placeOnTimeline
 * set stretch to true, and a freshly placed Discover stem wants stretch on.
 *
 * The caller dispatches `actions` and the COACH_PLACE_SECTION that records
 * them in ONE BATCH -- see SssketchySectionPanel.tsx and history.ts.
 */

import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { placedTimelineSpanBars } from './selectors'
import type { Action, AppState } from './store'
import type { LockedClimax, LockedClimaxStem } from '@shared/coachClimax'
import {
  nextCoachSectionStartBar,
  sectionKeptStems,
  sectionLaneChannelIds,
  type CoachSection,
  type CoachSectionDraft
} from '@shared/coachSections'
import type { Rifff, Stem } from '@shared/types'

export interface CoachSectionPlacement {
  /** Where the section really goes. */
  startBar: number
  /** Dispatch these in order, in one BATCH, together with the
   * COACH_PLACE_SECTION that records the result. Empty for a section with
   * every stem switched off -- a silent section is allowed, and the flow's
   * own arithmetic still advances past it. */
  actions: Action[]
  /** climax stem path -> the groupId it was placed as, which is also the
   * channel row it owns from here on. Goes straight into
   * COACH_PLACE_SECTION. */
  placedGroupIds: Record<string, string>
}

/** Just the Stem fields, never the coach's own extras -- kinds/role/gain
 * live on the locked climax and have no business being persisted into a
 * Rifff. Listed explicitly rather than spread, because a spread of a
 * LockedClimaxStem would carry all three straight into the project file. */
function stemFromClimax(stem: LockedClimaxStem): Omit<Stem, 'slot'> {
  return {
    author: stem.author,
    name: stem.name,
    type: stem.type,
    path: stem.path,
    durationSec: stem.durationSec,
    barLength: stem.barLength
  }
}

export function buildCoachSectionActions(
  state: AppState,
  climax: LockedClimax,
  draft: CoachSectionDraft,
  sections: readonly CoachSection[]
): CoachSectionPlacement {
  const startBar = nextCoachSectionStartBar(sections, placedTimelineSpanBars(state))
  const lanes = sectionLaneChannelIds(sections)

  const rifffs: Rifff[] = []
  const vol: Record<string, number> = {}
  const placedGroupIds: Record<string, string> = {}
  const afterPlacement: Action[] = []

  for (const stem of sectionKeptStems(climax, draft.droppedPaths)) {
    // One member, so the assembled rifff's own barLength is this stem's --
    // which is what makes SET_PLAYED_BARS below tile it out rather than
    // stretch it. Reused rather than hand-rolled so the gain-to-vol mapping
    // stays in the one tested place that already owns it.
    const assembly = assembleDiscoverRifff(
      `${draft.name} · ${stem.name}`,
      [{ stem: stemFromClimax(stem), gain: stem.gain }],
      state.bpm
    )
    if (assembly === null) continue

    rifffs.push(assembly.rifff)
    Object.assign(vol, assembly.vol)
    const groupId = assembly.rifff.groupId
    placedGroupIds[stem.path] = groupId

    const lane = lanes[stem.path]
    if (lane !== undefined) {
      // Same startBar PLACE_LOOP_ON_TIMELINE just used -- this only changes
      // which row the clip lives on.
      afterPlacement.push({ type: 'MOVE_TO_CHANNEL', groupId, startBar, channelId: lane })
    }
    afterPlacement.push({ type: 'SET_PLAYED_BARS', key: groupId, bars: draft.bars })
  }

  if (rifffs.length === 0) return { startBar, actions: [], placedGroupIds }

  return {
    startBar,
    actions: [{ type: 'PLACE_LOOP_ON_TIMELINE', stems: rifffs, startBar, vol }, ...afterPlacement],
    placedGroupIds
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/coachSectionPlacement.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/coachSectionPlacement.ts \
  src/renderer/src/state/coachSectionPlacement.test.ts
git commit -m "$(cat <<'EOF'
A section goes down as ordinary clips, one row per stem

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 9: The section bridge and the preview

Two small renderer pieces: the imperative wire from the bubble's move buttons into the panel, and the engine preview.

**Files:**
- Create: `src/renderer/src/state/coachSectionBridge.ts`
- Create: `src/renderer/src/state/coachSectionBridge.test.ts`
- Modify: `src/shared/engineOwnership.ts`
- Create: `src/renderer/src/state/useCoachSectionPreview.ts`

- [ ] **Step 1: Write the failing bridge test**

Create `src/renderer/src/state/coachSectionBridge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerCoachSectionOp,
  requestCoachSectionOp,
  resetCoachSectionBridge
} from './coachSectionBridge'

describe('coachSectionBridge', () => {
  beforeEach(() => resetCoachSectionBridge())

  it('routes a request to the registered panel', () => {
    const handler = vi.fn()
    registerCoachSectionOp(handler)
    requestCoachSectionOp('preview')
    expect(handler).toHaveBeenCalledWith('preview')
  })

  it('drops a request with no panel mounted rather than queueing it', () => {
    // Unlike the Discover bridge, there is nothing to open and wait for:
    // the panel is on screen exactly when these steps are current, so a
    // request that arrives with no handler is a request that should not
    // have been made.
    expect(() => requestCoachSectionOp('place')).not.toThrow()
  })

  it('a late teardown never unregisters the live panel', () => {
    const first = vi.fn()
    const second = vi.fn()
    const teardownFirst = registerCoachSectionOp(first)
    registerCoachSectionOp(second)
    teardownFirst()
    requestCoachSectionOp('drop-suggested')
    expect(second).toHaveBeenCalledWith('drop-suggested')
    expect(first).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachSectionBridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the bridge**

Create `src/renderer/src/state/coachSectionBridge.ts`:

```ts
/**
 * The one imperative wire from sssketchy's bubble into the phase-two panel.
 *
 * Same shape, and the same reason, as ./coachDiscoverBridge.ts: the bubble's
 * "stuck?" list and "do it for me" offer the step's own moves, and phase
 * two's moves are buttons only SssketchySectionPanel can press (they close
 * over the engine preview, the current AppState and the placement builder).
 *
 * No queue, unlike the Discover bridge: there is nothing to open and wait
 * for. The panel is mounted exactly while p2-first/p2-section/p2-next are
 * current, so a request that finds no handler is a request that should not
 * have been made, and dropping it is better than storing it for a panel
 * that may open on a different section.
 *
 * Module-level mutable state, like the resolved-candidate and peak caches
 * elsewhere in the renderer -- with the same dev-only wrinkle Vite's Fast
 * Refresh brings: editing THIS file resets `handler` to null until the panel
 * remounts.
 */

import type { CoachSectionOp } from '@shared/coachSections'

export type CoachSectionOpHandler = (op: CoachSectionOp) => void

let handler: CoachSectionOpHandler | null = null

/** Called by SssketchySectionPanel on mount. Returns its own teardown, which
 * only clears the registration if it is still the current one -- React can
 * mount the next instance before unmounting the previous one (Strict Mode),
 * and a late teardown must not unregister the live panel. */
export function registerCoachSectionOp(next: CoachSectionOpHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function coachSectionPanelIsOpen(): boolean {
  return handler !== null
}

/** Presses one of the panel's own buttons, if it is on screen. */
export function requestCoachSectionOp(op: CoachSectionOp): void {
  handler?.(op)
}

/** Tests only. */
export function resetCoachSectionBridge(): void {
  handler = null
}
```

- [ ] **Step 4: Run the bridge test to verify it passes**

Run: `npx vitest run src/renderer/src/state/coachSectionBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the third engine owner**

In `src/shared/engineOwnership.ts`, widen the union and extend its doc comment:

```ts
/** Who currently owns what gets sent to the native engine -- 'discover-
 * preview' is DiscoverPanel.tsx's own throwaway single-rifff preview
 * project (docs/superpowers/specs/2026-09-15-discover-native-engine-
 * preview-design.md); 'stem-solo-preview' is useStemPreviewPlayback.ts's
 * own SOLO_STEMS-based preview, shared by both Tidy Up
 * (ClusterStemsBrowser.tsx) and Auto Arrange (AutoArrangeRoleStep.tsx) --
 * those two never run at once (both are full-screen modals, opening one
 * closes the other), so one owner id safely covers both callers.
 * 'coach-section-preview' is the guided flow's own "loop just this section"
 * (useCoachSectionPreview.ts): the same throwaway-project shape as
 * 'discover-preview', but built from the locked climax's kept stems rather
 * than from Discover's slots, and never live at the same time as either of
 * the others (phase two runs on the timeline, with Discover closed). */
export type EngineOwner = 'discover-preview' | 'stem-solo-preview' | 'coach-section-preview'
```

- [ ] **Step 6: Write the preview hook**

Create `src/renderer/src/state/useCoachSectionPreview.ts`:

```ts
/**
 * "then preview (loops just that section)" (spec).
 *
 * The same throwaway-project trick DiscoverPanel.tsx's syncPreviewToEngine
 * uses, at a fraction of the size because nothing here rerolls, resolves or
 * changes underneath the send: build a one-rifff AppState from the section's
 * kept stems, hand it to the engine under a claim, play from bar 0.
 *
 * Why the loop is exactly the section: the only clip starts at bar 0, and
 * loopLengthBars(state) (selectors.ts) is the furthest placed end -- which,
 * with playedBars set to the section's length, IS the section's length. So
 * the native transport wraps at the end of the section without anything
 * here having to watch the position.
 *
 * Ownership follows the established rules (see @shared/engineOwnership):
 * claim synchronously before the first await, re-check stillOwn after every
 * await before applying anything, and release on stop or unmount so
 * StoreContext's coalesced sync puts the real project back.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildEngineProject } from '@shared/buildEngineProject'
import { sectionKeptStems, type CoachSectionDraft } from '@shared/coachSections'
import type { LockedClimax } from '@shared/coachClimax'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { initialState, type AppState } from './store'
import { useAppSelector, useDispatch, useEngineOwnership, usePluginCatalog } from './StoreContext'

export interface CoachSectionPreview {
  /** A section preview is currently loaded in the engine. */
  previewing: boolean
  /** The project is being built/sent -- what makes sssketchy climb. */
  building: boolean
  previewSection: (climax: LockedClimax, draft: CoachSectionDraft) => Promise<void>
  stopPreview: () => void
}

export function useCoachSectionPreview(): CoachSectionPreview {
  const dispatch = useDispatch()
  const bpm = useAppSelector((s) => s.bpm)
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const pluginCatalog = usePluginCatalog()
  const {
    claim: claimEngine,
    stillOwn: stillOwnEngine,
    release: releaseEngine
  } = useEngineOwnership()

  const [previewing, setPreviewing] = useState(false)
  const [building, setBuilding] = useState(false)
  // Set in the cleanup below, read after every await -- the component can
  // unmount (the step advances, the flow is dismissed) while a build is
  // still in flight, and a late send must not reach the engine.
  const unmountedRef = useRef(false)
  const previewingRef = useRef(false)

  const stopPreview = useCallback((): void => {
    if (!previewingRef.current) return
    previewingRef.current = false
    setPreviewing(false)
    dispatch({ type: 'PAUSE' })
    // Releasing is enough to hand the engine back: StoreContext's coalesced
    // sync goes dirty and re-checks every frame, so the real project loads
    // itself once nobody owns the engine.
    releaseEngine()
  }, [dispatch, releaseEngine])

  useEffect(() => {
    // Assigned in the setup body, not only in the ref initialiser: this app
    // runs under StrictMode, which mounts every component with an extra
    // setup -> cleanup -> setup cycle in development (same gotcha
    // useStemPreviewPlayback.ts documents).
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      if (previewingRef.current) {
        previewingRef.current = false
        dispatch({ type: 'PAUSE' })
        releaseEngine()
      }
    }
  }, [dispatch, releaseEngine])

  const previewSection = useCallback(
    async (climax: LockedClimax, draft: CoachSectionDraft): Promise<void> => {
      const kept = sectionKeptStems(climax, draft.droppedPaths)
      if (kept.length === 0) return

      // Claimed synchronously, before the first await, so there is no window
      // in which the coalesced real-project sync could observe a free
      // engine and overwrite this.
      const token = claimEngine('coach-section-preview')
      setBuilding(true)
      try {
        // maxMembers uncapped: this is a throwaway preview project with no
        // StemCID_1..8 schema to fit into, and a locked climax can carry
        // more than eight stems (same real bug DiscoverPanel's own preview
        // call documents). barLengthOverride is the climax's own length, so
        // shorter members tile rather than shortening the loop.
        const assembly = assembleDiscoverRifff(
          `${draft.name} preview`,
          kept.map((stem) => ({
            stem: {
              author: stem.author,
              name: stem.name,
              type: stem.type,
              path: stem.path,
              durationSec: stem.durationSec,
              barLength: stem.barLength
            },
            gain: stem.gain
          })),
          bpm,
          kept.length,
          climax.barLength
        )
        if (assembly === null) return

        const { rifff, vol } = assembly
        const previewState: AppState = {
          ...initialState,
          bpm,
          masterChain,
          channelPlugins,
          rifffs: { [rifff.groupId]: { ...rifff, startBar: 0 } },
          vol,
          stretch: { [rifff.groupId]: true },
          // What makes the engine's own loop exactly this section long.
          playedBars: { [rifff.groupId]: draft.bars }
        }

        const project = await buildEngineProject(
          previewState,
          resolveStretchedForPlayback,
          pluginCatalog
        )
        if (unmountedRef.current || !stillOwnEngine(token)) return

        await window.rifffApi.engineLoadProject(project)
        if (unmountedRef.current || !stillOwnEngine(token)) return

        previewingRef.current = true
        setPreviewing(true)
        await window.rifffApi.engineSetPosition(0)
        dispatch({ type: 'PLAY' })
      } catch (err) {
        console.error('useCoachSectionPreview: preview failed:', err)
        // Nothing reached the engine, so this claim must not dangle --
        // otherwise the real project's own sync stays gated off forever.
        if (!previewingRef.current) releaseEngine()
      } finally {
        if (!unmountedRef.current) setBuilding(false)
      }
    },
    [bpm, channelPlugins, claimEngine, dispatch, masterChain, pluginCatalog, releaseEngine,
      stillOwnEngine]
  )

  return { previewing, building, previewSection, stopPreview }
}
```

There is no unit test for this hook — it needs a live engine and a React tree (CLAUDE.md, "Testing conventions"). It is verified by typecheck, lint and the manual walkthrough.

- [ ] **Step 7: Typecheck, lint and run the whole suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: green. If `engineSetPosition`'s signature differs from the call above, match `DiscoverPanel.tsx`'s own usage (`void window.rifffApi.engineSetPosition(0)`) rather than inventing one.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/coachSectionBridge.ts \
  src/renderer/src/state/coachSectionBridge.test.ts \
  src/renderer/src/state/useCoachSectionPreview.ts src/shared/engineOwnership.ts
git commit -m "$(cat <<'EOF'
One wire into the panel, and a loop of just this section

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 10: The section panel

The whole interactive surface of phase two. **No component test** (CLAUDE.md) — typecheck, lint, and the manual walkthrough.

**Files:**
- Create: `src/renderer/src/components/SssketchySectionPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/renderer/src/components/SssketchySectionPanel.tsx`:

```tsx
import { useCallback, useEffect } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { useCoachSectionPreview } from '../state/useCoachSectionPreview'
import { registerCoachSectionOp } from '../state/coachSectionBridge'
import { buildCoachSectionActions } from '../state/coachSectionPlacement'
import { typeColorVar } from '../theme/typeColor'
import {
  COACH_DROP_SUGGESTED_LABEL,
  COACH_SECTION_BAR_NUDGES,
  COACH_SUGGESTED_DROP_HINT,
  coachSectionTypeDef,
  isSuggestedDrop,
  nextSectionTypeSuggestions,
  suggestedDropPaths,
  type CoachSectionOp,
  type CoachSectionType
} from '@shared/coachSections'
import { slotKindsLabel } from '@shared/discoverSlotKind'

const PANEL_WIDTH = 320

const buttonStyle: React.CSSProperties = {
  height: 20,
  borderRadius: 0,
  padding: '0 8px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

/**
 * Phase two's own surface: pick a section, carve it, put it down.
 *
 * THE RULE THIS COMPONENT RENDERS (spec): **every stem is on, and the user
 * subtracts.** Each stem row is a checkbox that starts CHECKED. A stem this
 * section type usually loses gets a quiet hint next to it and nothing else
 * -- it is still checked, still playing. The one bulk action is the "drop
 * the suggested ones" button, which is a click, not a default.
 *
 * Nothing in here may pre-apply the suggestion table. The draft arrives from
 * the store with droppedPaths empty and only ever changes through the three
 * dispatches below.
 *
 * Deliberately a separate component from SssketchyCoach's bubble rather than
 * more buttons inside it: the bubble carries one thought and four verbs
 * (spec), and a stem list with toggles is not a thought. They sit on
 * opposite bottom corners so they never overlap.
 */
export function SssketchySectionPanel(): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const { previewing, previewSection, stopPreview } = useCoachSectionPreview()

  const climax = coach?.lockedClimax ?? null
  const draft = coach?.draftSection ?? null
  const stepId = coach?.stepId

  const handlePlace = useCallback((): void => {
    if (coach === null || climax === null || draft === null) return
    const built = buildCoachSectionActions(state, climax, draft, coach.sections)
    stopPreview()
    // ONE batch: the clips and the flow's record of the section become one
    // undo step -- "one undo step per section" (spec). See history.ts.
    dispatch({
      type: 'BATCH',
      actions: [
        ...built.actions,
        {
          type: 'COACH_PLACE_SECTION',
          now: Date.now(),
          startBar: built.startBar,
          placedGroupIds: built.placedGroupIds
        }
      ]
    })
  }, [climax, coach, dispatch, draft, state, stopPreview])

  const runOp = useCallback(
    (op: CoachSectionOp): void => {
      if (op === 'drop-suggested') {
        dispatch({ type: 'COACH_DROP_SUGGESTED_STEMS' })
        return
      }
      if (op === 'preview') {
        if (previewing) stopPreview()
        else if (climax !== null && draft !== null) void previewSection(climax, draft)
        return
      }
      handlePlace()
    },
    [climax, dispatch, draft, handlePlace, previewSection, previewing, stopPreview]
  )

  // The bubble's "do it for me"/"stuck?" moves reach these same three
  // buttons through the bridge -- see coachSectionBridge.ts.
  useEffect(() => registerCoachSectionOp(runOp), [runOp])

  if (coach === null || coach.status !== 'active' || climax === null) return null
  if (stepId !== 'p2-first' && stepId !== 'p2-section' && stepId !== 'p2-next') return null

  function startSection(type: CoachSectionType): void {
    stopPreview()
    dispatch({ type: 'COACH_START_SECTION', now: Date.now(), sectionType: type })
  }

  const suggestions = nextSectionTypeSuggestions(coach.sections)

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 12,
        width: PANEL_WIDTH,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        borderRadius: 0,
        padding: 'var(--ra-s-6)',
        zIndex: 'var(--ra-z-anchored)',
        boxShadow: 'var(--ra-shadow-popover)'
      }}
    >
      {stepId !== 'p2-section' && (
        <>
          <div className="ra-eyebrow">
            {stepId === 'p2-first' ? 'what comes first' : 'what comes next'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-5)' }}>
            {suggestions.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => startSection(type)}
                style={buttonStyle}
              >
                {coachSectionTypeDef(type).label}
              </button>
            ))}
          </div>
          {stepId === 'p2-next' && (
            <div style={{ marginTop: 'var(--ra-s-5)', fontSize: 10, color: 'var(--ra-text-3)' }}>
              an outro ends this phase. skip on the bubble stops arranging and moves to polish.
            </div>
          )}
        </>
      )}

      {stepId === 'p2-section' && draft !== null && (
        <>
          <div className="ra-eyebrow">this section</div>

          <input
            value={draft.name}
            onChange={(e) => dispatch({ type: 'COACH_SET_SECTION_NAME', name: e.target.value })}
            style={{
              marginTop: 'var(--ra-s-5)',
              width: '100%',
              height: 22,
              borderRadius: 0,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)',
              fontSize: 11,
              padding: '0 6px'
            }}
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ra-s-1)',
              marginTop: 'var(--ra-s-5)'
            }}
          >
            {COACH_SECTION_BAR_NUDGES.map((delta) => (
              <button
                key={delta}
                type="button"
                onClick={() => dispatch({ type: 'COACH_NUDGE_SECTION_BARS', delta })}
                style={buttonStyle}
              >
                {delta > 0 ? `+${delta}` : `${delta}`}
              </button>
            ))}
            <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{draft.bars} bars</span>
          </div>

          <div style={{ marginTop: 'var(--ra-s-6)' }}>
            {climax.stems.map((stem) => {
              const on = !draft.droppedPaths.includes(stem.path)
              const flagged = isSuggestedDrop(draft.type, stem)
              return (
                <label
                  key={stem.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--ra-s-2)',
                    marginTop: 'var(--ra-s-1)',
                    fontSize: 10,
                    lineHeight: 'var(--ra-lh-body)',
                    color: on ? 'var(--ra-text)' : 'var(--ra-text-3)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      dispatch({ type: 'COACH_TOGGLE_SECTION_STEM', path: stem.path })
                    }
                  />
                  {/* The one colour in this panel, and the legitimate one:
                      a stem's own identity, which carries real audio
                      information. */}
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      flex: 'none',
                      background: typeColorVar(stem.type),
                      opacity: on ? 1 : 0.3
                    }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {stem.name}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                    {flagged ? COACH_SUGGESTED_DROP_HINT : slotKindsLabel(stem.kinds)}
                  </span>
                </label>
              )
            })}
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--ra-s-1)',
              marginTop: 'var(--ra-s-6)'
            }}
          >
            {/* Disabled when this section type suggests nothing -- which is
                exactly the drop, where everything plays. */}
            <button
              type="button"
              disabled={suggestedDropPaths(draft.type, climax).length === 0}
              onClick={() => runOp('drop-suggested')}
              style={{
                ...buttonStyle,
                opacity: suggestedDropPaths(draft.type, climax).length === 0 ? 0.3 : 1,
                cursor:
                  suggestedDropPaths(draft.type, climax).length === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              {COACH_DROP_SUGGESTED_LABEL}
            </button>
            <button type="button" onClick={() => runOp('preview')} style={buttonStyle}>
              {previewing ? 'stop' : 'preview'}
            </button>
            <button type="button" onClick={() => runOp('place')} style={buttonStyle}>
              put it on the timeline
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```
Expected: clean (4 known warnings). Two things to watch for and fix if they appear: an implicit `any` on an inline handler parameter (annotate it), and `react-hooks/set-state-in-effect` (there is no `setState` in an effect here — the only effect is the bridge registration, which returns its teardown).

- [ ] **Step 3: Run the whole suite**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SssketchySectionPanel.tsx
git commit -m "$(cat <<'EOF'
Every stem on, a hint on the ones this section usually loses

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 11: Wiring it in

**Read Finding 5 before starting.** `SssketchyCoach.tsx` and `App.tsx` are being changed by another agent right now (phase 1's Tasks 10–13). **Re-read both files first** and apply the behaviour below to whatever actually shipped, rather than pasting over a file that has moved on. No component tests (CLAUDE.md).

**Files:**
- Modify: `src/renderer/src/components/SssketchyCoach.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Give the timeline its anchor**

In `src/renderer/src/App.tsx`, the arranger's scrolling timeline container is the `div` carrying `ref={scrollContainerRef}` and `onWheel={handleTimelineWheel}` (around line 2442, wrapping `<Timeline …/>`). Add one attribute to it:

```tsx
            <div
              ref={scrollContainerRef}
              data-coach-anchor="timeline"
              onWheel={handleTimelineWheel}
              style={{ height: '100%', overflowX: 'auto', overflowY: 'auto' }}
            >
```

This is what `TIMELINE` in `coachSteps.ts` (Task 2) looks up, and what makes sssketchy **walk** from Discover to the timeline when phase one ends — the anchor selector changes, `useAnchorLeft` returns a different left, and `usePulse` plays the walk.

- [ ] **Step 2: Render the panel**

In `src/renderer/src/components/SssketchyCoach.tsx`, the exported `SssketchyCoach` gate currently returns `<SssketchyCoachPanel … />`. Render the section panel **alongside** it:

```tsx
  return (
    <>
      <SssketchySectionPanel />
      <SssketchyCoachPanel … />
    </>
  )
```

`SssketchySectionPanel` gates itself entirely (it returns `null` unless there is an active flow on a phase-two step with a locked climax), so nothing here needs to know about phase two. Do **not** move it inside `SssketchyCoachPanel` — that component holds all the bubble's hooks and the panel must not re-render on the coarse clock tick.

- [ ] **Step 3: Use the phase-two line**

Wherever the bubble computes the line it shows — after phase 1's Task 12 that is `coachLineFor(coach, slots)` — prefer the phase-two line when there is one:

```tsx
const line = coachSectionLine(coach) ?? coachLineFor(coach, slots)
```

`coachSectionLine` (`@shared/coachPhase2`) returns `null` on every step that is not `p2-section`/`p2-next`, so phase one is untouched. One string still, in one place: nothing stacks.

- [ ] **Step 4: Route the section moves**

Phase 1's Task 11/12 added a handler that switches on a `CoachMoveAction`'s `kind` (`'add-slot'` → `requestCoachAddSlot`, `'lock-climax'` → dispatch `COACH_LOCK_CLIMAX`). Add the third case:

```ts
      case 'section-op':
        requestCoachSectionOp(action.op)
        break
```

importing `requestCoachSectionOp` from `../state/coachSectionBridge` (or `./state/coachSectionBridge` from `App.tsx`). The switch must stay exhaustive — if it has a `never` default, this case is required for typecheck to pass.

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: green, with the 4 known lint warnings and no new ones.

**Say plainly in your report that no UI behaviour was tested** — this environment has no GUI or audio tooling. What was verified is typecheck, lint and the pure logic's own tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SssketchyCoach.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
He walks to the timeline, and the panel opens where he stands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 12: Whole-suite verification

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npx vitest run && npm run typecheck && npm run lint
```
Expected: suite green, typecheck clean, lint at exactly its 4 pre-existing prettier warnings in unrelated files. Any new warning is yours — fix it.

- [ ] **Step 2: Confirm nothing native changed**

```bash
git diff --stat master -- native-engine/
```
Expected: no output. This plan touches no C++ and requires no engine rebuild.

- [ ] **Step 3: Confirm the old placeholder is really gone**

```bash
grep -rn "'sections'" src | grep -v node_modules
```
Expected: no hits.

- [ ] **Step 4: Confirm the rule is not quietly broken**

```bash
grep -rn "suggestedDropPaths\|COACH_SECTION_DROP_SETS" src | grep -v test
```
Expected: exactly four production hits — the table and `isSuggestedDrop`/`suggestedDropPaths` in `coachSections.ts`, the single call in `dropSuggestedCoachSectionStems` (`coachPhase2.ts`), and the panel's own button-disabled check and per-row hint (`SssketchySectionPanel.tsx`). **If any constructor, reducer case or `useState` initialiser is in that list, the everything-on rule has been broken** — see Finding 1.

---

## Manual walkthrough (for Elling — an agent cannot do this)

Run `npm run dev`. A renderer reload is enough; nothing native changed.

1. Start the flow from the project-menu **sssketchy** button and run phase one to the end (or open a project that already has a locked climax). Press **lock the loop in**.
2. Press **next** past the lock-in step. He should **walk** from Discover's add row to the timeline, and a panel should appear in the **bottom-right** asking *what comes first* with **intro** and **build**.
3. Choose **intro**. Check the stem list: **every stem is ticked**. Harmony and the hook should carry a quiet "usually out here" — and still be **ticked**. Nothing has been removed.
4. Rename it, nudge the length with −8/−4/+4/+8, and confirm it clamps at 4 bars and 64.
5. Press **preview**. You should hear just those stems, looping at exactly the section's length. Press **stop**; playback should return to the real project.
6. Press **drop the suggested ones**. *Now* harmony and the hook untick. Tick one back on by hand.
7. Press **put it on the timeline**. Check: one clip per kept stem, each on its own row, all starting at the same bar and spanning the section's length. Then press **Cmd+Z once** — the whole section should vanish in one step, and the panel should go back to the section you were carving.
8. Redo/replace it, then keep going: **build → drop → breakdown → outro**. Confirm each new section starts exactly where the previous one ended, and that a stem that appeared in section 1 lands **on the same row** in section 3 (not a new row), with a visible gap in its row wherever you subtracted it.
9. Build a **drop** section: "drop the suggested ones" should be **disabled** — a drop loses nothing.
10. Choose **outro**, build and place it. The flow should jump straight to the phase-three step; the panel should disappear.
11. Save, quit, reopen. Press the sssketchy button: the flow resumes where it was, with its sections remembered, and the timeline unchanged.
12. Somewhere in the middle: drag one of the placed clips, resize it, ungroup it, delete it. It must behave exactly like a hand-made clip — that is the whole point of placing through the arranger's own actions.

## Known limits, written down on purpose

- **`buildArrangeReplaceActions` is not literally called.** It replaces clips that already exist and deletes their sources; phase two builds from a value, section by section. Task 8 uses the same three actions it emits, in the same order, with its own channel-continuity trick, and produces the same kind of result — ordinary clips. Finding 6 has the full reasoning. If a future change makes a "rebuild the whole arrangement from the coach's sections" command worth having, *that* is where `buildArrangeReplaceActions` fits naturally.
- **sssketchy does not climb while a section builds.** Placement is synchronous and the preview build takes about a second; `working` stays whatever phase 1 set it to. Wiring the preview hook's `building` flag through to the bubble's animation would need a third channel between two components that otherwise share nothing, and the panel already shows what it is doing.
- **A bare `leadesque` stem is not flagged in a build.** The app cannot tell a plain lead apart from the hook, so it says nothing rather than guessing. One extra click, versus an assertion the app has not earned.
- **A chonky (bassHeavy) stem is not flagged in a breakdown.** Same reason: Discover tagged it as a trait, not as the bass.
- **The suggested-drop table is a table, not analysis.** It knows what kinds of section usually lose what kinds of stem. It has never heard your track, and every one of its marks is ignorable at zero cost.
- **Sections are contiguous by the coach's own arithmetic.** If you drag a placed section somewhere else, the flow still starts the next one after where it *put* the last one. That keeps the guided sequence predictable; rearranging afterwards is ordinary arranger work.
- **No component tests.** `SssketchySectionPanel.tsx`, `useCoachSectionPreview.ts` and the `SssketchyCoach.tsx`/`App.tsx` wiring are verified by typecheck, lint and the pure logic's tests, then by the walkthrough above. This environment has no GUI or audio tooling and an agent cannot click through the app.
