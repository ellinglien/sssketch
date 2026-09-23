# sssketchy + Coach Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shell of the guided track-design flow — a flow you can start from the project menu, step through with placeholder steps, minimise, dismiss, and resume after a save/load round-trip — with sssketchy's sprite, speech bubble and checklist on screen.

**Architecture:** The flow is a **pure state machine in `src/shared/`** (`coach.ts`) over a **data table of step definitions** (`coachSteps.ts`) and **hand-written line-variant tables** (`coachLines.ts`). The renderer holds one nullable `coach: CoachState` field in the existing single reducer (`state/store.ts`), persisted through the existing `serialize.ts` path, and three thin presentational components (sprite, bubble panel, checklist). Later plans add phase steps by appending rows to `COACH_STEPS` — nothing here reshapes when they do.

**Tech Stack:** TypeScript, React 19, Electron renderer, vitest. **No native-engine changes at all.**

**Spec:** `docs/superpowers/specs/2026-09-22-sssketchy-guided-track-design.md` — build order step 1 only.

---

## Findings that shaped this plan (read these first)

1. **`src/main/projectFile.ts` does not need to change.** It handles project JSON as opaque strings (`saveProjectInPlace(path, json)`, `openLibrarySketch(name)` → `{ path, json }`) and has no knowledge of `AppState`'s shape at all. The entire persistence contract lives in `src/renderer/src/state/serialize.ts` (`serializeProject` / `deserializeProject` / the `PersistedProject` Omit list). That is where Task 6 goes. Do not add project-shape knowledge to the main process.

2. **Persistence is opt-out, not opt-in.** `serializeProject` rest-destructures the transient fields out of `AppState` and stringifies everything else. A new `coach` field is therefore persisted automatically by *not* being added to the `PersistedProject` Omit list. And `deserializeProject` builds `{ ...initialState, ...projectData }`, so **a project saved before this feature existed loads with `coach: null` for free** — the test in Task 6 proves it rather than implementing it.

3. **A loaded flow must not appear on its own.** The spec is explicit: "Button only (Elling's decision) — sssketchy never appears on his own." So `sanitiseLoadedCoach` (Task 5) forces a loaded `'active'`/`'minimised'` flow back to `'dismissed'` and clears the running clock. All the progress (step, done/skipped, per-phase time) survives; only the *visibility* and the *clock* do not. Pressing the project-menu button resumes exactly where it was.

4. **Time must be injected, never read inside a pure function.** Every transition and every getter in `coach.ts` takes `now: number`, and every coach `Action` carries `now` (the exception is `COACH_MINIMISE`, which does not move the clock). That keeps `store.test.ts` and `coach.test.ts` deterministic.

5. **Line variants must not use `Math.random`.** `pickLineVariant(variants, seed)` is a modulo index over `CoachState.lineSeed`, which is bumped exactly once per step transition. A re-render therefore cannot reshuffle mid-step, and tests pin an exact string.

6. **React components are not unit-tested in this codebase** (CLAUDE.md, "Testing conventions"). Tasks 7–10 have no component tests, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, and then by Elling's manual walkthrough. Do not claim the UI was "tested" — this environment has no GUI tooling to click through the app.

7. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`): near-black shell, Silkscreen, **no `border-radius` anywhere**, colour only for things carrying audio information. sssketchy is greyscale — he uses `--ra-text`, `--ra-text-2`, `--ra-text-3`, `--ra-bg-bar`, `--ra-border`, `--ra-border-strong` and nothing else. UI copy is lowercase, **no emoji, no exclamation marks**. Match `ProjectMenu`'s existing `buttonStyle` exactly for the entry-point button.

8. **The sprite frames are already committed** at `src/renderer/src/assets/sssketchy/`: `idle.png`, `walk1..4.png`, `jump.png`, `hit1..4.png`, `climb1..4.png` — all 80×80 PNGs. `src/renderer/src/env.d.ts` already has `/// <reference types="vite/client" />`, so `import url from '../assets/sssketchy/idle.png'` is typed as `string`. There are no death frames in the folder and the spec says they are unused.

9. **Coach edits are not undoable.** Add all six coach action types to `TRANSIENT_ACTION_TYPES` in `src/renderer/src/state/history.ts` — advancing a step is "where am I in the flow", the same category as `SET_ARRANGER_MODE`, not an arrangement edit worth an undo checkpoint.

10. **Coach changes do mark the project dirty.** `hasUnsavedChanges` (`state/unsavedChanges.ts`) compares serialized JSON, and `coach` is in that JSON. That is correct and intended — flow progress is real persisted project data under the explicit-save model. No change needed there.

## File map

| File | Change |
|---|---|
| `src/shared/coachSteps.ts` (new) | `CoachPhase`, `COACH_PHASES`, `coachPhaseDef`, `CoachStepId`, `CoachMove`, `CoachStepDef`, `COACH_STEPS`, `FIRST_COACH_STEP_ID`, `coachStepById`, `nextCoachStepId`, `coachStepsInPhase`, `isCoachStepId` |
| `src/shared/coachSteps.test.ts` (new) | table-shape + lookup tests |
| `src/shared/coachLines.ts` (new) | `pickLineVariant`, `COACH_STUCK_LINES`, `COACH_NO_MOVES_LINES`, `COACH_DONE_LINES` |
| `src/shared/coachLines.test.ts` (new) | determinism + copy-rule tests |
| `src/shared/coach.ts` (new) | `CoachStatus`, `CoachOutcome`, `CoachState`, `COACH_STUCK_AFTER_MS`, `startCoach`, `pauseCoach`, `resumeCoach`, `advanceCoach`, `minimiseCoach`, `restoreCoach`, `dismissCoach`, `coachStepElapsedMs`, `coachPhaseElapsedMs`, `isCoachStuck`, `coachLine`, `sanitiseLoadedCoach`, `SssketchyAnimation`, `coachAnimation` |
| `src/shared/coach.test.ts` (new) | full state-machine TDD |
| `src/renderer/src/state/store.ts` | `AppState.coach`, `initialState.coach`, 6 `Action` members, 6 reducer cases |
| `src/renderer/src/state/store.test.ts` | reducer tests for the 6 actions |
| `src/renderer/src/state/history.ts` | 6 entries in `TRANSIENT_ACTION_TYPES` |
| `src/renderer/src/state/serialize.ts` | one `sanitiseLoadedCoach` call in `deserializeProject` |
| `src/renderer/src/state/serialize.test.ts` | round-trip + pre-feature-project test |
| `src/renderer/src/styles/global.css` | `@keyframes sssketchy-bob` |
| `src/renderer/src/components/SssketchySprite.tsx` (new) | frame tables + the animation loop |
| `src/renderer/src/components/SssketchyChecklist.tsx` (new) | the full-flow checklist, opened by clicking the sprite |
| `src/renderer/src/components/SssketchyCoach.tsx` (new) | store gate + `SssketchyCoachPanel` (bubble, buttons, stuck nudge, minimised sprite) |
| `src/renderer/src/App.tsx` | the `sssketchy` button in `ProjectMenu`, `<SssketchyCoach />` mounted in `Frame` |

## Commands used throughout (run from the repo root, `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/coach.test.ts   # one file
npx vitest run                            # the whole suite
npm run typecheck                         # tsc, node + web configs
npm run lint                              # eslint --cache .
```

Prettier settings that the code below already follows: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

---

### Task 1: The step definition table (`coachSteps.ts`)

**Files:**
- Create: `src/shared/coachSteps.ts`
- Test: `src/shared/coachSteps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachSteps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COACH_PHASES,
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachPhaseDef,
  coachStepById,
  coachStepsInPhase,
  isCoachStepId,
  nextCoachStepId
} from './coachSteps'

describe('coach phases', () => {
  it('carries the spec timekeeping targets for all three phases', () => {
    expect(COACH_PHASES.map((phase) => phase.id)).toEqual(['loop', 'arrangement', 'polish'])
    expect(coachPhaseDef('loop').targetMinMinutes).toBe(60)
    expect(coachPhaseDef('loop').targetMaxMinutes).toBe(90)
    expect(coachPhaseDef('arrangement').targetMinMinutes).toBe(120)
    expect(coachPhaseDef('arrangement').targetMaxMinutes).toBe(180)
    expect(coachPhaseDef('polish').targetMinMinutes).toBe(45)
    expect(coachPhaseDef('polish').targetMaxMinutes).toBe(60)
  })
})

