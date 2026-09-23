# sssketchy Phase 1 — the climax loop (in Discover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the guided flow's phase-1 placeholder into the real thing: sssketchy asks melodic or groove, orders the climax-loop steps by the answer, pre-arms each step's kinds in Discover's add row, adds the slot himself on "do it for me", marks roles a seeded start already covers as done, and freezes the finished loop as the `lockedClimax` phase 2 will carve from.

**Architecture:** Everything that decides anything stays a pure function in `src/shared/` — the phase-1 step rows and their two orderings (`coachSteps.ts`), the locked-climax value type (`coachClimax.ts`, new), and the phase-1 transitions and completion checks (`coachPhase1.ts`, new). The renderer half is three thin wires: a declarative `coachArmedKinds` prop flowing App → LibraryBrowser → DiscoverPanel, a `CoachSlotSnapshot[]` published back the other way, and one tiny imperative bridge module so the bubble's "do it for me" can reach DiscoverPanel's own `addSlot`.

**Tech Stack:** TypeScript, React 19, Electron renderer, vitest. **No native-engine changes at all.**

**Spec:** `docs/superpowers/specs/2026-09-22-sssketchy-guided-track-design.md` — build order step 2 ("Phase 1 — the climax loop (in Discover)") only.

**Previous plan:** `docs/superpowers/plans/2026-09-22-sssketchy-framework.md` (build order step 1). Read its "Findings" section before starting; everything it established still holds.

---

## Findings that shaped this plan (read these first)

1. **The one rule that governs every line of copy in this plan.** The spec's "What he is allowed to say": *sssketchy never decides when to speak, and never has an opinion about your music.* Every line below says what the **step** is for, never what the track needs. The only musical assertion allowed anywhere in this feature is phase 2's suggested drops, which is **not** in this plan. If you find yourself writing a line that could be wrong about a particular track, it is wrong copy — rewrite it as a statement about the step.

2. **React components are not unit-tested in this codebase** (CLAUDE.md, "Testing conventions"). Tasks 10, 11 and 12 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, and then by Elling's manual walkthrough (at the end of this plan). This environment has no GUI or audio tooling — **do not claim any UI behaviour was tested.**

3. **Tasks 7–10 of the framework plan were being written by another agent while this plan was written.** `src/renderer/src/components/SssketchySprite.tsx` existed; `SssketchyChecklist.tsx`, `SssketchyCoach.tsx` and the `ProjectMenu` button did not yet. Tasks 12 of this plan therefore describes the changes to `SssketchyCoach.tsx`/`SssketchyChecklist.tsx` as **behaviour plus exact integration points**, with code blocks written against the framework plan's own Task 8/9 source. **Re-read both files before editing them** and apply the same behaviour to whatever actually shipped, rather than pasting over a file that has moved on.

4. **Discover's slots do not live in Discover.** `discoverSlots` is `useState` in `App.tsx` (line ~1363), threaded through `LibraryBrowser.tsx` into `DiscoverPanel`'s `slots`/`setSlots` props. But *resolution* (`resolvedStemsRef`), *audibility* (`previewingSlotIds`) and *rolling* (`rerollingSlotIds`) are all DiscoverPanel-internal. So the coach cannot read "is this slot resolved" from App's copy — DiscoverPanel has to publish a snapshot upward. That is what `CoachSlotSnapshot` and the `onCoachSlotsChange` prop are for (Task 10).

5. **The add row's pre-arm is `pendingAddKinds`** (`DiscoverPanel.tsx`, ~line 1256) — the cmd-click "arm a chip, then click another to combine" state. Pre-arming a step therefore means setting that state; it is a `DiscoverSlotKind[]`, normalised by `toggleSlotKind`/`normalizeSlotKinds`. Pre-arming is **declarative**: a prop, so it survives DiscoverPanel unmounting on every browse↔discover tab switch.

6. **"do it for me" has to reach `addSlot`, which only DiscoverPanel can call.** `addSlot(kinds)` pushes an undo snapshot, appends the slot and kicks off `rollForSlot`/`rollRandomForSlot` using `globalRollOptions`, `bpm`, `traitMatchBar` and `rifffsState` — all DiscoverPanel-internal. Re-implementing it in App would be a second, untested copy. Task 9 adds a 30-line registration bridge instead, and queues a request made while Discover is closed so "do it for me" is never a half-action.

7. **Kind sets are Discover's own role tagging, and they are what phase 2 keys off.** `DiscoverSlot.kinds` comes from the add row, from `discoverSlotKindForSoundType` on a Shelf seed, or from `candidate.slotKinds` on a Browse seed (`src/renderer/src/audio/discoverSeed.ts`). `discoverSlotKindToArrangeRole` maps a kind to a real `ArrangeRole`. Seeded-start detection and the locked climax's roles both read **only** these — never stem order, never channel index. That is a spec requirement, twice ("derived from data the app really has rather than from stem order or channel index").

8. **Both orderings are the same six steps; only the first two swap.** groove = low end → harmony → drums → supporting → hook → balance. melodic = harmony → low end → drums → supporting → hook → balance. So the step table stays one flat list, and `coachStepOrder(flavour)` decides the walk. Only two rows (`p1-low-end`, `p1-drums`) have genuinely different copy and different armed kinds per flavour; those carry a `byFlavour` override, and `resolveCoachStep` flattens it.

9. **`satisfiedBy` is a list of kind sets, and a slot satisfies one if its kinds are a superset of it.** That single rule covers alternatives (supporting: chonky *or* rhythmic *or* sparkly) and conjunctions (the hook wants a `lead` **and** `bright` slot) without a second mode. It also stops the harmony step and the hook step satisfying each other, because `bright` and `warm` are mutually exclusive inside one normalised kind set (`normalizeSlotKinds`, `OPPOSITE_KIND`).

10. **Satisfaction is derived, never stored.** A step is satisfied when the current slots say so. Nothing is written down, so deleting the slot un-ticks the step, and a riff seeded *after* the question was answered still ticks its roles. Advancing stays manual: `next`/`skip` are always there and nothing auto-advances (spec).

11. **Persistence is opt-out.** `serializeProject` rest-destructures transient fields and stringifies the rest; `deserializeProject` builds `{ ...initialState, ...projectData }` and then runs `sanitiseLoadedCoach`. So three new `CoachState` fields persist for free, and a project saved before phase 1 existed (or before the coach existed at all) loads without them. `sanitiseLoadedCoach` is where that is made honest — including a project saved by the *framework* build, whose `stepId` is the now-deleted `'climax-loop'`.

12. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, `docs/design.md`): near-black shell, Silkscreen, **no `border-radius` anywhere**, colour only on things carrying audio information. UI copy is lowercase, **no emoji, no exclamation marks**. The existing coach copy avoids contractions ("there is a…", "that is the whole method") — match it.

13. **`nextCoachStepId` gains a required second parameter.** Its only production call site is `advanceCoach`. Making the parameter required rather than defaulted means the typechecker finds every call site for you instead of silently walking the groove order for a melodic flow.

## File map

| File | Change |
|---|---|
| `src/shared/coachSteps.ts` | `CoachFlavour`, `COACH_FLAVOURS`, `isCoachFlavour`, `CoachMoveAction`, `CoachOfferAction`, `CoachOffer`, `CoachMove.action`, `CoachStepDef.{primaryMoveId,satisfiedBy,offers,byFlavour}`, `resolveCoachStep`, `coachStepPrimaryMove`, `coachStepArmKinds`; the eight phase-1 rows replacing `climax-loop`; `coachStepOrder`, flavour-aware `nextCoachStepId`/`coachStepsInPhase` |
| `src/shared/coachSteps.test.ts` | ordering, override-resolution, arm-kind and copy-rule tests |
| `src/shared/coachClimax.ts` (new) | `CoachStemSnapshot`, `CoachSlotSnapshot`, `LockedClimaxStem`, `LockedClimax`, `isDiscoverSlotKind`, `coachSlotRole`, `lockClimaxFromSlots`, `sanitiseLockedClimax` |
| `src/shared/coachClimax.test.ts` (new) | lock-in and load-repair tests |
| `src/shared/coachLines.ts` | `COACH_STEP_SATISFIED_LINES`, `COACH_SEEDED_LINE_TEMPLATES` |
| `src/shared/coachLines.test.ts` | the two new tables join the existing copy-rule sweep |
| `src/shared/coach.ts` | `CoachState.{flavour,seededKinds,lockedClimax}`, `startCoach`, `advanceCoach`, `coachLine`, `sanitiseLoadedCoach` |
| `src/shared/coach.test.ts` | updated for the new step ids and the three new fields |
| `src/shared/coachPhase1.ts` (new) | `slotCoversKindSet`, `stepSatisfiedBySlots`, `coachStepSatisfied`, `seededCoveredStepIds`, `answerCoachFlavour`, `lockCoachClimax`, `coachSeededLine`, `coachLineFor` |
| `src/shared/coachPhase1.test.ts` (new) | full TDD of the above |
| `src/renderer/src/state/store.ts` | `COACH_SET_FLAVOUR` + `COACH_LOCK_CLIMAX` action types and reducer cases |
| `src/renderer/src/state/store.test.ts` | reducer tests for the two new actions; existing coach tests updated for the new ids |
| `src/renderer/src/state/history.ts` | two entries in `TRANSIENT_ACTION_TYPES` |
| `src/renderer/src/state/serialize.test.ts` | round-trip of the new fields + a framework-era project |
| `src/renderer/src/state/coachDiscoverBridge.ts` (new) | `registerCoachAddSlot`, `requestCoachAddSlot`, `coachDiscoverIsOpen`, `resetCoachDiscoverBridge` |
| `src/renderer/src/state/coachDiscoverBridge.test.ts` (new) | register/queue/flush tests |
| `src/renderer/src/components/DiscoverPanel.tsx` | two new props, the arming effect, the snapshot-publishing effect, the `addSlot` registration, the add-row anchor attribute |
| `src/renderer/src/components/LibraryBrowser.tsx` | thread the two props through; optional `initialMode` |
| `src/renderer/src/App.tsx` | `coachSlots` state, armed-kinds memo, offer/move handlers, `openDiscoverForCoach`, props onto `LibraryBrowser` and `SssketchyCoach` |
| `src/renderer/src/components/SssketchyCoach.tsx` | offers row, real "do it for me", clickable "stuck?" moves, satisfied/seeded lines, real `working` |
| `src/renderer/src/components/SssketchyChecklist.tsx` | flavour-aware step order and labels |

## Commands used throughout (run from the repo root, `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/coachPhase1.test.ts   # one file
npx vitest run                                  # the whole suite
npm run typecheck                               # tsc, node + web configs
npm run lint                                    # eslint --cache .
```

Prettier settings the code below already follows: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

---

### Task 1: Flavour, offers, moves and per-flavour step resolution

Types and accessors only — the step table itself is still the framework's three placeholder rows at the end of this task, so the suite stays green.

**Files:**
- Modify: `src/shared/coachSteps.ts`
- Test: `src/shared/coachSteps.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/shared/coachSteps.test.ts`:

```ts
describe('flavours', () => {
  it('has exactly the two the spec names, groove first', () => {
    expect(COACH_FLAVOURS).toEqual(['groove', 'melodic'])
  })

  it('narrows a persisted string to a known flavour', () => {
    expect(isCoachFlavour('groove')).toBe(true)
    expect(isCoachFlavour('melodic')).toBe(true)
    expect(isCoachFlavour('grove')).toBe(false)
    expect(isCoachFlavour(null)).toBe(false)
  })
})

describe('resolveCoachStep', () => {
  const step: CoachStepDef = {
    id: 'sections',
    phase: 'arrangement',
    label: 'neutral label',
    lines: ['neutral line one.', 'neutral line two.', 'neutral line three.'],
    moves: [
      { id: 'neutral-move', label: 'do the neutral thing', action: { kind: 'lock-climax' } }
    ],
    primaryMoveId: 'neutral-move',
    byFlavour: {
      groove: {
        label: 'groove label',
        moves: [
          {
            id: 'groove-move',
            label: 'add a bassish one',
            action: { kind: 'add-slot', kinds: ['bass'] }
          }
        ],
        primaryMoveId: 'groove-move'
      }
    }
  }

  it('returns the row untouched when there is no override for this flavour', () => {
    expect(resolveCoachStep(step, 'melodic').label).toBe('neutral label')
    expect(resolveCoachStep(step, null).label).toBe('neutral label')
  })

  it('applies the override for the flavour that has one', () => {
    const resolved = resolveCoachStep(step, 'groove')
    expect(resolved.label).toBe('groove label')
    expect(resolved.moves.map((move) => move.id)).toEqual(['groove-move'])
    // Fields the override does not mention come through from the base row.
    expect(resolved.lines).toEqual(step.lines)
  })

  it('is idempotent -- a resolved step carries no override to apply twice', () => {
    const once = resolveCoachStep(step, 'groove')
    expect(resolveCoachStep(once, 'melodic')).toEqual(once)
  })

  it('finds the primary move and the kinds it arms, per flavour', () => {
    expect(coachStepPrimaryMove(step, 'groove')?.id).toBe('groove-move')
    expect(coachStepArmKinds(step, 'groove')).toEqual(['bass'])
    // A primary move that is not an add-slot arms nothing.
    expect(coachStepArmKinds(step, 'melodic')).toBeNull()
  })

  it('arms nothing at all for a step with no primary move', () => {
    const noPrimary: CoachStepDef = { ...step, primaryMoveId: undefined, byFlavour: undefined }
    expect(coachStepPrimaryMove(noPrimary, null)).toBeNull()
    expect(coachStepArmKinds(noPrimary, null)).toBeNull()
  })
})
```

Add the new names to that file's existing import block, which becomes:

```ts
import {
  COACH_FLAVOURS,
  COACH_PHASES,
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachPhaseDef,
  coachStepArmKinds,
  coachStepById,
  coachStepPrimaryMove,
  coachStepsInPhase,
  isCoachFlavour,
  isCoachStepId,
  nextCoachStepId,
  resolveCoachStep,
  type CoachStepDef
} from './coachSteps'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: FAIL — `No "COACH_FLAVOURS" export is defined on the module` (or a TypeScript error naming the missing exports).

- [ ] **Step 3: Implement the types and accessors**

In `src/shared/coachSteps.ts`, add this import at the top of the file:

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'
```

Immediately after the `export type CoachPhase = ...` line, add:

```ts
/**
 * The spec's opening question: "sssketchy asks melodic or groove". It is
 * the ONLY thing in this feature that reorders anything, and it reorders
 * exactly two steps (see COACH_STEP_ORDER below) -- it is a starting point,
 * not a genre, and nothing anywhere treats it as a claim about the music.
 */
export type CoachFlavour = 'melodic' | 'groove'

/** Groove first, matching the order the offers are rendered in. */
export const COACH_FLAVOURS: readonly CoachFlavour[] = ['groove', 'melodic']

