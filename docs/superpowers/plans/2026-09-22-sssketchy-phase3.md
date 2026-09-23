# sssketchy Phase 3 — finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the guided flow's `'finish'` placeholder into the real phase three: at every section boundary whose two **names** ask for it, sssketchy offers the built-in toolkit — a filter sweep and a swell into a drop, a fade into a breakdown, and a riser at every build→drop — each as a toggle that is **off until you click it**, with a listen button; then a balance check that plays the whole track; then a hand-off to the existing export picker, after which the project is marked **v1 exported** and he does his big jump.

**Architecture:** Every decision is a pure table or function in `src/shared/` — which moves a pair of section names justifies, what curve each move writes (built out of `automationEdit.ts`'s *existing* tested primitives, so the result is byte-identical to a hand-drawn shift-drag or a dragged edge-fade grabber), where a riser goes, and the two new `CoachState` fields. The renderer half is four thin pieces: a tested action builder that turns one offer into real `SET_GROUP_AUTOMATION` / `ADD_RISER` actions, two imperative bridges of the kind phases 1 and 2 already established, and one new panel component. **No native-engine changes at all** — the engine already renders filter curves, volume curves and risers, and the export paths already bake them.

**Tech Stack:** TypeScript, React 19, Electron renderer, vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-sssketchy-guided-track-design.md` — build order step 4, the section headed `## Phase 3 — finish` (**revised 2026-09-22 to add the riser bullet; that revision is half of this plan**).

**Toolkit spec this phase drives:** `docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md` — read sections 2b, 2c and 2d before Task 1. Its build order ends with *"Then sssketchy's tension pass uses all of it."* This is that.

**Previous plans:** `docs/superpowers/plans/2026-09-22-sssketchy-framework.md` (build order 1), `…-phase1.md` (2) and `…-phase2.md` (3). Read phase 2's "Findings" section before starting; everything it established still holds.

---

## Findings that shaped this plan (read these first)

1. **THE GOVERNING RULE — sssketchy asserts nothing about whether the music is good.** Every offer in this phase is justified by a **name the user themselves typed**. A riser is offered at a build→drop boundary *because the next section is literally called "drop"* — that is a fact about the arrangement, not a judgement about the audio. A fade is offered into a section called "breakdown" for the same reason.

   The test for whether a new offer belongs here: **could the app be wrong about it without hearing the audio?** "Is there a drop after this build?" — no, the app can read the name. "Would this track be better with a riser?" — yes, and that offer does not belong in this plan. Nothing in Task 1's tables looks at a stem, a waveform, a trait, a gain or a bar count to decide *whether* to offer something. Bar counts are used only to decide *how long* an offer is, once the names have already justified it.

   If you find yourself adding an offer keyed off anything other than the pair of `CoachSectionType`s at a boundary, stop and raise it rather than writing it.

2. **This phase is offers-first — everything OFF, the user ADDS.** Phase 2's famous rule is the opposite (*everything on, the user subtracts*) and that is correct **for stems inside a section**: a section is the full climax loop until somebody takes something out. Phase 3 puts **new material into the arrangement**. Writing a filter sweep onto somebody's clips before they asked would be the app making an edit they then have to notice and undo — exactly the failure phase 2's rule exists to prevent, just pointing the other way.

   So: every tension toggle in Task 10 renders **off**, and nothing reaches the reducer until a click. The spec's own words for this phase are *"offer to place a riser"* and *"toggle + preview each"*. **Do not "follow the phase-2 precedent" by pre-applying these.**

3. **Everything he makes is ordinary, editable material, in one undo step.** Spec, and it is stated twice. Concretely, in this phase:
   - A **riser** is created by `createRiser` from `@shared/riser` and placed by `ADD_RISER` — *the same function and the same action* the arranger's right-click "add riser here" menu item uses (`src/renderer/src/App.tsx`'s `openPasteMenu`). Afterwards it is movable (`MOVE_RISER`), resizable (`RESIZE_RISER`), its sweep redrawable in its own automation lane (`SET_RISER_CURVE`, `AutomationLane.tsx`'s `{ kind: 'riser' }` target) and removable from its own right-click menu (`openRiserMenu`). Nothing marks it as sssketchy's.
   - A **swell** and a **fade** are written by `applyEdgeFade` (`src/shared/automationEdit.ts`) — the exact function the automation lane's own edge-fade grabbers call. So the shape that lands is one the grabbers can pick straight back up and drag.
   - A **filter sweep** is written by `applyStroke(existing, rampStroke(...))` — the exact pair the lane's shift-drag straight-ramp gesture uses.
   - Every one of them goes out in a single `{ type: 'BATCH', actions: [...] }` together with the `COACH_*` action that records it, which `history.ts`'s `BATCH` branch checkpoints exactly once. One Cmd+Z takes the whole offer back off.

4. **No native-engine change is needed, and none may be introduced.** The engine already renders per-clip `filterCutoff` and `volume` curves and noise risers, live and offline (`native-engine/Source/PlaybackEngine.cpp`, `NoiseRiser.cpp`, `AutomationCurve.cpp`), and both export paths already bake or translate them (`exportToolkitAudio.ts`, `exportAbleton.ts`, `exportReaper.ts`). This plan writes **only data the toolkit already defines**. If you reach a point where a C++ change looks necessary, **stop and report it** rather than making it — the engine does not hot-reload, and touching it changes the whole build/relaunch story (CLAUDE.md).

5. **Two things are in flight while this plan is written.**
   - **Phase 2's Tasks 10–12 are not built yet**: `src/renderer/src/components/SssketchySectionPanel.tsx` does not exist, and `SssketchyCoach.tsx` / `App.tsx` do not yet render or route to it. Tasks 1–9 of this plan touch none of that. Tasks 10–11 do, and are written as **behaviour plus exact integration points**, not as pasteable diffs.
   - **Another agent is fixing review findings in `coach.ts`, `coachSteps.ts`, `history.ts`, `App.tsx` and `SssketchyCoach.tsx` right now.** **Re-read every one of those files immediately before editing it.** Quoted line numbers in this plan are orientation, not addresses.

6. **`handleCoachMove` in `App.tsx` is currently an `if` with a fallthrough**: `if (action.kind === 'add-slot') { … return }` and then an unconditional `COACH_LOCK_CLIMAX` dispatch, which means *any* unrecognised move kind re-locks the climax. **Phase 2's Task 11 restructures it into an exhaustive `switch` with a `never` default.** This plan's Task 11 **depends on that restructure existing**. If you arrive and it is still an `if`, do the restructure first (it is a strict improvement and phase 2 already specified it) and say so in your report — do not bolt three new kinds onto a fallthrough that silently re-locks the climax.

7. **Copy rules, unchanged.** Lowercase, no emoji, no exclamation marks, 3–4 hand-written variants per line, chosen with `pickLineVariant(table, state.lineSeed)` — **never `Math.random`** (`src/shared/coachLines.ts` explains why: a random pick rewrites the bubble under the reader on every re-render, and no test could pin a string). The existing copy avoids contractions ("that is", "there is") — match it. Labels *on controls* (the toggle names, the hint under each) are flat and unrotated, like `COACH_SUGGESTED_DROP_HINT` already is: they are labels, not something he says.

8. **React components are not unit-tested in this codebase** (CLAUDE.md, "Testing conventions"). Task 10 and Task 11 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, and then by Elling's manual walkthrough (Task 12). This environment has no GUI or audio tooling — **do not claim any UI or audio behaviour was tested.**

9. **New `CoachState` fields persist for free, and must survive a pre-phase-3 project.** `serializeProject` rest-destructures the transient fields and stringifies the rest; `deserializeProject` builds `{ ...initialState, ...projectData }` and then runs `sanitiseLoadedCoach` (`src/renderer/src/state/serialize.ts:372`). So `tension` and `v1ExportedAt` save themselves — but a project saved by the phase-1 or phase-2 build has **neither key**, and must load as `tension: []` / `v1ExportedAt: null` rather than `undefined`. That is Task 4 + Task 7, and it is exactly the pattern phase 1's Task 8 (`lockedClimax`) and phase 2's Task 7 (`sections`/`draftSection`) established.

10. **A project saved on the `'finish'` placeholder step repairs itself.** `CoachStepId` is a closed union validated on load by `isCoachStepId`; replacing `'finish'` with three real rows means a project saved mid-placeholder loads with an unknown `stepId` and is repaired back to `FIRST_COACH_STEP_ID` (`sanitiseLoadedCoach`). That is the same, accepted consequence phase 1 had when it replaced `'climax-loop'` and phase 2 had when it replaced `'sections'`. Do not add a migration; it would be a migration for a placeholder that never shipped a real step.

11. **The lead length of every offer is the outgoing section's own bar count.** The spec says a riser is *"pre-sized to the bars leading in"*. The bars leading into a drop are the section before it — its `bars`, a number **the user set** with the ±4/±8 nudges in phase 2. All four offers use that same one rule, so there is no invented constant anywhere in this phase, and capping it at some "tasteful" four bars would be precisely the kind of taste judgement finding 1 rules out. The shapes that land are grabbable afterwards (finding 3), so shortening one is a drag, not an undo. **Flag in your report if Elling wants a shorter lead** — it is a one-function change in `tensionCurveFor`/`coachRiserFieldsFor`, not a redesign.

12. **Curves are CLIP-RELATIVE and clamped to the clip.** `AutomationPoint.bar` is measured from the clip's own left edge, and nothing may sit past its right edge (toolkit spec 2b: *"don't even allow to draw beyond where the wave is"*). A phase-2 section places one single-stem clip per kept stem, sized to the section (`SET_PLAYED_BARS`), so the clip's own length **is** the section's length — but the user may have resized or cropped it since, so Task 8 reads the real length with `clipLengthBars` (`@shared/automationEdit`) off the current `state.playedBars` / `state.leftCrop` / `state.stretch`, and `tensionCurveFor` clamps the lead to it. Never assume `clipBars === section.bars`.

13. **Write per GROUP, not per stem key.** `SET_GROUP_AUTOMATION` takes a `groupId` and writes the curve to every stem in that rifff (`store.ts`'s `writeCurve`). A coach-placed section clip has exactly one stem (`assembleDiscoverRifff` assigns 1-indexed slots, and `buildCoachSectionActions` passes one member), so group and stem are the same thing here — and using the group action means Task 8 never has to know the slot number. `section.placedGroupIds` (climax stem path → groupId) is the list of clips to write to.

14. **Clearing a curve is `points: []`.** `writeCurve` deletes the parameter entry entirely for an empty list, and deletes the clip's whole record when that was its last parameter — which is what lets a cleared clip drop off the wire and take the engine's pre-toolkit path. So "toggle off" for a curve offer is one `SET_GROUP_AUTOMATION … points: []` per clip. **Known and accepted limitation, say it in the UI copy:** if the user hand-drew on top of an applied sweep, toggling it off clears their drawing too, exactly as right-clicking the lane would. Undo is the way back, not the toggle.

15. **`swell` and `fade` both write `volume`, and never collide.** A swell is only ever offered into a `drop`; a fade only ever into a `breakdown`. A boundary is one pair of names, so at most one of the two is on offer there. No merge logic is needed and none should be written.

16. **The preview is the real project, not a throwaway.** Phase 2's `useCoachSectionPreview` builds a one-rifff engine project from the *locked climax*, which by definition carries none of this phase's curves or risers. Phase 3's "listen" is simply: seek to the start of the outgoing section and play the project that is already loaded — so what you hear is literally what the export will contain. That is `dispatch({ type: 'SET_POS', pos })` plus, while playing, `markManualSeek()` + `window.rifffApi.engineSetPosition(pos)`, which is the exact shape `Ruler.tsx`'s `seekTo` and `App.tsx`'s `handleBackgroundClick` already use. **No engine-ownership claim**, because nothing throwaway is being sent.

17. **One listen button per boundary, not per toggle.** The spec says *"toggle + preview each"*. Every offer at one boundary covers the same span and is heard in the same pass over the real project, so four identical buttons would be four ways to do one thing. The panel puts the listen button on the boundary's own header row. Worth stating plainly in the report.

18. **The export step hands off to what already exists, and marks v1 only on a real write.** `ProjectMenu` (inside `App.tsx`) owns `handleExportMix`, `runExportProject`, `exportFormatPickerOpen` and `stemsFormatPickerOpen`. The coach reaches them through a bridge, exactly as it reaches Discover (`coachDiscoverBridge.ts`) and the section panel (`coachSectionBridge.ts`). The dialog-based IPC calls return `Promise<string | null>` (null = the user cancelled the save panel) and the library / next-to-source ones return `Promise<void>` (they always write) — so "did a file come out" is knowable, and `COACH_MARK_V1_EXPORTED` is dispatched only when it did.

19. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect`) — see the `usePulse` comment in `SssketchyCoach.tsx` for the established workaround — and requires an **explicit return type on every function**, including inline ones. All code below already satisfies both. `npm run lint` has **4 known pre-existing prettier warnings in unrelated files**; that is the baseline, not something this plan fixes.

20. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, `docs/design.md`): near-black shell, Silkscreen, **no `border-radius` anywhere**, colour spent only on things carrying audio information. The tension panel is monochrome throughout — an applied toggle is marked by border and text weight, not by colour.

## File map

| File | Change |
|---|---|
| `src/shared/coachTension.ts` (new) | `CoachTensionKind`, the offer table, `tensionOffersAt`, `coachSectionBoundaries`, `tensionCurveFor`, `coachRiserFieldsFor`, `CoachTensionApplied` + its helpers and load repair, the three new op unions |
| `src/shared/coachTension.test.ts` (new) | full TDD of the above, including the governing-rule assertions |
| `src/shared/coachLines.ts` | `COACH_TENSION_LINE_TEMPLATES`, `COACH_TENSION_NONE_LINES`, `COACH_V1_EXPORTED_LINES` |
| `src/shared/coachLines.test.ts` | the three new tables join the copy-rule sweep |
| `src/shared/coachSteps.ts` | `CoachMoveAction` gains `tension-op` / `transport-op` / `export-op`; the three `p3-` rows replace the `finish` placeholder; `LATER_PHASE_ORDER` |
| `src/shared/coachSteps.test.ts` | updated for the three new ids |
| `src/shared/coach.ts` | `CoachState.tension`, `CoachState.v1ExportedAt`, `startCoach`, `sanitiseLoadedCoach` |
| `src/shared/coach.test.ts` | updated for the new step ids and the two new fields |
| `src/shared/coachPhase3.ts` (new) | `applyCoachTension`, `clearCoachTension`, `markCoachV1Exported`, `coachBoundaries`, `coachPhase3Line` |
| `src/shared/coachPhase3.test.ts` (new) | full TDD of the above |
| `src/shared/coachPhase1.ts` | one line in `coachStepSatisfied` for `p3-export` |
| `src/shared/coachPhase1.test.ts` | a test for that line |
| `src/renderer/src/state/store.ts` | three `COACH_*` action types and reducer cases |
| `src/renderer/src/state/store.test.ts` | reducer tests for the three |
| `src/renderer/src/state/history.ts` | three entries in `TRANSIENT_ACTION_TYPES` |
| `src/renderer/src/state/serialize.test.ts` | round-trip of the two new fields + a pre-phase-3 project |
| `src/renderer/src/state/coachTensionApply.ts` (new) | `buildCoachTensionActions`, `buildCoachTensionRemovalActions`, `coachRiserChannelId` |
| `src/renderer/src/state/coachTensionApply.test.ts` (new) | applied against the real reducer |
| `src/renderer/src/state/coachTensionBridge.ts` (new) | `registerCoachTensionOp`, `requestCoachTensionOp`, `resetCoachTensionBridge` |
| `src/renderer/src/state/coachTensionBridge.test.ts` (new) | register/route/teardown tests |
| `src/renderer/src/state/coachExportBridge.ts` (new) | `registerCoachExport`, `requestCoachExport`, `resetCoachExportBridge` |
| `src/renderer/src/state/coachExportBridge.test.ts` (new) | register/route/teardown tests |
| `src/renderer/src/components/SssketchyTensionPanel.tsx` (new) | the phase-three boundary panel |
| `src/renderer/src/components/SssketchyCoach.tsx` | renders the panel; phase-three line; the big jump |
| `src/renderer/src/App.tsx` | three cases in `handleCoachMove`; `ProjectMenu` registers the export bridge and marks v1 on a real write |

## Commands used throughout (run from the repo root, `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/coachTension.test.ts   # one file
npx vitest run                                   # the whole suite
npm run typecheck                                # tsc, node + web configs
npm run lint                                     # eslint --cache . (4 known prettier warnings)
```

Prettier settings the code below already follows: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

**Before Task 1, make your own first commit** (even an empty one: `git commit --allow-empty -m "chore: phase 3 start marker"`) — the native-engine check in Task 12 diffs against **your first commit**, not `master`, because this branch already carries unrelated earlier C++ work.

---

### Task 1: The tension tables

The whole musical content of phase three, as data: which moves a **pair of section names** justifies, how long each one is, and what shape it writes. Pure, no state, no React.

**Files:**
- Create: `src/shared/coachTension.ts`
- Create: `src/shared/coachTension.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachTension.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CoachSection } from './coachSections'
import {
  COACH_SWEEP_END_VALUE,
  COACH_SWEEP_START_VALUE,
  COACH_TENSION_KINDS,
  appliedTensionRiserId,
  coachRiserFieldsFor,
  coachSectionBoundaries,
  coachTensionDef,
  isCoachTensionKind,
  lastAppliedRiserId,
  sanitiseCoachTension,
  tensionCurveFor,
  tensionIsApplied,
  tensionOffersAt,
  type CoachTensionApplied
} from './coachTension'

function section(over: Partial<CoachSection> & Pick<CoachSection, 'type'>): CoachSection {
  return {
    name: over.type,
    bars: 16,
    droppedPaths: [],
    startBar: 0,
    placedGroupIds: {},
    ...over
  }
}

describe('tensionOffersAt', () => {
  it('offers a sweep and a swell into anything named drop', () => {
    expect(tensionOffersAt('breakdown', 'drop')).toEqual(['filter-sweep', 'swell'])
    expect(tensionOffersAt('intro', 'drop')).toEqual(['filter-sweep', 'swell'])
  })

  it('adds the riser only at a build into a drop -- the spec names that pair', () => {
    expect(tensionOffersAt('build', 'drop')).toEqual(['filter-sweep', 'swell', 'riser'])
  })

  it('offers a fade into anything named breakdown', () => {
    expect(tensionOffersAt('drop', 'breakdown')).toEqual(['fade'])
  })

  it('offers nothing when neither name asks for anything', () => {
    expect(tensionOffersAt('intro', 'build')).toEqual([])
    expect(tensionOffersAt('drop', 'outro')).toEqual([])
    expect(tensionOffersAt('breakdown', 'build')).toEqual([])
  })

  it('never offers a swell and a fade at the same boundary -- they share one lane', () => {
    const types = ['intro', 'build', 'drop', 'breakdown', 'outro'] as const
    for (const from of types) {
      for (const into of types) {
        const offers = tensionOffersAt(from, into)
        expect(offers.includes('swell') && offers.includes('fade')).toBe(false)
      }
    }
  })
})

describe('coachSectionBoundaries', () => {
  const sections: CoachSection[] = [
    section({ type: 'intro', bars: 8, startBar: 0 }),
    section({ type: 'build', bars: 16, startBar: 8 }),
    section({ type: 'drop', bars: 16, startBar: 24 }),
    section({ type: 'outro', bars: 8, startBar: 40 })
  ]

  it('skips boundaries nothing is offered at, rather than listing empty rows', () => {
    expect(coachSectionBoundaries(sections).map((b) => b.index)).toEqual([1])
  })

  it('measures the join and the lead off the OUTGOING section', () => {
    const [boundary] = coachSectionBoundaries(sections)
    expect(boundary.from).toBe('build')
    expect(boundary.into).toBe('drop')
    expect(boundary.bar).toBe(24)
    expect(boundary.leadBars).toBe(16)
    expect(boundary.offers).toEqual(['filter-sweep', 'swell', 'riser'])
  })

  it('carries the names the user gave, for the panel to print', () => {
    const named = [
      section({ type: 'build', name: 'the long one', bars: 16, startBar: 0 }),
      section({ type: 'drop', name: 'the big one', bars: 16, startBar: 16 })
    ]
    const [boundary] = coachSectionBoundaries(named)
    expect(boundary.fromName).toBe('the long one')
    expect(boundary.intoName).toBe('the big one')
  })

  it('has no boundaries at all for one section, or none', () => {
    expect(coachSectionBoundaries([section({ type: 'drop' })])).toEqual([])
    expect(coachSectionBoundaries([])).toEqual([])
  })
})

describe('tensionCurveFor', () => {
  it('writes a swell as a plain fade in over the lead', () => {
    expect(tensionCurveFor('swell', [], { leadBars: 16, clipBars: 16 })).toEqual([
      { bar: 0, value: 0 },
      { bar: 16, value: 1 }
    ])
  })

  it('writes a fade as a plain fade out over the lead', () => {
    expect(tensionCurveFor('fade', [], { leadBars: 8, clipBars: 8 })).toEqual([
      { bar: 0, value: 1 },
      { bar: 8, value: 0 }
    ])
  })

  it('writes a sweep as a ramp ending wide open on the join', () => {
    expect(tensionCurveFor('filter-sweep', [], { leadBars: 16, clipBars: 16 })).toEqual([
      { bar: 0, value: COACH_SWEEP_START_VALUE },
      { bar: 16, value: COACH_SWEEP_END_VALUE }
    ])
  })

  it('clamps the lead to the clip, so a resized clip never gets a point past its end', () => {
    const points = tensionCurveFor('filter-sweep', [], { leadBars: 16, clipBars: 8 })
    expect(points).toEqual([
      { bar: 0, value: COACH_SWEEP_START_VALUE },
      { bar: 8, value: COACH_SWEEP_END_VALUE }
    ])
  })

  it('leaves a hand-drawn point outside the lead alone', () => {
    const existing = [
      { bar: 0, value: 0.5 },
      { bar: 2, value: 0.5 }
    ]
    const points = tensionCurveFor('filter-sweep', existing, { leadBars: 4, clipBars: 8 })
    expect(points?.[0]).toEqual({ bar: 0, value: 0.5 })
    expect(points?.[points.length - 1]).toEqual({ bar: 8, value: COACH_SWEEP_END_VALUE })
  })

  it('has no curve for a riser -- a riser is a clip, not an envelope', () => {
    expect(tensionCurveFor('riser', [], { leadBars: 16, clipBars: 16 })).toBeNull()
  })

  it('returns null rather than a degenerate curve for a zero-length clip', () => {
    expect(tensionCurveFor('swell', [], { leadBars: 16, clipBars: 0 })).toBeNull()
  })
})

describe('coachRiserFieldsFor', () => {
  it('lands the riser on the join, pre-sized to the bars leading in', () => {
    expect(coachRiserFieldsFor({ bar: 24, leadBars: 16 })).toEqual({
      startBar: 8,
      lengthBars: 16
    })
  })

  it('never starts before bar zero', () => {
    expect(coachRiserFieldsFor({ bar: 4, leadBars: 16 }).startBar).toBe(0)
  })
})

describe('the applied record', () => {
  const applied: CoachTensionApplied[] = [
    { sectionIndex: 1, kind: 'filter-sweep', riserId: null },
    { sectionIndex: 1, kind: 'riser', riserId: 'riser-a' },
    { sectionIndex: 3, kind: 'riser', riserId: 'riser-b' }
  ]

  it('reports what is on at one boundary', () => {
    expect(tensionIsApplied(applied, 1, 'filter-sweep')).toBe(true)
    expect(tensionIsApplied(applied, 1, 'swell')).toBe(false)
    expect(tensionIsApplied(applied, 2, 'filter-sweep')).toBe(false)
  })

  it('finds the riser one boundary put down, so taking it off removes that one', () => {
    expect(appliedTensionRiserId(applied, 1)).toBe('riser-a')
    expect(appliedTensionRiserId(applied, 2)).toBeNull()
  })

  it('names the most recent riser, which is the row later ones join', () => {
    expect(lastAppliedRiserId(applied)).toBe('riser-b')
    expect(lastAppliedRiserId([])).toBeNull()
  })
})

describe('sanitiseCoachTension', () => {
  it('turns a missing field into an empty list rather than undefined', () => {
    expect(sanitiseCoachTension(undefined)).toEqual([])
    expect(sanitiseCoachTension(null)).toEqual([])
    expect(sanitiseCoachTension('nope')).toEqual([])
  })

  it('drops entries with an unknown kind or a nonsense index rather than guessing', () => {
    expect(
      sanitiseCoachTension([
        { sectionIndex: 0, kind: 'sidechain', riserId: null },
        { sectionIndex: -1, kind: 'swell', riserId: null },
        { sectionIndex: 1.5, kind: 'swell', riserId: null },
        { sectionIndex: 2, kind: 'swell', riserId: null }
      ])
    ).toEqual([{ sectionIndex: 2, kind: 'swell', riserId: null }])
  })

  it('keeps a riser id only when it is a real string', () => {
    expect(sanitiseCoachTension([{ sectionIndex: 0, kind: 'riser', riserId: 7 }])).toEqual([
      { sectionIndex: 0, kind: 'riser', riserId: null }
    ])
  })
})

describe('the offer table itself', () => {
  it('names every kind exactly once', () => {
    expect([...COACH_TENSION_KINDS].sort()).toEqual(
      ['fade', 'filter-sweep', 'riser', 'swell'].sort()
    )
  })

  it('obeys the copy rules on every label and hint', () => {
    for (const kind of COACH_TENSION_KINDS) {
      const def = coachTensionDef(kind)
      for (const text of [def.label, def.note]) {
        expect(text).not.toMatch(/!/)
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(text[0]).toBe(text[0].toLowerCase())
      }
    }
  })

  it('validates a persisted kind', () => {
    expect(isCoachTensionKind('riser')).toBe(true)
    expect(isCoachTensionKind('sidechain')).toBe(false)
    expect(isCoachTensionKind(3)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachTension.test.ts`
Expected: FAIL — `Failed to resolve import "./coachTension"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachTension.ts`:

```ts
/**
 * Phase three, as plain data: which moves a BOUNDARY BETWEEN TWO NAMED
 * SECTIONS justifies, how long each one is, and what shape it writes.
 *
 * THE RULE THIS FILE EXISTS TO ENCODE (spec, "What he is allowed to say"):
 * **every offer here is justified by a name the user typed.** A riser is
 * offered at a build into a drop because the next section is literally
 * called "drop" -- a fact about the arrangement, not an opinion about the
 * audio. Nothing below reads a stem, a waveform, a trait or a gain. The
 * only numbers involved are the bar lengths the user set with phase two's
 * own nudge buttons, and they decide how LONG an offer is, never WHETHER it
 * is offered.
 *
 * The second rule, and the reason this phase's toggles start OFF: phase two
 * puts everything on and lets you subtract, because a section is the whole
 * loop until you say otherwise. Phase three ADDS material to the
 * arrangement, so the default has to be the other way round -- writing a
 * sweep onto somebody's clips before they asked is an edit they then have
 * to notice and undo, which is exactly what phase two's rule exists to
 * prevent.
 *
 * Every shape here is built out of automationEdit.ts's OWN primitives, not
 * out of new geometry: a swell and a fade are `applyEdgeFade` (the function
 * the lane's edge grabbers call) and a sweep is `applyStroke` over
 * `rampStroke` (the function the lane's shift-drag calls). So what lands is
 * indistinguishable from a curve drawn by hand, and the grabbers can pick
 * it straight back up -- which is the spec's "everything he makes is
 * ordinary, editable material" written into the implementation rather than
 * promised in a comment.
 */

import { applyEdgeFade, applyStroke, rampStroke } from './automationEdit'
import type { CoachSection, CoachSectionType } from './coachSections'
import { MIN_RISER_LENGTH_BARS } from './riser'
import type { AutomationParam, AutomationPoint } from './toolkit'

/** The four moves the tension pass can make. */
export type CoachTensionKind = 'filter-sweep' | 'swell' | 'fade' | 'riser'

/** What the phase-three panel's own buttons do, as data rather than as
 * callbacks -- the same shape CoachSectionOp uses, so a step row can list
 * them under "stuck?" and the bubble's "do it for me" can run one without
 * src/shared/ knowing React exists. */
export type CoachTensionOp = 'add-all' | 'listen'

/** The balance step's one move. Its own union rather than a bare string so
 * the switch in App.tsx stays exhaustive when a second one is added. */
export type CoachTransportOp = 'play-from-top'

/** Which of the export menu's three entries the flow is asking for. The
 * names match what the menu itself says. */
export type CoachExportOp = 'mix' | 'stems' | 'project'

export interface CoachTensionDef {
  id: CoachTensionKind
  /** The toggle's own label. Lowercase, like all UI copy in this app. */
  label: string
  /** The one line under it, saying exactly what will be written. Flat and
   * unrotated, like COACH_SUGGESTED_DROP_HINT: it is a label on a control,
   * not something sssketchy says. */
  note: string
  /** Which drawable parameter this writes, or null for the riser -- which
   * is a placed clip, not an envelope. */
  param: AutomationParam | null
}

const COACH_TENSION_BY_ID: Record<CoachTensionKind, CoachTensionDef> = {
  'filter-sweep': {
    id: 'filter-sweep',
    label: 'sweep the filter open',
    note: 'a filter curve across this section, closed at its start, wide open at the join',
    param: 'filterCutoff'
  },
  swell: {
    id: 'swell',
    label: 'swell into it',
    note: 'a volume curve across this section, up from silence to its own level',
    param: 'volume'
  },
  fade: {
    id: 'fade',
    label: 'fade out of it',
    note: 'a volume curve across this section, down to silence at the join',
    param: 'volume'
  },
  riser: {
    id: 'riser',
    label: 'put a riser in',
    note: 'one noise riser across this section, on a row of its own',
    param: null
  }
}

/** In the order the panel renders them. */
export const COACH_TENSION_KINDS: readonly CoachTensionKind[] = [
  'filter-sweep',
  'swell',
  'fade',
  'riser'
]

/** Total by construction -- CoachTensionKind is a closed union over this
 * record's own keys, so there is no "unknown kind" branch to get wrong. */
export function coachTensionDef(kind: CoachTensionKind): CoachTensionDef {
  return COACH_TENSION_BY_ID[kind]
}

export function isCoachTensionKind(value: unknown): value is CoachTensionKind {
  return typeof value === 'string' && value in COACH_TENSION_BY_ID
}

/** Where a swept filter starts: 0.3 is roughly 160Hz on the engine's own log
 * map (ChannelFilter.h), and it is deliberately the same number a freshly
 * dropped riser starts at (RISER_DEFAULTS.startCutoffValue) -- the two are
 * the same gesture in two media, and having them start at the same place is
 * what makes a sweep and a riser at one boundary sound like one move. */
export const COACH_SWEEP_START_VALUE = 0.3

/** Where it ends: 1 is a lowpass's own neutral end (neutralCutoff), so the
 * clip is doing nothing at all by the time the join arrives. */
export const COACH_SWEEP_END_VALUE = 1

/**
 * WHAT A PAIR OF SECTION NAMES ASKS FOR -- the whole of this phase's
 * musical content, and the only place in it that decides anything.
 *
 * Read straight off the spec: "filter sweep/swell into drops, fade into
 * breakdowns", plus "at every build->drop boundary sssketchy offers to drop
 * a riser".
 *
 * Note what it does NOT do: it never looks at the sections' stems, lengths,
 * roles or gains. Both arguments are names the user chose from five
 * options. That is what makes every offer true by construction -- "there is
 * a drop after this" is something the app can read, "this track needs a
 * riser" is not.
 */
export function tensionOffersAt(
  from: CoachSectionType,
  into: CoachSectionType
): readonly CoachTensionKind[] {
  if (into === 'drop') {
    // The riser is the one offer that reads BOTH names: the spec names the
    // build->drop pair specifically, and it is the least ambiguous
    // suggestion in the whole method.
    return from === 'build' ? ['filter-sweep', 'swell', 'riser'] : ['filter-sweep', 'swell']
  }
  if (into === 'breakdown') return ['fade']
  return []
}

/** One join between two placed sections, with everything the panel needs to
 * print it and everything the write path needs to build it. */
export interface CoachSectionBoundary {
  /** Index of the OUTGOING section in CoachState.sections -- which is also
   * the section every offer here is WRITTEN ONTO. */
  index: number
  from: CoachSectionType
  into: CoachSectionType
  /** The names the user actually gave them. */
  fromName: string
  intoName: string
  /** The absolute bar the two meet on. */
  bar: number
  /** "the bars leading in" (spec) -- the outgoing section's own length, a
   * number the user set with phase two's nudge buttons. Every offer at this
   * boundary spans exactly this. */
  leadBars: number
  offers: readonly CoachTensionKind[]
}

/**
 * Every join the section NAMES ask something of, in timeline order.
 *
 * Boundaries with nothing on offer are left out rather than listed empty: a
 * row saying "nothing here" at every intro->build join would be four lines
 * of noise around the one line that matters, and the step's own copy
 * already covers the case where there are none at all.
 */
export function coachSectionBoundaries(
  sections: readonly CoachSection[]
): CoachSectionBoundary[] {
  const boundaries: CoachSectionBoundary[] = []
  for (let index = 0; index < sections.length - 1; index += 1) {
    const from = sections[index]
    const into = sections[index + 1]
    const offers = tensionOffersAt(from.type, into.type)
    if (offers.length === 0) continue
    boundaries.push({
      index,
      from: from.type,
      into: into.type,
      fromName: from.name,
      intoName: into.name,
      bar: from.startBar + from.bars,
      leadBars: from.bars,
      offers
    })
  }
  return boundaries
}

/**
 * The curve one offer writes onto one clip, or null when this offer is not
 * a curve (the riser) or there is nowhere to put one.
 *
 * `clipBars` is the clip's REAL current length, which the caller measures
 * off the live state -- never assumed equal to the section's own bars,
 * because the user may have resized or cropped the clip since phase two
 * placed it. The lead is clamped to it, so nothing can ever land past the
 * audio it automates (toolkit spec 2b).
 *
 * `existing` is whatever the clip already has on that parameter. Both
 * primitives below splice rather than replace, so a hand-drawn point
 * outside the lead survives untouched.
 */
export function tensionCurveFor(
  kind: CoachTensionKind,
  existing: readonly AutomationPoint[],
  opts: { leadBars: number; clipBars: number }
): AutomationPoint[] | null {
  const clipBars = Number.isFinite(opts.clipBars) ? Math.max(0, opts.clipBars) : 0
  const rawLead = Number.isFinite(opts.leadBars) ? Math.max(0, opts.leadBars) : 0
  const leadBars = Math.min(clipBars, rawLead)
  if (leadBars <= 0) return null
  const points = [...existing]
  // The lane's own edge grabbers, called directly: a swell IS a fade in and
  // a fade IS a fade out, so there is no second shape to invent and the
  // grabber can pick either straight back up afterwards.
  if (kind === 'swell') {
    return applyEdgeFade(points, { edge: 'start', bars: leadBars, lengthBars: clipBars })
  }
  if (kind === 'fade') {
    return applyEdgeFade(points, { edge: 'end', bars: leadBars, lengthBars: clipBars })
  }
  if (kind === 'filter-sweep') {
    // The lane's own shift-drag, called directly.
    return applyStroke(
      points,
      rampStroke(clipBars - leadBars, COACH_SWEEP_START_VALUE, clipBars, COACH_SWEEP_END_VALUE)
    )
  }
  return null
}

/**
 * Where a riser goes: it ENDS on the join and is as long as the bars
 * leading in (spec, "pre-sized to the bars leading in").
 *
 * Sized off the section rather than off RISER_DEFAULTS.lengthBars
 * deliberately. A fixed four bars would be a taste judgement about somebody
 * else's build; the section's own length is a number they typed. It is an
 * ordinary riser the moment it lands, so making it shorter is a drag on its
 * right edge, not an undo.
 */
export function coachRiserFieldsFor(boundary: {
  bar: number
  leadBars: number
}): { startBar: number; lengthBars: number } {
  const lengthBars = Math.max(MIN_RISER_LENGTH_BARS, boundary.leadBars)
  return { startBar: Math.max(0, boundary.bar - lengthBars), lengthBars }
}

/** One move the tension pass has actually put down. Plain, persisted data,
 * and the ONLY record that a toggle is on -- there is no derived "does this
 * clip look swept" check anywhere, because a hand-edited curve would make
 * such a check lie. */
export interface CoachTensionApplied {
  /** The OUTGOING section it was written onto -- see CoachSectionBoundary. */
  sectionIndex: number
  kind: CoachTensionKind
  /** The riser this put down, for 'riser' only, so taking it off again
   * removes exactly that riser and not one the user placed by hand. null
   * for the three curve moves. */
  riserId: string | null
}

export function tensionIsApplied(
  applied: readonly CoachTensionApplied[],
  sectionIndex: number,
  kind: CoachTensionKind
): boolean {
  return applied.some((entry) => entry.sectionIndex === sectionIndex && entry.kind === kind)
}

/** The riser this boundary put down, or null. */
export function appliedTensionRiserId(
  applied: readonly CoachTensionApplied[],
  sectionIndex: number
): string | null {
  const entry = applied.find(
    (candidate) => candidate.sectionIndex === sectionIndex && candidate.kind === 'riser'
  )
  return entry?.riserId ?? null
}

/** The most recently placed riser. The renderer uses it to put the NEXT
 * riser on the same arranger row, so a track with three drops gets one
 * riser row rather than three. */
export function lastAppliedRiserId(applied: readonly CoachTensionApplied[]): string | null {
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const entry = applied[i]
    if (entry.kind === 'riser' && entry.riserId !== null) return entry.riserId
  }
  return null
}

/**
 * Turns whatever a `.sssketchproj` actually contains into an applied list --
 * the same repair-rather-than-trust rule the rest of the load path follows,
 * for the same reason: a project file is plain JSON people can and do
 * hand-edit, and a load must never throw. An entry whose kind is not one of
 * the four, or whose index is not a whole non-negative number, is dropped
 * entirely rather than guessed at.
 */
export function sanitiseCoachTension(value: unknown): CoachTensionApplied[] {
  if (!Array.isArray(value)) return []
  const applied: CoachTensionApplied[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const loose = entry as Record<string, unknown>
    if (!isCoachTensionKind(loose.kind)) continue
    const index = loose.sectionIndex
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue
    applied.push({
      sectionIndex: index,
      kind: loose.kind,
      riserId: typeof loose.riserId === 'string' && loose.riserId !== '' ? loose.riserId : null
    })
  }
  return applied
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachTension.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachTension.ts src/shared/coachTension.test.ts
git commit -m "feat(sssketchy): what a pair of section names asks for at a join"
```

---

### Task 2: Phase-three copy

Three new hand-written line tables. Nothing here has an opinion about the music.

**Files:**
- Modify: `src/shared/coachLines.ts`
- Modify: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/shared/coachLines.test.ts`, add the three tables to the import list and to the `tables` array in the `describe('the shared line tables')` block, and add a new block at the end of the file:

```ts
describe('the phase-three tables', () => {
  it('give the tension line a {joins} slot to fill', () => {
    for (const line of COACH_TENSION_LINE_TEMPLATES) expect(line).toContain('{joins}')
  })

  it('never claim the track is finished, only that a file came out', () => {
    for (const line of COACH_V1_EXPORTED_LINES) {
      expect(line).not.toMatch(/\bgood\b|\bgreat\b|\bnice\b|\bsounds\b/)
    }
  })
})
```

The import block at the top of the file becomes:

```ts
import {
  COACH_DONE_LINES,
  COACH_NEXT_SECTION_LINE_TEMPLATES,
  COACH_NO_MOVES_LINES,
  COACH_SECTION_LINE_TEMPLATES,
  COACH_SEEDED_LINE_TEMPLATES,
  COACH_STEP_SATISFIED_LINES,
  COACH_STUCK_LINES,
  COACH_TENSION_LINE_TEMPLATES,
  COACH_TENSION_NONE_LINES,
  COACH_V1_EXPORTED_LINES,
  pickLineVariant
} from './coachLines'
```

and the `tables` array becomes:

```ts
  const tables = [
    COACH_STUCK_LINES,
    COACH_NO_MOVES_LINES,
    COACH_DONE_LINES,
    COACH_STEP_SATISFIED_LINES,
    COACH_SEEDED_LINE_TEMPLATES,
    COACH_SECTION_LINE_TEMPLATES,
    COACH_NEXT_SECTION_LINE_TEMPLATES,
    COACH_TENSION_LINE_TEMPLATES,
    COACH_TENSION_NONE_LINES,
    COACH_V1_EXPORTED_LINES
  ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: FAIL — `COACH_TENSION_LINE_TEMPLATES` is not exported from `./coachLines`.

- [ ] **Step 3: Write the implementation**

Append to `src/shared/coachLines.ts`:

```ts
/** What the bubble says on the tension pass. {joins} is a ready-made phrase
 * ("one join", "three joins") built by the caller, so the template does not
 * have to carry a plural rule. Every variant states the same fact -- the
 * joins exist and their NAMES are what is being read -- because that fact
 * is the only thing about this step that is true of every track. Nothing
 * here says a join needs anything. */
export const COACH_TENSION_LINE_TEMPLATES: readonly string[] = [
  'the tension pass. {joins} where the names you gave say what usually goes in.',
  'joins next. {joins} here, each carrying what that pair of names asks for.',
  'this step is the seams between sections. {joins} to look at, nothing on yet.',
  '{joins} between your sections. nothing goes in until you switch it on.'
]

/** The same step when the section names ask for nothing -- no drop and no
 * breakdown to lead into. Says so plainly rather than inventing an offer,
 * which is the same choice COACH_NO_MOVES_LINES makes. */
export const COACH_TENSION_NONE_LINES: readonly string[] = [
  'none of your joins run into a drop or a breakdown, so there is nothing to offer here.',
  'nothing for this step to do: the names either side of every join ask for nothing.',
  'no drops and no breakdowns to lead into. skip this one.',
  'this pass reads section names, and yours do not ask for anything. next when you like.'
]

/** After an export has really written a file. Reports the file, which is a
 * fact, and says the material is still ordinary -- never that the track is
 * any good, which is the one thing he does not know. */
export const COACH_V1_EXPORTED_LINES: readonly string[] = [
  'that is a v1, out of the app and onto disk. go and listen to it somewhere else.',
  'v1 exported. the project is marked, and everything in here is still ordinary material.',
  'exported. that is the whole method, top to bottom.',
  'v1 is out. nothing here is locked -- open it again and keep going whenever you like.'
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachLines.ts src/shared/coachLines.test.ts
git commit -m "feat(sssketchy): phase three's own vocabulary"
```

---

### Task 3: The three phase-three step rows

Replace the `'finish'` placeholder — **and its placeholder copy, which describes features as if they already exist** — with three real rows.

**Files:**
- Modify: `src/shared/coachSteps.ts`
- Modify: `src/shared/coachSteps.test.ts`

**Re-read `coachSteps.ts` before editing** (finding 5).

- [ ] **Step 1: Write the failing test**

In `src/shared/coachSteps.test.ts`, replace every occurrence of the `'finish'` step id with the new ones and add this block:

```ts
describe('phase three', () => {
  it('replaces the finish placeholder with three real steps', () => {
    expect(coachStepById('finish')).toBeUndefined()
    expect(isCoachStepId('finish')).toBe(false)
    for (const id of ['p3-tension', 'p3-balance', 'p3-export']) {
      expect(isCoachStepId(id)).toBe(true)
      expect(coachStepById(id)?.phase).toBe('polish')
    }
  })

  it('walks tension, then balance, then export, and then ends the flow', () => {
    expect(nextCoachStepId('p2-next', 'groove')).toBe('p3-tension')
    expect(nextCoachStepId('p3-tension', 'groove')).toBe('p3-balance')
    expect(nextCoachStepId('p3-balance', 'groove')).toBe('p3-export')
    expect(nextCoachStepId('p3-export', 'groove')).toBeNull()
  })

  it('puts all three in the polish phase, in order, for either flavour', () => {
    for (const flavour of ['groove', 'melodic'] as const) {
      expect(coachStepsInPhase('polish', flavour).map((step) => step.id)).toEqual([
        'p3-tension',
        'p3-balance',
        'p3-export'
      ])
    }
  })

  it('gives each of the three a primary move, so "do it for me" is never dead here', () => {
    for (const id of ['p3-tension', 'p3-balance', 'p3-export'] as const) {
      const step = coachStepById(id)
      expect(step).toBeDefined()
      expect(coachStepPrimaryMove(step!, null)).not.toBeNull()
    }
  })

  it('arms nothing in discover -- phase three never touches the add row', () => {
    for (const id of ['p3-tension', 'p3-balance', 'p3-export'] as const) {
      expect(coachStepArmKinds(coachStepById(id)!, null)).toBeNull()
    }
  })
})
```

Make sure `coachStepPrimaryMove`, `coachStepArmKinds`, `coachStepsInPhase`, `nextCoachStepId`, `coachStepById` and `isCoachStepId` are all in the file's import list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: FAIL — `coachStepById('finish')` still returns a row, and `isCoachStepId('p3-tension')` is false.

- [ ] **Step 3: Write the implementation**

In `src/shared/coachSteps.ts`:

**(a)** extend the import at the top:

```ts
import type { CoachSectionOp } from './coachSections'
import type { CoachExportOp, CoachTensionOp, CoachTransportOp } from './coachTension'
import type { DiscoverSlotKind } from './discoverSlotKind'
```

**(b)** replace `'finish'` in the `CoachStepId` union with the three new ids:

```ts
  | 'p2-first'
  | 'p2-section'
  | 'p2-next'
  | 'p3-tension'
  | 'p3-balance'
  | 'p3-export'
```

**(c)** extend `CoachMoveAction` with the three new cases and update its doc comment's last sentence:

```ts
/** What a move actually DOES, as data rather than as a callback -- the
 * renderer switches on `kind` and nothing in src/shared/ knows that
 * Discover, React or Electron exist. 'add-slot' adds one Discover slot
 * targeting `kinds`; 'lock-climax' freezes the loop (see ./coachClimax.ts);
 * 'section-op' presses one of the phase-two panel's own buttons (see
 * ./coachSections.ts's CoachSectionOp); 'tension-op' presses one of the
 * phase-three panel's (./coachTension.ts); 'transport-op' is the balance
 * step simply starting playback, which is a machine fact rather than a
 * musical decision; 'export-op' opens one of the export menu's own three
 * entries. Every one of them is a button that already exists somewhere,
 * restated as data, so the bubble's "stuck?" list and the panel can never
 * offer two different sets of moves. */
export type CoachMoveAction =
  | { kind: 'add-slot'; kinds: readonly DiscoverSlotKind[] }
  | { kind: 'lock-climax' }
  | { kind: 'section-op'; op: CoachSectionOp }
  | { kind: 'tension-op'; op: CoachTensionOp }
  | { kind: 'transport-op'; op: CoachTransportOp }
  | { kind: 'export-op'; op: CoachExportOp }
```

**(d)** replace the whole `finish` row at the end of `COACH_STEPS` with:

```ts
  {
    id: 'p3-tension',
    phase: 'polish',
    label: 'the tension pass',
    lines: [
      'phase three. the joins between sections first -- a sweep into a drop, a fade into a breakdown.',
      'last phase. start at the seams: what is offered there comes from the names you gave.',
      'tension pass. nothing is on until you switch it on, and what it makes is an ordinary curve.',
      'this step is the joins. a drop gets a sweep and a swell; a build into a drop also gets a riser.'
    ],
    // The panel's own two controls, restated here so the bubble's "stuck?"
    // list and "do it for me" can never offer a different set of moves than
    // the panel shows. "add all of these" is the primary one for the same
    // reason "drop the suggested ones" is phase two's -- it is the single
    // shortcut worth having, and it still only ever runs on a click.
    moves: [
      {
        id: 'tension-add-all',
        label: 'add all of these',
        action: { kind: 'tension-op', op: 'add-all' }
      },
      {
        id: 'tension-listen',
        label: 'play the first join',
        action: { kind: 'tension-op', op: 'listen' }
      }
    ],
    primaryMoveId: 'tension-add-all',
    anchorSelector: TIMELINE
  },
  {
    id: 'p3-balance',
    phase: 'polish',
    label: 'the balance check',
    lines: [
      'balance check. play the whole thing through and set the levels while it runs.',
      'one listen, top to bottom, with the row gains to hand.',
      'this step is levels. what they should be is yours -- i can only start it playing.',
      'play it through. the gain on each row is the only control this step is about.'
    ],
    // Pressing play is a machine fact, not a musical decision, which is why
    // this step has a move at all where phase one's balance step did not:
    // that one asked the app to judge a mix, this one asks it to hit space.
    moves: [
      {
        id: 'balance-play',
        label: 'play the whole thing from the top',
        action: { kind: 'transport-op', op: 'play-from-top' }
      }
    ],
    primaryMoveId: 'balance-play',
    anchorSelector: TIMELINE
  },
  {
    id: 'p3-export',
    phase: 'polish',
    label: 'export a v1',
    lines: [
      'last step. a mix, the stems, or an ableton or reaper project -- whichever you want a v1 in.',
      'export time. the usual picker, and the project gets marked once a file really comes out.',
      'get a v1 out. a mix is the quickest; the daw projects carry the curves across as well.',
      'this is the end of the method: export something you can listen to away from here.'
    ],
    moves: [
      { id: 'export-mix', label: 'export a mix', action: { kind: 'export-op', op: 'mix' } },
      { id: 'export-stems', label: 'export the stems', action: { kind: 'export-op', op: 'stems' } },
      {
        id: 'export-project',
        label: 'export an ableton or reaper project',
        action: { kind: 'export-op', op: 'project' }
      }
    ],
    primaryMoveId: 'export-mix',
    anchorSelector: TIMELINE
  }
```

**(e)** update `LATER_PHASE_ORDER` and its doc comment's last paragraph:

```ts
/** Phase two's own loop plus phase three's three steps. The answer to the
 * melodic-or-groove question does not reach them.
 *
 * p2-section repeats: the flow walks p2-first -> p2-section -> p2-next and
 * then goes BACK to p2-section for as long as the user keeps choosing
 * another section (startCoachSection, ./coachPhase2.ts). This flat order is
 * still what advanceCoach's next/skip walks, so skipping from p2-next lands
 * on p3-tension -- which is exactly "stop arranging and go to polish". */
const LATER_PHASE_ORDER: readonly CoachStepId[] = [
  'p2-first',
  'p2-section',
  'p2-next',
  'p3-tension',
  'p3-balance',
  'p3-export'
]
```

**(f)** update the two places the module header and the `CoachStepId` doc comment still call `'finish'` a placeholder, so nothing in the file claims a placeholder that no longer exists. In the header:

```
 * The eight 'p1-' rows are phase one, the climax loop (build order step 2,
 * 2026-09-22). The three 'p2-' rows are phase two, shipped 2026-09-22 (build
 * order step 3); the three 'p3-' rows are phase three, shipped 2026-09-22
 * (build order step 4), and complete the table -- there is no placeholder
 * left in it. Every line carries real, hand-written copy
```

and in the `CoachStepId` doc comment, replace its final sentence with:

```
 * The 'p3-' rows are phase three, shipped 2026-09-22 (build order step 4);
 * they replaced the single 'finish' placeholder the same way, so a project
 * saved on that placeholder loads with an unknown stepId and is repaired
 * back to the first step -- see sanitiseLoadedCoach.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachSteps.ts src/shared/coachSteps.test.ts
git commit -m "feat(sssketchy): three real phase-three steps replace the finish placeholder"
```

---

### Task 4: `CoachState` gains the tension record and the v1 mark

**Files:**
- Modify: `src/shared/coach.ts`
- Modify: `src/shared/coach.test.ts`

**Re-read `coach.ts` before editing** (finding 5).

- [ ] **Step 1: Write the failing test**

In `src/shared/coach.test.ts`, replace every `'finish'` step id with `'p3-export'` (the last step, which is what those tests were reaching for), and add:

```ts
describe('the phase-three fields', () => {
  it('start empty on a fresh flow', () => {
    const state = startCoach(1000)
    expect(state.tension).toEqual([])
    expect(state.v1ExportedAt).toBeNull()
  })

  it('survive a load', () => {
    const loaded = sanitiseLoadedCoach({
      ...startCoach(1000),
      tension: [{ sectionIndex: 2, kind: 'riser', riserId: 'riser-a' }],
      v1ExportedAt: 1234
    })
    expect(loaded?.tension).toEqual([{ sectionIndex: 2, kind: 'riser', riserId: 'riser-a' }])
    expect(loaded?.v1ExportedAt).toBe(1234)
  })

  it('load as empty from a project saved before phase three existed', () => {
    const loaded = sanitiseLoadedCoach({ status: 'active', stepId: 'p2-next', lineSeed: 3 })
    expect(loaded?.tension).toEqual([])
    expect(loaded?.v1ExportedAt).toBeNull()
  })

  it('repair a nonsense v1 mark rather than trusting it', () => {
    expect(sanitiseLoadedCoach({ v1ExportedAt: 'yesterday' })?.v1ExportedAt).toBeNull()
    expect(sanitiseLoadedCoach({ v1ExportedAt: -5 })?.v1ExportedAt).toBeNull()
    expect(sanitiseLoadedCoach({ v1ExportedAt: Number.NaN })?.v1ExportedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: FAIL — `state.tension` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/shared/coach.ts`:

**(a)** add the import:

```ts
import { sanitiseCoachTension, type CoachTensionApplied } from './coachTension'
```

**(b)** add the two fields at the end of the `CoachState` interface:

```ts
  /** Phase three's applied tension moves -- what is switched ON at which
   * section boundary. A flat list rather than a keyed record so a later
   * change needs no migration, exactly like `outcomes`: an entry that is
   * not there is a toggle that is off. Real persisted project data; the
   * toggles' on/off state must survive a save, because the curves and
   * risers themselves do. */
  tension: CoachTensionApplied[]
  /** When an export first really wrote a file -- "the project is marked
   * 'V1 exported'" (spec). null until then. Set once and never rewritten:
   * the FIRST file out is the v1, and a later export is just another
   * export. */
  v1ExportedAt: number | null
```

**(c)** add them to `startCoach`:

```ts
    sections: [],
    draftSection: null,
    tension: [],
    v1ExportedAt: null
  }
```

**(d)** add them to `sanitiseLoadedCoach`'s returned object:

```ts
    sections: sanitiseCoachSections(loose.sections),
    draftSection: sanitiseCoachSectionDraft(loose.draftSection),
    tension: sanitiseCoachTension(loose.tension),
    // Repaired rather than trusted, like every other number here: a
    // hand-edited or absent value must not leave the flow thinking a file
    // came out when none did. Zero and negatives are treated as "not
    // exported" -- there is no real export at the epoch.
    v1ExportedAt:
      typeof loose.v1ExportedAt === 'number' &&
      Number.isFinite(loose.v1ExportedAt) &&
      loose.v1ExportedAt > 0
        ? loose.v1ExportedAt
        : null
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coach.ts src/shared/coach.test.ts
git commit -m "feat(sssketchy): the flow remembers what it switched on and whether a v1 came out"
```

---

### Task 5: Phase-three transitions

**Files:**
- Create: `src/shared/coachPhase3.ts`
- Create: `src/shared/coachPhase3.test.ts`
- Modify: `src/shared/coachPhase1.ts`
- Modify: `src/shared/coachPhase1.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachPhase3.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { CoachSection } from './coachSections'
import {
  applyCoachTension,
  clearCoachTension,
  coachBoundaries,
  coachPhase3Line,
  markCoachV1Exported
} from './coachPhase3'

function sections(): CoachSection[] {
  return [
    {
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: [],
      startBar: 0,
      placedGroupIds: {}
    },
    {
      type: 'drop',
      name: 'drop',
      bars: 16,
      droppedPaths: [],
      startBar: 16,
      placedGroupIds: {}
    }
  ]
}

function flow(over: Partial<CoachState> = {}): CoachState {
  return { ...startCoach(1000), stepId: 'p3-tension', sections: sections(), ...over }
}

describe('applyCoachTension', () => {
  it('records the move without touching the clock or the line', () => {
    const before = flow()
    const after = applyCoachTension(before, 0, 'filter-sweep', null)
    expect(after.tension).toEqual([{ sectionIndex: 0, kind: 'filter-sweep', riserId: null }])
    expect(after.stepElapsedMs).toBe(before.stepElapsedMs)
    expect(after.runningSince).toBe(before.runningSince)
    expect(after.lineSeed).toBe(before.lineSeed)
    expect(after.stepId).toBe(before.stepId)
  })

  it('keeps the riser id, so taking it off removes exactly that riser', () => {
    const after = applyCoachTension(flow(), 0, 'riser', 'riser-a')
    expect(after.tension).toEqual([{ sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }])
  })

  it('is idempotent -- a second apply of the same move changes nothing', () => {
    const once = applyCoachTension(flow(), 0, 'swell', null)
    expect(applyCoachTension(once, 0, 'swell', null)).toBe(once)
  })

  it('ignores a boundary that is not there rather than storing a dangling one', () => {
    const before = flow()
    expect(applyCoachTension(before, 9, 'swell', null)).toBe(before)
  })
})

describe('clearCoachTension', () => {
  it('takes exactly one move off, leaving the others', () => {
    let state = applyCoachTension(flow(), 0, 'swell', null)
    state = applyCoachTension(state, 0, 'riser', 'riser-a')
    const after = clearCoachTension(state, 0, 'swell')
    expect(after.tension).toEqual([{ sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }])
  })

  it('returns the state untouched when that move was never on', () => {
    const before = flow()
    expect(clearCoachTension(before, 0, 'fade')).toBe(before)
  })
})

describe('markCoachV1Exported', () => {
  it('marks the project the first time a file really comes out', () => {
    expect(markCoachV1Exported(flow(), 5000).v1ExportedAt).toBe(5000)
  })

  it('never rewrites the mark -- the first file out is the v1', () => {
    const once = markCoachV1Exported(flow(), 5000)
    expect(markCoachV1Exported(once, 9000)).toBe(once)
  })

  it('does not advance the step -- next and skip stay the user"s', () => {
    const after = markCoachV1Exported(flow({ stepId: 'p3-export' }), 5000)
    expect(after.stepId).toBe('p3-export')
  })
})

describe('coachBoundaries', () => {
  it('reads the joins off the flow"s own placed sections', () => {
    expect(coachBoundaries(flow()).map((boundary) => boundary.index)).toEqual([0])
  })
})

describe('coachPhase3Line', () => {
  it('names how many joins there are, in words', () => {
    expect(coachPhase3Line(flow({ lineSeed: 0 }))).toContain('one join')
  })

  it('pluralises', () => {
    const many = flow()
    many.sections = [
      ...sections(),
      {
        type: 'breakdown',
        name: 'breakdown',
        bars: 8,
        droppedPaths: [],
        startBar: 32,
        placedGroupIds: {}
      }
    ]
    expect(coachPhase3Line({ ...many, lineSeed: 0 })).toContain('two joins')
  })

  it('says so plainly when the names ask for nothing', () => {
    const quiet = flow()
    quiet.sections = [
      { type: 'intro', name: 'intro', bars: 8, droppedPaths: [], startBar: 0, placedGroupIds: {} },
      { type: 'outro', name: 'outro', bars: 8, droppedPaths: [], startBar: 8, placedGroupIds: {} }
    ]
    expect(coachPhase3Line({ ...quiet, lineSeed: 0 })).toMatch(/nothing|no drops|not ask/)
  })

  it('says a v1 is out once the project is marked', () => {
    const exported = flow({ stepId: 'p3-export', v1ExportedAt: 5000, lineSeed: 0 })
    expect(coachPhase3Line(exported)).toContain('v1')
  })

  it('leaves every other step to the other line functions', () => {
    expect(coachPhase3Line(flow({ stepId: 'p2-next' }))).toBeNull()
    expect(coachPhase3Line(flow({ stepId: 'p3-balance' }))).toBeNull()
    expect(coachPhase3Line(flow({ stepId: 'p3-export' }))).toBeNull()
    expect(coachPhase3Line(flow({ status: 'finished' }))).toBeNull()
  })
})
```

In `src/shared/coachPhase1.test.ts`, add:

```ts
describe('coachStepSatisfied on the export step', () => {
  it('is answered by the flow itself, not by discover"s slots', () => {
    const base = { ...startCoach(1000), stepId: 'p3-export' as const }
    expect(coachStepSatisfied(base, [])).toBe(false)
    expect(coachStepSatisfied({ ...base, v1ExportedAt: 7000 }, [])).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachPhase3.test.ts src/shared/coachPhase1.test.ts`
Expected: FAIL — `Failed to resolve import "./coachPhase3"`, and the export-step case is false.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachPhase3.ts`:

```ts
/**
 * Phase three's own transitions: switching one tension move on or off, and
 * marking the project once a v1 has really come out.
 *
 * Everything here is pure and every function takes the whole CoachState and
 * returns a new one, the same shape ./coachPhase1.ts and ./coachPhase2.ts
 * use.
 *
 * THE RULE (spec): **offers are offers.** Nothing below is ever called by
 * the reducer, a constructor, or an effect -- every one of these runs from
 * a click. applyCoachTension in particular is the ONLY function in this
 * codebase that puts an entry into CoachState.tension, and it exists to be
 * dispatched by a toggle the user pressed.
 *
 * Note what does NOT take a `now`: switching a toggle is not a step change
 * and must not move the clock or rotate the line, exactly like
 * setCoachSectionName in phase two. Only markCoachV1Exported takes one, and
 * that is a timestamp it stores rather than a clock it moves.
 */

import type { CoachState } from './coach'
import {
  COACH_TENSION_LINE_TEMPLATES,
  COACH_TENSION_NONE_LINES,
  COACH_V1_EXPORTED_LINES,
  pickLineVariant
} from './coachLines'
import {
  coachSectionBoundaries,
  tensionIsApplied,
  type CoachSectionBoundary,
  type CoachTensionKind
} from './coachTension'

/** Every join the flow's own placed sections make that the NAMES ask
 * something of. Derived, never stored: rename or resize a section and the
 * offers follow. */
export function coachBoundaries(state: CoachState): CoachSectionBoundary[] {
  return coachSectionBoundaries(state.sections)
}

/**
 * One tension move switched on.
 *
 * `riserId` is the id of the riser the caller just placed, for the 'riser'
 * move only -- the caller has already built the real ADD_RISER and is
 * dispatching both in one BATCH, so this records what REALLY happened
 * rather than recomputing it (the same rule placeCoachSection follows).
 *
 * A move on a boundary the flow does not have is IGNORED rather than
 * stored: such an entry would be invisible in the panel and would survive
 * in the saved project forever.
 */
export function applyCoachTension(
  state: CoachState,
  sectionIndex: number,
  kind: CoachTensionKind,
  riserId: string | null
): CoachState {
  if (sectionIndex < 0 || sectionIndex >= state.sections.length) return state
  if (tensionIsApplied(state.tension, sectionIndex, kind)) return state
  return { ...state, tension: [...state.tension, { sectionIndex, kind, riserId }] }
}

/** The same toggle, switched off. The caller has already built the actions
 * that take the curve or the riser back off the arrangement. */
export function clearCoachTension(
  state: CoachState,
  sectionIndex: number,
  kind: CoachTensionKind
): CoachState {
  if (!tensionIsApplied(state.tension, sectionIndex, kind)) return state
  return {
    ...state,
    tension: state.tension.filter(
      (entry) => entry.sectionIndex !== sectionIndex || entry.kind !== kind
    )
  }
}

/**
 * "the project is marked 'V1 exported'" (spec).
 *
 * Deliberately does NOT advance the step, for the same reason
 * lockCoachClimax does not: next and skip stay the user's, and exporting a
 * v1 and then deciding to export the stems as well should not have cost
 * them the step.
 *
 * Set once. A later export is another export, not another v1.
 */
export function markCoachV1Exported(state: CoachState, now: number): CoachState {
  if (state.v1ExportedAt !== null) return state
  return { ...state, v1ExportedAt: now }
}

/** "one join" / "two joins" -- a ready-made phrase, so the line templates
 * do not have to carry a plural rule. Words up to four because those are
 * the counts a guided track actually produces; anything above reads
 * perfectly well as a numeral. */
const JOIN_WORDS: readonly string[] = ['no', 'one', 'two', 'three', 'four']

function joinsPhrase(count: number): string {
  const word = count < JOIN_WORDS.length ? JOIN_WORDS[count] : String(count)
  return `${word} ${count === 1 ? 'join' : 'joins'}`
}

/**
 * The phase-three thought on screen, or null when the flow is somewhere
 * else (the caller then falls back to coachSectionLine, ./coachPhase2.ts,
 * and then to coachLineFor, ./coachPhase1.ts).
 *
 * Returns ONE string, like every other line in this feature -- "a new
 * step's text replaces the old one; nothing stacks" (spec).
 *
 * Only two cases need a line of their own: the tension pass, whose line
 * counts the joins, and an export step that has really produced a file,
 * whose line would otherwise be the generic "the step is satisfied". The
 * balance step and an unexported export step read their own rows'
 * hand-written lines, which is why they return null here.
 */
export function coachPhase3Line(state: CoachState): string | null {
  if (state.status === 'finished') return null
  if (state.stepId === 'p3-tension') {
    const boundaries = coachBoundaries(state)
    if (boundaries.length === 0) {
      return pickLineVariant(COACH_TENSION_NONE_LINES, state.lineSeed)
    }
    return pickLineVariant(COACH_TENSION_LINE_TEMPLATES, state.lineSeed).replace(
      '{joins}',
      joinsPhrase(boundaries.length)
    )
  }
  if (state.stepId === 'p3-export' && state.v1ExportedAt !== null) {
    return pickLineVariant(COACH_V1_EXPORTED_LINES, state.lineSeed)
  }
  return null
}
```

In `src/shared/coachPhase1.ts`, add one branch to `coachStepSatisfied` and extend its doc comment:

```ts
/** The current step's completion check. Three steps are answered by the
 * flow itself rather than by the slots: the question (answered when there
 * is an answer), the lock-in (answered when there is a locked climax) and
 * the export (answered when a file has really come out). */
export function coachStepSatisfied(
  state: CoachState,
  slots: readonly CoachSlotSnapshot[]
): boolean {
  if (state.stepId === 'p1-flavour') return state.flavour !== null
  if (state.stepId === 'p1-lock') return state.lockedClimax !== null
  // Phase three. Deliberately the ONLY phase-three step with an automatic
  // check: whether the tension pass or the balance check is "done" is a
  // person listening, and the app has no way to know.
  if (state.stepId === 'p3-export') return state.v1ExportedAt !== null
  const step = coachStepById(state.stepId)
  if (step === undefined) return false
  return stepSatisfiedBySlots(step, state.flavour, slots)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachPhase3.test.ts src/shared/coachPhase1.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachPhase3.ts src/shared/coachPhase3.test.ts src/shared/coachPhase1.ts src/shared/coachPhase1.test.ts
git commit -m "feat(sssketchy): phase three's transitions and its one thought on screen"
```

---

### Task 6: Store actions and history

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`
- Modify: `src/renderer/src/state/history.ts`

**Re-read `history.ts` before editing** (finding 5).

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/store.test.ts`:

```ts
describe('the phase-three coach actions', () => {
  const section = {
    type: 'build' as const,
    name: 'build',
    bars: 16,
    droppedPaths: [],
    startBar: 0,
    placedGroupIds: {}
  }
  const drop = { ...section, type: 'drop' as const, name: 'drop', startBar: 16 }

  function withFlow(): AppState {
    const started = reducer(initialState, { type: 'COACH_START', now: 1000 })
    return {
      ...started,
      coach: { ...started.coach!, stepId: 'p3-tension', sections: [section, drop] }
    }
  }

  it('records a toggle being switched on', () => {
    const state = reducer(withFlow(), {
      type: 'COACH_APPLY_TENSION',
      sectionIndex: 0,
      kind: 'filter-sweep',
      riserId: null
    })
    expect(state.coach?.tension).toEqual([
      { sectionIndex: 0, kind: 'filter-sweep', riserId: null }
    ])
  })

  it('records a toggle being switched off again', () => {
    let state = reducer(withFlow(), {
      type: 'COACH_APPLY_TENSION',
      sectionIndex: 0,
      kind: 'riser',
      riserId: 'riser-a'
    })
    state = reducer(state, { type: 'COACH_CLEAR_TENSION', sectionIndex: 0, kind: 'riser' })
    expect(state.coach?.tension).toEqual([])
  })

  it('marks the project once, the first time a file comes out', () => {
    let state = reducer(withFlow(), { type: 'COACH_MARK_V1_EXPORTED', now: 5000 })
    state = reducer(state, { type: 'COACH_MARK_V1_EXPORTED', now: 9000 })
    expect(state.coach?.v1ExportedAt).toBe(5000)
  })

  it('is a no-op with no flow in progress, like every other coach action', () => {
    expect(
      reducer(initialState, { type: 'COACH_MARK_V1_EXPORTED', now: 5000 }).coach
    ).toBeNull()
    expect(
      reducer(initialState, {
        type: 'COACH_APPLY_TENSION',
        sectionIndex: 0,
        kind: 'swell',
        riserId: null
      }).coach
    ).toBeNull()
  })
})
```

Add to `src/renderer/src/state/history.test.ts`:

```ts
it('does not checkpoint the phase-three flow bookkeeping on its own', () => {
  const started = historyReducer(createHistoryState(initialState), {
    type: 'COACH_START',
    now: 1000
  })
  const after = historyReducer(started, { type: 'COACH_MARK_V1_EXPORTED', now: 2000 })
  expect(after.past.length).toBe(started.past.length)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts src/renderer/src/state/history.test.ts`
Expected: FAIL — `COACH_APPLY_TENSION` is not assignable to `Action`.

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/state/store.ts`:

**(a)** add the imports:

```ts
import {
  applyCoachTension,
  clearCoachTension,
  markCoachV1Exported
} from '@shared/coachPhase3'
import type { CoachTensionKind } from '@shared/coachTension'
```

**(b)** add the three action types immediately after `COACH_PLACE_SECTION` in the `Action` union:

```ts
  // Phase three's own bookkeeping. Every one of these is dispatched inside
  // the SAME BATCH as the real edits it records -- the SET_GROUP_AUTOMATION
  // calls that write a curve, or the ADD_RISER / REMOVE_RISER that place or
  // lift a riser (SssketchyTensionPanel.tsx) -- so the arrangement change
  // and the flow's record of it undo together. That is what "one undo step"
  // means here, and it is the same arrangement COACH_PLACE_SECTION has.
  //
  // `riserId` is the id of the riser that was really placed, for the
  // 'riser' kind only, so switching the toggle back off removes exactly
  // that riser and not one the user dropped by hand.
  | {
      type: 'COACH_APPLY_TENSION'
      sectionIndex: number
      kind: CoachTensionKind
      riserId: string | null
    }
  | { type: 'COACH_CLEAR_TENSION'; sectionIndex: number; kind: CoachTensionKind }
  /** An export really wrote a file -- "the project is marked 'V1
   * exported'" (spec). Dispatched from ProjectMenu's own export paths, and
   * only when one of them actually produced something (the dialog-based
   * IPC calls return null when the save panel was cancelled). */
  | { type: 'COACH_MARK_V1_EXPORTED'; now: number }
```

**(c)** add the three reducer cases immediately after the `COACH_PLACE_SECTION` case:

```ts
    case 'COACH_APPLY_TENSION':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: applyCoachTension(
              state.coach,
              action.sectionIndex,
              action.kind,
              action.riserId
            )
          }

    case 'COACH_CLEAR_TENSION':
      return state.coach === null
        ? state
        : { ...state, coach: clearCoachTension(state.coach, action.sectionIndex, action.kind) }

    case 'COACH_MARK_V1_EXPORTED':
      return state.coach === null
        ? state
        : { ...state, coach: markCoachV1Exported(state.coach, action.now) }
```

In `src/renderer/src/state/history.ts`, add three entries at the end of `TRANSIENT_ACTION_TYPES`, after `'COACH_PLACE_SECTION'`:

```ts
  'COACH_PLACE_SECTION',
  // Phase three's own flow bookkeeping -- same category, and the same
  // arrangement, as COACH_PLACE_SECTION directly above: listed here so a
  // stray direct dispatch cannot push a checkpoint of its own, while in
  // real use all three always arrive inside the BATCH that carries the
  // actual edit (SssketchyTensionPanel.tsx, and ProjectMenu's export paths
  // for the v1 mark, which records a file on disk rather than an edit).
  'COACH_APPLY_TENSION',
  'COACH_CLEAR_TENSION',
  'COACH_MARK_V1_EXPORTED'
])
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts src/renderer/src/state/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts src/renderer/src/state/history.ts src/renderer/src/state/history.test.ts
git commit -m "feat(sssketchy): three phase-three actions, none of them an undo checkpoint on its own"
```

---

### Task 7: The persistence round trip

**Files:**
- Modify: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/serialize.test.ts`:

```ts
describe('the phase-three coach fields', () => {
  it('survive a save and a load, dismissed like the rest of a loaded flow', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: 1000 })
    state = {
      ...state,
      coach: {
        ...state.coach!,
        stepId: 'p3-export',
        sections: [
          {
            type: 'build',
            name: 'build',
            bars: 16,
            droppedPaths: [],
            startBar: 0,
            placedGroupIds: {}
          },
          {
            type: 'drop',
            name: 'drop',
            bars: 16,
            droppedPaths: [],
            startBar: 16,
            placedGroupIds: {}
          }
        ],
        tension: [{ sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }],
        v1ExportedAt: 5000
      }
    }

    const loaded = deserializeProject(serializeProject(state))

    expect(loaded.coach?.tension).toEqual([
      { sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }
    ])
    expect(loaded.coach?.v1ExportedAt).toBe(5000)
    expect(loaded.coach?.status).toBe('dismissed')
  })

  it('load as empty from a project saved before phase three existed', () => {
    const before = JSON.stringify({
      bpm: 120,
      coach: {
        status: 'active',
        stepId: 'p2-next',
        outcomes: {},
        phaseElapsedMs: { loop: 1, arrangement: 2, polish: 0 },
        stepElapsedMs: 3,
        runningSince: 999,
        lineSeed: 4,
        flavour: 'groove',
        seededKinds: [],
        lockedClimax: null,
        sections: [],
        draftSection: null
      }
    })

    const loaded = deserializeProject(before)

    expect(loaded.coach?.tension).toEqual([])
    expect(loaded.coach?.v1ExportedAt).toBeNull()
  })

  it('repairs a project saved on the old finish placeholder back to the first step', () => {
    const before = JSON.stringify({
      bpm: 120,
      coach: { status: 'active', stepId: 'finish', lineSeed: 0 }
    })

    expect(deserializeProject(before).coach?.stepId).toBe('p1-flavour')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: FAIL — only if Task 4 was skipped. If Tasks 4 and 6 are done, this passes immediately, which is the point: **persistence is opt-out here, and this test exists to pin that it stays that way.** Note in your commit message that it passed without a production change.

- [ ] **Step 3: Confirm no production change is needed**

Read `src/renderer/src/state/serialize.ts` around line 372 and confirm `state.coach = sanitiseLoadedCoach(state.coach)` is still the only coach-aware line. If it is, there is nothing to write.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/serialize.test.ts
git commit -m "test(sssketchy): phase three's fields round-trip, and an old save still loads"
```

---

### Task 8: The tension write path

One offer → real arranger actions. This is phase three's equivalent of `coachSectionPlacement.ts`, and it is the file that makes "ordinary editable material" true.

**Files:**
- Create: `src/renderer/src/state/coachTensionApply.ts`
- Create: `src/renderer/src/state/coachTensionApply.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/state/coachTensionApply.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRiser } from '@shared/riser'
import { stemKey, type Rifff } from '@shared/types'
import type { CoachSection } from '@shared/coachSections'
import type { CoachTensionApplied } from '@shared/coachTension'
import {
  buildCoachTensionActions,
  buildCoachTensionRemovalActions,
  coachRiserChannelId
} from './coachTensionApply'
import { initialState, reducer, type AppState } from './store'

function rifff(groupId: string, startBar: number): Rifff {
  return {
    groupId,
    name: groupId,
    bpm: 120,
    barLength: 4,
    folderPath: '/tmp',
    startBar,
    stems: [
      {
        slot: 1,
        author: 'a',
        name: `${groupId} stem`,
        type: 'drums',
        path: `/tmp/${groupId}.wav`,
        durationSec: 8,
        barLength: 4
      }
    ]
  }
}

const section: CoachSection = {
  type: 'build',
  name: 'build',
  bars: 16,
  droppedPaths: [],
  startBar: 8,
  placedGroupIds: { '/tmp/a.wav': 'a', '/tmp/b.wav': 'b' }
}

function placed(): AppState {
  return {
    ...initialState,
    bpm: 120,
    rifffs: { a: rifff('a', 8), b: rifff('b', 8) },
    playedBars: { a: 16, b: 16 },
    stretch: { a: true, b: true },
    channelOf: { a: 'a', b: 'b' },
    channelOrder: ['a', 'b']
  }
}

const ids = { riserId: 'riser-1', channelId: 'channel-new' }

describe('buildCoachTensionActions -- the curve moves', () => {
  it('writes one group automation per clip in the section', () => {
    const { actions, riserId } = buildCoachTensionActions(placed(), section, 'swell', ids)
    expect(riserId).toBeNull()
    expect(actions).toEqual([
      {
        type: 'SET_GROUP_AUTOMATION',
        groupId: 'a',
        param: 'volume',
        points: [
          { bar: 0, value: 0 },
          { bar: 16, value: 1 }
        ]
      },
      {
        type: 'SET_GROUP_AUTOMATION',
        groupId: 'b',
        param: 'volume',
        points: [
          { bar: 0, value: 0 },
          { bar: 16, value: 1 }
        ]
      }
    ])
  })

  it('writes the sweep onto the filter lane, not the volume lane', () => {
    const { actions } = buildCoachTensionActions(placed(), section, 'filter-sweep', ids)
    expect(actions.every((a) => a.type === 'SET_GROUP_AUTOMATION' && a.param === 'filterCutoff'))
      .toBe(true)
  })

  it('really lands on the clips when the reducer runs it', () => {
    const state = placed()
    const { actions } = buildCoachTensionActions(state, section, 'fade', ids)
    const after = actions.reduce(reducer, state)
    expect(after.stemAutomation[stemKey('a', 1)]?.volume).toEqual([
      { bar: 0, value: 1 },
      { bar: 16, value: 0 }
    ])
  })

  it('measures the clip"s REAL length, not the section"s, so a resize is respected', () => {
    const state = { ...placed(), playedBars: { a: 8, b: 16 } }
    const { actions } = buildCoachTensionActions(state, section, 'fade', ids)
    const first = actions[0]
    expect(first.type).toBe('SET_GROUP_AUTOMATION')
    if (first.type === 'SET_GROUP_AUTOMATION') {
      expect(first.points[first.points.length - 1].bar).toBe(8)
    }
  })

  it('skips a clip the user has since deleted rather than throwing', () => {
    const state = { ...placed(), rifffs: { a: rifff('a', 8) } }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    expect(actions).toHaveLength(1)
  })
})

describe('buildCoachTensionActions -- the riser', () => {
  it('drops one riser ending on the join, as long as the bars leading in', () => {
    const { actions, riserId } = buildCoachTensionActions(placed(), section, 'riser', ids)
    expect(riserId).toBe('riser-1')
    expect(actions).toHaveLength(1)
    const [action] = actions
    expect(action.type).toBe('ADD_RISER')
    if (action.type === 'ADD_RISER') {
      expect(action.riser.startBar).toBe(8)
      expect(action.riser.lengthBars).toBe(16)
      expect(action.riser.channelId).toBe('channel-new')
      // An ORDINARY riser: the same defaults createRiser gives the
      // right-click menu's own "add riser here".
      const byHand = createRiser({ id: 'x', channelId: 'y', startBar: 8, lengthBars: 16 })
      expect(action.riser.startCutoffValue).toBe(byHand.startCutoffValue)
      expect(action.riser.endCutoffValue).toBe(byHand.endCutoffValue)
      expect(action.riser.level).toBe(byHand.level)
      expect(action.riser.curve).toEqual(byHand.curve)
    }
  })

  it('really lands on the timeline when the reducer runs it', () => {
    const state = placed()
    const { actions } = buildCoachTensionActions(state, section, 'riser', ids)
    const after = actions.reduce(reducer, state)
    expect(after.risers['riser-1']?.channelId).toBe('channel-new')
    expect(after.channelOrder).toContain('channel-new')
  })
})

describe('coachRiserChannelId', () => {
  it('reuses the row the last flow-placed riser is on', () => {
    const state = placed()
    const withRiser = reducer(state, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'riser-a', channelId: 'risers', startBar: 0 })
    })
    const applied: CoachTensionApplied[] = [
      { sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }
    ]
    expect(coachRiserChannelId(withRiser, applied)).toBe('risers')
  })

  it('is null when the flow has placed none, or its riser has been deleted', () => {
    expect(coachRiserChannelId(placed(), [])).toBeNull()
    expect(
      coachRiserChannelId(placed(), [{ sectionIndex: 0, kind: 'riser', riserId: 'gone' }])
    ).toBeNull()
  })
})

describe('buildCoachTensionRemovalActions', () => {
  it('clears the parameter on every clip -- the same thing right-clicking a lane does', () => {
    const actions = buildCoachTensionRemovalActions(placed(), section, 'swell', null)
    expect(actions).toEqual([
      { type: 'SET_GROUP_AUTOMATION', groupId: 'a', param: 'volume', points: [] },
      { type: 'SET_GROUP_AUTOMATION', groupId: 'b', param: 'volume', points: [] }
    ])
  })

  it('removes exactly the riser the flow placed', () => {
    expect(buildCoachTensionRemovalActions(placed(), section, 'riser', 'riser-1')).toEqual([
      { type: 'REMOVE_RISER', id: 'riser-1' }
    ])
  })

  it('removes nothing when there is no riser id on record', () => {
    expect(buildCoachTensionRemovalActions(placed(), section, 'riser', null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachTensionApply.test.ts`
Expected: FAIL — `Failed to resolve import "./coachTensionApply"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/state/coachTensionApply.ts`:

```ts
/**
 * One tension offer -> real arranger actions.
 *
 * THE POINT (spec): "a riser is the same riser you get from right-clicking,
 * freely movable, resizable, and redrawable afterwards. One undo step
 * each." Nothing here invents a clip type, a flag, or a second-class
 * "guided" object:
 *
 *  - a riser is built by createRiser (@shared/riser) and placed by
 *    ADD_RISER -- the same function and the same action App.tsx's own "add
 *    riser here" context-menu item uses, with the same defaults;
 *  - a curve is written by SET_GROUP_AUTOMATION, which is what the
 *    automation lane itself dispatches on a completed gesture, carrying a
 *    shape built by automationEdit.ts's own primitives (see
 *    tensionCurveFor).
 *
 * The caller dispatches these and the COACH_APPLY_TENSION / COACH_CLEAR_
 * TENSION that records them in ONE BATCH -- see SssketchyTensionPanel.tsx
 * and history.ts.
 *
 * Why SET_GROUP_AUTOMATION rather than SET_STEM_AUTOMATION: a section clip
 * carries exactly one stem (buildCoachSectionActions builds a single-member
 * rifff per kept climax stem), so group and stem are the same thing here,
 * and the group action means this file never has to know the slot number.
 */

import { clipLengthBars } from '@shared/automationEdit'
import type { CoachSection } from '@shared/coachSections'
import {
  coachRiserFieldsFor,
  coachTensionDef,
  lastAppliedRiserId,
  tensionCurveFor,
  type CoachTensionApplied,
  type CoachTensionKind
} from '@shared/coachTension'
import { createRiser } from '@shared/riser'
import { stemKey } from '@shared/types'
import { resolvedPlayedBarsFromFields } from './selectors'
import type { Action, AppState } from './store'

export interface CoachTensionApplication {
  /** Dispatch these in order, in one BATCH, together with the
   * COACH_APPLY_TENSION that records the result. Empty when there is
   * nothing left to write to (every clip deleted, a zero-length clip). */
  actions: Action[]
  /** The riser this placed, for the 'riser' offer only -- goes straight
   * into COACH_APPLY_TENSION so switching the toggle back off can remove
   * exactly this one. */
  riserId: string | null
}

/** A clip's REAL current length in bars -- never the section's own number.
 * The same formula (and the same shared helper) clipGeometryFromFields uses
 * to DRAW the clip, so the span a curve is written over and the span it is
 * drawn over cannot drift apart. */
function clipBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  if (rifff === undefined) return 0
  return clipLengthBars({
    playedBars: resolvedPlayedBarsFromFields(state.playedBars[groupId], rifff.barLength),
    leftCropBars: state.leftCrop[groupId] ?? 0,
    stretchOn: state.stretch[groupId] ?? true,
    rifffBpm: rifff.bpm,
    stateBpm: state.bpm
  })
}

/** This section's clips that are still on the timeline, in the order phase
 * two placed them. A groupId the user has since deleted is skipped rather
 * than throwing -- the arrangement is ordinary material, and deleting a
 * clip is an ordinary thing to do to it. */
function liveGroupIds(state: AppState, section: CoachSection): string[] {
  return Object.values(section.placedGroupIds).filter(
    (groupId) => state.rifffs[groupId] !== undefined
  )
}

/**
 * The arranger row the NEXT flow-placed riser should join: the one the most
 * recent flow-placed riser is on, or null when there is none (the caller
 * then mints a fresh channel id).
 *
 * Why reuse rather than a row per riser: a riser is not a stem, so it does
 * not belong on a stem's row -- but a track with three drops would
 * otherwise grow three riser rows, which reads as three instruments rather
 * than as one. Reusing is also exactly what a user dragging the second
 * riser would do by hand.
 */
export function coachRiserChannelId(
  state: AppState,
  tension: readonly CoachTensionApplied[]
): string | null {
  const riserId = lastAppliedRiserId(tension)
  if (riserId === null) return null
  return state.risers[riserId]?.channelId ?? null
}

/**
 * Switches one offer ON.
 *
 * `ids.riserId` and `ids.channelId` are minted by the caller (crypto.
 * randomUUID, like every other freshly-minted id in the renderer) and
 * injected rather than generated here, so this stays a pure function with
 * pinnable output. `ids.channelId` is only used when the flow has no riser
 * row yet -- see coachRiserChannelId.
 */
export function buildCoachTensionActions(
  state: AppState,
  section: CoachSection,
  kind: CoachTensionKind,
  ids: { riserId: string; channelId: string }
): CoachTensionApplication {
  const def = coachTensionDef(kind)

  if (def.param === null) {
    const { startBar, lengthBars } = coachRiserFieldsFor({
      bar: section.startBar + section.bars,
      leadBars: section.bars
    })
    const riser = createRiser({
      id: ids.riserId,
      channelId: ids.channelId,
      startBar,
      lengthBars
    })
    return { actions: [{ type: 'ADD_RISER', riser }], riserId: riser.id }
  }

  const param = def.param
  const actions: Action[] = []
  for (const groupId of liveGroupIds(state, section)) {
    const rifff = state.rifffs[groupId]
    const firstSlot = rifff.stems[0]?.slot
    const existing =
      firstSlot === undefined
        ? []
        : (state.stemAutomation[stemKey(groupId, firstSlot)]?.[param] ?? [])
    const points = tensionCurveFor(kind, existing, {
      leadBars: section.bars,
      clipBars: clipBarsFor(state, groupId)
    })
    if (points === null) continue
    actions.push({ type: 'SET_GROUP_AUTOMATION', groupId, param, points })
  }
  return { actions, riserId: null }
}

/**
 * Switches one offer back OFF.
 *
 * For a curve this clears that one parameter on the section's clips --
 * literally the same edit right-clicking the lane makes (writeCurve deletes
 * a parameter written as an empty list, and drops the clip's whole record
 * when that was its last one, which is what lets it take the engine's
 * pre-toolkit path again).
 *
 * KNOWN AND DELIBERATE: a hand-drawn shape on top of an applied offer is
 * cleared along with it, because the curve has one set of points and
 * nothing records which of them the flow wrote. Undo is the way back, not
 * the toggle -- and the panel's own copy says so rather than leaving the
 * user to find out.
 */
export function buildCoachTensionRemovalActions(
  state: AppState,
  section: CoachSection,
  kind: CoachTensionKind,
  riserId: string | null
): Action[] {
  const def = coachTensionDef(kind)
  if (def.param === null) {
    return riserId === null ? [] : [{ type: 'REMOVE_RISER', id: riserId }]
  }
  const param = def.param
  return liveGroupIds(state, section).map((groupId) => ({
    type: 'SET_GROUP_AUTOMATION',
    groupId,
    param,
    points: []
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/coachTensionApply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/coachTensionApply.ts src/renderer/src/state/coachTensionApply.test.ts
git commit -m "feat(sssketchy): one offer becomes an ordinary curve or an ordinary riser"
```

---

### Task 9: The two bridges

The bubble's "do it for me" has to reach buttons only two components can press. Same shape, and the same reason, as `coachDiscoverBridge.ts` and `coachSectionBridge.ts`.

**Files:**
- Create: `src/renderer/src/state/coachTensionBridge.ts`
- Create: `src/renderer/src/state/coachTensionBridge.test.ts`
- Create: `src/renderer/src/state/coachExportBridge.ts`
- Create: `src/renderer/src/state/coachExportBridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/state/coachTensionBridge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  coachTensionPanelIsOpen,
  registerCoachTensionOp,
  requestCoachTensionOp,
  resetCoachTensionBridge
} from './coachTensionBridge'

describe('coachTensionBridge', () => {
  beforeEach(() => resetCoachTensionBridge())

  it('routes a request to the registered panel', () => {
    const handler = vi.fn()
    registerCoachTensionOp(handler)
    requestCoachTensionOp('add-all')
    expect(handler).toHaveBeenCalledWith('add-all')
  })

  it('drops a request with no panel open rather than queueing it', () => {
    expect(coachTensionPanelIsOpen()).toBe(false)
    expect(() => requestCoachTensionOp('listen')).not.toThrow()
  })

  it('lets a late teardown from the previous instance not unregister the live one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const tearDownFirst = registerCoachTensionOp(first)
    registerCoachTensionOp(second)
    tearDownFirst()
    requestCoachTensionOp('listen')
    expect(second).toHaveBeenCalledWith('listen')
    expect(first).not.toHaveBeenCalled()
  })
})
```

Create `src/renderer/src/state/coachExportBridge.test.ts` — the same three tests with `registerCoachExport` / `requestCoachExport` / `resetCoachExportBridge` / `coachExportIsReachable`, using the ops `'mix'` and `'project'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/coachTensionBridge.test.ts src/renderer/src/state/coachExportBridge.test.ts`
Expected: FAIL — both modules unresolved.

- [ ] **Step 3: Write the implementations**

Create `src/renderer/src/state/coachTensionBridge.ts`:

```ts
/**
 * The one imperative wire from sssketchy's bubble into the phase-three
 * panel.
 *
 * Same shape, and the same reason, as ./coachSectionBridge.ts: the bubble's
 * "stuck?" list and "do it for me" offer the step's own moves, and phase
 * three's moves are buttons only SssketchyTensionPanel can press (they
 * close over the current AppState, the tension write path and the
 * transport).
 *
 * No queue: the panel is mounted exactly while p3-tension is current, so a
 * request that finds no handler is a request that should not have been
 * made, and dropping it is better than storing it.
 *
 * Module-level mutable state, like the other two bridges -- with the same
 * dev-only wrinkle Vite's Fast Refresh brings: editing THIS file resets
 * `handler` to null until the panel remounts.
 */

import type { CoachTensionOp } from '@shared/coachTension'

export type CoachTensionOpHandler = (op: CoachTensionOp) => void

let handler: CoachTensionOpHandler | null = null

/** Called by SssketchyTensionPanel on mount. Returns its own teardown,
 * which only clears the registration if it is still the current one --
 * React can mount the next instance before unmounting the previous one
 * (Strict Mode), and a late teardown must not unregister the live panel. */
export function registerCoachTensionOp(next: CoachTensionOpHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function coachTensionPanelIsOpen(): boolean {
  return handler !== null
}

/** Presses one of the panel's own buttons, if it is on screen. */
export function requestCoachTensionOp(op: CoachTensionOp): void {
  handler?.(op)
}

/** Tests only. */
export function resetCoachTensionBridge(): void {
  handler = null
}
```

Create `src/renderer/src/state/coachExportBridge.ts`:

```ts
/**
 * The one imperative wire from sssketchy's bubble into the export menu.
 *
 * Same shape as ./coachTensionBridge.ts, for the same reason and with one
 * difference worth knowing: the handler is registered by ProjectMenu, which
 * is mounted for the whole life of the app, so this bridge is effectively
 * always reachable. The flow therefore does NOT build a second export path
 * of its own -- "Export V1: the existing export picker" (spec) means the
 * same three menu entries, opened from somewhere else.
 */

import type { CoachExportOp } from '@shared/coachTension'

export type CoachExportHandler = (op: CoachExportOp) => void

let handler: CoachExportHandler | null = null

/** Called by ProjectMenu on mount; returns its own teardown, which only
 * clears the registration if it is still the current one. */
export function registerCoachExport(next: CoachExportHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function coachExportIsReachable(): boolean {
  return handler !== null
}

/** Opens one of the export menu's own three entries. */
export function requestCoachExport(op: CoachExportOp): void {
  handler?.(op)
}

/** Tests only. */
export function resetCoachExportBridge(): void {
  handler = null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/coachTensionBridge.test.ts src/renderer/src/state/coachExportBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/coachTensionBridge.ts src/renderer/src/state/coachTensionBridge.test.ts src/renderer/src/state/coachExportBridge.ts src/renderer/src/state/coachExportBridge.test.ts
git commit -m "feat(sssketchy): bubble-to-panel and bubble-to-export-menu wires"
```

---

### Task 10: The tension panel

**No component tests** (finding 8). Verified by typecheck + lint + Task 8's own tests, then by the manual walkthrough.

**Files:**
- Create: `src/renderer/src/components/SssketchyTensionPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/renderer/src/components/SssketchyTensionPanel.tsx`:

```tsx
import { useCallback, useEffect } from 'react'
import { markManualSeek } from '../state/manualSeek'
import { registerCoachTensionOp } from '../state/coachTensionBridge'
import {
  buildCoachTensionActions,
  buildCoachTensionRemovalActions,
  coachRiserChannelId
} from '../state/coachTensionApply'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import { coachBoundaries } from '@shared/coachPhase3'
import {
  appliedTensionRiserId,
  coachTensionDef,
  tensionIsApplied,
  type CoachSectionBoundary,
  type CoachTensionKind,
  type CoachTensionOp
} from '@shared/coachTension'
import type { Action } from '../state/store'

/**
 * Phase three's own panel: one row per section JOIN the names ask something
 * of, and one toggle per offer.
 *
 * Two rules this component exists to enforce:
 *
 * **Everything is off until a click.** Nothing here writes on mount, on a
 * step change, or on a render. This is the mirror image of phase two's
 * everything-on default and it points the other way for a reason: phase two
 * subtracts from a loop the user already built, phase three ADDS material
 * to the arrangement, and adding it uninvited is an edit they then have to
 * notice and undo.
 *
 * **Every toggle is one undo step.** The real edits (SET_GROUP_AUTOMATION,
 * ADD_RISER, REMOVE_RISER) go out in the SAME BATCH as the COACH_APPLY_
 * TENSION / COACH_CLEAR_TENSION that records them, and history.ts
 * checkpoints a BATCH exactly once.
 *
 * The listen button sits on the boundary's own header rather than on each
 * toggle: every offer at one boundary covers the same span and is heard in
 * the same pass over the REAL project (nothing throwaway is sent to the
 * engine here, unlike phase two's preview), so four identical buttons would
 * be four ways to do one thing.
 */
export function SssketchyTensionPanel(): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const coach = state.coach

  /** Seeks to the start of the section leading into this join and plays the
   * project as it actually is. Same shape Ruler.tsx's seekTo uses: while
   * playing the engine is told directly (and the tick guard armed) so the
   * playhead does not flicker back; while stopped, updating pos is enough,
   * because enginePlay reads it fresh at play-start. */
  const listenAt = useCallback(
    (boundary: CoachSectionBoundary): void => {
      const section = coach?.sections[boundary.index]
      if (section === undefined) return
      const pos = section.startBar
      dispatch({ type: 'SET_POS', pos })
      if (playing) {
        markManualSeek()
        void window.rifffApi.engineSetPosition(pos)
      } else {
        dispatch({ type: 'PLAY' })
      }
    },
    [coach, dispatch, playing]
  )

  const toggle = useCallback(
    (boundary: CoachSectionBoundary, kind: CoachTensionKind): void => {
      if (coach === null) return
      const section = coach.sections[boundary.index]
      if (section === undefined) return

      if (tensionIsApplied(coach.tension, boundary.index, kind)) {
        const riserId = appliedTensionRiserId(coach.tension, boundary.index)
        const actions: Action[] = [
          ...buildCoachTensionRemovalActions(state, section, kind, riserId),
          { type: 'COACH_CLEAR_TENSION', sectionIndex: boundary.index, kind }
        ]
        dispatch({ type: 'BATCH', actions })
        return
      }

      const built = buildCoachTensionActions(state, section, kind, {
        riserId: crypto.randomUUID(),
        channelId: coachRiserChannelId(state, coach.tension) ?? crypto.randomUUID()
      })
      if (built.actions.length === 0) return
      dispatch({
        type: 'BATCH',
        actions: [
          ...built.actions,
          {
            type: 'COACH_APPLY_TENSION',
            sectionIndex: boundary.index,
            kind,
            riserId: built.riserId
          }
        ]
      })
    },
    [coach, dispatch, state]
  )

  /** "add all of these" -- the step's primary move, and the one bulk
   * application in this phase. Built as ONE batch so the whole pass is a
   * single undo step, and so a riser placed early in it puts the later ones
   * on the same row rather than each minting a row of its own. */
  const addAll = useCallback((): void => {
    if (coach === null) return
    const actions: Action[] = []
    let riserChannelId = coachRiserChannelId(state, coach.tension)
    for (const boundary of coachBoundaries(coach)) {
      const section = coach.sections[boundary.index]
      if (section === undefined) continue
      for (const kind of boundary.offers) {
        if (tensionIsApplied(coach.tension, boundary.index, kind)) continue
        const channelId = riserChannelId ?? crypto.randomUUID()
        const built = buildCoachTensionActions(state, section, kind, {
          riserId: crypto.randomUUID(),
          channelId
        })
        if (built.actions.length === 0) continue
        if (built.riserId !== null) riserChannelId = channelId
        actions.push(...built.actions, {
          type: 'COACH_APPLY_TENSION',
          sectionIndex: boundary.index,
          kind,
          riserId: built.riserId
        })
      }
    }
    if (actions.length === 0) return
    dispatch({ type: 'BATCH', actions })
  }, [coach, dispatch, state])

  const boundaries = coach === null ? [] : coachBoundaries(coach)

  // Registered in an effect with its own teardown -- no setState here, so
  // react-hooks/set-state-in-effect is satisfied by construction.
  useEffect(() => {
    return registerCoachTensionOp((op: CoachTensionOp): void => {
      if (op === 'add-all') {
        addAll()
        return
      }
      const [first] = boundaries
      if (first !== undefined) listenAt(first)
    })
  }, [addAll, boundaries, listenAt])

  if (coach === null) return null

  const panelStyle: React.CSSProperties = {
    marginTop: 'var(--ra-s-5)',
    borderTop: '1px solid var(--ra-border)',
    paddingTop: 'var(--ra-s-5)'
  }

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

  if (boundaries.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          no joins here ask for anything. next when you are ready.
        </div>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      {boundaries.map((boundary) => (
        <div key={boundary.index} style={{ marginBottom: 'var(--ra-s-5)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ra-s-2)',
              fontSize: 10,
              color: 'var(--ra-text-2)'
            }}
          >
            <span style={{ flex: 1 }}>
              {boundary.fromName} into {boundary.intoName}, bar {boundary.bar}
            </span>
            <button type="button" style={buttonStyle} onClick={() => listenAt(boundary)}>
              listen
            </button>
          </div>
          {boundary.offers.map((kind) => {
            const def = coachTensionDef(kind)
            const on = tensionIsApplied(coach.tension, boundary.index, kind)
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggle(boundary, kind)}
                title={
                  on
                    ? 'take it back off -- anything drawn on that lane since goes with it'
                    : def.note
                }
                style={{
                  ...buttonStyle,
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  textAlign: 'left',
                  padding: '4px 8px',
                  marginTop: 'var(--ra-s-1)',
                  border: `1px solid ${on ? 'var(--ra-text-2)' : 'var(--ra-border)'}`,
                  color: on ? 'var(--ra-text)' : 'var(--ra-text-3)'
                }}
              >
                {on ? `on · ${def.label}` : def.label}
                <span
                  style={{
                    display: 'block',
                    marginTop: 2,
                    fontSize: 9,
                    lineHeight: 1.4,
                    color: 'var(--ra-text-3)'
                  }}
                >
                  {def.note}
                </span>
              </button>
            )
          })}
        </div>
      ))}
      <div style={{ fontSize: 9, color: 'var(--ra-text-3)', lineHeight: 1.4 }}>
        everything here is an ordinary curve or an ordinary riser afterwards. move it, resize it,
        redraw it. one undo takes any of it back off.
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck clean; lint clean apart from the 4 known pre-existing prettier warnings in unrelated files.

If `usePlaying` is not exported from `StoreContext.tsx` under that name, **re-read the file** and use whatever the current export is (`Timeline` in `App.tsx` uses it today) — do not add a second playing selector.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SssketchyTensionPanel.tsx
git commit -m "feat(sssketchy): the tension panel -- one row per join, every toggle off"
```

---

### Task 11: Wiring the panel, the moves and the export

**No component tests** (finding 8). **Re-read `SssketchyCoach.tsx` and `App.tsx` before editing — both are being changed by another agent right now** (finding 5), and this task depends on phase 2's Task 11 having turned `handleCoachMove` into an exhaustive `switch` (finding 6).

**Files:**
- Modify: `src/renderer/src/components/SssketchyCoach.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Render the panel and the phase-three line**

In `SssketchyCoachPanel` (inside `SssketchyCoach.tsx`):

1. Import `SssketchyTensionPanel` and `coachPhase3Line` (`@shared/coachPhase3`).
2. **The line.** Phase 2's Task 12 makes the bubble's line read `coachSectionLine(coach) ?? coachLineFor(coach, discoverSlots)`. Prepend phase three so the chain becomes, in this order:

```tsx
const line =
  coachPhase3Line(coach) ?? coachSectionLine(coach) ?? coachLineFor(coach, discoverSlots)
```

   The order matters: `coachLineFor` would otherwise answer an exported export step with the generic `COACH_STEP_SATISFIED_LINES` ("whether it is finished is your call"), which is the wrong thing to say about a file that has just been written.
3. **The panel.** Immediately after the block that renders phase two's `<SssketchySectionPanel />`, render `{coach.stepId === 'p3-tension' && <SssketchyTensionPanel />}`. It lives inside the bubble, below the line and above the button rows, exactly where the section panel does — one thought, with the current step's controls under it.

- [ ] **Step 2: The big jump**

Still in `SssketchyCoachPanel`, and driven entirely by existing machinery:

1. Add a second pulse beside the two that already exist:

```tsx
// "jump = step finished, big jump at V1" (spec). Keyed on the v1 mark, so
// it fires the moment an export really writes a file and never again --
// usePulse is already exactly this shape, so nothing new is needed and
// coachAnimation keeps its four plain inputs.
const celebratingV1 = usePulse(coach.v1ExportedAt ?? 0, JUMP_MS, false)
```

2. Pass `justAdvanced: celebrating || celebratingV1` into `coachAnimation`.
3. Make the jump *big*: render the sprite at `SPRITE_SIZE * 2` while `coach.v1ExportedAt !== null && (coach.stepId === 'p3-export' || coach.status === 'finished')`, and at `SPRITE_SIZE` otherwise. One local `const spriteSize = …` beside the existing `sprite` element; **do not** add a new field to `CoachAnimationInput` — the animation table stays four booleans.

- [ ] **Step 3: Route the three new move kinds**

In `App.tsx`, add three cases to `handleCoachMove`'s `switch` (which phase 2's Task 11 created; see finding 6):

```tsx
      case 'tension-op':
        requestCoachTensionOp(action.op)
        return
      case 'transport-op':
        // "play the whole track with the gain controls to hand" (spec). The
        // whole track, so from bar 0 -- and through the ordinary transport,
        // because the balance check listens to the REAL project, not to a
        // throwaway preview.
        dispatch({ type: 'SET_POS', pos: 0 })
        dispatch({ type: 'PLAY' })
        return
      case 'export-op':
        requestCoachExport(action.op)
        return
```

with imports from `./state/coachTensionBridge` and `./state/coachExportBridge`. Leave the `never` default exactly as it is — it is what will tell you if a seventh kind is ever added without a case.

- [ ] **Step 4: Register the export bridge and mark v1 on a real write**

In `ProjectMenu` (inside `App.tsx`):

1. Register the bridge, in an effect with no setState in its body:

```tsx
  // "Export V1: the existing export picker (mixdown / Ableton / REAPER /
  // stems)" (spec). The flow opens the SAME three menu entries rather than
  // owning an export path of its own -- see coachExportBridge.ts.
  useEffect(() => {
    return registerCoachExport((op: CoachExportOp): void => {
      if (op === 'mix') {
        void handleExportMix()
        return
      }
      if (op === 'stems') {
        setStemsFormatPickerOpen(true)
        return
      }
      setExportFormatPickerOpen(true)
    })
  })
```

   Deliberately with no dependency array: `handleExportMix` is a plain function redeclared every render and closes over the current `state`, so re-registering each render is what keeps the handler pointing at the live export. The registration is a single assignment and its teardown is guarded (`if (handler === next)`), so this is cheap and safe.

2. **Mark v1 only when a file really came out.** Add one helper beside the export functions:

```tsx
  /** The spec's "the project is marked 'V1 exported'". Only ever called
   * when an export really wrote something: the dialog-based IPC calls
   * return null when the save panel was cancelled, and the library /
   * next-to-source ones return void because they always write. Harmless
   * with no flow in progress -- the reducer ignores every coach action
   * then. */
  function markV1Exported(): void {
    if (state.coach === null) return
    dispatch({ type: 'COACH_MARK_V1_EXPORTED', now: Date.now() })
  }
```

3. In `handleExportMix`, capture the result and mark on a real write:

```tsx
      const written = await window.rifffApi.exportMix(wav, defaultName)
      if (written !== null) markV1Exported()
```

4. In `runExportProject`, track whether a file was written and mark once at the end of the `try` block — **after** the whole `if`/`else` chain, so the Ableton-overwrite `return` skips it:

   - every `exportAls` / `exportRpp` / `exportStemsNative` / `exportStemTracksNative` call (the `currentSketch === null` branch) returns `string | null`: assign it and set a local `wrote = result !== null`;
   - every `…ToLibrary` / `…NextToSource` call returns `void`: set `wrote = true` after it resolves;
   - then, as the last statement inside the `try`: `if (wrote) markV1Exported()`.

   Declare `let wrote = false` immediately after `setExporting(true)`. Give the helper and every new local an explicit type; the repo requires explicit return types on functions.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: typecheck clean; lint clean apart from the 4 known warnings; every test green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SssketchyCoach.tsx src/renderer/src/App.tsx
git commit -m "feat(sssketchy): phase three on screen -- the panel, the moves, the export hand-off"
```

---

### Task 12: Verification, and what only Elling can check

- [ ] **Step 1: Run every check**

```bash
npx vitest run
npm run typecheck
npm run lint
```

Expected: the full vitest suite green; `tsc` clean on both the node and web configs; eslint clean apart from the **4 known pre-existing prettier warnings in unrelated files**.

- [ ] **Step 2: Prove the native engine was not touched**

Diff against **your own first commit on this plan** (the marker from the Commands section), **not** against `master` — this branch already carries unrelated earlier C++ work, so a `master` diff would show engine changes that are not yours.

```bash
git diff --stat <your-first-commit> -- native-engine/
```

Expected: **empty output.** If it is not empty, something in this plan went wrong: nothing here needs an engine change (finding 4). Stop and report it rather than rebuilding the engine.

- [ ] **Step 3: Confirm the placeholder is really gone**

```bash
grep -rn "'finish'" src/shared src/renderer/src | grep -i coach
```

Expected: no hits. The three `p3-` rows replaced it (Task 3), and a project saved on it repairs itself (Task 7's third test).

- [ ] **Step 4: Confirm nothing pre-applies an offer**

```bash
grep -rn "applyCoachTension\|buildCoachTensionActions" src/renderer/src src/shared
```

Expected: hits only in `coachPhase3.ts` (the definition), `store.ts` (the reducer case), `coachTensionApply.ts` (the definition), `SssketchyTensionPanel.tsx` (the two click handlers) and the test files. **No hits in any constructor, effect body, `startCoach`, `sanitiseLoadedCoach` or reducer case other than `COACH_APPLY_TENSION`.** If one appears, the everything-off rule has been broken (finding 2).

- [ ] **Step 5: Commit any fixes, then write the walkthrough note**

This environment has **no GUI and no audio tooling**, so an agent cannot click a toggle, hear a riser or open an exported project. Say so plainly rather than claiming otherwise. The report to Elling must list, as unverified:

1. **The tension pass on a real guided track.** Build intro → build → drop → breakdown → outro through phases 1 and 2, then check the panel offers: sweep + swell + riser at build→drop, fade at drop→breakdown, nothing anywhere else.
2. **Whether the lead length is right.** Every offer spans the *whole* outgoing section (finding 11). A 16-bar riser into a drop is the spec's literal "pre-sized to the bars leading in" and is resizable by dragging — but if it reads as too long, the change is one line each in `tensionCurveFor` and `coachRiserFieldsFor`.
3. **How the offers actually sound.** A sweep from 0.3 to fully open, a swell from silence, a fade to silence, and a riser at `RISER_DEFAULTS`' own cutoffs and level — none of which a coding agent can judge.
4. **That the riser really is ordinary.** Drag it, resize it, right-click its lane and redraw the sweep, right-click the block and remove it, Cmd+Z straight after placing it. Every one of those should behave exactly like a riser dropped from "add riser here".
5. **That one undo takes a whole toggle back off** — including "add all of these", which is one batch.
6. **Toggling off after hand-editing.** Known and deliberate: it clears the lane, hand-drawn points included (finding 14, and the panel's own tooltip says so). Worth confirming the copy is clear enough.
7. **The balance check** — "play the whole thing from the top" really plays from bar 0 with the row gains reachable.
8. **The export hand-off and the v1 mark.** All three menu entries open from the bubble; cancelling a save dialog does **not** mark v1; a real write does; the big jump fires; re-opening the saved project shows the flow still marked.
9. **That an exported project still opens.** The toolkit spec's section 4b already lists the Ableton/REAPER items waiting on Elling — this phase adds curves and risers to projects that will go through exactly those paths, so the first guided export is also a real test of them.

```bash
git add -A
git commit -m "chore(sssketchy): phase three verification pass"
```

---

## Self-review against the spec

**Spec coverage** — every bullet of `## Phase 3 — finish`:

| Spec bullet | Task |
|---|---|
| "Tension pass: at each section boundary, offer the built-in toolkit — filter sweep/swell into drops, fade into breakdowns — toggle + preview each" | Tasks 1, 8, 10 (one listen button per boundary rather than per toggle — finding 17) |
| "Risers into drops … at every build→drop boundary … pre-sized to the bars leading in, previewable, placed by the same action the right-click menu uses" | Tasks 1 (`tensionOffersAt`, `coachRiserFieldsFor`), 8 (`createRiser` + `ADD_RISER`), 10 |
| "Balance check: play the whole track with the gain controls to hand" | Task 3 (`p3-balance`), Task 11 step 3 (`transport-op`) |
| "Export V1: the existing export picker (mixdown / Ableton / REAPER / stems), then sssketchy's big jump; the project is marked 'V1 exported'" | Tasks 3, 9 (`coachExportBridge`), 11 steps 2 and 4 |
| "Everything he makes is ordinary, editable material … One undo step each" | Task 8's doc and tests, Task 10's BATCH dispatches, Task 6's `TRANSIENT_ACTION_TYPES` entries |
| "sssketchy never … has an opinion about your music" | Task 1's `tensionOffersAt` reads two section *names* and nothing else; Task 12 step 4 pins that nothing pre-applies |
| Replace the `'finish'` placeholder and its copy | Task 3, including the header and union doc comments that still call it a placeholder |
| Persistence of a half-finished flow | Tasks 4 and 7 |

**Nothing in the spec's phase 3 could not be planned cleanly.** The two places this plan makes a judgement call the spec does not settle are both recorded above rather than buried: the lead length (finding 11) and one listen button per boundary rather than per toggle (finding 17).

**One thing deliberately NOT planned**, because it would require judging the music: the spec's phase 3 could be read as also wanting a fade into an **outro**, or a sweep into a section that merely *follows a build* whatever it is called. Neither is in the spec's own list, and both would mean the app deciding a join "needs" something on grounds other than the name the user typed. If Elling wants them, they are two rows in `tensionOffersAt` — but they are his call, not the plan's.

**No native-engine change is required by any task.** The engine already renders per-clip `filterCutoff` and `volume` curves and noise risers, identically live and offline, and both export paths already bake or translate them. Task 12 step 2 pins this with a diff.