describe('coach steps', () => {
  it('starts at the first row of the table', () => {
    expect(FIRST_COACH_STEP_ID).toBe(COACH_STEPS[0].id)
  })

  it('looks a step up by id, and returns undefined for an unknown one', () => {
    expect(coachStepById('climax-loop')?.phase).toBe('loop')
    expect(coachStepById('not-a-step')).toBeUndefined()
  })

  it('walks the table in order and ends at null', () => {
    const visited: string[] = [FIRST_COACH_STEP_ID]
    let id = nextCoachStepId(FIRST_COACH_STEP_ID)
    while (id !== null) {
      visited.push(id)
      id = nextCoachStepId(id)
    }
    expect(visited).toEqual(COACH_STEPS.map((step) => step.id))
  })

  it('groups steps by phase without losing any', () => {
    const grouped = COACH_PHASES.flatMap((phase) => coachStepsInPhase(phase.id))
    expect(grouped.map((step) => step.id).sort()).toEqual(
      COACH_STEPS.map((step) => step.id).sort()
    )
  })

  it('narrows a persisted string to a known step id', () => {
    expect(isCoachStepId('sections')).toBe(true)
    expect(isCoachStepId('sectionz')).toBe(false)
    expect(isCoachStepId(42)).toBe(false)
  })

  it('gives every step at least three hand-written line variants', () => {
    for (const step of COACH_STEPS) {
      expect(step.lines.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every line inside the app copy rules: lowercase start, no emoji, no exclamation', () => {
    for (const step of COACH_STEPS) {
      for (const line of step.lines) {
        expect(line).not.toMatch(/!/)
        expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(line[0]).toBe(line[0].toLowerCase())
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: FAIL — `Failed to resolve import "./coachSteps"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachSteps.ts`:

```ts
/**
 * What the guided flow IS, as plain data.
 *
 * Everything sssketchy can say and every place the flow can be is a row in
 * COACH_STEPS below -- the state machine in ./coach.ts only ever walks this
 * table, so the later phase plans (docs/superpowers/specs/
 * 2026-09-22-sssketchy-guided-track-design.md, build order 2/3/4) add their
 * steps by APPENDING ROWS and extending the CoachStepId union, without
 * reshaping the machine, the store, the persistence or the panel.
 *
 * The three steps shipped here are deliberate PLACEHOLDERS -- one per phase,
 * so the shell can be started, stepped through, minimised, dismissed and
 * resumed end to end before any phase logic exists. They carry real,
 * hand-written copy rather than lorem, because the copy is the part that has
 * to be reviewed by a person and the placeholder lines are all still true by
 * construction (they describe the METHOD, never the user's music -- see the
 * spec's "What he is allowed to say").
 */

export type CoachPhase = 'loop' | 'arrangement' | 'polish'

export interface CoachPhaseDef {
  id: CoachPhase
  /** Shown in the checklist. Lowercase, like all UI copy in this app. */
  label: string
  /** The spec's own phase targets ("loop 60-90 min, arrangement 2-3 h,
   * polish 45-60 min"), in minutes. Shown in the checklist as a target, and
   * never enforced: the timer in this feature nudges, it never blocks and
   * never auto-advances. */
  targetMinMinutes: number
  targetMaxMinutes: number
}

const COACH_PHASE_BY_ID: Record<CoachPhase, CoachPhaseDef> = {
  loop: { id: 'loop', label: 'the climax loop', targetMinMinutes: 60, targetMaxMinutes: 90 },
  arrangement: {
    id: 'arrangement',
    label: 'the arrangement',
    targetMinMinutes: 120,
    targetMaxMinutes: 180
  },
  polish: { id: 'polish', label: 'polish and export', targetMinMinutes: 45, targetMaxMinutes: 60 }
}

export const COACH_PHASES: readonly CoachPhaseDef[] = [
  COACH_PHASE_BY_ID.loop,
  COACH_PHASE_BY_ID.arrangement,
  COACH_PHASE_BY_ID.polish
]

/** Total, by construction -- CoachPhase is a closed union over the record's
 * own keys, so there is no "unknown phase" branch to get wrong. */
export function coachPhaseDef(phase: CoachPhase): CoachPhaseDef {
  return COACH_PHASE_BY_ID[phase]
}

/** Every step the flow can be on. A closed union rather than a bare string
 * so a typo in a later phase plan is a typecheck failure -- persisted
 * values are validated back into it by isCoachStepId (a .sssketchproj is
 * plain JSON people can and do hand-edit; a load must never throw). */
export type CoachStepId = 'climax-loop' | 'sections' | 'finish'

/** One concrete move a step can make on the user's behalf. Surfaced by the
 * bubble's "stuck?" button, which "surfaces concrete moves this step can
 * make... It never produces a judgement" (spec). The phase plans give these
 * real behaviour keyed off `id`; the framework only needs to list them. */
export interface CoachMove {
  id: string
  /** Phrased as an offer, e.g. 'duplicate this section'. Lowercase. */
  label: string
}

export interface CoachStepDef {
  id: CoachStepId
  phase: CoachPhase
  /** The checklist's own one-liner for this step. */
  label: string
  /** 3-4 hand-written variants of this step's bubble line, rotated
   * deterministically by CoachState.lineSeed (see ./coachLines.ts's
   * pickLineVariant). "Repeating himself word-for-word is most of what
   * makes a character feel dead" (spec). */
  lines: readonly string[]
  /** Empty here: the placeholder steps genuinely have nothing to automate
   * yet, and an invented move would be a lie in the one part of this
   * feature that must never guess. The phase plans fill these in. */
  moves: readonly CoachMove[]
  /** CSS selector for the element this step is about -- sssketchy stands on
   * the bottom edge near it, and WALKS when it changes between steps (spec:
   * "walk = moving to another area (Discover -> timeline)"). Same
   * look-it-up-fresh approach TourOverlay.tsx already uses for the same
   * reason: targets live in unrelated components with no shared parent
   * worth threading refs through. Unset on every placeholder step, so the
   * framework's own steps all park in the bottom-left corner. */
  anchorSelector?: string
}

export const COACH_STEPS: readonly CoachStepDef[] = [
  {
    id: 'climax-loop',
    phase: 'loop',
    label: 'build the climax loop',
    lines: [
      'phase one: the loudest bar of the track. build that loop first, everything else gets carved out of it.',
      'start at the drop. the fullest version of the song is the one you build first.',
      'phase one is the climax loop. every other section is this one with things taken away.',
      'first job: the part where everything is playing. that loop is the material for the rest.'
    ],
    moves: []
  },
  {
    id: 'sections',
    phase: 'arrangement',
    label: 'carve the sections',
    lines: [
      'phase two: sections, one at a time. each one is the climax loop with stems turned off.',
      'now you carve. name a section, pick its length, decide what drops out.',
      'phase two builds the arrangement section by section. everything is on until you subtract.',
      'one section at a time from here. the loop you locked is the full version of each one.'
    ],
    moves: []
  },
  {
    id: 'finish',
    phase: 'polish',
    label: 'finish and export a v1',
    lines: [
      'phase three: transitions, a balance pass, then a v1 out the door.',
      'last phase. smooth the joins, check the levels, export something you can listen to.',
      'phase three is finishing. risers into the drops, a balance check, then export.',
      'nearly there. tension at the boundaries, one listen through, then v1.'
    ],
    moves: []
  }
]

export const FIRST_COACH_STEP_ID: CoachStepId = COACH_STEPS[0].id

const COACH_STEP_IDS = new Set<string>(COACH_STEPS.map((step) => step.id))

export function isCoachStepId(value: unknown): value is CoachStepId {
  return typeof value === 'string' && COACH_STEP_IDS.has(value)
}

/** Takes a bare string (not a CoachStepId) because the caller is often
 * reading a persisted value; returns undefined rather than throwing. */
export function coachStepById(id: string): CoachStepDef | undefined {
  return COACH_STEPS.find((step) => step.id === id)
}

/** The next row in the table, or null when this is the last step -- which
 * is what ends the flow (see advanceCoach in ./coach.ts). */
export function nextCoachStepId(id: CoachStepId): CoachStepId | null {
  const index = COACH_STEPS.findIndex((step) => step.id === id)
  if (index < 0 || index >= COACH_STEPS.length - 1) return null
  return COACH_STEPS[index + 1].id
}

export function coachStepsInPhase(phase: CoachPhase): readonly CoachStepDef[] {
  return COACH_STEPS.filter((step) => step.phase === phase)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachSteps.ts src/shared/coachSteps.test.ts
git commit -m "$(cat <<'EOF'
Write the guided flow down as a table, not as code

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 2: Deterministic line variants (`coachLines.ts`)

**Files:**
- Create: `src/shared/coachLines.ts`
- Test: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachLines.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COACH_DONE_LINES,
  COACH_NO_MOVES_LINES,
  COACH_STUCK_LINES,
  pickLineVariant
} from './coachLines'

describe('pickLineVariant', () => {
  const variants = ['one', 'two', 'three']

  it('picks by seed, not at random -- the same seed always gives the same line', () => {
    expect(pickLineVariant(variants, 0)).toBe('one')
    expect(pickLineVariant(variants, 0)).toBe('one')
    expect(pickLineVariant(variants, 1)).toBe('two')
    expect(pickLineVariant(variants, 2)).toBe('three')
  })

  it('wraps around the table', () => {
    expect(pickLineVariant(variants, 3)).toBe('one')
    expect(pickLineVariant(variants, 7)).toBe('two')
  })

  it('survives a negative seed rather than returning undefined', () => {
    expect(pickLineVariant(variants, -1)).toBe('three')
  })

  it('returns an empty string for an empty table rather than throwing', () => {
    expect(pickLineVariant([], 3)).toBe('')
  })
})

describe('the shared line tables', () => {
  const tables = [COACH_STUCK_LINES, COACH_NO_MOVES_LINES, COACH_DONE_LINES]

  it('each give at least three variants', () => {
    for (const table of tables) expect(table.length).toBeGreaterThanOrEqual(3)
  })

  it('obey the copy rules: lowercase start, no emoji, no exclamation marks', () => {
    for (const table of tables) {
      for (const line of table) {
        expect(line).not.toMatch(/!/)
        expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(line[0]).toBe(line[0].toLowerCase())
      }
    }
  })

  it('never claims to have an opinion about the music', () => {
    for (const table of tables) {
      for (const line of table) {
        expect(line).not.toMatch(/it looks like/i)
        expect(line).not.toMatch(/your track needs/i)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: FAIL — `Failed to resolve import "./coachLines"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachLines.ts`:

```ts
/**
 * sssketchy's vocabulary, and the one rule for choosing from it.
 *
 * Two things are load-bearing here:
 *
 * 1. **The pick is SEEDED, never random.** Math.random would reshuffle the
 *    line on every React re-render, so the bubble would visibly rewrite
 *    itself while the user was reading it, and no test could pin a string.
 *    pickLineVariant is a modulo index over CoachState.lineSeed, which is
 *    bumped exactly once per step transition (see ./coach.ts) -- so a line
 *    is stable for as long as its thought is, and rotates when the thought
 *    does.
 *
 * 2. **The copy is hand-written.** An external model was considered and
 *    declined for this build (spec, "Considered and declined: an external
 *    LLM"): it cannot hear the audio, so it would paraphrase facts the app
 *    already has and occasionally invent one. Hand-written copy is wrong
 *    zero percent of the time, and "vocabulary is cheap... the one part of
 *    'alive' we can buy without any inference".
 *
 * Everything here therefore describes the METHOD or the flow's own
 * mechanics. Nothing here has an opinion about the user's music.
 */

/** The variant at `seed`, wrapping, and tolerant of a negative or
 * out-of-range seed (lineSeed is persisted, so a hand-edited project file
 * can hand us anything). '' for an empty table, so a caller renders nothing
 * rather than crashing. */
export function pickLineVariant(variants: readonly string[], seed: number): string {
  if (variants.length === 0) return ''
  const index = ((Math.trunc(seed) % variants.length) + variants.length) % variants.length
  return variants[index]
}

/** The ~10-minute nudge. Triggered by elapsed clock time, which is "a fact,
 * not a guess about the music" (spec) -- the single exception to "the step
 * triggers him, not a heuristic". Every one of these offers only the step
 * actions the bubble already has. */
export const COACH_STUCK_LINES: readonly string[] = [
  'stuck? try "do it for me", or move on.',
  'been a while on this one. "do it for me" is there, and skipping is fine.',
  'no rush. there is a "do it for me" up there, and skip costs you nothing.',
  'this one can be done for you, or skipped. both are ok.'
]

/** What "stuck?" says on a step that genuinely has no moves to offer. Says
 * so plainly rather than inventing one. */
export const COACH_NO_MOVES_LINES: readonly string[] = [
  'nothing i can do for you on this step yet.',
  'no moves on this one. next or skip when you are ready.',
  'no shortcuts here yet. this one is yours.',
  'nothing automatic on this step.'
]

/** The end of the flow. */
export const COACH_DONE_LINES: readonly string[] = [
  'that is the whole method. the rest is listening.',
  'flow finished. everything here is ordinary material now, edit it however you like.',
  'done. nothing here is locked, it is all normal clips.',
  'that is a v1. go and listen to it.'
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachLines.ts src/shared/coachLines.test.ts
git commit -m "$(cat <<'EOF'
Give him four ways to say each thing, and pick one on purpose

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 3: The state machine's transitions (`coach.ts`, part 1)

**Files:**
- Create: `src/shared/coach.ts`
- Test: `src/shared/coach.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coach.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  advanceCoach,
  dismissCoach,
  minimiseCoach,
  pauseCoach,
  restoreCoach,
  resumeCoach,
  startCoach
} from './coach'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

describe('startCoach', () => {
  it('starts active, on the first step, with the clock running', () => {
    const coach = startCoach(T0)
    expect(coach.status).toBe('active')
    expect(coach.stepId).toBe('climax-loop')
    expect(coach.outcomes).toEqual({})
    expect(coach.phaseElapsedMs).toEqual({ loop: 0, arrangement: 0, polish: 0 })
    expect(coach.stepElapsedMs).toBe(0)
    expect(coach.runningSince).toBe(T0)
    expect(coach.lineSeed).toBe(0)
  })
})

describe('pauseCoach', () => {
  it('folds the running span into the step and its phase, and stops the clock', () => {
    const paused = pauseCoach(startCoach(T0), T0 + 5 * MINUTE)
    expect(paused.stepElapsedMs).toBe(5 * MINUTE)
    expect(paused.phaseElapsedMs.loop).toBe(5 * MINUTE)
    expect(paused.phaseElapsedMs.arrangement).toBe(0)
    expect(paused.runningSince).toBeNull()
  })

  it('is idempotent -- pausing an already-paused flow adds nothing', () => {
    const once = pauseCoach(startCoach(T0), T0 + 5 * MINUTE)
    const twice = pauseCoach(once, T0 + 99 * MINUTE)
    expect(twice).toEqual(once)
  })
})

describe('resumeCoach', () => {
  it('brings a dismissed flow back, on the same step, with its progress intact', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 5 * MINUTE)
    const resumed = resumeCoach(dismissed, T0 + 60 * MINUTE)
    expect(resumed.status).toBe('active')
    expect(resumed.stepId).toBe('climax-loop')
    expect(resumed.stepElapsedMs).toBe(5 * MINUTE)
    expect(resumed.runningSince).toBe(T0 + 60 * MINUTE)
  })

  it('does not restart the clock on an already-running flow', () => {
    const running = startCoach(T0)
    expect(resumeCoach(running, T0 + 9 * MINUTE).runningSince).toBe(T0)
  })

  it('leaves a finished flow alone -- there is nothing left to resume', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(coach.status).toBe('finished')
    expect(resumeCoach(coach, T0 + 99 * MINUTE)).toEqual(coach)
  })
})

describe('advanceCoach', () => {
  it('records how the step was passed, moves on, and restarts the step clock', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'done')
    expect(next.outcomes).toEqual({ 'climax-loop': 'done' })
    expect(next.stepId).toBe('sections')
    expect(next.stepElapsedMs).toBe(0)
    expect(next.runningSince).toBe(T0 + 8 * MINUTE)
    expect(next.status).toBe('active')
  })

  it('banks the time against the phase the step belonged to, not the new one', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'skipped')
    expect(next.phaseElapsedMs.loop).toBe(8 * MINUTE)
    expect(next.phaseElapsedMs.arrangement).toBe(0)
    expect(next.outcomes).toEqual({ 'climax-loop': 'skipped' })
  })

  it('rotates the line seed so the next step does not reuse this one variant index', () => {
    expect(advanceCoach(startCoach(T0), T0 + MINUTE, 'done').lineSeed).toBe(1)
  })

  it('finishes the flow after the last step, with the clock stopped', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(coach.status).toBe('finished')
    expect(coach.stepId).toBe('finish')
    expect(coach.runningSince).toBeNull()
    expect(coach.outcomes).toEqual({
      'climax-loop': 'done',
      sections: 'done',
      finish: 'done'
    })
  })
})

describe('minimiseCoach / restoreCoach', () => {
  it('minimising keeps the clock running -- it is still the step you are on', () => {
    const minimised = minimiseCoach(startCoach(T0))
    expect(minimised.status).toBe('minimised')
    expect(minimised.runningSince).toBe(T0)
  })

  it('restoring brings the bubble back', () => {
    const restored = restoreCoach(minimiseCoach(startCoach(T0)), T0 + MINUTE)
    expect(restored.status).toBe('active')
    expect(restored.runningSince).toBe(T0)
  })

  it('restoring a dismissed flow does nothing -- that is resumeCoach s job', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + MINUTE)
    expect(restoreCoach(dismissed, T0 + 2 * MINUTE)).toEqual(dismissed)
  })
})

describe('dismissCoach', () => {
  it('ends the flow visually and stops the clock, keeping every bit of progress', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 5 * MINUTE)
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.runningSince).toBeNull()
    expect(dismissed.stepElapsedMs).toBe(5 * MINUTE)
    expect(dismissed.stepId).toBe('climax-loop')
  })

  it('leaves a finished flow finished', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(dismissCoach(coach, T0 + 4 * MINUTE)).toEqual(coach)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: FAIL — `Failed to resolve import "./coach"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coach.ts`:

```ts
/**
 * The guided flow's state machine -- pure, framework-agnostic, and the only
 * thing that decides where sssketchy is and what he is saying. The panel,
 * the sprite and the checklist are thin renderers over this (spec: "All step
 * transitions, suggestion tables and completion checks are pure functions
 * with tests; the panel/sprite is a thin renderer").
 *
 * Two shapes here are deliberate and worth reading before changing:
 *
 * **Time is injected, always.** Every transition and every getter takes
 * `now: number`. Nothing in this file calls Date.now(). That is what lets
 * the reducer's own tests (state/store.test.ts) pin a timestamp, and it is
 * why every coach Action carries a `now` field.
 *
 * **Elapsed time is an accumulator plus one open span.** `stepElapsedMs` and
 * `phaseElapsedMs` hold time already BANKED, and `runningSince` is the start
 * of the currently-open span, or null when the clock is stopped. Storing an
 * accumulator rather than a start timestamp is what makes the numbers
 * survive being saved to disk and reopened a week later: on load the open
 * span is simply dropped (sanitiseLoadedCoach) instead of turning into seven
 * days of "time on this step" and firing the stuck nudge instantly.
 */

import {
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachStepById,
  isCoachStepId,
  nextCoachStepId,
  type CoachPhase,
  type CoachStepId
} from './coachSteps'

/** 'active' shows the bubble; 'minimised' shows only the corner sprite (the
 * clock keeps running -- you are still on this step, just not looking at
 * him); 'dismissed' hides him entirely and stops the clock, resumable from
 * the project-menu button; 'finished' is the terminal state after the last
 * step. */
export type CoachStatus = 'active' | 'minimised' | 'dismissed' | 'finished'

/** How a step was left. Both are first-class: "next/skip always available"
 * (spec), and a skipped step is not a failure, just a step you did your own
 * way. */
export type CoachOutcome = 'done' | 'skipped'

export interface CoachState {
  status: CoachStatus
  stepId: CoachStepId
  /** step id -> how it was left. A plain Record (not a pair of arrays) so a
   * later phase plan adding steps needs no migration: an id that is not a
   * key simply has not been reached. */
  outcomes: Record<string, CoachOutcome>
  /** Time BANKED per phase, excluding the currently-open span. */
  phaseElapsedMs: Record<CoachPhase, number>
  /** Time BANKED on the current step, excluding the currently-open span. */
  stepElapsedMs: number
  /** Start of the currently-open span, or null when the clock is stopped. */
  runningSince: number | null
  /** Which variant of the current step's lines to show. Bumped once per
   * transition -- see ./coachLines.ts for why this is not Math.random. */
  lineSeed: number
}

/** The spec's "after ~10 minutes on one step, a quiet nudge". Never blocks,
 * never auto-advances. */
export const COACH_STUCK_AFTER_MS = 10 * 60 * 1000

function emptyPhaseElapsed(): Record<CoachPhase, number> {
  return { loop: 0, arrangement: 0, polish: 0 }
}

export function startCoach(now: number): CoachState {
  return {
    status: 'active',
    stepId: FIRST_COACH_STEP_ID,
    outcomes: {},
    phaseElapsedMs: emptyPhaseElapsed(),
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: 0
  }
}

/** Banks the currently-open span and stops the clock. Idempotent: a flow
 * whose clock is already stopped comes back unchanged. */
export function pauseCoach(state: CoachState, now: number): CoachState {
  if (state.runningSince === null) return state
  const span = Math.max(0, now - state.runningSince)
  const phase = coachStepById(state.stepId)?.phase ?? COACH_STEPS[0].phase
  return {
    ...state,
    stepElapsedMs: state.stepElapsedMs + span,
    phaseElapsedMs: { ...state.phaseElapsedMs, [phase]: state.phaseElapsedMs[phase] + span },
    runningSince: null
  }
}

/** The project-menu button's "resume a half-finished flow". Restarts the
 * clock only if it was stopped, so pressing the button while he is already
 * on screen is harmless. A finished flow has nothing to resume. */
export function resumeCoach(state: CoachState, now: number): CoachState {
  if (state.status === 'finished') return state
  return { ...state, status: 'active', runningSince: state.runningSince ?? now }
}

/** next (outcome 'done') and skip (outcome 'skipped') are the same
 * transition with a different record of how it happened -- the flow must
 * never treat skipping as an error path. */
export function advanceCoach(state: CoachState, now: number, outcome: CoachOutcome): CoachState {
  const banked = pauseCoach(state, now)
  const outcomes = { ...banked.outcomes, [banked.stepId]: outcome }
  const nextId = nextCoachStepId(banked.stepId)
  if (nextId === null) {
    return { ...banked, outcomes, status: 'finished', stepElapsedMs: 0, lineSeed: banked.lineSeed + 1 }
  }
  return {
    ...banked,
    outcomes,
    stepId: nextId,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/** Takes no `now`: minimising does not move the clock. You are still on this
 * step, he is just out of the way. */
export function minimiseCoach(state: CoachState): CoachState {
  return state.status === 'active' ? { ...state, status: 'minimised' } : state
}

/** The minimised sprite's way back to the bubble. Deliberately narrow --
 * bringing back a DISMISSED flow is resumeCoach, which is what the
 * project-menu button calls. */
export function restoreCoach(state: CoachState, now: number): CoachState {
  if (state.status !== 'minimised') return state
  return { ...state, status: 'active', runningSince: state.runningSince ?? now }
}

/** "he can be... dismissed (which ends the guided flow, resumable later)"
 * (spec). Everything about where you were is kept; only the clock and his
 * presence stop. */
export function dismissCoach(state: CoachState, now: number): CoachState {
  if (state.status === 'dismissed' || state.status === 'finished') return state
  return { ...pauseCoach(state, now), status: 'dismissed' }
}

/** Exported so ./coach.ts's own consumers can validate a persisted id
 * without importing two modules. */
export { isCoachStepId }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: PASS — 14 passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coach.ts src/shared/coach.test.ts
git commit -m "$(cat <<'EOF'
Start, step, minimise, dismiss -- one small guy, one thought

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 4: Elapsed time, the stuck nudge, the line, and the animation (`coach.ts`, part 2)

**Files:**
- Modify: `src/shared/coach.ts` (append)
- Test: `src/shared/coach.test.ts` (append)

- [ ] **Step 1: Write the failing test**

First, replace the existing import block at the top of `src/shared/coach.test.ts` with this one (it
adds the seven new names plus two new module imports):

```ts
import { describe, expect, it } from 'vitest'
import {
  COACH_STUCK_AFTER_MS,
  advanceCoach,
  coachAnimation,
  coachLine,
  coachPhaseElapsedMs,
  coachStepElapsedMs,
  dismissCoach,
  isCoachStuck,
  minimiseCoach,
  pauseCoach,
  restoreCoach,
  resumeCoach,
  sanitiseLoadedCoach,
  startCoach
} from './coach'
import { COACH_DONE_LINES, COACH_STUCK_LINES } from './coachLines'
import { COACH_STEPS } from './coachSteps'
```

Then append these describe blocks to the end of the same file:

```ts
describe('elapsed time', () => {
  it('counts the open span on top of what is already banked', () => {
    const coach = startCoach(T0)
    expect(coachStepElapsedMs(coach, T0 + 3 * MINUTE)).toBe(3 * MINUTE)
    expect(coachPhaseElapsedMs(coach, 'loop', T0 + 3 * MINUTE)).toBe(3 * MINUTE)
  })

  it('counts the open span only against the phase the current step is in', () => {
    const coach = startCoach(T0)
    expect(coachPhaseElapsedMs(coach, 'arrangement', T0 + 3 * MINUTE)).toBe(0)
  })

  it('stops counting once the clock is stopped', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 3 * MINUTE)
    expect(coachStepElapsedMs(dismissed, T0 + 99 * MINUTE)).toBe(3 * MINUTE)
    expect(coachPhaseElapsedMs(dismissed, 'loop', T0 + 99 * MINUTE)).toBe(3 * MINUTE)
  })

  it('carries banked phase time across a step change', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'done')
    expect(coachPhaseElapsedMs(next, 'loop', T0 + 10 * MINUTE)).toBe(8 * MINUTE)
    expect(coachPhaseElapsedMs(next, 'arrangement', T0 + 10 * MINUTE)).toBe(2 * MINUTE)
  })
})

describe('isCoachStuck', () => {
  it('is false before the threshold and true at it', () => {
    const coach = startCoach(T0)
    expect(isCoachStuck(coach, T0 + COACH_STUCK_AFTER_MS - 1)).toBe(false)
    expect(isCoachStuck(coach, T0 + COACH_STUCK_AFTER_MS)).toBe(true)
  })

  it('never fires while he is not on screen', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 30 * MINUTE)
    expect(isCoachStuck(dismissed, T0 + 99 * MINUTE)).toBe(false)
  })

  it('resets when the step changes', () => {
    const next = advanceCoach(startCoach(T0), T0 + 30 * MINUTE, 'skipped')
    expect(isCoachStuck(next, T0 + 31 * MINUTE)).toBe(false)
  })
})

describe('coachLine', () => {
  it('reads the current step s variants at the current seed', () => {
    expect(coachLine(startCoach(T0))).toBe(COACH_STEPS[0].lines[0])
    const next = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    expect(coachLine(next)).toBe(COACH_STEPS[1].lines[1 % COACH_STEPS[1].lines.length])
  })

  it('switches to the sign-off once the flow is finished', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(COACH_DONE_LINES).toContain(coachLine(coach))
  })
})

describe('coachAnimation', () => {
  const base = {
    status: 'active' as const,
    working: false,
    moving: false,
    justAdvanced: false,
    stuck: false
  }

  it('bobs by default', () => {
    expect(coachAnimation(base)).toBe('idle')
  })

  it('climbs while the app is doing work, ahead of everything else', () => {
    expect(coachAnimation({ ...base, working: true, moving: true, stuck: true })).toBe('climb')
  })

  it('walks when moving to another area', () => {
    expect(coachAnimation({ ...base, moving: true, stuck: true })).toBe('walk')
  })

  it('jumps on a finished step and on a finished flow', () => {
    expect(coachAnimation({ ...base, justAdvanced: true })).toBe('jump')
    expect(coachAnimation({ ...base, status: 'finished' })).toBe('jump')
  })

  it('takes a hit on the stuck nudge', () => {
    expect(coachAnimation({ ...base, stuck: true })).toBe('hit')
  })
})

describe('sanitiseLoadedCoach', () => {
  it('drops a non-object, so a hand-edited file cannot crash a load', () => {
    expect(sanitiseLoadedCoach(null)).toBeNull()
    expect(sanitiseLoadedCoach('nope')).toBeNull()
    expect(sanitiseLoadedCoach(undefined)).toBeNull()
  })

  it('hides a loaded flow and stops its clock -- he never appears on his own', () => {
    const saved = startCoach(T0)
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.status).toBe('dismissed')
    expect(loaded?.runningSince).toBeNull()
  })

  it('keeps every bit of progress across the load', () => {
    const saved = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'skipped')
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.stepId).toBe('sections')
    expect(loaded?.outcomes).toEqual({ 'climax-loop': 'skipped' })
    expect(loaded?.phaseElapsedMs.loop).toBe(8 * MINUTE)
    expect(loaded?.lineSeed).toBe(1)
  })

  it('leaves a finished flow finished', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(sanitiseLoadedCoach(JSON.parse(JSON.stringify(coach)))?.status).toBe('finished')
  })

  it('repairs a hand-edited file rather than throwing', () => {
    const loaded = sanitiseLoadedCoach({
      status: 'banana',
      stepId: 'not-a-step',
      outcomes: { sections: 'maybe', finish: 'done' },
      phaseElapsedMs: { loop: 'lots' },
      stepElapsedMs: -5,
      runningSince: 999,
      lineSeed: 1.7
    })
    expect(loaded).toEqual({
      status: 'dismissed',
      stepId: 'climax-loop',
      outcomes: { finish: 'done' },
      phaseElapsedMs: { loop: 0, arrangement: 0, polish: 0 },
      stepElapsedMs: 0,
      runningSince: null,
      lineSeed: 1
    })
  })
})

describe('the stuck nudge line', () => {
  it('comes off the shared table at the step s own seed', () => {
    expect(COACH_STUCK_LINES).toContain(COACH_STUCK_LINES[0])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: FAIL — `coachStepElapsedMs is not a function` (and the other new names are undefined).

- [ ] **Step 3: Write the implementation**

First, add one import line to the top of `src/shared/coach.ts`, above the existing
`import { COACH_STEPS, ... } from './coachSteps'` block (these two names are used only by the code
added below, which is why Task 3 did not import them):

```ts
import { COACH_DONE_LINES, pickLineVariant } from './coachLines'
```

Then append to `src/shared/coach.ts`:

```ts
/** Time on the current step: what is banked, plus the open span if the
 * clock is running. */
export function coachStepElapsedMs(state: CoachState, now: number): number {
  const open = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince)
  return state.stepElapsedMs + open
}

/** Time in one phase. The open span counts only against the phase the
 * CURRENT step belongs to -- every other phase's number is already final. */
export function coachPhaseElapsedMs(state: CoachState, phase: CoachPhase, now: number): number {
  const banked = state.phaseElapsedMs[phase] ?? 0
  const currentPhase = coachStepById(state.stepId)?.phase
  const open =
    state.runningSince === null || currentPhase !== phase
      ? 0
      : Math.max(0, now - state.runningSince)
  return banked + open
}

/** Only ever true while he is actually on screen and working a step -- a
 * minimised sprite can still nudge (you are still on the step), a dismissed
 * or finished one cannot. */
export function isCoachStuck(state: CoachState, now: number): boolean {
  if (state.status !== 'active' && state.status !== 'minimised') return false
  return coachStepElapsedMs(state, now) >= COACH_STUCK_AFTER_MS
}

/** The one thought currently on screen. "A new step's text replaces the old
 * one; nothing stacks" (spec) -- which is enforced by this being a single
 * string derived from the single current step, with nowhere for a second
 * one to live. */
export function coachLine(state: CoachState): string {
  const step = coachStepById(state.stepId)
  if (state.status === 'finished' || step === undefined) {
    return pickLineVariant(COACH_DONE_LINES, state.lineSeed)
  }
  return pickLineVariant(step.lines, state.lineSeed)
}

/** The sprite frame sets that exist under
 * src/renderer/src/assets/sssketchy/. The spec's death frames are
 * deliberately not here: "Death frames unused." */
export type SssketchyAnimation = 'idle' | 'walk' | 'jump' | 'hit' | 'climb'

export interface CoachAnimationInput {
  status: CoachStatus
  /** The app is doing work on this step's behalf (building a section,
   * exporting). Always false in the framework build -- nothing here starts
   * work yet; the phase plans pass it for real. */
  working: boolean
  /** The sprite is travelling to a new anchor. */
  moving: boolean
  /** A short window just after a step was completed. */
  justAdvanced: boolean
  stuck: boolean
}

/**
 * The spec's animation table, in precedence order:
 * "idle = bob; walk = moving to another area; jump = step finished, big jump
 * at V1; hit = the 'stuck?' nudge and errors; climb = while the app works".
 *
 * The order matters where two are true at once, and this is the reasoning:
 * `working` wins over everything because it is the only one that reports a
 * fact about the machine rather than about the flow -- showing a walk while
 * a render is running would tell the user nothing is happening. `moving`
 * then wins over `justAdvanced` because a step that finished AND moved him
 * somewhere else is, from the user's point of view, mostly a journey.
 * `stuck` is last: it is the quietest signal and must never interrupt a
 * louder true one.
 */
export function coachAnimation(input: CoachAnimationInput): SssketchyAnimation {
  if (input.status === 'finished') return 'jump'
  if (input.working) return 'climb'
  if (input.moving) return 'walk'
  if (input.justAdvanced) return 'jump'
  if (input.stuck) return 'hit'
  return 'idle'
}

function finiteMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return value
}

function loadedOutcomes(value: unknown): Record<string, CoachOutcome> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, CoachOutcome> = {}
  for (const [id, outcome] of Object.entries(value as Record<string, unknown>)) {
    if (outcome === 'done' || outcome === 'skipped') out[id] = outcome
  }
  return out
}

/**
 * Turns whatever a `.sssketchproj` actually contains into a CoachState the
 * app can run, or null.
 *
 * Two deliberate, load-bearing rules:
 *
 * **A loaded flow is always hidden.** "Button only (Elling's decision) --
 * sssketchy never appears on his own, not even on an empty project." So a
 * flow saved mid-step comes back 'dismissed', and the project-menu button
 * resumes it exactly where it was. 'finished' is left alone: it is terminal
 * and already invisible in the same way.
 *
 * **A loaded flow's clock is always stopped.** `runningSince` is an absolute
 * timestamp from a previous session; keeping it would turn "I closed this
 * last Tuesday" into six days on one step and fire the stuck nudge the
 * instant the project opened. Everything BANKED survives, which is the part
 * that is actually about the user's work.
 *
 * Everything else is repaired rather than trusted, for the same reason
 * serialize.ts's own legacy readers are: a `.sssketchproj` is plain JSON
 * that people can and do hand-edit, and a load must never throw.
 */
export function sanitiseLoadedCoach(coach: unknown): CoachState | null {
  if (typeof coach !== 'object' || coach === null) return null
  const loose = coach as Record<string, unknown>
  const phase = (loose.phaseElapsedMs ?? {}) as Record<string, unknown>
  return {
    status: loose.status === 'finished' ? 'finished' : 'dismissed',
    stepId: isCoachStepId(loose.stepId) ? loose.stepId : FIRST_COACH_STEP_ID,
    outcomes: loadedOutcomes(loose.outcomes),
    phaseElapsedMs: {
      loop: finiteMs(phase.loop),
      arrangement: finiteMs(phase.arrangement),
      polish: finiteMs(phase.polish)
    },
    stepElapsedMs: finiteMs(loose.stepElapsedMs),
    runningSince: null,
    lineSeed: typeof loose.lineSeed === 'number' && Number.isFinite(loose.lineSeed)
      ? Math.trunc(loose.lineSeed)
      : 0
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: PASS — 30 passed.

- [ ] **Step 5: Typecheck and lint the shared layer**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0, no output beyond tsc's silence and eslint's.

- [ ] **Step 6: Commit**

```bash
git add src/shared/coach.ts src/shared/coach.test.ts
git commit -m "$(cat <<'EOF'
Ten minutes on one step is a fact, not an opinion

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 5: The store field and its six actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/state/store.test.ts`:

```ts
describe('the guided flow (sssketchy)', () => {
  const NOW = 1_700_000_000_000
  const MINUTE = 60_000

  it('has no flow until one is started', () => {
    expect(initialState.coach).toBeNull()
  })

  it('COACH_START begins a flow on the first step', () => {
    const state = reducer(initialState, { type: 'COACH_START', now: NOW })
    expect(state.coach?.status).toBe('active')
    expect(state.coach?.stepId).toBe('climax-loop')
  })

  it('COACH_START restarts a finished flow rather than reviving it mid-step', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, { type: 'COACH_ADVANCE', now: NOW + MINUTE, outcome: 'done' })
    state = reducer(state, { type: 'COACH_ADVANCE', now: NOW + 2 * MINUTE, outcome: 'done' })
    state = reducer(state, { type: 'COACH_ADVANCE', now: NOW + 3 * MINUTE, outcome: 'done' })
    expect(state.coach?.status).toBe('finished')
    state = reducer(state, { type: 'COACH_START', now: NOW + 4 * MINUTE })
    expect(state.coach?.stepId).toBe('climax-loop')
    expect(state.coach?.outcomes).toEqual({})
  })

  it('COACH_ADVANCE records next and skip differently', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, { type: 'COACH_ADVANCE', now: NOW + MINUTE, outcome: 'skipped' })
    expect(state.coach?.stepId).toBe('sections')
    expect(state.coach?.outcomes).toEqual({ 'climax-loop': 'skipped' })
  })

  it('COACH_MINIMISE, COACH_RESTORE, COACH_DISMISS and COACH_RESUME move the status', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, { type: 'COACH_MINIMISE' })
    expect(state.coach?.status).toBe('minimised')
    state = reducer(state, { type: 'COACH_RESTORE', now: NOW + MINUTE })
    expect(state.coach?.status).toBe('active')
    state = reducer(state, { type: 'COACH_DISMISS', now: NOW + 2 * MINUTE })
    expect(state.coach?.status).toBe('dismissed')
    state = reducer(state, { type: 'COACH_RESUME', now: NOW + 3 * MINUTE })
    expect(state.coach?.status).toBe('active')
    expect(state.coach?.stepId).toBe('climax-loop')
  })

  it('every coach action but START is a no-op when no flow exists', () => {
    expect(reducer(initialState, { type: 'COACH_RESUME', now: NOW }).coach).toBeNull()
    expect(
      reducer(initialState, { type: 'COACH_ADVANCE', now: NOW, outcome: 'done' }).coach
    ).toBeNull()
    expect(reducer(initialState, { type: 'COACH_MINIMISE' }).coach).toBeNull()
    expect(reducer(initialState, { type: 'COACH_RESTORE', now: NOW }).coach).toBeNull()
    expect(reducer(initialState, { type: 'COACH_DISMISS', now: NOW }).coach).toBeNull()
  })
})
```

Check the top of `src/renderer/src/state/store.test.ts` — if `initialState` and `reducer` are not already imported there, add them to the existing import from `./store`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `expected undefined to be null` on `initialState.coach`, and TypeScript errors on the unknown action types.

- [ ] **Step 3: Add the field, the actions and the reducer cases**

In `src/renderer/src/state/store.ts`:

Add to the imports at the top of the file:

```ts
import {
  advanceCoach,
  dismissCoach,
  minimiseCoach,
  restoreCoach,
  resumeCoach,
  startCoach,
  type CoachOutcome,
  type CoachState
} from '@shared/coach'
```

Add to `interface AppState`, immediately before the final `rifffs: Record<string, Rifff>` line:

```ts
  /** The guided track-design flow's own state (sssketchy) -- null until the
   * user starts a flow from the project menu's own button, and never set by
   * anything else: "sssketchy never appears on his own, not even on an empty
   * project" (docs/superpowers/specs/
   * 2026-09-22-sssketchy-guided-track-design.md, "Starting the flow").
   *
   * Real persisted project data, so a half-finished guided track resumes --
   * it is deliberately NOT in serialize.ts's transient Omit list. What does
   * not survive a load is his VISIBILITY and his CLOCK: deserializeProject
   * runs the whole thing through sanitiseLoadedCoach, which forces a loaded
   * flow to 'dismissed' with a stopped clock, so reopening a project never
   * makes him appear and never fires a ten-minute nudge for time spent
   * with the app closed. Everything about where the user actually got to
   * (step, done/skipped, banked per-phase time) comes back untouched.
   *
   * Not undoable -- all six COACH_* actions are in history.ts's
   * TRANSIENT_ACTION_TYPES, the same category as SET_ARRANGER_MODE: where
   * you are in the flow is not an arrangement edit. */
  coach: CoachState | null
```

Add to `initialState`, immediately before `rifffs: {}`:

```ts
  coach: null,
```

Add to the `Action` union, immediately before `| { type: 'LOAD_STATE'; state: AppState }`:

```ts
  // Every coach action carries `now` rather than letting the reducer read
  // the clock, so the machine stays pure and its tests stay deterministic
  // (see @shared/coach's own module doc). COACH_MINIMISE is the one
  // exception: minimising does not move the clock.
  | { type: 'COACH_START'; now: number }
  | { type: 'COACH_RESUME'; now: number }
  | { type: 'COACH_ADVANCE'; now: number; outcome: CoachOutcome }
  | { type: 'COACH_MINIMISE' }
  | { type: 'COACH_RESTORE'; now: number }
  | { type: 'COACH_DISMISS'; now: number }
```

Add the reducer cases, immediately before `case 'LOAD_STATE':`:

```ts
    // COACH_START is the only one that works with no flow in progress --
    // it is what the project-menu button dispatches the first time, and
    // again after a flow has finished (a finished flow has nowhere left to
    // resume to, so pressing the button starts a fresh one). Every other
    // coach action is a no-op without a flow, so a stray dispatch can never
    // conjure sssketchy onto the screen.
    case 'COACH_START':
      return { ...state, coach: startCoach(action.now) }

    case 'COACH_RESUME':
      return state.coach === null ? state : { ...state, coach: resumeCoach(state.coach, action.now) }

    case 'COACH_ADVANCE':
      return state.coach === null
        ? state
        : { ...state, coach: advanceCoach(state.coach, action.now, action.outcome) }

    case 'COACH_MINIMISE':
      return state.coach === null ? state : { ...state, coach: minimiseCoach(state.coach) }

    case 'COACH_RESTORE':
      return state.coach === null
        ? state
        : { ...state, coach: restoreCoach(state.coach, action.now) }

    case 'COACH_DISMISS':
      return state.coach === null
        ? state
        : { ...state, coach: dismissCoach(state.coach, action.now) }
```

- [ ] **Step 4: Mark the coach actions transient**

In `src/renderer/src/state/history.ts`, the `TRANSIENT_ACTION_TYPES` set currently ends like this:

```ts
  // The in-progress/pending region selection -- same "not a real edit"
  // treatment as SET_DRAG_PREVIEW; the real edits are ADD_MUTE_REGION/
  // REMOVE_MUTE_REGION, dispatched once Delete/Backspace actually commits.
  'SET_REGION_SELECTION'
])
```

Replace those last two lines (`'SET_REGION_SELECTION'` and `])`) with:

```ts
  'SET_REGION_SELECTION',
  // Where you are in the guided flow -- "what am I being walked through
  // right now," the same category as SET_ARRANGER_MODE at the top of this
  // set, not an arrangement edit. Undo must walk back through the clips
  // sssketchy helped place, never through the fact that he moved on to the
  // next step -- and a coach step that fell off the undo stack partway
  // through a flow would leave the flow pointing at work that no longer
  // exists.
  'COACH_START',
  'COACH_RESUME',
  'COACH_ADVANCE',
  'COACH_MINIMISE',
  'COACH_RESTORE',
  'COACH_DISMISS'
])
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS — the 6 new tests in "the guided flow (sssketchy)" pass alongside the existing ones.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all test files pass; tsc exits 0. If any test fails constructing an `AppState` literal, it is missing the new `coach` field — add `coach: null` to that literal.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts src/renderer/src/state/history.ts
git commit -m "$(cat <<'EOF'
Where you are in the flow is project data, not an undo step

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 6: Persistence and the load rules

**Files:**
- Modify: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/serialize.test.ts`

Note: `src/main/projectFile.ts` needs **no change**. It reads and writes project JSON as opaque strings and has no knowledge of `AppState`'s shape — see finding 1 at the top of this plan.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/state/serialize.test.ts`:

```ts
describe('the guided flow across a save and a load', () => {
  const NOW = 1_700_000_000_000
  const MINUTE = 60_000

  it('round-trips which step you got to, and how you left the ones behind you', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'COACH_START', now: NOW })
    state = reducer(state, { type: 'COACH_ADVANCE', now: NOW + 8 * MINUTE, outcome: 'skipped' })

    const json = serializeProject(state)
    const { state: restored } = deserializeProject(JSON.parse(json))

    expect(restored.coach?.stepId).toBe('sections')
    expect(restored.coach?.outcomes).toEqual({ 'climax-loop': 'skipped' })
    expect(restored.coach?.phaseElapsedMs.loop).toBe(8 * MINUTE)
  })

  it('reopens hidden with a stopped clock -- he never appears on his own', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'COACH_START', now: NOW })
    expect(state.coach?.status).toBe('active')

    const json = serializeProject(state)
    // The status IS written -- the load rules decide what to do with it,
    // the same way the arranger mode's own load rules work.
    expect(JSON.parse(json).coach.status).toBe('active')

    const { state: restored } = deserializeProject(JSON.parse(json))
    expect(restored.coach?.status).toBe('dismissed')
    expect(restored.coach?.runningSince).toBeNull()
  })

  it('a project saved before this feature existed still loads, with no flow', () => {
    // Exactly what an older .sssketchproj contains: no `coach` key at all.
    const legacy = JSON.parse(serializeProject(reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff
    })))
    delete legacy.coach
    expect('coach' in legacy).toBe(false)

    const { state: restored } = deserializeProject(legacy)
    expect(restored.coach).toBeNull()
    expect(restored.rifffs.r1.name).toBe('test')
  })

  it('a hand-edited coach block loads as a repaired flow rather than throwing', () => {
    const legacy = JSON.parse(serializeProject(reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff
    })))
    legacy.coach = { status: 'active', stepId: 'nonsense' }

    const { state: restored } = deserializeProject(legacy)
    expect(restored.coach?.stepId).toBe('climax-loop')
    expect(restored.coach?.status).toBe('dismissed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: FAIL on "reopens hidden with a stopped clock" — `expected 'active' to be 'dismissed'`. (The round-trip test already passes: persistence is opt-out, so `coach` is saved for free. That is the point — it documents behaviour rather than driving it.)

- [ ] **Step 3: Apply the load rule**

In `src/renderer/src/state/serialize.ts`, add to the imports at the top:

```ts
import { sanitiseLoadedCoach } from '@shared/coach'
```

Then, inside `deserializeProject`, immediately after the existing `state.rifffs = snapBarLengthNoise(state.rifffs)` line, add:

```ts
  // The guided flow's own load rules, in one place (see sanitiseLoadedCoach
  // for the full why): which step you got to and how long each phase took
  // come back; his visibility and his clock do not. A flow saved mid-step
  // reopens 'dismissed', and the project menu's sssketchy button resumes it
  // exactly where it was -- because he "never appears on his own, not even
  // on an empty project" (spec), and because runningSince is an absolute
  // timestamp from a previous session, which left alone would report days
  // of time on one step and fire the stuck nudge on open.
  state.coach = sanitiseLoadedCoach(state.coach)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: PASS — all 4 new tests pass alongside the existing ones.

- [ ] **Step 5: Run the full suite, typecheck and lint**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: all pass, all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/serialize.ts src/renderer/src/state/serialize.test.ts
git commit -m "$(cat <<'EOF'
A half-finished flow comes back; the small guy does not, until asked

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 7: The sprite

**Files:**
- Create: `src/renderer/src/components/SssketchySprite.tsx`
- Modify: `src/renderer/src/styles/global.css` (append)

No component test — React components are not unit-tested in this codebase (CLAUDE.md). Verification is typecheck + lint here, and Elling's manual walkthrough at the end.

- [ ] **Step 1: Add the idle bob keyframes**

Append to `src/renderer/src/styles/global.css`:

```css
/* sssketchy's idle bob. A 2px hop on a two-step timeline rather than a
   smooth ease, so an 80px pixel-art sprite reads as PIXEL animation rather
   than as a CSS transition applied to a picture -- the same reason the
   sprite itself renders with image-rendering: pixelated. The other four
   animations are real multi-frame flipbooks (see SssketchySprite.tsx); idle
   is the only one the sprite sheet ships a single frame for. */
@keyframes sssketchy-bob {
  0%,
  49% {
    transform: translateY(0);
  }
  50%,
  100% {
    transform: translateY(-2px);
  }
}
```

- [ ] **Step 2: Write the sprite component**

Create `src/renderer/src/components/SssketchySprite.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { SssketchyAnimation } from '@shared/coach'
import climb1 from '../assets/sssketchy/climb1.png'
import climb2 from '../assets/sssketchy/climb2.png'
import climb3 from '../assets/sssketchy/climb3.png'
import climb4 from '../assets/sssketchy/climb4.png'
import hit1 from '../assets/sssketchy/hit1.png'
import hit2 from '../assets/sssketchy/hit2.png'
import hit3 from '../assets/sssketchy/hit3.png'
import hit4 from '../assets/sssketchy/hit4.png'
import idle from '../assets/sssketchy/idle.png'
import jump from '../assets/sssketchy/jump.png'
import walk1 from '../assets/sssketchy/walk1.png'
import walk2 from '../assets/sssketchy/walk2.png'
import walk3 from '../assets/sssketchy/walk3.png'
import walk4 from '../assets/sssketchy/walk4.png'

/** The committed frames, by animation. These are 80x80 PNGs already redrawn
 * in the app's own greyscale palette (head --ra-text, body --ra-text-3, eyes
 * --ra-bg-row-active), so this component never tints or colours anything:
 * colour in this app is spent only on things that carry audio information,
 * and a cartoon guy is not one of them. Vite resolves each import to a URL
 * string (src/renderer/src/env.d.ts already references vite/client). */
const FRAMES: Record<SssketchyAnimation, readonly string[]> = {
  idle: [idle],
  walk: [walk1, walk2, walk3, walk4],
  jump: [jump],
  hit: [hit1, hit2, hit3, hit4],
  climb: [climb1, climb2, climb3, climb4]
}

/** Slow enough to read as a deliberate pixel-art flipbook rather than a
 * flicker, at the 4-frame cycle lengths this sprite sheet ships. */
const FRAME_MS = 140

/**
 * sssketchy himself: one 80x80 pixel-art frame, cycled.
 *
 * Presentational only -- it knows nothing about the flow. WHICH animation to
 * play is decided by coachAnimation (@shared/coach), which is pure and
 * tested; this just plays what it is handed.
 *
 * Rendered as a <button> because clicking the sprite is a real, distinct
 * gesture: it opens the full checklist, deliberately separate from the
 * bubble's own next/skip/do-it-for-me/stuck buttons "so the two never
 * compete" (spec).
 */
export function SssketchySprite({
  animation,
  size = 64,
  onClick,
  title
}: {
  animation: SssketchyAnimation
  size?: number
  onClick: () => void
  title: string
}): React.JSX.Element {
  const frames = FRAMES[animation]
  const [frameIndex, setFrameIndex] = useState(0)

  // Restarts at frame 0 on every animation change, so a walk never picks up
  // mid-stride from wherever the previous cycle happened to be. `frames` is
  // a stable module-level array per animation, so this effect runs exactly
  // when the animation actually changes.
  useEffect(() => {
    setFrameIndex(0)
    if (frames.length < 2) return undefined
    const id = window.setInterval(
      () => setFrameIndex((index) => (index + 1) % frames.length),
      FRAME_MS
    )
    return () => window.clearInterval(id)
  }, [frames])

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        padding: 0,
        lineHeight: 0,
        cursor: 'pointer'
      }}
    >
      <img
        src={frames[Math.min(frameIndex, frames.length - 1)]}
        width={size}
        height={size}
        alt=""
        style={{
          display: 'block',
          imageRendering: 'pixelated',
          animation: animation === 'idle' ? 'sssketchy-bob 1.6s steps(1, end) infinite' : undefined
        }}
      />
    </button>
  )
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0. A `Cannot find module '../assets/sssketchy/idle.png'` error here means `src/renderer/src/env.d.ts` lost its `/// <reference types="vite/client" />` line — restore it rather than adding a hand-written `*.png` declaration.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SssketchySprite.tsx src/renderer/src/styles/global.css
git commit -m "$(cat <<'EOF'
Eighty pixels of greyscale, bobbing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 8: The checklist

**Files:**
- Create: `src/renderer/src/components/SssketchyChecklist.tsx`

No component test — see Task 7's note.

- [ ] **Step 1: Write the checklist component**

Create `src/renderer/src/components/SssketchyChecklist.tsx`:

```tsx
import { COACH_PHASES, coachStepsInPhase } from '@shared/coachSteps'
import { coachPhaseElapsedMs, type CoachState } from '@shared/coach'

const PANEL_WIDTH = 340

function minutes(ms: number): number {
  return Math.floor(ms / 60_000)
}

/** "loop · 12 of 60-90 min" -- the spec's gentle timer, stated as a fact
 * and never as a judgement. Nothing here goes red, nothing blocks. */
function phaseTiming(elapsedMs: number, minMinutes: number, maxMinutes: number): string {
  return `${minutes(elapsedMs)} of ${minMinutes}-${maxMinutes} min`
}

/**
 * The whole flow at a glance: three phases, every step, and where the time
 * went. Opened by CLICKING THE SPRITE -- a deliberately different gesture
 * from the bubble's own buttons, "so the two never compete" (spec).
 *
 * Deliberately a flat, scannable list rather than anything interactive: the
 * bubble is where you act, this is where you look. The one exception is the
 * close button, and (when he is minimised) a way back to the current step --
 * both passed in, so this component stays presentational.
 */
export function SssketchyChecklist({
  coach,
  now,
  onClose,
  onRestore
}: {
  coach: CoachState
  /** Injected rather than read here, so the whole panel re-renders off one
   * clock owned by SssketchyCoach.tsx instead of each row running its own. */
  now: number
  onClose: () => void
  /** Present only while he is minimised -- the way back to the bubble. */
  onRestore?: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        bottom: 96,
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div className="ra-eyebrow">the method</div>
        <button
          type="button"
          onClick={onClose}
          style={{
            height: 20,
            borderRadius: 0,
            padding: '0 8px',
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-2)'
          }}
        >
          close
        </button>
      </div>

      {COACH_PHASES.map((phase) => (
        <div key={phase.id} style={{ marginTop: 'var(--ra-s-6)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--ra-text)'
            }}
          >
            <span>{phase.label}</span>
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
              {phaseTiming(
                coachPhaseElapsedMs(coach, phase.id, now),
                phase.targetMinMinutes,
                phase.targetMaxMinutes
              )}
            </span>
          </div>

          {coachStepsInPhase(phase.id).map((step) => {
            const outcome = coach.outcomes[step.id]
            const isCurrent = step.id === coach.stepId && coach.status !== 'finished'
            // Three plain ASCII marks, no colour and no icon font: done,
            // skipped, and the one you are on. Colour in this app is spent
            // only on things that carry audio information.
            const mark = outcome === 'done' ? 'x' : outcome === 'skipped' ? '-' : isCurrent ? '>' : ' '
            return (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  gap: 'var(--ra-s-2)',
                  marginTop: 'var(--ra-s-1)',
                  fontSize: 10,
                  lineHeight: 'var(--ra-lh-body)',
                  color: isCurrent ? 'var(--ra-text)' : 'var(--ra-text-3)'
                }}
              >
                <span style={{ width: 10, flex: 'none' }}>{mark}</span>
                <span>{step.label}</span>
              </div>
            )
          })}
        </div>
      ))}

      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          style={{
            marginTop: 'var(--ra-s-6)',
            height: 22,
            borderRadius: 0,
            padding: '0 10px',
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-2)'
          }}
        >
          back to the step
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SssketchyChecklist.tsx
git commit -m "$(cat <<'EOF'
Click the guy, see the whole method

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 9: The speech bubble and the panel

**Files:**
- Create: `src/renderer/src/components/SssketchyCoach.tsx`

No component test — see Task 7's note.

- [ ] **Step 1: Write the coach panel**

Create `src/renderer/src/components/SssketchyCoach.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { SssketchySprite } from './SssketchySprite'
import { SssketchyChecklist } from './SssketchyChecklist'
import {
  coachAnimation,
  coachLine,
  isCoachStuck,
  type CoachState
} from '@shared/coach'
import { coachStepById } from '@shared/coachSteps'
import { COACH_NO_MOVES_LINES, COACH_STUCK_LINES, pickLineVariant } from '@shared/coachLines'

const BUBBLE_WIDTH = 300
const SPRITE_SIZE = 64
/** How often the panel re-reads the clock, purely so the ten-minute nudge
 * and the checklist's phase timers appear without a user gesture. Coarse on
 * purpose: nothing here needs second accuracy, and the store is never
 * touched by this -- it is local state, so nothing else in the app
 * re-renders. */
const CLOCK_TICK_MS = 15_000
/** How long the walk plays after he moves to a new anchor. */
const WALK_MS = 700
/** How long the jump plays after a step is completed. */
const JUMP_MS = 900

const bubbleButtonStyle = {
  height: 20,
  borderRadius: 0,
  padding: '0 8px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)'
} as const

/**
 * sssketchy on screen: the sprite on the bottom edge, and one speech bubble
 * carrying exactly one thought.
 *
 * The rule this component exists to enforce (spec, "What he is allowed to
 * say"): **one thought at a time**. There is exactly one `line` here, read
 * straight off the current step. There is no list, no queue, no pending
 * suggestions, and nowhere for an unacted suggestion to accumulate. The only
 * second string that can ever appear is the ten-minute nudge, which the spec
 * itself carves out as "the one exception... triggered by elapsed clock time
 * -- a fact, not a guess about the music" -- and which only ever points back
 * at the same buttons already on the bubble.
 */
function SssketchyCoachPanel({
  coach,
  onNext,
  onSkip,
  onMinimise,
  onRestore,
  onDismiss
}: {
  coach: CoachState
  onNext: () => void
  onSkip: () => void
  onMinimise: () => void
  onRestore: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [stuckOpen, setStuckOpen] = useState(false)
  const [walking, setWalking] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const previousLeftRef = useRef<number | null>(null)

  const step = coachStepById(coach.stepId)
  const anchorSelector = step?.anchorSelector

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  // Same look-the-target-up-fresh approach TourOverlay.tsx uses, for the
  // same reason: a step's anchor lives in an unrelated component (Discover,
  // the timeline, the project menu) with no shared parent worth threading a
  // ref through. Every placeholder step in this build leaves anchorSelector
  // unset, so he parks in the bottom-left until the phase plans set them.
  useEffect(() => {
    const selector = anchorSelector
    if (selector === undefined) {
      setAnchorRect(null)
      return undefined
    }
    function update(): void {
      const element = document.querySelector(selector)
      setAnchorRect(element ? element.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorSelector])

  const left = anchorRect
    ? Math.min(Math.max(anchorRect.left, 12), window.innerWidth - BUBBLE_WIDTH - 12)
    : 16

  // Walks whenever the anchor actually moved him somewhere else -- "walk =
  // moving to another area (Discover -> timeline)" (spec). Nothing on the
  // first render: appearing is not travelling.
  useEffect(() => {
    if (previousLeftRef.current === null || previousLeftRef.current === left) {
      previousLeftRef.current = left
      return undefined
    }
    previousLeftRef.current = left
    setWalking(true)
    const id = window.setTimeout(() => setWalking(false), WALK_MS)
    return () => window.clearTimeout(id)
  }, [left])

  // "jump = step finished". Also fires when he first appears, which reads as
  // a greeting rather than as a mistake.
  useEffect(() => {
    setCelebrating(true)
    const id = window.setTimeout(() => setCelebrating(false), JUMP_MS)
    return () => window.clearTimeout(id)
  }, [coach.stepId])

  // One thought at a time: a "stuck?" panel left open from the previous step
  // would be a second thing on screen competing with the new step's line.
  useEffect(() => {
    setStuckOpen(false)
  }, [coach.stepId])

  const stuck = isCoachStuck(coach, now)
  const animation = coachAnimation({
    status: coach.status,
    // Nothing in the framework build starts work on the user's behalf --
    // the phase plans are what make him climb.
    working: false,
    moving: walking,
    justAdvanced: celebrating,
    stuck
  })

  const sprite = (
    <SssketchySprite
      animation={animation}
      size={SPRITE_SIZE}
      onClick={() => setChecklistOpen((open) => !open)}
      title="the method"
    />
  )

  const checklist = checklistOpen && (
    <SssketchyChecklist
      coach={coach}
      now={now}
      onClose={() => setChecklistOpen(false)}
      onRestore={
        coach.status === 'minimised'
          ? () => {
              setChecklistOpen(false)
              onRestore()
            }
          : undefined
      }
    />
  )

  if (coach.status === 'minimised') {
    return (
      <>
        {checklist}
        <div style={{ position: 'fixed', left: 16, bottom: 12, zIndex: 'var(--ra-z-anchored)' }}>
          {sprite}
        </div>
      </>
    )
  }

  const finished = coach.status === 'finished'
  const moves = step?.moves ?? []

  return (
    <>
      {checklist}
      <div
        style={{
          position: 'fixed',
          left,
          bottom: 12,
          width: BUBBLE_WIDTH,
          zIndex: 'var(--ra-z-anchored)'
        }}
      >
        <div
          style={{
            background: 'var(--ra-bg-bar)',
            border: '1px solid var(--ra-border-strong)',
            borderRadius: 0,
            padding: 'var(--ra-s-5)',
            boxShadow: 'var(--ra-shadow-popover)'
          }}
        >
          <div
            style={{
              fontSize: 11,
              lineHeight: 'var(--ra-lh-body)',
              color: 'var(--ra-text)'
            }}
          >
            {coachLine(coach)}
          </div>

          {stuck && !finished && (
            <div
              style={{
                marginTop: 'var(--ra-s-2)',
                fontSize: 10,
                lineHeight: 'var(--ra-lh-body)',
                color: 'var(--ra-text-3)'
              }}
            >
              {pickLineVariant(COACH_STUCK_LINES, coach.lineSeed)}
            </div>
          )}

          {stuckOpen && !finished && (
            <div style={{ marginTop: 'var(--ra-s-2)' }}>
              {moves.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
                  {pickLineVariant(COACH_NO_MOVES_LINES, coach.lineSeed)}
                </div>
              ) : (
                moves.map((move) => (
                  <div
                    key={move.id}
                    style={{ fontSize: 10, color: 'var(--ra-text-2)', marginTop: 'var(--ra-s-1)' }}
                  >
                    {move.label}
                  </div>
                ))
              )}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--ra-s-1)',
              marginTop: 'var(--ra-s-5)'
            }}
          >
            {finished ? (
              <button type="button" onClick={onDismiss} style={bubbleButtonStyle}>
                done
              </button>
            ) : (
              <>
                <button type="button" onClick={onNext} style={bubbleButtonStyle}>
                  next
                </button>
                <button type="button" onClick={onSkip} style={bubbleButtonStyle}>
                  skip
                </button>
                {/* Disabled until a step actually has a move to make. The
                    phase plans give steps their moves; inventing one here
                    would be a lie in the one part of this feature that must
                    never guess. */}
                <button
                  type="button"
                  disabled={moves.length === 0}
                  onClick={() => setStuckOpen(true)}
                  title={
                    moves.length === 0
                      ? 'nothing to do for you on this step yet'
                      : 'do this step for me'
                  }
                  style={{
                    ...bubbleButtonStyle,
                    opacity: moves.length === 0 ? 0.3 : 1,
                    cursor: moves.length === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  do it for me
                </button>
                <button
                  type="button"
                  onClick={() => setStuckOpen((open) => !open)}
                  style={bubbleButtonStyle}
                >
                  stuck?
                </button>
              </>
            )}
            {/* Spelled out rather than shrunk to a glyph: this row is the
                whole interactive surface of the bubble, and "dismiss" needs
                to read as "put him away, come back later" rather than as a
                close box that throws the flow out. The row wraps at this
                width, which is fine -- four verbs on two lines. */}
            {!finished && (
              <>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={onMinimise}
                  style={bubbleButtonStyle}
                  title="shrink him to a corner sprite, keeping your place"
                >
                  minimise
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  style={bubbleButtonStyle}
                  title="put the flow away -- the sssketchy button brings it back here"
                >
                  dismiss
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ marginTop: 'var(--ra-s-1)' }}>{sprite}</div>
      </div>
    </>
  )
}

/**
 * The store gate. Reads the one nullable coach field and renders nothing at
 * all when there is no flow or the flow is dismissed -- which is every
 * moment until the project menu's own sssketchy button is pressed, including
 * the moment right after a project with a half-finished flow is opened (see
 * sanitiseLoadedCoach). He never appears on his own.
 *
 * All hooks live in SssketchyCoachPanel below the gate, so there is never a
 * conditional hook here.
 */
export function SssketchyCoach(): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  if (coach === null || coach.status === 'dismissed') return null
  return (
    <SssketchyCoachPanel
      coach={coach}
      onNext={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'done' })}
      onSkip={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'skipped' })}
      onMinimise={() => dispatch({ type: 'COACH_MINIMISE' })}
      onRestore={() => dispatch({ type: 'COACH_RESTORE', now: Date.now() })}
      onDismiss={() => dispatch({ type: 'COACH_DISMISS', now: Date.now() })}
    />
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0. If eslint's `react-hooks/exhaustive-deps` flags the anchor effect, the fix is to keep `anchorSelector` (a plain string or undefined) as the sole dependency — do not add `setAnchorRect`, which React guarantees is stable.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SssketchyCoach.tsx
git commit -m "$(cat <<'EOF'
One bubble, one thought, four buttons

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 10: The entry point in the project menu

**Files:**
- Modify: `src/renderer/src/App.tsx` (the `ProjectMenu` component, ~line 500-878; the `Frame` component's render, ~line 2596)

No component test — see Task 7's note.

- [ ] **Step 1: Import the coach component**

In `src/renderer/src/App.tsx`, add next to the existing component imports (e.g. after the `import { TourOverlay, type TourStep } from './components/TourOverlay'` line):

```ts
import { SssketchyCoach } from './components/SssketchyCoach'
```

- [ ] **Step 2: Add the button to ProjectMenu**

Inside `ProjectMenu`, immediately after the `const buttonStyle = {...} as const` declaration, add:

```ts
  /**
   * The flow's only entry point. "Button only (Elling's decision) --
   * sssketchy never appears on his own, not even on an empty project. The
   * entry point is a button in the project menu row, alongside new / open /
   * save / tidy / export: it is a project-level verb like the rest of that
   * row" (spec, "Starting the flow").
   *
   * The same button resumes a half-finished flow, which is why there is no
   * separate "resume" affordance anywhere: a project reopened mid-flow
   * comes back 'dismissed' (see sanitiseLoadedCoach), and this puts it back
   * on screen at exactly the step it was left on.
   *
   * A FINISHED flow has nowhere left to resume to, so pressing it then
   * starts a fresh one -- the title below says so before it happens.
   */
  const coach = state.coach
  const coachFinished = coach !== null && coach.status === 'finished'
  const coachResumable = coach !== null && !coachFinished
  function handleSssketchy(): void {
    const now = Date.now()
    if (coachResumable) dispatch({ type: 'COACH_RESUME', now })
    else dispatch({ type: 'COACH_START', now })
  }
```

Then add the button itself to the returned `<div style={{ display: 'flex', gap: 6 }}>`, immediately after the closing `</button>` of the `export` button's `{exportMenu && (...)}` block and before `{exportFormatPickerOpen && (` — i.e. as the last real button in the row:

```tsx
      <button
        onClick={handleSssketchy}
        title={
          coachResumable
            ? 'pick the guided track-design flow back up'
            : coachFinished
              ? 'start the guided track-design flow again from the top'
              : 'walk me through building a rough track'
        }
        style={buttonStyle}
      >
        sssketchy
      </button>
```

- [ ] **Step 3: Mount the coach in Frame**

In `Frame`'s returned JSX, immediately after the `{tourStepIndex !== null && (<TourOverlay ... />)}` block and before the closing `</div>` of `.ra-frame`, add:

```tsx
        {/* Renders nothing at all unless a flow has been started from the
          project menu's own sssketchy button -- see SssketchyCoach's own
          doc comment. Mounted here, at the frame's top level, rather than
          inside any one panel, because a step's anchor can be anywhere in
          the app (Discover, the timeline, the project menu row). */}
        <SssketchyCoach />
```

- [ ] **Step 4: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
He shows up when you ask him to, and not before

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Manual walkthrough (for Elling — an agent cannot do this)

This environment has no GUI or audio interaction tooling, so the whole UI half of this plan is
unverified until a person clicks it. Run `npm run dev` (no native-engine rebuild is needed —
**this plan changes no C++ at all**) and check:

1. The **sssketchy** button is in the project menu row, to the right of export, matching the
   other buttons exactly (22px tall, 10px text, sharp corners, same greys).
2. Pressing it once puts sssketchy on the bottom-left with a bubble carrying the phase-one line
   and **next · skip · do it for me · stuck?**. "do it for me" is greyed out with a tooltip —
   that is correct for this build; the phase plans light it up.
3. **next** and **skip** both move to the next step, and the bubble's text is *replaced*, never
   added to. Stepping past the third step shows the sign-off and a single **done**.
4. Clicking the **sprite** opens the checklist — three phases, every step marked `x` / `-` / `>`,
   phase timers counting. Clicking the sprite again closes it. This gesture must feel clearly
   separate from the bubble's buttons.
5. The **minimise** button shrinks him to a corner sprite, whose click still opens the checklist,
   which now offers "back to the step". The **dismiss** button puts him away entirely.
6. Press the project-menu button again after dismissing: he comes back **on the same step**.
7. **Save the project, open something else, reopen it:** sssketchy is *not* on screen, and
   pressing the button puts him back on the step you left, with the checklist's phase timers
   showing the time you had already spent.
8. Open a project saved before today: it opens normally, with no flow.
9. Everything is greyscale. No rounded corners. No emoji, no exclamation marks, all lowercase.

Leave a step alone for ten minutes to see the nudge line appear under the step's own line. That
is the only thing that ever adds a second line to the bubble.

## Testing summary, stated honestly

- **`src/shared/coachSteps.ts`, `coachLines.ts`, `coach.ts`** — TDD'd, full unit coverage of every
  transition, both elapsed-time getters, the stuck threshold, the line picker, the animation
  precedence table and the load sanitiser. `npx vitest run src/shared/coach.test.ts` and friends.
- **The reducer and persistence** — tested in `state/store.test.ts` and `state/serialize.test.ts`,
  including the save/load round trip and a project saved before this feature existed.
- **`SssketchySprite.tsx`, `SssketchyChecklist.tsx`, `SssketchyCoach.tsx`, `App.tsx`** — **not
  unit-tested.** React components are not unit-tested in this codebase by convention (CLAUDE.md,
  "Testing conventions"); they are covered by `npm run typecheck`, `npm run lint`, the pure logic
  underneath, and the manual walkthrough above. Do not report the UI as "tested".
- **`native-engine/`** — untouched. No rebuild, no relaunch beyond an ordinary `npm run dev`.

## What this plan deliberately does not build

Everything in the spec's build-order items 2, 3 and 4 — the Discover integration and pre-arming,
lock-in, section steps, the subtraction and transition tables, preview, placement, the tension
pass, risers into drops, the balance check, the export hand-off and the V1 marking. Each is its
own later plan. They plug into this shell by appending rows to `COACH_STEPS`, extending the
`CoachStepId` union, filling in each step's `moves` and `anchorSelector`, and passing a real
`working` flag to `coachAnimation`. Nothing above needs to be reshaped for any of that.

Two framework capabilities are therefore built and unit-tested here but not reachable in the app
until those plans land: the `climb` ("while the app works") animation, because nothing yet starts
work on the user's behalf, and the `walk` animation, because every placeholder step leaves
`anchorSelector` unset and so nothing moves him.

One more deliberate omission. The spec's coach-state section lists three further things the machine
tracks: "chosen flavour (melodic | groove)", "the locked climax (stem ids + roles + gains)" and
"sections built so far (type, bars, which stems play)". **None of those are fields on `CoachState`
here**, and adding them now would be guessing at their shape before the code that writes them
exists — the flavour answer is phase 1's first step, the locked climax is phase 1's last, and the
section list is phase 2's whole output. Each is an additive field on `CoachState` plus an entry in
`sanitiseLoadedCoach`'s repair table, which is exactly the kind of change this shape absorbs
without reshaping: the persistence path is opt-out, so a new field is saved for free, and a project
saved before that field existed loads with `initialState`'s value for it. The phase plan that first
needs one adds it.