export function isCoachFlavour(value: unknown): value is CoachFlavour {
  return value === 'groove' || value === 'melodic'
}
```

Replace the whole `CoachMove` interface (the `/** One concrete move a step can make... */` block) with:

```ts
/** What a move actually DOES, as data rather than as a callback -- the
 * renderer switches on `kind` and nothing in src/shared/ knows that
 * Discover, React or Electron exist. 'add-slot' adds one Discover slot
 * targeting `kinds`; 'lock-climax' freezes the loop (see ./coachClimax.ts). */
export type CoachMoveAction =
  | { kind: 'add-slot'; kinds: readonly DiscoverSlotKind[] }
  | { kind: 'lock-climax' }

/** One concrete move a step can make on the user's behalf. Surfaced by the
 * bubble's "stuck?" button, which "surfaces concrete moves this step can
 * make... It never produces a judgement" (spec), and -- for the step's
 * `primaryMoveId` -- by "do it for me". */
export interface CoachMove {
  id: string
  /** Phrased as an offer, e.g. 'add a bassish one'. Lowercase. */
  label: string
  action: CoachMoveAction
}

/** An answer only the user can give. Rendered as its own button row above
 * the bubble's fixed next/skip row -- deliberately NOT a move, because "do
 * it for me" must never pick one of these: choosing melodic or groove for
 * you would be exactly the kind of decision the spec keeps him out of. */
export type CoachOfferAction =
  | { kind: 'set-flavour'; flavour: CoachFlavour }
  | { kind: 'open-riff-browser' }

export interface CoachOffer {
  id: string
  label: string
  action: CoachOfferAction
}
```

Replace the `CoachStepDef` interface's `moves` doc comment and add the new optional fields, so the interface reads (note `CoachStepOverride` is declared **before** `CoachStepDef`, and spelled out rather than written as `Partial<Pick<CoachStepDef, ...>>` — the two reference each other, and a `Pick` of an interface that contains the alias is a circular type reference TypeScript may reject):

```ts
/** The overridable half of a step row -- see CoachStepDef.byFlavour. */
export interface CoachStepOverride {
  label?: string
  lines?: readonly string[]
  moves?: readonly CoachMove[]
  primaryMoveId?: string
  satisfiedBy?: readonly (readonly DiscoverSlotKind[])[]
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
  /** Every concrete move this step can make. Empty on a step with nothing
   * to automate -- an invented move would be a lie in the one part of this
   * feature that must never guess. */
  moves: readonly CoachMove[]
  /** Which of `moves` the bubble's "do it for me" runs. Absent when doing
   * it for you would be a decision only the user can make (the melodic-or-
   * groove question), which is what disables that button. */
  primaryMoveId?: string
  /** What "a step completes when a slot with those kinds resolves" (spec)
   * means for this step, as a list of kind SETS: the step is satisfied when
   * some resolved slot's own kinds are a superset of any one of them. One
   * rule covers alternatives (supporting: chonky OR rhythmic OR sparkly --
   * three single-kind sets) and combinations (the hook: one {leadesque,
   * sparkly} set). Empty/absent = never satisfied automatically, which is
   * right for a listening step. Satisfaction is DERIVED from the current
   * slots, never stored: delete the slot and the tick goes away. */
  satisfiedBy?: readonly (readonly DiscoverSlotKind[])[]
  /** Answers this step asks for. Only the flavour question has these. */
  offers?: readonly CoachOffer[]
  /** CSS selector for the element this step is about -- sssketchy stands on
   * the bottom edge near it, and WALKS when it changes between steps (spec:
   * "walk = moving to another area (Discover -> timeline)"). Same
   * look-it-up-fresh approach TourOverlay.tsx already uses for the same
   * reason: targets live in unrelated components with no shared parent
   * worth threading refs through. */
  anchorSelector?: string
  /** The parts of this row that change with the answer to the melodic-or-
   * groove question. Only two rows have one: the low end (groove wants a
   * kick alongside the bass; melodic wants bass under the harmony that is
   * already there) and drums (groove has already placed a kick, so its
   * drums step is the kit filling out). Everything else reads the same
   * either way, and duplicating it into twelve rows would just be two
   * copies of the same copy to keep in sync. */
  byFlavour?: Partial<Record<CoachFlavour, CoachStepOverride>>
}
```

Then, at the end of the file, add:

```ts
/** Flattens a row's per-flavour override into the row itself. Everything
 * downstream (the bubble, the checklist, the satisfaction checks) reads
 * steps through this, so there is exactly one place that knows overrides
 * exist. Idempotent: the result carries no `byFlavour`, so resolving twice
 * cannot apply an override to an already-overridden row. */
export function resolveCoachStep(
  step: CoachStepDef,
  flavour: CoachFlavour | null
): CoachStepDef {
  const override = flavour === null ? undefined : step.byFlavour?.[flavour]
  if (override === undefined) return step
  return { ...step, ...override, byFlavour: undefined }
}

/** The move "do it for me" runs, or null when this step has none. */
export function coachStepPrimaryMove(
  step: CoachStepDef,
  flavour: CoachFlavour | null
): CoachMove | null {
  const resolved = resolveCoachStep(step, flavour)
  if (resolved.primaryMoveId === undefined) return null
  return resolved.moves.find((move) => move.id === resolved.primaryMoveId) ?? null
}

/** The kinds this step pre-arms in Discover's add row -- deliberately
 * derived from the primary move rather than stored a second time, so "what
 * the row is armed with" and "what do-it-for-me adds" can never drift
 * apart. null for a step that arms nothing. */
