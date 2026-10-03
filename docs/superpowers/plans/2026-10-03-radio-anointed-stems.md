# Radio Anointed Stems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three things, in both radios (sssketch's Discover radio and ell.ing/radio), in the order
they become listenable:
1. **Build-ups sized to the change, and every turnaround paid off.** A one-row swap never gets the
   full noise sweep; a riser and a gap come with the big moments; and a turnaround that fires is
   followed by a real change on its one (Elling: "a turnaround feels like a letdown kinda if there
   isn't a somewhat dramatic change"). On by default for everyone.
2. **Hooks that leave and come back.** A hooked STEM stays 16-32 bars, leaves on a line with an
   echo throw (bass dry), is away 16-32 bars while its row plays a substitute, and comes back on a
   phrase start as the drop. One away at a time; pace-scaled; a long rest after 3 returns.
3. **Dig.** One dug row; a third of picks come from near its stem and every pick leans to it.

**Spec:** `docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md` (78be6e5, plus this
plan's commit: Decided section, Decision 6 and §4.7 "every turnaround is paid off"). Read it first.
Its §2.7 table, §7 (byte-identity), §10 (timing risks) and §11 (tests, walkthrough) are the review
checklist.

**Architecture:**
- **Pure rules in `src/shared/`, TDD:** three new modules (`radioBuildSize.ts`, `radioHooks.ts`,
  `radioDig.ts`) and optional, absent-is-today parameters on existing ones (`pickTransition`,
  `radioGestureBeats`, `drawManualTransitions`, `rollTurnaround`, `advanceDensityLeg`,
  `rankCandidates`, the readout, the phone's state).
- **Each runtime only drives them:** the web reducer (`ell.ing/radio src/radio/step.ts`) and the
  desktop panel (`DiscoverPanel.tsx`). Neither engine changes: hook events are ordinary top
  landings, the exit echo is an ordinary throw.
- **One guarantee:** with no hook, no dig, and `sizedBuilds` absent or false, every shared function
  draws exactly what it drew before (pinned by fingerprints) and the web's action log is
  byte-identical (the fold fingerprint `0540eeea` holds).

**Phases** (each ends at a ship point Elling can listen to; deploy only with his go-ahead):
1. **Sized builds + paid-off turnarounds** (Tasks 1-4). Ship point A.
2. **Hooks** (Tasks 5-10; Task 11, resting exits, may follow later). Ship point B.
3. **Dig** (Tasks 12-14). Ship point C.
4. Retire the old hook flag (Task 15), cross-repo verification and handoff (Task 16).

**Tech Stack:** TypeScript and vitest (both repos), React and Electron (sssketch), plain DOM and
Web Audio (ell.ing/radio).

**Repos:**
- **sssketch** (`/Users/nickel/Claudecode/sssketch`): Tasks 1, 2, 4, 5, 6, 9, 10, 11 (desktop
  half), 12, 14, 15, 16. Base: `master` at this plan's commit (on 78be6e5).
- **ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`): Tasks 3, 7, 8, 11 (web half), 13.
  Base: `main` at `79e586a`.
- **How the two connect.** The web imports sssketch's `src/shared` through `@shared`, from
  sssketch's **working tree** (or `SSSKETCH_DIR`). Every shared task here is additive and keeps the
  web's `npm run typecheck` (with `noUnusedLocals`) and tests green; only Task 15 is not, and it
  runs last, after both runtimes stopped reading the old flag.

**Branches:** `radio-anointed-stems` in each repo (`git switch -c radio-anointed-stems`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git add <paths>` or `git commit --only <paths>`), never
`git add -A`: other agents share these working trees.

**Before you start, in both repos:**
- `git status --short`: note other agents' files and leave them alone.
- **sssketch:** `npm test` (green except the machine-dependent engine-spawn tests: memory
  `coreaudiod_thread_leak`), `npm run typecheck`.
- **ell.ing/radio:** `npx vitest run` and `npm run typecheck` (repo-wide `testTimeout` is 30 s).
- **The code** in this plan was written against sssketch `78be6e5` and ell.ing/radio `79e586a`. If
  a file has moved on, make the same edits by hand, anchored on the quoted context and function
  names, never on line numbers.

---

## How this plan's code was checked

Planning scratchpad: `/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/`.
`anointed/` is a git copy of sssketch's `src/shared` at 78be6e5 (one commit per step);
`anointed-pre/` is the same without Task 15; `anointedweb/` is ell.ing/radio at 79e586a with
`@shared` pointed at `anointed-pre`; `anointed-desk/` is sssketch with its `src/shared` replaced by
`anointed-pre`'s.

- **Every shared task (1, 2, 5, 6, 12, 15)** was applied in the copy, and every code block below
  is the copy's file or diff, verbatim:
  - `tsc` (the electron-toolkit web config, `noUnusedLocals`) over all of `src/shared`: no new
    errors (13 pre-existing ones, all in test files' object literals, unchanged);
  - `npx vitest run src/shared`: **158 files, 2684 tests passed** with all tasks in (2633 before;
    2704 before Task 15 removes the old hook's 20 tests);
  - `eslint` and `prettier` with the repo's configs: clean.
- **Tasks 1, 5 and 12 apply on their own:** each was applied alone to a fresh copy of 78be6e5
  (`anointed-iso/`): `tsc` clean, its tests and the neighbouring suites green (129 tests).
- **Fingerprints, absent is today.** `radioBuildSizeDraws.test.ts` pins two hashes recorded from
  the **unmodified** 78be6e5 code (by stashing the changes and running the same trace):
  2000 seeded `pickTransition` draws per temperament and kind set (`d5e51d0c`), and 4320 chained
  seeded `rollTurnaround` rolls over rates, arcs, loops, depths and `combine` (`b5136502`). Both
  reproduce with every Task 2 change in, with no `size`, and with `payoff: 'large'`.
- **The web against the new shared (everything but Task 15):** `npm run typecheck` clean;
  `npx vitest run src`: **54 files, 789 tests passed** (unchanged: nothing reads the new fields
  until Task 3).
- **The desktop against the new shared (everything but Task 15):** `npm run typecheck` clean.
- **Not compiled, written as precise instructions:** the runtime tasks (3, 4, 7-11, 13, 14).
  `step.ts`, `controller.ts` and `DiscoverPanel.tsx` change daily; every instruction is anchored on
  a function name and quoted context, with today's line numbers as a guide.

## Decisions made in planning (the spec's are in its Decided section)

1. **The payoff (spec Decision 6, added by Elling while this plan was written)** is §4.7 of the
   spec, designed here:
   - a fired turnaround needs a `medium` payoff (2+ rows, a hook back, an arc step, the low end
     back, a course change), or `large` after a gap (3+ rows, a hook back with another row, the
     low end back, a course change);
   - the phrase end is rolled at its forecast's tier raised to `medium` (a fired phrase end always
     brings at least a medium change), and a gap is drawn only when a large payoff can be
     assembled (`TurnaroundInput.payoff`);
   - the payoff is assembled from radio's armed pick (pulled forward as an early decision: the
     interval restarts from it, so a payoff never adds a change on top of radio's own), its
     companions, then up to two **spare picks** armed and warmed at the phrase start;
   - a phrase end with no payoff possible gets no turnaround and draws nothing;
   - a **turn** brings a payoff too; one with nothing to change still plays, as a fill with no gap.
     (Elling can ask for `nothing to turn` instead: one line in Tasks 3 and 4.)
2. **A hook's return on a drums or bass row is a low-end return** (a large build), even though a
   substitute covered the row: the hooked part is what comes back (spec Decision 5's "drums or
   bass returning").
3. **The long rest's return does not count** toward the next one (`RadioHook.longRest`), so the
   cycle is three ordinary absences, a long rest, three, a long rest -- not three then two.
4. **Resting exits ship last (Task 11).** The shared step decides them (`canRest`), but each
   runtime passes `canRest: false` until Task 11 makes a row go silent at a line and come back at
   a phrase start. With `canRest: false` the rest draw is never made, so Task 11 changes only runs
   with hooks set.
5. **Hook landings use each runtime's manual path, marked as the hook's:**
   - web: a `RadioManual` entry with `hook: 'exit' | 'return'` and `wrapAt` (its line), landing
     at that loop top (or the first after its stem is ready), through `swapAt` with a
     `transition`;
   - desktop: `queueManualChange` with `source: 'hook'` (and the return's size).
   A hook landing never clears a hook or a replace-soon, and never counts as a manual change.
6. **The desktop exit throw is armed live, as a lead-in is** (`armDiscoverExitThrow`): the throw's
   push goes out at the decision, the substitute's stage on a later tick. It goes dry when it
   cannot start a bar ahead (a loop under ~1.5 bars, or a decision late in the lap) or another
   throw is armed.
7. **Desktop grid:** the hook and dig buttons are tracks 16 and 17, present only while radio runs;
   fold's readout moves from 16 to 18 (it already exists only while radio runs, so it stays last).
   The radio-view spec (c3ff2dd) later moves both buttons into its `data-slot="radio-role"`
   reserved slot (see the overlap table).
8. **`ArcRow.held` keeps its name** and now means "reserved by a hook" (`radioHookReservesRow`);
   a new optional `heard` makes `lastOfItsKind` read heard rows. No rename churn in the panel.
9. **The old hook flag is retired last (Task 15):** `RadioSlotFlag` becomes `'replace-soon'`;
   `HOOK_HOLD_FACTOR`, `toggleRadioHook` and `radioHookSlotId` go; `likeRadioSlot` keeps the star
   and, when it holds, clears the row's replace-soon. Until then both runtimes simply stop setting
   or reading `'hook'` flags (Tasks 7 and 9).

## File map

**sssketch (`src/shared/`)**
- **Create:**
  - `radioBuildSize.ts`, `radioBuildSize.test.ts` (Task 1);
  - `radioBuildSizeDraws.test.ts` (Task 2);
  - `radioHooks.ts`, `radioHooks.test.ts`, `radioHookThrows.test.ts` (Task 5);
  - `radioReadoutHooks.test.ts`, `remoteStateRoles.test.ts` (Task 6);
  - `radioDig.ts`, `radioDig.test.ts` (Task 12).
- **Modify:**
  - `radioTransition.ts`, `radioManualChanges.ts` (+ its test), `radioTurnaround.ts`,
    `radioSchedule.ts` (+ its test), `radioDensity.ts` (`waits`) (Task 2);
  - `radioThrows.ts`, `discoverThrows.ts` (Task 5);
  - `radioReadout.ts`, `radioNextLanding.ts`, `radioDensity.ts` (`heard`), `remoteState.ts`
    (Task 6);
  - `discoverRanking.ts` (Task 12);
  - `radioSlotFlags.ts` (+ its test), `radioSchedule.test.ts` (Task 15).

**sssketch (desktop)**
- `src/renderer/src/components/DiscoverPanel.tsx` (Tasks 4, 9, 10, 11, 14).
- `src/main/remotePage.ts` (Task 10).

**ell.ing/radio**
- `src/radio/settings.ts`, `settings.test.ts`, `step.ts`, `step.test.ts`, `density.test.ts`,
  `controller.test.ts` (Task 3);
- `src/radio/step.ts`, `step.test.ts`, `controller.ts`, `controller.test.ts`, `likes.ts`,
  `likes.test.ts`, `src/main.ts`, `src/dev/devRadio.ts` (Task 7);
- `src/ui/full.ts`, `full.css`, `fullModel.ts`, `fullModel.test.ts`, `icons.ts` (Task 8);
- `src/radio/step.ts`, `controller.ts` (+ tests) (Task 11);
- `src/radio/pick.ts`, `pick.test.ts`, `step.ts`, `controller.ts`, `src/ui/full.ts`,
  `fullModel.ts` (Task 13).

## Task graph

```
Phase 1  T1 build sizes ──> T2 sized draws ─┬─> T3 web: sized builds + payoff ─────┐
                                            └─> T4 desktop: sized builds + payoff ─┴─ ship point A
Phase 2  T5 hooks (shared) ──> T6 words, arc, phone (shared) ─┐
                     T3 ──────────────────────────────────────┼─> T7 web hooks ─> T8 web hook UI ──┐
                     T4 ──────────────────────────────────────┴─> T9 desktop hooks ─> T10 desktop UI + phone ─┴─ ship point B
                                                         T8 + T10 ─> T11 resting exits (may wait)
Phase 3  T12 dig (shared) ─┬─> T13 web dig (after T8) ─────┐
                           └─> T14 desktop dig (after T10) ┴─ ship point C
Last     T7 + T9 ─> T15 retire the old hook flag ;  all ─> T16 verify + handoff
```

- **Parallel-safe now (disjoint new files, inert until a runtime calls them):** T1, T5, T12. T6
  after T5 (it imports `RADIO_ROLE_WORDS_MAX`).
- **Strictly in order:** T1 → T2 (T2 imports T1's types); T3 → T7 → T8 → T13 (one file,
  `step.ts`, and the row UI); T4 → T9 → T10 → T14 (`DiscoverPanel.tsx`).
- **In parallel:** T3 with T4 (different repos), T7 with T9, T8 with T10, T13 with T14.
- **T2 is inert in both runtimes** (every parameter optional; the desktop's new `sizedBuilds: true`
  default is read by nothing until T4), so it can land any time after T1.
- **T15 must be the last sssketch shared commit to touch `radioSlotFlags.ts`,** and only after T7
  and T9 are committed: the web reads `@shared` from sssketch's working tree, so T15 turns the web
  red the moment it is saved if T7 is not in.

**Overlap with the radio-view spec (`2026-10-03-sssketch-radio-view-design.md`, c3ff2dd, not yet
planned or built), which restyles the desktop rows and strip:**

| this plan | radio view | sequencing |
|---|---|---|
| T10: hook and dig buttons as grid tracks 16-17, fold readout to 18 | rows become a button line; leaves an empty `data-slot="radio-role"` slot for "the anointed-stems spec's hook/dig buttons" (§1.2) | **Either order.** If the view lands first, T10 puts the two buttons in that slot instead of tracks 16-17 (no grid edit). If T10 lands first, the view moves them (two elements, already one component each: `RadioRoleButtons`). |
| T9: "holding" = a hook IN (`radioHookInRow`), not `radioFlag === 'hook'` | §1.2 draws holding as a 2px bar from `radioFlag === 'hook'` | The view reads T9's `hookIn` prop instead of the flag. Whoever lands second makes the one-line swap. |
| T10: role words (`hook · back in 16 bars`) appended to the row's readout `age` | its label plate already shows `[label, age]` ("arrives through the same label/age fields and needs nothing here") | No conflict. |
| T10: the away hook's dimmed name | not in the view spec | The view keeps the element T10 adds (`data-hook-away`), on the label plate's line. |

Nothing in this plan touches the strip, the top line or the radio menu.

**Other agents' work:** check `git log` in both repos before each runtime task; `step.ts`,
`controller.ts` and `DiscoverPanel.tsx` are shared with other plans. Rebase onto their commits and
re-anchor by function name.

---

## Phase 1: build-ups sized to the change, every turnaround paid off

### Task 1: The build size, the budget and the payoff (`radioBuildSize.ts`)

**Parallel-safe** (a new file). **Depends on:** nothing.

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioBuildSize.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioBuildSize.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioBuildSize.test.ts`:

```ts
// Build-ups sized to the change, and every turnaround paid off (spec
// 2026-10-03-radio-anointed-stems-design section 4): the pure classification (radioBuildSize.ts).
import { describe, expect, it } from 'vitest'
import {
  BUILD_SPACING_BARS,
  NO_CHANGE_FORECAST,
  NO_RADIO_BUILDS,
  advanceRadioBuildClock,
  noteRadioBuild,
  radioApplyBuildBudget,
  radioArcStepWaits,
  radioBuildArc,
  radioBuildSize,
  radioBuildTier,
  radioPayoffMet,
  radioPayoffOf,
  radioPayoffShortfall,
  radioPhraseEndBuild,
  radioTurnaroundPayoffNeed,
  type RadioChangeForecast
} from './radioBuildSize'

const F = (o: Partial<RadioChangeForecast> = {}): RadioChangeForecast => ({
  ...NO_CHANGE_FORECAST,
  ...o
})
const FREE = { clock: NO_RADIO_BUILDS, aheadBars: 4, phraseBars: 16 }

describe('radioBuildTier', () => {
  it('none, small, medium and large from the forecast', () => {
    expect(radioBuildTier(F())).toBe('none')
    expect(radioBuildTier(F({ rows: 1 }))).toBe('small')
    expect(radioBuildTier(F({ rows: 2 }))).toBe('medium')
    expect(radioBuildTier(F({ rows: 3 }))).toBe('large')
    expect(radioBuildTier(F({ rows: 1, lowEndReturn: true }))).toBe('large')
    expect(radioBuildTier(F({ course: true }))).toBe('large')
    expect(radioBuildTier(F({ arcStep: 'add', rows: 1 }))).toBe('large')
    expect(radioBuildTier(F({ arcStep: 'remove' }))).toBe('large')
  })

  it('a hook back: medium after a short absence, large after a long one, by the pace scale', () => {
    const back = (awayBars: number): RadioChangeForecast => F({ rows: 1, hookReturn: { awayBars } })
    expect(radioBuildTier(back(16))).toBe('medium')
    expect(radioBuildTier(back(24))).toBe('large')
    // ludicrous (scale 0.5): 8 bars is short, 16 long
    expect(radioBuildTier(back(8), 0.5)).toBe('medium')
    expect(radioBuildTier(back(16), 0.5)).toBe('large')
    // slow (scale 1.5): 24 is still short
    expect(radioBuildTier(back(24), 1.5)).toBe('medium')
    expect(radioBuildTier(back(32), 1.5)).toBe('large')
  })
})

describe('the budget', () => {
  it('large falls to medium within a phrase of the last large build', () => {
    const clock = { sinceBuild: 40, sinceLarge: 8 }
    expect(radioApplyBuildBudget('large', { clock, aheadBars: 4, phraseBars: 16 })).toBe('medium')
    expect(radioApplyBuildBudget('large', { clock, aheadBars: 8, phraseBars: 16 })).toBe('large')
  })

  it('medium and large fall to small within BUILD_SPACING_BARS of any build', () => {
    const clock = { sinceBuild: 0, sinceLarge: null }
    expect(radioApplyBuildBudget('medium', { clock, aheadBars: 4, phraseBars: 16 })).toBe('small')
    expect(radioApplyBuildBudget('large', { clock, aheadBars: 4, phraseBars: 16 })).toBe('small')
    expect(
      radioApplyBuildBudget('medium', { clock, aheadBars: BUILD_SPACING_BARS, phraseBars: 16 })
    ).toBe('medium')
    expect(radioApplyBuildBudget('small', { clock, aheadBars: 0, phraseBars: 16 })).toBe('small')
  })

  it('no build yet: no downgrade', () => {
    expect(radioBuildSize(F({ rows: 3 }), FREE)).toBe('large')
  })

  it('the clock counts bars from the build it noted, and nothing before the first', () => {
    expect(advanceRadioBuildClock(NO_RADIO_BUILDS, 4)).toBe(NO_RADIO_BUILDS)
    let c = noteRadioBuild(NO_RADIO_BUILDS, false)
    c = advanceRadioBuildClock(c, 4)
    expect(c).toEqual({ sinceBuild: 4, sinceLarge: null })
    c = advanceRadioBuildClock(noteRadioBuild(c, true), 8)
    expect(c).toEqual({ sinceBuild: 8, sinceLarge: 8 })
  })
})

describe('radioBuildArc', () => {
  it('growing for a return or a big change, thinning only for a removal alone', () => {
    expect(radioBuildArc(F({ rows: 1, hookReturn: { awayBars: 16 } }), 'thinning')).toBe('growing')
    expect(radioBuildArc(F({ rows: 3 }), 'steady')).toBe('growing')
    expect(radioBuildArc(F({ arcStep: 'add', rows: 1 }), 'steady')).toBe('growing')
    expect(radioBuildArc(F({ arcStep: 'remove' }), 'growing')).toBe('thinning')
    expect(radioBuildArc(F({ arcStep: 'remove', rows: 1 }), 'growing')).toBe('growing')
    expect(radioBuildArc(F({ rows: 2 }), 'steady')).toBe('steady')
  })
})

describe('the payoff', () => {
  it('medium: two rows, a hook back, an arc step, the low end or a course change', () => {
    expect(radioPayoffMet(F({ rows: 1 }), 'medium')).toBe(false)
    expect(radioPayoffMet(F({ rows: 2 }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ rows: 1, hookReturn: { awayBars: 8 } }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ arcStep: 'remove' }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ rows: 1, lowEndReturn: true }), 'medium')).toBe(true)
    expect(radioPayoffMet(F(), 'none')).toBe(true)
  })

  it('large: three rows, a hook back with another row, the low end or a course change', () => {
    expect(radioPayoffMet(F({ rows: 2 }), 'large')).toBe(false)
    expect(radioPayoffMet(F({ rows: 3 }), 'large')).toBe(true)
    expect(radioPayoffMet(F({ rows: 1, hookReturn: { awayBars: 32 } }), 'large')).toBe(false)
    expect(radioPayoffMet(F({ rows: 2, hookReturn: { awayBars: 32 } }), 'large')).toBe(true)
    expect(radioPayoffMet(F({ arcStep: 'add', rows: 1 }), 'large')).toBe(false)
    expect(radioPayoffMet(F({ rows: 1, lowEndReturn: true }), 'large')).toBe(true)
    expect(radioPayoffOf(F({ rows: 2 }))).toBe('medium')
    expect(radioPayoffOf(F({ rows: 1 }))).toBe('none')
  })

  it('a gap needs a large payoff, any other turnaround a medium one', () => {
    expect(radioTurnaroundPayoffNeed({ gapBeats: 2 })).toBe('large')
    expect(radioTurnaroundPayoffNeed({ gapBeats: 0 })).toBe('medium')
    expect(radioTurnaroundPayoffNeed({})).toBe('medium')
  })

  it('the shortfall: rows still to add', () => {
    expect(radioPayoffShortfall(F(), 'medium')).toBe(2)
    expect(radioPayoffShortfall(F({ rows: 1 }), 'medium')).toBe(1)
    expect(radioPayoffShortfall(F({ rows: 1 }), 'large')).toBe(2)
    expect(radioPayoffShortfall(F({ rows: 1, hookReturn: { awayBars: 16 } }), 'large')).toBe(1)
    expect(radioPayoffShortfall(F({ arcStep: 'remove' }), 'medium')).toBe(0)
    for (const need of ['medium', 'large'] as const) {
      for (let rows = 0; rows <= 3; rows++) {
        const f = F({ rows })
        const n = radioPayoffShortfall(f, need)
        expect(radioPayoffMet({ ...f, rows: rows + n }, need)).toBe(true)
      }
    }
  })
})

describe('radioPhraseEndBuild', () => {
  it('skips with no payoff possible, and draws nothing for it', () => {
    expect(radioPhraseEndBuild(F(), 1, FREE)).toEqual({
      skip: true,
      size: 'medium',
      payoff: 'none'
    })
    expect(radioPhraseEndBuild(F({ rows: 1 }), 0, FREE).skip).toBe(true)
  })

  it('a fired phrase end is at least medium; what lands raises it; the spares set the payoff', () => {
    expect(radioPhraseEndBuild(F(), 2, FREE)).toEqual({
      skip: false,
      size: 'medium',
      payoff: 'medium'
    })
    expect(radioPhraseEndBuild(F({ rows: 1 }), 2, FREE)).toEqual({
      skip: false,
      size: 'medium',
      payoff: 'large'
    })
    expect(radioPhraseEndBuild(F({ rows: 1, lowEndReturn: true }), 0, FREE)).toEqual({
      skip: false,
      size: 'large',
      payoff: 'large'
    })
    // an arc removal alone: a large build (a thinning one), but only a medium payoff: no gap
    expect(radioPhraseEndBuild(F({ arcStep: 'remove' }), 0, FREE)).toEqual({
      skip: false,
      size: 'large',
      payoff: 'medium'
    })
  })

  it('the budget still applies', () => {
    const clock = { sinceBuild: 0, sinceLarge: 0 }
    expect(
      radioPhraseEndBuild(F({ rows: 3 }), 0, { clock, aheadBars: 4, phraseBars: 16 }).size
    ).toBe('small')
  })
})

describe('radioArcStepWaits', () => {
  it('off: never; on: until a phrase start, at most a phrase past ready', () => {
    const o = { sized: true, decidesForPhraseStart: false, overdueBars: 0, phraseBars: 16 }
    expect(radioArcStepWaits({ ...o, sized: false })).toBe(false)
    expect(radioArcStepWaits(o)).toBe(true)
    expect(radioArcStepWaits({ ...o, decidesForPhraseStart: true })).toBe(false)
    expect(radioArcStepWaits({ ...o, overdueBars: 12 })).toBe(true)
    expect(radioArcStepWaits({ ...o, overdueBars: 16 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**
  - Run: `npx vitest run src/shared/radioBuildSize.test.ts`
  - Expected: FAIL, `Failed to resolve import "./radioBuildSize"`.

- [ ] **Step 3: Implement.** Create `src/shared/radioBuildSize.ts`:

```ts
// src/shared/radioBuildSize.ts
//
// Build-ups sized to the change, and every turnaround paid off
// (docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md section 4).
//
// Elling, listening to the web radio: "the noise sweep almost oversells the change that's about
// to come" -- and then "a turnaround feels like a letdown kinda if there isn't a somewhat dramatic
// change to the current state". So the pairing goes both ways:
//   - the size of a build follows the size of the change it leads into (radioBuildSize), and
//   - a turnaround that fires is paid off by a change on its wrap (radioPayoffMet): two or more
//     rows, a hook back or an arc step; three or more, or the low end back, after a gap.
//
// Pure, no randomness: every function here only classifies. The runtimes fill the forecast from
// what they know a lap ahead, keep the build clock on their own play clock, and assemble a payoff
// from what is due (radio's armed pick, its companions, spare picks).

import type { TurnaroundArc, TurnaroundPlan } from './radioTurnaround'

/** How big a build a change earns. */
export type RadioBuildSize = 'none' | 'small' | 'medium' | 'large'

/** What a turnaround's wrap can pay off with, or must: `none` (nothing can change there),
 * `medium` (two rows, a hook back, an arc step), `large` (three rows, a hook back with another
 * row, the low end back, a course change). */
export type RadioPayoff = 'none' | 'medium' | 'large'

export const RADIO_BUILD_SIZES: readonly RadioBuildSize[] = ['none', 'small', 'medium', 'large']

/** What changes or joins at one loop top, as the runtime knows it when it decides. Hook exits
 * (a dub exit: no build) and arc removals are not `rows`. */
export interface RadioChangeForecast {
  /** Rows changing or joining: radio's change, its companions, manual changes queued for the top,
   * a hook return, an arc add. */
  rows: number
  /** A hook coming back at this top, and how long it was away (bars). */
  hookReturn: { awayBars: number } | null
  /** A row with drums or bass among its kinds, silent in the lap before and heard after it (a
   * hook return on such a row, a rest ending, an arc add). */
  lowEndReturn: boolean
  /** The density arc's step landing at this top. */
  arcStep: 'add' | 'remove' | null
  /** A desktop course change at this top (every row at once). */
  course: boolean
}

export const NO_CHANGE_FORECAST: RadioChangeForecast = Object.freeze({
  rows: 0,
  hookReturn: null,
  lowEndReturn: false,
  arcStep: null,
  course: false
}) as RadioChangeForecast

/** Bars a hook must be away, at pace scale 1, for its return to be a large change (spec 4.2:
 * "a long absence (24 or more)"). Scaled by radioHookPaceScale. */
export const HOOK_LONG_AWAY_BARS = 16

/** No build of any size within this many bars of the last one: a second falls to `small`. */
export const BUILD_SPACING_BARS = 8

/** The build clock: bars since the last build landed (any riser, per-change or a turnaround's)
 * and since the last LARGE build (a turnaround rolled at `large` that fired). Null: none yet.
 * The runtime advances it at every wrap while radio runs and is not held (advanceRadioBuildClock)
 * and notes a build at the wrap it lands on (noteRadioBuild). */
export interface RadioBuildClock {
  sinceBuild: number | null
  sinceLarge: number | null
}

export const NO_RADIO_BUILDS: RadioBuildClock = Object.freeze({
  sinceBuild: null,
  sinceLarge: null
}) as RadioBuildClock

export function advanceRadioBuildClock(clock: RadioBuildClock, bars: number): RadioBuildClock {
  const add = Number.isFinite(bars) && bars > 0 ? bars : 0
  if (add === 0 || (clock.sinceBuild === null && clock.sinceLarge === null)) return clock
  return {
    sinceBuild: clock.sinceBuild === null ? null : clock.sinceBuild + add,
    sinceLarge: clock.sinceLarge === null ? null : clock.sinceLarge + add
  }
}

/** A build landed now: `large` when it was a turnaround rolled at large. */
export function noteRadioBuild(clock: RadioBuildClock, large: boolean): RadioBuildClock {
  return { sinceBuild: 0, sinceLarge: large ? 0 : clock.sinceLarge }
}

/** Whether a plan or a gesture is a build for the clock: a riser in it. */
export function radioPlanIsBuild(plan: Pick<TurnaroundPlan, 'riserBars'> | null): boolean {
  return plan !== null && (plan.riserBars ?? 0) > 0
}

const RANK: Readonly<Record<RadioBuildSize, number>> = { none: 0, small: 1, medium: 2, large: 3 }

export function radioBuildSizeAtLeast(a: RadioBuildSize, b: RadioBuildSize): boolean {
  return RANK[a] >= RANK[b]
}

/** The tier a change earns, before the budget (spec 4.2). */
export function radioBuildTier(f: RadioChangeForecast, hookScale = 1): RadioBuildSize {
  const scale = Number.isFinite(hookScale) && hookScale > 0 ? hookScale : 1
  if (
    f.lowEndReturn ||
    f.course ||
    f.arcStep !== null ||
    f.rows >= 3 ||
    (f.hookReturn !== null && f.hookReturn.awayBars > HOOK_LONG_AWAY_BARS * scale)
  ) {
    return 'large'
  }
  if (f.hookReturn !== null || f.rows === 2) return 'medium'
  if (f.rows === 1) return 'small'
  return 'none'
}

export interface RadioBuildBudget {
  /** The build clock, as advanced to now. */
  clock: RadioBuildClock
  /** Bars from now to the top this build lands on: the clock is compared at that top. */
  aheadBars: number
  /** The turnaround phrase, in bars: a large build at most once per phrase. */
  phraseBars: number
}

/** The budget (Huron: a build that comes too often stops meaning anything): `large` falls to
 * `medium` within a phrase of the last large build; `medium` or `large` falls to `small` within
 * BUILD_SPACING_BARS of the last build of any size. */
export function radioApplyBuildBudget(size: RadioBuildSize, b: RadioBuildBudget): RadioBuildSize {
  const ahead = Number.isFinite(b.aheadBars) && b.aheadBars > 0 ? b.aheadBars : 0
  const since = (x: number | null): number => (x === null ? Number.POSITIVE_INFINITY : x + ahead)
  let out = size
  if (out === 'large' && since(b.clock.sinceLarge) < b.phraseBars) out = 'medium'
  if ((out === 'large' || out === 'medium') && since(b.clock.sinceBuild) < BUILD_SPACING_BARS) {
    out = 'small'
  }
  return out
}

/** A per-change gesture's tier: the change's own, after the budget. */
export function radioBuildSize(
  f: RadioChangeForecast,
  opts: { hookScale?: number } & RadioBuildBudget
): RadioBuildSize {
  return radioApplyBuildBudget(radioBuildTier(f, opts.hookScale), opts)
}

/** The arc a build is drawn for (spec 4.2): `growing` when it comes from a hook return, the low
 * end returning, three or more rows, an arc add or a course change; `thinning` when it comes only
 * from an arc removal (a thinning mix softens; it does not drop); otherwise the leg's own. */
export function radioBuildArc(f: RadioChangeForecast, legArc: TurnaroundArc): TurnaroundArc {
  if (f.hookReturn !== null || f.lowEndReturn || f.rows >= 3 || f.arcStep === 'add' || f.course) {
    return 'growing'
  }
  if (f.arcStep === 'remove' && f.rows === 0) return 'thinning'
  return legArc
}

// ---- every turnaround paid off (Elling, 2026-10-03: "a turnaround feels like a letdown kinda if
// there isn't a somewhat dramatic change to the current state") ----

/** Whether what lands at a turnaround's wrap pays it off. `medium`: two or more rows, a hook back,
 * an arc step, the low end back or a course change. `large`: three or more rows, a hook back with
 * another row, the low end back or a course change. `none` is always met. */
export function radioPayoffMet(f: RadioChangeForecast, need: RadioPayoff): boolean {
  if (need === 'none') return true
  if (f.lowEndReturn || f.course) return true
  if (need === 'medium') return f.rows >= 2 || f.hookReturn !== null || f.arcStep !== null
  return f.rows >= 3 || (f.hookReturn !== null && f.rows >= 2)
}

/** The largest payoff a forecast meets. */
export function radioPayoffOf(f: RadioChangeForecast): RadioPayoff {
  if (radioPayoffMet(f, 'large')) return 'large'
  if (radioPayoffMet(f, 'medium')) return 'medium'
  return 'none'
}

/** The payoff a fired turnaround needs: `large` after a gap (the silence before the one is the
 * biggest promise radio makes), `medium` otherwise. */
export function radioTurnaroundPayoffNeed(plan: Pick<TurnaroundPlan, 'gapBeats'>): RadioPayoff {
  return (plan.gapBeats ?? 0) > 0 ? 'large' : 'medium'
}

/** How many more rows must change at the wrap for `f` to meet `need` (0 when it already does).
 * Rows are what a runtime can add: radio's armed pick pulled forward, its companions, spares. */
export function radioPayoffShortfall(f: RadioChangeForecast, need: RadioPayoff): number {
  if (radioPayoffMet(f, need)) return 0
  if (need === 'large') return Math.max(0, (f.hookReturn !== null ? 2 : 3) - f.rows)
  return Math.max(0, 2 - f.rows)
}

/** `f` with `n` more rows changing (assembled for a payoff). */
export function radioForecastWithRows(f: RadioChangeForecast, n: number): RadioChangeForecast {
  return n > 0 ? { ...f, rows: f.rows + n } : f
}

/**
 * THE PHRASE END's size, and the payoff it may promise (spec 4.4, 4.7), from `f` -- what already
 * lands at the wrap -- and `spare`, the rows the runtime could add there (radio's armed pick when
 * it is not already in `f`, its companions, spare picks: each warm and eligible).
 *
 * - `skip`: no payoff is possible (`f` plus every spare row does not meet `medium`): the phrase
 *   end gets no turnaround, and its roll draws nothing.
 * - `size`: the tier `f` earns, raised to `medium` (a fired turnaround always brings at least a
 *   medium change: the runtime assembles it), then the budget.
 * - `payoff`: the largest payoff `f` plus the spares can meet. rollTurnaround's gap needs `large`.
 */
export function radioPhraseEndBuild(
  f: RadioChangeForecast,
  spare: number,
  opts: { hookScale?: number } & RadioBuildBudget
): { skip: boolean; size: RadioBuildSize; payoff: RadioPayoff } {
  const best = radioForecastWithRows(f, Math.max(0, Math.floor(spare)))
  const payoff = radioPayoffOf(best)
  const raw = radioBuildTier(f, opts.hookScale)
  const floored: RadioBuildSize = radioBuildSizeAtLeast(raw, 'medium') ? raw : 'medium'
  return { skip: payoff === 'none', size: radioApplyBuildBudget(floored, opts), payoff }
}

// ---- big moments on phrase starts (spec 4.5) ----

/**
 * Whether a density-arc step that is ready waits (sizedBuilds): it lands only on a phrase start
 * -- decided at the wrap starting a phrase's last lap (`decidesForPhraseStart`, the clock's
 * turnaroundLapStarts) -- and waits at most one phrase past being ready (`overdueBars`: the leg's
 * bars beyond its step). Off (`sized` false): never. Legs are 96-192 bars, so the wait is
 * invisible to the arc; it makes every arc step meet the phrase-end turnaround.
 */
export function radioArcStepWaits(o: {
  sized: boolean
  decidesForPhraseStart: boolean
  overdueBars: number
  phraseBars: number
}): boolean {
  if (!o.sized || o.decidesForPhraseStart) return false
  return o.overdueBars < o.phraseBars
}
```

- [ ] **Step 4: Run it and watch it pass.**
  - Run: `npx vitest run src/shared/radioBuildSize.test.ts` — Expected: 15 passed.

- [ ] **Step 5: Lint, typecheck, commit.**
  - Run: `npx eslint src/shared/radioBuildSize.ts src/shared/radioBuildSize.test.ts` and
    `npm run typecheck`.
  - Commit: `git commit --only src/shared/radioBuildSize.ts src/shared/radioBuildSize.test.ts`
    (after `git add` of both new files).
  - Message: `radio sized builds: the shared classification -- radioBuildSize (none/small/medium/large from a change forecast: rows, a hook back and how long it was away by the pace scale, the low end returning, an arc step, a course change), the budget (large at most once a phrase, any build at most every 8 bars), the build arc, and every turnaround paid off (radioPayoffMet / radioTurnaroundPayoffNeed / radioPayoffShortfall; radioPhraseEndBuild: skip with no payoff possible, a fired phrase end at least medium, a gap only with a large payoff); radioArcStepWaits (arc steps land on phrase starts). Pure, no randomness, nothing calls it yet`, then the trailer.

### Task 2: Sized draws: the palette, the phrase end, the arc's timing, the setting

**Depends on:** Task 1. **Inert in both runtimes** until Tasks 3 and 4.

**Files (all `/Users/nickel/Claudecode/sssketch/src/shared/`):**
- Modify: `radioTransition.ts`, `radioManualChanges.ts`, `radioManualChanges.test.ts`,
  `radioTurnaround.ts`, `radioSchedule.ts`, `radioSchedule.test.ts`, `radioDensity.ts`
- Create: `radioBuildSizeDraws.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioBuildSizeDraws.test.ts`. Its two
  hashes were recorded from the unmodified code: they must pass before AND after Step 3. The diffs
  in Step 3 apply with `git apply` against 78be6e5 (or by hand, anchored on their context).

```ts
// Build-ups sized to the change (spec 2026-10-03-radio-anointed-stems-design 4.3-4.4): the
// per-change palette (pickTransition, radioGestureBeats) and the phrase end's roll
// (rollTurnaround's `size`, `payoff`, TurnaroundRow.exiting). Absent, every draw is today's.
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import { advanceDensityLeg } from './radioDensity'
import { radioGestureBeats } from './radioManualChanges'
import { turnaroundSilencedRowIds } from './radioThrows'
import { pickTransition, type RadioTransitions } from './radioTransition'
import {
  rollTurnaround,
  type RadioTurnarounds,
  type TurnaroundArc,
  type TurnaroundInput,
  type TurnaroundPlan,
  type TurnaroundRow
} from './radioTurnaround'
import { hashText, seededRandom } from './seededRandom'

const KINDS: DiscoverSlotKind[][] = [['drums'], ['bass'], ['lead'], ['warm'], []]

/** 2000 seeded draws per temperament and kind set, with the stream position after each. */
function transitionTrace(sizing?: Parameters<typeof pickTransition>[3]): string {
  const out: string[] = []
  for (const t of ['off', 'subtle', 'bold'] as RadioTransitions[])
    for (const kinds of KINDS) {
      const random = seededRandom(`pt-${t}-${kinds.join('+')}`)
      for (let i = 0; i < 2000; i++) out.push(pickTransition(t, kinds, random, sizing))
      out.push(String(random()))
    }
  return out.join(',')
}

const row = (
  id: string,
  kinds: DiscoverSlotKind[],
  o: Partial<TurnaroundRow> = {}
): TurnaroundRow => ({
  id,
  kinds,
  hooked: false,
  audible: true,
  inFilterIn: false,
  barLength: 4,
  ...o
})
const BED = [row('d', ['drums']), row('b', ['bass']), row('l', ['lead']), row('w', ['warm'])]

/** Seeded rolls over rates, arcs, loops and depths, chained through the memory, with the stream
 * position after each. */
function rollTrace(extra: Partial<TurnaroundInput> = {}, rows: TurnaroundRow[] = BED): string {
  const out: string[] = []
  for (const rate of ['rare', 'often'] as RadioTurnarounds[])
    for (const arc of ['growing', 'thinning', 'steady'] as TurnaroundArc[])
      for (const loopBars of [2, 4, 8])
        for (const depth of ['subtle', 'bold'] as const)
          for (const combine of [false, true]) {
            const random = seededRandom(`roll-${rate}-${arc}-${loopBars}-${depth}-${combine}`)
            let lastPhrase: TurnaroundInput['lastPhrase'] = null
            for (let k = 0; k < 60; k++) {
              const plan = rollTurnaround({
                rate,
                random,
                loopBars,
                lastPhrase,
                rows,
                arc,
                leavingRowId: null,
                depth,
                combine,
                ...extra
              })
              out.push(JSON.stringify(plan))
              lastPhrase =
                plan === null
                  ? null
                  : {
                      move: plan.move,
                      beats: plan.beats,
                      halvings: plan.halvings,
                      ...(plan.parts && plan.parts.length > 1
                        ? { parts: plan.parts.map((p) => ({ move: p.move, beats: p.beats })) }
                        : {})
                    }
              out.push(String(random()))
            }
          }
  return out.join('\n')
}

// Recorded from the UNMODIFIED radioTransition.ts / radioTurnaround.ts (sssketch 78be6e5).
const TRANSITIONS_BEFORE = 'd5e51d0c'
const ROLLS_BEFORE = 'b5136502'

describe('absent: today, draw for draw', () => {
  it('pickTransition with no sizing', () => {
    expect(hashText(transitionTrace())).toBe(TRANSITIONS_BEFORE)
    expect(hashText(transitionTrace({}))).toBe(TRANSITIONS_BEFORE)
  })

  it('rollTurnaround with no size and no payoff', () => {
    expect(hashText(rollTrace())).toBe(ROLLS_BEFORE)
    expect(hashText(rollTrace({ payoff: 'large' }))).toBe(ROLLS_BEFORE)
  })

  it('radioGestureBeats: a riser is 8 beats without a size and at large', () => {
    expect(radioGestureBeats('riser', () => 2)).toBe(8)
    expect(radioGestureBeats('riser', () => 2, 'large')).toBe(8)
    expect(radioGestureBeats('riser', () => 2, 'medium')).toBe(4)
    expect(radioGestureBeats('hole', () => 2, 'medium')).toBe(2)
    expect(radioGestureBeats('duck', () => 2, 'small')).toBe(4)
  })
})

describe('the per-change palette by size', () => {
  const N = 20000
  function counts(
    sizing: Parameters<typeof pickTransition>[3],
    kinds: DiscoverSlotKind[]
  ): { out: Record<string, number>; draws: number } {
    const random = seededRandom(`counts-${kinds.join('+')}`)
    const out: Record<string, number> = {}
    let draws = 0
    const counted = (): number => {
      draws++
      return random()
    }
    for (let i = 0; i < N; i++) {
      const k = pickTransition('bold', kinds, counted, sizing)
      out[k] = (out[k] ?? 0) + 1
    }
    return { out, draws }
  }

  it('small never gives a riser; medium as today; large about twice; one draw each', () => {
    for (const kinds of KINDS.slice(0, 4)) {
      const today = counts(undefined, kinds)
      const small = counts({ size: 'small' }, kinds)
      const none = counts({ size: 'none' }, kinds)
      const medium = counts({ size: 'medium' }, kinds)
      const large = counts({ size: 'large' }, kinds)
      expect(small.out.riser ?? 0).toBe(0)
      expect(none.out.riser ?? 0).toBe(0)
      // medium is today's table exactly: the same seed, the same draws
      expect(medium.out).toEqual(today.out)
      // bold tables give the riser 0.1 of 1: x2 is 0.2 of 1.1
      expect(large.out.riser / N).toBeCloseTo(0.2 / 1.1, 1)
      for (const c of [small, none, medium, large]) expect(c.draws).toBe(N)
    }
  })

  it('a hook return never draws a filter in or a bloom', () => {
    for (const kinds of KINDS)
      for (const size of ['small', 'medium', 'large'] as const) {
        const { out, draws } = counts({ size, hookReturn: true }, kinds)
        expect(out['filter in'] ?? 0).toBe(0)
        expect(out.bloom ?? 0).toBe(0)
        expect(draws).toBe(N)
      }
  })

  it('subtle has no riser at any size; off is always a cut', () => {
    const random = seededRandom('subtle')
    for (let i = 0; i < 5000; i++) {
      expect(pickTransition('subtle', ['warm'], random, { size: 'large' })).not.toBe('riser')
      expect(pickTransition('off', ['warm'], random, { size: 'large', hookReturn: true })).toBe(
        'cut'
      )
    }
  })
})

describe('the phrase end by size', () => {
  /** Every plan of many seeded fresh rolls at `size` (no memory), combine on, bold, growing. */
  function plans(
    extra: Partial<TurnaroundInput>,
    rate: RadioTurnarounds = 'often',
    n = 4000
  ): (TurnaroundPlan | null)[] {
    const random = seededRandom(`plans-${JSON.stringify(extra)}-${rate}`)
    const out: (TurnaroundPlan | null)[] = []
    for (let i = 0; i < n; i++) {
      out.push(
        rollTurnaround({
          rate,
          random,
          loopBars: 8,
          lastPhrase: null,
          rows: BED,
          arc: 'growing',
          leavingRowId: null,
          depth: 'bold',
          combine: true,
          ...extra
        })
      )
    }
    return out
  }
  const risers = (ps: (TurnaroundPlan | null)[]): (TurnaroundPlan | null)[] =>
    ps.filter((p) => p !== null && (p.parts ?? [{ move: p.move }]).some((x) => x.move === 'riser'))

  it('none and small: the riser rare, at most 4 beats, never gapped, at most two moves', () => {
    const today = risers(plans({})).length
    for (const size of ['none', 'small'] as const) {
      const ps = plans({ size })
      const rs = risers(ps)
      expect(rs.length).toBeLessThan(today * 0.35)
      for (const p of rs) {
        const riser = p!.parts!.find((x) => x.move === 'riser')!
        expect(riser.beats).toBeLessThanOrEqual(4)
      }
      for (const p of ps) {
        if (p === null) continue
        expect(p.gapBeats ?? 0).toBe(0)
        expect(p.parts!.length).toBeLessThanOrEqual(2)
      }
    }
  })

  it('medium: the riser as today, at most 8 beats, never gapped', () => {
    const ps = plans({ size: 'medium' })
    for (const p of ps) {
      if (p === null) continue
      expect(p.gapBeats ?? 0).toBe(0)
      const riser = p.parts!.find((x) => x.move === 'riser')
      if (riser) expect(riser.beats).toBeLessThanOrEqual(8)
    }
    expect(risers(ps).length / ps.length).toBeCloseTo(risers(plans({})).length / ps.length, 1)
  })

  it('large fires at rare and often but not off, and gaps about as often as today', () => {
    for (const rate of ['rare', 'often'] as const) {
      const ps = plans({ size: 'large' }, rate, 1000)
      expect(ps.every((p) => p !== null)).toBe(true)
    }
    expect(plans({ size: 'large' }, 'off', 200).every((p) => p === null)).toBe(true)
    const large = risers(plans({ size: 'large' }))
    const gapped = large.filter((p) => (p!.gapBeats ?? 0) > 0).length
    expect(gapped / large.length).toBeGreaterThan(0.5)
  })

  it('a gap only with a large payoff (a turn too)', () => {
    for (const payoff of ['none', 'medium'] as const) {
      for (const p of plans({ size: 'large', payoff })) expect(p?.gapBeats ?? 0).toBe(0)
      for (const p of plans({ payoff, force: {} }, 'often', 1000)) expect(p?.gapBeats ?? 0).toBe(0)
    }
  })

  it('an exiting row is never silenced, and takes the wash', () => {
    const rows = [
      row('d', ['drums'], { exiting: true }),
      row('b', ['bass']),
      row('l', ['lead']),
      row('w', ['warm'])
    ]
    const random = seededRandom('exiting')
    let washed = 0
    for (let i = 0; i < 4000; i++) {
      for (const size of [undefined, 'large'] as const) {
        const plan = rollTurnaround({
          rate: 'often',
          random,
          loopBars: 8,
          lastPhrase: null,
          rows,
          arc: i % 2 === 0 ? 'growing' : 'steady',
          leavingRowId: null,
          depth: 'bold',
          combine: true,
          ...(size ? { size } : {})
        })
        if (plan === null) continue
        expect(turnaroundSilencedRowIds(plan)).not.toContain('d')
        const wash = plan.parts?.find((p) => p.move === 'wash')
        if (wash) {
          expect(wash.rowIds).toEqual(['d'])
          washed++
        }
      }
    }
    expect(washed).toBeGreaterThan(0)
  })
})

describe('advanceDensityLeg waits', () => {
  it('a ready step waits, its bars counting on; a turn never waits; absent is today', () => {
    const leg = { phase: 'growing' as const, target: 4, bars: 30, stepBars: 32 }
    const base = { count: 2, loopBars: 4, busy: false, canAdd: true, canRemove: true }
    expect(advanceDensityLeg(leg, base).step).toBe('add')
    expect(advanceDensityLeg(leg, { ...base, waits: false }).step).toBe('add')
    const waited = advanceDensityLeg(leg, { ...base, waits: true })
    expect(waited).toEqual({ leg: { ...leg, bars: 34 }, step: null })
    const turned = advanceDensityLeg(leg, { ...base, count: 4, waits: true, random: () => 0.5 })
    expect(turned.leg.phase).toBe('thinning')
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**
  - Run: `npx vitest run src/shared/radioBuildSizeDraws.test.ts`
  - Expected: the two fingerprint tests (`pickTransition with no sizing`, `rollTurnaround with no
    size and no payoff`) PASS, as does `subtle has no riser at any size` (true today); the other 9
    FAIL (`size`, `sizing` and `payoff` are ignored,
    `radioGestureBeats` gives 8 at `medium`, `advanceDensityLeg` has no `waits`). The two passing
    prove the fingerprints were recorded on today's code.

- [ ] **Step 3: Implement.** Apply these diffs (made against 78be6e5).

  a. `radioTransition.ts` -- `RISER_WEIGHT_BY_SIZE`, `RadioTransitionSizing`, `pickTransition`'s
  optional fourth argument:

```diff
--- a/src/shared/radioTransition.ts
+++ b/src/shared/radioTransition.ts
@@ -13,6 +13,7 @@
 // weighted gesture per change, and the curve builders at the bottom of
 // this file are what the engine actually performs.
 import type { DiscoverSlotKind } from './discoverSlotKind'
+import type { RadioBuildSize } from './radioBuildSize'
 import type { RiserClip } from './riser'
 import { riserCharacterForId, type RiserCharacter } from './riserCharacter'
 import type { AutomationPoint } from './toolkit'
@@ -95,16 +96,39 @@ function tableFor(temperament: 'subtle' | 'bold', kinds: readonly DiscoverSlotKi
   return { cut: 1 }
 }
 
+/** The riser's weight at each build size (spec 2026-10-03-radio-anointed-stems-design section
+ * 4.3): never before a one-row swap (`small`, and `none`), today's at `medium` (four beats long,
+ * radioGestureBeats), twice today's at `large` (today's eight). */
+export const RISER_WEIGHT_BY_SIZE: Readonly<Record<RadioBuildSize, number>> = {
+  none: 0,
+  small: 0,
+  medium: 1,
+  large: 2
+}
+
+/** What a sized draw knows: the change's build size, and whether it is a hook coming back (a
+ * return lands full -- turnarounds section 0, "release is return" -- so no `filter in` or
+ * `bloom`). */
+export interface RadioTransitionSizing {
+  size?: RadioBuildSize
+  hookReturn?: boolean
+}
+
 /** Which transition this change gets. `off` is always `cut`, which is
  * exactly what shipped 2026-09-26 -- and `cut` arms nothing at all, so a
- * cut project is byte-identical to a pre-transition one. */
+ * cut project is byte-identical to a pre-transition one.
+ *
+ * `sizing` (absent: exactly today's draw): the riser reweighted by the build size
+ * (RISER_WEIGHT_BY_SIZE), and a hook return's `filter in` and `bloom` taken out. The weights
+ * renormalise and there is still exactly one draw; `subtle` has no riser at any size. */
 export function pickTransition(
   temperament: RadioTransitions,
   kinds: readonly DiscoverSlotKind[],
-  random: () => number = Math.random
+  random: () => number = Math.random,
+  sizing?: RadioTransitionSizing
 ): RadioTransitionKind {
   if (temperament === 'off') return 'cut'
-  const table = tableFor(temperament, kinds)
+  const table = sizedTable(tableFor(temperament, kinds), sizing)
   const entries = Object.entries(table) as [RadioTransitionKind, number][]
   const total = entries.reduce((sum, [, w]) => sum + w, 0)
   if (!(total > 0)) return 'cut'
@@ -116,6 +140,22 @@ export function pickTransition(
   return 'cut'
 }
 
+/** The table as a sized draw sees it; the same object when `sizing` changes nothing. */
+function sizedTable(table: WeightTable, sizing: RadioTransitionSizing | undefined): WeightTable {
+  if (sizing === undefined || (sizing.size === undefined && sizing.hookReturn !== true)) {
+    return table
+  }
+  const out: WeightTable = {}
+  for (const [kind, weight] of Object.entries(table) as [RadioTransitionKind, number][]) {
+    if (sizing.hookReturn === true && (kind === 'filter in' || kind === 'bloom')) continue
+    out[kind] =
+      kind === 'riser' && sizing.size !== undefined
+        ? weight * RISER_WEIGHT_BY_SIZE[sizing.size]
+        : weight
+  }
+  return out
+}
+
 /** True for the two gestures that ANNOUNCE a change rather than decorate
  * its arrival.
  *
```

  b. `radioManualChanges.ts` -- `radioGestureBeats`' `size`; `drawManualTransitions` rows carry
  `size` / `hookReturn` and hand the row to `pick`:

```diff
--- a/src/shared/radioManualChanges.ts
+++ b/src/shared/radioManualChanges.ts
@@ -7,6 +7,7 @@
 // design.md). These are the two rules that decide what that swap carries.
 
 import type { DiscoverSlotKind } from './discoverSlotKind'
+import type { RadioBuildSize } from './radioBuildSize'
 import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'
 
 export interface ManualArrival {
@@ -16,10 +17,17 @@ export interface ManualArrival {
 
 /** How long each gesture takes, in beats -- the one table for radio's
  * decision branches and the manual queue: a hole is a drop-out of the drawn
- * length, a riser two bars, everything else one bar. */
-export function radioGestureBeats(kind: RadioTransitionKind, dropOutBeats: () => number): number {
+ * length, a riser two bars, everything else one bar.
+ *
+ * `size` (spec 2026-10-03-radio-anointed-stems-design 4.3): a riser before a change smaller than
+ * `large` is the short one, a bar; absent or `large`, today's two bars. */
+export function radioGestureBeats(
+  kind: RadioTransitionKind,
+  dropOutBeats: () => number,
+  size?: RadioBuildSize
+): number {
   if (kind === 'hole') return dropOutBeats()
-  if (kind === 'riser') return 8
+  if (kind === 'riser') return size === undefined || size === 'large' ? 8 : 4
   return 4
 }
 
@@ -38,9 +46,21 @@ export function radioGestureBeats(kind: RadioTransitionKind, dropOutBeats: () =>
  * cut WITHOUT taking the lap's one leading slot, so the next row may still
  * lead. `canLead` defaults to true. */
 export function drawManualTransitions(
-  rows: readonly { slotId: string; kinds: readonly DiscoverSlotKind[]; canLead?: boolean }[],
+  rows: readonly {
+    slotId: string
+    kinds: readonly DiscoverSlotKind[]
+    canLead?: boolean
+    /** The build size of the change this row lands in (radioGestureBeats' `size`); absent:
+     * today's lengths. The caller's `pick` reads it (and `hookReturn`) for the draw. */
+    size?: RadioBuildSize
+    /** A hook coming back (radioHooks.ts): its pick leaves out the arrival sweeps. */
+    hookReturn?: boolean
+  }[],
   options: {
-    pick: (kinds: readonly DiscoverSlotKind[]) => RadioTransitionKind
+    pick: (
+      kinds: readonly DiscoverSlotKind[],
+      row: { size?: RadioBuildSize; hookReturn?: boolean }
+    ) => RadioTransitionKind
     dropOutBeats: () => number
     /** The lap's leading slot is taken: a hole, a riser or the density arc's exit drop-out is
      * armed, or a phrase turnaround is (it is the lap's lead-in). */
@@ -55,8 +75,8 @@ export function drawManualTransitions(
   const out = new Map<string, ManualArrival>()
   let leadingTaken = options.leadingArmed
   for (const row of rows) {
-    let kind = options.pick(row.kinds)
-    let beats = radioGestureBeats(kind, options.dropOutBeats)
+    let kind = options.pick(row.kinds, row)
+    let beats = radioGestureBeats(kind, options.dropOutBeats, row.size)
     if (radioGestureLeadsChange(kind)) {
       // The curve is clamped to half the loop (clampToHalfLoop in
       // radioTransition.ts, private there), so a riser on a short loop is
```

  and in `radioManualChanges.test.ts` (`pick` is now called with the row too):

```diff
--- a/src/shared/radioManualChanges.test.ts
+++ b/src/shared/radioManualChanges.test.ts
@@ -122,8 +122,8 @@ describe('drawManualTransitions', () => {
       loopBars: 16
     })
     expect(pick).toHaveBeenCalledTimes(2)
-    expect(pick).toHaveBeenNthCalledWith(1, ['drums'])
-    expect(pick).toHaveBeenNthCalledWith(2, ['bass'])
+    expect(pick).toHaveBeenNthCalledWith(1, ['drums'], rows[0])
+    expect(pick).toHaveBeenNthCalledWith(2, ['bass'], rows[1])
   })
 
   it('fits a riser by its half-loop clamp: 2 bars on a 2-bar loop is 1 bar', () => {
```

  c. `radioTurnaround.ts` -- `size`, `payoff`, `TurnaroundRow.exiting` (Phase 2 uses `exiting`;
  it lives here because it is the planner's, and is inert until then):

```diff
--- a/src/shared/radioTurnaround.ts
+++ b/src/shared/radioTurnaround.ts
@@ -18,6 +18,7 @@
 import type { DiscoverSlotKind } from './discoverSlotKind'
 import { buildDropOutCurve, DROP_OUT_BEAT_WEIGHTS, pickDropOutBeats } from './radioDropOut'
 import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'
+import type { RadioBuildSize, RadioPayoff } from './radioBuildSize'
 import { seededRandom } from './seededRandom'
 import {
   evaluateAutomation,
@@ -252,6 +253,10 @@ export interface TurnaroundRow {
   inFilterIn: boolean
   /** Its own loop, in bars: a stop is never longer. */
   barLength: number
+  /** A hook leaving on this wrap (radioHooks.ts) with its echo throw: no drop, stop or gap
+   * silences it before the wrap, so the throw is heard, and it is the wash's row when a wash is
+   * drawn (a reverb swell on a part going out is dub too). Absent: false. */
+  exiting?: boolean
 }
 
 /** What a plan does to one row. Every curve is in beats before the wrap (see the curves). */
@@ -323,6 +328,64 @@ export interface TurnaroundInput {
    * draw. On, a fired fresh roll draws ONE more number after all of today's, which seeds every
    * layering choice (turnaroundLayerRandom); a roll that does not fire draws nothing more. */
   combine?: boolean
+  /** The build the change on this wrap earns (spec 2026-10-03-radio-anointed-stems-design 4.4,
+   * radioBuildSize.ts). Absent: today, draw for draw. A phrase end only; a turn ignores it.
+   *   - `none`, `small`: the riser at TURNAROUND_RISER_FACTOR's weight, at most 4 beats, no gap,
+   *     at most two moves layered;
+   *   - `medium`: the riser as today, at most 8 beats, no gap;
+   *   - `large`: the phrase end fires at every rate but `off`, the riser at twice its weight, the
+   *     gap as today.
+   * Every tier only reweights, clamps or skips a draw of the layering's own random: none adds a
+   * draw to `random`. */
+  size?: RadioBuildSize
+  /** The largest payoff the runtime can land on this wrap (radioBuildSize.ts radioPayoffOf, with
+   * its spare rows). A gap promises a large one, so a gap is drawn only when this is `large`.
+   * Absent: no limit (today). Applies to turns too. */
+  payoff?: RadioPayoff
+}
+
+/** The riser's weight factor in a phrase end's draw, and its longest, by build size (spec 4.4). */
+export const TURNAROUND_RISER_FACTOR: Readonly<Record<RadioBuildSize, number>> = {
+  none: 0.15,
+  small: 0.15,
+  medium: 1,
+  large: 2
+}
+export const TURNAROUND_RISER_CAP_BEATS: Readonly<Record<RadioBuildSize, number>> = {
+  none: 4,
+  small: 4,
+  medium: 8,
+  large: Number.POSITIVE_INFINITY
+}
+/** The most moves a phrase end layers at `none` and `small`. */
+export const TURNAROUND_SMALL_MAX_MOVES = 2
+
+/** What a size does to a roll, worked out once. Absent size: all neutral (factor 1, no cap). */
+interface Sizing {
+  riserFactor: number
+  riserCap: number
+  maxMoves: number
+  gap: boolean
+}
+
+function sizingOf(input: Pick<TurnaroundInput, 'size' | 'payoff' | 'force'>): Sizing {
+  const size = input.force !== undefined ? undefined : input.size
+  const gapPayoff = input.payoff === undefined || input.payoff === 'large'
+  if (size === undefined) {
+    return { riserFactor: 1, riserCap: Number.POSITIVE_INFINITY, maxMoves: 3, gap: gapPayoff }
+  }
+  return {
+    riserFactor: TURNAROUND_RISER_FACTOR[size],
+    riserCap: TURNAROUND_RISER_CAP_BEATS[size],
+    maxMoves: size === 'none' || size === 'small' ? TURNAROUND_SMALL_MAX_MOVES : 3,
+    gap: size === 'large' && gapPayoff
+  }
+}
+
+/** A move's weight in a phrase end's draw: the arc's, the riser's scaled by the size. */
+function moveWeight(arc: TurnaroundArc, m: TurnaroundMove, sizing: Sizing): number {
+  const w = TURNAROUND_WEIGHTS[arc][m]
+  return m === 'riser' && sizing.riserFactor !== 1 ? w * sizing.riserFactor : w
 }
 
 /** A turn: a turnaround on demand, at the next loop top
@@ -394,18 +457,29 @@ interface Bed {
   keeper: TurnaroundRow | null
   washed: TurnaroundRow[]
   filtered: TurnaroundRow[]
+  /** Rows a hook leaves on at this wrap (TurnaroundRow.exiting). */
+  exiting: TurnaroundRow[]
 }
 
 function bedOf(rows: readonly TurnaroundRow[], leavingRowId: string | null): Bed {
   const audible = rows.filter((r) => r.audible)
   const leaving = leavingRowId === null ? undefined : audible.find((r) => r.id === leavingRowId)
+  // a hook leaving on this wrap throws its echo before it: never dropped, stopped or gapped
+  const exiting = audible.filter((r) => r.exiting === true)
+  const droppable = exiting.length === 0 ? audible : audible.filter((r) => r.exiting !== true)
   return {
     audible,
-    drums: audible.filter(isDrums),
-    low: audible.filter(isLow),
+    drums: droppable.filter(isDrums),
+    low: droppable.filter(isLow),
     keeper: turnaroundStopKeeper(audible),
-    washed: leaving !== undefined ? [leaving] : audible.filter((r) => !isDrums(r)),
-    filtered: audible.filter((r) => !isDrums(r) && !r.inFilterIn)
+    washed:
+      leaving !== undefined
+        ? [leaving]
+        : exiting.length > 0
+          ? exiting
+          : audible.filter((r) => !isDrums(r)),
+    filtered: audible.filter((r) => !isDrums(r) && !r.inFilterIn),
+    exiting
   }
 }
 
@@ -419,7 +493,13 @@ function canSound(move: TurnaroundMove, bed: Bed): boolean {
     case 'low drop':
       return n >= 2 && bed.low.length > 0 && bed.low.length < n
     case 'stop':
-      return n >= 2 && bed.keeper !== null && bed.keeper.barLength * BEATS_PER_BAR >= 1
+      // something to stop besides the kept row and a hook leaving here (always, with none leaving)
+      return (
+        n >= 2 &&
+        bed.keeper !== null &&
+        bed.keeper.barLength * BEATS_PER_BAR >= 1 &&
+        bed.audible.some((r) => r !== bed.keeper && r.exiting !== true)
+      )
     case 'wash':
       return bed.washed.length > 0
     case 'lift':
@@ -513,7 +593,13 @@ export const TURNAROUND_MOVE_LABEL: Readonly<Record<TurnaroundMove, string>> = {
   riser: 'riser'
 }
 
-function drawBeats(move: TurnaroundMove, bed: Bed, capBeats: number, random: () => number): number {
+function drawBeats(
+  move: TurnaroundMove,
+  bed: Bed,
+  capBeats: number,
+  random: () => number,
+  riserCap: number = Number.POSITIVE_INFINITY
+): number {
   switch (move) {
     case 'drum drop':
       return Math.min(pickDropOutBeats(random), capBeats)
@@ -533,7 +619,7 @@ function drawBeats(move: TurnaroundMove, bed: Bed, capBeats: number, random: ()
     case 'lift':
       return Math.min(pickEven(LIFT_BEATS, random), capBeats)
     case 'riser':
-      return Math.min(pickEven(RISER_BARS, random) * BEATS_PER_BAR, capBeats)
+      return Math.min(pickEven(RISER_BARS, random) * BEATS_PER_BAR, capBeats, riserCap)
     case 'wash':
       return Math.min(WASH_BEATS, capBeats)
     case 'dip':
@@ -561,7 +647,10 @@ function build(
     case 'stop': {
       const volume = turnaroundDropCurve(loopBars, beats)
       if (volume.length === 0) return null
-      const dropped = move === 'low drop' ? bed.low : bed.audible.filter((r) => r !== bed.keeper)
+      const dropped =
+        move === 'low drop'
+          ? bed.low
+          : bed.audible.filter((r) => r !== bed.keeper && r.exiting !== true)
       return plan(dropped.map((r) => ({ rowId: r.id, volume: volume.map((p) => ({ ...p })) })))
     }
     case 'wash':
@@ -611,7 +700,10 @@ export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
   const { random, loopBars, lastPhrase, arc } = input
   const moves = input.moves ?? TURNAROUND_FAMILIES
   const looks = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
-  const chance = TURNAROUND_CHANCE[input.rate] ?? 0
+  const rateChance = TURNAROUND_CHANCE[input.rate] ?? 0
+  // a large change makes its phrase end fire, at every rate but `off`
+  const chance = input.size === 'large' && rateChance > 0 ? 1 : rateChance
+  const sizing = sizingOf(input)
   const capBeats = capOf(input)
   if (!(chance > 0) || !(capBeats > 0) || moves.length === 0) return null
   const bed = bedOf(input.rows, input.leavingRowId)
@@ -630,12 +722,13 @@ export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
   const drawn = drawOf(bed, arc, capBeats, moves)
   if (drawn.length === 0 || !(random() < chance)) return null
   const move = pickWeighted(
-    drawn.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
+    drawn.map((m) => ({ item: m, weight: moveWeight(arc, m, sizing) })),
     random
   )
-  const lead = build(move, drawBeats(move, bed, capBeats, random), 0, bed, loopBars, random, looks)
+  const beats = drawBeats(move, bed, capBeats, random, sizing.riserCap)
+  const lead = build(move, beats, 0, bed, loopBars, random, looks)
   return lead !== null && input.combine === true
-    ? layerTurnaround(lead, input, bed, capBeats, capBeats, looks)
+    ? layerTurnaround(lead, input, bed, capBeats, capBeats, looks, sizing)
     : lead
 }
 
@@ -668,7 +761,7 @@ function rollForced(input: TurnaroundInput, force: TurnaroundForce): TurnaroundP
   const beats = Math.min(drawBeats(move, bed, capBeats, random), most)
   const lead = build(move, beats, 0, bed, loopBars, random, looks)
   return lead !== null && input.combine === true
-    ? layerTurnaround(lead, input, bed, capBeats, most, looks)
+    ? layerTurnaround(lead, input, bed, capBeats, most, looks, sizingOf(input))
     : lead
 }
 
@@ -1006,13 +1099,15 @@ function layerTurnaround(
   bed: Bed,
   capBeats: number,
   most: number,
-  looks: TurnaroundLooks
+  looks: TurnaroundLooks,
+  sizing: Sizing
 ): TurnaroundPlan | null {
   const sub = turnaroundLayerRandom(input.random())
   const depth = input.depth ?? DEFAULT_TURNAROUND_DEPTH
   const families = input.moves ?? TURNAROUND_FAMILIES
   const weights = TURNAROUND_WEIGHTS[input.arc]
-  const odds = TURNAROUND_LAYER_ODDS[depth]
+  // at `none` and `small`, at most two moves: the odds truncated, renormalised by the draw
+  const odds = TURNAROUND_LAYER_ODDS[depth].slice(0, sizing.maxMoves)
   const count = pickWeighted(
     odds.map((weight, i) => ({ item: i + 1, weight })),
     sub
@@ -1029,12 +1124,15 @@ function layerTurnaround(
     )
       .map((m) => ({
         item: m,
-        weight: parts.reduce((w, p) => w * TURNAROUND_AFFINITY[p.move][m], weights[m])
+        weight: parts.reduce(
+          (w, p) => w * TURNAROUND_AFFINITY[p.move][m],
+          m === 'riser' ? weights[m] * sizing.riserFactor : weights[m]
+        )
       }))
       .filter((o) => o.weight > 0)
     if (options.length === 0) break
     const move = pickWeighted(options, sub)
-    const beats = Math.min(drawBeats(move, bed, capBeats, sub), most)
+    const beats = Math.min(drawBeats(move, bed, capBeats, sub, sizing.riserCap), most)
     const one = build(move, beats, 0, bed, input.loopBars, sub, looks)
     if (one === null) break
     parts.push({ move, beats, rowIds: one.rows.map((r) => r.rowId) })
@@ -1044,7 +1142,8 @@ function layerTurnaround(
   let keeper: TurnaroundRow | null = null
   const riser = parts.find((p) => p.move === 'riser')
   if (riser !== undefined && riser.beats >= BEATS_PER_BAR && bed.audible.length >= 2) {
-    if (sub() < TURNAROUND_GAP_CHANCE) {
+    // a gap only where the size allows one and a large payoff can follow it (no draw otherwise)
+    if (sizing.gap && sub() < TURNAROUND_GAP_CHANCE) {
       gap = turnaroundGapBeats(riser.beats, depth)
       // a drop no longer than the gap would be swallowed by it: the next length past it, or no gap
       const longer = parts.map((p) => {
@@ -1062,7 +1161,8 @@ function layerTurnaround(
       if (sub() < TURNAROUND_GAP_KEEP_CHANCE) keeper = kept
     }
   }
-  const gapRows = bed.audible.filter((r) => r !== keeper).map((r) => r.id)
+  // a hook leaving on this wrap throws into the gap: its row is never one the gap silences
+  const gapRows = bed.audible.filter((r) => r !== keeper && r.exiting !== true).map((r) => r.id)
   const thrown = throwWashes(parts, gap, gapRows, Math.min(capBeats, most))
   // the lead alone, as a combined plan, when layering can't stand: a lead wash whose every row
   // is silent from where it starts, or (never in practice: every part fits the cap, which fits the
```

  d. `radioSchedule.ts` -- the setting, on by default on the desktop:

```diff
--- a/src/shared/radioSchedule.ts
+++ b/src/shared/radioSchedule.ts
@@ -1099,6 +1099,16 @@ export interface RadioSettings {
    * normalizeRadioSettings always sets it (migrating `pace` and a hand-tuned `paceBars`), and
    * absent reads as what `pace` / `paceBars` mean (radioPaceLevelOf). */
   paceLevel?: number
+  /** Build-ups sized to the change, and every turnaround paid off (@shared/radioBuildSize; spec
+   * 2026-10-03-radio-anointed-stems-design section 4). Absent or false: today's gestures,
+   * turnarounds and arc timing exactly. normalizeRadioSettings sets it, on unless saved off; the
+   * web radio's WEB_RADIO_DEFAULTS sets it on. */
+  sizedBuilds?: boolean
+}
+
+/** Sized builds are on for these settings (radioBuildSize.ts). */
+export function radioSizedBuildsOf(settings: Pick<RadioSettings, 'sizedBuilds'>): boolean {
+  return settings.sizedBuilds === true
 }
 
 export function radioDensityOf(settings: RadioSettings): RadioDensity {
@@ -1126,7 +1136,8 @@ export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
   foldSeed: DEFAULT_FOLD_SEED,
   density: DEFAULT_RADIO_DENSITY,
   faves: DEFAULT_FAVES,
-  paceLevel: DEFAULT_RADIO_PACE_LEVEL
+  paceLevel: DEFAULT_RADIO_PACE_LEVEL,
+  sizedBuilds: true
 }
 
 /** The window the clock draws a change's interval from: radioCadenceOf's (fold mode's own, 8-32
@@ -1196,7 +1207,9 @@ export function normalizeRadioSettings(value: unknown, legacyPace?: unknown): Ra
     paceLevel:
       typeof raw.paceLevel === 'number' && Number.isFinite(raw.paceLevel)
         ? normalizeRadioPaceLevel(raw.paceLevel)
-        : radioPaceLevelFromLegacy(pace, raw.paceBars)
+        : radioPaceLevelFromLegacy(pace, raw.paceBars),
+    // Sized builds (2026-10-03, Elling: on for everyone): on unless saved off.
+    sizedBuilds: raw.sizedBuilds !== false
   }
 }
 
```

  and in `radioSchedule.test.ts`, the pinned default gains the field: in
  `'defaults to mid, the mid window, four bars, ...'`, after `paceLevel: 25` add
  `sizedBuilds: true` (with the comma on the line before).

  e. `radioDensity.ts` -- `advanceDensityLeg`'s `waits` (only these hunks; the `ArcRow` hunks are
  Task 6's):

```diff
@@ -87,6 +87,9 @@ export function advanceDensityLeg(
     canAdd: boolean
     canRemove: boolean
     random?: () => number
+    /** Sized builds (radioBuildSize's radioArcStepWaits): a step that is ready waits for a phrase
+     * start -- its bars keep counting, nothing turns. Absent: today. */
+    waits?: boolean
   }
 ): { leg: DensityLeg; step: 'add' | 'remove' | null } {
   const bars = leg.bars + (input.loopBars > 0 ? input.loopBars : 0)
@@ -98,9 +101,11 @@ export function advanceDensityLeg(
   })
   if (leg.phase === 'growing') {
     if (input.count >= leg.target || !input.canAdd) return turn()
+    if (input.waits === true) return { leg: counted, step: null }
     return { leg: { ...counted, bars: 0 }, step: 'add' }
   }
   if (input.count <= leg.target || !input.canRemove) return turn()
+  if (input.waits === true) return { leg: counted, step: null }
   return { leg: { ...counted, bars: 0 }, step: 'remove' }
 }
```

- [ ] **Step 4: Run, and the whole shared suite.**
  - Run: `npx vitest run src/shared/radioBuildSizeDraws.test.ts` — Expected: 12 passed.
  - Run: `npx vitest run src/shared` — Expected: all green (the two pinned tests above were
    updated in Step 3).

- [ ] **Step 5: The web is untouched.** In `/Users/nickel/Claudecode/ell.ing/radio`:
  `npm run typecheck` and `npx vitest run src` — Expected: green, nothing changed (nothing passes
  the new arguments yet; `WEB_RADIO_DEFAULTS` has no `sizedBuilds`).

- [ ] **Step 6: Lint, typecheck, commit** (sssketch).
  - Run: `npx eslint` on the seven files, `npm run typecheck`.
  - Commit the eight files only. Message: `radio sized builds: the sized draws -- pickTransition(…, sizing) reweights the riser by the build size (0 at none/small, today's at medium, x2 at large) and drops filter in and bloom from a hook's return, one draw as ever; radioGestureBeats' size (a riser before anything under large is 4 beats); drawManualTransitions rows carry size/hookReturn to pick; rollTurnaround's size (none/small: riser x0.15, at most 4 beats, at most two moves, no gap; medium: no gap; large: fires at any rate but off, riser x2, the gap as today) and payoff (a gap only when a large payoff can follow), TurnaroundRow.exiting (never dropped, stopped or gapped; the wash's row); advanceDensityLeg waits; RadioSettings.sizedBuilds (normalize: on unless saved off). Absent, draw for draw today: fingerprints d5e51d0c (pickTransition) and b5136502 (rollTurnaround) recorded from 78be6e5`, then the trailer.

### Task 3: Web radio: sized builds and paid-off turnarounds

**Repo:** ell.ing/radio. **Depends on:** Task 2. **Parallel with:** Task 4.

**Files:** `src/radio/settings.ts`, `settings.test.ts`, `step.ts`, `step.test.ts`,
`density.test.ts`, `controller.test.ts` (and any other test that pins default behaviour; see
Step 1).

**What changes, in order of the tick (`tick`, step.ts:822):**
1. the settings default (on);
2. the build clock and the landings window (bookkeeping at each wrap);
3. spare picks, armed at each phrase start;
4. the arc's steps wait for a phrase start;
5. the phrase end's roll: forecast, skip / size / payoff, then the payoff assembled;
6. the turn's payoff;
7. the per-change draws, sized.

- [ ] **Step 1: Pin today's tests to `sizedBuilds: false`, by intent.**
  - `step.test.ts` `RULES` (:27): add `sizedBuilds: false`. Every rule test keeps its meaning (the
    rules one at a time).
  - `controller.test.ts` `RULES` (:18-:29): the same.
  - `density.test.ts` `radio()` (:26): `initialRadioState({ settings: { sizedBuilds: false, ...settings } })`
    -- its arc timings are today's (the phrase wait is tested in Step 2 instead).
  - Then run `npx vitest run src`, after Step 4's settings change (see Step 4 order note), and for
    every other failing test decide by intent: a test about something else that merely runs on
    the defaults gets `sizedBuilds: false`; a test that is ABOUT the defaults (settings.test.ts)
    gains the field. List each in the commit message.

- [ ] **Step 2: The failing tests** (`step.test.ts`, a new `describe('sized builds and the payoff')`,
  Sim with `{ sizedBuilds: true, turnarounds: 'often', transitions: 'bold', phraseBars: 16 }`, 4
  rows, density arc off unless said):
  - **byte-identity:** a Sim with `sizedBuilds: false` gives the same action log as HEAD's step.ts
    for 600 s at seeds 1-3 (the harness: copy HEAD's `step.ts` beside the new one as
    `step.head.ts`, run both Sims, `expect(JSON.stringify(log)).toBe(...)`; delete `step.head.ts`
    before committing -- or keep the comparison as a scratch test, as the fold-follows-pace plan's
    Task 4 did, and record the result in the commit message);
  - **every fired phrase-end turnaround is paid off:** over 900 s at seeds 1-5, for every
    `turnaround` action at time W, the `landed` actions at W number at least 2 (3 when
    `plan.gapBeats > 0`), or one of them is an arc add (`addRow` at W) or a removal at W;
  - **no payoff, no turnaround:** with every row muted but one (`mute` events), no `turnaround`
    action at a phrase end;
  - **the interval restarts from a pulled pick:** after a turnaround's wrap at which radio's own
    change landed early (`early` true on its `landAt`), `s.clock.barsElapsed` is 0 at the next
    tick past W and `intervalBars` was redrawn;
  - **no riser on a one-row change:** across 900 s, every `landAt` whose wrap has exactly one
    change and no turnaround has `transition.kind !== 'riser'`;
  - **arc steps on phrase starts:** with the density arc on, every `addRow` / `removeRow` time is
    a phrase start (the clock's `turnaroundLap` is 0 on the first tick after it);
  - **the turn brings a change:** `{ type: 'turn' }` then run past the top: at least 2 rows land
    there; with all rows but one muted, the turn still plays and its plan has no gap.
  - Run: `npx vitest run src/radio/step.test.ts` — Expected: the new tests FAIL (nothing sized
    yet); the byte-identity one passes trivially (nothing changed yet).

- [ ] **Step 3: State.** In `RadioState` (step.ts:362) add, with `initialRadioState` (:566) values:

```ts
  /** Sized builds (@shared/radioBuildSize): the build clock (bars since the last riser and the
   * last large turnaround landed) and row landings per lap over the last phrase (the hooks' calm,
   * Phase 2). Advanced at each wrap while running and not held. */
  builds: RadioBuildClock          // NO_RADIO_BUILDS
  landings: RadioLandingWindow     // NO_RADIO_LANDINGS -- from Task 5; until then a local [0]
  /** Spare picks for a payoff (spec 4.7): at most two rows radio may change, picked and warmed at
   * each phrase start; used (as companions of radio's change) when a fired turnaround needs more
   * rows than are landing on its wrap. */
  spares: RadioPending[]           // []
```

  - `RadioLandingWindow` and its helpers arrive with Task 5 (`radioHooks.ts`). If Task 5 is not in
    yet, keep `landings` out of this task and add it in Task 7.
  - `stop` (:2081): `s.spares = []`, `s.builds = NO_RADIO_BUILDS`.
  - `draft` (:2643): copy `spares` (`s.spares.map((k) => ({ ...k }))`), as `pending` is.

- [ ] **Step 4: The default.** `settings.ts` `WEB_RADIO_DEFAULTS` gains `sizedBuilds: true` (comment:
  `// Elling, 2026-10-03: on for everyone (spec anointed-stems Decided 3)`), and
  `settings.test.ts`'s pinned object gains it. (Do this before running Step 1's sweep.)

- [ ] **Step 5: Bookkeeping at the wrap.** In `tick`, inside `if (adv.wrapped) { ... }` (:866-875),
  after `driftAtWrap` and before `densityAtWrap`:

```ts
    if (radioSizedBuildsOf(s.settings) && !s.held) {
      s.builds = advanceRadioBuildClock(s.builds, loopBars)
      // the turnaround that just played: a riser in it is a build; a large one, noted as large
      // (s.turnaround was cleared above once its wrap passed: keep the plan as `lastPlayed`
      // there -- see Step 8)
    }
```

  and note a riser landing: in `land` (:1009), when `led.kind === 'riser'` and sized, and in the
  turnaround-cleared branch at the top of `tick` (`if (s.turnaround && now >= s.turnaround.at - EPS)`),
  when `radioPlanIsBuild(s.turnaround.plan)`: `s.builds = noteRadioBuild(s.builds, s.turnaround.large === true)`.
  `RadioTurnaround` gains `large?: true` (set in Step 7 when the roll's size was `large`).

- [ ] **Step 6: Spares, at each phrase start.** A new `sparesAtPhraseStart(c, t)` called in the wrap
  block right after `foldAtWrap` (so it sees this wrap's landings and fold), only when
  `radioSizedBuildsOf(s.settings) && !s.held && (s.clock?.turnaroundLap ?? 0) === 0`, the rate is
  not `off`, and `s.spares.length < 2`:
  - drop spares whose row is gone, whose record now plays on any row, or whose row has a manual
    entry, is radio's pending/led row or one of their companions;
  - pick the missing rows with `pickRadioSlotIds(pool, s.lastSlot, 2 - s.spares.length, opts)`,
    `pool` = eligible rows (`eligible`) not pending/led/companion/manual/removing/spare, with the
    same `opts` as `arm` (:1784);
  - for each: `const k = { slot, token: ++s.token, record: null }`, push to `s.spares`, and
    `pushArm(c, slot, k.token)`.
  - `picked` (:1831): a token matching a spare sets its `record` (a null record drops the spare).
  - `wants` (:1884): each spare's record at `s.bpm`, `'background'`, after the companions.

- [ ] **Step 7: The phrase end's roll.** Replace the body of `rollTurnaroundAt` (:1190) after its
  early returns (keep them: the turn takes the phrase end, held, wrong wrap, lead-in) with:

```ts
  const sized = radioSizedBuildsOf(s.settings)
  const base = turnaroundInputOf(s, t.loopBars, leavingAt(s, at))
  const rate = radioFoldTurnaroundRate(s.settings.turnarounds, s.settings.foldMode && s.foldNext?.marked === true)
  if (!sized) {
    // today, exactly
    const plan = rollTurnaround({ rate, random: c.rnd, lastPhrase: s.lastTurnaround, ...base })
    s.lastTurnaround = rememberTurnaround(plan)
    if (!plan) return
    s.turnaround = { at, plan }
    c.out.push({ type: 'turnaround', time: at, plan })
    return
  }
  const f = forecastAt(s, t, at)
  const spare = payoffSpares(s, t, at)
  const phraseBars = turnaroundPhraseLaps(radioCadenceOf(s.settings).turnaroundPhraseBars, t.loopBars) * t.loopBars
  const toWrapBars = t.loopBars - t.pos
  const build = radioPhraseEndBuild(f, spare.length, {
    hookScale: radioHookPaceScale(radioPaceLevelOf(s.settings)),
    clock: s.builds,
    aheadBars: toWrapBars,
    phraseBars
  })
  if (build.skip) {
    s.lastTurnaround = null
    c.out.push({ type: 'log', message: '[radio-build] no payoff: no turnaround at this phrase end' })
    return
  }
  const plan = rollTurnaround({
    rate,
    random: c.rnd,
    lastPhrase: s.lastTurnaround,
    ...base,
    arc: radioBuildArc(f, base.arc),
    size: build.size,
    payoff: build.payoff
  })
  s.lastTurnaround = rememberTurnaround(plan)
  if (!plan) return
  assemblePayoff(c, t, at, f, spare, radioTurnaroundPayoffNeed(plan))
  s.turnaround = { at, plan, ...(build.size === 'large' && { large: true as const }) }
  c.out.push({ type: 'turnaround', time: at, plan })
```

  `radioHookPaceScale` is Task 5's; until it is in, pass `hookScale: 1` (no hook returns exist in
  Phase 1 anyway).

  - **`forecastAt(s, t, at): RadioChangeForecast`** (new, beside `leavingAt`):
    - `rows`:
      - radio's change: `s.led` landing at `at` (`led.at` within EPS of `at`, or `led.at === null`
        with no `atBars` and not cancelling: it schedules on the coming wrap) counts 1 plus its
        `companions` not withdrawn; else `s.pending` with a ready record (`isReady`), `eligible`,
        and `radioChangeDueAtNextWrap(s.clock, t.pos, t.loopBars, t.loopBars, radioCadenceOf(s.settings).phraseBars)`
        counts 1 plus its companions with ready records;
      - plus each `s.manual` entry with `at` within EPS of `at`, or `mode !== 'bar'` and a ready
        record and `at === null` (it will take this top);
      - plus 1 for `s.adding` with a ready record (it schedules here: `densityTick`).
    - `arcStep`: `'add'` for that `s.adding`; `'remove'` when `leavingAt(s, at) !== null` or
      `s.removing` with `at === null` (it takes the coming wrap).
    - `lowEndReturn`: the adding row's kinds include `drums` or `bass`.
    - `hookReturn`: null (Task 7 fills it). `course`: false (the web has none).
  - **`payoffSpares(s, t, at): string[]`** (new): the rows that could be added at `at`, in order:
    1. `s.pending.slot` when radio's change is not already in the forecast, its record is ready,
       `eligible`, and `comingWrapOnPhrase(s, t)` (the change phrase allows this wrap);
    2. its companions with ready records and eligible rows;
    3. each spare with a ready record whose row is eligible, has no manual entry, is not
       `s.removing`'s, and is not already counted.
  - **`assemblePayoff(c, t, at, f, spare, need)`** (new): `n = radioPayoffShortfall(f, need)`; take
    the first `n` of `spare`:
    - radio's pending: `decide(c, p.slot, p.record, true, kind, undefined, ridingCompanions)` --
      an EARLY decision, so `land` restarts the interval from it (:1029); `kind` =
      `pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd, { size: build size of the
      assembled change })`; `scheduleLed` (called later in this tick) then puts it on `at`, where
      `underTurnaround` keeps only its arrival;
    - each further row (a companion, a spare): pushed to the new `s.led.companions` as
      `{ slot, record, sent: false, accepted: false, ...(foldCarries(s, slot, record) && { carry: true }) }`;
      a used spare leaves `s.spares`;
    - with no radio pick among them, the first spare is radio's change (`decide` with it, early).
    - If `s.led` is already landing at `at`, the extra rows join its `companions` (not yet sent,
      `sendCompanions` sends them when the change is accepted; if it was already accepted, call
      `sendCompanions(c, s.led)` again: it sends only the unsent).
    - Log `[radio-build] payoff +n` with the rows.
  - **Oversold:** at the turnaround's wrap (the clear branch in `tick`), count the rows that
    landed at it (the `landed` actions this tick at that time); fewer than the need: log
    `[radio-build] oversold`.

- [ ] **Step 8: The turn's payoff.** In `turnAt` (:1306), when sized: compute `f`, `spare` as above
  and pass `payoff: radioPayoffOf(radioForecastWithRows(f, spare.length))` to its forced roll (a
  gap only with a large payoff). After the plan is armed, `assemblePayoff(c, t, at, f, spare,
  radioTurnaroundPayoffNeed(plan))`. A turn with no payoff possible plays anyway, gapless (planning
  decision 1; to make it `nothing to turn` instead, return as `!plan` does when `spare` and `f`
  cannot meet `medium`).

- [ ] **Step 9: Arc steps on phrase starts.** `densityAtWrap(c, loopBars)` (:1597) gains a
  `lapStarts: boolean` argument (the call at :872 passes `adv.turnaroundLapStarts`). Before
  `if (count < d.target) startAdd(c)`:

```ts
  const phraseBars = turnaroundPhraseLaps(radioCadenceOf(s.settings).turnaroundPhraseBars, loopBars) * loopBars
  if (
    radioArcStepWaits({
      sized: radioSizedBuildsOf(s.settings),
      decidesForPhraseStart: lapStarts,
      overdueBars: d.bars - d.stepBars,
      phraseBars
    })
  ) return
```

  (after the `count === d.target` turn: a turn never waits). `densityTick` already schedules a
  started step on the coming wrap, which is then the phrase start.

- [ ] **Step 10: Sized per-change draws.** At both `pickTransition` calls in `tick` (:944 early
  decision, :974 due branch), when sized pass the fourth argument
  `{ size: radioBuildSize(forecastOfDecision(s, t, p), { hookScale, clock: s.builds, aheadBars, phraseBars }) }`,
  where `forecastOfDecision` is `forecastAt` for the wrap the change lands on with the change itself
  counted (rows at least 1 + its riding companions) and `aheadBars` the bars to that wrap (the next
  one; for the due branch, the one after). `decide` (:1043) passes the same size to
  `radioGestureBeats(kind, …, size)`: carry it as an optional `size` argument of `decide`. A
  mid-loop decision (`atBars` set) is a cut: unchanged.

- [ ] **Step 11: Run, harness, typecheck, commit.**
  - Run: `npx vitest run src` and `npm run typecheck`.
  - Byte-identity (Step 2's harness) at `sizedBuilds: false`: identical to HEAD at no level, 25,
    50, 60 and 95, fold off and on at bend 40 and 100, the density arc on, 600 s, seeds 1-3, holds,
    Next, swap-nows, mutes. Record "identical" (or the first difference) in the message.
  - Measure and record (sized on, defaults otherwise, 4 seeds × 900 s): risers per minute before
    and after; turnarounds per phrase end; rows landing per fired turnaround (mean, min).
  - Commit the task's files. Message: `radio: sized builds on (spec anointed-stems Decision 5-6) -- every fired phrase-end turnaround is paid off (forecast of its wrap, radioPhraseEndBuild: skip with no payoff, rolled at its size raised to medium, a gap only with a large payoff; then the payoff assembled: radio's armed pick pulled forward as an early decision -- the interval restarts from it -- its companions, then spare picks armed at each phrase start); a turn brings one too (a fill without a gap when nothing can change); per-change gestures sized (no riser before a one-row swap, a short one before two rows); the build clock (budget); arc steps wait for a phrase start. Tests pinned to sizedBuilds:false by intent: <list>. Byte-identical with it off: <result>. Measured: <numbers>`, then the trailer.

### Task 4: Desktop: sized builds and paid-off turnarounds

**Repo:** sssketch. **File:** `src/renderer/src/components/DiscoverPanel.tsx`.
**Depends on:** Task 2. **Parallel with:** Task 3.

The desktop's settings are normalized, so `radioSettings.sizedBuilds` is already `true` for
everyone after Task 2 (and nothing reads it yet). Gate every change below on
`radioSizedBuildsOf(radioSettings)`.

- [ ] **Step 1: Refs.** Beside `radioTurnaroundMemoryRef`:

```ts
  /** Sized builds (@shared/radioBuildSize): bars since the last riser / large turnaround landed. */
  const radioBuildClockRef = useRef<RadioBuildClock>(NO_RADIO_BUILDS)
  /** Spare picks for a payoff (spec 4.7): at most two, picked and warmed at each phrase start. */
  const radioSparesRef = useRef<{ slotId: string; pick: SlotPick; stem: ResolvedCandidateStem | null }[]>([])
  /** The turnaround armed for this lap was rolled at `large` (for the build clock). */
  const radioTurnaroundLargeRef = useRef(false)
```

  Reset all three in the radio-off path that resets `radioTurnaroundMemoryRef` (stopRadio).

- [ ] **Step 2: The build clock.** In the clock effect, where `step.wrapped` (the block at
  :5163-5169 that advances `radioPlayRef`): `radioBuildClockRef.current =
  advanceRadioBuildClock(radioBuildClockRef.current, loopBars)` when sized. In
  `radioTurnaroundAtWrap` (:3408), before `radioTurnaroundRef.current = null`: when the armed plan
  played (`radioTurnaroundRef.current !== null`) and `radioPlanIsBuild(plan)`, note it with
  `radioTurnaroundLargeRef.current`. A per-change riser lands where the due branch clears a fired
  leading gesture (the wrap landing, "A leading gesture is cleared in the same tick"): note it
  there when its kind is `riser`.

- [ ] **Step 3: Spares at each phrase start.** In `radioTurnaroundAtWrap`, when sized and the new
  lap is a phrase start (`radioClockRef.current?.turnaroundLap === 0`) and fewer than 2 spares:
  pick rows as `armRadioPick` does (:8221 `pickRadioSlotIds` over `radioEligibleSlotIds()` minus
  rows with a manual change, radio's pending row and its companions, the held change's rows and
  existing spares), then for each `void pickForSlot(id, slot.kinds, { avoidOwnStem: true })` →
  `resolveAndWarmPick(pick)` → store `{ slotId, pick, stem }`. Drop a spare whose row is gone or
  whose stem now plays on a row.

- [ ] **Step 4: The phrase end's roll.** In `rollRadioTurnaround` (:3504), the phrase end's own roll
  (:3540-3552) when sized:
  - `f` = `forecastNow(loopBars)` (new, beside `turnaroundInputNow`):
    - rows: radio's held change landing at the top (`radioLedChangeRef.current` with no `atBars`)
      plus its kept companions (`radioStagedCompanions`); else radio's pending pick warm
      (`radioPendingRef.current.stem !== null`) and due at the top
      (`radioChangeDueAtNextWrap(radioClockRef.current, pos, loopBars, gridBars, radioCadence.phraseBars)`)
      plus its warm companions; plus each ready `manualChangesRef` entry; course change:
      `radioCourseChangeRef.current !== null` → `course: true`;
    - `arcStep`: `'add'` when `arcAddingRef.current` names a row whose manual entry is ready;
      `'remove'` when `arcExitingRowNow() !== null`;
    - `lowEndReturn`: the arc's joining row's kinds include drums or bass;
    - `hookReturn`: null until Task 9.
  - `spare` = the pending pick (warm, eligible, not already in `f`), its warm companions, then
    warm spares on eligible rows.
  - `radioPhraseEndBuild(f, spare.length, { hookScale, clock: radioBuildClockRef.current,
    aheadBars: loopBars - pos, phraseBars })`; skip → `radioTurnaroundMemoryRef.current = null`,
    `console.log('[radio-build] no payoff')`, return.
  - Roll with `arc: radioBuildArc(f, input.arc)`, `size`, `payoff`. `radioTurnaroundLargeRef.current
    = build.size === 'large'`.
  - When it fires: assemble `radioPayoffShortfall(f, radioTurnaroundPayoffNeed(plan))` rows:
    - radio's pending pick pulled forward: set `radioPayoffRef.current = { rows: [...] }` (new ref)
      and let `stepRadioStage`'s early decision (stepRadioStage (2), :4420+) decide it on its next
      tick even when `radioChangeDueAtNextWrap` is false -- `early: true`, so the interval restarts
      at its landing (the existing rule on `radioLedChangeRef.early`); its gesture is gated
      `arrival` by the turnaround as today;
    - the other rows ride it as companions (`RadioHeldCompanion`s built from the pending
      companions and the spares' `{ slotId, pick, stem }`); used spares leave `radioSparesRef`.
  - With radio's pick unavailable, the first spare becomes the held change (the same early
    decision with the spare's pick).

- [ ] **Step 5: The turn.** In `radioTurnTick` (:3631) and the turn branch of `rollRadioTurnaround`
  (:3520-3536): pass `payoff` (as Task 3 Step 8), and assemble after `armRadioTurn` the same way.

- [ ] **Step 6: Arc steps on phrase starts.** In `densityAtWrap` (:8334), pass to
  `advanceDensityLeg` (:8345):

```ts
        waits: radioArcStepWaits({
          sized: radioSizedBuildsOf(radioSettings),
          decidesForPhraseStart: radioArcLapStartsRef.current,
          overdueBars: (densityLegRef.current?.bars ?? 0) + loopBars - (densityLegRef.current?.stepBars ?? 0),
          phraseBars
        })
```

  `radioArcLapStartsRef` is set from `step.turnaroundLapStarts` in the clock effect before
  `densityTick(step.wrapped, …)` (:5197); `phraseBars` = `turnaroundPhraseLaps(radioCadence.turnaroundPhraseBars, loopBars) * loopBars`.

- [ ] **Step 7: Sized per-change draws.** The three `pickTransition` sites -- the due branch
  (:4633), the manual queue's `pick` (:4862) and the early decision (:5772) -- pass the fourth
  argument when sized: `{ size }` from `radioBuildSize(forecastNow(loopBars) with this change
  counted, …)`; the manual queue's rows pass `size` (and Task 9's `hookReturn`) and its `pick`
  becomes `(kinds, row) => pickTransition(radioSettings.transitions, kinds, Math.random, row)`.
  Each matching `radioGestureBeats` call gets the size.

- [ ] **Step 8: Verify, commit.**
  - Run `npm run typecheck`, `npx eslint src/renderer/src/components/DiscoverPanel.tsx`,
    `npx vitest run src/shared`.
  - Say plainly in the commit that the panel glue has no tests (by convention) and no agent heard it.
  - Message: `discover radio: sized builds on (spec anointed-stems Decision 5-6) -- a fired phrase-end turnaround is paid off (forecastNow, radioPhraseEndBuild: skip with no payoff, rolled at its size raised to medium, a gap only with a large payoff; radio's pending pick pulled forward as an early decision, its companions, then spares warmed at each phrase start, riding as companions); turns too; the per-change palette sized at the due branch, the early decision and the manual queue; the build clock; arc steps wait for a phrase start. No panel tests (convention); unheard by any agent`, then the trailer.

**Ship point A.** Elling listens to plain radio on both (walkthrough items 8 and 8a, Task 16).

---

## Phase 2: hooks that leave and come back

### Task 5: The hook machine and its exit throw (`radioHooks.ts`, `radioThrows.ts`, `discoverThrows.ts`)

**Parallel-safe** with Tasks 1-4 and 12 (a new file and additive exports). **Depends on:** nothing.

**Files (`/Users/nickel/Claudecode/sssketch/src/shared/`):**
- Create: `radioHooks.ts`, `radioHooks.test.ts`, `radioHookThrows.test.ts`
- Modify: `radioThrows.ts`, `discoverThrows.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/shared/radioHooks.test.ts`:

```ts
// Hooks that leave and come back (spec 2026-10-03-radio-anointed-stems-design section 2).
import { describe, expect, it } from 'vitest'
import {
  HOOK_AWAY,
  HOOK_LONG_REST,
  HOOK_RETURNS_BEFORE_REST,
  HOOK_STAY,
  NO_RADIO_HOOKS,
  NO_RADIO_LANDINGS,
  RADIO_ROLE_WORDS_MAX,
  advanceRadioLandingWindow,
  bringRadioHookBack,
  drawRadioHookBars,
  forgetRadioHookOnManualChange,
  likeRadioStem,
  noteRadioLandings,
  pruneRadioHooks,
  radioHookBars,
  radioHookBarsToReturn,
  radioHookInRow,
  radioHookInRowNext,
  radioHookLine,
  radioHookOf,
  radioHookPaceScale,
  radioHookReservesRow,
  radioHookStemsAway,
  radioHookTurnoverExcluded,
  radioHooksMax,
  radioHooksStarted,
  radioHooksStopped,
  radioLandingsInPhrase,
  radioRoleWords,
  releaseRadioHook,
  stepRadioHooks,
  toggleRadioHookStem,
  withdrawRadioHookEvent,
  type RadioHookRowInput,
  type RadioHooksState,
  type RadioHooksStepInput,
  type RadioHooksStepResult
} from './radioHooks'
import { turnaroundPhraseLaps } from './radioTurnaround'
import { seededRandom } from './seededRandom'

const ROWS: RadioHookRowInput[] = [
  { id: 'd', stemId: 'd-1', kinds: ['drums'], eligible: true, lastLowHeard: true },
  { id: 'b', stemId: 'b-1', kinds: ['bass'], eligible: true, lastLowHeard: true },
  { id: 'l', stemId: 'l-1', kinds: ['lead'], eligible: true, lastLowHeard: false },
  { id: 'w', stemId: 'w-1', kinds: ['warm'], eligible: true, lastLowHeard: false }
]

/** A random that counts its draws. */
function counted(seed: string): { random: () => number; n: () => number } {
  const r = seededRandom(seed)
  let n = 0
  return {
    random: () => {
      n++
      return r()
    },
    n: () => n
  }
}

/** Hook rows by id, with the stems the rows play. */
function hooked(ids: string[], seed = 'set', paceLevel = 50): RadioHooksState {
  let s = NO_RADIO_HOOKS
  const random = seededRandom(seed)
  for (const id of ids) {
    const row = ROWS.find((r) => r.id === id)!
    s = toggleRadioHookStem(s, {
      rowId: id,
      stemId: row.stemId!,
      rowCount: 8,
      paceLevel,
      random
    }).state
  }
  return s
}

interface Wrap {
  k: number
  lap: number
  r: RadioHooksStepResult
}

/** Steps `wraps` loop tops of a `loopBars` loop (a 16-bar phrase), rows playing what the hooks
 * leave them (a substitute `x-k` on exit, the hooked stem on return). */
function run(
  state: RadioHooksState,
  wraps: number,
  o: Partial<RadioHooksStepInput> & { loopBars?: number; seed?: string } = {}
): { state: RadioHooksState; log: Wrap[] } {
  const loopBars = o.loopBars ?? 4
  const P = turnaroundPhraseLaps(16, loopBars)
  const random = o.random ?? seededRandom(o.seed ?? 'run')
  let rows = (o.rows ?? ROWS).map((r) => ({ ...r }))
  let lap = 0
  const log: Wrap[] = []
  for (let k = 1; k <= wraps; k++) {
    lap = (lap + 1) % P
    const r = stepRadioHooks(state, {
      loopBars,
      lap,
      phraseLaps: P,
      paceLevel: 50,
      held: false,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      ...o,
      rows,
      random
    })
    for (const a of r.applied) {
      const h = radioHookOf(r.state, a.rowId)!
      rows = rows.map((x) =>
        x.id === a.rowId ? { ...x, stemId: a.event === 'return' ? h.stemId : `${x.id}-x${k}` } : x
      )
    }
    state = r.state
    log.push({ k, lap, r })
  }
  return { state, log }
}

describe('lines', () => {
  it('exits on phrase starts and half lines, returns only on phrase starts, at every loop', () => {
    for (const loopBars of [1, 2, 3, 4, 5, 6, 8, 16, 32]) {
      const P = turnaroundPhraseLaps(16, loopBars)
      const lines: string[] = []
      for (let lap = 0; lap < P; lap++) lines.push(String(radioHookLine(lap, P)))
      // the wrap ending the last lap is the phrase start
      expect(lines[P - 1]).toBe('phrase')
      if (P % 2 === 0 && P > 1) expect(lines[P / 2 - 1]).toBe('half')
      expect(lines.filter((l) => l === 'phrase')).toHaveLength(1)
      // at the default 16 bars: every 8 bars on an 8-bar or shorter loop that halves the phrase
      if (loopBars <= 8 && 16 % loopBars === 0) {
        const every = lines
          .map((l, i) => (l !== 'null' ? (i + 1) * loopBars : null))
          .filter((x) => x !== null)
        expect(every).toEqual([8, 16])
      }
    }
  })
})

describe('lengths', () => {
  it('the pace scale at its knots', () => {
    expect(radioHookPaceScale(0)).toBeCloseTo(1.5)
    expect(radioHookPaceScale(25)).toBeCloseTo(1.25)
    expect(radioHookPaceScale(50)).toBeCloseTo(1)
    expect(radioHookPaceScale(70)).toBeCloseTo(0.75)
    expect(radioHookPaceScale(90)).toBeCloseTo(0.5)
    expect(radioHookPaceScale(100)).toBeCloseTo(0.5)
    for (let l = 1; l <= 100; l++)
      expect(radioHookPaceScale(l)).toBeLessThanOrEqual(radioHookPaceScale(l - 1))
  })

  it('the spec table: rounded to 8 (ties up), clamped 8-64', () => {
    const menu = (m: readonly { bars: number }[], scale: number): number[] =>
      m.map((x) => radioHookBars(x.bars, scale))
    expect(menu(HOOK_STAY, 1.5)).toEqual([24, 40, 48])
    expect(menu(HOOK_STAY, 1.25)).toEqual([24, 32, 40])
    expect(menu(HOOK_STAY, 1)).toEqual([16, 24, 32])
    expect(menu(HOOK_STAY, 0.75)).toEqual([16, 16, 24])
    expect(menu(HOOK_STAY, 0.5)).toEqual([8, 16, 16])
    expect(menu(HOOK_LONG_REST, 1.5)).toEqual([64, 64])
    expect(menu(HOOK_LONG_REST, 1)).toEqual([48, 64])
    expect(menu(HOOK_LONG_REST, 0.75)).toEqual([40, 48])
    expect(menu(HOOK_LONG_REST, 0.5)).toEqual([24, 32])
  })

  it('the menus draw by their weights (10k seeded)', () => {
    for (const menu of [HOOK_STAY, HOOK_AWAY]) {
      const random = seededRandom(`menu-${menu[0].weight}`)
      const n: Record<number, number> = {}
      for (let i = 0; i < 10000; i++) {
        const b = drawRadioHookBars(menu, 1, random)
        n[b] = (n[b] ?? 0) + 1
      }
      for (const m of menu) expect(n[m.bars] / 10000).toBeCloseTo(m.weight, 1)
    }
  })
})

describe('no hooks: nothing at all', () => {
  it('the same state, no draws, nothing out', () => {
    const c = counted('none')
    const r = stepRadioHooks(NO_RADIO_HOOKS, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: false,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 0,
      arcThinning: true,
      canRest: true,
      random: c.random
    })
    expect(r.state).toBe(NO_RADIO_HOOKS)
    expect(r.applied).toEqual([])
    expect(r.decided).toEqual([])
    expect(r.prepare).toEqual([])
    expect(c.n()).toBe(0)
  })
})

describe('the cycle', () => {
  it('exits only on a line, returns only on a phrase start, decided one wrap ahead', () => {
    const { log } = run(hooked(['l']), 400)
    let exits = 0
    let returns = 0
    for (const w of log) {
      for (const d of w.r.decided) {
        const line = radioHookLine(w.lap, 4)
        if (d.event === 'exit') {
          exits++
          expect(line).not.toBeNull()
        } else {
          returns++
          expect(line).toBe('phrase')
        }
      }
    }
    expect(exits).toBeGreaterThan(5)
    expect(returns).toBeGreaterThan(5)
    // every decision lands at the very next wrap
    for (let i = 0; i + 1 < log.length; i++) {
      for (const d of log[i].r.decided) {
        expect(log[i + 1].r.applied).toContainEqual({ rowId: d.rowId, event: d.event })
      }
    }
  })

  it('stays and absences are what was drawn, counted from the line', () => {
    const { log } = run(hooked(['l']), 400)
    let lastFlip: { k: number; event: string; target: number } | null = null
    for (const w of log) {
      for (const a of w.r.applied) {
        const h = radioHookOf(w.r.state, a.rowId)!
        if (lastFlip !== null) {
          const bars = (w.k - lastFlip.k) * 4
          // at least what was drawn; a return also waits for its phrase start (16 bars)
          expect(bars).toBeGreaterThanOrEqual(lastFlip.target)
          expect(bars).toBeLessThan(lastFlip.target + (lastFlip.event === 'exit' ? 16 : 8) + 1e-9)
        }
        lastFlip = { k: w.k, event: a.event, target: h.targetBars }
      }
    }
  })

  it('at most one hook away at a time, with three hooks', () => {
    const { log } = run(hooked(['d', 'l', 'w']), 1000)
    let maxOut = 0
    let exits = 0
    for (const w of log) {
      const out = w.r.state.hooks.filter((h) => h.state !== 'in').length
      maxOut = Math.max(maxOut, out)
      exits += w.r.decided.filter((d) => d.event === 'exit').length
    }
    expect(maxOut).toBe(1)
    expect(exits).toBeGreaterThan(10)
  })

  it('the hook with the most bars in goes first', () => {
    let s = hooked(['l', 'w'])
    s = {
      ...s,
      hooks: s.hooks.map((h) => ({ ...h, targetBars: 8, bars: h.rowId === 'w' ? 20 : 12 }))
    }
    const r = stepRadioHooks(s, {
      loopBars: 4,
      lap: 1,
      phraseLaps: 4,
      paceLevel: 50,
      held: false,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: seededRandom('most')
    })
    expect(r.decided.map((d) => d.rowId)).toEqual(['w'])
  })

  it('bass leaves dry; drums leave with an echo', () => {
    const { log } = run(hooked(['d', 'b']), 1000)
    const exits = log.flatMap((w) => w.r.decided.filter((d) => d.event === 'exit'))
    const bass = exits.filter((d) => d.rowId === 'b')
    const drums = exits.filter((d) => d.rowId === 'd')
    expect(bass.length).toBeGreaterThan(0)
    expect(drums.length).toBeGreaterThan(0)
    for (const d of bass) expect(d.event === 'exit' && d.throw).toBeNull()
    for (const d of drums) expect(d.event === 'exit' && d.throw !== null).toBe(true)
  })

  it('rests only while the arc thins and not on the last heard low row; its draw only then', () => {
    const lead = run(hooked(['l']), 1000, { arcThinning: true, canRest: true, seed: 'rest' })
    const rests = lead.log.flatMap((w) => w.r.decided).filter((d) => d.event === 'exit' && d.rest)
    expect(rests.length).toBeGreaterThan(0)
    const drums = run(hooked(['d']), 1000, { arcThinning: true, canRest: true, seed: 'rest' })
    expect(drums.log.flatMap((w) => w.r.decided).some((d) => d.event === 'exit' && d.rest)).toBe(
      false
    )
    // not thinning, or the runtime cannot rest: the same draws as never resting
    const plain = run(hooked(['l']), 300, { seed: 'same' })
    for (const o of [
      { arcThinning: false, canRest: true },
      { arcThinning: true, canRest: false }
    ]) {
      const other = run(hooked(['l']), 300, { ...o, seed: 'same' })
      expect(JSON.stringify(other.state)).toBe(JSON.stringify(plain.state))
    }
  })

  it('after HOOK_RETURNS_BEFORE_REST returns, a long rest, and the count starts again', () => {
    const { log } = run(hooked(['l']), 3000)
    const exits = log.flatMap((w) => w.r.decided).filter((d) => d.event === 'exit')
    expect(exits.length).toBeGreaterThan(2 * (HOOK_RETURNS_BEFORE_REST + 1))
    exits.forEach((d, i) => {
      const long = (i + 1) % (HOOK_RETURNS_BEFORE_REST + 1) === 0
      const menu = (long ? HOOK_LONG_REST : HOOK_AWAY).map((m) => radioHookBars(m.bars, 1))
      expect(menu).toContain(d.event === 'exit' && d.awayBars)
    })
  })

  it('held: the clock stops and nothing is decided; a decided event still lands', () => {
    let s = hooked(['l'])
    s = { ...s, hooks: s.hooks.map((h) => ({ ...h, bars: 100 })) }
    const c = counted('held')
    const r = stepRadioHooks(s, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: true,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: c.random
    })
    expect(r.state).toBe(s)
    expect(c.n()).toBe(0)
    const decided = {
      ...s,
      hooks: s.hooks.map((h) => ({
        ...h,
        decided: { event: 'exit' as const, rest: false, throw: null, awayBars: 16, longRest: false }
      }))
    }
    const landed = stepRadioHooks(decided, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: true,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: c.random
    })
    expect(landed.applied).toEqual([{ rowId: 'l', event: 'exit' }])
    expect(radioHookOf(landed.state, 'l')!.state).toBe('away')
  })

  it('not ready: no decision, tried at the next line', () => {
    const ready = run(hooked(['l']), 200, { seed: 'r' })
    const never = run(hooked(['l']), 200, { seed: 'r', ready: () => false })
    expect(ready.log.some((w) => w.r.decided.length > 0)).toBe(true)
    expect(never.log.some((w) => w.r.decided.length > 0)).toBe(false)
  })
})

describe('the return', () => {
  /** An away hook due at the next phrase start. */
  function dueBack(o: Partial<{ waited: boolean; broughtBack: boolean }> = {}): RadioHooksState {
    const s = hooked(['l'])
    return {
      ...s,
      hooks: s.hooks.map((h) => ({ ...h, state: 'away' as const, bars: 12, targetBars: 16, ...o }))
    }
  }
  const at = (
    s: RadioHooksState,
    o: Partial<RadioHooksStepInput>,
    seed: string
  ): { r: RadioHooksStepResult; draws: number } => {
    const c = counted(seed)
    const r = stepRadioHooks(s, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: false,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: c.random,
      ...o
    })
    return { r, draws: c.n() }
  }

  it('busy: back on time, only the stay drawn', () => {
    const { r, draws } = at(dueBack(), { changeAtNextWrap: true, calmLandings: 0 }, 'busy')
    expect(r.decided.map((d) => d.event)).toEqual(['return'])
    expect(draws).toBe(1)
  })

  it('calm: may wait one phrase, once', () => {
    let waits = 0
    let backs = 0
    for (let i = 0; i < 400; i++) {
      const { r, draws } = at(dueBack(), { calmLandings: 1 }, `calm-${i}`)
      if (r.decided.length === 0) {
        waits++
        expect(draws).toBe(1)
        const h = radioHookOf(r.state, 'l')!
        expect(h.waited).toBe(true)
        expect(h.targetBars).toBe(16 + 16)
      } else {
        backs++
        expect(draws).toBe(2)
      }
    }
    expect(waits / 400).toBeCloseTo(0.5, 1)
    expect(backs).toBeGreaterThan(0)
    // waited already: no wait draw
    expect(at(dueBack({ waited: true }), { calmLandings: 0 }, 'w').draws).toBe(1)
    // not calm: no wait draw
    expect(at(dueBack(), { calmLandings: 2 }, 'nc').draws).toBe(1)
  })

  it('brought back: the next phrase start, no wait', () => {
    const s = hooked(['l'])
    const away = {
      ...s,
      hooks: s.hooks.map((h) => ({ ...h, state: 'away' as const, bars: 4, targetBars: 32 }))
    }
    const back = bringRadioHookBack(away, 'l')
    const { r } = at(back, { calmLandings: 0 }, 'bb')
    expect(r.decided.map((d) => d.event)).toEqual(['return'])
    // not before a phrase start
    expect(at(back, { lap: 1 }, 'bb2').r.decided).toEqual([])
  })

  it('a return waits while its row is ineligible', () => {
    const rows = ROWS.map((r) => (r.id === 'l' ? { ...r, eligible: false } : r))
    expect(at(dueBack(), { rows, changeAtNextWrap: true }, 'inel').r.decided).toEqual([])
  })
})

describe('taps and other hands', () => {
  const set = (s: RadioHooksState, id: string, rowCount = 8): RadioHooksState =>
    toggleRadioHookStem(s, {
      rowId: id,
      stemId: ROWS.find((r) => r.id === id)!.stemId!,
      rowCount,
      paceLevel: 50,
      random: seededRandom(id)
    }).state

  it('the toggle hooks the playing stem, then releases it', () => {
    const on = set(NO_RADIO_HOOKS, 'l')
    expect(radioHookInRow(on, 'l')).toBe(true)
    expect(radioHookOf(on, 'l')!.stemId).toBe('l-1')
    expect(radioHookOf(set(on, 'l'), 'l')).toBeNull()
  })

  it('the cap: half the rows, oldest released first, one that is in before one that is away', () => {
    expect(radioHooksMax(1)).toBe(1)
    expect(radioHooksMax(4)).toBe(2)
    expect(radioHooksMax(5)).toBe(2)
    expect(radioHooksMax(8)).toBe(4)
    let s = set(set(NO_RADIO_HOOKS, 'd', 4), 'b', 4)
    s = set(s, 'l', 4)
    expect(s.hooks.map((h) => h.rowId)).toEqual(['b', 'l'])
    // the oldest is away: the oldest IN goes
    s = {
      ...s,
      hooks: s.hooks.map((h) => (h.rowId === 'b' ? { ...h, state: 'away' as const } : h))
    }
    s = set(s, 'w', 4)
    expect(s.hooks.map((h) => h.rowId)).toEqual(['b', 'w'])
  })

  it('👍 hooks and never un-hooks; on an away hook it does nothing', () => {
    const like = (s: RadioHooksState, canHold = true): RadioHooksState =>
      likeRadioStem(s, {
        rowId: 'l',
        stemId: 'l-9',
        rowCount: 8,
        paceLevel: 50,
        random: seededRandom('x'),
        canHold
      }).state
    const on = like(NO_RADIO_HOOKS)
    expect(radioHookOf(on, 'l')!.stemId).toBe('l-9')
    expect(like(on)).toBe(on)
    expect(like(NO_RADIO_HOOKS, false)).toBe(NO_RADIO_HOOKS)
    const away = { ...on, hooks: on.hooks.map((h) => ({ ...h, state: 'away' as const })) }
    expect(like(away)).toBe(away)
  })

  it('a manual change clears a hook in; an away hook stays', () => {
    const on = set(NO_RADIO_HOOKS, 'l')
    expect(radioHookOf(forgetRadioHookOnManualChange(on, 'l'), 'l')).toBeNull()
    const away = { ...on, hooks: on.hooks.map((h) => ({ ...h, state: 'away' as const })) }
    expect(forgetRadioHookOnManualChange(away, 'l')).toBe(away)
  })

  it('release, withdraw, prune, stop and start', () => {
    const on = set(set(NO_RADIO_HOOKS, 'l'), 'w')
    expect(releaseRadioHook(on, 'l').released!.rowId).toBe('l')
    expect(pruneRadioHooks(on, new Set(['l', 'w']))).toBe(on)
    expect(pruneRadioHooks(on, new Set(['w'])).hooks.map((h) => h.rowId)).toEqual(['w'])
    const decided = {
      ...on,
      hooks: on.hooks.map((h) =>
        h.rowId === 'l'
          ? {
              ...h,
              decided: {
                event: 'exit' as const,
                rest: false,
                throw: null,
                awayBars: 16,
                longRest: false
              }
            }
          : { ...h, state: 'away' as const }
      )
    }
    expect(radioHookOf(withdrawRadioHookEvent(decided, 'l'), 'l')!.decided).toBeNull()
    const stopped = radioHooksStopped(decided)
    expect(stopped.hooks.map((h) => [h.rowId, h.state, h.decided])).toEqual([['l', 'in', null]])
    const c = counted('start')
    const started = radioHooksStarted(stopped, { paceLevel: 50, random: c.random })
    expect(c.n()).toBe(1)
    expect(radioHookOf(started, 'l')!.bars).toBe(0)
  })

  it('who holds what: in, in next, reserved, turnover, stems away', () => {
    const on = set(NO_RADIO_HOOKS, 'l')
    const h = radioHookOf(on, 'l')!
    const exitDecided = {
      ...on,
      hooks: [
        {
          ...h,
          decided: {
            event: 'exit' as const,
            rest: false,
            throw: null,
            awayBars: 16,
            longRest: false
          }
        }
      ]
    }
    expect(radioHookInRow(exitDecided, 'l')).toBe(true)
    expect(radioHookInRowNext(exitDecided, 'l')).toBe(false)
    const away = { ...on, hooks: [{ ...h, state: 'away' as const }] }
    expect(radioHookInRow(away, 'l')).toBe(false)
    expect(radioHookReservesRow(away, 'l')).toBe(true)
    expect(radioHookTurnoverExcluded(away, 'l')).toBe(false)
    expect(
      radioHookTurnoverExcluded({ ...away, hooks: [{ ...away.hooks[0], prepared: true }] }, 'l')
    ).toBe(true)
    expect(radioHookStemsAway(away)).toEqual(['l-1'])
    const back = {
      ...on,
      hooks: [
        {
          ...h,
          state: 'away' as const,
          decided: { event: 'return' as const, stayBars: 16, awayBars: 16 }
        }
      ]
    }
    expect(radioHookInRowNext(back, 'l')).toBe(true)
    expect(radioHookTurnoverExcluded(on, 'l')).toBe(true)
  })
})

describe('calm', () => {
  it('counts landings over the last phrase of laps', () => {
    let w = NO_RADIO_LANDINGS
    w = noteRadioLandings(w, 1)
    for (let i = 0; i < 3; i++) w = advanceRadioLandingWindow(w, 4)
    w = noteRadioLandings(w, 2)
    expect(radioLandingsInPhrase(w)).toBe(3)
    w = advanceRadioLandingWindow(w, 4)
    expect(radioLandingsInPhrase(w)).toBe(2)
  })
})

describe('words', () => {
  it('every role text fits the phone, and the short forms', () => {
    for (const state of ['in', 'away', 'resting'] as const)
      for (const decided of [null, 'exit', 'return'] as const)
        for (const barsToReturn of [null, 1, 16, 64])
          for (const dig of [false, true])
            for (const narrow of [false, true]) {
              const w = radioRoleWords({ hook: { state, decided, barsToReturn }, dig, narrow })!
              expect(w.length).toBeLessThanOrEqual(RADIO_ROLE_WORDS_MAX)
              expect(w).toBe(w.toLowerCase())
            }
    expect(
      radioRoleWords({ hook: { state: 'away', decided: null, barsToReturn: 16 }, dig: false })
    ).toBe('hook · back in 16 bars')
    expect(
      radioRoleWords({
        hook: { state: 'away', decided: null, barsToReturn: 16 },
        dig: false,
        narrow: true
      })
    ).toBe('back in 16')
    expect(
      radioRoleWords({ hook: { state: 'in', decided: null, barsToReturn: null }, dig: true })
    ).toBe('hook · dig')
    expect(radioRoleWords({ hook: null, dig: true })).toBe('dig')
    expect(radioRoleWords({ hook: null, dig: false })).toBeNull()
  })

  it('bars to the planned return: the first phrase start its target reaches', () => {
    const h = { state: 'away' as const, bars: 0, targetBars: 16 }
    // lap 0 of a 4-lap phrase, at bar 1: 3 bars, then 3 more laps
    expect(radioHookBarsToReturn(h, { lap: 0, phraseLaps: 4, loopBars: 4, pos: 1 })).toBe(15)
    expect(
      radioHookBarsToReturn(
        { ...h, targetBars: 20 },
        { lap: 0, phraseLaps: 4, loopBars: 4, pos: 0 }
      )
    ).toBe(32)
    expect(
      radioHookBarsToReturn({ ...h, state: 'in' }, { lap: 0, phraseLaps: 4, loopBars: 4, pos: 0 })
    ).toBeNull()
  })
})
```

  and `src/shared/radioHookThrows.test.ts`:

```ts
// A hook's exit throw (spec 2026-10-03-radio-anointed-stems-design 2.5): it ENDS on its line, and
// counts on the regular throw clock without drawing anything.
import { describe, expect, it } from 'vitest'
import {
  initialThrowState,
  noteRadioExitThrow,
  radioThrowEndingAt,
  radioThrowEndingAtTop,
  stepThrows,
  throwDelaySec,
  throwTailSec,
  type ThrowTick
} from './radioThrows'
import { seededRandom } from './seededRandom'
import { armDiscoverExitThrow, initialDiscoverThrowState } from './discoverThrows'

describe('the exit throw', () => {
  it('ends on its line', () => {
    const p = radioThrowEndingAt('d', { beats: 2, timing: 'quarter', feedback: 0.5 }, 40, 120)
    expect(p).toEqual({ slot: 'd', at: 39, beats: 2, timing: 'quarter', feedback: 0.5 })
    expect(p.at + (p.beats * 60) / 120).toBe(40)
    expect(radioThrowEndingAtTop({ beats: 1 }, 4)).toEqual({ atBar: 3.75, beats: 1 })
    expect(radioThrowEndingAtTop({ beats: 2 }, 0)).toBeNull()
  })

  it('holds the next regular throw off until its echoes are gone, and draws nothing', () => {
    const bpm = 120
    const tick = (now: number): ThrowTick => ({
      now,
      bpm,
      nextBeat: Math.ceil(now * 2 + 1e-9) / 2,
      held: false,
      leadingArmed: false,
      rows: [{ slot: 'l', kinds: ['lead'], audible: true }]
    })
    // a clock overdue for a throw
    const random = seededRandom('t')
    let s = stepThrows(initialThrowState(), tick(0), random).state
    s = { ...s, barsUntil: -10 }
    const tail = throwTailSec(throwDelaySec(bpm, 'quarter'), 0.6)
    let n = 0
    const counting = (): number => {
      n++
      return random()
    }
    const noted = noteRadioExitThrow(s, 10, tail)
    expect(n).toBe(0)
    expect(noted.barsUntil).toBe(s.barsUntil)
    expect(noted.barsSince).toBe(0)
    // nothing while the exit's echoes ring
    expect(stepThrows(noted, tick(9), counting).plan).toBeNull()
    expect(stepThrows(noted, tick(10 + tail - 0.6), counting).plan).toBeNull()
    // never earlier than a busier clock
    expect(noteRadioExitThrow({ ...s, busyUntil: 99 }, 10, tail).busyUntil).toBe(99)
  })
})

describe('the desktop exit throw (armDiscoverExitThrow)', () => {
  it('ends on the coming top, counts on the clock, and goes dry when it cannot', () => {
    const s0 = {
      ...initialDiscoverThrowState(),
      elapsedBars: 10,
      elapsedSec: 20,
      lastPos: 0.1,
      lastLoopBars: 4
    }
    const shape = { beats: 2, timing: 'quarter' as const, feedback: 0.5 }
    const s = armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 0.1, loopBars: 4, bpm: 120 })!
    expect(s.armed).toMatchObject({ slotId: 'd', atBar: 3.5, beats: 2, aimed: true })
    expect(s.armed!.endBars - s.armed!.startBars).toBe(0.5)
    // ends on the top: 3.9 bars from 0.1, at 2 s a bar
    expect(s.throws.busyUntil).toBeCloseTo(
      20 + 3.9 * 2 + throwTailSec(throwDelaySec(120, 'quarter'), 0.5)
    )
    expect(s.throws.barsSince).toBe(0)
    // late in the lap, or on a 1-bar loop: dry
    expect(
      armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 3, loopBars: 4, bpm: 120 })
    ).toBeNull()
    expect(
      armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 0, loopBars: 1, bpm: 120 })
    ).toBeNull()
    // something armed already: dry
    expect(
      armDiscoverExitThrow(s, { slotId: 'd', shape, pos: 0.1, loopBars: 4, bpm: 120 })
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail.**
  - Run: `npx vitest run src/shared/radioHooks.test.ts src/shared/radioHookThrows.test.ts`
  - Expected: FAIL, `./radioHooks` does not resolve; `radioThrowEndingAt`,
    `radioThrowEndingAtTop`, `noteRadioExitThrow` and `armDiscoverExitThrow` are not exported.

- [ ] **Step 3: Implement.**

  a. Create `src/shared/radioHooks.ts`:

```ts
// src/shared/radioHooks.ts
//
// HOOKS THAT LEAVE AND COME BACK (docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md
// section 2). A hook is a STEM on its home row: it stays 16-32 bars, leaves on a line with an echo
// throw (bass dry), is away 16-32 bars while its row plays a substitute radio picks, and comes
// back on a phrase start -- preferring one where something else changes, so the return is the
// drop. One hook away at a time; after HOOK_RETURNS_BEFORE_REST returns it rests longer. Every
// length scales with the pace slider (radioHookPaceScale).
//
// Successor to radioSlotFlags' `hook` (a row flag that only divided the row's draw weight). Not
// persisted: a hook names a stem on a row of this session.
//
// Pure and seeded. The runtime runs stepRadioHooks once per loop top, BEFORE the fold step and the
// turnaround roll (spec section 10, risk 1), and lands what it decided a lap later, through its
// manual-change path, marked as the hook's (never clearing a hook or a replace-soon).
//
// No hooks: no draws, and the same state object back.

import type { DiscoverSlotKind } from './discoverSlotKind'
import { drawThrowBeats, drawThrowEcho, type ThrowTiming } from './radioThrows'

export type RadioHookState = 'in' | 'away' | 'resting'

/** An exit's echo throw (radioThrows' drawThrowBeats + drawThrowEcho, in that order). */
export interface RadioHookThrow {
  beats: number
  timing: ThrowTiming
  feedback: number
}

/** An event decided at a wrap, landing on the NEXT wrap (its line), binding once decided. */
export type RadioHookDecided =
  | {
      event: 'exit'
      /** The row goes silent (it rests) instead of taking a substitute. */
      rest: boolean
      /** Null: a dry exit (a bass row). */
      throw: RadioHookThrow | null
      /** The absence drawn for it, in bars. */
      awayBars: number
      /** The absence is the long rest (HOOK_LONG_REST): its return does not count. */
      longRest: boolean
    }
  | {
      event: 'return'
      /** The stay drawn for it, in bars. */
      stayBars: number
      /** Bars it will have been away at the line. */
      awayBars: number
    }

export interface RadioHook {
  rowId: string
  /** The hooked stem (the row plays it while `in`). */
  stemId: string
  state: RadioHookState
  /** Bars played in the current state, counted lap by lap at each wrap. */
  bars: number
  /** The state's drawn length; the event is due at the first line where `bars` reaches it. */
  targetBars: number
  /** Returns since it was set, or since its last long rest. */
  returns: number
  /** Away on its long rest: its return does not count toward the next one. */
  longRest: boolean
  /** It has waited one phrase this absence (the calm wait). */
  waited: boolean
  /** Tapped back: no calm wait this absence. */
  broughtBack: boolean
  /** The runtime was asked to arm or warm for the next event (`prepare`): once per state. */
  prepared: boolean
  /** The event decided for the next line, or null. */
  decided: RadioHookDecided | null
  /** Order of setting, for the cap's oldest-first release. */
  setSeq: number
}

export interface RadioHooksState {
  hooks: readonly RadioHook[]
  /** The next setSeq. */
  seq: number
}

export const NO_RADIO_HOOKS: RadioHooksState = Object.freeze({
  hooks: Object.freeze([]) as readonly RadioHook[],
  seq: 0
}) as RadioHooksState

// ---- the numbers (spec 2.3-2.6; every one [INF], to tune by ear) ----

export const HOOK_STAY: readonly { bars: number; weight: number }[] = Object.freeze([
  { bars: 16, weight: 0.25 },
  { bars: 24, weight: 0.35 },
  { bars: 32, weight: 0.4 }
])
export const HOOK_AWAY: readonly { bars: number; weight: number }[] = Object.freeze([
  { bars: 16, weight: 0.4 },
  { bars: 24, weight: 0.35 },
  { bars: 32, weight: 0.25 }
])
export const HOOK_LONG_REST: readonly { bars: number; weight: number }[] = Object.freeze([
  { bars: 48, weight: 0.5 },
  { bars: 64, weight: 0.5 }
])
/** Returns before the long rest. */
export const HOOK_RETURNS_BEFORE_REST = 3
/** Chance an eligible exit rests (the row goes silent) instead of taking a substitute. */
export const HOOK_REST_CHANCE = 0.5
/** At most this many row landings in the last phrase is calm. */
export const HOOK_CALM_LANDINGS = 1
/** Chance a return waits one phrase when it has been calm. */
export const HOOK_CALM_WAIT_CHANCE = 0.5
/** Lengths are rounded to this, and clamped to [HOOK_MIN_BARS, HOOK_MAX_BARS]. */
export const HOOK_ROUND_BARS = 8
export const HOOK_MIN_BARS = 8
export const HOOK_MAX_BARS = 64
/** [level, scale], geometric between knots: shorter at ludicrous, longer at slow. */
export const HOOK_PACE_SCALE_KNOTS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 1.5],
  [25, 1.25],
  [50, 1],
  [70, 0.75],
  [90, 0.5],
  [100, 0.5]
] as const)

/** The hook cap: half the rows, at least one. */
export function radioHooksMax(rows: number): number {
  return Math.max(1, Math.floor((Number.isFinite(rows) ? rows : 0) / 2))
}

/** How the pace slider scales every hook length, by its level (0..100). */
export function radioHookPaceScale(level: number): number {
  const knots = HOOK_PACE_SCALE_KNOTS
  const l = Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 50
  let i = 0
  while (i < knots.length - 2 && l > knots[i + 1][0]) i++
  const [l0, s0] = knots[i]
  const [l1, s1] = knots[i + 1]
  const t = l1 > l0 ? (l - l0) / (l1 - l0) : 0
  return s0 * Math.pow(s1 / s0, Math.min(1, Math.max(0, t)))
}

/** A length scaled, rounded to the nearest HOOK_ROUND_BARS (ties up) and clamped. */
export function radioHookBars(bars: number, scale: number): number {
  const r = Math.floor((bars * scale) / HOOK_ROUND_BARS + 0.5 + 1e-9) * HOOK_ROUND_BARS
  return Math.min(HOOK_MAX_BARS, Math.max(HOOK_MIN_BARS, r))
}

/** One draw from a menu, scaled by the pace. */
export function drawRadioHookBars(
  menu: readonly { bars: number; weight: number }[],
  scale: number,
  random: () => number
): number {
  const total = menu.reduce((s, m) => s + m.weight, 0)
  let draw = random() * total
  for (const m of menu) {
    draw -= m.weight
    if (draw < 0) return radioHookBars(m.bars, scale)
  }
  return radioHookBars(menu[menu.length - 1].bars, scale)
}

// ---- lines (spec 2.2) ----

/** What the wrap ending the lap that starts now is: a phrase start (the new turnaroundLap 0), a
 * half line (an even phrase, its middle), or neither. `lap` is the turnaroundLap starting now,
 * `phraseLaps` the turnaround phrase in laps (turnaroundPhraseLaps). Exits land on lines (both),
 * returns only on phrase starts. */
export function radioHookLine(lap: number, phraseLaps: number): 'phrase' | 'half' | null {
  if (!(phraseLaps > 0)) return null
  const next = (Math.floor(lap) + 1) % phraseLaps
  if (next === 0) return 'phrase'
  if (phraseLaps % 2 === 0 && next === phraseLaps / 2) return 'half'
  return null
}

// ---- who holds what ----

export function radioHookOf(state: RadioHooksState, rowId: string): RadioHook | null {
  return state.hooks.find((h) => h.rowId === rowId) ?? null
}

/** A hook is IN on this row: the planner keeps it (TurnaroundRow.hooked), fold never folds it. */
export function radioHookInRow(state: RadioHooksState, rowId: string): boolean {
  const h = radioHookOf(state, rowId)
  return h !== null && h.state === 'in'
}

/** A hook will be in on this row in the lap after the coming wrap: in and not leaving there, or
 * coming back there. What a fold step deciding that lap reads (spec section 5). */
export function radioHookInRowNext(state: RadioHooksState, rowId: string): boolean {
  const h = radioHookOf(state, rowId)
  if (h === null) return false
  if (h.decided?.event === 'return') return true
  return h.state === 'in' && h.decided?.event !== 'exit'
}

/** The row is a hook's home, in any state: the density arc never removes it. */
export function radioHookReservesRow(state: RadioHooksState, rowId: string): boolean {
  return radioHookOf(state, rowId) !== null
}

/** Radio's own turnover leaves this row alone: a hook is in, an event is decided on it, or the
 * hook is away and its return is being prepared. */
export function radioHookTurnoverExcluded(state: RadioHooksState, rowId: string): boolean {
  const h = radioHookOf(state, rowId)
  if (h === null) return false
  return h.state === 'in' || h.decided !== null || h.prepared
}

/** The stems of hooks away or resting: used, so no row picks them while they are out. */
export function radioHookStemsAway(state: RadioHooksState): string[] {
  return state.hooks.filter((h) => h.state !== 'in').map((h) => h.stemId)
}

/** A hook is away, resting, or has an event decided: no other exit may be decided. */
function anyOut(state: RadioHooksState, exceptRow?: string): boolean {
  return state.hooks.some((h) => h.rowId !== exceptRow && (h.state !== 'in' || h.decided !== null))
}

// ---- taps (spec 2.7) ----

function withHooks(state: RadioHooksState, hooks: RadioHook[], seq = state.seq): RadioHooksState {
  return { hooks, seq }
}

/** Release the hook on this row (any state). The runtime handles the row: an away hook's
 * substitute stays; a resting row gets a fresh pick. */
export function releaseRadioHook(
  state: RadioHooksState,
  rowId: string
): { state: RadioHooksState; released: RadioHook | null } {
  const h = radioHookOf(state, rowId)
  if (h === null) return { state, released: null }
  return {
    state: withHooks(
      state,
      state.hooks.filter((x) => x !== h)
    ),
    released: h
  }
}

export interface RadioHookSet {
  rowId: string
  /** The stem the row plays now. */
  stemId: string
  /** Rows on the bed, for the cap. */
  rowCount: number
  paceLevel: number
  random: () => number
}

/** Hook the row's playing stem: in, with a stay drawn (one draw). Past the cap the oldest hook is
 * released first, preferring one that is in (an away one is coming back). */
function setHook(
  state: RadioHooksState,
  o: RadioHookSet
): { state: RadioHooksState; released: RadioHook | null } {
  let hooks = [...state.hooks]
  let released: RadioHook | null = null
  if (hooks.length >= radioHooksMax(o.rowCount)) {
    const bySeq = [...hooks].sort((a, b) => a.setSeq - b.setSeq)
    released = bySeq.find((h) => h.state === 'in' && h.decided === null) ?? bySeq[0]
    hooks = hooks.filter((h) => h !== released)
  }
  hooks.push({
    rowId: o.rowId,
    stemId: o.stemId,
    state: 'in',
    bars: 0,
    targetBars: drawRadioHookBars(HOOK_STAY, radioHookPaceScale(o.paceLevel), o.random),
    returns: 0,
    longRest: false,
    waited: false,
    broughtBack: false,
    prepared: false,
    decided: null,
    setSeq: state.seq
  })
  return { state: withHooks(state, hooks, state.seq + 1), released }
}

/** The row's hook toggle: releases a hook there (any state), or hooks the playing stem. */
export function toggleRadioHookStem(
  state: RadioHooksState,
  o: RadioHookSet
): { state: RadioHooksState; released: RadioHook | null; set: boolean } {
  if (radioHookOf(state, o.rowId) !== null)
    return { ...releaseRadioHook(state, o.rowId), set: false }
  return { ...setHook(state, o), set: true }
}

/** 👍's hold half: hooks the row's playing stem when the row has no hook and `canHold` (radio on,
 * the row not padlocked). Never un-hooks; on a row whose hook is away it does nothing (a row
 * holds one hook, and that one is coming back). */
export function likeRadioStem(
  state: RadioHooksState,
  o: RadioHookSet & { canHold: boolean }
): { state: RadioHooksState; released: RadioHook | null } {
  if (!o.canHold || radioHookOf(state, o.rowId) !== null) return { state, released: null }
  return setHook(state, o)
}

/** Tapping an away hook's dimmed name: it comes back at the next phrase start whose decision is
 * still to come, with no calm wait. */
export function bringRadioHookBack(state: RadioHooksState, rowId: string): RadioHooksState {
  const h = radioHookOf(state, rowId)
  if (h === null || h.state === 'in' || h.decided !== null) return state
  return withHooks(
    state,
    state.hooks.map((x) =>
      x === h ? { ...x, targetBars: Math.min(x.targetBars, x.bars), broughtBack: true } : x
    )
  )
}

/** A manual change committed on the row (similar, adjacent, random, swap-now, Cmd, the phone --
 * never a hook's own landing): a hook IN is cleared (the hooked stem is gone, and a hook is about
 * that stem); an away or resting hook stays (the change replaced its substitute). */
export function forgetRadioHookOnManualChange(
  state: RadioHooksState,
  rowId: string
): RadioHooksState {
  const h = radioHookOf(state, rowId)
  if (h === null || h.state !== 'in') return state
  return withHooks(
    state,
    state.hooks.filter((x) => x !== h)
  )
}

/** A decided event the runtime could not land (taken back on hold, refused, a manual change won
 * the line): undecided, it is tried again at the next line (an exit) or phrase start (a
 * return). */
export function withdrawRadioHookEvent(state: RadioHooksState, rowId: string): RadioHooksState {
  const h = radioHookOf(state, rowId)
  if (h === null || h.decided === null) return state
  return withHooks(
    state,
    state.hooks.map((x) => (x === h ? { ...x, decided: null } : x))
  )
}

/** Drop hooks for rows that no longer exist. The same object when none was stale. */
export function pruneRadioHooks(
  state: RadioHooksState,
  liveRowIds: ReadonlySet<string>
): RadioHooksState {
  if (state.hooks.every((h) => liveRowIds.has(h.rowId))) return state
  return withHooks(
    state,
    state.hooks.filter((h) => liveRowIds.has(h.rowId))
  )
}

/** Radio off (desktop) or stopped (web): away and resting hooks are dropped (the row keeps what
 * it plays), decisions undone; hooks in are kept, inert. */
export function radioHooksStopped(state: RadioHooksState): RadioHooksState {
  if (state.hooks.every((h) => h.state === 'in' && h.decided === null && !h.prepared)) return state
  return withHooks(
    state,
    state.hooks
      .filter((h) => h.state === 'in')
      .map((h) => ({ ...h, decided: null, prepared: false }))
  )
}

/** Radio starting: every hook in draws a fresh stay (in row order), from bar 0. */
export function radioHooksStarted(
  state: RadioHooksState,
  o: { paceLevel: number; random: () => number }
): RadioHooksState {
  if (state.hooks.length === 0) return state
  const scale = radioHookPaceScale(o.paceLevel)
  return withHooks(
    state,
    state.hooks.map((h) => ({
      ...h,
      bars: 0,
      targetBars: drawRadioHookBars(HOOK_STAY, scale, o.random),
      decided: null,
      prepared: false
    }))
  )
}

// ---- the step, once per loop top (spec 2.4-2.6) ----

export interface RadioHookRowInput {
  id: string
  /** The stem the row plays now (null: none). */
  stemId: string | null
  kinds: readonly DiscoverSlotKind[]
  /** isRadioEligibleSlot: unlocked, audible, not rerolling. Radio's own rest silence does not
   * make a hook's home row ineligible; a user mute, a lock or a solo elsewhere does. */
  eligible: boolean
  /** The last heard row of drums or of bass (the arc's lastOfItsKind, over heard rows). */
  lastLowHeard: boolean
}

export interface RadioHooksStepInput {
  loopBars: number
  /** The turnaroundLap starting at this wrap (RadioClock.turnaroundLap after advanceRadioClock). */
  lap: number
  /** The turnaround phrase in laps (turnaroundPhraseLaps). */
  phraseLaps: number
  paceLevel: number
  /** Radio is held: the hook clock stops and nothing is decided. A decided event still lands. */
  held: boolean
  /** In row order (ties go to the earlier row). */
  rows: readonly RadioHookRowInput[]
  /** The event's stem is warm: an exit's substitute (a rest needs none), a return's hooked stem. */
  ready: (rowId: string, event: 'exit' | 'return') => boolean
  /** Something else changes at the next wrap (radio's change, decided or predicted, a companion, a
   * manual change, an arc step): a return there does not wait. */
  changeAtNextWrap: boolean
  /** Row landings, of any kind, in the last phrase (radioLandingsInPhrase). */
  calmLandings: number
  /** The density arc is thinning, with the count above its target. */
  arcThinning: boolean
  /** The runtime can silence a row at a line (resting exits). False: an exit never rests and its
   * rest draw is never made. */
  canRest: boolean
  random: () => number
}

export interface RadioHooksStepResult {
  state: RadioHooksState
  /** Events whose line is THIS wrap: the state has flipped (the runtime landed them). */
  applied: { rowId: string; event: 'exit' | 'return' }[]
  /** Arm a substitute (exit) or warm the hooked stem (return) for an event a line or so ahead. */
  prepare: { rowId: string; event: 'exit' | 'return'; stemId: string }[]
  /** Decided now, landing at the next wrap: binding. */
  decided: ({ rowId: string; stemId: string } & RadioHookDecided)[]
}

const isBass = (kinds: readonly DiscoverSlotKind[]): boolean => kinds.includes('bass')

/** The echo throw's draws, in order: beats, timing, feedback -- a regular throw's own
 * (drawThrowBeats, drawThrowEcho), so the two cannot drift. */
function drawExitThrow(random: () => number): RadioHookThrow {
  const beats = drawThrowBeats(random)
  return { beats, ...drawThrowEcho(random) }
}

/**
 * One loop top. In order:
 *   1. events decided at the last wrap land here: their state flips, `bars` from 0;
 *   2. unless held, every other hook's clock adds the lap that ended;
 *   3. unless held, decisions for the NEXT wrap, in row order: returns first (each on its own),
 *      then at most one exit -- none while another hook is out -- the hook with the most bars in;
 *   4. prepares: a hook whose event is within a line and a lap, once per state.
 * Draws, in row order: a return's calm wait (when calm and not yet waited), then its stay; an
 * exit's rest (when it may rest), its throw's three (when it throws), then its absence.
 */
export function stepRadioHooks(
  state: RadioHooksState,
  input: RadioHooksStepInput
): RadioHooksStepResult {
  const none: RadioHooksStepResult = { state, applied: [], prepare: [], decided: [] }
  if (state.hooks.length === 0) return none
  const loopBars = input.loopBars > 0 && Number.isFinite(input.loopBars) ? input.loopBars : 0
  const applied: RadioHooksStepResult['applied'] = []
  // 1-2: land, then count
  let hooks: RadioHook[] = state.hooks.map((h) => {
    const d = h.decided
    if (d !== null) {
      applied.push({ rowId: h.rowId, event: d.event })
      if (d.event === 'exit') {
        return {
          ...h,
          state: d.rest ? 'resting' : 'away',
          bars: 0,
          targetBars: d.awayBars,
          longRest: d.longRest,
          prepared: false,
          decided: null,
          broughtBack: false
        }
      }
      return {
        ...h,
        state: 'in',
        bars: 0,
        targetBars: d.stayBars,
        // HOOK_RETURNS_BEFORE_REST ordinary absences between long rests
        returns: h.longRest ? 0 : h.returns + 1,
        longRest: false,
        waited: false,
        broughtBack: false,
        prepared: false,
        decided: null
      }
    }
    return input.held || loopBars === 0 ? h : { ...h, bars: h.bars + loopBars }
  })
  if (input.held || loopBars === 0) {
    return applied.length === 0 ? none : { ...none, state: withHooks(state, hooks), applied }
  }
  const line = radioHookLine(input.lap, input.phraseLaps)
  const scale = radioHookPaceScale(input.paceLevel)
  const phraseBars = input.phraseLaps * loopBars
  const rowOf = (id: string): RadioHookRowInput | undefined => input.rows.find((r) => r.id === id)
  const order = (h: RadioHook): number => {
    const i = input.rows.findIndex((r) => r.id === h.rowId)
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }
  const decided: RadioHooksStepResult['decided'] = []
  const set = (h: RadioHook, next: RadioHook): void => {
    hooks = hooks.map((x) => (x === h ? next : x))
  }
  const byRow = [...hooks].sort((a, b) => order(a) - order(b))
  // 3a. returns, on phrase starts only
  if (line === 'phrase') {
    for (const h of byRow) {
      if (h.state === 'in' || h.decided !== null) continue
      const row = rowOf(h.rowId)
      if (row === undefined || !row.eligible) continue
      if (h.bars + loopBars < h.targetBars - 1e-9) continue
      if (!input.ready(h.rowId, 'return')) continue
      const calm = input.calmLandings <= HOOK_CALM_LANDINGS
      if (!input.changeAtNextWrap && calm && !h.waited && !h.broughtBack) {
        if (input.random() < HOOK_CALM_WAIT_CHANCE) {
          set(h, { ...h, targetBars: h.targetBars + phraseBars, waited: true })
          continue
        }
      }
      const d: RadioHookDecided = {
        event: 'return',
        stayBars: drawRadioHookBars(HOOK_STAY, scale, input.random),
        awayBars: h.bars + loopBars
      }
      set(h, { ...h, decided: d })
      decided.push({ rowId: h.rowId, stemId: h.stemId, ...d })
    }
  }
  // 3b. at most one exit, on a line, none while another hook is out
  if (line !== null) {
    const now = { hooks, seq: state.seq }
    const due = [...hooks]
      .filter((h) => {
        if (h.state !== 'in' || h.decided !== null) return false
        const row = rowOf(h.rowId)
        return (
          row !== undefined &&
          row.eligible &&
          row.stemId === h.stemId &&
          h.bars + loopBars >= h.targetBars - 1e-9 &&
          !anyOut(now, h.rowId)
        )
      })
      .sort((a, b) => b.bars - a.bars || order(a) - order(b))
    for (const h of due) {
      const row = rowOf(h.rowId)!
      const mayRest = input.canRest && input.arcThinning && !row.lastLowHeard
      // the substitute must be warm, unless this exit can rest -- decided by its draw below
      if (!mayRest && !input.ready(h.rowId, 'exit')) continue
      const rest = mayRest && input.random() < HOOK_REST_CHANCE
      if (!rest && !input.ready(h.rowId, 'exit')) continue
      const thrown = isBass(row.kinds) ? null : drawExitThrow(input.random)
      const longRest = h.returns >= HOOK_RETURNS_BEFORE_REST
      const awayBars = drawRadioHookBars(longRest ? HOOK_LONG_REST : HOOK_AWAY, scale, input.random)
      const d: RadioHookDecided = { event: 'exit', rest, throw: thrown, awayBars, longRest }
      set(h, { ...h, decided: d })
      decided.push({ rowId: h.rowId, stemId: h.stemId, ...d })
      break
    }
  }
  // 4. prepares
  const prepare: RadioHooksStepResult['prepare'] = []
  const exitSpacing =
    (input.phraseLaps % 2 === 0 ? input.phraseLaps / 2 : input.phraseLaps) * loopBars
  for (const h of [...hooks].sort((a, b) => order(a) - order(b))) {
    if (h.prepared || h.decided !== null) continue
    const event = h.state === 'in' ? 'exit' : 'return'
    const spacing = event === 'exit' ? exitSpacing : phraseBars
    if (h.targetBars - h.bars > spacing + loopBars + 1e-9) continue
    prepare.push({ rowId: h.rowId, event, stemId: h.stemId })
    set(h, { ...h, prepared: true })
  }
  return { state: withHooks(state, hooks), applied, prepare, decided }
}

// ---- calm: landings in the last phrase ----

/** Row landings per lap, the lap playing last; at most a phrase of laps. */
export type RadioLandingWindow = readonly number[]

export const NO_RADIO_LANDINGS: RadioLandingWindow = Object.freeze([0]) as RadioLandingWindow

/** A wrap: a new lap with none yet, keeping the last `phraseLaps`. */
export function advanceRadioLandingWindow(
  w: RadioLandingWindow,
  phraseLaps: number
): RadioLandingWindow {
  const keep = Math.max(1, Math.floor(phraseLaps))
  return [...w, 0].slice(-keep)
}

/** `n` rows landed in the lap playing. */
export function noteRadioLandings(w: RadioLandingWindow, n: number): RadioLandingWindow {
  if (!(n > 0)) return w
  const out = w.length === 0 ? [0] : [...w]
  out[out.length - 1] += n
  return out
}

export function radioLandingsInPhrase(w: RadioLandingWindow): number {
  return w.reduce((s, n) => s + n, 0)
}

// ---- the row's words (spec section 6) ----

/** Bars until an away hook's planned return: the first phrase start at which its bars reach its
 * target, from `pos` bars into the lap `lap`. Null for a hook that is in. */
export function radioHookBarsToReturn(
  h: Pick<RadioHook, 'state' | 'bars' | 'targetBars'>,
  o: { lap: number; phraseLaps: number; loopBars: number; pos: number }
): number | null {
  if (h.state === 'in' || !(o.loopBars > 0) || !(o.phraseLaps > 0)) return null
  let wraps = o.phraseLaps - (Math.floor(o.lap) % o.phraseLaps)
  while (h.bars + wraps * o.loopBars < h.targetBars - 1e-9) wraps += o.phraseLaps
  const pos = Math.min(o.loopBars, Math.max(0, o.pos))
  return (wraps - 1) * o.loopBars + (o.loopBars - pos)
}

/** Widest role text on a row, in characters (`hook · back in 64 bars`, phone width 320 px). */
export const RADIO_ROLE_WORDS_MAX = 22
export const RADIO_HOOK_WORD = 'hook'
export const RADIO_DIG_WORD = 'dig'
export const RADIO_HOOK_OUT_WORD = 'hook out'
export const RADIO_HOOK_BACK_WORD = 'hook back'
export const RADIO_HOOK_TOOLTIP = 'hook: it leaves and comes back'
export const RADIO_HOOK_RELEASE_TOOLTIP = 'release hook'
export const RADIO_DIG_TOOLTIP = 'dig: lean toward this'
export const RADIO_DIG_STOP_TOOLTIP = 'stop digging'
export const RADIO_HOOK_BRING_BACK_TOOLTIP = 'bring it back'

/** A row's role, in words: `hook`, `hook · out next`, `hook · back in 16 bars`, `hook · back next`,
 * `dig`, `hook · dig`. `narrow` (under 360 px) shortens to `back in 16`, `back next`, `out next`.
 * `· dig` is dropped where it would pass RADIO_ROLE_WORDS_MAX. Null: no role. */
export function radioRoleWords(o: {
  hook: {
    state: RadioHookState
    decided: 'exit' | 'return' | null
    barsToReturn: number | null
  } | null
  dig: boolean
  narrow?: boolean
}): string | null {
  const narrow = o.narrow === true
  let hook: string | null = null
  if (o.hook !== null) {
    const h = o.hook
    if (h.state === 'in') {
      hook = h.decided === 'exit' ? (narrow ? 'out next' : 'hook · out next') : RADIO_HOOK_WORD
    } else if (h.decided === 'return') {
      hook = narrow ? 'back next' : 'hook · back next'
    } else if (h.barsToReturn !== null && Number.isFinite(h.barsToReturn)) {
      const n = Math.max(1, Math.ceil(h.barsToReturn - 1e-6))
      hook = narrow ? `back in ${n}` : `hook · back in ${n} bar${n === 1 ? '' : 's'}`
    } else {
      hook = narrow ? 'away' : 'hook · away'
    }
  }
  if (!o.dig) return hook
  if (hook === null) return RADIO_DIG_WORD
  const both = `${hook} · ${RADIO_DIG_WORD}`
  return both.length <= RADIO_ROLE_WORDS_MAX ? both : hook
}
```

  b. `radioThrows.ts` -- append the exit throw's three helpers:

```diff
--- a/src/shared/radioThrows.ts
+++ b/src/shared/radioThrows.ts
@@ -295,3 +295,36 @@ export function throwCurveFor(
     { bar: Math.min(end, loopBars), value: 0 }
   ]
 }
+
+// ---- a hook's exit (spec 2026-10-03-radio-anointed-stems-design 2.5) ----
+
+/** A hook's exit throw on `slot`, ENDING on its line `endsAt` (AudioContext time): it starts
+ * `beats` before it, so its echoes ring over the line and into the substitute (or the silence).
+ * The shape is stepRadioHooks' (drawn there with drawThrowBeats and drawThrowEcho). */
+export function radioThrowEndingAt(
+  slot: string,
+  shape: { beats: number; timing: ThrowTiming; feedback: number },
+  endsAt: number,
+  bpm: number
+): ThrowPlan {
+  return { slot, at: endsAt - (shape.beats * 60) / bpm, ...shape }
+}
+
+/** The same throw on a loop-anchored timeline (sssketch, throwCurveFor): it starts `beats / 4`
+ * bars before the top, so it ends exactly on it. Null when the loop cannot hold it. */
+export function radioThrowEndingAtTop(
+  shape: { beats: number },
+  loopBars: number
+): { atBar: number; beats: number } | null {
+  const atBar = loopBars - shape.beats / 4
+  return loopBars > 0 && atBar >= 0 ? { atBar, beats: shape.beats } : null
+}
+
+/** A hook's exit throw counts on the throw clock: the next regular throw waits for its echoes
+ * (busyUntil) and counts its spacing from it (barsSince 0). It draws nothing and leaves the
+ * schedule (`barsUntil`) alone, so the regular throws keep their rate and never stack on an exit.
+ * Only ever later: an earlier busyUntil is kept. */
+export function noteRadioExitThrow(state: ThrowState, endsAt: number, tailSec: number): ThrowState {
+  const busy = endsAt + (Number.isFinite(tailSec) && tailSec > 0 ? tailSec : 0)
+  return { ...state, busyUntil: Math.max(state.busyUntil, busy), barsSince: 0 }
+}
```

  c. `discoverThrows.ts` -- the desktop's exit throw (planning decision 6):

```diff
--- a/src/shared/discoverThrows.ts
+++ b/src/shared/discoverThrows.ts
@@ -23,7 +23,10 @@ import {
   THROW_BEATS,
   turnaroundSilencedRowIds,
   initialThrowState,
+  noteRadioExitThrow,
   stepThrows,
+  throwDelaySec,
+  throwTailSec,
   throwCurveFor,
   turnaroundThrowAim,
   type ThrowState,
@@ -374,3 +377,45 @@ export function discoverThrowAim(
   for (const g of gestures) if (g.kind === 'drop-out' || g.kind === 'hole') rows.add(g.slotId)
   return { changeInBars: aim.at, silenced: [...rows] }
 }
+
+/**
+ * A hook's exit throw (spec 2026-10-03-radio-anointed-stems-design 2.5), armed by the panel when
+ * the exit is decided: on the hook's row, ENDING on the coming loop top (the exit line), so its
+ * echoes ring over the line. It is armed live, as a lead-in is (a load-project now, the
+ * substitute's stage on a later tick), and counts on the throw clock (noteRadioExitThrow: the
+ * next regular throw waits for its echoes), drawing nothing.
+ *
+ * Null -- the exit goes dry -- when a throw is already armed, or the throw cannot start at least
+ * THROW_LEAD_BARS ahead of the playhead (a loop too short, or a decision late in the lap).
+ */
+export function armDiscoverExitThrow(
+  state: DiscoverThrowState,
+  o: {
+    slotId: string
+    shape: { beats: number; timing: ThrowTiming; feedback: number }
+    pos: number
+    loopBars: number
+    bpm: number
+  }
+): DiscoverThrowState | null {
+  if (state.armed !== null || !(o.loopBars > 0) || !(o.bpm > 0)) return null
+  const atBar = o.loopBars - o.shape.beats / 4
+  const ahead = atBar - o.pos
+  if (atBar < 0 || ahead < THROW_LEAD_BARS - 1e-6) return null
+  const secPerBar = (4 * 60) / o.bpm
+  const startBars = state.elapsedBars + ahead
+  const endsAtSec = state.elapsedSec + (o.loopBars - o.pos) * secPerBar
+  const tail = throwTailSec(throwDelaySec(o.bpm, o.shape.timing), o.shape.feedback)
+  return {
+    ...state,
+    throws: noteRadioExitThrow(state.throws, endsAtSec, tail),
+    armed: {
+      slotId: o.slotId,
+      atBar,
+      ...o.shape,
+      startBars,
+      endBars: startBars + o.shape.beats / 4,
+      aimed: true
+    }
+  }
+}
```

- [ ] **Step 4: Run them and watch them pass.**
  - Run: `npx vitest run src/shared/radioHooks.test.ts src/shared/radioHookThrows.test.ts src/shared/radioThrows.test.ts src/shared/discoverThrows.test.ts`
  - Expected: all pass (radioHooks 27, radioHookThrows 3).

- [ ] **Step 5: Lint, typecheck (both repos: `npm run typecheck` here, and in ell.ing/radio), commit.**
  - Message: `radio hooks: the shared machine (spec anointed-stems section 2) -- radioHooks: a hook is a stem on its home row (in / away / resting), its clock in bars counted at each wrap, events on lines (exits on phrase starts and half lines, returns only on phrase starts), decided a wrap ahead and binding; one away at a time (the most bars in goes); stays, absences and the long rest (after 3 returns; its own return does not count) drawn from weighted menus scaled by the pace slider (1.5 at slow to 0.5 at ludicrous, rounded to 8, 8-64); a resting exit only while the arc thins and not on the last heard low row; bass leaves dry; the calm wait (one phrase, once, only when calm); bring back; the cap (half the rows, oldest first, one in before one away); toggle, 👍, manual change, withdraw, prune, stop/start; the row's words. radioThrows: radioThrowEndingAt / radioThrowEndingAtTop / noteRadioExitThrow (the exit counts on the throw clock, draws nothing); discoverThrows: armDiscoverExitThrow. No hooks: no draws, the same state back`, then the trailer.

### Task 6: The words, the arc and the phone (`radioReadout.ts`, `radioNextLanding.ts`, `radioDensity.ts`, `remoteState.ts`)

**Depends on:** Task 5 (`RADIO_ROLE_WORDS_MAX`). **Parallel-safe** with Tasks 1-4 and 12.

**Files (`/Users/nickel/Claudecode/sssketch/src/shared/`):**
- Modify: `radioReadout.ts`, `radioNextLanding.ts`, `radioDensity.ts`, `remoteState.ts`
- Create: `radioReadoutHooks.test.ts`, `remoteStateRoles.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/shared/radioReadoutHooks.test.ts`:

```ts
// The readout names a hook's own landing (spec 2026-10-03-radio-anointed-stems-design section 6).
import { describe, expect, it } from 'vitest'
import { pickArcRemoval, type ArcRow } from './radioDensity'
import { radioNextLanding } from './radioNextLanding'
import { radioReadout, type RadioReadoutInput } from './radioReadout'

const rows = ['a', 'b', 'c'].map((rowId) => ({ rowId, kinds: ['drums' as const], laps: 1 }))
const input = (nextChange: RadioReadoutInput['nextChange']): RadioReadoutInput => ({
  bars: { intoPhrase: 0, phraseBars: 16, loopBars: 4 },
  nextChange,
  armedTurnaround: null,
  arc: { state: 'off', count: 3, target: 3 },
  rows
})

describe('a hook in the readout', () => {
  it('next names it; the row reads next · hook back', () => {
    const r = radioReadout(input({ rowId: 'b', kind: 'riser', barsAway: 4, hook: 'back' }))
    expect(r.statusLine).toBe('next: row 2 → hook back · 4 bars')
    expect(r.rows[1].nextLabel).toBe('next · hook back')
    const out = radioReadout(input({ rowId: 'c', kind: 'cut', barsAway: 3.5, hook: 'out' }))
    expect(out.statusLine).toBe('next: row 3 → hook out · 4 bars')
  })

  it('radioNextLanding passes a queued hook landing through', () => {
    const n = radioNextLanding({
      pos: 1,
      loopBars: 4,
      course: null,
      led: null,
      pending: null,
      manual: [{ rowId: 'b', kind: 'cut', ready: true, hook: 'back' }],
      arc: null
    })
    expect(n).toEqual({ rowId: 'b', kind: 'cut', barsAway: 3, hook: 'back' })
  })
})

describe('the arc and a resting hook', () => {
  const r = (id: string, o: Partial<ArcRow> = {}): ArcRow => ({
    id,
    kinds: ['drums'],
    radioAdded: true,
    locked: false,
    soloed: false,
    held: false,
    busy: false,
    shrinksLoop: false,
    staleness: 1,
    ...o
  })
  it('an unheard drums row does not count: the heard one is the last of its kind', () => {
    expect(pickArcRemoval([r('d1', { staleness: 5 }), r('d2')])).toBe('d1')
    expect(
      pickArcRemoval([r('d1', { staleness: 5 }), r('d2', { heard: false, held: true })])
    ).toBeNull()
  })
})
```

  and `src/shared/remoteStateRoles.test.ts`:

```ts
// The phone's side of radio's roles (spec 2026-10-03-radio-anointed-stems-design section 5).
import { describe, expect, it } from 'vitest'
import type { CoachSlotSnapshot } from './coachClimax'
import { parseRemoteSlotAction, remoteStateFromSlots, type RemoteSlotRole } from './remoteState'

const slot = (id: string): CoachSlotSnapshot => ({
  id,
  kinds: ['drums'],
  stem: null,
  gain: 1,
  audible: true,
  rolling: false
})
const meta = {
  discoverOpen: true,
  playing: true,
  kept: 0,
  rolled: 0,
  lastKeptName: null,
  loopBars: 4
}

describe('roles on the phone', () => {
  it('the three new actions parse', () => {
    for (const a of ['hook', 'dig', 'back'] as const) expect(parseRemoteSlotAction(a)).toBe(a)
  })

  it('a row with a role carries it, words cut to the phone; no role, no field', () => {
    const roles = new Map<string, RemoteSlotRole>([
      ['a', { hook: 'away', dig: true, hookBarsAway: 15.6, words: 'hook · back in 16 bars · dig' }],
      ['b', { hook: null, dig: false, hookBarsAway: null, words: null }],
      ['c', { hook: 'in', dig: false, hookBarsAway: 8, words: 'hook' }]
    ])
    const s = remoteStateFromSlots([slot('a'), slot('b'), slot('c')], { ...meta, roles })
    expect(s.slots[0].role).toEqual({
      hook: 'away',
      dig: true,
      hookBarsAway: 16,
      words: 'hook · back in 16 bars'
    })
    expect('role' in s.slots[1]).toBe(false)
    expect(s.slots[2].role).toEqual({ hook: 'in', dig: false, hookBarsAway: null, words: 'hook' })
    expect('role' in remoteStateFromSlots([slot('a')], meta).slots[0]).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail** (`hook` is not a field of `nextChange` or a manual
  entry; `heard` is ignored; `'hook'` is not a slot action; `roles` is not read).

- [ ] **Step 3: Implement.**

  a. `radioReadout.ts`:

```diff
--- a/src/shared/radioReadout.ts
+++ b/src/shared/radioReadout.ts
@@ -77,6 +77,9 @@ export interface RadioReadoutInput {
     /** The pace slider's extra rows riding radio's change (its companions), cuts landing with
      * it: `next: row 2 +2 → bloom`, and each of them reads `next · cut`. */
     with?: readonly string[]
+    /** A hook leaving (`out`) or coming back (`back`) on that row (radioHooks.ts):
+     * `next: row 2 → hook back · 4 bars`. */
+    hook?: 'out' | 'back'
     /* Which rows ride (held, locked or muted ones excluded) is the caller's call at decision
      * time; the readout only shows the ones that are rows and not the led row, once each. */
   } | null
@@ -240,7 +243,15 @@ function nextPart(input: RadioReadoutInput): string | null {
   const extra = companions.length > 0 ? ` +${companions.length}` : ''
   const who =
     (n.course ? 'course change' : i >= 0 && !n.adding ? `row ${i + 1}` : 'a new row') + extra
-  const how = n.course ? '' : n.leaving ? ' leaves' : n.kind !== null ? ` → ${n.kind}` : ''
+  const how = n.course
+    ? ''
+    : n.hook !== undefined
+      ? ` → hook ${n.hook}`
+      : n.leaving
+        ? ' leaves'
+        : n.kind !== null
+          ? ` → ${n.kind}`
+          : ''
   const bars = Math.max(1, Math.ceil(n.barsAway - 1e-6))
   return `next: ${who}${how} · ${plural(bars, 'bar')}`
 }
@@ -286,11 +297,13 @@ export function radioReadout(input: RadioReadoutInput): RadioReadout {
         nextKind,
         nextLabel: !isNext
           ? null
-          : leaving
-            ? 'next · leaves'
-            : nextKind !== null
-              ? `next · ${nextKind}`
-              : 'next',
+          : !companion && next.hook !== undefined
+            ? `next · hook ${next.hook}`
+            : leaving
+              ? 'next · leaves'
+              : nextKind !== null
+                ? `next · ${nextKind}`
+                : 'next',
         flash: r.flash ?? null
       }
     })
```

  b. `radioNextLanding.ts`:

```diff
--- a/src/shared/radioNextLanding.ts
+++ b/src/shared/radioNextLanding.ts
@@ -32,7 +32,13 @@ export interface RadioNextLandingInput {
   pending: { rowId: string; barsUntil: number | null; with?: readonly string[] } | null
   /** Changes queued for the next top, the arc's joining row among them: how each arrives, and
    * whether its stem is warm (a cold one waits for a later top, bar unknown). */
-  manual: readonly { rowId: string; kind: RadioTransitionKind | null; ready: boolean }[]
+  manual: readonly {
+    rowId: string
+    kind: RadioTransitionKind | null
+    ready: boolean
+    /** A hook's own landing (radioHooks.ts), queued like a manual change. */
+    hook?: 'out' | 'back'
+  }[]
   /** The density arc, null when it is off. */
   arc: {
     /** The row it is bringing in (picking, then in `manual`). */
@@ -148,7 +154,12 @@ export function radioNextLanding(input: RadioNextLandingInput): Next | null {
 
   for (const m of input.manual) {
     if (arc?.adding?.rowId === m.rowId) continue
-    candidates.push({ rowId: m.rowId, kind: m.kind, barsAway: m.ready ? toWrap : null })
+    candidates.push({
+      rowId: m.rowId,
+      kind: m.kind,
+      barsAway: m.ready ? toWrap : null,
+      ...(m.hook !== undefined && { hook: m.hook })
+    })
   }
 
   let best: Next | null = null
```

  c. `radioDensity.ts` -- the `ArcRow` hunks (the `waits` hunks are Task 2's):

```diff
@@ -130,8 +135,12 @@ export interface ArcRow {
   radioAdded: boolean
   locked: boolean
   soloed: boolean
-  /** "hold longer" (the hook). */
+  /** Reserved by a hook (radioHooks' radioHookReservesRow: in, away or resting): the arc never
+   * takes a hook's home row. */
   held: boolean
+  /** Heard now (absent: true). A hook resting leaves its row unheard: it does not count as the
+   * last of its kind, so the remaining drums or bass row stays protected. */
+  heard?: boolean
   /** A change waiting, radio's decided change, or a stem still resolving. */
   busy: boolean
   /** It is the only row as long as the loop: removing it would shorten
@@ -164,7 +173,8 @@ export function pickArcRemoval(rows: readonly ArcRow[]): string | null {
   const lastOfItsKind = (r: ArcRow): boolean =>
     r.kinds.some(
       (k) =>
-        (k === 'drums' || k === 'bass') && !rows.some((o) => o.id !== r.id && o.kinds.includes(k))
+        (k === 'drums' || k === 'bass') &&
+        !rows.some((o) => o.id !== r.id && o.heard !== false && o.kinds.includes(k))
     )
   let best: ArcRow | null = null
   for (const r of rows) {
```

  d. `remoteState.ts`:

```diff
--- a/src/shared/remoteState.ts
+++ b/src/shared/remoteState.ts
@@ -1,4 +1,5 @@
 // src/shared/remoteState.ts
+import { RADIO_ROLE_WORDS_MAX } from './radioHooks'
 import type { SoundType } from './types'
 import type { CoachSlotSnapshot } from './coachClimax'
 import {
@@ -41,6 +42,19 @@ export interface RemoteSlotView {
    * identify a file and cannot be turned back into one, so this does not
    * widen the boundary this function IS. */
   peaks: number[] | null
+  /** Radio's roles on the row (spec 2026-10-03-radio-anointed-stems-design 5): its hook's state,
+   * whether it is dug, and the row's words (radioHooks' radioRoleWords, the phone's width). Absent
+   * while radio is off or the row has no role. */
+  role?: RemoteSlotRole
+}
+
+export interface RemoteSlotRole {
+  hook: 'in' | 'away' | 'resting' | null
+  dig: boolean
+  /** Bars until an away hook comes back, null otherwise. */
+  hookBarsAway: number | null
+  /** At most RADIO_ROLE_WORDS_MAX characters; null for none. */
+  words: string | null
 }
 
 /** What radio is about to do, as much of it as the phone needs.
@@ -206,6 +220,8 @@ export interface RemoteStateMeta {
   fold?: boolean | null
   /** Radio's turn while radio runs; absent or null while it is off. */
   turn?: RemoteTurnView | null
+  /** Radio's roles by slot id while radio runs (hooks, dig); absent while it is off. */
+  roles?: ReadonlyMap<string, RemoteSlotRole>
 }
 
 /** The whole privacy boundary of Part 2, in one pure function: whatever
@@ -251,11 +267,32 @@ export function remoteStateFromSlots(
       soundType: slot.stem?.type ?? null,
       muted: !slot.audible,
       soloed: slot.audible && audibleCount === 1,
-      peaks: quantiseRemotePeaks(peaksBySlotId?.get(slot.id) ?? [])
+      peaks: quantiseRemotePeaks(peaksBySlotId?.get(slot.id) ?? []),
+      ...roleOf(meta.roles?.get(slot.id))
     }))
   }
 }
 
+/** A role leaves only with something in it, its words cut to the phone's width. */
+function roleOf(role: RemoteSlotRole | undefined): { role?: RemoteSlotRole } {
+  if (role === undefined || (role.hook === null && !role.dig)) return {}
+  const away = role.hookBarsAway
+  return {
+    role: {
+      hook: role.hook,
+      dig: role.dig === true,
+      hookBarsAway:
+        role.hook !== null &&
+        role.hook !== 'in' &&
+        typeof away === 'number' &&
+        Number.isFinite(away)
+          ? Math.max(0, Math.round(away))
+          : null,
+      words: typeof role.words === 'string' ? role.words.slice(0, RADIO_ROLE_WORDS_MAX) : null
+    }
+  }
+}
+
 /** Only real move names leave, in the planner's order, once each; anything else is dropped. */
 function normalizeRemoteTurn(turn: RemoteTurnView | null): RemoteTurnView | null {
   if (turn === null) return null
@@ -342,7 +379,18 @@ export function parseRemoteFold(value: unknown): boolean | null {
  * also add solo? first press is solo, then second press is mute / like
  * double tap"). It is toggleSlotSolo and nothing else: drop every other
  * slot out of the mix. */
-export type RemoteSlotAction = 'mute' | 'solo' | 'similar' | 'adjacent' | 'random' | 'duplicate'
+export type RemoteSlotAction =
+  | 'mute'
+  | 'solo'
+  | 'similar'
+  | 'adjacent'
+  | 'random'
+  | 'duplicate'
+  // radio's roles (spec 2026-10-03-radio-anointed-stems-design 5): the hook and dig toggles, and
+  // bring an away hook back
+  | 'hook'
+  | 'dig'
+  | 'back'
 
 const REMOTE_SLOT_ACTIONS: RemoteSlotAction[] = [
   'mute',
@@ -350,7 +398,10 @@ const REMOTE_SLOT_ACTIONS: RemoteSlotAction[] = [
   'similar',
   'adjacent',
   'random',
-  'duplicate'
+  'duplicate',
+  'hook',
+  'dig',
+  'back'
 ]
 
 /** What POST /api/turn's body asked for: `{ move }` with a real move name, or the planner's
```

- [ ] **Step 4: Run them, and the shared suite** (`npx vitest run src/shared`): green.
- [ ] **Step 5: Lint, typecheck (both repos), commit.** Message: `radio hooks: the words and the phone -- the readout's next names a hook's landing (next: row 2 → hook back · 4 bars; the row reads next · hook back), radioNextLanding passes a queued hook landing through, ArcRow.heard (a resting hook's row is not the last of its kind; held now means reserved by a hook), the phone's RemoteSlotAction gains hook / dig / back and each row its role (hook state, dig, bars away, words cut to 22 characters)`, then the trailer.

### Task 7: Web radio: hooks in the reducer

**Repo:** ell.ing/radio. **Depends on:** Tasks 3, 5, 6. **Parallel with:** Task 9.

**Files:** `src/radio/step.ts`, `step.test.ts`, `controller.ts`, `controller.test.ts`,
`likes.ts`, `likes.test.ts`, `src/main.ts`, `src/dev/devRadio.ts`.

- [ ] **Step 1: The failing tests** (`step.test.ts`, `describe('hooks')`, Sim with RULES plus
  `{ phraseBars: 16, sizedBuilds: true, turnarounds: 'often', transitions: 'bold' }`, a 4-bar loop):
  - **a full cycle:** `{ type: 'hook', slot }` on the drums row at the start; over 300 s: a
    `throw` action on that row ending on a loop top (`time + beats * 60 / bpm` is a wrap), a
    `swapAt` with `hook: 'exit'` landing at that same wrap; later a `swapAt` with
    `hook: 'return'` and the hooked record on a phrase start (16 bars from the run's first top),
    and the `turnaround` rolled at that wrap was rolled at `large` (`s.turnaround.large`) or the
    payoff (≥ 3 rows, or the return with another row) landed there;
  - **one away at a time:** three rows hooked (cap at 4 rows is 2: use 6 rows with the arc off
    and `channels: 6`); at every tick at most one hook is not `in`;
  - **the wrap order:** the hook step runs after `densityAtWrap` and before `foldAtWrap`: with fold
    on, the fold step for the lap a return lands in sees the row as hooked
    (`s.foldNext!.cycles` has no cycle for that row);
  - **the arc never removes a reserved row:** arc on, thinning, a hooked bass row and two other
    bass rows... (any `removeRow` never names a row with a hook);
  - **hold freezes the hook clock:** `{ type: 'hold', on: true }` for 60 s: no `hook` event lands,
    `bars` unchanged;
  - **a late return:** withhold the hooked record's `prepared` answer past the line: the return
    lands at the first wrap after it is ready, never mid-lap;
  - **a manual change clears a hook in:** `swapNow` on a hooked-in row; after it lands the row
    has no hook; on an away row the hook stays;
  - **no roles, `sizedBuilds: false`:** byte-identical to Task 3's commit (the harness).
  - **turnover:** across 300 s no radio `landAt` names a row whose hook is in.

- [ ] **Step 2: State and events.**
  - `RadioState` gains:
    - `hooks: RadioHooksState` (`NO_RADIO_HOOKS`);
    - `hookRecords: Record<string, IndexRecord>` (the hooked stem's record by row, set when a hook
      is set, dropped when it goes);
    - `hookSubs: Record<string, RadioPending>` (an exit's substitute pick by row, armed at
      `prepare`);
    - `landings: RadioLandingWindow` (if Task 3 did not add it).
  - `draft` copies them.
  - `RadioEvent` (:449): replace `{ type: 'hook'; slot }` (keep the name: the controller and UI
    call it) and add `{ type: 'likeHook'; slot }` (👍's hold) and `{ type: 'hookBack'; slot }`.
  - `reduce` (:661): `'hook'` → `toggleRadioHookStem(s.hooks, { rowId, stemId: row.record.id,
    rowCount: s.rows.length, paceLevel: radioPaceLevelOf(s.settings), random: c.rnd })` (only
    with a stem); store/drop `hookRecords`; on a release, `releasedHook(c, released)`:
    - an away hook: the substitute stays; drop its queued return (`s.manual[row]?.hook ===
      'return'`), `hookSubs[row]` and its record;
    - a hook with an exit decided: drop the queued exit landing, `hookSubs`;
    - `'likeHook'` → `likeRadioStem(..., canHold: s.phase === 'running')`;
    - `'hookBack'` → `bringRadioHookBack`.
  - `'replaceSoon'` (👎) on a row whose hook is IN: `releaseRadioHook` first (spec §2.7), then the
    flag as today. On an away row: the flag only (it marks the substitute).

- [ ] **Step 3: The step at the wrap.** In `tick`'s wrap block (:866-875), between
  `densityAtWrap(...)` and `if (!cleared) foldAtWrap(c, t)`:

```ts
    hooksAtWrap(c, t, adv)
```

  New `hooksAtWrap(c, t, adv)`:
  - `s.landings = advanceRadioLandingWindow(s.landings, P)` (P =
    `turnaroundPhraseLaps(radioCadenceOf(s.settings).turnaroundPhraseBars, t.loopBars)`);
  - `const r = stepRadioHooks(s.hooks, { loopBars: t.loopBars, lap: s.clock!.turnaroundLap ?? 0,
    phraseLaps: P, paceLevel: radioPaceLevelOf(s.settings), held: s.held, rows, ready,
    changeAtNextWrap, calmLandings: radioLandingsInPhrase(s.landings), arcThinning, canRest: false,
    random: c.rnd })` where:
    - `rows`: `s.rows` with a record, in order: `{ id, stemId: r.record.id, kinds, eligible:
      eligible(s, r.id) && !s.manual[r.id] && s.removing?.slot !== r.id, lastLowHeard }`
      (`lastLowHeard`: the row has drums (or bass) and no other heard row does);
    - `ready(row, 'exit')`: `hookSubs[row]?.record` is ready (`isReady(s, rec, s.bpm)`);
      `ready(row, 'return')`: `hookRecords[row]` is ready;
    - `changeAtNextWrap`: `forecastAt(s, t, t.nextWrap).rows > 0 || .arcStep !== null`;
    - `arcThinning`: arc on, `s.density.phase === 'thinning'` and `s.rows.length > s.density.target`.
  - `s.hooks = r.state`.
  - **prepare:** for an `exit`, arm the substitute: `hookSubs[row] = { slot: row, token: ++s.token,
    record: null }` and `pushArm(c, row, token)` (its `usedElsewhere` already includes the row's
    own stem); `picked` routes the token. For a `return`: nothing to arm; `wants` (Step 6) warms
    `hookRecords[row]`.
  - **decided:** for each, queue its landing at `t.nextWrap` (the line):
    - `exit`: the substitute's record. With `throw` (not a bass row): push
      `{ type: 'throw', slot: row, ...radioThrowEndingAt(row, d.throw, t.nextWrap!, s.bpm) }` (a new
      action; Step 5). Mark the row `exiting` for the roll (Step 4).
    - `return`: `hookRecords[row]`; its transition is drawn now:
      `pickTransition(s.settings.transitions, kinds, c.rnd, { size, hookReturn: true })` with
      `size` from `radioBuildSize(forecastAt(...) with the return)`; `radioGestureBeats(kind, ...,
      size)`.
    - The queue: `s.manual[row] = { slot: row, token: ++s.token, record, at: null, mode: null,
      notBefore: -Infinity, topOnly: true, fails: 0, since: t.now, next: false, hook: d.event,
      wrapAt: t.nextWrap, transition }` -- `RadioManual` gains `hook?`, `wrapAt?`,
      `transition?`. A manual entry already on the row (a swap-now) wins: do not queue; call
      `withdrawRadioHookEvent` (it retries at the next line / phrase start).
    - Radio's own pick or companion on that row gives way, as `swapNow` makes it (:1393-1409).
  - **applied:** nothing to do (the landing is the manual entry's).
  - Log each decision: `radio: hook out on r2 (echo 2 beats)` / `radio: hook back on r2`.

- [ ] **Step 4: Landing, readers and the forecast.**
  - `manualTick` (:1414): an entry with `hook` lands only at a loop top `>= wrapAt` (mode `top`),
    and puts its `transition` on the `swapAt` action (`transition?: { kind; beats }`). Its
    `swapScheduled` answer: a leading kind (`hole`, `riser`) goes on `s.gestures` as `scheduled`
    does for radio's change.
  - `landManual` (:1545): a hook entry is not a manual change: skip `forgetRadioHookOnManualChange`;
    a non-hook entry calls `s.hooks = forgetRadioHookOnManualChange(s.hooks, slot)` (and drops
    `hookRecords` when it went). `commit` (:2731) and `s.landings = noteRadioLandings(s.landings, 1)`
    for every landing (radio's, companions', manual, arc adds).
  - `swapNow` (:1376) on a row with a queued hook landing: drop it and `withdrawRadioHookEvent`.
  - `dropManual` of a hook entry: `withdrawRadioHookEvent` too.
  - **Turnover:** `arm` (:1761) filters `!radioHookTurnoverExcluded(s.hooks, r.id)`; so do the
    spares (Task 3 Step 6).
  - **Dedupe:** `pushArm`'s `usedElsewhere` (:1813) adds `radioHookStemsAway(s.hooks)`.
  - **Readers** (the old flag reads):
    - `turnaroundRowsOf` (:1233): `hooked: radioHookInRow(s.hooks, r.id)`, and `exiting: true` for
      a row whose exit is decided for this roll's wrap (`radioHookOf(s.hooks, r.id)?.decided?.event
      === 'exit'`);
    - `foldRows` (:2164) and `foldIncomingRow` (:2267): `hooked: radioHookInRowNext(s.hooks, id)`
      (the fold step decides the NEXT lap);
    - `removalVictim` (:1659): `!radioHookReservesRow(s.hooks, r.id)`;
    - `RadioRowView` (:2764): keep `flag` (replace-soon only from now on) and add
      `hook: { state; decided; barsToReturn; stemName } | null` (from `radioHookOf` and
      `radioHookBarsToReturn` at the last tick's position), `dig: boolean` (Task 13; false now).
  - **The forecast** (Task 3's `forecastAt`): `hookReturn: { awayBars }` for a return decided for
    `at` (`radioHookOf(...).decided` with `event: 'return'`), counted in `rows`; `lowEndReturn`
    when that row's kinds include drums or bass (planning decision 2).
  - `stop` (:2081): `s.hooks = radioHooksStopped(s.hooks)` then `pruneRadioHooks` to the kept rows;
    `hookSubs = {}`. `play` (:2009): `radioHooksStarted(s.hooks, { paceLevel, random: c.rnd })`.
  - The density arc's removal (`densityTick`, :1720): `s.hooks = pruneRadioHooks(...)` beside
    `pruneRadioSlotFlags`.
  - Stop setting `'hook'` flags anywhere (nothing calls `toggleRadioHook` after this task).

- [ ] **Step 5: The exit throw.** `RadioAction` gains `{ type: 'throw'; plan: ThrowPlan }`.
  `controller.ts` `run` (:331): `case 'throw'`: `engine.throwDelay(p.slot, p.at, p.beats, p.timing,
  p.feedback)`, the `throw` flash (as `throwTick`, :313-314), and
  `this.throws = noteRadioExitThrow(this.throws, p.at + p.beats * 60 / bpm, throwTailSec(throwDelaySec(bpm, p.timing), p.feedback))`
  -- the regular throws wait for it and keep their rate. `controller.test.ts`: the throw reaches
  the engine double and the next regular throw is not before its tail.

- [ ] **Step 6: Warming.** `wants` (:1884): each `hookSubs[row].record` ('background') and, for a
  hook with `prepared` and not `in`, `hookRecords[row]` ('now' within a lap of its line, else
  'background'), at `s.bpm` and at a tempo on its way.

- [ ] **Step 7: Likes and the controller.** `controller.ts`: `toggleHook` (:229) stays; add
  `likeHook(slot)` (`likeHook` event) and `hookBack(slot)`. `main.ts` (:590): 👍 calls
  `radio.likeHook(slot)` (no `likeTurnsHookOn`); `likes.ts`: delete `likeTurnsHookOn` and its test
  (the reducer's `likeRadioStem` owns "never un-hooks"). `dev/devRadio.ts` (:106): the button
  toggles the hook (`row.hook !== null`).

- [ ] **Step 8: Run, harness, typecheck, commit.**
  - `npx vitest run src`, `npm run typecheck`; the harness at no roles (identical to Task 3).
  - Measure (one drums hook, 4 seeds × 900 s, pace 50 and 90): bars per stay and per absence,
    returns before a long rest, returns landing with another change (share), returns waiting a
    phrase (share).
  - Message: `radio: hooks that leave and come back (spec anointed-stems section 2) -- the hook is a stem (radioHooks), stepped at every wrap between the arc and the fold step; exits on lines with an echo throw (a throw action, counted on the throw clock; bass dry) and a substitute picked a line ahead; returns on phrase starts through the swap-now path at their line (hook-marked: never a manual change), with a sized transition (no filter in or bloom), counted in the turnaround's forecast (a low-end return on drums or bass); hooked-in rows out of turnover and companions, away stems out of every pick; fold and turnarounds read hook in, the arc never takes a hook's row; 👍 hooks (likeRadioStem), 👎 releases a hook in; stop drops away hooks. Measured: <numbers>. No roles: byte-identical to <Task 3 commit>`, then the trailer.

### Task 8: Web full mode: the hook button, the words, the dimmed name

**Repo:** ell.ing/radio. **Depends on:** Task 7. **Parallel with:** Task 10.

**Files:** `src/ui/full.ts`, `full.css`, `fullModel.ts`, `fullModel.test.ts`, `icons.ts`,
`src/main.ts`.

- [ ] **Step 1: The failing tests** (`fullModel.test.ts`):
  - a row with `hook: { state: 'away', decided: null, barsToReturn: 16, stemName: 'x' }` gives
    `role: 'hook · back in 16 bars'` (narrow: `back in 16`), `hookAway: 'x'`, `hookOn: true`;
  - a hook in: `role: 'hook'`; none: `role: null`, `hookOn: false`;
  - not running: no role and the button hidden (`roles: false`).
- [ ] **Step 2: Model.** `FullRow` (fullModel.ts:40) replaces `hook: boolean` with `hookOn: boolean`
  (any state), `role: string | null` (`radioRoleWords`, `narrow` from the row's width class:
  below 360 px), `hookAway: string | null` (the hooked stem's name while away); `digOn: false`
  (Task 13). `readout.age` appends ` · ${role}` when role is set (the line the radio-view spec
  also uses).
- [ ] **Step 3: Icons.** `icons.ts`: import `@phosphor-icons/core/regular/repeat.svg?raw`,
  `fill/repeat-fill.svg?raw`, `regular/shovel.svg?raw`, `fill/shovel-fill.svg?raw` (all present
  in node_modules/@phosphor-icons/core/assets); `ROW_ICONS` gains `hook: [repeat, repeatFill]` and
  `dig: [shovel, shovelFill]`. `ICON_LABELS` (full.ts:138): `hook: 'hook'`, `dig: 'dig'`.
- [ ] **Step 4: Buttons.** `RowAction` (full.ts:30) gains `'hook' | 'dig' | 'back'`. After
  dislike (:294): an icon button `hook` (pressed while `hookOn`; tooltip `RADIO_HOOK_TOOLTIP` /
  `RADIO_HOOK_RELEASE_TOOLTIP`) and `dig` (hidden until Task 13: `hidden` attribute). Shown only
  while running, like the strip's radio controls. The 👍's `holding` class (:653-655) now reads a
  hook IN (`row.hookOn && row.role === 'hook'`, or better a `hookIn` field).
- [ ] **Step 5: The dimmed name.** While away, a `<button class="hook-away">` with the hooked
  stem's name, dimmed (`opacity: .45`), after the label, `title="bring it back"`; click →
  `on.row(slot, 'back')`. `main.ts`'s row handler: `'hook'` → `radio.toggleHook(slot)`, `'back'`
  → `radio.hookBack(slot)`. Flashes `hook out` / `hook back` (RADIO_HOOK_OUT_WORD /
  RADIO_HOOK_BACK_WORD) on the row when its hook landing is scheduled (the controller's
  `swapScheduled` for a hook entry: `this.flash(slot, word, at, key)`).
- [ ] **Step 6: Phone width.** At 320 px no row's role text passes 22 characters (the shared test
  already pins it); check `full.css` lets the readout line wrap or ellipsis at the button line.
- [ ] **Step 7: Run, typecheck, commit.** No agent can see the page: say so. Message: `full mode: the hook toggle (Phosphor Repeat, after 👎; pressed while the row has a hook), the row's role words (hook, hook · out next, hook · back in 16 bars, back next; short forms under 360 px), the away hook's name dimmed beside what plays (tap: bring it back), hook out / hook back flashes; 👍's holding mark reads a hook in. Unseen by any agent`, then the trailer.

### Task 9: Desktop: hooks in the panel

**Repo:** sssketch. **File:** `DiscoverPanel.tsx`. **Depends on:** Tasks 4, 5, 6.
**Parallel with:** Task 7.

- [ ] **Step 1: State.** Beside `radioSlotFlags` (:2955):

```ts
  // Radio's hooks (@shared/radioHooks; spec anointed-stems section 2): a hooked STEM on its row,
  // leaving and coming back. State for the rows' render, a ref for the clock effect. Not
  // persisted. The hooked stem's pick by row, so a return can be queued as a manual change.
  const [radioHooks, setRadioHooks] = useState<RadioHooksState>(NO_RADIO_HOOKS)
  const radioHooksRef = useRef(radioHooks)
  const radioHookPicksRef = useRef(new Map<string, SlotPick>())
  /** An exit's substitute, picked and warmed at `prepare`. */
  const radioHookSubsRef = useRef(new Map<string, { pick: SlotPick; stem: ResolvedCandidateStem | null }>())
  const radioLandingsRef = useRef<RadioLandingWindow>(NO_RADIO_LANDINGS)
```

  A setter helper `updateRadioHooks(next)` sets both (ref first, as `radioSlotFlagsRef` is kept).

- [ ] **Step 2: The step.** In the clock effect, right before `if (step.wrapped)
  radioFoldAtWrap(loopBars)` (:5211): `if (step.wrapped) radioHooksAtWrap(loopBars, step)`. It
  queues its work on the same two-microtask slot as the fold step, **queued first**, so it runs
  before the fold step and the turnaround roll (spec §10 risk 1), after this tick's landings:

```ts
  function radioHooksAtWrap(loopBars: number, step: RadioClockStep): void {
    if (!radioOnRef.current || radioHooksRef.current.hooks.length === 0) {
      radioLandingsRef.current = advanceRadioLandingWindow(radioLandingsRef.current, phraseLapsNow(loopBars))
      return
    }
    void Promise.resolve().then(() => Promise.resolve().then(() => runRadioHooksStep(loopBars, step.clock.turnaroundLap ?? 0)))
  }
```

  `runRadioHooksStep`: `stepRadioHooks(radioHooksRef.current, { loopBars, lap, phraseLaps,
  paceLevel: radioCadence.level, held: false, rows, ready, changeAtNextWrap, calmLandings,
  arcThinning, canRest: false, random: Math.random })` with:
  - `rows`: `slotsRef.current` with a candidate, `{ id, stemId: candidate.stemCID, kinds,
    eligible: radioEligibleSlotIds().includes(id) && !manualChangesRef.current.has(id),
    lastLowHeard }`;
  - `ready`: exit → `radioHookSubsRef.current.get(id)?.stem != null`; return → the hooked pick
    resolved and warm (`resolveAndWarmPick` already settled: keep the stem in a map at prepare);
  - `changeAtNextWrap`: Task 4's `forecastNow(loopBars)` has rows or an arc step;
  - `arcThinning`: `densityLegRef.current?.phase === 'thinning' && slotsRef.current.length > leg.target`.
  - **prepare:** exit → `pickForSlot(id, kinds, { avoidOwnStem: true })` →
    `resolveAndWarmPick` → `radioHookSubsRef`; return → `resolveAndWarmPick(hookPick)`.
  - **decided:** queue through `queueManualChange(id, pick, false, undoSequence.latest(), false,
    arrival, { source: 'hook', hook: event, size, hookReturn })` -- `queueManualChange` (:7982)
    gains an optional seventh `opts` argument stored on the entry; a row with a manual change
    already waiting is not queued (`withdrawRadioHookEvent`).
    - exit with a throw: `armDiscoverExitThrow(radioThrowRef.current, { slotId: id, shape:
      d.throw, pos, loopBars, bpm: bpmRef.current })`; non-null → set `radioThrowRef.current`, put
      the curve in (as `radioThrowTick` does on `'armed'`) and `scheduleSyncPreviewToEngine` now
      (the stage follows on a later tick, as a manual lead-in does). Null → a dry exit.
    - return: its `arrival` is drawn at stage time by `drawManualTransitions` with the row's
      `size` and `hookReturn: true` (Task 4 Step 7 already passes the row to `pick`).
  - `updateRadioHooks(r.state)`.

- [ ] **Step 3: Landing.** `commitSlotPick` (:7390), where it records radio's recency: when the
  commit comes from a manual entry WITHOUT `source: 'hook'` (thread a `source` through the landing
  branch that commits manual entries), `updateRadioHooks(forgetRadioHookOnManualChange(...))` and
  drop the row's hook pick when it went; every commit: `radioLandingsRef.current =
  noteRadioLandings(radioLandingsRef.current, 1)`. A hook landing must not call
  `forgetRadioSlotFlagOnChange` for another row (it does not today: it only touches its own row).
  A manual entry on a row whose hook return is queued (a swap pressed after the decision) wins
  the row: `withdrawRadioHookEvent`.

- [ ] **Step 4: Readers** (each a one-line swap):
  - `discoverTurnaroundRows` (:725): `hooked: radioHookInRow(o.hooks, s.id)`, `exiting:
    radioHookOf(o.hooks, s.id)?.decided?.event === 'exit'` (the option `flags` becomes `hooks`);
  - fold rows (:3818, :3892): `hooked: radioHookInRowNext(radioHooksRef.current, id)`;
  - `arcRemovalCandidate` (:8376): `held: radioHookReservesRow(radioHooksRef.current, s.id)`;
  - `stepArcExit` (:8456): `radioHookReservesRow(...)` instead of the flag;
  - `armRadioPick` (:8215): `eligible` filters `!radioHookTurnoverExcluded(radioHooksRef.current, id)`;
    the spares (Task 4) too;
  - `pickForSlot`'s `usedElsewhere` (:7232): add `radioHookStemsAway(radioHooksRef.current)`;
  - the forecast (Task 4's `forecastNow`): `hookReturn` and `lowEndReturn` from a decided return;
  - `likeSlot` (:6932): `likeRadioSlot` stays for the star; the hold is
    `updateRadioHooks(likeRadioStem(radioHooksRef.current, { rowId: id, stemId, rowCount,
    paceLevel, random: Math.random, canHold: radioOn && !slot.locked }).state)` and the pick into
    `radioHookPicksRef`;
  - `toggleSlotReplaceSoon` (:6946): on a row whose hook is in, `releaseRadioHook` first.
  - Stop setting `'hook'` flags: nothing calls `toggleRadioHook` / `radioHookSlotId` after this.
  - Radio off: `radioHooksStopped`; radio on: `radioHooksStarted`. `removeSlot` and
    `applySlotsSnapshot`: `pruneRadioHooks`.
- [ ] **Step 5: Readout.** `radioNextLanding`'s `manual` entries pass `hook` from the queue entry
  (`'out'` for an exit, `'back'` for a return). Flashes `hook out` / `hook back` on the row at its
  landing (`radioFlashesRef`, as a gesture flash is armed).
- [ ] **Step 6: Verify, commit.** Typecheck, eslint, `npx vitest run src/shared`. Message: `discover radio: hooks that leave and come back (spec anointed-stems section 2) -- radioHooks stepped at every wrap in the fold step's deferred slot, queued first (before the fold step and the turnaround roll); exits with the echo armed live (armDiscoverExitThrow) and the substitute through the manual queue; returns through it at their phrase start, sized and hook-marked (no manual-change bookkeeping); turnover, companions, spares and dedupe keep off a hook; fold, turnarounds and the arc read hook in / reserved; 👍 hooks, 👎 releases. No panel tests (convention); unheard by any agent`, then the trailer.

### Task 10: Desktop: the hook button, the words, and the phone

**Repo:** sssketch. **Files:** `DiscoverPanel.tsx`, `src/main/remotePage.ts`.
**Depends on:** Task 9. **Parallel with:** Task 8.

- [ ] **Step 1: The grid** (planning decision 7). `discoverRowGridColumns` (:10687) takes
  `{ radio: boolean; fold: boolean }`: radio on appends `'18px 18px'` (tracks 16, 17), fold on
  appends the readout's `44px` after them (track 18). Both callers (:10127 the overlay, :11366 the
  row) pass `{ radio: radioOn, fold: radioFoldTrack }`. The fold readout's `gridColumn: 16`
  (:12125) becomes 18. Update the track comment (:11309-11330) and the template's comment
  (:10679-10681).
- [ ] **Step 2: The buttons** (one small component, `RadioRoleButtons`, so the radio-view spec can
  move it into its `data-slot="radio-role"` slot unchanged). Track 16: hook (`<Repeat>` from
  `@phosphor-icons/react`, filled + the padlock's inverted fill while the row has a hook; tooltip
  `RADIO_HOOK_TOOLTIP` / `RADIO_HOOK_RELEASE_TOOLTIP`; disabled on a padlocked row; `onClick` →
  `toggleSlotHook(id)`: `toggleRadioHookStem` with the playing stem, the pick into
  `radioHookPicksRef`, and on a release of an away/resting hook drop its queued landings). Track
  17: dig (`<Shovel>`, hidden until Task 14). Both rendered only while `radioOn`.
- [ ] **Step 3: The row's words and the dimmed name.** The row's readout age gets ` · ` +
  `radioRoleWords(...)` (as the web); the 👍's `holding` (:11304) reads `hookIn` (a new prop:
  `radioHookInRow(radioHooks, slot.id)`), no longer `radioFlag === 'hook'`. While away, the hooked
  stem's name dimmed after the label (`data-hook-away`, `--ra-text-4`), click → `bringRadioHookBack`
  (tooltip `RADIO_HOOK_BRING_BACK_TOOLTIP`).
- [ ] **Step 4: The phone.** `runSlotAction` (:7168): `'hook'` → `toggleSlotHook`, `'dig'` →
  Task 14 (no-op until then), `'back'` → bring back. The remote state push (:6405): `roles` from
  `radioHooks` (and dig, Task 14) with `radioRoleWords(..., narrow: true)`. `remotePage.ts`
  `STEM_ACTIONS` (:164) gains `{ a: 'hook', l: 'hook', h: 'leaves, comes back' }` and, after
  Task 14, `{ a: 'dig', l: 'dig', h: 'more from here' }`; a row with `role.hook` away shows `back`
  (`{ a: 'back', l: 'back', h: 'next phrase' }`) and its `role.words` under the stem name.
  `remotePage.test.ts`: the sheet lists hook; a row's role words render.
- [ ] **Step 5: Verify, commit.** Typecheck, eslint, `npx vitest run src/main/remotePage.test.ts
  src/shared`. Message: `discover radio: the hook toggle (Repeat, track 16 while radio runs; fold's readout moves to 18), the row's role words and the away hook's name dimmed (tap: bring it back), 👍's holding mark reads a hook in; the phone's hook / back actions and role words. Unseen by any agent`, then the trailer.

**Ship point B.** Walkthrough items 1-6 and 9 (Task 16).

### Task 11 (may follow later): Resting exits, both radios

**Depends on:** Tasks 8 and 10. Do it when Elling has heard hooks with substitutes.

- [ ] **Web** (`step.ts`, `controller.ts`, `step.test.ts`):
  - `canRest: true` in `hooksAtWrap`;
  - a resting exit queues no substitute: at its line push `{ type: 'removeRow', slot, time:
    line, exitBeats: 0 }` (the engine's `removeRow` at the line, after the throw has closed: the
    throw ends ON the line and the row's fader drops there, so the post-fader send has closed),
    keep the `RadioRow` with `resting: true` (`heard` returns false for it; `eligible` ignores
    radio's own rest per the shared input's note);
  - the return re-adds it: `{ type: 'addRow', slot, time: line, record, bpm, pan: row.pan,
    muted: !heard, transition }`;
  - `lowEndReturn` for a resting drums/bass row coming back; `ArcRow`-equivalent `removalVictim`
    and the arc's count treat a resting row as unheard;
  - tests: a resting exit while thinning (arc on), the echo rings over the line, the row is
    silent, it returns on a phrase start through `addRow`.
- [ ] **Desktop** (`DiscoverPanel.tsx`): `canRest: true`; a resting exit takes the row out of the
  previewing mix at the line (the arc exit's mechanism without removing the slot: a `drop-out`
  gesture with `exitBeats` 0 at the top, then `previewing` minus the row), and the return joins it
  back as a joining manual change (`joining: true`). `ArcRow.heard` false while resting.
- [ ] Commit each repo. Messages: `radio hooks: resting exits -- ...` (say what was measured).

---

## Phase 3: dig

### Task 12: Dig, shared (`radioDig.ts`, `discoverRanking.ts`)

**Parallel-safe** with everything above (a new file, an optional ranking option).
**Depends on:** nothing.

**Files:** create `src/shared/radioDig.ts`, `src/shared/radioDig.test.ts`; modify
`src/shared/discoverRanking.ts`.

- [ ] **Step 1: The failing test.** Create `src/shared/radioDig.test.ts`:

```ts
// Dig (spec 2026-10-03-radio-anointed-stems-design section 3): the anchor, the near draw and the
// ranking term.
import { describe, expect, it } from 'vitest'
import type { DiscoverCandidate } from './discoverCandidate'
import { rankCandidates } from './discoverRanking'
import { favesDraw } from './discoverFaves'
import {
  DIG_NEAR_SEC,
  DIG_NEAR_SHARE,
  DIG_TIME_SCALE_SEC,
  DIG_WEIGHT,
  digNearDraw,
  isNearForDig,
  radioDigAnchorStemId,
  radioDigCloseness,
  toggleRadioDig,
  type RankDig
} from './radioDig'
import { seededRandom } from './seededRandom'

const c = (o: Partial<DiscoverCandidate>): DiscoverCandidate => ({
  stemCID: 's',
  jamCID: 'j',
  riffCID: 'r',
  presetName: '',
  creatorUserName: 'elling',
  slotKinds: ['lead'],
  drumSubRole: null,
  riffBpm: 120,
  traitValues: {},
  traitPercentiles: {},
  kindSources: {},
  riffCreationTime: null,
  ...o
})
const DIG: RankDig = { jamCID: 'j', t: 1000, traits: { bright: 0.8 } }

describe('the anchor and the toggle', () => {
  it('one dug row: tapping another moves it, tapping it again stops', () => {
    expect(toggleRadioDig(null, 'a')).toBe('a')
    expect(toggleRadioDig('a', 'b')).toBe('b')
    expect(toggleRadioDig('a', 'a')).toBeNull()
  })
  it('a dug row with a hook anchors on the hook', () => {
    expect(radioDigAnchorStemId('sub', 'hooked')).toBe('hooked')
    expect(radioDigAnchorStemId('playing', null)).toBe('playing')
  })
})

describe('closeness', () => {
  it('the parts: jam 0.5, time 0.3, traits 0.2, the trait part neutral when unknown', () => {
    expect(
      radioDigCloseness(DIG, c({ riffCreationTime: 1000, traitPercentiles: { bright: 0.8 } }))
    ).toBeCloseTo(1)
    expect(radioDigCloseness(DIG, c({ jamCID: 'x' }))).toBeCloseTo(0.1)
    expect(radioDigCloseness(DIG, c({}))).toBeCloseTo(0.5 + 0.1)
    expect(
      radioDigCloseness(DIG, c({ jamCID: 'x', riffCreationTime: 1000 + DIG_TIME_SCALE_SEC }))
    ).toBeCloseTo(0.3 * Math.exp(-1) + 0.1)
    expect(
      radioDigCloseness(DIG, c({ jamCID: 'x', traitPercentiles: { bright: 0.3 } }))
    ).toBeCloseTo(0.2 * 0.5)
  })
  it('a riff neighbour is near in time, whatever the clock says', () => {
    const dig = { ...DIG, nearRiffCIDs: new Set(['n']) }
    expect(radioDigCloseness(dig, c({ riffCID: 'n', riffCreationTime: 1e9 }))).toBeCloseTo(
      0.5 + 0.3 + 0.1
    )
    // the web's candidates have no riff: never a neighbour
    expect(
      radioDigCloseness({ ...DIG, nearRiffCIDs: new Set(['']) }, c({ riffCID: '' }))
    ).toBeCloseTo(0.6)
  })
})

describe('rankCandidates dig', () => {
  const pool = Array.from({ length: 40 }, (_, i) =>
    c({
      stemCID: `s${i}`,
      jamCID: i % 3 === 0 ? 'j' : `j${i}`,
      riffBpm: 100 + i,
      riffCreationTime: 1000 + i * 3600,
      traitPercentiles: { bright: (i % 10) / 10 }
    })
  )
  it('absent: identical ranking', () => {
    const a = rankCandidates(pool, { targetBpm: 120 })
    const b = rankCandidates(pool, { targetBpm: 120, dig: undefined })
    expect(b).toEqual(a)
  })
  it('the term is between 0 and DIG_WEIGHT, added to every candidate', () => {
    const plain = new Map(
      rankCandidates(pool, { targetBpm: 120 }).map((r) => [r.candidate.stemCID, r.score])
    )
    for (const r of rankCandidates(pool, { targetBpm: 120, dig: DIG })) {
      const d = r.score - plain.get(r.candidate.stemCID)!
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(DIG_WEIGHT + 1e-9)
    }
  })
})

describe('the near draw', () => {
  it('a third of picks while on; no draw at all while off', () => {
    let n = 0
    const r = seededRandom('near')
    const counting = (): number => {
      n++
      return r()
    }
    expect(digNearDraw(false, counting)).toBe(false)
    expect(n).toBe(0)
    let near = 0
    for (let i = 0; i < 10000; i++) if (digNearDraw(true, counting)) near++
    expect(n).toBe(10000)
    expect(near / 10000).toBeCloseTo(DIG_NEAR_SHARE, 1)
  })
  it('composes after the faves draw: favourites-only first, so the dig draw is the second', () => {
    const r = seededRandom('order')
    const draws: string[] = []
    const tag = (name: string) => (): number => {
      draws.push(name)
      return r()
    }
    favesDraw(50, tag('faves'))
    digNearDraw(true, tag('dig'))
    expect(draws).toEqual(['faves', 'dig'])
  })
  it("the web's near pool: same jam, within 3 hours; unknown time or wide: the whole jam", () => {
    const anchor = { jamCID: 'j', t: 10000 }
    expect(isNearForDig(anchor, { jam: 'j', t: 10000 + DIG_NEAR_SEC })).toBe(true)
    expect(isNearForDig(anchor, { jam: 'j', t: 10000 + DIG_NEAR_SEC + 1 })).toBe(false)
    expect(isNearForDig(anchor, { jam: 'j', t: 10000 + DIG_NEAR_SEC + 1 }, true)).toBe(true)
    expect(isNearForDig(anchor, { jam: 'j', t: null })).toBe(true)
    expect(isNearForDig({ jamCID: 'j', t: null }, { jam: 'j', t: 5 })).toBe(true)
    expect(isNearForDig(anchor, { jam: 'k', t: 10000 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail** (`./radioDig` does not resolve).
- [ ] **Step 3: Implement.** Create `src/shared/radioDig.ts`:

```ts
// src/shared/radioDig.ts
//
// DIG (docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md section 3): "more from
// around here" without freezing anything. One dug row at a time; while it is on, a third of radio's
// picks are drawn only from near the dug stem (the same jam, close in time -- the desktop: its riff
// neighbours), and every pick leans toward it in rankCandidates (DIG_WEIGHT * closeness). The dig
// follows its row: the anchor is the stem the row plays now, or its hook's when it has one.
//
// Pure. No dig: no draw, and rankCandidates is exactly as without it.

import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverTraitKind } from './discoverSlotKind'

/** Share of picks drawn only from near the anchor, while dig is on. */
export const DIG_NEAR_SHARE = 1 / 3
/** The web's near pool: the same jam, within this many seconds of the anchor's creation time. */
export const DIG_NEAR_SEC = 3 * 3600
/** How fast closeness in time falls off, across jams too (the same week in another jam is near). */
export const DIG_TIME_SCALE_SEC = 6 * 3600
/** The ranking term's weight: under one trait (1) and the favourite boost (1.5). */
export const DIG_WEIGHT = 0.75
/** The parts of closeness. */
export const DIG_CLOSENESS_PARTS = Object.freeze({ jam: 0.5, time: 0.3, traits: 0.2 })
/** The readout's log word when a near-only pick found nothing. */
export const NO_NEAR_FITS = 'no near fits'

const TRAIT_KINDS: readonly DiscoverTraitKind[] = ['bassHeavy', 'rhythmic', 'bright', 'warm']

/** The dug stem, as both runtimes know it: the web from its index record, the desktop from its
 * candidate (riffCreationTime, traitPercentiles, riffCID). */
export interface RadioDigAnchor {
  rowId: string
  stemId: string
  jamCID: string
  /** Creation time, Unix seconds; null unknown. */
  t: number | null
  traits: Partial<Record<DiscoverTraitKind, number | null>>
  riffCID?: string
}

/** What rankCandidates' `dig` reads. */
export interface RankDig {
  jamCID: string
  t: number | null
  traits: Partial<Record<DiscoverTraitKind, number | null>>
  /** The desktop's riff-sequence neighbours (getAdjacentDiscoverCandidates): near in time. */
  nearRiffCIDs?: ReadonlySet<string>
}

/** The row's dig toggle: dig this row, move the dig here, or (tapped again) stop. */
export function toggleRadioDig(dugRowId: string | null, rowId: string): string | null {
  return dugRowId === rowId ? null : rowId
}

/** The stem a dug row anchors on: its hook's (in or away) when it has one, else what it plays. */
export function radioDigAnchorStemId(
  playingStemId: string | null,
  hookStemId: string | null
): string | null {
  return hookStemId ?? playingStemId
}

export function rankDigOf(
  anchor: RadioDigAnchor | null,
  nearRiffCIDs?: ReadonlySet<string>
): RankDig | undefined {
  if (anchor === null) return undefined
  return {
    jamCID: anchor.jamCID,
    t: anchor.t,
    traits: anchor.traits,
    ...(nearRiffCIDs !== undefined ? { nearRiffCIDs } : {})
  }
}

/** Whether this pick is drawn only from near the anchor: one draw while dig is on, none off. */
export function digNearDraw(on: boolean, random: () => number = Math.random): boolean {
  return on && random() < DIG_NEAR_SHARE
}

/** The web's near pool: the same jam and within DIG_NEAR_SEC; with `t` unknown on either side,
 * the whole jam. `wide`: the whole jam (the widening when the narrow pool has nothing unused). */
export function isNearForDig(
  anchor: Pick<RadioDigAnchor, 'jamCID' | 't'>,
  record: { jam: string; t: number | null },
  wide = false
): boolean {
  if (record.jam !== anchor.jamCID) return false
  if (wide || anchor.t === null || record.t === null) return true
  return Math.abs(record.t - anchor.t) <= DIG_NEAR_SEC
}

const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** How near a candidate is to the dug stem, 0..1: 0.5 the same jam, 0.3 closeness in time (1 for
 * a riff neighbour), 0.2 closeness in traits (0.5 when no trait is known on both sides). */
export function radioDigCloseness(
  dig: RankDig,
  c: Pick<DiscoverCandidate, 'jamCID' | 'riffCID' | 'riffCreationTime' | 'traitPercentiles'>
): number {
  const sameJam = c.jamCID === dig.jamCID ? 1 : 0
  let timeNear = 0
  if (dig.nearRiffCIDs !== undefined && c.riffCID !== '' && dig.nearRiffCIDs.has(c.riffCID)) {
    timeNear = 1
  } else if (finite(dig.t) && finite(c.riffCreationTime)) {
    timeNear = Math.exp(-Math.abs(c.riffCreationTime - dig.t) / DIG_TIME_SCALE_SEC)
  }
  let sum = 0
  let n = 0
  for (const k of TRAIT_KINDS) {
    const a = dig.traits[k]
    const b = c.traitPercentiles?.[k]
    if (finite(a) && finite(b)) {
      sum += Math.abs(b - a)
      n++
    }
  }
  const traitNear = n === 0 ? 0.5 : 1 - sum / n
  const p = DIG_CLOSENESS_PARTS
  return p.jam * sameJam + p.time * timeNear + p.traits * traitNear
}
```

  and in `discoverRanking.ts`:

```diff
--- a/src/shared/discoverRanking.ts
+++ b/src/shared/discoverRanking.ts
@@ -7,6 +7,7 @@ import {
 } from './discoverTraits'
 import type { DiscoverTraitKind } from './discoverSlotKind'
 import { radioClashBedScore, radioClashTraitScore, type RankClash } from './radioClash'
+import { DIG_WEIGHT, radioDigCloseness, type RankDig } from './radioDig'
 
 export interface RankedCandidate {
   candidate: DiscoverCandidate
@@ -83,7 +84,8 @@ export function rankCandidates(
     favouriteWeight,
     favouriteScale = 1,
     targetTraits = [],
-    clash
+    clash,
+    dig
   }: {
     targetBpm: number
     favouriteStemCIDs?: ReadonlySet<string>
@@ -101,6 +103,9 @@ export function rankCandidates(
      * turns toward its other end, and distance from the bed on those two traits scores. Absent
      * or amount 0: exactly the ranking without it. */
     clash?: RankClash
+    /** Radio's dig (@shared/radioDig): every candidate gains DIG_WEIGHT * its closeness to the
+     * dug stem (0 to 0.75). Absent: no term, exactly the ranking without it. */
+    dig?: RankDig
   }
 ): RankedCandidate[] {
   // Pool-relative values per kind, for candidates without a library
@@ -164,6 +169,7 @@ export function rankCandidates(
         score += radioClashTraitScore(kind, trait, clash?.amount ?? 0) * TRAIT_SCORE_WEIGHT
       }
       if (clash) score += radioClashBedScore(candidate.traitPercentiles ?? {}, clash)
+      if (dig) score += DIG_WEIGHT * radioDigCloseness(dig, candidate)
       return { candidate, score }
     })
     .sort((a, b) => b.score - a.score)
```

- [ ] **Step 4: Run** `npx vitest run src/shared/radioDig.test.ts src/shared/discoverRanking.test.ts`
  (9 + the ranking suite, green).
- [ ] **Step 5: Lint, typecheck (both repos), commit.** Message: `radio dig: the shared rules (spec anointed-stems section 3) -- one dug row (toggleRadioDig), anchored on its hook's stem when it has one; the near draw (a third of picks, one draw while on, none off); the web's near pool (same jam, 3 hours, widening to the jam); radioDigCloseness (0.5 same jam, 0.3 time or a riff neighbour, 0.2 traits, neutral when unknown) and rankCandidates' dig term (0 to 0.75; absent: identical ranking)`, then the trailer.

### Task 13: Web radio: dig

**Repo:** ell.ing/radio. **Depends on:** Tasks 8 and 12. **Parallel with:** Task 14.

- [ ] **Step 1: Tests.**
  - `pick.test.ts`: with `dig: { anchor, near: true }`, every pick is from the anchor's jam within
    3 h when one is unused; with none unused, the whole jam; with none at all, a normal pick that
    says `no near fits` (an `onNearFallback` callback, as `onFavesFallback`); with faves 100 the
    faves pool wins and dig only ranks inside it; with `dig` absent, picks are identical to
    today's for 500 seeds (same random stream).
  - `step.test.ts`: `{ type: 'dig', slot }` sets `s.dig`; tapping another row moves it; again: off;
    the dug row's anchor follows its row (a landing there re-anchors), and is its hook's stem when
    it has one; every `arm` action carries `dig` while on; no `dig` in any `arm` with it off
    (byte-identity with the harness).
- [ ] **Step 2: `pick.ts`.** `PickOptions` (:86) gains `dig?: { anchor: RadioDigAnchor; on: boolean }`
  and `onNearFallback?: () => void`. In `pickStem` (:286), after the faves block (:327-334) and
  only when it did not go favourites-only:

```ts
  if (drawn === null && opts.dig && digNearDraw(opts.dig.on, random)) {
    const { anchor } = opts.dig
    let near = drawPool((r) => isNearForDig(anchor, r))
    if (!near.pool.candidates.some(unused)) near = drawPool((r) => isNearForDig(anchor, r, true))
    if (near.pool.candidates.some(unused)) drawn = near
    else opts.onNearFallback?.()
  }
```

  (the faves block must leave `drawn` null on a normal draw: it does today, `drawn ??= drawPool()`
  comes after). Then `rankCandidates(..., { ..., ...(opts.dig ? { dig: rankDigOf(opts.dig.anchor) } : {}) })`.
- [ ] **Step 3: `step.ts`.** `RadioState.dig: string | null` (the dug row). Event `{ type: 'dig';
  slot }` → `toggleRadioDig`. `pushArm` (:1806) adds `dig: { anchor, on: true }` while a row is dug
  and running, the anchor built from the dug row's record (or `hookRecords[row]` when it has a
  hook): `{ rowId, stemId: rec.id, jamCID: rec.jam, t: rec.t, traits: rec.traits ?? {} }`. A dug
  row removed: `dig = null`. `RadioRowView.dig`. Flash `dig` on set.
- [ ] **Step 4: Controller and UI.** `controller.ts` `case 'arm'` (:354) passes `a.dig` and the
  `no near fits` flash (`NO_NEAR_FITS`), as faves' fallback; `dig(slot)` dispatches the event.
  `full.ts`: the dig button (Task 8's, unhidden), pressed while `digOn`; `fullModel.ts` `digOn`,
  role words with `dig`. `main.ts`: `'dig'` → `radio.dig(slot)`.
- [ ] **Step 5: Run, harness, typecheck, commit.** Measure (one dug row, 4 seeds × 900 s): share
  of picks from the anchor's jam with dig on vs off. Message: `radio: dig (spec anointed-stems section 3) -- one dug row (tap moves it, again stops), its anchor following the row (the hook's stem when it has one); a third of picks from the anchor's jam within 3 hours (widening to the jam, then a normal pick that says no near fits), after the faves draw; every pick leans to it (rankCandidates dig). Measured: <share>. No dig: byte-identical`, then the trailer.

### Task 14: Desktop: dig

**Repo:** sssketch. **File:** `DiscoverPanel.tsx`. **Depends on:** Tasks 10 and 12.

- [ ] **Step 1: State.** `const [radioDig, setRadioDig] = useState<string | null>(null)` and a ref.
  `toggleSlotDig(id)` → `toggleRadioDig`. The anchor: the dug row's candidate (or its hook's pick's
  candidate): `{ rowId, stemId: c.stemCID, jamCID: c.jamCID, t: c.riffCreationTime, traits:
  c.traitPercentiles, riffCID: c.riffCID }`.
- [ ] **Step 2: `pickForSlot`** (:7186), only while radio runs and a row is dug: after the faves
  block (:7290-7296), when it did not go favourites-only and `digNearDraw(true)`:
  - `const near = await window.rifffApi.getAdjacentDiscoverCandidates(anchor.riffCID, kinds,
    draw.first, f.artist)` (the creator filter keeps artist mode inside the artist);
  - `candidates = [...near.newer, ...near.older]` when any is unused; else log `no near fits` and
    fall through to `fetchPool()`;
  - every roll while dug: `rankCandidates(..., { ..., dig: rankDigOf(anchor, new Set(neighbour
    riffCIDs)) })` -- the neighbours from the same call, cached per anchor riff
    (`radioDigNearRef`, refreshed when the anchor changes).
- [ ] **Step 3: UI and phone.** Track 17's dig button unhidden; role words with `dig`; flash `dig`
  on set; `runSlotAction` `'dig'`; the phone's sheet gains dig (Task 10 Step 4).
- [ ] **Step 4: Verify, commit.** Message: `discover radio: dig (spec anointed-stems section 3) -- one dug row (track 17, the phone), its anchor following the row; a third of radio's picks from its riff neighbours (getAdjacentDiscoverCandidates, the creator filter kept), every pick leaning to it (rankCandidates dig with the neighbours as near in time). Unheard by any agent`, then the trailer.

**Ship point C.** Walkthrough item 7.

---

### Task 15: Retire the old hook flag (`radioSlotFlags.ts`)

**Depends on:** Tasks 7 and 9 committed (no runtime reads `'hook'` flags, `toggleRadioHook`,
`radioHookSlotId` or `HOOK_HOLD_FACTOR`). Check first, in both repos:
`grep -rn "toggleRadioHook\|radioHookSlotId\|HOOK_HOLD_FACTOR\|=== 'hook'" src` -- nothing outside
`src/shared/radioSlotFlags*` and `radioSchedule.test.ts`.

**Files:** `src/shared/radioSlotFlags.ts`, `radioSlotFlags.test.ts`, `radioSchedule.test.ts`.

- [ ] **Step 1: Apply** (the tests first: they lose the hook's 20 tests and gain two for what is left):

```diff
--- a/src/shared/radioSchedule.test.ts
+++ b/src/shared/radioSchedule.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest'
-import { HOOK_HOLD_FACTOR, REPLACE_SOON_FACTOR, type RadioSlotFlags } from './radioSlotFlags'
+import { REPLACE_SOON_FACTOR, type RadioSlotFlags } from './radioSlotFlags'
 import {
   DEFAULT_RADIO_LOOP_END_BARS,
   DEFAULT_RADIO_PACE,
@@ -774,61 +774,6 @@ describe('turnover fairness, the hook and replace-soon', () => {
     expect(seen).toEqual(new Set(['a', 'b', 'c']))
   })
 
-  it('holds the hook eight times longer, under either turnover mode', () => {
-    const random = lcg(11)
-    let hookWins = 0
-    for (let i = 0; i < 400; i++) {
-      const picked = pickRadioSlotId(['hook', 'other'], null, {
-        turnover: 'random',
-        flags: { hook: 'hook' },
-        random
-      })
-      if (picked === 'hook') hookWins++
-    }
-    expect(HOOK_HOLD_FACTOR).toBe(8)
-    // weights 1/8 and 1 -> the hook takes about one in nine.
-    expect(hookWins).toBeGreaterThan(10)
-    expect(hookWins).toBeLessThan(100)
-  })
-
-  it('still turns the hook over eventually, because its staleness grows', () => {
-    const ids = ['hook', 'b', 'c']
-    const changedAt = new Map<string, number>()
-    let last: string | null = null
-    const random = lcg(5)
-    let hookPicked = false
-    for (let turn = 1; turn <= 200; turn++) {
-      const picked = pickRadioSlotId(ids, last, {
-        turnover: 'even',
-        changedAt,
-        turn,
-        flags: { hook: 'hook' },
-        random
-      })
-      if (picked === null) continue
-      if (picked === 'hook') hookPicked = true
-      changedAt.set(picked, turn)
-      last = picked
-    }
-    // A hook that NEVER turns over is the padlock, which already exists.
-    expect(hookPicked).toBe(true)
-  })
-
-  it('holds a hooked layer more than twice as long as a normal one', () => {
-    // The steady-state numbers Elling can hear. Four layers, `even`.
-    // Measured: a normal layer every 4.0 turns, a hooked one every 9.7 --
-    // NOT eight times, because the divisor is fighting the hook's own
-    // staleness, which grows every turn it is passed over. That is the
-    // design working, not the design missing: at `mid` (about 28s a turn)
-    // it is two minutes against four and a half.
-    const ids = ['a', 'b', 'c', 'd']
-    const plain = meanTurnsBetweenChanges('even', ids, 'a', {}, 4000, lcg(21))
-    const hooked = meanTurnsBetweenChanges('even', ids, 'a', { a: 'hook' }, 4000, lcg(21))
-    expect(plain).toBeGreaterThan(3.5)
-    expect(plain).toBeLessThan(4.5)
-    expect(hooked).toBeGreaterThan(2 * plain)
-  })
-
   it('makes a tired layer the next change more often than not', () => {
     // The ONE-SHOT number, which is the right one for replace-soon: the
     // flag is cleared by the change that honours it, so what matters is
@@ -905,12 +850,6 @@ describe('turnover fairness, the hook and replace-soon', () => {
       ).not.toBe('a')
     }
   })
-
-  it('still answers when the hook is the only eligible layer left', () => {
-    expect(pickRadioSlotId(['hook'], null, { turnover: 'even', flags: { hook: 'hook' } })).toBe(
-      'hook'
-    )
-  })
 })
 
 describe('isRadioEligibleSlot', () => {
--- a/src/shared/radioSlotFlags.test.ts
+++ b/src/shared/radioSlotFlags.test.ts
@@ -1,32 +1,46 @@
 import { describe, expect, it } from 'vitest'
 import {
-  HOOK_HOLD_FACTOR,
   NO_RADIO_SLOT_FLAGS,
   REPLACE_SOON_FACTOR,
   forgetRadioSlotFlagOnChange,
   likeRadioSlot,
   pruneRadioSlotFlags,
-  radioHookSlotId,
   radioSlotFlagOf,
   radioSlotFlagWeightFactor,
-  toggleRadioHook,
   toggleRadioReplaceSoon,
   type RadioSlotFlags
 } from './radioSlotFlags'
 
+describe('radioSlotFlagWeightFactor', () => {
+  it('hurries a tired layer; the hook is no longer a flag (radioHooks.ts)', () => {
+    expect(radioSlotFlagWeightFactor('replace-soon')).toBe(REPLACE_SOON_FACTOR)
+    expect(radioSlotFlagWeightFactor(null)).toBe(1)
+  })
+})
+
+describe('likeRadioSlot', () => {
+  it('stars an unstarred stem; holding, it clears change soon on the liked row', () => {
+    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
+    const out = likeRadioSlot(tired, 'a', { starred: false, canHold: true })
+    expect(out.starred).toBe(true)
+    expect(radioSlotFlagOf(out.flags, 'a')).toBeNull()
+    expect(likeRadioSlot(tired, 'a', { starred: false, canHold: false }).flags).toBe(tired)
+  })
+
+  it('un-stars a starred stem and leaves the flags alone', () => {
+    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
+    const out = likeRadioSlot(tired, 'a', { starred: true, canHold: true })
+    expect(out.starred).toBe(false)
+    expect(out.flags).toBe(tired)
+  })
+})
+
 describe('forgetRadioSlotFlagOnChange', () => {
   it('drops replace-soon on the layer the change landed on', () => {
     const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
     expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(tired, 'a'), 'a')).toBeNull()
   })
 
-  it('keeps the hook through the change that turns it over', () => {
-    // The hook is a statement about the channel, not about the stem that
-    // happens to be in it.
-    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(hooked, 'a'), 'a')).toBe('hook')
-  })
-
   it('leaves every other layer alone', () => {
     let flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
     flags = toggleRadioReplaceSoon(flags, 'b')
@@ -35,14 +49,14 @@ describe('forgetRadioSlotFlagOnChange', () => {
   })
 
   it('returns the same object when there was nothing to forget', () => {
-    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    expect(forgetRadioSlotFlagOnChange(hooked, 'b')).toBe(hooked)
+    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
+    expect(forgetRadioSlotFlagOnChange(tired, 'b')).toBe(tired)
   })
 })
 
 describe('pruneRadioSlotFlags', () => {
   it('drops a removed slot and keeps the live ones', () => {
-    let flags = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
+    let flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
     flags = toggleRadioReplaceSoon(flags, 'b')
     const pruned = pruneRadioSlotFlags(flags, new Set(['b']))
     expect(radioSlotFlagOf(pruned, 'a')).toBeNull()
@@ -50,76 +64,9 @@ describe('pruneRadioSlotFlags', () => {
   })
 
   it('returns the same object when every flagged slot is still live', () => {
-    const flags = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
+    const flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
     expect(pruneRadioSlotFlags(flags, new Set(['a', 'b']))).toBe(flags)
   })
-
-  it('frees the hook, so a re-added slot can take it', () => {
-    const flags = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    const pruned = pruneRadioSlotFlags(flags, new Set<string>())
-    expect(radioHookSlotId(pruned)).toBeNull()
-  })
-})
-
-describe('radioSlotFlagWeightFactor', () => {
-  it('holds the hook and hurries a tired layer, on opposite sides of 1', () => {
-    expect(radioSlotFlagWeightFactor(null)).toBe(1)
-    expect(radioSlotFlagWeightFactor('hook')).toBe(1 / HOOK_HOLD_FACTOR)
-    expect(radioSlotFlagWeightFactor('replace-soon')).toBe(REPLACE_SOON_FACTOR)
-    expect(radioSlotFlagWeightFactor('hook')).toBeLessThan(1)
-    expect(radioSlotFlagWeightFactor('replace-soon')).toBeGreaterThan(1)
-  })
-
-  it('is deliberately NOT symmetrical', () => {
-    // A divisor fights the unbounded (staleness + 1) growth and is
-    // eventually overcome by it; a multiplier COMPOUNDS with that same
-    // growth, and a layer flagged as tired is by definition already stale.
-    // Equal numbers would not be equal claims.
-    expect(REPLACE_SOON_FACTOR).toBeLessThan(HOOK_HOLD_FACTOR)
-  })
-})
-
-describe('toggleRadioHook', () => {
-  it('reports no hook when nothing is hooked', () => {
-    expect(radioHookSlotId(NO_RADIO_SLOT_FLAGS)).toBeNull()
-  })
-
-  it('turns the hook on, and off again', () => {
-    const on = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    expect(radioSlotFlagOf(on, 'a')).toBe('hook')
-    expect(radioSlotFlagOf(toggleRadioHook(on, 'a'), 'a')).toBeNull()
-  })
-
-  it('moves the hook -- two centres is no centre', () => {
-    const first = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    const second = toggleRadioHook(first, 'b')
-    expect(radioSlotFlagOf(second, 'a')).toBeNull()
-    expect(radioHookSlotId(second)).toBe('b')
-  })
-
-  it('replaces replace-soon on the same row', () => {
-    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
-    expect(radioSlotFlagOf(toggleRadioHook(tired, 'a'), 'a')).toBe('hook')
-  })
-
-  it('leaves replace-soon on other rows alone', () => {
-    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'b')
-    expect(radioSlotFlagOf(toggleRadioHook(tired, 'a'), 'b')).toBe('replace-soon')
-  })
-
-  it('never mutates what it is given', () => {
-    const before: RadioSlotFlags = Object.freeze({ a: 'hook', b: 'replace-soon' })
-    const snapshot = structuredClone(before)
-    toggleRadioHook(before, 'c')
-    toggleRadioHook(before, 'a')
-    toggleRadioHook(before, 'b')
-    expect(before).toEqual(snapshot)
-  })
-
-  it('turning it off leaves every other row exactly as it was', () => {
-    const flags: RadioSlotFlags = { a: 'hook', c: 'replace-soon', d: 'replace-soon' }
-    expect(toggleRadioHook(flags, 'a')).toEqual({ c: 'replace-soon', d: 'replace-soon' })
-  })
 })
 
 describe('toggleRadioReplaceSoon', () => {
@@ -135,20 +82,8 @@ describe('toggleRadioReplaceSoon', () => {
     for (const id of ['a', 'b', 'c']) expect(radioSlotFlagOf(flags, id)).toBe('replace-soon')
   })
 
-  it('replaces the hook on the same row', () => {
-    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    const tired = toggleRadioReplaceSoon(hooked, 'a')
-    expect(radioSlotFlagOf(tired, 'a')).toBe('replace-soon')
-    expect(radioHookSlotId(tired)).toBeNull()
-  })
-
-  it('never costs the hook on another row', () => {
-    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    expect(radioHookSlotId(toggleRadioReplaceSoon(hooked, 'b'))).toBe('a')
-  })
-
   it('never mutates what it is given', () => {
-    const before: RadioSlotFlags = Object.freeze({ a: 'hook', b: 'replace-soon' })
+    const before: RadioSlotFlags = Object.freeze({ b: 'replace-soon' })
     const snapshot = structuredClone(before)
     toggleRadioReplaceSoon(before, 'c')
     toggleRadioReplaceSoon(before, 'a')
@@ -157,51 +92,7 @@ describe('toggleRadioReplaceSoon', () => {
   })
 
   it('turning it off leaves every other row exactly as it was', () => {
-    const flags: RadioSlotFlags = { a: 'replace-soon', b: 'hook', c: 'replace-soon' }
-    expect(toggleRadioReplaceSoon(flags, 'a')).toEqual({ b: 'hook', c: 'replace-soon' })
-  })
-})
-
-describe('likeRadioSlot', () => {
-  it('stars an unstarred stem and turns hold longer on', () => {
-    const out = likeRadioSlot(NO_RADIO_SLOT_FLAGS, 'a', { starred: false, canHold: true })
-    expect(out.starred).toBe(true)
-    expect(radioSlotFlagOf(out.flags, 'a')).toBe('hook')
-  })
-
-  it('leaves an existing hold on (never toggles it off)', () => {
-    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    const out = likeRadioSlot(held, 'a', { starred: false, canHold: true })
-    expect(out.starred).toBe(true)
-    expect(out.flags).toBe(held)
-  })
-
-  it('takes the one hold from another row', () => {
-    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'b')
-    const out = likeRadioSlot(held, 'a', { starred: false, canHold: true })
-    expect(radioHookSlotId(out.flags)).toBe('a')
-    expect(radioSlotFlagOf(out.flags, 'b')).toBeNull()
-  })
-
-  it('turns change next into hold on the liked row', () => {
-    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
-    const out = likeRadioSlot(tired, 'a', { starred: false, canHold: true })
-    expect(radioSlotFlagOf(out.flags, 'a')).toBe('hook')
-  })
-
-  it('un-stars a starred stem and leaves the flags alone', () => {
-    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
-    const out = likeRadioSlot(held, 'a', { starred: true, canHold: true })
-    expect(out.starred).toBe(false)
-    expect(out.flags).toBe(held)
-    const none = likeRadioSlot(NO_RADIO_SLOT_FLAGS, 'a', { starred: true, canHold: true })
-    expect(none.flags).toBe(NO_RADIO_SLOT_FLAGS)
-  })
-
-  it('only stars when it cannot hold (radio off or padlocked)', () => {
-    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'b')
-    const out = likeRadioSlot(held, 'a', { starred: false, canHold: false })
-    expect(out.starred).toBe(true)
-    expect(out.flags).toBe(held)
+    const flags: RadioSlotFlags = { a: 'replace-soon', b: 'replace-soon', c: 'replace-soon' }
+    expect(toggleRadioReplaceSoon(flags, 'a')).toEqual({ b: 'replace-soon', c: 'replace-soon' })
   })
 })
--- a/src/shared/radioSlotFlags.ts
+++ b/src/shared/radioSlotFlags.ts
@@ -51,7 +51,7 @@
  * isRadioEligibleSlot drops a locked slot before any weight is computed, so
  * a flag on a locked layer is simply inert until the lock comes off, which
  * is the same thing the spec means by the hook surviving a lock. */
-export type RadioSlotFlag = 'hook' | 'replace-soon'
+export type RadioSlotFlag = 'replace-soon'
 
 /** Flags by slot id, absent meaning normal.
  *
@@ -63,23 +63,12 @@ export type RadioSlotFlags = Readonly<Record<string, RadioSlotFlag>>
 
 export const NO_RADIO_SLOT_FLAGS: RadioSlotFlags = {}
 
-/** How much longer the hook holds than everything else -- a DIVISOR on its
- * draw weight, which is why it composes with both turnover modes for free:
- * under `random` every base weight is 1, so the hook is simply drawn an
- * eighth as often, and under `even` its staleness keeps growing while it
- * waits, so it climbs back toward eligibility on its own.
- *
- * That last part is the answer to "does the hook ever turn over?" -- yes,
- * and it has to, because a layer that never turns over is what the padlock
- * is already for.
- *
- * It is also why the hold is NOT eight times in practice. Measured over
- * four layers under `even`: a normal layer changes every 4.0 turns and a
- * hooked one every 9.7, because the divisor is being climbed at every turn
- * by the hook's own growing staleness. At `mid` (about 28s realised per
- * turn) that is two minutes against four and a half -- which is the hold
- * Elling noticed and liked before anyone built a control for it. */
-export const HOOK_HOLD_FACTOR = 8
+/** (2026-10-03) The hook is no longer a flag: it is a STEM that leaves and comes back
+ * (radioHooks.ts, spec 2026-10-03-radio-anointed-stems-design). Its old divisor (HOOK_HOLD_FACTOR,
+ * 8: "a normal layer changes every 4.0 turns and a hooked one every 9.7") is gone with it; a hook
+ * in is simply left out of radio's turnover (radioHookTurnoverExcluded). The comments below that
+ * argue against the hook's numbers are kept as the record of why replace-soon's are what they
+ * are. */
 
 /** How much sooner a layer flagged `replace-soon` comes round -- a
  * MULTIPLIER, and deliberately not 8.
@@ -132,7 +121,6 @@ export const REPLACE_SOON_FACTOR = 4
  * controls together are a single term in pickRadioSlotId's formula rather
  * than a branch in it. */
 export function radioSlotFlagWeightFactor(flag: RadioSlotFlag | null): number {
-  if (flag === 'hook') return 1 / HOOK_HOLD_FACTOR
   if (flag === 'replace-soon') return REPLACE_SOON_FACTOR
   return 1
 }
@@ -141,61 +129,23 @@ export function radioSlotFlagOf(flags: RadioSlotFlags, id: string): RadioSlotFla
   return flags[id] ?? null
 }
 
-/** The hooked slot, or null. At most one can exist -- toggleRadioHook is
- * the only writer of `hook` and it guarantees it -- so this is a lookup,
- * not a choice. */
-export function radioHookSlotId(flags: RadioSlotFlags): string | null {
-  for (const [id, flag] of Object.entries(flags)) if (flag === 'hook') return id
-  return null
-}
-
-/** The row's "hold longer" control: hook this slot, or release it.
- *
- * AT MOST ONE HOOK. Two hooks is two centres, which is no centre, so
- * hooking this slot releases any hook on another -- the way a radio button
- * does. That release is visible: every row is on screen, and the other
- * row's hand goes dark in the same render. (The old single cycle button
- * could reach this state by accident on its way somewhere else; two
- * separate controls cannot.)
- *
- * One flag per slot, so hooking a slot that was marked replace-soon
- * replaces that mark. Replace-soon on OTHER slots is untouched. */
-export function toggleRadioHook(flags: RadioSlotFlags, id: string): RadioSlotFlags {
-  const turningOn = flags[id] !== 'hook'
-  const out: Record<string, RadioSlotFlag> = {}
-  for (const [otherId, flag] of Object.entries(flags)) {
-    if (otherId === id) continue
-    if (turningOn && flag === 'hook') continue
-    out[otherId] = flag
-  }
-  if (turningOn) out[id] = 'hook'
-  return out
-}
-
 /** The row's 👍 (2026-10-01, from the web radio's full-mode rows): one
  * press that says "i like this stem" twice -- a star, and radio's hold.
  *
- * Elling: "👍 replaces the star ... and toggles it." So the STAR toggles,
- * and the HOLD only ever turns on:
- *   - unstarred: star it, and hook the slot if it is not hooked already
- *     (toggleRadioHook, so the one-hold rule still holds and a replace-soon
- *     on this slot becomes the hook). Never turns a hook off.
- *   - starred: un-star it; the flags are untouched.
- *
- * `canHold` is false while radio is off ("👍 only stars or un-stars") and
- * on a padlocked row, where a hook is inert and would only steal the one
- * hold from a row radio can still turn over -- the same reason the old
- * "hold longer" button was disabled there.
+ * The STAR toggles here. The HOLD is radioHooks' likeRadioStem (2026-10-03: the hook is a stem,
+ * not a flag), called beside this; it only ever turns on. What is left of the flags' side: a 👍
+ * that holds (`canHold`: radio on, the row not padlocked) takes the row's change soon away, since
+ * the row is now held. Un-starring leaves the flags alone.
  *
- * Returns the SAME flags object when the hold does not change. */
+ * Returns the SAME flags object when they do not change. */
 export function likeRadioSlot(
   flags: RadioSlotFlags,
   id: string,
   opts: { starred: boolean; canHold: boolean }
 ): { flags: RadioSlotFlags; starred: boolean } {
   if (opts.starred) return { flags, starred: false }
-  if (!opts.canHold || flags[id] === 'hook') return { flags, starred: true }
-  return { flags: toggleRadioHook(flags, id), starred: true }
+  if (!opts.canHold || flags[id] !== 'replace-soon') return { flags, starred: true }
+  return { flags: toggleRadioReplaceSoon(flags, id), starred: true }
 }
 
 /** The row's "change next" control: mark this slot to be replaced soon,
```

  Also rewrite the file's header and `RadioSlotFlags`' doc comment (the `toggleRadioHook` mentions
  at the top) to say the hook moved to `radioHooks.ts`.

- [ ] **Step 2: Run** `npx vitest run src/shared` (2684 green), `npm run typecheck` in BOTH repos
  (the web's `@shared` is this tree), the web's `npx vitest run src`.
- [ ] **Step 3: Commit.** Message: `radio: the hook is no longer a flag -- RadioSlotFlag is replace-soon only; HOOK_HOLD_FACTOR, toggleRadioHook and radioHookSlotId removed (radioHooks.ts holds hooks since <Task 5 commit>; both radios read it since <Task 7> / <Task 9>); likeRadioSlot keeps the star and, holding, clears the row's change soon; the old hook's turnover tests (the 4.0 / 9.7 turns) removed by intent`, then the trailer.

### Task 16: Cross-repo verification, review, handoff, walkthrough

- [ ] **Step 1: Full suites.** sssketch: `npm test`, `npm run typecheck`, `npm run lint`.
  ell.ing/radio: `npx vitest run`, `npm run typecheck`. Native: nothing changed (no rebuild).
- [ ] **Step 2: The byte-identity harness, once more:** the web at HEAD vs the commit before Task 3,
  `sizedBuilds: false`, no roles, the matrix of Task 3 Step 11: identical. The fold fingerprint
  test (`radioFoldHurry.test.ts`, `0540eeea`) green.
- [ ] **Step 3: Offline renders** (headless Chrome, `spike/engine-check`, as the combos plan did):
  a hook exit (the echo rings over the line into the substitute) and a return under a riser and a
  gap (the payoff lands on the one). Record the measured tails and seams.
- [ ] **Step 4: An independent reviewer per phase** (superpowers:requesting-code-review), with the
  spec's §2.7, §4.7, §7 and §10 as the checklist. Keep reviewers on timing: the wrap order
  (hooks → fold → roll), a decided event withdrawn by a same-tick tap, a payoff row going
  ineligible between the roll and the wrap, pause/resume (the desktop counts wraps the lap clock
  sees), a loop length change while a hook is away.
- [ ] **Step 5: Handoff.** A section in `docs/superpowers/HANDOFF-2026-10-03.md` (or a new dated
  one); a memory file `radio_anointed_stems_shipped.md` with a `MEMORY.md` line. Say plainly that
  no agent has heard either radio, seen the UI or held a phone.
- [ ] **Step 6: Deploy the web only with Elling's go-ahead** (`deploy/deploy-page.sh`).

**Elling's walkthrough** (spec §11; no agent can do any of it):
1. Hook a drums row at fast. It stays 16-32 bars, then leaves on a line with an echo; another drums
   part plays.
2. 16-32 bars later it comes back on a phrase start, with a riser and a gap: it lands as the drop.
3. Two hooks: only one is ever out.
4. At slow, the cycles are long. At ludicrous, quick.
5. Calm (slow pace): a return sometimes comes a phrase late. Busy: on time.
6. Tap the dimmed name: back at the next phrase start.
7. Dig a row. Over a few minutes, more picks come from that jam, and the dug row wanders through it.
8. Plain radio, no roles: one-row swaps never get the full sweep; risers mostly come with bigger
   moments.
8a. Every turnaround is followed by a real change on its one: two rows or more, three or more after
   a gap. With every row padlocked (desktop) or muted but one (web), phrase ends play nothing; a
   turn still plays, without a gap.
9. The phone: hook, dig and bring back work, and the words fit at 320 px.

**To tune by ear** (spec Decided 3): the riser factor 0.15, x2 at large, large always firing, the
payoff sizes, the calm wait's 0.5, the rest chance 0.5, the pace scale's knots.

## Timing risks, per task

- **Task 3 / 4 -- the payoff a lap ahead.** The roll counts only warm rows; a row muted or locked
  before the wrap leaves the payoff short (logged `[radio-build] oversold`). The pulled pick is an
  early decision, so the interval restarts at its landing, not the roll: radio's pace never speeds
  up by more than the pull itself.
- **Task 3 -- spares cost stretches.** Two background stretches a phrase (only with sizedBuilds on
  and turnarounds not off). They are reused until spent; watch the stretch queue on a phone.
- **Task 4 -- the desktop's roll is deferred** (two microtasks, and later while a landed stem
  resolves); the payoff's pulled pick is decided by `stepRadioStage` on a later tick. A roll given
  up for lateness (`turnaroundRollTooLate`) assembles nothing.
- **Task 7 / 9 -- order at the wrap.** Hooks after the arc and before the fold step and the roll
  (spec §10 risk 1). On the desktop all three share the deferred slot: the hook step must be queued
  FIRST. Test (web) pins the order.
- **Task 7 / 9 -- a decided event is binding** but can be withdrawn by a same-tick swap-now or a
  release (spec §10 risk 6): `withdrawRadioHookEvent` then retries at the next line.
- **Task 7 -- a return's stem late** (spec §10 risk 2): it lands at the first wrap after it is
  ready, never mid-lap; the build was armed (oversold, logged).
- **Task 9 -- the exit throw vs the stage.** Armed live at the decision, it must reach the engine
  before the substitute's stage; the stage is built on a later tick (as a manual lead-in). A throw
  that cannot start a bar ahead goes dry.
- **Task 11 -- the post-fader send.** A resting row's fader must drop AT the line, after the
  throw's send has closed (it ends on the line).