export function coachStepArmKinds(
  step: CoachStepDef,
  flavour: CoachFlavour | null
): readonly DiscoverSlotKind[] | null {
  const move = coachStepPrimaryMove(step, flavour)
  if (move === null || move.action.kind !== 'add-slot') return null
  return move.action.kinds
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Typecheck, lint, and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0. (The three placeholder rows all have `moves: []`, so adding a required `action` field to `CoachMove` breaks nothing.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/coachSteps.ts src/shared/coachSteps.test.ts
git commit -m "$(cat <<'EOF'
A step can now offer an answer, and make a move

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 2: The eight phase-1 steps and the two orderings

This replaces the framework's `climax-loop` placeholder. The other two placeholders (`sections`, `finish`) stay exactly as they are — they belong to build-order steps 3 and 4.

**Files:**
- Modify: `src/shared/coachSteps.ts`
- Modify: `src/shared/coach.ts` (one call site)
- Test: `src/shared/coachSteps.test.ts`
- Test: `src/shared/coach.test.ts` (existing tests, updated for the new ids)

- [ ] **Step 1: Write the failing test**

Replace the `describe('coach steps', ...)` block in `src/shared/coachSteps.test.ts` wholesale with:

```ts
describe('coach steps', () => {
  it('starts on the melodic-or-groove question', () => {
    expect(FIRST_COACH_STEP_ID).toBe('p1-flavour')
    expect(COACH_STEPS[0].id).toBe('p1-flavour')
  })

  it('looks a step up by id, and returns undefined for an unknown one', () => {
    expect(coachStepById('p1-hook')?.phase).toBe('loop')
    expect(coachStepById('not-a-step')).toBeUndefined()
  })

  it('orders phase one by the answer -- only the low end and harmony swap', () => {
    expect(coachStepOrder('groove')).toEqual([
      'p1-flavour',
      'p1-low-end',
      'p1-harmony',
      'p1-drums',
      'p1-supporting',
      'p1-hook',
      'p1-balance',
      'p1-lock',
      'sections',
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
      'sections',
      'finish'
    ])
  })

  it('walks the order for the flavour it is given and ends at null', () => {
    const visited: string[] = [FIRST_COACH_STEP_ID]
    let id = nextCoachStepId(FIRST_COACH_STEP_ID, 'melodic')
    while (id !== null) {
      visited.push(id)
      id = nextCoachStepId(id, 'melodic')
    }
    expect(visited).toEqual(coachStepOrder('melodic'))
  })

  it('walks the groove order when no answer has been given yet', () => {
    expect(nextCoachStepId('p1-flavour', null)).toBe('p1-low-end')
  })

  it('groups steps by phase, in the order for that flavour, without losing any', () => {
    const grouped = COACH_PHASES.flatMap((phase) => coachStepsInPhase(phase.id, 'melodic'))
    expect(grouped.map((step) => step.id)).toEqual(coachStepOrder('melodic'))
  })

  it('narrows a persisted string to a known step id', () => {
    expect(isCoachStepId('sections')).toBe(true)
    expect(isCoachStepId('climax-loop')).toBe(false)
    expect(isCoachStepId(42)).toBe(false)
  })

  it('arms the kinds each phase-one step is about, per flavour', () => {
    const lowEnd = coachStepById('p1-low-end')!
    expect(coachStepArmKinds(lowEnd, 'groove')).toEqual(['bass'])
    expect(coachStepArmKinds(lowEnd, 'melodic')).toEqual(['bass'])
    // Groove gets the kick as a second, non-primary move; melodic does not.
    expect(resolveCoachStep(lowEnd, 'groove').moves.map((m) => m.id)).toEqual([
      'low-end-bass',
      'low-end-drums'
    ])
    expect(resolveCoachStep(lowEnd, 'melodic').moves.map((m) => m.id)).toEqual(['low-end-bass'])

    expect(coachStepArmKinds(coachStepById('p1-harmony')!, 'groove')).toEqual(['lead', 'warm'])
    expect(coachStepArmKinds(coachStepById('p1-drums')!, 'groove')).toEqual(['drums', 'rhythmic'])
    expect(coachStepArmKinds(coachStepById('p1-drums')!, 'melodic')).toEqual(['drums'])
    expect(coachStepArmKinds(coachStepById('p1-supporting')!, null)).toEqual(['bassHeavy'])
    expect(coachStepArmKinds(coachStepById('p1-hook')!, null)).toEqual(['lead', 'bright'])
  })

  it('arms nothing on the question, the balance pass or the lock-in', () => {
    expect(coachStepArmKinds(coachStepById('p1-flavour')!, null)).toBeNull()
    expect(coachStepArmKinds(coachStepById('p1-balance')!, null)).toBeNull()
    expect(coachStepArmKinds(coachStepById('p1-lock')!, null)).toBeNull()
  })

  it('offers both answers and the seeded start on the question step', () => {
    const offers = coachStepById('p1-flavour')!.offers ?? []
    expect(offers.map((offer) => offer.action)).toEqual([
      { kind: 'set-flavour', flavour: 'groove' },
      { kind: 'set-flavour', flavour: 'melodic' },
      { kind: 'open-riff-browser' }
    ])
  })

  it('never lets the harmony step and the hook step satisfy each other', () => {
    // bright and warm are opposite ends of one field, so normalizeSlotKinds
    // keeps at most one of them in a set -- a harmony slot can never be a
    // superset of the hook's own set, or the other way round.
    const harmony = coachStepById('p1-harmony')!.satisfiedBy ?? []
    const hook = coachStepById('p1-hook')!.satisfiedBy ?? []
    expect(harmony).toEqual([['lead']])
    expect(hook).toEqual([['lead', 'bright']])
  })

  it('leaves the two later-phase placeholders alone for their own plans', () => {
    expect(coachStepById('sections')?.phase).toBe('arrangement')
    expect(coachStepById('finish')?.phase).toBe('polish')
  })

  it('gives every step at least three hand-written line variants', () => {
    for (const step of COACH_STEPS) {
      expect(step.lines.length).toBeGreaterThanOrEqual(3)
      for (const flavour of COACH_FLAVOURS) {
        expect(resolveCoachStep(step, flavour).lines.length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps every line inside the app copy rules: lowercase start, no emoji, no exclamation', () => {
    for (const step of COACH_STEPS) {
      for (const flavour of [null, ...COACH_FLAVOURS]) {
        const resolved = resolveCoachStep(step, flavour)
        for (const line of resolved.lines) {
          expect(line).not.toMatch(/!/)
          expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
          expect(line[0]).toBe(line[0].toLowerCase())
        }
        for (const label of [resolved.label, ...resolved.moves.map((m) => m.label)]) {
          expect(label).toBe(label.toLowerCase())
        }
      }
    }
  })

  it('never says anything that could be wrong about a particular track', () => {
    // The spec's rule, as a test: he describes the STEP, never the music.
    for (const step of COACH_STEPS) {
      for (const flavour of [null, ...COACH_FLAVOURS]) {
        for (const line of resolveCoachStep(step, flavour).lines) {
          expect(line).not.toMatch(/it looks like/i)
          expect(line).not.toMatch(/your (track|song|mix) (needs|sounds|is)/i)
          expect(line).not.toMatch(/\b(better|worse|too (much|many|thin|loud))\b/i)
        }
      }
    }
  })
})
```

Add `coachStepOrder` to that file's import block (alphabetically, after `coachStepById`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: FAIL — `No "coachStepOrder" export is defined on the module`.

- [ ] **Step 3: Replace the placeholder row and add the ordering**

In `src/shared/coachSteps.ts`:

**3a.** Replace the `CoachStepId` union with:

```ts
/** Every step the flow can be on. A closed union rather than a bare string
 * so a typo in a later phase plan is a typecheck failure -- persisted
 * values are validated back into it by isCoachStepId (a .sssketchproj is
 * plain JSON people can and do hand-edit; a load must never throw).
 *
 * The 'p1-' rows are phase one, shipped 2026-09-22 (build order step 2);
 * they replaced the framework's single 'climax-loop' placeholder, so a
 * project saved by that build loads with an unknown stepId and is repaired
 * back to the first step -- see sanitiseLoadedCoach. 'sections' and
 * 'finish' are still placeholders, for build order steps 3 and 4. */
export type CoachStepId =
  | 'p1-flavour'
  | 'p1-low-end'
  | 'p1-harmony'
  | 'p1-drums'
  | 'p1-supporting'
  | 'p1-hook'
  | 'p1-balance'
  | 'p1-lock'
  | 'sections'
  | 'finish'
```

**3b.** Add, just above `COACH_STEPS`:

```ts
/** Every phase-one step stands next to Discover's own add row -- the
 * arm-then-fire chip row this whole phase drives (DiscoverPanel.tsx's own
 * pendingAddKinds). One constant so a rename of the attribute is a single
 * edit here and one in DiscoverPanel.tsx. */
const DISCOVER_ADD_ROW = '[data-coach-anchor="discover-add-row"]'
```

**3c.** Replace the `climax-loop` entry in `COACH_STEPS` (the whole first object literal) with the eight rows below, leaving the `sections` and `finish` entries after them untouched:

```ts
  {
    id: 'p1-flavour',
    phase: 'loop',
    label: 'melodic or groove',
    lines: [
      'two ways in. melodic, or groove? it only sets the order of the next few steps.',
      'first question: melodic or groove. nothing rides on it except what we stack first.',
      'melodic or groove. either way you end up with the same loop, built in a different order.',
      'pick a way in -- melodic or groove -- or start from a riff you already love.'
    ],
    // Deliberately empty. "do it for me" is disabled here, and that is the
    // point: answering this for you would be the app making a decision
    // about your track, which is the one thing this feature does not do.
    moves: [],
    offers: [
      { id: 'flavour-groove', label: 'groove', action: { kind: 'set-flavour', flavour: 'groove' } },
      {
        id: 'flavour-melodic',
        label: 'melodic',
        action: { kind: 'set-flavour', flavour: 'melodic' }
      },
      {
        id: 'seed-from-riff',
        label: 'start from a riff you love',
        action: { kind: 'open-riff-browser' }
      }
    ],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-low-end',
    phase: 'loop',
    label: 'the low end',
    lines: [
      'the low end. a bassish stem, armed in the add row.',
      'this step is the bottom of the loop. bassish is armed below.',
      'low end next. one bassish stem; reroll it as often as you like.',
      'the floor of the loop goes in here. the add row is set to bassish.'
    ],
    moves: [
      {
        id: 'low-end-bass',
        label: 'add a bassish one',
        action: { kind: 'add-slot', kinds: ['bass'] }
      }
    ],
    primaryMoveId: 'low-end-bass',
    satisfiedBy: [['bass']],
    anchorSelector: DISCOVER_ADD_ROW,
    byFlavour: {
      groove: {
        label: 'the low end -- bass and kick',
        lines: [
          'grooves get built from underneath. bass and kick first, everything else sits on those.',
          'low end first. one bassish, one drummy -- both are under "stuck".',
          'start at the bottom: a bassish stem and a drummy one. that pair is the floor.',
          'this step is the low end, which for a groove means the bass and the kick together.'
        ],
        moves: [
          {
            id: 'low-end-bass',
            label: 'add a bassish one',
            action: { kind: 'add-slot', kinds: ['bass'] }
          },
          {
            id: 'low-end-drums',
            label: 'add a drummy one',
            action: { kind: 'add-slot', kinds: ['drums'] }
          }
        ],
        primaryMoveId: 'low-end-bass',
        satisfiedBy: [['bass'], ['drums']]
      },
      melodic: {
        label: 'the low end',
        lines: [
          'now the bottom. a bassish stem under the harmony you just picked.',
          'low end next, under what is already there. bassish is armed.',
          'give it a floor: one bassish stem below the harmony.',
          'this step is the bass. it goes under the harmony, not over it.'
        ]
      }
    }
  },
  {
    id: 'p1-harmony',
    phase: 'loop',
    label: 'harmony',
    lines: [
      'harmony next. the add row is armed for leadesque and buttery together.',
      'this is the chords step. leadesque · buttery, as one slot.',
      'something to hold the chords: leadesque, on the buttery side.',
      'harmony now. one slot, both kinds -- and a plain leadesque one is under "stuck".'
    ],
    moves: [
      {
        id: 'harmony-warm-lead',
        label: 'add a leadesque · buttery one',
        action: { kind: 'add-slot', kinds: ['lead', 'warm'] }
      },
      {
        id: 'harmony-lead',
        label: 'add a plain leadesque one',
        action: { kind: 'add-slot', kinds: ['lead'] }
      }
    ],
    primaryMoveId: 'harmony-warm-lead',
    satisfiedBy: [['lead']],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-drums',
    phase: 'loop',
    label: 'drums',
    lines: [
      'drums now. the add row is armed for drummy.',
      'time for the kit. one drummy stem, under the harmony and the bass.',
      'this step is drums. add one, reroll it as many times as you like.',
      'drums go in here. drummy is armed below.'
    ],
    moves: [
      {
        id: 'drums-plain',
        label: 'add a drummy one',
        action: { kind: 'add-slot', kinds: ['drums'] }
      }
    ],
    primaryMoveId: 'drums-plain',
    satisfiedBy: [['drums']],
    anchorSelector: DISCOVER_ADD_ROW,
    byFlavour: {
      groove: {
        label: 'drums, filled out',
        lines: [
          'the kick is already down. this step fills the kit out -- drummy, on the rhythmic side.',
          'more drums. the add row is armed for drummy · rhythmic, on top of what is there.',
          'fill the kit out: a second drummy layer, the busy one.',
          'drums again, this time the part that moves. drummy · rhythmic is armed.'
        ],
        moves: [
          {
            id: 'drums-rhythmic',
            label: 'add a drummy · rhythmic one',
            action: { kind: 'add-slot', kinds: ['drums', 'rhythmic'] }
          },
          {
            id: 'drums-plain',
            label: 'add a plain drummy one',
            action: { kind: 'add-slot', kinds: ['drums'] }
          }
        ],
        primaryMoveId: 'drums-rhythmic',
        satisfiedBy: [['drums', 'rhythmic']]
      }
    }
  },
  {
    id: 'p1-supporting',
    phase: 'loop',
    label: 'supporting parts',
    lines: [
      'supporting parts. chonky, rhythmic or sparkly -- one of the three, whichever you fancy.',
      'this step is the layer between the parts: chonky, rhythmic, sparkly.',
      'something to sit in the gaps. the add row is armed for chonky; the other two are under "stuck".',
      'supporting layer now. three kinds to choose from, one slot.'
    ],
    moves: [
      {
        id: 'supporting-chonky',
        label: 'add a chonky one',
        action: { kind: 'add-slot', kinds: ['bassHeavy'] }
      },
      {
        id: 'supporting-rhythmic',
        label: 'add a rhythmic one',
        action: { kind: 'add-slot', kinds: ['rhythmic'] }
      },
      {
        id: 'supporting-sparkly',
        label: 'add a sparkly one',
        action: { kind: 'add-slot', kinds: ['bright'] }
      }
    ],
    primaryMoveId: 'supporting-chonky',
    // A drummy · rhythmic stem from the previous step is also a superset of
    // ['rhythmic'], so on a groove this step can read as satisfied the
    // moment it starts. That is honest: the tick reports a fact about the
    // slots, not a claim that the step's work is done -- and next/skip are
    // always there either way.
    satisfiedBy: [['bassHeavy'], ['rhythmic'], ['bright']],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-hook',
    phase: 'loop',
    label: 'the hook',
    lines: [
      'the hook. roll three or four of them and pick between them -- comparing is the whole step.',
      'hook step. add one, then add another, then another. the point is having options.',
      'this one is the hook. try three or four before you settle on one.',
      'the hook goes here. leadesque · sparkly is armed; reroll it a few times.'
    ],
    moves: [
      {
        id: 'hook-first',
        label: 'add a leadesque · sparkly one',
        action: { kind: 'add-slot', kinds: ['lead', 'bright'] }
      },
      {
        id: 'hook-another',
        label: 'add another one to compare',
        action: { kind: 'add-slot', kinds: ['lead', 'bright'] }
      }
    ],
    primaryMoveId: 'hook-first',
    satisfiedBy: [['lead', 'bright']],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-balance',
    phase: 'loop',
    label: 'rough balance',
    lines: [
      'rough balance. drag a slot waveform up or down to set its level -- it carries onto the timeline.',
      'levels now. each slot has its own gain, set by dragging on its waveform.',
      'set a rough balance while the loop plays. nothing here is permanent.',
      'this is the last step before the loop gets locked. rough is fine.'
    ],
    // Nothing to automate: a balance is the user listening. The bubble says
    // so plainly (COACH_NO_MOVES_LINES) rather than inventing a move.
    moves: [],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-lock',
    phase: 'loop',
    label: 'lock in the climax',
    lines: [
      'lock the loop in. its stems, roles and levels become the material the next phase carves from.',
      'this is the freeze. locking keeps a copy of the loop as it stands right now.',
      'lock in the climax. nothing is destroyed -- it just gives phase two something to subtract from.',
      'ready to lock? the loop as it is becomes the full version of every section.'
    ],
    moves: [
      { id: 'lock-climax', label: 'lock the loop in', action: { kind: 'lock-climax' } }
    ],
    primaryMoveId: 'lock-climax',
    anchorSelector: DISCOVER_ADD_ROW
  },
```

**3d.** Replace `nextCoachStepId` and `coachStepsInPhase` (at the bottom of the file) with:

```ts
/** Phase one in groove order. Also the order COACH_STEPS itself is written
 * in, and the order used before the question has been answered -- the two
 * differ only in whether the low end or the harmony comes first, so a
 * checklist opened before answering shows a real order, not a guess, and
 * reorders itself the moment an answer lands. */
const PHASE1_GROOVE_ORDER: readonly CoachStepId[] = [
  'p1-flavour',
  'p1-low-end',
  'p1-harmony',
  'p1-drums',
  'p1-supporting',
  'p1-hook',
  'p1-balance',
  'p1-lock'
]

const PHASE1_MELODIC_ORDER: readonly CoachStepId[] = [
  'p1-flavour',
  'p1-harmony',
  'p1-low-end',
  'p1-drums',
  'p1-supporting',
  'p1-hook',
  'p1-balance',
  'p1-lock'
]

/** Phases two and three, whose own plans will expand these two rows. The
 * answer to the melodic-or-groove question does not reach them. */
const LATER_PHASE_ORDER: readonly CoachStepId[] = ['sections', 'finish']

/** The whole flow, in the order this answer puts it in. */
export function coachStepOrder(flavour: CoachFlavour | null): readonly CoachStepId[] {
  const phase1 = flavour === 'melodic' ? PHASE1_MELODIC_ORDER : PHASE1_GROOVE_ORDER
  return [...phase1, ...LATER_PHASE_ORDER]
}

/** The next step in this flavour's own order, or null when this is the last
 * one -- which is what ends the flow (see advanceCoach in ./coach.ts).
 * `flavour` is required rather than defaulted on purpose: a caller that
 * forgets it would silently walk a melodic flow in groove order, and a
 * typecheck failure is a much cheaper way to find that out. */
export function nextCoachStepId(
  id: CoachStepId,
  flavour: CoachFlavour | null
): CoachStepId | null {
  const order = coachStepOrder(flavour)
  const index = order.indexOf(id)
  if (index < 0 || index >= order.length - 1) return null
  return order[index + 1]
}

/** This phase's steps, in this flavour's order, with per-flavour overrides
 * already applied -- the checklist renders these directly. */
export function coachStepsInPhase(
  phase: CoachPhase,
  flavour: CoachFlavour | null = null
): readonly CoachStepDef[] {
  const steps: CoachStepDef[] = []
  for (const id of coachStepOrder(flavour)) {
    const step = coachStepById(id)
    if (step === undefined || step.phase !== phase) continue
    steps.push(resolveCoachStep(step, flavour))
  }
  return steps
}
```

- [ ] **Step 4: Fix the one production call site**

In `src/shared/coach.ts`, inside `advanceCoach`, replace:

```ts
  const nextId = nextCoachStepId(banked.stepId)
```

with:

```ts
  // The order depends on the melodic-or-groove answer (coachStepOrder) --
  // a flow that has not answered yet walks the groove order, which is also
  // the order COACH_STEPS itself is written in.
  const nextId = nextCoachStepId(banked.stepId, banked.flavour)
```

This will not typecheck until Task 4 adds `flavour` to `CoachState`. **That is expected** — finish Step 5 below first, which updates the existing tests, then run the suite at the end of Task 4. To keep this task green on its own, use `null` for now and change it to `banked.flavour` in Task 4:

```ts
  // Task 4 replaces `null` with `banked.flavour` once CoachState carries it.
  const nextId = nextCoachStepId(banked.stepId, null)
```

- [ ] **Step 5: Update the existing coach.test.ts expectations for the new ids**

In `src/shared/coach.test.ts`, make exactly these replacements:

- line ~28 `expect(coach.stepId).toBe('climax-loop')` → `expect(coach.stepId).toBe('p1-flavour')`
- line ~58 `expect(resumed.stepId).toBe('climax-loop')` → `expect(resumed.stepId).toBe('p1-flavour')`
- line ~80-81:
  ```ts
    expect(next.outcomes).toEqual({ 'p1-flavour': 'done' })
    expect(next.stepId).toBe('p1-low-end')
  ```
- line ~91 `expect(next.outcomes).toEqual({ 'climax-loop': 'skipped' })` → `expect(next.outcomes).toEqual({ 'p1-flavour': 'skipped' })`
- line ~138 `expect(dismissed.stepId).toBe('climax-loop')` → `expect(dismissed.stepId).toBe('p1-flavour')`
- line ~255-256:
  ```ts
    expect(loaded?.stepId).toBe('p1-low-end')
    expect(loaded?.outcomes).toEqual({ 'p1-flavour': 'skipped' })
  ```
- line ~280-281 (inside the "repairs a hand-edited file" expectation) `stepId: 'climax-loop'` → `stepId: 'p1-flavour'`

Replace the whole `it('finishes the flow after the last step, with the clock stopped', ...)` test with a version that does not hard-code a step count:

```ts
  it('finishes the flow after the last step, with the clock stopped', () => {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50) // a runaway loop is a bug, not a hang
    }
    expect(coach.stepId).toBe('finish')
    expect(coach.runningSince).toBeNull()
    expect(Object.keys(coach.outcomes)).toEqual([...coachStepOrder(null)])
  })
```

and the `it('leaves a finished flow finished', ...)` test inside `describe('sanitiseLoadedCoach', ...)`:

```ts
  it('leaves a finished flow finished', () => {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50)
    }
    expect(sanitiseLoadedCoach(JSON.parse(JSON.stringify(coach)))?.status).toBe('finished')
  })
```

Change that file's `import { COACH_STEPS } from './coachSteps'` line to:

```ts
import { COACH_STEPS, coachStepOrder } from './coachSteps'
```

- [ ] **Step 6: Run both test files**

Run: `npx vitest run src/shared/coachSteps.test.ts src/shared/coach.test.ts`
Expected: PASS, both files.

- [ ] **Step 7: Update the remaining step-id expectations outside src/shared**

In `src/renderer/src/state/store.test.ts` (the `describe('the guided flow (sssketchy)')` block, ~line 2776):

- `expect(state.coach?.stepId).toBe('climax-loop')` (both occurrences, ~2788 and ~2798) → `toBe('p1-flavour')`
- the `COACH_START restarts a finished flow` test advances three times to reach the end; replace its three `COACH_ADVANCE` lines with a loop:
  ```ts
    let n = 1
    while (state.coach?.status !== 'finished') {
      state = reducer(state, { type: 'COACH_ADVANCE', now: NOW + n * MINUTE, outcome: 'done' })
      n += 1
      expect(n).toBeLessThan(50)
    }
  ```
- `COACH_ADVANCE records next and skip differently` (~2805-2806):
  ```ts
    expect(state.coach?.stepId).toBe('p1-low-end')
    expect(state.coach?.outcomes).toEqual({ 'p1-flavour': 'skipped' })
  ```
- the last assertion of the status test (~2819) → `expect(state.coach?.stepId).toBe('p1-flavour')`

In `src/renderer/src/state/serialize.test.ts` (~line 581-583):

```ts
    expect(restored.coach?.stepId).toBe('p1-low-end')
    expect(restored.coach?.outcomes).toEqual({ 'p1-flavour': 'skipped' })
    expect(restored.coach?.phaseElapsedMs.loop).toBe(8 * MINUTE)
```

and (~line 631) `expect(restored.coach?.stepId).toBe('p1-flavour')`.

- [ ] **Step 8: Run the whole suite, typecheck and lint**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/shared/coachSteps.ts src/shared/coachSteps.test.ts src/shared/coach.ts \
  src/shared/coach.test.ts src/renderer/src/state/store.test.ts \
  src/renderer/src/state/serialize.test.ts
git commit -m "$(cat <<'EOF'
Eight real steps, and two orders to walk them in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 3: The locked climax, as a value

**Files:**
- Create: `src/shared/coachClimax.ts`
- Test: `src/shared/coachClimax.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachClimax.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  coachSlotRole,
  isDiscoverSlotKind,
  lockClimaxFromSlots,
  sanitiseLockedClimax,
  type CoachSlotSnapshot
} from './coachClimax'

const NOW = 1_700_000_000_000

function slot(overrides: Partial<CoachSlotSnapshot> = {}): CoachSlotSnapshot {
  return {
    id: 'slot-1',
    kinds: ['bass'],
    stem: {
      path: '/stems/bass.wav',
      name: 'low one',
      author: 'someone',
      type: 'bass',
      durationSec: 8,
      barLength: 4
    },
    gain: 1,
    audible: true,
    rolling: false,
    ...overrides
  }
}

describe('coachSlotRole', () => {
  it('reads the role off the kinds Discover itself tagged, mask kinds first', () => {
    expect(coachSlotRole(['drums'])).toBe('drums')
    expect(coachSlotRole(['bright', 'lead'])).toBe('lead')
    expect(coachSlotRole(['warm'])).toBe('aux')
  })

  it('falls back to aux rather than guessing for an empty set', () => {
    expect(coachSlotRole([])).toBe('aux')
  })
})

describe('lockClimaxFromSlots', () => {
  it('freezes stems, roles and gains', () => {
    const climax = lockClimaxFromSlots(
      [slot(), slot({ id: 'slot-2', kinds: ['drums'], gain: 0.6, stem: { ...slot().stem!, path: '/stems/dr.wav', type: 'drums', barLength: 2 } })],
      120,
      NOW
    )
    expect(climax?.bpm).toBe(120)
    expect(climax?.lockedAt).toBe(NOW)
    // The longest member, exactly like assembleDiscoverRifff's own rule.
    expect(climax?.barLength).toBe(4)
    expect(climax?.stems.map((s) => s.role)).toEqual(['bass', 'drums'])
    expect(climax?.stems.map((s) => s.gain)).toEqual([1, 0.6])
    expect(climax?.stems.map((s) => s.path)).toEqual(['/stems/bass.wav', '/stems/dr.wav'])
  })

  it('keeps a muted slot at gain zero rather than dropping it', () => {
    // Exactly what resolveDiscoverRifff already does when plunking into the
    // arranger: the stem stays, silent, instead of vanishing.
    const climax = lockClimaxFromSlots([slot({ audible: false, gain: 0.8 })], 120, NOW)
    expect(climax?.stems).toHaveLength(1)
    expect(climax?.stems[0].gain).toBe(0)
  })

  it('ignores a slot with nothing behind it yet', () => {
    const climax = lockClimaxFromSlots([slot(), slot({ id: 'slot-2', stem: null })], 120, NOW)
    expect(climax?.stems).toHaveLength(1)
  })

  it('returns null when there is nothing to lock', () => {
    expect(lockClimaxFromSlots([], 120, NOW)).toBeNull()
    expect(lockClimaxFromSlots([slot({ stem: null })], 120, NOW)).toBeNull()
  })

  it('normalizes each slot kind set, so two orderings lock identically', () => {
    const a = lockClimaxFromSlots([slot({ kinds: ['warm', 'lead'] })], 120, NOW)
    const b = lockClimaxFromSlots([slot({ kinds: ['lead', 'warm'] })], 120, NOW)
    expect(a?.stems[0].kinds).toEqual(['lead', 'warm'])
    expect(a).toEqual(b)
  })
})

describe('sanitiseLockedClimax', () => {
  it('round-trips a real locked climax through JSON', () => {
    const climax = lockClimaxFromSlots([slot()], 120, NOW)
    expect(sanitiseLockedClimax(JSON.parse(JSON.stringify(climax)))).toEqual(climax)
  })

  it('returns null for anything that is not one', () => {
    expect(sanitiseLockedClimax(null)).toBeNull()
    expect(sanitiseLockedClimax(undefined)).toBeNull()
    expect(sanitiseLockedClimax('nope')).toBeNull()
    expect(sanitiseLockedClimax({ bpm: 120, stems: 'lots' })).toBeNull()
  })

  it('drops a hand-edited stem it cannot read rather than throwing', () => {
    const repaired = sanitiseLockedClimax({
      bpm: 'fast',
      barLength: -3,
      lockedAt: NOW,
      stems: [
        { path: '/ok.wav', name: 'ok', author: 'a', type: 'bass', durationSec: 8, barLength: 4, kinds: ['bass', 'banana'], role: 'bass', gain: 3 },
        { name: 'no path' }
      ]
    })
    expect(repaired?.bpm).toBe(120)
    expect(repaired?.barLength).toBe(4)
    expect(repaired?.stems).toHaveLength(1)
    expect(repaired?.stems[0].kinds).toEqual(['bass'])
    expect(repaired?.stems[0].gain).toBe(1)
  })

  it('returns null when every stem was unreadable', () => {
    expect(sanitiseLockedClimax({ bpm: 120, stems: [{ nope: true }] })).toBeNull()
  })
})

describe('isDiscoverSlotKind', () => {
  it('narrows a persisted string', () => {
    expect(isDiscoverSlotKind('bassHeavy')).toBe(true)
    expect(isDiscoverSlotKind('banana')).toBe(false)
    expect(isDiscoverSlotKind(7)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachClimax.test.ts`
Expected: FAIL — `Failed to resolve import "./coachClimax"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachClimax.ts`:

```ts
/**
 * The material phase two carves from, and the framework-agnostic view of
 * Discover that produces it.
 *
 * Two shapes live here, both deliberately plain data:
 *
 * **CoachSlotSnapshot** is everything the guided flow is allowed to know
 * about one Discover slot. DiscoverPanel publishes these upward (it is the
 * only component that knows whether a slot has actually RESOLVED, whether
 * it is audible, and whether it is mid-roll); nothing in src/shared/ ever
 * sees a DiscoverSlot, a DiscoverCandidate or a React anything.
 *
 * **LockedClimax** is the spec's "lock in the climax... its stems, roles
 * and gains become the material phase 2 carves from". Roles come from the
 * kind set Discover itself tagged the slot with -- never from stem order or
 * channel index, which the spec rules out twice.
 */

import {
  DISCOVER_SLOT_KIND_OPTIONS,
  discoverSlotKindToArrangeRole,
  normalizeSlotKinds,
  type DiscoverSlotKind
} from './discoverSlotKind'
import type { ArrangeRole } from './stemRole'
import type { SoundType } from './types'

/** The parts of a resolved Discover stem the guided flow needs. A subset of
 * DiscoverPanel's own ResolvedCandidateStem, restated here so src/shared/
 * does not import from the renderer. */
export interface CoachStemSnapshot {
  path: string
  name: string
  author: string
  type: SoundType
  durationSec: number
  barLength: number
}

export interface CoachSlotSnapshot {
  id: string
  /** The kinds this slot targets -- Discover's own role tagging. */
  kinds: readonly DiscoverSlotKind[]
  /** null until this slot has real, locally-resolved audio behind it. This
   * is what "a step completes when a slot with those kinds resolves" (spec)
   * actually tests. */
  stem: CoachStemSnapshot | null
  /** 0-1, the slot's own committed gain. */
  gain: number
  /** In Discover's audible preview mix (i.e. not muted). */
  audible: boolean
  /** Mid-roll. The only reason the flow knows is so sssketchy can climb
   * while the app works, which is a fact about the machine, not a guess. */
  rolling: boolean
}

export interface LockedClimaxStem extends CoachStemSnapshot {
  kinds: DiscoverSlotKind[]
  role: ArrangeRole
  gain: number
}

export interface LockedClimax {
  bpm: number
  /** The longest member's bar length -- the same rule assembleDiscoverRifff
   * already uses for a placed Discover rifff, so a section built from this
   * tiles exactly like the loop did. */
  barLength: number
  stems: LockedClimaxStem[]
  lockedAt: number
}

const KIND_SET = new Set<string>(DISCOVER_SLOT_KIND_OPTIONS)

export function isDiscoverSlotKind(value: unknown): value is DiscoverSlotKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

/** The ArrangeRole a slot's kind set stands for. normalizeSlotKinds puts
 * mask kinds (drums/bass/lead) first, so a combination slot is named by its
 * mask kind when it has one, and by its trait kind otherwise -- exactly the
 * mapping discoverSlotKindToArrangeRole already defines for placing a
 * Discover pick on the timeline. 'aux' for an empty set, which only a
 * hand-edited project can produce. */
export function coachSlotRole(kinds: readonly DiscoverSlotKind[]): ArrangeRole {
  const normalized = normalizeSlotKinds(kinds)
  if (normalized.length === 0) return 'aux'
  return discoverSlotKindToArrangeRole(normalized[0])
}

function clampGain(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

/**
 * Freezes the loop as it stands. Every slot with real audio behind it is
 * included, muted ones at gain 0 rather than dropped -- the same choice
 * resolveDiscoverRifff already makes when plunking into the arranger ("keeps
 * the stem itself present... just silent"), so the locked climax and the
 * placed loop agree about what is in the loop.
 *
 * Returns null when nothing has resolved yet; the caller leaves the flow
 * alone rather than locking an empty climax.
 */
export function lockClimaxFromSlots(
  slots: readonly CoachSlotSnapshot[],
  bpm: number,
  now: number
): LockedClimax | null {
  const stems: LockedClimaxStem[] = []
  for (const slot of slots) {
    if (slot.stem === null) continue
    const kinds = normalizeSlotKinds(slot.kinds)
    stems.push({
      ...slot.stem,
      kinds,
      role: coachSlotRole(kinds),
      gain: slot.audible ? clampGain(slot.gain) : 0
    })
  }
  if (stems.length === 0) return null
  return {
    bpm,
    barLength: Math.max(...stems.map((stem) => stem.barLength), 1),
    stems,
    lockedAt: now
  }
}

function finitePositive(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

function loadedStem(value: unknown): LockedClimaxStem | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (typeof loose.path !== 'string' || loose.path === '') return null
  const kinds = normalizeSlotKinds(
    (Array.isArray(loose.kinds) ? loose.kinds : []).filter(isDiscoverSlotKind)
  )
  return {
    path: loose.path,
    name: typeof loose.name === 'string' ? loose.name : '',
    author: typeof loose.author === 'string' ? loose.author : '',
    type: (typeof loose.type === 'string' ? loose.type : 'audioIn') as SoundType,
    durationSec: finitePositive(loose.durationSec, 0.1),
    barLength: finitePositive(loose.barLength, 1),
    kinds,
    role: coachSlotRole(kinds),
    gain: clampGain(loose.gain)
  }
}

/**
 * Turns whatever a `.sssketchproj` actually contains into a LockedClimax,
 * or null -- the same repair-rather-than-trust rule the rest of the load
 * path follows, for the same reason: a project file is plain JSON that
 * people can and do hand-edit, and a load must never throw.
 *
 * `role` is recomputed from the (validated) kinds rather than read from the
 * file, so a hand-edited role can never disagree with the kinds phase two
 * will key its suggested drops off.
 */
export function sanitiseLockedClimax(value: unknown): LockedClimax | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (!Array.isArray(loose.stems)) return null
  const stems = loose.stems.map(loadedStem).filter((stem): stem is LockedClimaxStem => stem !== null)
  if (stems.length === 0) return null
  return {
    bpm: finitePositive(loose.bpm, 120),
    barLength: finitePositive(loose.barLength, Math.max(...stems.map((s) => s.barLength), 1)),
    stems,
    lockedAt: finitePositive(loose.lockedAt, 0)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachClimax.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/coachClimax.ts src/shared/coachClimax.test.ts
git commit -m "$(cat <<'EOF'
Freeze the loop as stems, roles and levels

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 4: Three new fields on `CoachState`

**Files:**
- Modify: `src/shared/coach.ts`
- Test: `src/shared/coach.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/shared/coach.test.ts`:

```ts
describe('the phase-one fields on CoachState', () => {
  it('starts with no answer, no seeded note and no locked climax', () => {
    const coach = startCoach(T0)
    expect(coach.flavour).toBeNull()
    expect(coach.seededKinds).toEqual([])
    expect(coach.lockedClimax).toBeNull()
  })

  it('clears the seeded note on the next step -- one thought at a time', () => {
    const seeded = { ...startCoach(T0), seededKinds: ['drums' as const, 'bass' as const] }
    expect(advanceCoach(seeded, T0 + MINUTE, 'done').seededKinds).toEqual([])
  })

  it('walks the melodic order once the answer is on the state', () => {
    const melodic = { ...startCoach(T0), flavour: 'melodic' as const }
    expect(advanceCoach(melodic, T0 + MINUTE, 'done').stepId).toBe('p1-harmony')
  })

  it('rotates the line variant per flavour, so an overridden step reads right', () => {
    const groove = { ...startCoach(T0), flavour: 'groove' as const, stepId: 'p1-low-end' as const }
    expect(coachLine(groove)).toBe(
      resolveCoachStep(coachStepById('p1-low-end')!, 'groove').lines[0]
    )
  })

  it('carries all three fields across a save and a load', () => {
    const saved = {
      ...startCoach(T0),
      flavour: 'melodic' as const,
      seededKinds: ['drums' as const],
      lockedClimax: lockClimaxFromSlots(
        [
          {
            id: 'slot-1',
            kinds: ['bass' as const],
            stem: {
              path: '/a.wav',
              name: 'a',
              author: 'b',
              type: 'bass' as const,
              durationSec: 8,
              barLength: 4
            },
            gain: 1,
            audible: true,
            rolling: false
          }
        ],
        120,
        T0
      )
    }
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.flavour).toBe('melodic')
    expect(loaded?.seededKinds).toEqual(['drums'])
    expect(loaded?.lockedClimax?.stems[0].role).toBe('bass')
  })

  it('repairs all three rather than trusting them', () => {
    const loaded = sanitiseLoadedCoach({
      status: 'active',
      stepId: 'p1-hook',
      flavour: 'jazz',
      seededKinds: ['drums', 'banana', 7],
      lockedClimax: { nope: true }
    })
    expect(loaded?.flavour).toBeNull()
    expect(loaded?.seededKinds).toEqual(['drums'])
    expect(loaded?.lockedClimax).toBeNull()
  })

  it('loads a project saved by the framework build, whose step no longer exists', () => {
    // The framework shipped one placeholder phase-one step, 'climax-loop'.
    // Phase one replaced it with eight real ones, so a project saved in
    // between comes back on the first step with everything else intact.
    const loaded = sanitiseLoadedCoach({
      status: 'active',
      stepId: 'climax-loop',
      outcomes: {},
      phaseElapsedMs: { loop: 4 * MINUTE, arrangement: 0, polish: 0 },
      stepElapsedMs: 2 * MINUTE,
      runningSince: T0,
      lineSeed: 3
    })
    expect(loaded?.stepId).toBe('p1-flavour')
    expect(loaded?.status).toBe('dismissed')
    expect(loaded?.flavour).toBeNull()
    expect(loaded?.lockedClimax).toBeNull()
    expect(loaded?.phaseElapsedMs.loop).toBe(4 * MINUTE)
  })
})
```

Extend that file's imports:

```ts
import { COACH_STEPS, coachStepById, coachStepOrder, resolveCoachStep } from './coachSteps'
import { lockClimaxFromSlots } from './coachClimax'
```

Also update the existing `it('repairs a hand-edited file rather than throwing', ...)` expectation object to include the three new fields:

```ts
    expect(loaded).toEqual({
      status: 'dismissed',
      stepId: 'p1-flavour',
      outcomes: { finish: 'done' },
      phaseElapsedMs: { loop: 0, arrangement: 0, polish: 0 },
      stepElapsedMs: 0,
      runningSince: null,
      lineSeed: 1,
      flavour: null,
      seededKinds: [],
      lockedClimax: null
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: FAIL — `Property 'flavour' does not exist on type 'CoachState'`.

- [ ] **Step 3: Add the fields**

In `src/shared/coach.ts`:

**3a.** Replace the import block from `./coachSteps` with:

```ts
import {
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachStepById,
  isCoachFlavour,
  isCoachStepId,
  nextCoachStepId,
  resolveCoachStep,
  type CoachFlavour,
  type CoachPhase,
  type CoachStepId
} from './coachSteps'
import {
  isDiscoverSlotKind,
  sanitiseLockedClimax,
  type LockedClimax
} from './coachClimax'
import type { DiscoverSlotKind } from './discoverSlotKind'
```

**3b.** Add these three fields to `CoachState`, after `lineSeed`:

```ts
  /** The answer to "melodic or groove", or null before it is given. It
   * orders phase one (coachStepOrder) and picks a step's per-flavour copy
   * (resolveCoachStep). It is a starting point, not a claim about the
   * music. */
  flavour: CoachFlavour | null
  /** The roles a seeded start already covered, named once on the step the
   * answer landed on ("you already have drummy and bassish. next:
   * harmony."). Cleared on the next transition, because one thought at a
   * time -- see advanceCoach. Empty whenever there is nothing to say. */
  seededKinds: DiscoverSlotKind[]
  /** The frozen climax loop: stems, roles and gains, as the material phase
   * two carves from (spec, phase 1 step 5). null until the lock-in step
   * runs. Real persisted project data, like the rest of this state. */
  lockedClimax: LockedClimax | null
```

**3c.** In `startCoach`, add to the returned object after `lineSeed: 0`:

```ts
    flavour: null,
    seededKinds: [],
    lockedClimax: null
```

**3d.** In `advanceCoach`, change the `nextCoachStepId` call (the `null` placeholder from Task 2) to:

```ts
  const nextId = nextCoachStepId(banked.stepId, banked.flavour)
```

and add `seededKinds: []` to **both** returned objects (the finished branch and the normal branch), directly after `lineSeed`:

```ts
      // One thought at a time: the seeded note belongs to the step it was
      // written for and never follows the user to the next one.
      seededKinds: []
```

**3e.** In `coachLine`, use the flavour's own copy:

```ts
export function coachLine(state: CoachState): string {
  const step = coachStepById(state.stepId)
  if (state.status === 'finished' || step === undefined) {
    return pickLineVariant(COACH_DONE_LINES, state.lineSeed)
  }
  return pickLineVariant(resolveCoachStep(step, state.flavour).lines, state.lineSeed)
}
```

**3f.** In `sanitiseLoadedCoach`, add the three fields to the returned object (after `lineSeed`):

```ts
    flavour: isCoachFlavour(loose.flavour) ? loose.flavour : null,
    seededKinds: (Array.isArray(loose.seededKinds) ? loose.seededKinds : []).filter(
      isDiscoverSlotKind
    ),
    lockedClimax: sanitiseLockedClimax(loose.lockedClimax)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coach.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/coach.ts src/shared/coach.test.ts
git commit -m "$(cat <<'EOF'
The flow remembers the answer, the note and the locked loop

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 5: Two new line tables

**Files:**
- Modify: `src/shared/coachLines.ts`
- Test: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/shared/coachLines.test.ts`, extend the import to:

```ts
import {
  COACH_DONE_LINES,
  COACH_NO_MOVES_LINES,
  COACH_SEEDED_LINE_TEMPLATES,
  COACH_STEP_SATISFIED_LINES,
  COACH_STUCK_LINES,
  pickLineVariant
} from './coachLines'
```

and change the `tables` constant inside `describe('the shared line tables', ...)` to:

```ts
  const tables = [
    COACH_STUCK_LINES,
    COACH_NO_MOVES_LINES,
    COACH_DONE_LINES,
    COACH_STEP_SATISFIED_LINES,
    COACH_SEEDED_LINE_TEMPLATES
  ]
```

Then append:

```ts
describe('the seeded-start templates', () => {
  it('each name both the roles already covered and the step that follows', () => {
    for (const template of COACH_SEEDED_LINE_TEMPLATES) {
      expect(template).toContain('{covered}')
      expect(template).toContain('{next}')
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: FAIL — `No "COACH_STEP_SATISFIED_LINES" export is defined on the module`.

- [ ] **Step 3: Add the tables**

Append to `src/shared/coachLines.ts`:

```ts
/** What the bubble says once the current step's own completion condition is
 * met -- "a step completes when a slot with those kinds resolves" (spec).
 * It reports the CONDITION, never the result: nothing here says the stem is
 * good, or that the step's work is finished, because only the person
 * listening knows that. next and skip stay available either way. */
export const COACH_STEP_SATISFIED_LINES: readonly string[] = [
  'this step has what it asked for. next when you are ready.',
  'that is the slot this step was after. next, or keep rerolling it.',
  'covered. move on whenever you like.',
  'the step is satisfied. whether it is finished is your call, not mine.'
]

/** Named once, on the step a seeded start lands you on: "seeded starts mark
 * already-covered roles done ('you've got drums and bass, next: harmony')"
 * (spec). {covered} is the list of role names Discover itself tagged;
 * {next} is the label of the step you are now on. Templates rather than
 * finished lines so the copy rules still get tested here, in one place with
 * the rest of the vocabulary. */
export const COACH_SEEDED_LINE_TEMPLATES: readonly string[] = [
  'you already have {covered}. next: {next}.',
  '{covered} is already covered by that riff. next: {next}.',
  'that riff brings {covered} with it, so we skip ahead. next: {next}.',
  'marked done from the riff you started with: {covered}. next: {next}.'
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachLines.ts src/shared/coachLines.test.ts
git commit -m "$(cat <<'EOF'
Two more things to say, and neither is an opinion

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 6: Phase-one transitions and completion checks

**Files:**
- Create: `src/shared/coachPhase1.ts`
- Test: `src/shared/coachPhase1.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachPhase1.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { CoachSlotSnapshot } from './coachClimax'
import {
  answerCoachFlavour,
  coachLineFor,
  coachSeededLine,
  coachStepSatisfied,
  lockCoachClimax,
  seededCoveredStepIds,
  slotCoversKindSet
} from './coachPhase1'
import { COACH_STEP_SATISFIED_LINES } from './coachLines'
import { coachStepById, resolveCoachStep } from './coachSteps'
import type { DiscoverSlotKind } from './discoverSlotKind'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

function slot(kinds: DiscoverSlotKind[], id = `slot-${kinds.join('-')}`): CoachSlotSnapshot {
  return {
    id,
    kinds,
    stem: {
      path: `/stems/${id}.wav`,
      name: id,
      author: 'someone',
      type: 'notes',
      durationSec: 8,
      barLength: 4
    },
    gain: 1,
    audible: true,
    rolling: false
  }
}

function unresolved(kinds: DiscoverSlotKind[]): CoachSlotSnapshot {
  return { ...slot(kinds), stem: null }
}

describe('slotCoversKindSet', () => {
  it('matches when the slot kinds are a superset of the wanted set', () => {
    expect(slotCoversKindSet(slot(['lead', 'bright']), ['lead'])).toBe(true)
    expect(slotCoversKindSet(slot(['lead', 'bright']), ['lead', 'bright'])).toBe(true)
    expect(slotCoversKindSet(slot(['lead']), ['lead', 'bright'])).toBe(false)
  })

  it('never matches a slot with nothing resolved behind it', () => {
    expect(slotCoversKindSet(unresolved(['lead']), ['lead'])).toBe(false)
  })
})

describe('coachStepSatisfied', () => {
  it('is false on the question until it is answered', () => {
    const coach = startCoach(T0)
    expect(coachStepSatisfied(coach, [])).toBe(false)
    expect(coachStepSatisfied({ ...coach, flavour: 'groove' }, [])).toBe(true)
  })

  it('completes a step when a slot with its kinds resolves', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-low-end' }
    expect(coachStepSatisfied(coach, [unresolved(['bass'])])).toBe(false)
    expect(coachStepSatisfied(coach, [slot(['bass'])])).toBe(true)
    // Groove's low end takes either half of it.
    expect(coachStepSatisfied(coach, [slot(['drums'])])).toBe(true)
  })

  it('does not let the harmony slot complete the hook step', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-hook' }
    expect(coachStepSatisfied(coach, [slot(['lead', 'warm'])])).toBe(false)
    expect(coachStepSatisfied(coach, [slot(['lead', 'bright'])])).toBe(true)
  })

  it('never completes the balance pass on its own', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-balance' }
    expect(coachStepSatisfied(coach, [slot(['bass']), slot(['drums'])])).toBe(false)
  })

  it('completes the lock-in step once there is a locked climax', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-lock' }
    expect(coachStepSatisfied(coach, [slot(['bass'])])).toBe(false)
    const locked = lockCoachClimax(coach, T0 + MINUTE, [slot(['bass'])], 120)
    expect(coachStepSatisfied(locked, [slot(['bass'])])).toBe(true)
  })
})

describe('seededCoveredStepIds', () => {
  it('marks the roles a seeded riff already covers, and nothing else', () => {
    const slots = [slot(['drums']), slot(['bass']), slot(['lead'])]
    expect(seededCoveredStepIds('groove', slots)).toEqual(['p1-low-end', 'p1-harmony'])
  })

  it('does not mark a step whose combination the seed does not cover', () => {
    // A seeded drums slot is ['drums'] -- not a superset of the groove
    // drums step's own {drummy, rhythmic}.
    expect(seededCoveredStepIds('groove', [slot(['drums'])])).toEqual(['p1-low-end'])
  })

  it('is empty for an empty Discover', () => {
    expect(seededCoveredStepIds('melodic', [])).toEqual([])
  })
})

describe('answerCoachFlavour', () => {
  it('records the answer and moves to the first step of that order', () => {
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'melodic', [])
    expect(answered.flavour).toBe('melodic')
    expect(answered.stepId).toBe('p1-harmony')
    expect(answered.outcomes).toEqual({ 'p1-flavour': 'done' })
    expect(answered.stepElapsedMs).toBe(0)
    expect(answered.runningSince).toBe(T0 + MINUTE)
    expect(answered.phaseElapsedMs.loop).toBe(MINUTE)
  })

  it('skips past the roles a seeded start already covers', () => {
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', [
      slot(['drums']),
      slot(['bass'])
    ])
    expect(answered.outcomes).toEqual({ 'p1-flavour': 'done', 'p1-low-end': 'done' })
    expect(answered.stepId).toBe('p1-harmony')
    expect(answered.seededKinds).toEqual(['drums', 'bass'])
  })

  it('has nothing to say about a seed when there is no seed', () => {
    expect(answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', []).seededKinds).toEqual([])
  })

  it('is asked once -- a second answer leaves the flow where it is', () => {
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', [])
    expect(answerCoachFlavour(answered, T0 + 2 * MINUTE, 'melodic', [])).toBe(answered)
  })
})

describe('lockCoachClimax', () => {
  it('freezes the loop onto the flow', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-lock' }
    const locked = lockCoachClimax(coach, T0 + MINUTE, [slot(['bass']), slot(['drums'])], 96)
    expect(locked.lockedClimax?.bpm).toBe(96)
    expect(locked.lockedClimax?.stems.map((s) => s.role)).toEqual(['bass', 'drums'])
    // Locking does not advance -- next/skip stay the user's.
    expect(locked.stepId).toBe('p1-lock')
  })

  it('leaves the flow alone when there is nothing resolved to lock', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-lock' }
    expect(lockCoachClimax(coach, T0 + MINUTE, [unresolved(['bass'])], 96)).toBe(coach)
  })
})

describe('the lines phase one adds', () => {
  it('swaps the step line for the satisfied line once the step is covered', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-low-end' }
    expect(coachLineFor(coach, [])).toBe(
      resolveCoachStep(coachStepById('p1-low-end')!, 'groove').lines[0]
    )
    expect(coachLineFor(coach, [slot(['bass'])])).toBe(COACH_STEP_SATISFIED_LINES[0])
  })

  it('names the covered roles and the step that follows', () => {
    expect(coachSeededLine(['drums', 'bass'], 'harmony', 0)).toBe(
      'you already have drummy and bassish. next: harmony.'
    )
    expect(coachSeededLine(['drums'], 'harmony', 0)).toBe(
      'you already have drummy. next: harmony.'
    )
  })

  it('has nothing to say when nothing was seeded', () => {
    expect(coachSeededLine([], 'harmony', 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/coachPhase1.test.ts`
Expected: FAIL — `Failed to resolve import "./coachPhase1"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachPhase1.ts`:

```ts
/**
 * Phase one's own decisions: what completes a step, what a seeded start
 * already covers, and the two transitions the framework's six actions do
 * not cover (answering the question, locking the climax).
 *
 * Everything here is pure and takes its view of Discover as a list of
 * CoachSlotSnapshots, which DiscoverPanel publishes upward -- see
 * ./coachClimax.ts. Nothing here knows that React, Electron or a
 * DiscoverCandidate exist.
 *
 * The rule that shapes all of it (spec, "What he is allowed to say"): every
 * check below is a fact about the SLOTS, never a judgement about the audio.
 * "A slot targeting drummy has resolved" is true or false and the app can
 * see it; "the drums are right" is not, and he never says it.
 */

import { pauseCoach, type CoachOutcome, type CoachState } from './coach'
import type { CoachSlotSnapshot } from './coachClimax'
import { lockClimaxFromSlots } from './coachClimax'
import { COACH_SEEDED_LINE_TEMPLATES, COACH_STEP_SATISFIED_LINES, pickLineVariant } from './coachLines'
import { coachLine } from './coach'
import {
  coachStepById,
  coachStepOrder,
  resolveCoachStep,
  type CoachFlavour,
  type CoachStepDef,
  type CoachStepId
} from './coachSteps'
import {
  DISCOVER_SLOT_KIND_LABEL,
  normalizeSlotKinds,
  type DiscoverSlotKind
} from './discoverSlotKind'

/** One slot against one wanted kind set: the slot must have really resolved
 * ("a step completes when a slot with those kinds resolves", spec) and its
 * own kinds must be a SUPERSET of the wanted set. Superset, not overlap, is
 * what keeps a {leadesque, buttery} harmony slot from completing the hook
 * step, which wants {leadesque, sparkly} -- normalizeSlotKinds allows at
 * most one of sparkly/buttery in a set, so the two can never collide. */
export function slotCoversKindSet(
  slot: CoachSlotSnapshot,
  want: readonly DiscoverSlotKind[]
): boolean {
  if (slot.stem === null) return false
  const kinds = new Set(normalizeSlotKinds(slot.kinds))
  return want.every((kind) => kinds.has(kind))
}

/** Whether any current slot completes this step. A step with no
 * `satisfiedBy` (the balance pass) is never completed automatically -- that
 * one is a person listening, and the app has no way to know. */
export function stepSatisfiedBySlots(
  step: CoachStepDef,
  flavour: CoachFlavour | null,
  slots: readonly CoachSlotSnapshot[]
): boolean {
  const sets = resolveCoachStep(step, flavour).satisfiedBy ?? []
  return sets.some((want) => slots.some((slot) => slotCoversKindSet(slot, want)))
}

/** The current step's completion check. Two steps are answered by the flow
 * itself rather than by the slots: the question (answered when there is an
 * answer) and the lock-in (answered when there is a locked climax). */
export function coachStepSatisfied(
  state: CoachState,
  slots: readonly CoachSlotSnapshot[]
): boolean {
  if (state.stepId === 'p1-flavour') return state.flavour !== null
  if (state.stepId === 'p1-lock') return state.lockedClimax !== null
  const step = coachStepById(state.stepId)
  if (step === undefined) return false
  return stepSatisfiedBySlots(step, state.flavour, slots)
}

/** The phase-one steps a start from an existing riff already covers, in
 * this flavour's own order. Derived entirely from the kind sets Discover
 * tagged each slot with (buildSeedSlotsFromStems / buildSeedSlotsFromCandidates
 * in the renderer) -- never from stem order or channel index, which the
 * spec rules out. */
export function seededCoveredStepIds(
  flavour: CoachFlavour,
  slots: readonly CoachSlotSnapshot[]
): CoachStepId[] {
  const covered: CoachStepId[] = []
  for (const id of coachStepOrder(flavour)) {
    const step = coachStepById(id)
    if (step === undefined || step.phase !== 'loop' || id === 'p1-flavour') continue
    if (stepSatisfiedBySlots(step, flavour, slots)) covered.push(id)
  }
  return covered
}

/** The kinds those covered steps were actually about, for the seeded note.
 * Taken from the step's own wanted sets rather than from the slot's full
 * kind list, so the sentence names roles ("drummy and bassish") rather than
 * every trait a seeded stem happens to carry. */
function coveredKinds(
  covered: readonly CoachStepId[],
  flavour: CoachFlavour,
  slots: readonly CoachSlotSnapshot[]
): DiscoverSlotKind[] {
  const kinds = new Set<DiscoverSlotKind>()
  for (const id of covered) {
    const step = coachStepById(id)
    if (step === undefined) continue
    for (const want of resolveCoachStep(step, flavour).satisfiedBy ?? []) {
      if (!slots.some((slot) => slotCoversKindSet(slot, want))) continue
      for (const kind of want) kinds.add(kind)
    }
  }
  return normalizeSlotKinds([...kinds])
}

/**
 * The answer to "melodic or groove" (spec, phase 1 step 1), which is also
 * where a seeded start gets read: "seeded starts mark already-covered roles
 * done". Banks the time spent on the question, marks the covered steps
 * done, and lands on the first step that is genuinely still open.
 *
 * Asked once. A second answer returns the state untouched -- there is no
 * path to it in the UI (the offers only render on the question step), and
 * silently rewinding a flow that has moved on would be worse than ignoring
 * a dispatch that should not have happened.
 */
export function answerCoachFlavour(
  state: CoachState,
  now: number,
  flavour: CoachFlavour,
  slots: readonly CoachSlotSnapshot[]
): CoachState {
  if (state.flavour !== null) return state
  const covered = seededCoveredStepIds(flavour, slots)
  const order = coachStepOrder(flavour)
  const outcomes: Record<string, CoachOutcome> = { ...state.outcomes, 'p1-flavour': 'done' }
  for (const id of covered) outcomes[id] = 'done'
  const nextId =
    order.find((id) => id !== 'p1-flavour' && !covered.includes(id)) ?? order[order.length - 1]
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    flavour,
    outcomes,
    stepId: nextId,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1,
    seededKinds: coveredKinds(covered, flavour, slots)
  }
}

/**
 * "lock in the climax" (spec, phase 1 step 5): freezes the loop's stems,
 * roles and gains onto the flow. Deliberately does NOT advance -- next and
 * skip stay the user's, and locking then changing your mind about the
 * balance should not have cost you the step.
 *
 * A lock with nothing resolved leaves the flow exactly as it was, rather
 * than storing an empty climax phase two would then have to special-case.
 */
export function lockCoachClimax(
  state: CoachState,
  now: number,
  slots: readonly CoachSlotSnapshot[],
  bpm: number
): CoachState {
  const lockedClimax = lockClimaxFromSlots(slots, bpm, now)
  if (lockedClimax === null) return state
  return { ...state, lockedClimax }
}

/** The one thought on screen. The satisfied line REPLACES the step's own
 * line rather than joining it -- "a new step's text replaces the old one;
 * nothing stacks" (spec) applies just as much inside a step. */
export function coachLineFor(
  state: CoachState,
  slots: readonly CoachSlotSnapshot[]
): string {
  if (state.status === 'finished') return coachLine(state)
  if (coachStepSatisfied(state, slots)) {
    return pickLineVariant(COACH_STEP_SATISFIED_LINES, state.lineSeed)
  }
  return coachLine(state)
}

/** "you already have drummy and bassish. next: harmony." Returns null when
 * nothing was seeded, which is the common case. */
export function coachSeededLine(
  seededKinds: readonly DiscoverSlotKind[],
  nextStepLabel: string,
  seed: number
): string | null {
  if (seededKinds.length === 0) return null
  const names = seededKinds.map((kind) => DISCOVER_SLOT_KIND_LABEL[kind])
  const covered =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return pickLineVariant(COACH_SEEDED_LINE_TEMPLATES, seed)
    .replace('{covered}', covered)
    .replace('{next}', nextStepLabel)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/coachPhase1.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0. If eslint objects to the two separate `import ... from './coach'` statements, merge them into one (`import { coachLine, pauseCoach, type CoachOutcome, type CoachState } from './coach'`).

- [ ] **Step 6: Commit**

```bash
git add src/shared/coachPhase1.ts src/shared/coachPhase1.test.ts
git commit -m "$(cat <<'EOF'
A step is done when the slots say so, not when he guesses

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 7: The two new store actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('the guided flow (sssketchy)', ...)` block in `src/renderer/src/state/store.test.ts`:

```ts
  const resolvedSlot = (kinds: DiscoverSlotKind[], id = `slot-${kinds.join('-')}`) => ({
    id,
    kinds,
    stem: {
      path: `/stems/${id}.wav`,
      name: id,
      author: 'someone',
      type: 'notes' as const,
      durationSec: 8,
      barLength: 4
    },
    gain: 1,
    audible: true,
    rolling: false
  })

  it('COACH_SET_FLAVOUR answers the question and orders the rest by it', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, {
      type: 'COACH_SET_FLAVOUR',
      now: NOW + MINUTE,
      flavour: 'melodic',
      slots: []
    })
    expect(state.coach?.flavour).toBe('melodic')
    expect(state.coach?.stepId).toBe('p1-harmony')
  })

  it('COACH_SET_FLAVOUR marks the roles a seeded start already covers', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, {
      type: 'COACH_SET_FLAVOUR',
      now: NOW + MINUTE,
      flavour: 'groove',
      slots: [resolvedSlot(['bass']), resolvedSlot(['lead'])]
    })
    expect(state.coach?.outcomes).toEqual({
      'p1-flavour': 'done',
      'p1-low-end': 'done',
      'p1-harmony': 'done'
    })
    expect(state.coach?.stepId).toBe('p1-drums')
  })

  it('COACH_LOCK_CLIMAX freezes the loop onto the flow', () => {
    let state = reducer(initialState, { type: 'COACH_START', now: NOW })
    state = reducer(state, {
      type: 'COACH_LOCK_CLIMAX',
      now: NOW + MINUTE,
      slots: [resolvedSlot(['bass'])],
      bpm: 96
    })
    expect(state.coach?.lockedClimax?.bpm).toBe(96)
    expect(state.coach?.lockedClimax?.stems[0].role).toBe('bass')
  })

  it('both new actions are no-ops when no flow exists', () => {
    expect(
      reducer(initialState, {
        type: 'COACH_SET_FLAVOUR',
        now: NOW,
        flavour: 'groove',
        slots: []
      }).coach
    ).toBeNull()
    expect(
      reducer(initialState, { type: 'COACH_LOCK_CLIMAX', now: NOW, slots: [], bpm: 96 }).coach
    ).toBeNull()
  })
```

Add to that file's imports:

```ts
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — a TypeScript error that `'COACH_SET_FLAVOUR'` is not assignable to the `Action` union.

- [ ] **Step 3: Add the actions and reducer cases**

In `src/renderer/src/state/store.ts`:

**3a.** Extend the `@shared/coach` import block and add two more:

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
import { answerCoachFlavour, lockCoachClimax } from '@shared/coachPhase1'
import type { CoachSlotSnapshot } from '@shared/coachClimax'
import type { CoachFlavour } from '@shared/coachSteps'
```

**3b.** In the `AppState.coach` doc comment, change "all six COACH_* actions" to "all eight COACH_* actions".

**3c.** Add the two action members immediately after `| { type: 'COACH_DISMISS'; now: number }`:

```ts
  // Phase one (2026-09-22). Both carry the Discover slots as a plain
  // snapshot rather than reading them from AppState, because Discover's
  // slots are App.tsx's own React state, not reducer state -- and both do
  // their real work in @shared/coachPhase1, so the decisions stay tested
  // and framework-free.
  | {
      type: 'COACH_SET_FLAVOUR'
      now: number
      flavour: CoachFlavour
      slots: readonly CoachSlotSnapshot[]
    }
  | { type: 'COACH_LOCK_CLIMAX'; now: number; slots: readonly CoachSlotSnapshot[]; bpm: number }
```

**3d.** Add the two reducer cases immediately after the `case 'COACH_DISMISS':` block:

```ts
    case 'COACH_SET_FLAVOUR':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: answerCoachFlavour(state.coach, action.now, action.flavour, action.slots)
          }

    case 'COACH_LOCK_CLIMAX':
      return state.coach === null
        ? state
        : {
            ...state,
            coach: lockCoachClimax(state.coach, action.now, action.slots, action.bpm)
          }
```

**3e.** In `src/renderer/src/state/history.ts`, add both to `TRANSIENT_ACTION_TYPES`, after `'COACH_DISMISS'`:

```ts
  'COACH_SET_FLAVOUR',
  'COACH_LOCK_CLIMAX'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts src/renderer/src/state/history.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts \
  src/renderer/src/state/history.ts
git commit -m "$(cat <<'EOF'
Two more things the flow can be told

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 8: Persistence of the phase-one fields

No production change is expected here — `serializeProject` persists by *not* omitting, and `deserializeProject` already runs `sanitiseLoadedCoach`. This task proves it rather than implementing it.

**Files:**
- Test: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the test**

Append inside `describe('the guided flow across a save and a load', ...)`:

```ts
  it('round-trips the answer and the locked climax', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'COACH_START', now: NOW })
    state = reducer(state, {
      type: 'COACH_SET_FLAVOUR',
      now: NOW + MINUTE,
      flavour: 'melodic',
      slots: []
    })
    state = reducer(state, {
      type: 'COACH_LOCK_CLIMAX',
      now: NOW + 2 * MINUTE,
      bpm: 96,
      slots: [
        {
          id: 'slot-1',
          kinds: ['bass'],
          stem: {
            path: '/stems/bass.wav',
            name: 'low one',
            author: 'someone',
            type: 'bass',
            durationSec: 8,
            barLength: 4
          },
          gain: 0.5,
          audible: true,
          rolling: false
        }
      ]
    })

    const { state: restored } = deserializeProject(JSON.parse(serializeProject(state)))

    expect(restored.coach?.flavour).toBe('melodic')
    expect(restored.coach?.lockedClimax?.bpm).toBe(96)
    expect(restored.coach?.lockedClimax?.stems).toEqual([
      {
        path: '/stems/bass.wav',
        name: 'low one',
        author: 'someone',
        type: 'bass',
        durationSec: 8,
        barLength: 4,
        kinds: ['bass'],
        role: 'bass',
        gain: 0.5
      }
    ])
  })

  it('a project saved by the framework build loads on the new first step', () => {
    // The framework shipped one phase-one placeholder, 'climax-loop', which
    // no longer exists. Everything else about that save survives.
    const framework = JSON.parse(
      serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))
    )
    framework.coach = {
      status: 'active',
      stepId: 'climax-loop',
      outcomes: {},
      phaseElapsedMs: { loop: 4 * MINUTE, arrangement: 0, polish: 0 },
      stepElapsedMs: 2 * MINUTE,
      runningSince: NOW,
      lineSeed: 2
    }

    const { state: restored } = deserializeProject(framework)

    expect(restored.coach?.stepId).toBe('p1-flavour')
    expect(restored.coach?.status).toBe('dismissed')
    expect(restored.coach?.flavour).toBeNull()
    expect(restored.coach?.seededKinds).toEqual([])
    expect(restored.coach?.lockedClimax).toBeNull()
    expect(restored.coach?.phaseElapsedMs.loop).toBe(4 * MINUTE)
    expect(restored.rifffs.r1.name).toBe('test')
  })

  it('a project saved before the flow existed at all still loads', () => {
    const legacy = JSON.parse(
      serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))
    )
    delete legacy.coach
    const { state: restored } = deserializeProject(legacy)
    expect(restored.coach).toBeNull()
  })
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: PASS. If the round-trip test fails on the `stems` comparison, the cause is in `sanitiseLockedClimax` (Task 3) — fix it there, not by loosening the assertion.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/state/serialize.test.ts
git commit -m "$(cat <<'EOF'
The locked loop survives the round trip, and so does an old save

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 9: The Discover bridge

**Files:**
- Create: `src/renderer/src/state/coachDiscoverBridge.ts`
- Test: `src/renderer/src/state/coachDiscoverBridge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/state/coachDiscoverBridge.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COACH_PENDING_ADD_LIMIT,
  coachDiscoverIsOpen,
  registerCoachAddSlot,
  requestCoachAddSlot,
  resetCoachDiscoverBridge
} from './coachDiscoverBridge'

describe('the coach -> Discover bridge', () => {
  beforeEach(() => resetCoachDiscoverBridge())

  it('knows whether Discover is on screen', () => {
    expect(coachDiscoverIsOpen()).toBe(false)
    const unregister = registerCoachAddSlot(vi.fn())
    expect(coachDiscoverIsOpen()).toBe(true)
    unregister()
    expect(coachDiscoverIsOpen()).toBe(false)
  })

  it('passes a request straight through while Discover is open', () => {
    const addSlot = vi.fn()
    registerCoachAddSlot(addSlot)
    requestCoachAddSlot(['bass'])
    expect(addSlot).toHaveBeenCalledWith(['bass'])
  })

  it('queues a request made before Discover opens, and flushes it on register', () => {
    requestCoachAddSlot(['bass'])
    requestCoachAddSlot(['drums'])
    const addSlot = vi.fn()
    registerCoachAddSlot(addSlot)
    expect(addSlot.mock.calls).toEqual([[['bass']], [['drums']]])
    // Flushed, not replayed on the next register.
    const second = vi.fn()
    registerCoachAddSlot(second)
    expect(second).not.toHaveBeenCalled()
  })

  it('caps the queue rather than growing forever while Discover stays shut', () => {
    for (let i = 0; i < COACH_PENDING_ADD_LIMIT + 3; i += 1) requestCoachAddSlot(['bass'])
    const addSlot = vi.fn()
    registerCoachAddSlot(addSlot)
    expect(addSlot).toHaveBeenCalledTimes(COACH_PENDING_ADD_LIMIT)
  })

  it('only the current registration is unregistered by its own teardown', () => {
    const first = vi.fn()
    const unregisterFirst = registerCoachAddSlot(first)
    const second = vi.fn()
    registerCoachAddSlot(second)
    unregisterFirst()
    expect(coachDiscoverIsOpen()).toBe(true)
    requestCoachAddSlot(['bass'])
    expect(second).toHaveBeenCalledWith(['bass'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/coachDiscoverBridge.test.ts`
Expected: FAIL — `Failed to resolve import "./coachDiscoverBridge"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/state/coachDiscoverBridge.ts`:

```ts
/**
 * The one imperative wire from sssketchy's bubble into Discover.
 *
 * Everything else the guided flow needs from Discover is declarative -- the
 * armed kinds go DOWN as a prop, the slot snapshots come UP as a callback.
 * But "do it for me" has to call DiscoverPanel's own `addSlot`, which
 * closes over that component's undo stack, roll options, project tempo and
 * trait bar. Re-implementing it in App.tsx would be a second, untested copy
 * of a function with a live bug history (see addSlot's own call to
 * pushUndoSnapshot). So DiscoverPanel registers its `addSlot` here while it
 * is mounted, and the bubble asks through this module.
 *
 * A request made while Discover is CLOSED is queued rather than dropped:
 * the bubble's own handler opens the library at the same moment, and
 * DiscoverPanel registers a tick later. Without the queue, the first "do it
 * for me" of a session would open Discover and add nothing, which reads as
 * a broken button. Capped, so a user clicking it repeatedly with the
 * library shut does not get a pile of slots when it finally opens.
 *
 * Module-level mutable state, like the resolved-candidate and peak caches
 * elsewhere in the renderer. Note the one dev-only wrinkle Vite's Fast
 * Refresh brings (the same one freshSlotId's own comment in
 * DiscoverPanel.tsx documents): editing THIS file resets `handler` to null,
 * and it stays null until DiscoverPanel remounts. Switching the library tab
 * fixes it; nothing about a packaged build is affected.
 */

import type { DiscoverSlotKind } from '@shared/discoverSlotKind'

export type CoachAddSlotHandler = (kinds: readonly DiscoverSlotKind[]) => void

/** Enough for a user who pressed the button a few times before the library
 * finished opening; small enough that nothing piles up. */
export const COACH_PENDING_ADD_LIMIT = 4

let handler: CoachAddSlotHandler | null = null
let pending: (readonly DiscoverSlotKind[])[] = []

/** Called by DiscoverPanel on mount. Returns its own teardown, which only
 * clears the registration if it is still the current one -- React can mount
 * the next instance before unmounting the previous one (Strict Mode,
 * a tab switch), and a late teardown must not unregister the live panel. */
export function registerCoachAddSlot(next: CoachAddSlotHandler): () => void {
  handler = next
  if (pending.length > 0) {
    const queued = pending
    pending = []
    for (const kinds of queued) next(kinds)
  }
  return () => {
    if (handler === next) handler = null
  }
}

export function coachDiscoverIsOpen(): boolean {
  return handler !== null
}

/** Adds one Discover slot targeting `kinds`, now or as soon as Discover is
 * on screen. */
export function requestCoachAddSlot(kinds: readonly DiscoverSlotKind[]): void {
  if (handler !== null) {
    handler(kinds)
    return
  }
  if (pending.length >= COACH_PENDING_ADD_LIMIT) return
  pending = [...pending, kinds]
}

/** Tests only. */
export function resetCoachDiscoverBridge(): void {
  handler = null
  pending = []
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/coachDiscoverBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/coachDiscoverBridge.ts \
  src/renderer/src/state/coachDiscoverBridge.test.ts
git commit -m "$(cat <<'EOF'
One wire from the bubble to the add row, queued if it is shut

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 10: Discover integration — pre-arming, snapshots, the anchor

**No component test** — React components are not unit-tested in this codebase (CLAUDE.md, "Testing conventions"). This task is verified by `npm run typecheck`, `npm run lint`, the whole vitest suite staying green, and then by the manual walkthrough at the end of this plan. **Do not claim the panel was tested.**

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

- [ ] **Step 1: Add the two props to DiscoverPanel**

In `src/renderer/src/components/DiscoverPanel.tsx`, add to the imports:

```ts
import type { CoachSlotSnapshot } from '@shared/coachClimax'
import { registerCoachAddSlot } from '../state/coachDiscoverBridge'
```

`normalizeSlotKinds` and `slotKindsKey` are already imported from `@shared/discoverSlotKind` in this file — check the existing import list and add whichever is missing.

Add `coachArmedKinds` and `onCoachSlotsChange` to the destructured parameter list (after `seedBpm`), and to the props type (after `seedBpm: number | null`):

```ts
  /** The kinds sssketchy's current step pre-arms in the add row -- "each
   * step pre-arms the matching kinds in Discover's add row" (spec, phase 1
   * step 3). Declarative on purpose: this panel unmounts on every
   * browse<->discover tab switch, so an imperative arm would be lost every
   * time the user looked at the library. null when no flow is running, or
   * when the current step arms nothing. Must be referentially stable per
   * kind set (App.tsx memoizes it) -- see the effect below. */
  coachArmedKinds?: readonly DiscoverSlotKind[] | null
  /** Publishes what the guided flow is allowed to know about the slots.
   * This panel is the only place that knows whether a slot has really
   * RESOLVED, whether it is audible, and whether it is mid-roll, so
   * "a step completes when a slot with those kinds resolves" can only be
   * answered from here. Must be referentially stable (useCallback). */
  onCoachSlotsChange?: (slots: CoachSlotSnapshot[]) => void
```

- [ ] **Step 2: Pre-arm the add row**

Immediately after the existing `hasPendingAdd` Escape-key effect (the one ending `}, [hasPendingAdd])`, add:

```ts
  // Pre-arming, for the guided flow (docs/superpowers/plans/2026-09-22-
  // sssketchy-phase1.md). Writes straight into the SAME pendingAddKinds the
  // cmd-click arming above uses, so an armed step and a hand-armed chip are
  // literally the same state -- the user can add to it, clear it with Esc,
  // or ignore it entirely, and the row behaves identically either way.
  // Keyed off the kind STRING (slotKindsKey) rather than the array, so a
  // re-render with an equal-but-new array does not re-arm over something
  // the user just changed.
  const coachArmKey = coachArmedKinds ? slotKindsKey(coachArmedKinds) : ''
  useEffect(() => {
    if (coachArmKey === '' || !coachArmedKinds) return
    setPendingAddKinds(normalizeSlotKinds(coachArmedKinds))
  }, [coachArmKey, coachArmedKinds])
```

- [ ] **Step 3: Register `addSlot` for "do it for me"**

Immediately after the `addSlot` function definition, add:

```ts
  // "do it for me adds the slot itself" (spec, phase 1 step 3). addSlot is
  // redefined every render and closes over `slots`/`rifffsState`, so the
  // registration goes through a ref rather than capturing the first
  // render's copy -- a stale closure here would push an undo snapshot of a
  // slot list that no longer exists, which is exactly the class of bug
  // importPathsAsLoopSeeds' own comment above documents.
  const addSlotRef = useRef(addSlot)
  useEffect(() => {
    addSlotRef.current = addSlot
  })
  useEffect(
    () => registerCoachAddSlot((kinds) => addSlotRef.current(normalizeSlotKinds(kinds))),
    []
  )
```

- [ ] **Step 4: Publish the slot snapshots**

Immediately after the effect added in Step 3, add:

```ts
  // What the guided flow sees. resolvedStemsRef is a ref (it deliberately
  // does not re-render this panel on its own), so this effect depends on
  // resolvedBarLengths instead -- the reactive twin written in the same
  // reportSlotResolution call, which is what makes "this slot has resolved"
  // observable from out here at all. seedStem covers a Shelf-seeded slot,
  // which is already a fully resolved stem and never goes through
  // reportSlotResolution.
  useEffect(() => {
    if (!onCoachSlotsChange) return
    onCoachSlotsChange(
      slots.map((slot) => {
        const stem = resolvedStemsRef.current.get(slot.id) ?? slot.seedStem ?? null
        return {
          id: slot.id,
          kinds: normalizeSlotKinds(slot.kinds),
          stem:
            stem === null
              ? null
              : {
                  path: stem.path,
                  name: stem.name,
                  author: stem.author,
                  type: stem.type,
                  durationSec: stem.durationSec,
                  barLength: stem.barLength
                },
          gain: slot.gain,
          audible: previewingSlotIds.has(slot.id),
          rolling: rerollingSlotIds.has(slot.id)
        }
      })
    )
  }, [slots, resolvedBarLengths, previewingSlotIds, rerollingSlotIds, onCoachSlotsChange])
```

Place it **below** the declarations of `previewingSlotIds`, `resolvedBarLengths` and `rerollingSlotIds` (the last of those is around line 1069) — if it lands above any of them, TypeScript will report use-before-declaration; move it further down until it compiles.

- [ ] **Step 5: Give the add row its anchor**

On the add-row container `<div>` (the one whose `style` sets `gridTemplateColumns: \`minmax(${ADD_ROW_DIAL_COLUMN_WIDTH}px, 1fr) auto minmax(${ADD_ROW_DIAL_COLUMN_WIDTH}px, 1fr)\``, around line 2485), add the attribute before `style`:

```tsx
        data-coach-anchor="discover-add-row"
```

This is the selector every phase-one step's `anchorSelector` points at (`DISCOVER_ADD_ROW` in `coachSteps.ts`). It is a data attribute, not a class or an id, so it changes nothing about layout or styling.

- [ ] **Step 6: Thread the props through LibraryBrowser**

In `src/renderer/src/components/LibraryBrowser.tsx`:

- add `coachArmedKinds`, `onCoachSlotsChange` and `initialMode` to the destructured props and the props type:

```ts
  /** Passed straight through to DiscoverPanel -- see its own doc comments. */
  coachArmedKinds?: readonly DiscoverSlotKind[] | null
  onCoachSlotsChange?: (slots: CoachSlotSnapshot[]) => void
  /** Which tab to open on, overriding the "open where you left off" rule
   * below. Set only by the guided flow, which always means Discover -- on
   * an empty project the default would land on 'browse', where the add row
   * a phase-one step just armed is not even mounted. */
  initialMode?: 'browse' | 'discover'
```

- change the `libraryMode` initialiser to honour it:

```ts
  const [libraryMode, setLibraryMode] = useState<'browse' | 'discover'>(
    () => initialMode ?? (discoverHasRealContent(discoverSlots) ? 'discover' : 'browse')
  )
```

- pass the two coach props down to `<DiscoverPanel ... />` (after `seedBpm={discoverSeedBpm}`):

```tsx
            coachArmedKinds={coachArmedKinds}
            onCoachSlotsChange={onCoachSlotsChange}
```

- add the imports:

```ts
import type { CoachSlotSnapshot } from '@shared/coachClimax'
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
```

(`DiscoverSlotKind` may already be imported in this file — check before adding a duplicate.)

- [ ] **Step 7: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0. If `react-hooks/exhaustive-deps` flags the snapshot effect for `resolvedBarLengths` being unused in the body, keep it and add `// eslint-disable-next-line react-hooks/exhaustive-deps` **only** with the reason spelled out above it — it is the reactive twin of the ref the body actually reads, and removing it breaks completion detection.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx \
  src/renderer/src/components/LibraryBrowser.tsx
git commit -m "$(cat <<'EOF'
The add row comes pre-armed, and says what it found

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 11: App.tsx wiring

**No component test** — see Task 10's note.

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the imports**

`useCallback` and `useMemo` are used below — check `App.tsx`'s own `import { ... } from 'react'` line and add whichever is missing. Then add:

```ts
import { coachStepArmKinds, coachStepById, type CoachMoveAction, type CoachOfferAction } from '@shared/coachSteps'
import { isDiscoverSlotKind, type CoachSlotSnapshot } from '@shared/coachClimax'
import { slotKindsKey } from '@shared/discoverSlotKind'
import { coachDiscoverIsOpen, requestCoachAddSlot } from './state/coachDiscoverBridge'
```

- [ ] **Step 2: Hold the slot snapshots and the armed kinds**

Inside `Frame`, next to the existing `const [discoverSlots, setDiscoverSlots] = useState<DiscoverSlot[]>([])` (~line 1363), add:

```ts
  // What the guided flow sees of Discover. Published by DiscoverPanel (the
  // only component that knows whether a slot has really resolved) and kept
  // here rather than inside the bubble so it survives the library modal
  // closing -- locking the climax from a step whose panel is not currently
  // mounted still locks the loop the user actually built. Stale by the same
  // amount the library has been shut for, which is exactly nothing, because
  // nothing can change Discover while it is not on screen.
  const [coachSlots, setCoachSlots] = useState<CoachSlotSnapshot[]>([])
  const handleCoachSlotsChange = useCallback((next: CoachSlotSnapshot[]) => {
    setCoachSlots(next)
  }, [])
```

Then, below the `coach` reads that already exist in `Frame` (or anywhere after `state` is in scope), add:

```ts
  // "Each step pre-arms the matching kinds in Discover's add row" (spec).
  // Memoized by the kind STRING so DiscoverPanel's own arming effect does
  // not re-fire on every unrelated App re-render and stamp over a chip the
  // user just armed by hand. Null while no flow is running, while he is
  // dismissed, and on every step that arms nothing.
  const coachArmKey = (() => {
    const coach = state.coach
    if (coach === null || coach.status === 'dismissed' || coach.status === 'finished') return ''
    const step = coachStepById(coach.stepId)
    if (step === undefined) return ''
    const kinds = coachStepArmKinds(step, coach.flavour)
    return kinds === null ? '' : slotKindsKey(kinds)
  })()
  const coachArmedKinds = useMemo(
    () => (coachArmKey === '' ? null : coachArmKey.split('+').filter(isDiscoverSlotKind)),
    [coachArmKey]
  )
```

- [ ] **Step 3: Open Discover for the flow, and browse for a seed**

Next to the existing `openRiffLibrary` (~line 1644), add a state field and two functions. `openRiffLibrary` itself is passed directly as a click handler in three places, so **do not change its signature** — these are separate entry points:

```ts
  // Which tab the riff library should open on, when the guided flow is the
  // one opening it. Null means "decide as usual" (LibraryBrowser's own
  // open-where-you-left-off rule). Consumed once per open, because
  // LibraryBrowser mounts fresh every time.
  const [riffLibraryInitialMode, setRiffLibraryInitialMode] = useState<
    'browse' | 'discover' | null
  >(null)

  /** Every phase-one step happens in Discover, so a step's own move opens
   * it there directly -- on an empty project the normal rule would land on
   * 'browse', where the add row the step just armed is not even mounted. */
  function openDiscoverForCoach(): void {
    setLibraryBrowserOpen(false)
    setRiffLibraryInitialMode('discover')
    setRiffLibraryOpen(true)
  }

  /** "start from a riff you love" (spec, phase 1 step 1) -- the existing
   * Discover seeding, reached where it already lives: the browse tab's own
   * "seed discover with this" button (seedDiscoverFromBrowseRiff,
   * LibraryBrowser.tsx). Nothing new is built for it here. */
  function openRiffBrowserForCoach(): void {
    setLibraryBrowserOpen(false)
    setRiffLibraryInitialMode('browse')
    setRiffLibraryOpen(true)
  }
```

and set `setRiffLibraryInitialMode(null)` inside the existing `openRiffLibrary` and `openRiffLibraryWithDiscoverSeed`, so a normal open is never stuck on a tab the coach chose earlier.

- [ ] **Step 4: Handle the offers and the moves**

Below those, add:

```ts
  /** An answer only the user can give. Both answers also open Discover,
   * because that is where every step after this one happens. */
  function handleCoachOffer(action: CoachOfferAction): void {
    if (action.kind === 'set-flavour') {
      dispatch({
        type: 'COACH_SET_FLAVOUR',
        now: Date.now(),
        flavour: action.flavour,
        slots: coachSlots
      })
      openDiscoverForCoach()
      return
    }
    openRiffBrowserForCoach()
  }

  /** "do it for me", and every move listed under "stuck?". The add goes
   * through the bridge because only DiscoverPanel can add a slot properly
   * (see coachDiscoverBridge.ts); the bridge queues it if Discover is not
   * open yet, which is why opening it afterwards is safe. */
  function handleCoachMove(action: CoachMoveAction): void {
    if (action.kind === 'add-slot') {
      requestCoachAddSlot(action.kinds)
      if (!coachDiscoverIsOpen()) openDiscoverForCoach()
      return
    }
    dispatch({ type: 'COACH_LOCK_CLIMAX', now: Date.now(), slots: coachSlots, bpm: state.bpm })
  }
```

- [ ] **Step 5: Pass everything down**

On the `<LibraryBrowser ... />` element (~line 2402), add:

```tsx
            initialMode={riffLibraryInitialMode ?? undefined}
            coachArmedKinds={coachArmedKinds}
            onCoachSlotsChange={handleCoachSlotsChange}
```

On the `<SssketchyCoach />` element added by the framework plan's Task 10, add:

```tsx
        <SssketchyCoach
          discoverSlots={coachSlots}
          onOffer={handleCoachOffer}
          onMove={handleCoachMove}
        />
```

- [ ] **Step 6: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: `npm run typecheck` FAILS until Task 12 gives `SssketchyCoach` those three props. Finish Task 12, then run all three again. `npx vitest run` should pass now regardless — no test imports `App.tsx`.

- [ ] **Step 7: Commit (together with Task 12)**

App.tsx and SssketchyCoach.tsx do not typecheck apart from each other, so commit them together at the end of Task 12.

---

### Task 12: The bubble learns to offer, to act, and to notice

**No component test** — see Task 10's note.

> **Re-read both files before editing.** They were being written by another agent while this plan was written; the code quoted below is the framework plan's own Task 8/9 source, which may have moved on. Apply the *behaviour* to whatever actually shipped.

**Files:**
- Modify: `src/renderer/src/components/SssketchyCoach.tsx`
- Modify: `src/renderer/src/components/SssketchyChecklist.tsx`

- [ ] **Step 1: The checklist follows the answer**

In `SssketchyChecklist.tsx`, change the one call:

```tsx
          {coachStepsInPhase(phase.id, coach.flavour).map((step) => {
```

`coachStepsInPhase` now returns steps in this flavour's order with per-flavour overrides already applied, so `step.label` needs no other change. Nothing else in that file moves.

- [ ] **Step 2: Give `SssketchyCoach` its three props**

In `SssketchyCoach.tsx`, change the store gate at the bottom of the file to:

```tsx
export function SssketchyCoach({
  discoverSlots,
  onOffer,
  onMove
}: {
  /** What Discover currently holds, as the guided flow is allowed to see it
   * (DiscoverPanel publishes it up through App.tsx). Drives step
   * completion, the seeded note and the climb animation. */
  discoverSlots: readonly CoachSlotSnapshot[]
  onOffer: (action: CoachOfferAction) => void
  onMove: (action: CoachMoveAction) => void
}): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  if (coach === null || coach.status === 'dismissed') return null
  return (
    <SssketchyCoachPanel
      coach={coach}
      discoverSlots={discoverSlots}
      onOffer={onOffer}
      onMove={onMove}
      onNext={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'done' })}
      onSkip={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'skipped' })}
      onMinimise={() => dispatch({ type: 'COACH_MINIMISE' })}
      onRestore={() => dispatch({ type: 'COACH_RESTORE', now: Date.now() })}
      onDismiss={() => dispatch({ type: 'COACH_DISMISS', now: Date.now() })}
    />
  )
}
```

and add the same three to `SssketchyCoachPanel`'s own props type and destructuring.

- [ ] **Step 3: Use the phase-one line, the seeded note and the real step**

In `SssketchyCoachPanel`, extend the imports (the file already imports `coachStepById` from `@shared/coachSteps` — merge these into that one statement rather than adding a second import from the same module, which eslint will flag):

```tsx
import { coachLineFor, coachSeededLine } from '@shared/coachPhase1'
import { coachStepById, coachStepPrimaryMove, resolveCoachStep } from '@shared/coachSteps'
import type { CoachMoveAction, CoachOfferAction } from '@shared/coachSteps'
import type { CoachSlotSnapshot } from '@shared/coachClimax'
```

`coachLine` is no longer called in this file (`coachLineFor` wraps it), so **remove it from the `@shared/coach` import** or lint will fail on an unused import. `isCoachStuck`, `coachAnimation` and `type CoachState` all stay.

Replace the `const step = coachStepById(coach.stepId)` line with:

```tsx
  const rawStep = coachStepById(coach.stepId)
  // Per-flavour copy, moves and label, flattened once here so nothing below
  // has to remember that overrides exist.
  const step = rawStep === undefined ? undefined : resolveCoachStep(rawStep, coach.flavour)
```

Replace the `working: false` line in the `coachAnimation` call with:

```tsx
    // "climb = while the app works" -- a real fact off the slots, not a
    // guess: a slot is mid-roll or it is not.
    working: discoverSlots.some((slot) => slot.rolling),
```

Replace `{coachLine(coach)}` in the bubble's primary line with:

```tsx
            {coachLineFor(coach, discoverSlots)}
```

and add, directly above the existing `{stuck && !finished && (...)}` block:

```tsx
          {/* The seeded-start note: "you already have drummy and bassish.
              next: harmony." Sits in the same slot the ten-minute nudge
              uses, and is cleared by the next transition (advanceCoach), so
              there is still only ever one thought plus at most one aside. */}
          {seededLine !== null && !finished && (
            <div
              style={{
                marginTop: 'var(--ra-s-2)',
                fontSize: 10,
                lineHeight: 'var(--ra-lh-body)',
                color: 'var(--ra-text-3)'
              }}
            >
              {seededLine}
            </div>
          )}
```

with, next to the other derived values:

```tsx
  const seededLine = coachSeededLine(coach.seededKinds, step?.label ?? '', coach.lineSeed)
```

and change the stuck-nudge condition so the two never both show:

```tsx
          {stuck && !finished && seededLine === null && (
```

- [ ] **Step 4: Render the offers**

Directly above the existing button row (`<div style={{ display: 'flex', flexWrap: 'wrap', ... }}>`), add:

```tsx
          {/* Answers only the user can give -- their own row, above the
              fixed one, so "do it for me" is never how a decision about the
              track gets made. Only the melodic-or-groove question has
              these. */}
          {!finished && (step?.offers ?? []).length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--ra-s-1)',
                marginTop: 'var(--ra-s-5)'
              }}
            >
              {(step?.offers ?? []).map((offer) => (
                <button
                  key={offer.id}
                  type="button"
                  onClick={() => onOffer(offer.action)}
                  style={bubbleButtonStyle}
                >
                  {offer.label}
                </button>
              ))}
            </div>
          )}
```

- [ ] **Step 5: Make "do it for me" and "stuck?" do the moves**

Replace the derived `const moves = step?.moves ?? []` with:

```tsx
  const moves = step?.moves ?? []
  // "do it for me" runs exactly one move -- the step's primary. A step with
  // none (the melodic-or-groove question, the balance pass) leaves the
  // button disabled, which is the honest answer: one of those is a decision
  // only the user can make, the other is a person listening.
  const primaryMove = rawStep === undefined ? null : coachStepPrimaryMove(rawStep, coach.flavour)
```

Replace the "do it for me" button with:

```tsx
                <button
                  type="button"
                  disabled={primaryMove === null}
                  onClick={() => {
                    if (primaryMove !== null) onMove(primaryMove.action)
                  }}
                  title={primaryMove === null ? 'this one is yours' : primaryMove.label}
                  style={{
                    ...bubbleButtonStyle,
                    opacity: primaryMove === null ? 0.3 : 1,
                    cursor: primaryMove === null ? 'not-allowed' : 'pointer'
                  }}
                >
                  do it for me
                </button>
```

and replace the read-only move list inside the `{stuckOpen && !finished && (...)}` block with buttons:

```tsx
                moves.map((move) => (
                  <button
                    key={move.id}
                    type="button"
                    onClick={() => onMove(move.action)}
                    style={{ ...bubbleButtonStyle, display: 'block', marginTop: 'var(--ra-s-1)' }}
                  >
                    {move.label}
                  </button>
                ))
```

- [ ] **Step 6: Typecheck, lint and run the whole suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0, now that Task 11 and Task 12 are both in place.

- [ ] **Step 7: Commit Tasks 11 and 12 together**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/SssketchyCoach.tsx \
  src/renderer/src/components/SssketchyChecklist.tsx
git commit -m "$(cat <<'EOF'
He asks, he arms the row, and he can add the slot himself

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 13: Whole-suite verification

**Files:** none.

- [ ] **Step 1: Run everything**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all three exit 0. Note the vitest summary line (files/tests passed) in your report.

- [ ] **Step 2: Confirm nothing native changed**

Run: `git diff --stat master...HEAD -- native-engine`
Expected: empty output. This plan changes no C++ at all, so no `cmake --build` and no app restart cycle is needed for any of it.

- [ ] **Step 3: Confirm the old step id is really gone**

Run: `grep -rn "climax-loop" src/ | grep -v "docs/"`
Expected: no matches in `src/` (the string may still appear in `docs/superpowers/`, which is a historical record and must not be edited).

---

## Manual walkthrough (for Elling — an agent cannot do this)

This environment has no GUI or audio tooling, so the whole UI half of this plan is unverified
until a person clicks it. Run `npm run dev` (**no native-engine rebuild is needed — this plan
changes no C++**) and check:

1. **The question.** Press `sssketchy` in the project menu row on an empty project. The bubble
   asks melodic or groove and offers three buttons: `groove`, `melodic`, `start from a riff you
   love`. `do it for me` is greyed out — answering this is yours.
2. **Groove order.** Press `groove`. The riff library opens on the Discover tab, sssketchy walks
   over to the add row, and the step is the low end. The add row's `bassish` chip is already
   armed. Press `stuck?` — two moves: `add a bassish one`, `add a drummy one`.
3. **Pre-arming is not a command.** Press Esc. The arm clears, exactly like a hand-armed chip.
   Click `drummy` yourself. The step still completes (groove's low end takes either half), and
   the bubble swaps to the satisfied line.
4. **do it for me.** `next` to harmony. Press `do it for me`. One slot appears targeting
   `leadesque · buttery`, rolls, and resolves. sssketchy climbs while it rolls.
5. **Melodic order.** Start a fresh project, press `sssketchy`, press `melodic`. The first step
   after the question is harmony, not the low end. Click the sprite: the checklist lists phase one
   in melodic order.
6. **The seeded start.** Start a fresh project. Open the riff library, find a riff with drums and
   bass, press `seed discover with this`. Now press `sssketchy` and answer either way. The steps
   those stems cover are ticked in the checklist, the bubble lands on the first step that is
   genuinely open, and the note underneath names what was covered ("you already have drummy and
   bassish. next: harmony.").
7. **Nothing blocks.** `next` and `skip` work on every step, satisfied or not, including the
   question.
8. **Lock in.** Walk to the last phase-one step and press `do it for me` (`lock the loop in`). The
   bubble says it is locked. Save the project, quit, reopen it, press `sssketchy`: the flow comes
   back on the same step with the locked climax intact (there is no UI for the locked climax yet
   — phase 2's plan is what reads it — so confirm this by saving and grepping the
   `.sssketchproj` for `lockedClimax`).
9. **An older project.** Open a project saved during the framework build (or any project saved
   before today). It opens with no sssketchy on screen, and pressing the button starts the flow at
   the melodic-or-groove question rather than crashing or resuming a step that no longer exists.
10. **Copy.** Read every line he says over a full pass. Nothing should ever read as a claim about
    whether the music is good — only about what the step is for. If one does, it is a bug in the
    copy and the fix is in `coachSteps.ts`, not in the logic.

## Known limits, written down on purpose

- **The supporting step can read as satisfied the moment it starts on a groove.** A
  `drummy · rhythmic` stem from the previous step is also a `rhythmic` stem. The tick reports a
  fact about the slots, not a claim that the step's work is done, and the copy never says
  otherwise. Noted in `coachSteps.ts` at the row itself.
- **Completion never advances by itself.** The spec's "a step completes when a slot with those
  kinds resolves" is implemented as a derived tick plus a changed line, with `next`/`skip` left to
  the user. Auto-advancing would yank the bubble away mid-reroll.
- **The locked climax has no UI of its own.** Nothing displays it, and nothing reads it yet —
  phase 2's plan is what carves sections from it. It is persisted project data from this plan on.
- **A "do it for me" pressed with the library shut** opens Discover and then adds the slot, via
  the bridge's queue. Up to four such requests are held; a fifth is dropped rather than queued.
