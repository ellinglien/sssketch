# Radio Turn Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `turn` button, a row of move chips and (sssketch) a `t` key that play a turnaround on demand at the next loop top, on sssketch's Discover radio, the phone remote and ell.ing/radio's full mode.

**Architecture:** The shared planner (`sssketch/src/shared/radioTurnaround.ts`) gains a `force` input: it skips the rate, the never-two-in-a-row rule and diminution, can be pinned to one move (a chip), and can be clamped to the time left before the top. It also gains `turnaroundMoveCanSound` (dims the chips) and `turnaroundTurnBeats` (the clamp). Each radio keeps one waiting turn and rolls it with `force` on the first tick the coming top can take it, or in the wrap's own deferred roll slot. There, the turn replaces the phrase end's roll.
- ell.ing/radio does this in its pure reducer (`step.ts`: a `turn` event, `turnRequest` state, `turnAt`), and full mode calls `controller.turn(move?)`.
- sssketch does it in `DiscoverPanel.tsx` through the existing turnaround arm-and-clear path (`radioTurnaroundRef`, `radioTurnaroundAtWrap`, `rollRadioTurnaround`).
- The phone posts `/api/turn`. Main answers it from the last state the Mac pushed and forwards a `turn` command to the panel.

**Tech Stack:** TypeScript, vitest, React 19 (sssketch renderer), Electron main (node:http phone server), plain DOM + Web Audio (ell.ing/radio).

**Spec:** `docs/superpowers/specs/2026-10-02-radio-turn-button-design.md`. Read it fully first. It builds on `docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md` and its executed plan `docs/superpowers/plans/2026-10-02-radio-turnarounds.md`.

---

## Two repos, and how to work in them

| repo | path | verify |
|---|---|---|
| sssketch | `/Users/nickel/Claudecode/sssketch` | `npm run typecheck`; `npx vitest run <files>`; `npx eslint <files>`; `npm run lint` (baseline: **exactly 4** pre-existing prettier warnings, 0 errors); `npm test` |
| ell.ing/radio | `/Users/nickel/Claudecode/ell.ing/radio` | `npm run typecheck` (four tsconfigs); `npm test` (`vitest run`); `npx vitest run <files>`; `npm run build`. **It has no lint script.** |

- The web radio compiles sssketch's `src/shared` files directly (`tsconfig.json` `paths`: `@shared/* -> ../../sssketch/src/shared/*`), with `noUnusedLocals`/`noUnusedParameters`. Task 1 changes a shared file, so it runs the radio's `npm run typecheck` and `npm test` too.
- Formatting: sssketch is prettier-formatted (`singleQuote`, no semis, `printWidth: 100`, no trailing commas). Run `npx prettier --write <file>` on the files you create or edit, **except** `DiscoverPanel.tsx`: never run prettier on it as a whole. Format your hunks by hand there (the code below is already formatted), then `npx eslint src/renderer/src/components/DiscoverPanel.tsx` must print nothing. The radio repo has no prettier config. Match its style (single quotes, no semis, wide lines).
- **Commits.** Other agents work in both repos. `cd` into the repo, `git add` the exact paths each task lists, and **never** use `git add -A` or `git add .`. Every commit message in this plan ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
  ```

- No agent can hear either radio, see the UI, press a key or hold a phone. Never claim a UI or sound change was "tested". Say it was typechecked, linted and unit-tested, and leave the rest to Elling (Task 9).
- **Anchors.** Every edit below quotes the current code it replaces ("Find" / "Replace with"). Line numbers drift, so search for the quoted text. Each quoted block occurs exactly once in its file. If one does not, stop and re-read the file: someone else has changed it.

## Sequencing

1. **Task 1**: the shared planner (sssketch, TDD). Both repos green.
2. **Tasks 2–4**: ell.ing/radio (reducer, controller and model, full mode's UI).
3. **Task 5**: the sssketch panel: turn, chips, `t`, undo. `DiscoverRadioMenu.tsx` is not touched (see spec point 14).
4. **Tasks 6–8**: the phone remote: shared state and parsing, the route, the page and the panel glue.
5. **Task 9**: full verification in both repos, and Elling's walkthrough.

Every commit leaves both repos typechecking and their tests green.

## Spec points this plan had to resolve

1. **What `force` skips, and what a chip ignores.**
   - `force` (any turn) skips:
     - the rate roll;
     - the never-two-in-a-row rule;
     - diminution.

     A turn's plan always has `halvings: 0`.
   - The planner's choice (`turn`) draws as a phrase end does: by the arc's weights, within the families switched on (`moves`). So under a thinning arc with only `drops` on, there is nothing to turn.
   - A chip (`force.move`) ignores both the families and the arc's weights. "Picking a move by hand is explicit."
   - Both keep the guards and the planner's own cap: min(half the loop, 4 bars), or 1 bar at `subtle`.
2. **The clamp is in whole beats, after the draw.**
   - `turnaroundTurnBeats(remaining, lead)` is `floor(remaining − lead)`. It is null under 1, and then the turn waits for the following top.
   - Whole beats keep the move's start on a beat.
   - `force.maxBeats` clamps the drawn length (floor 1). The "shortest length fits the cap" check stays against the planner's cap, not against `maxBeats`. So a very late wash can be 1 beat rather than refused. The spec says "clamped", not "dropped".
3. **The lead.**
   - sssketch: `TURN_LEAD_BEATS = 1`, which is `TURNAROUND_ROLL_LATE_BARS * 4`. That is the same measured push latency (tens to a couple of hundred ms) the deferred phrase roll already budgets.
   - Web: `TURN_LEAD_SEC = 0.1`, not exactly `MIN_LEAD_SEC` (0.05). `Engine.applyTurnaround` throws a `RangeError` when the first move is under `MIN_LEAD_SEC` ahead, and the audio clock moves between the tick and the call. A clamp to exactly 0.05 s would be refused about half the time. So the lead is 0.05 s plus one driver tick (33 ms), rounded up.
4. **When a turn waits instead of rolling.** In both runtimes a waiting turn stays waiting (it is not dropped) while:
   - (a) the coming top is too close (`turnaroundTurnBeats` is null, or on the web `nextLoopTop` has already moved past it);
   - (b) a change's lead-in (a hole or a riser) is armed for that top. That change keeps it, as the turnarounds spec's point 8 does for a phrase end;
   - (c) a turnaround already armed for that top has started, or starts within the lead. It is not cut off mid-move;
   - (d) sssketch only: a staged swap is out that cannot be re-staged in time (a mid-lap cut at a bar, or under `MANUAL_RESTAGE_MIN_BARS` to the wrap). Otherwise the stage is withdrawn (`cancelStagedSwap('turn')`) and re-staged on a later tick, as a manual change's `manual-ready` already does. An ordinary push withdraws a stage anyway.

   A turn that waits past its lap is rolled at the next wrap, in the deferred roll slot after that wrap's landings: the same slot, and the same ordering rules, as a phrase end's roll.
5. **The diminution memory (`lastPhrase`).**
   - A turn never writes it.
   - A turn that replaces a phrase end's roll, or a phrase end's armed turnaround, clears it: nothing automatic fired there.
   - A turn on a non-phrase-end lap leaves it as it was.
   - A turn the engine refuses (web `turnaroundFailed`) leaves it as it was. Before this plan, a refusal always cleared it.
6. **Undo (sssketch).**
   - Discover's undo is the toolbar button only. Cmd-Z is the arrangement's (`App.tsx`), and that stays so.
   - A turn pushes no undo snapshot. A turn pressed since the latest undo point is the newest thing done, so the next undo takes back that turn alone and nothing else. It uses the same undo sequence numbers (`undoSequence`) waiting manual changes use.
   - A turn pressed before the latest undo point waits: that snapshot's edit is undone first, then the turn on the next undo.
   - A waiting turn is dropped. An armed one is taken off only while its move has not begun (by `TURN_LEAD_BEATS`). After that, undo falls through to the usual slot undo.
   - The undo button is enabled while a turn shows, even with an empty undo stack.
   - The web radio has no undo, and the spec asks for it on sssketch only.
7. **Web: hold, pace, stop.**
   - `hold` on and a pace change already take back a turnaround still to come (`cancelTurnaround`). They now take back a waiting turn too.
   - A turn pressed while held still plays: it is an explicit press, and the phrase-end roll's "not while held" does not apply.
   - `stop` forgets everything, as it does for turnarounds.
8. **`nothing to turn`, twice.**
   - The press is checked at once against the rows as they are:
     - a chip uses `turnaroundMoveCanSound`;
     - `turn` checks that `turnaroundDraw` is not empty.
   - The roll at the top can still find nothing, because rows changed in between. Then it flashes too.
   - The `turn` button is never dimmed; only chips are.
   - Web: the flash is `view().turn.nothing` for `TURN_NOTHING_SEC` (2 s). sssketch: a 2 s state.
9. **The phone's answer comes from main, synchronously.**
   - It does not use `keep`'s ledger (`RemoteKeepLedger`), which waits for the renderer to report back. Main answers `POST /api/turn` from the last state the renderer pushed (`remoteTurnAnswer`):
     - `radio off` (409);
     - `nothing to turn` (200);
     - `turning` (200, and only then is the command forwarded).

     The phone flashes the answer straight from the response.
   - The state can be a push behind. The Mac rolls the turn itself at the top, so the worst case is a `turning` that the Mac then flashes as `nothing to turn`.
   - The route is `/api/turn`, not the spec's `/turn`: every route on this surface is under `/api/`.
   - A `move` that is not a move is a 400, as an unknown kind is on `/api/add-slot`.
10. **Where the phone's turn state lives.** It is a new optional `RemoteState.turn` (`RemoteTurnView`), not a field of `RemoteRadioView`. `radio` is also null when radio runs with nothing armed or held (`radioRemote` returns null then), so it cannot mean "radio off". `turn` is null exactly when radio is off.
11. **Dimming in sssketch is refreshed by the clock effect, not computed in render.**
    - What a move needs can only be read from refs: the arc's leg, the filter-ins on `radioGestureRef`, and the arc's exiting row. This repo's React Compiler lint forbids reading refs during render.
    - So `refreshRadioTurnCan()` runs on every position tick and keeps the previous state object when nothing changed. A tick then re-renders nothing it was not already re-rendering: the panel already renders on every `pos`.
    - While paused the chips keep the last answer.
12. **The `t` key lives in `DiscoverPanel.tsx`, not `App.tsx`.**
    - Plain `t` is free, checked 2026-10-02:
      - App's shortcuts are Delete/Backspace, Escape, Space, Tab, Cmd/Ctrl-Z, Ctrl-Y, Cmd-0, Cmd-S, `\` and `/`;
      - the only other letter-like key in the renderer is `ClusterStemsBrowser`'s `1`–`8`;
      - `src/main` has no accelerator on T.
    - The turn lives in the panel, which is mounted only while the library is in Discover mode. So the listener is the panel's, active while radio runs.
    - It ignores text fields, any modifier (so Cmd-T and friends are left alone) and key repeats.
    - `App.tsx` needs no edit. The web radio gets no `t`: the spec gives the shortcut to sssketch only.
13. **The React Compiler lint and the listeners.** Calling `turnRadio` directly from the phone's command effect (`remoteCommandRef`) makes `react-hooks/immutability` report about twenty errors across the component. This was found compiling the plan code. So the phone and `t` both call `turnRadioRef.current`, a ref set to `turnRadio` every render. That is the pattern `remoteCommandRef` itself uses.
14. **No menu change.** The spec puts the turn beside the radio controls, not in `DiscoverRadioMenu.tsx`, and turnarounds `off` needs no new copy. The menu is not touched.
15. **Placement.**
    - sssketch: a column after the radio settings chevron. The `turn` button is on top, with the seven chips (8px type) in a row under it. It is shown while radio is on.
    - Web: a `knob` group in full mode's master strip, directly after the turnaround toggles group.
    - Phone: inside `#loop`, above `swap every`, hidden unless `state.turn`.
    - Chip labels come from one shared table, `TURNAROUND_MOVE_LABEL` (`drum drop` reads `drop`).
16. **Throws.** A dub throw armed earlier in a lap still plays if a turn is armed later in it. The throw gate (`leadingArmed`) only stops new throws arming. Arming a turn does not take an armed throw back. That would be a second change to the throws, which the spec does not ask for.

---

## File map

### sssketch

| file | | responsibility |
|---|---|---|
| `src/shared/radioTurnaround.ts` | modify | `TurnaroundForce`, `rollForced`, `turnaroundMoveCanSound`, `turnaroundTurnBeats`, `TURNAROUND_MOVE_LABEL` |
| `src/shared/radioTurnaroundTurn.test.ts` | create | the turn's planner tests |
| `src/renderer/src/components/DiscoverPanel.tsx` | modify | waiting turn, roll paths, tick, dimming, undo, the button and chips, `t`, the phone glue |
| `src/shared/remoteState.ts` / `.test.ts` | modify | `RemoteTurnView`, `RemoteState.turn`, the `turn` command, `parseRemoteTurnMove`, `remoteTurnAnswer` |
| `src/main/remoteServer.ts` / `.test.ts` | modify | `POST /api/turn` |
| `src/main/remotePage.ts` / `.test.ts` | modify | the phone's `turn` and chips |

`App.tsx`, `DiscoverRadioMenu.tsx`, `src/main/index.ts` and `src/preload/` need no change. Main's `getState` already spreads the whole pushed state, and `onCommand` already forwards any `RemoteCommand`.

### ell.ing/radio

| file | | responsibility |
|---|---|---|
| `src/radio/step.ts` / `step.test.ts` | modify | the `turn` event, `turnRequest`, `turnAt`, `view().turn` |
| `src/radio/controller.ts` / `controller.test.ts` | modify | `turn(move?)` |
| `src/ui/fullModel.ts` / `fullModel.test.ts` | modify | `FullTurn` on the strip |
| `src/ui/full.ts`, `src/ui/full.css`, `src/main.ts` | modify | the full-mode button and chips |

---

## Task 1: The planner's turn: `force`, `turnaroundMoveCanSound`, `turnaroundTurnBeats` (sssketch)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioTurnaround.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioTurnaroundTurn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/radioTurnaroundTurn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  TURNAROUND_MOVES,
  TURNAROUND_MOVE_LABEL,
  rollTurnaround,
  turnaroundMoveCanSound,
  turnaroundTurnBeats,
  type TurnaroundInput,
  type TurnaroundRow
} from './radioTurnaround'

/** Exactly these draws, in order; a draw past them is a test failure. */
function seq(values: number[]): () => number {
  let i = 0
  return (): number => {
    if (i >= values.length) throw new Error(`drew ${i + 1} times, only ${values.length} scripted`)
    return values[i++]
  }
}

function row(
  id: string,
  kinds: DiscoverSlotKind[],
  extra: Partial<TurnaroundRow> = {}
): TurnaroundRow {
  return { id, kinds, hooked: false, audible: true, inFilterIn: false, barLength: 4, ...extra }
}

const BED: TurnaroundRow[] = [
  row('d', ['drums']),
  row('b', ['bass']),
  row('l', ['lead']),
  row('w', ['warm'])
]

function input(over: Partial<TurnaroundInput> = {}): TurnaroundInput {
  return {
    rate: 'often',
    random: seq([]),
    loopBars: 8,
    lastPhrase: null,
    rows: BED,
    arc: 'steady',
    leavingRowId: null,
    ...over
  }
}

describe('force: a turn always fires', () => {
  it('fires at rate off, right after a phrase end that fired, drawing no rate', () => {
    const plan = rollTurnaround(
      input({
        rate: 'off',
        lastPhrase: { move: 'stop', beats: 2, halvings: 0 },
        force: { move: 'wash' }
      })
    )
    expect(plan?.move).toBe('wash')
    expect(plan?.beats).toBe(4)
    expect(plan?.halvings).toBe(0)
  })

  it('is a fresh move after a diminishing one: halvings 0, its own length', () => {
    const plan = rollTurnaround(
      input({
        lastPhrase: { move: 'lift', beats: 8, halvings: 1 },
        random: seq([0]),
        force: { move: 'lift' }
      })
    )
    expect(plan?.move).toBe('lift')
    expect(plan?.beats).toBe(4)
    expect(plan?.halvings).toBe(0)
  })

  it("the planner's choice draws by the arc, within the families switched on", () => {
    // steady: drum drop is the first and heaviest; then its length (1 beat), then its row
    const steady = rollTurnaround(input({ random: seq([0, 0, 0]), force: {} }))
    expect(steady?.move).toBe('drum drop')
    expect(steady?.beats).toBe(1)
    expect(steady?.rows.map((r) => r.rowId)).toEqual(['d'])
    // thinning, wash only: the one move left
    const wash = rollTurnaround(
      input({ arc: 'thinning', moves: ['wash'], random: seq([0.99]), force: {} })
    )
    expect(wash?.move).toBe('wash')
    // thinning weights nothing in the drops family: nothing to turn
    expect(rollTurnaround(input({ arc: 'thinning', moves: ['drops'], force: {} }))).toBeNull()
    // none switched on: nothing to turn either
    expect(rollTurnaround(input({ moves: [], force: {} }))).toBeNull()
  })
})

describe("force.move: a chip's move", () => {
  it('ignores the families switched off and the arc', () => {
    const plan = rollTurnaround(
      input({ moves: [], arc: 'thinning', random: seq([0]), force: { move: 'riser' } })
    )
    expect(plan?.move).toBe('riser')
    expect(plan?.riserBars).toBe(1)
  })

  it('never ignores the guards or the cap', () => {
    const noDrums = [row('b', ['bass']), row('l', ['lead'])]
    expect(rollTurnaround(input({ rows: noDrums, force: { move: 'drum drop' } }))).toBeNull()
    // a 1-bar loop caps at 2 beats: a wash (4 beats at its shortest) cannot fit
    expect(rollTurnaround(input({ loopBars: 1, force: { move: 'wash' } }))).toBeNull()
    // drums and bass only: no melodic row for a stop to keep
    const low = [row('d', ['drums']), row('b', ['bass'])]
    expect(rollTurnaround(input({ rows: low, force: { move: 'stop' } }))).toBeNull()
  })
})

describe('force.maxBeats: a late press', () => {
  it('clamps the length to the time left', () => {
    const lift = rollTurnaround(
      input({ random: seq([0.99]), force: { move: 'lift', maxBeats: 3 } })
    )
    expect(lift?.beats).toBe(3)
    expect(lift?.rows[0].filter?.cutoff[0].beats).toBe(3)
    const drop = rollTurnaround(
      input({ random: seq([0.99]), force: { move: 'low drop', maxBeats: 1 } })
    )
    expect(drop?.beats).toBe(1)
    expect(drop?.rows[0].volume?.[0].beats).toBeCloseTo(1, 9)
    const riser = rollTurnaround(
      input({ random: seq([0.99]), force: { move: 'riser', maxBeats: 2 } })
    )
    expect(riser?.beats).toBe(2)
    expect(riser?.riserBars).toBe(0.5)
  })

  it('never below 1 beat', () => {
    const plan = rollTurnaround(input({ force: { move: 'wash', maxBeats: 0.4 } }))
    expect(plan?.beats).toBe(1)
  })

  it('leaves a length already under it alone', () => {
    const plan = rollTurnaround(input({ force: { move: 'wash', maxBeats: 12 } }))
    expect(plan?.beats).toBe(4)
  })
})

describe('turnaroundTurnBeats', () => {
  it('is the whole beats left less the lead', () => {
    expect(turnaroundTurnBeats(16, 0.1)).toBe(15)
    expect(turnaroundTurnBeats(4, 0)).toBe(4)
    expect(turnaroundTurnBeats(2, 0.1)).toBe(1)
    expect(turnaroundTurnBeats(1.1, 0.1)).toBe(1)
  })

  it('waits for the following top when under 1 beat plus the lead is left', () => {
    expect(turnaroundTurnBeats(1.05, 0.1)).toBeNull()
    expect(turnaroundTurnBeats(0.5, 0)).toBeNull()
    expect(turnaroundTurnBeats(Number.NaN, 0.1)).toBeNull()
    expect(turnaroundTurnBeats(8, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('turnaroundMoveCanSound', () => {
  const beds: { rows: TurnaroundRow[]; loopBars: number }[] = [
    { rows: BED, loopBars: 8 },
    { rows: BED, loopBars: 1 },
    { rows: [row('d', ['drums'])], loopBars: 8 },
    { rows: [row('d', ['drums']), row('b', ['bass'])], loopBars: 8 },
    {
      rows: [row('d', ['drums']), row('l', ['lead'], { inFilterIn: true })],
      loopBars: 8
    },
    { rows: [row('l', ['lead'], { audible: false })], loopBars: 8 },
    { rows: BED, loopBars: 0 }
  ]

  it("is true exactly when a chip's forced roll plays", () => {
    for (const bed of beds) {
      for (const move of TURNAROUND_MOVES) {
        const can = turnaroundMoveCanSound({ ...bed, leavingRowId: null }, move)
        const plan = rollTurnaround(input({ ...bed, random: () => 0.5, force: { move } }))
        expect({ move, loopBars: bed.loopBars, can }).toEqual({
          move,
          loopBars: bed.loopBars,
          can: plan !== null
        })
      }
    }
  })

  it('dims what the guards say: a drop with no drums row, a stop with no melodic row', () => {
    const low = [row('d', ['drums']), row('b', ['bass'])]
    expect(turnaroundMoveCanSound({ rows: low, leavingRowId: null, loopBars: 8 }, 'stop')).toBe(
      false
    )
    const noDrums = [row('b', ['bass']), row('l', ['lead'])]
    expect(
      turnaroundMoveCanSound({ rows: noDrums, leavingRowId: null, loopBars: 8 }, 'drum drop')
    ).toBe(false)
    expect(
      TURNAROUND_MOVES.filter((m) =>
        turnaroundMoveCanSound({ rows: BED, leavingRowId: null, loopBars: 8 }, m)
      )
    ).toEqual([...TURNAROUND_MOVES])
  })

  it('reads the depth: subtle caps every move at 1 bar', () => {
    // a 16-bar loop: bold caps at 16 beats, subtle at 4 -- every shortest still fits
    expect(
      turnaroundMoveCanSound(
        { rows: BED, leavingRowId: null, loopBars: 16, depth: 'subtle' },
        'wash'
      )
    ).toBe(true)
  })
})

describe('TURNAROUND_MOVE_LABEL', () => {
  it('names every move in lowercase, at most two words; the drum drop is `drop`', () => {
    for (const move of TURNAROUND_MOVES) {
      const label = TURNAROUND_MOVE_LABEL[move]
      expect(label).toBe(label.toLowerCase())
      expect(label.split(' ').length).toBeLessThanOrEqual(2)
    }
    expect(TURNAROUND_MOVE_LABEL['drum drop']).toBe('drop')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioTurnaroundTurn.test.ts`
Expected: FAIL. `turnaroundTurnBeats is not a function`, `turnaroundMoveCanSound is not a function` and `Cannot read properties of undefined` (on `TURNAROUND_MOVE_LABEL`). The `force` tests fail on `rate: 'off'` returning null.

- [ ] **Step 3: Add `force` to the input**

In `src/shared/radioTurnaround.ts`, find:

```ts
  /** How far the moves go (RadioSettings.turnaroundDepth); bold when absent. */
  depth?: TurnaroundDepth
}
```

Replace with:

```ts
  /** How far the moves go (RadioSettings.turnaroundDepth); bold when absent. */
  depth?: TurnaroundDepth
  /** A TURN, not a phrase end (TurnaroundForce): it always fires when a move can sound. */
  force?: TurnaroundForce
}

/** A turn: a turnaround on demand, at the next loop top
 * (docs/superpowers/specs/2026-10-02-radio-turn-button-design.md). It skips the rate, the
 * never-two-in-a-row rule and diminution; the guards and the cap still apply. */
export interface TurnaroundForce {
  /** A chip's move, drawn whatever `moves` and the arc say. Absent: the planner draws by the arc,
   * within `moves`, as a phrase end does. */
  move?: TurnaroundMove
  /** The beats left before the top (turnaroundTurnBeats): the move is never longer, nor shorter
   * than 1 beat. */
  maxBeats?: number
}
```

- [ ] **Step 4: One guard check, shared by the draw and the chips**

Find:

```ts
function drawOf(
  bed: Bed,
  arc: TurnaroundArc,
  capBeats: number,
  moves: readonly TurnaroundFamily[]
): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) =>
      weights[m] > 0 &&
      moves.includes(TURNAROUND_FAMILY_OF[m]) &&
      SHORTEST_BEATS[m] <= capBeats &&
      canSound(m, bed)
  )
}
```

Replace with:

```ts
/** A move can sound and its shortest length fits the cap: the guards, with no randomness. */
function fits(move: TurnaroundMove, bed: Bed, capBeats: number): boolean {
  return SHORTEST_BEATS[move] <= capBeats && canSound(move, bed)
}

function drawOf(
  bed: Bed,
  arc: TurnaroundArc,
  capBeats: number,
  moves: readonly TurnaroundFamily[]
): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) => weights[m] > 0 && moves.includes(TURNAROUND_FAMILY_OF[m]) && fits(m, bed, capBeats)
  )
}
```

- [ ] **Step 5: The chips' check, the clamp and the labels**

Find:

```ts
function drawBeats(move: TurnaroundMove, bed: Bed, capBeats: number, random: () => number): number {
```

Replace with:

```ts
/** Whether a turn's chip could play `move` now: its guards and the cap, nothing else -- not the
 * arc, not the families switched on (a chip ignores them), no randomness. rollTurnaround with
 * `force.move` returns a plan exactly when this is true. */
export function turnaroundMoveCanSound(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'depth'>,
  move: TurnaroundMove
): boolean {
  const capBeats = capOf(input)
  return capBeats > 0 && fits(move, bedOf(input.rows, input.leavingRowId), capBeats)
}

/** The longest a turn pressed now may be, in whole beats: the beats left before the top less the
 * runtime's lead (the time a plan needs to reach the engine), rounded down so the move starts on
 * a beat. Null when that is under 1 beat: the turn waits for the following top. */
export function turnaroundTurnBeats(remainingBeats: number, leadBeats: number): number | null {
  if (!Number.isFinite(remainingBeats) || !Number.isFinite(leadBeats)) return null
  const left = Math.floor(remainingBeats - Math.max(0, leadBeats) + 1e-9)
  return left >= 1 ? left : null
}

/** Each move's chip, lowercase, at most two words. */
export const TURNAROUND_MOVE_LABEL: Readonly<Record<TurnaroundMove, string>> = {
  'drum drop': 'drop',
  'low drop': 'low drop',
  stop: 'stop',
  wash: 'wash',
  lift: 'lift',
  dip: 'dip',
  riser: 'riser'
}

function drawBeats(move: TurnaroundMove, bed: Bed, capBeats: number, random: () => number): number {
```

- [ ] **Step 6: `rollTurnaround` hands a turn to `rollForced`**

Find:

```ts
 * - The families switched off (`moves`) are never drawn; none switched on is off.
 */
export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
  const { random, loopBars, lastPhrase, arc } = input
```

Replace with:

```ts
 * - The families switched off (`moves`) are never drawn; none switched on is off.
 * - `force` is a TURN (rollForced): it always fires when a move can sound.
 */
export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
  if (input.force !== undefined) return rollForced(input, input.force)
  const { random, loopBars, lastPhrase, arc } = input
```

Then find:

```ts
/** What to remember of a phrase end for the next one. */
```

Replace with:

```ts
/** A turn's roll: no rate, no memory (a fresh move, `halvings` 0), the guards and the cap as
 * ever. A chip's move is drawn whatever the arc and the families say; the planner's choice draws
 * by the arc within the families. The draws, in order: which move (the planner's choice only),
 * how long, which drums row (a drum drop). */
function rollForced(input: TurnaroundInput, force: TurnaroundForce): TurnaroundPlan | null {
  const { random, loopBars, arc } = input
  const looks = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
  const capBeats = capOf(input)
  if (!(capBeats > 0)) return null
  const bed = bedOf(input.rows, input.leavingRowId)
  let move: TurnaroundMove
  if (force.move !== undefined) {
    if (!fits(force.move, bed, capBeats)) return null
    move = force.move
  } else {
    const drawn = drawOf(bed, arc, capBeats, input.moves ?? TURNAROUND_FAMILIES)
    if (drawn.length === 0) return null
    move = pickWeighted(
      drawn.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
      random
    )
  }
  const most =
    force.maxBeats !== undefined && Number.isFinite(force.maxBeats)
      ? Math.max(1, force.maxBeats)
      : capBeats
  const beats = Math.min(drawBeats(move, bed, capBeats, random), most)
  return build(move, beats, 0, bed, loopBars, random, looks)
}

/** What to remember of a phrase end for the next one. */
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `cd /Users/nickel/Claudecode/sssketch && npx prettier --write src/shared/radioTurnaround.ts src/shared/radioTurnaroundTurn.test.ts && npx vitest run src/shared/radioTurnaround`
Expected: PASS, 8 files: the 7 existing `radioTurnaround*.test.ts` files and the new one, all green.

- [ ] **Step 8: Typecheck and lint sssketch, then typecheck and test the radio against it**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/shared/radioTurnaround.ts src/shared/radioTurnaroundTurn.test.ts`
Expected: both clean.

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test`
Expected: clean and green. The change is additive: `force` is optional and nothing in the radio passes it yet.

- [ ] **Step 9: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioTurnaround.ts src/shared/radioTurnaroundTurn.test.ts
git commit -m "radio turn: the planner's force -- a turn always fires, a chip's move, the clamp to the time left

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 2: The web radio's turn, in the reducer (ell.ing/radio)

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/step.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/radio/step.test.ts`. The file already has `Sim`, `seeded`, `LAP` (8 s a 4-bar lap at 120 bpm), `view` (`describe` from `./step`) and `WebRadioSettings`. The bed is `r0` drums, `r1` bass, `r2` lead, `r3` warm, every stem 4 bars.

```ts

describe('the turn (sssketch spec 2026-10-02-radio-turn-button-design)', () => {
  /** A running radio (turnarounds off unless asked), ticked from 0 to `now`. */
  function running(settings: Partial<WebRadioSettings> = {}, seed = 1, now = 1): Sim {
    const sim = new Sim({ turnarounds: 'off', ...settings }, seeded(seed))
    sim.send({ type: 'play' })
    sim.run(0, now)
    return sim
  }

  it('lands at the next loop top, at its own length, and is over once that top has passed', () => {
    const sim = running()
    sim.send({ type: 'turn', move: 'wash' })
    expect(sim.s.turnRequest).toEqual({ move: 'wash' })
    expect(view(sim.s).turn).toMatchObject({ waiting: true, move: 'wash' })
    sim.run(1 + 1 / 30, 2)
    const [t, ...more] = sim.of('turnaround')
    expect(more).toHaveLength(0)
    expect(t.time).toBe(LAP)
    expect(t.plan.move).toBe('wash')
    expect(t.plan.beats).toBe(4)
    expect(sim.s.turnRequest).toBeNull()
    expect(sim.s.turnaround).toMatchObject({ at: LAP, turn: true })
    expect(view(sim.s).turn).toMatchObject({ waiting: true, move: 'wash' })
    sim.run(2, LAP + 0.1)
    expect(view(sim.s).turn.waiting).toBe(false)
  })

  it("the planner's choice when no chip is given; it writes no phrase memory", () => {
    const sim = running()
    sim.send({ type: 'turn' })
    expect(view(sim.s).turn).toMatchObject({ waiting: true, move: null })
    sim.run(1 + 1 / 30, 2)
    const [t] = sim.of('turnaround')
    expect(t.time).toBe(LAP)
    expect(view(sim.s).turn.move).toBe(t.plan.move)
    expect(sim.s.lastTurnaround).toBeNull()
  })

  it('last tap wins: before it rolls, and after, until its move has started', () => {
    const sim = running()
    sim.send({ type: 'turn', move: 'wash' })
    sim.send({ type: 'turn', move: 'lift' })
    sim.run(1 + 1 / 30, 1.5)
    expect(sim.of('turnaround').map((a) => a.plan.move)).toEqual(['lift'])
    sim.send({ type: 'turn', move: 'riser' })
    sim.run(1.5 + 1 / 30, 2)
    expect(sim.of('turnaround').map((a) => [a.time, a.plan.move])).toEqual([
      [LAP, 'lift'],
      [LAP, 'riser']
    ])
    expect(sim.s.turnaround?.plan.move).toBe('riser')
    // the riser (8 beats at most: half this 4-bar loop) has started by now: a tap waits for the
    // top after, and rolls on that wrap's tick
    sim.run(2, LAP - 0.3)
    sim.send({ type: 'turn', move: 'wash' })
    sim.run(LAP - 0.3 + 1 / 30, LAP - 1 / 30)
    expect(sim.of('turnaround')).toHaveLength(2)
    sim.run(LAP, LAP + 0.1)
    expect(sim.of('turnaround').at(-1)).toMatchObject({ time: 2 * LAP, plan: { move: 'wash' } })
  })

  it('a press late in the lap is clamped to the time left, or waits for the following top', () => {
    const late = running({}, 1, 7)
    late.send({ type: 'turn', move: 'lift' })
    late.tick(7 + 1 / 30)
    // 1.93 beats to the top, less the 0.2-beat lead: 1 beat
    expect(late.of('turnaround').map((a) => [a.time, a.plan.beats])).toEqual([[LAP, 1]])

    const later = running({}, 1, 7.9)
    later.send({ type: 'turn', move: 'lift' })
    later.run(7.9 + 1 / 30, LAP - 1 / 30)
    expect(later.of('turnaround')).toHaveLength(0)
    expect(view(later.s).turn.waiting).toBe(true)
    later.run(LAP, LAP + 0.1)
    const [t] = later.of('turnaround')
    expect(t.time).toBe(2 * LAP)
    expect(t.plan.beats).toBeGreaterThanOrEqual(4)
  })

  it("replaces the phrase end's own roll there, which then remembers nothing", () => {
    for (let seed = 1; seed <= 10; seed++) {
      // 16 bars a phrase (phraseBars 0) = 4 laps: the first phrase end's roll is at 3 laps
      const sim = running({ turnarounds: 'often' }, seed, 3 * LAP - 0.1)
      expect(sim.of('turnaround')).toHaveLength(0)
      sim.send({ type: 'turn', move: 'wash' })
      sim.run(3 * LAP - 0.1 + 1 / 30, 4 * LAP - 1)
      expect(sim.of('turnaround').map((a) => [a.time, a.plan.move])).toEqual([[4 * LAP, 'wash']])
      expect(sim.s.lastTurnaround).toBeNull()
    }
  })

  it("never starts or extends a diminution: the memory stays the phrase end's", () => {
    let done = false
    for (let seed = 1; seed < 50 && !done; seed++) {
      const sim = running({ turnarounds: 'often' }, seed, 4 * LAP + 1)
      const memory = sim.s.lastTurnaround
      if (memory === null) continue
      done = true
      // the lap from 5 to 6 laps is not a phrase's last
      sim.run(4 * LAP + 1 + 1 / 30, 5 * LAP + 1)
      sim.send({ type: 'turn', move: 'lift' })
      sim.run(5 * LAP + 1 + 1 / 30, 6 * LAP - 0.1)
      expect(sim.of('turnaround').at(-1)).toMatchObject({ time: 6 * LAP, plan: { move: 'lift', halvings: 0 } })
      expect(sim.s.lastTurnaround).toEqual(memory)
    }
    expect(done).toBe(true)
  })

  it('nothing to turn: a chip that cannot sound now is said so, a while, and nothing waits', () => {
    const sim = running()
    // drums and bass left: no melodic row for a stop to keep
    sim.send({ type: 'mute', slot: 'r2', muted: true })
    sim.send({ type: 'mute', slot: 'r3', muted: true })
    expect(view(sim.s).turn.canSound).toEqual(['drum drop', 'wash', 'lift', 'dip', 'riser'])
    sim.send({ type: 'turn', move: 'stop' })
    expect(sim.s.turnRequest).toBeNull()
    expect(view(sim.s).turn.nothing).toBe(true)
    sim.run(1 + 1 / 30, 3.1)
    expect(view(sim.s).turn.nothing).toBe(false)
    expect(sim.of('turnaround')).toHaveLength(0)
  })

  it('does nothing while the radio is not running', () => {
    const sim = new Sim({ turnarounds: 'off' }, seeded(1))
    sim.send({ type: 'turn', move: 'wash' })
    expect(sim.s.turnRequest).toBeNull()
    expect(view(sim.s).turn).toEqual({ waiting: false, move: null, nothing: false, canSound: [] })
  })

  it('hold takes back a turn on the timeline and one still waiting; stop forgets one', () => {
    const sim = running()
    sim.send({ type: 'turn', move: 'wash' })
    sim.run(1 + 1 / 30, 1.5)
    sim.send({ type: 'turn', move: 'lift' })
    sim.send({ type: 'hold', on: true })
    expect(sim.of('cancelTurnaround').at(-1)).toEqual({ type: 'cancelTurnaround', time: LAP })
    expect(sim.s.turnaround).toBeNull()
    expect(sim.s.turnRequest).toBeNull()

    const stopped = running()
    stopped.send({ type: 'turn', move: 'wash' })
    stopped.send({ type: 'stop' })
    expect(stopped.s.turnRequest).toBeNull()
  })

  it("a turn the engine refuses is forgotten, and the phrase end's memory with it is not", () => {
    const sim = running()
    sim.send({ type: 'turn', move: 'wash' })
    sim.run(1 + 1 / 30, 1.5)
    const memory = { move: 'lift' as const, beats: 8, halvings: 0 }
    sim.s = { ...sim.s, lastTurnaround: memory }
    sim.send({ type: 'turnaroundFailed', at: LAP })
    expect(sim.s.turnaround).toBeNull()
    expect(sim.s.lastTurnaround).toEqual(memory)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts`
Expected: FAIL in the new `describe` only. `sim.s.turnRequest` is `undefined` and `view(...).turn` is `undefined`. The `turn` event falls through `reduce`'s switch.

- [ ] **Step 3: Imports and constants**

In `src/radio/step.ts`, find:

```ts
  rememberTurnaround,
  rollTurnaround,
  turnaroundArc,
  type TurnaroundDepth,
  type TurnaroundFamily,
  type TurnaroundMemory,
  type TurnaroundPlan
} from '@shared/radioTurnaround'
```

Replace with:

```ts
  rememberTurnaround,
  rollTurnaround,
  TURNAROUND_MOVES,
  turnaroundArc,
  turnaroundDraw,
  turnaroundMoveCanSound,
  turnaroundTurnBeats,
  type TurnaroundDepth,
  type TurnaroundFamily,
  type TurnaroundInput,
  type TurnaroundMemory,
  type TurnaroundMove,
  type TurnaroundPlan,
  type TurnaroundRow
} from '@shared/radioTurnaround'
```

Find:

```ts
export const MIN_BPM = 40
```

Replace with:

```ts
/** A turn's lead: Engine.MIN_LEAD_SEC (0.05 s, which Engine.applyTurnaround enforces) plus a
 * driver tick (~33 ms), so a turn clamped to the time left is never refused for being late. */
export const TURN_LEAD_SEC = 0.1
/** How long full mode's turn says `nothing to turn`, in seconds. */
export const TURN_NOTHING_SEC = 2
export const MIN_BPM = 40
```

- [ ] **Step 4: State and the event**

Find:

```ts
  /** The phrase turnaround on the engine's timeline, ending on the wrap `at`; cleared once that
   * wrap has passed, or when it is taken back or refused. */
  turnaround: { at: number; plan: TurnaroundPlan } | null
```

Replace with:

```ts
  /** The phrase turnaround on the engine's timeline, ending on the wrap `at`; cleared once that
   * wrap has passed, or when it is taken back or refused. `turn`: a turn's, not a phrase end's. */
  turnaround: { at: number; plan: TurnaroundPlan; turn?: boolean } | null
```

Find:

```ts
   * diminution. Null when nothing fired there. */
  lastTurnaround: TurnaroundMemory | null
}
```

Replace with:

```ts
   * diminution. Null when nothing fired there. */
  lastTurnaround: TurnaroundMemory | null
  /** A turn pressed and not rolled yet (spec 2026-10-02-radio-turn-button-design, sssketch):
   * a chip's `move`, or null for the planner's choice. The latest press wins. */
  turnRequest: { move: TurnaroundMove | null } | null
  /** When the last turn found nothing to turn (AudioContext time): full mode says so a while. */
  turnNothingAt: number | null
}
```

Find:

```ts
  | { type: 'turnaroundControls'; moves: readonly TurnaroundFamily[]; depth: TurnaroundDepth }
```

Replace with:

```ts
  | { type: 'turnaroundControls'; moves: readonly TurnaroundFamily[]; depth: TurnaroundDepth }
  /** Full mode's turn: a turnaround at the next loop top, a chip's `move` or the planner's. */
  | { type: 'turn'; move?: TurnaroundMove }
```

Find (in `initialRadioState`):

```ts
    turnaround: null,
    lastTurnaround: null
  }
}
```

Replace with:

```ts
    turnaround: null,
    lastTurnaround: null,
    turnRequest: null,
    turnNothingAt: null
  }
}
```

- [ ] **Step 5: `reduce` takes the press, and a refused turn keeps the memory**

Find (the end of the `turnaroundControls` case and the start of `mute`):

```ts
      break
    case 'mute': {
```

Replace with:

```ts
      break
    case 'turn':
      turnPress(c, event.move ?? null)
      break
    case 'mute': {
```

Find:

```ts
    case 'turnaroundFailed':
      // the engine refused it: it never plays, so the next phrase end is not "after a turnaround"
      if (s.turnaround && Math.abs(s.turnaround.at - event.at) <= EPS) {
        s.turnaround = null
        s.lastTurnaround = null
      }
```

Replace with:

```ts
    case 'turnaroundFailed':
      // the engine refused it: it never plays, so the next phrase end is not "after a turnaround"
      // (a turn's never touched that memory, so its refusal leaves it be)
      if (s.turnaround && Math.abs(s.turnaround.at - event.at) <= EPS) {
        if (!s.turnaround.turn) s.lastTurnaround = null
        s.turnaround = null
      }
```

- [ ] **Step 6: The tick rolls a waiting turn, after the wrap's landing and phrase roll**

Find:

```ts
    land(c, led, pos)
    // the lap starting here may be a phrase's last: its turnaround, after the landing (whose
    // arrival gesture is then on the list the roll reads)
    if (adv.turnaroundLapStarts) rollTurnaroundAt(c, t)
    return
```

Replace with:

```ts
    land(c, led, pos)
    // the lap starting here may be a phrase's last: its turnaround, after the landing (whose
    // arrival gesture is then on the list the roll reads)
    if (adv.turnaroundLapStarts) rollTurnaroundAt(c, t)
    // a turn waiting rolls after the same landing
    turnAt(c, t)
    return
```

Find:

```ts
  if (adv.turnaroundLapStarts) rollTurnaroundAt(c, t)
  // the watchdog
```

Replace with:

```ts
  if (adv.turnaroundLapStarts) rollTurnaroundAt(c, t)
  // A TURN waiting: rolled on the first tick its top can take it (turnAt), here so the early
  // decision and the due branch below see it, as they see a phrase end's
  turnAt(c, t)
  // the watchdog
```

- [ ] **Step 7: The phrase end's roll stands down for a turn, and its rows become a helper**

Find:

```ts
function rollTurnaroundAt(c: Ctx, t: RadioTickInfo): void {
  const { s } = c
  const at = t.nextWrap
```

Replace with:

```ts
function rollTurnaroundAt(c: Ctx, t: RadioTickInfo): void {
  const { s } = c
  // a turn waiting takes this phrase end (turnAt, called next, rolls it): the automatic roll
  // stands down and remembers nothing, so a turn never starts or extends a diminution
  if (s.turnRequest) {
    s.lastTurnaround = null
    return
  }
  const at = t.nextWrap
```

Find (the rest of `rollTurnaroundAt`'s roll):

```ts
  const leaving = s.removing && s.removing.at !== null && Math.abs(s.removing.at - at) <= EPS ? s.removing.slot : null
  const plan = rollTurnaround({
    rate: s.settings.turnarounds,
    random: c.rnd,
    loopBars: t.loopBars,
    lastPhrase: s.lastTurnaround,
    rows: s.rows
      .filter((r) => r.record)
      .map((r) => ({
        id: r.id,
        kinds: r.kinds,
        hooked: s.flags[r.id] === 'hook',
        audible: heard(s, r) && r.id !== leaving,
        // a filter in sweeping it, or a change already drawn as one waiting to land (on this
        // wrap at the earliest): the turnaround's filter and the filter in share the row's filter
        inFilterIn:
          s.gestures.some((g) => g.slot === r.id && g.kind === 'filter in') ||
          (s.led?.slot === r.id && !s.led.cancel && s.led.kind === 'filter in'),
        barLength: r.record!.bars
      })),
    arc: s.settings.densityArc?.on ? turnaroundArc(s.density, s.rows.length) : 'steady',
    leavingRowId: null,
    moves: s.settings.turnaroundMoves,
    depth: s.settings.turnaroundDepth
  })
  s.lastTurnaround = rememberTurnaround(plan)
```

Replace with:

```ts
  const plan = rollTurnaround({
    rate: s.settings.turnarounds,
    random: c.rnd,
    lastPhrase: s.lastTurnaround,
    ...turnaroundInputOf(s, t.loopBars, leavingAt(s, at))
  })
  s.lastTurnaround = rememberTurnaround(plan)
```

- [ ] **Step 8: The helpers, the press and `turnAt`**

Find (the doc comment that opens `underTurnaround`):

```ts
/** A change's transition when it lands on the wrap `wrap`: under a turnaround ending there, only
```

Replace with:

```ts
/** The row the arc removes on the wrap `at`, if any: in its exit drop-out, so unheard for a roll. */
function leavingAt(s: RadioState, at: number): string | null {
  return s.removing && s.removing.at !== null && Math.abs(s.removing.at - at) <= EPS ? s.removing.slot : null
}

/** The rows as the planner sees them. A row the arc is removing (`leaving`) is unheard. */
function turnaroundRowsOf(s: RadioState, leaving: string | null): TurnaroundRow[] {
  return s.rows
    .filter((r) => r.record)
    .map((r) => ({
      id: r.id,
      kinds: r.kinds,
      hooked: s.flags[r.id] === 'hook',
      audible: heard(s, r) && r.id !== leaving,
      // a filter in sweeping it, or a change already drawn as one waiting to land (on this
      // wrap at the earliest): the turnaround's filter and the filter in share the row's filter
      inFilterIn:
        s.gestures.some((g) => g.slot === r.id && g.kind === 'filter in') ||
        (s.led?.slot === r.id && !s.led.cancel && s.led.kind === 'filter in'),
      barLength: r.record!.bars
    }))
}

/** Everything a roll reads but the rate, the randomness and the memory. */
function turnaroundInputOf(
  s: RadioState,
  loopBars: number,
  leaving: string | null = null
): Omit<TurnaroundInput, 'rate' | 'random' | 'lastPhrase'> {
  return {
    loopBars,
    rows: turnaroundRowsOf(s, leaving),
    arc: s.settings.densityArc?.on ? turnaroundArc(s.density, s.rows.length) : 'steady',
    leavingRowId: null,
    moves: s.settings.turnaroundMoves,
    depth: s.settings.turnaroundDepth
  }
}

/** A TURN pressed (full mode's `turn` or a chip). Nothing while radio is not running. A press
 * that cannot sound now -- the chip's guards, or no move the planner could draw -- says `nothing
 * to turn` and waits for nothing. Otherwise it waits for turnAt; a later press replaces it. */
function turnPress(c: Ctx, move: TurnaroundMove | null): void {
  const { s } = c
  const t = s.lastTick
  if (s.phase !== 'running' || !t) return
  const input = turnaroundInputOf(s, t.loopBars)
  const can = move !== null ? turnaroundMoveCanSound(input, move) : turnaroundDraw(input).length > 0
  if (!can) {
    s.turnNothingAt = t.now
    return
  }
  s.turnNothingAt = null
  s.turnRequest = { move }
}

/**
 * The waiting turn, rolled with `force` on the first tick the coming loop top can take it, and
 * ending there. Called after the wrap's landing and phrase roll, so it sees the loop as they left
 * it. It waits (stays waiting) while:
 * - that top is too close to schedule on (nextLoopTop has already moved past it): the next lap's
 *   wrap tick rolls it, after that wrap's landings;
 * - less than 1 beat plus TURN_LEAD_SEC is left (turnaroundTurnBeats);
 * - a change's lead-in (a hole, a riser) is scheduled for that top: it keeps it;
 * - a turnaround into that top has started, or starts within the lead: it is not cut off.
 * Otherwise a press late in the lap is clamped to the time left. A turnaround armed for that top
 * (a phrase end's, or an earlier turn's) is replaced: Engine.applyTurnaround replaces the one on
 * the timeline. Replacing a phrase end's means nothing fired there: the memory is cleared, and a
 * turn's own roll never writes it.
 */
function turnAt(c: Ctx, t: RadioTickInfo): void {
  const { s } = c
  const req = s.turnRequest
  if (!req || !s.clock || t.nextWrap === null) return
  const at = t.nextWrap
  const beat = 60 / s.bpm
  const toWrapSec = ((t.loopBars - t.pos) * 240) / s.bpm
  if (at - t.now > toWrapSec + 1e-3) return
  if (s.gestures.some((g) => radioGestureLeadsChange(g.kind) && g.at !== undefined && Math.abs(g.at - at) <= EPS)) return
  const armed = s.turnaround && Math.abs(s.turnaround.at - at) <= EPS ? s.turnaround : null
  if (armed && at - armed.plan.beats * beat < t.now + TURN_LEAD_SEC) return
  const maxBeats = turnaroundTurnBeats((at - t.now) / beat, TURN_LEAD_SEC / beat)
  if (maxBeats === null) return
  s.turnRequest = null
  const plan = rollTurnaround({
    rate: s.settings.turnarounds,
    random: c.rnd,
    lastPhrase: null,
    ...turnaroundInputOf(s, t.loopBars, leavingAt(s, at)),
    force: req.move === null ? { maxBeats } : { move: req.move, maxBeats }
  })
  if (!plan) {
    s.turnNothingAt = t.now
    return
  }
  if (armed && !armed.turn) s.lastTurnaround = null
  s.turnaround = { at, plan, turn: true }
  c.out.push({ type: 'turnaround', time: at, plan })
}

/** A change's transition when it lands on the wrap `wrap`: under a turnaround ending there, only
```

- [ ] **Step 9: Stop, hold and a pace change forget a waiting turn; `draft` copies it**

Find (the end of `stop`):

```ts
  s.lastTick = null
  s.turnaround = null
  s.lastTurnaround = null
}
```

Replace with:

```ts
  s.lastTick = null
  s.turnaround = null
  s.lastTurnaround = null
  s.turnRequest = null
  s.turnNothingAt = null
}
```

Find:

```ts
/** Take back the turnaround still to come (hold, a pace change). It never plays, so the next
 * phrase end is not "after a turnaround" either. */
function cancelTurnaround(c: Ctx): void {
  const { s } = c
  const now = s.lastTick?.now ?? Number.NEGATIVE_INFINITY
  if (s.turnaround && s.turnaround.at > now) c.out.push({ type: 'cancelTurnaround', time: s.turnaround.at })
  s.turnaround = null
  s.lastTurnaround = null
}
```

Replace with:

```ts
/** Take back the turnaround still to come (hold, a pace change), and a turn still waiting. It
 * never plays, so the next phrase end is not "after a turnaround" either. */
function cancelTurnaround(c: Ctx): void {
  const { s } = c
  const now = s.lastTick?.now ?? Number.NEGATIVE_INFINITY
  if (s.turnaround && s.turnaround.at > now) c.out.push({ type: 'cancelTurnaround', time: s.turnaround.at })
  s.turnaround = null
  s.lastTurnaround = null
  s.turnRequest = null
}
```

Find (the end of `draft`):

```ts
    turnaround: s.turnaround && { ...s.turnaround },
    lastTurnaround: s.lastTurnaround && { ...s.lastTurnaround }
  }
}
```

Replace with:

```ts
    turnaround: s.turnaround && { ...s.turnaround },
    lastTurnaround: s.lastTurnaround && { ...s.lastTurnaround },
    turnRequest: s.turnRequest && { ...s.turnRequest }
  }
}
```

- [ ] **Step 10: `view().turn`**

Find (the end of `RadioView`, and the comment after it):

```ts
    barsUntil: number | null
    ready: boolean
  } | null
}

/** The latest Next press still on its way (the highest token). */
```

Replace with:

```ts
    barsUntil: number | null
    ready: boolean
  } | null
  /** The turn (full mode's `turn` and its chips): `waiting` from the press until its top, the
   * chip it holds (a chip's move, or the move rolled for the planner's choice; null before
   * that), `nothing` for TURN_NOTHING_SEC after a press with nothing to turn, and the chips that
   * can sound now (turnaroundMoveCanSound). */
  turn: { waiting: boolean; move: TurnaroundMove | null; nothing: boolean; canSound: TurnaroundMove[] }
}

/** RadioView['turn']. */
function turnView(s: RadioState): RadioView['turn'] {
  const t = s.lastTick
  const armed = s.turnaround?.turn ? s.turnaround : null
  const input = s.phase === 'running' && t ? turnaroundInputOf(s, t.loopBars) : null
  return {
    waiting: !!s.turnRequest || !!armed,
    move: s.turnRequest ? s.turnRequest.move : (armed?.plan.move ?? null),
    nothing: s.turnNothingAt !== null && !!t && t.now - s.turnNothingAt < TURN_NOTHING_SEC,
    canSound: input ? TURNAROUND_MOVES.filter((m) => turnaroundMoveCanSound(input, m)) : []
  }
}

/** The latest Next press still on its way (the highest token). */
```

Find (in `describe`'s returned object):

```ts
    upcoming: next,
```

Replace with:

```ts
    upcoming: next,
    turn: turnView(s),
```

- [ ] **Step 11: Run the tests to make sure they pass**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts`
Expected: PASS: every test, the 10 new ones included.

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 12: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/step.ts src/radio/step.test.ts
git commit -m "radio turn: a turn event lands a turnaround on the next loop top, last tap wins, the phrase end stands down

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 3: `controller.turn` and the strip's model (ell.ing/radio)

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.test.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/fullModel.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/radio/controller.test.ts`. The file already has `rig`, `started`, `wrapAt` and `FakeEngine.turnarounds()`.

```ts

describe('turn', () => {
  it("a chip's press reaches the engine as a turnaround into the next loop top", async () => {
    const r = rig()
    await started(r)
    await r.run(0.1)
    r.ctl.turn('wash')
    expect(r.ctl.view().turn).toMatchObject({ waiting: true, move: 'wash' })
    await r.run(0.1)
    const [t, ...more] = r.eng.turnarounds()
    expect(more).toHaveLength(0)
    expect(t.plan.move).toBe('wash')
    expect(wrapAt(r, t.at)).toBe(true)
    expect(t.at - t.now).toBeLessThanOrEqual(r.eng.lap())
    expect(r.ctl.view().turn).toMatchObject({ waiting: true, move: 'wash' })
    await r.until(t.at)
    expect(r.ctl.view().turn.waiting).toBe(false)
  })

  it("the planner's choice, with no move", async () => {
    const r = rig()
    await started(r)
    await r.run(0.1)
    r.ctl.turn()
    await r.run(0.1)
    expect(r.eng.turnarounds()).toHaveLength(1)
  })
})
```

Append to the end of `src/ui/fullModel.test.ts`. The file already has `view`, `FullView`, `fullModel` and `fullKey`.

```ts

describe('the strip: turn', () => {
  const turn = (over: Partial<NonNullable<FullView['turn']>> = {}): NonNullable<FullView['turn']> => ({
    waiting: false,
    move: null,
    nothing: false,
    canSound: ['drum drop', 'low drop', 'stop', 'wash', 'lift', 'dip', 'riser'],
    ...over
  })

  it('reads turn at rest, turning while one waits, nothing to turn after an empty press', () => {
    expect(fullModel(view({ turn: turn() })).strip.turn.label).toBe('turn')
    expect(fullModel(view({ turn: turn({ waiting: true }) })).strip.turn.label).toBe('turning')
    expect(fullModel(view({ turn: turn({ nothing: true }) })).strip.turn.label).toBe('nothing to turn')
  })

  it("holds the waiting move's chip; a chip that cannot sound now is not now", () => {
    const chips = fullModel(view({ turn: turn({ waiting: true, move: 'wash', canSound: ['wash', 'riser'] }) })).strip.turn.chips
    expect(chips.map((c) => c.label)).toEqual(['drop', 'low drop', 'stop', 'wash', 'lift', 'dip', 'riser'])
    expect(chips.filter((c) => c.held).map((c) => c.move)).toEqual(['wash'])
    expect(chips.filter((c) => !c.notNow).map((c) => c.move)).toEqual(['wash', 'riser'])
  })

  it('is off with every chip not now while stopped, or with no turn in the view', () => {
    const stopped = fullModel(view({ phase: 'stopped', turn: turn() })).strip.turn
    expect(stopped.enabled).toBe(false)
    expect(stopped.chips.every((c) => c.notNow)).toBe(true)
    const none = fullModel(view()).strip.turn
    expect(none.label).toBe('turn')
    expect(none.chips.every((c) => c.notNow)).toBe(true)
  })

  it('a change of the turn redraws', () => {
    expect(fullKey(view({ turn: turn({ waiting: true }) }))).not.toBe(fullKey(view({ turn: turn() })))
    expect(fullKey(view({ turn: turn({ canSound: ['wash'] }) }))).not.toBe(fullKey(view({ turn: turn() })))
    expect(fullKey(view({ turn: turn({ nothing: true }) }))).not.toBe(fullKey(view({ turn: turn() })))
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts src/ui/fullModel.test.ts`
Expected: FAIL in the new blocks only: `r.ctl.turn is not a function`, and `Cannot read properties of undefined (reading 'label')` on `strip.turn`.

- [ ] **Step 3: `controller.turn`**

In `src/radio/controller.ts`, find:

```ts
import type { TurnaroundDepth, TurnaroundFamily, TurnaroundPlan } from '@shared/radioTurnaround'
```

Replace with:

```ts
import type { TurnaroundDepth, TurnaroundFamily, TurnaroundMove, TurnaroundPlan } from '@shared/radioTurnaround'
```

Find:

```ts
  /** "swap now" on a row (full mode)
```

Replace with:

```ts
  /** A turn (full mode): a turnaround at the next loop top -- `move` a chip's, absent the
   * planner's choice. A later press replaces one still waiting; view().turn says where it is. */
  turn(move?: TurnaroundMove): void {
    this.dispatch(move === undefined ? { type: 'turn' } : { type: 'turn', move })
  }
  /** "swap now" on a row (full mode)
```

- [ ] **Step 4: `FullTurn` on the strip**

In `src/ui/fullModel.ts`, find:

```ts
import { RADIO_PACE_OPTIONS } from '@shared/radioSchedule'
```

Replace with:

```ts
import { RADIO_PACE_OPTIONS } from '@shared/radioSchedule'
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES, type TurnaroundMove } from '@shared/radioTurnaround'
```

Find:

```ts
  /** A Next press on its way; null or absent for none. */
  next?: RadioView['next']
}
```

Replace with:

```ts
  /** A Next press on its way; null or absent for none. */
  next?: RadioView['next']
  /** The turn; absent reads as at rest, every chip dimmed. */
  turn?: RadioView['turn']
}
```

Find:

```ts
  /** A Next press on its way: next reads … */
  nextPending: boolean
}
```

Replace with:

```ts
  /** A Next press on its way: next reads … */
  nextPending: boolean
  turn: FullTurn
}

/** The turn and its chips (spec sssketch 2026-10-02-radio-turn-button-design). */
export interface FullTurn {
  /** `turn`; `turning` while a turn waits for its top; `nothing to turn` a while after a press
   * that had nothing to turn. */
  label: 'turn' | 'turning' | 'nothing to turn'
  /** Only while the radio runs. */
  enabled: boolean
  /** Every move, in the planner's order: `held` is the one a waiting turn plays, `notNow` one
   * that cannot sound now (its tooltip says `not now`). */
  chips: { move: TurnaroundMove; label: string; held: boolean; notNow: boolean }[]
}

/** FullStrip['turn'], from view().turn. */
export function fullTurn(view: FullView): FullTurn {
  const t = view.turn
  const running = view.phase === 'running'
  return {
    label: t?.nothing ? 'nothing to turn' : t?.waiting ? 'turning' : 'turn',
    enabled: running,
    chips: TURNAROUND_MOVES.map((move) => ({
      move,
      label: TURNAROUND_MOVE_LABEL[move],
      held: !!t?.waiting && t.move === move,
      notNow: !running || !t || !t.canSound.includes(move)
    }))
  }
}
```

Find:

```ts
      nextPending: !!view.next
    },
```

Replace with:

```ts
      nextPending: !!view.next,
      turn: fullTurn(view)
    },
```

Find:

```ts
  return [view.phase, view.bpm, view.tempoTarget, view.held, view.pace, view.loopBars, failed, !!view.next, heartLiked, ...rows].join('\n')
```

Replace with:

```ts
  const t = view.turn
  const turn = t ? [t.waiting, t.move, t.nothing, t.canSound.join()].join('/') : ''
  return [view.phase, view.bpm, view.tempoTarget, view.held, view.pace, view.loopBars, failed, !!view.next, heartLiked, turn, ...rows].join('\n')
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts src/ui/fullModel.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm test`
Expected: clean and green.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/controller.ts src/radio/controller.test.ts src/ui/fullModel.ts src/ui/fullModel.test.ts
git commit -m "radio turn: controller.turn, and the strip's turn and chips in full mode's model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 4: Full mode's `turn` and chips (ell.ing/radio)

`full.ts` is DOM code with no unit tests in this repo, by convention. `fullModel` (Task 3) carries the logic. This task is verified by typecheck, the suite and the build.

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.css`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/main.ts`

- [ ] **Step 1: The handler, the group and the drawing**

In `src/ui/full.ts`, find:

```ts
import { TURNAROUND_FAMILIES, toggleTurnaroundFamily } from '@shared/radioTurnaround'
```

Replace with:

```ts
import { TURNAROUND_FAMILIES, TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES, toggleTurnaroundFamily, type TurnaroundMove } from '@shared/radioTurnaround'
```

Find:

```ts
  readTurnarounds(): TurnaroundPrefs
  turnarounds(p: TurnaroundPrefs): void
```

Replace with:

```ts
  readTurnarounds(): TurnaroundPrefs
  turnarounds(p: TurnaroundPrefs): void
  /** A turn at the next loop top: a chip's move, or null for the planner's choice. */
  turn(move: TurnaroundMove | null): void
```

Find:

```ts
  drawTurns()
  // the filter: lp/hp
```

Replace with:

```ts
  drawTurns()
  // the turn, beside the turnaround toggles: `turn` lets the planner choose, a chip plays its move
  // (spec sssketch 2026-10-02-radio-turn-button-design); both land on the next loop top
  const turnGrp = h('div', 'knob')
  const turnBtn = button('turn', 'turn at the top', () => on.turn(null))
  turnBtn.title = 'turn at the top'
  turnGrp.append(turnBtn)
  const turnChips = TURNAROUND_MOVES.map((move) => {
    const b = button(TURNAROUND_MOVE_LABEL[move], `turn: ${TURNAROUND_MOVE_LABEL[move]}`, () => on.turn(move))
    turnGrp.append(b)
    return { move, b }
  })
  // the filter: lp/hp
```

Find:

```ts
  masterGrp.append(level.wrap, reverb.wrap, ...fxRanges.map((r) => r.wrap), turns, ...(
```

Replace with:

```ts
  masterGrp.append(level.wrap, reverb.wrap, ...fxRanges.map((r) => r.wrap), turns, turnGrp, ...(
```

(Only `turnGrp, ` is inserted after `turns, `. The rest of that line stays as it is.)

Find:

```ts
      hold.setAttribute('aria-label', s.held ? 'held: let the mix change again' : 'hold this mix')
```

Replace with:

```ts
      hold.setAttribute('aria-label', s.held ? 'held: let the mix change again' : 'hold this mix')
      turnBtn.textContent = s.turn.label
      turnBtn.disabled = !s.turn.enabled
      for (const { move, b } of turnChips) {
        const chip = s.turn.chips.find((c) => c.move === move)!
        pressed(b, chip.held)
        b.classList.toggle('notnow', chip.notNow)
        b.title = chip.notNow ? 'not now' : ''
      }
```

- [ ] **Step 2: The dimmed look**

In `src/ui/full.css`, find:

```css
.full button.w.on { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
```

Replace with:

```css
.full button.w.on { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
/* a turn chip that cannot sound now, and the turn while the radio is stopped */
.full button.w.notnow, .full button.w:disabled { color: var(--faint); }
```

(Not `.dim`: `.full.dim` is the idle fade's class.)

- [ ] **Step 3: The page calls the radio**

In `src/main.ts`, find:

```ts
      radio?.setTurnaroundControls(p.moves, p.depth)
    },
```

Replace with:

```ts
      radio?.setTurnaroundControls(p.moves, p.depth)
    },
    turn: (move) => radio?.turn(move ?? undefined),
```

- [ ] **Step 4: Verify**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test && npm run build`
Expected: clean, green, and a build with no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/ui/full.ts src/ui/full.css src/main.ts
git commit -m "radio turn: full mode's turn and move chips beside the turnaround toggles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 5: sssketch Discover: turn, chips, `t` and undo (DiscoverPanel.tsx)

The panel glue has no tests, by this repo's convention (CLAUDE.md, "React components"). It is verified by typecheck and lint, and by Elling (Task 9). The logic it calls is Task 1's, tested. Apply the edits in order, and format by hand: never prettier the whole file.

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Imports**

Find:

```ts
  rememberTurnaround,
  rollTurnaround,
  turnaroundArc,
  turnaroundFitsLoop,
  turnaroundToLoopBars,
  turnaroundWashSend,
  type RadioTurnaroundGate,
  type TurnaroundMemory,
  type TurnaroundPlan
} from '@shared/radioTurnaround'
```

Replace with:

```ts
  rememberTurnaround,
  rollTurnaround,
  TURNAROUND_MOVE_LABEL,
  TURNAROUND_MOVES,
  turnaroundArc,
  turnaroundDraw,
  turnaroundFitsLoop,
  turnaroundMoveCanSound,
  turnaroundToLoopBars,
  turnaroundTurnBeats,
  turnaroundWashSend,
  type RadioTurnaroundGate,
  type TurnaroundInput,
  type TurnaroundMemory,
  type TurnaroundMove,
  type TurnaroundPlan,
  type TurnaroundRow
} from '@shared/radioTurnaround'
```

- [ ] **Step 2: The owed roll knows whether it is a phrase end's; module helpers**

Find:

```ts
interface TurnaroundRollOwed {
  loopBars: number
  landed: Map<string, number | null>
}
```

Replace with:

```ts
interface TurnaroundRollOwed {
  loopBars: number
  landed: Map<string, number | null>
  /** The wrap starts a phrase's last lap: the phrase end's own roll. False for a roll owed only
   * because a turn was waiting (radioTurnPendingRef). */
  phraseEnd: boolean
}

/** A turn's lead, in beats (turnaroundTurnBeats): the push carrying it must reach the engine
 * before its move starts -- tens to a couple of hundred ms, measured (holdSyncUntilResolved), so
 * a beat at any tempo radio plays, as TURNAROUND_ROLL_LATE_BARS is. */
const TURN_LEAD_BEATS = TURNAROUND_ROLL_LATE_BARS * 4

/** Discover's rows as the turnaround planner sees them (@shared/radioTurnaround TurnaroundRow):
 * heard when previewing and resolved, and not the row a thinning arc is taking out (`exiting`). */
function discoverTurnaroundRows(
  slots: readonly DiscoverSlot[],
  o: {
    previewing: ReadonlySet<string>
    lengths: ReadonlyMap<string, number>
    loopBars: number
    flags: RadioSlotFlags
    exiting: string | null
    filteringIn: (slotId: string) => boolean
  }
): TurnaroundRow[] {
  return slots.map((s) => ({
    id: s.id,
    kinds: s.kinds,
    hooked: o.flags[s.id] === 'hook',
    audible: o.previewing.has(s.id) && o.lengths.has(s.id) && s.id !== o.exiting,
    inFilterIn: o.filteringIn(s.id),
    barLength: o.lengths.get(s.id) ?? o.loopBars
  }))
}
```

- [ ] **Step 3: The armed turnaround knows a turn; the turn's refs and state**

Find:

```ts
  const radioTurnaroundRef = useRef<{ plan: TurnaroundPlan; armId: string } | null>(null)
```

Replace with:

```ts
  // `turn`: armed by a turn (radioTurnPendingRef) rather than a phrase end, with the undo sequence
  // it was pressed at (withdrawRadioTurn).
  const radioTurnaroundRef = useRef<{
    plan: TurnaroundPlan
    armId: string
    turn: { undoSeq: number } | null
  } | null>(null)
```

Find:

```ts
  // The phrase end's roll while it is owed (TurnaroundRollOwed); null when nothing is owed.
  const radioTurnaroundRollRef = useRef<TurnaroundRollOwed | null>(null)
```

Replace with:

```ts
  // The phrase end's roll while it is owed (TurnaroundRollOwed); null when nothing is owed.
  const radioTurnaroundRollRef = useRef<TurnaroundRollOwed | null>(null)
  // A TURN pressed and not rolled yet (docs/superpowers/specs/2026-10-02-radio-turn-button-
  // design.md): a chip's `move`, absent for the planner's choice, and the undo sequence it was
  // pressed at. The latest press wins. See radioTurnTick.
  const radioTurnPendingRef = useRef<{ move?: TurnaroundMove; undoSeq: number } | null>(null)
  // turnRadio, as THIS render has it, for the listeners registered once (`t`, the phone): set
  // every render, for the reason remoteCommandRef is.
  const turnRadioRef = useRef<(move?: TurnaroundMove) => void>(() => {})
  // What the turn button shows: null at rest; otherwise a turn waits for the top (pressed, or
  // armed and playing into it), and `move` is the chip it holds -- a chip's move, or the move
  // rolled for the planner's choice (null until then).
  const [radioTurnShown, setRadioTurnShown] = useState<{ move: TurnaroundMove | null } | null>(null)
  // The turn button's flash (`nothing to turn`), for a couple of seconds.
  const [radioTurnFlash, setRadioTurnFlash] = useState<string | null>(null)
  // Which turns could sound now, refreshed by the clock effect (refreshRadioTurnCan): the
  // planner's (`canTurn`) and each chip's (`moves`; the rest are dimmed). Null with radio off.
  const [radioTurnCan, setRadioTurnCan] = useState<{
    canTurn: boolean
    moves: TurnaroundMove[]
  } | null>(null)
```

- [ ] **Step 4: The wrap owes a roll for a waiting turn too**

Find:

```ts
  function radioTurnaroundAtWrap(lapStarts: boolean, loopBars: number): void {
    const had = radioTurnaroundRef.current !== null
    radioTurnaroundRef.current = null
    if (radioTurnaroundRollRef.current !== null) {
      radioTurnaroundRollRef.current = null
      radioTurnaroundMemoryRef.current = null
    }
    radioTurnaroundRollPendingRef.current = false
    if (!lapStarts) {
      if (had) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      return
    }
    radioTurnaroundRollPendingRef.current = true
    radioTurnaroundRollRef.current = { loopBars, landed: new Map() }
```

Replace with:

```ts
  function radioTurnaroundAtWrap(lapStarts: boolean, loopBars: number): void {
    const had = radioTurnaroundRef.current !== null
    // A turn that played into this top is over: the button goes back to `turn` -- unless a later
    // tap is already waiting, which the button is showing.
    if (radioTurnaroundRef.current?.turn != null && radioTurnPendingRef.current === null) {
      setRadioTurnShown(null)
    }
    radioTurnaroundRef.current = null
    if (radioTurnaroundRollRef.current !== null) {
      // given up: nothing fired at that phrase end (a roll owed only for a turn remembers nothing)
      if (radioTurnaroundRollRef.current.phraseEnd) radioTurnaroundMemoryRef.current = null
      radioTurnaroundRollRef.current = null
    }
    radioTurnaroundRollPendingRef.current = false
    // A turn waiting is rolled here too, in the same deferred slot as a phrase end's roll -- after
    // this wrap's landings -- and in its place (rollRadioTurnaround).
    if (!lapStarts && radioTurnPendingRef.current === null) {
      if (had) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      return
    }
    radioTurnaroundRollPendingRef.current = true
    radioTurnaroundRollRef.current = { loopBars, landed: new Map(), phraseEnd: lapStarts }
```

- [ ] **Step 5: Giving up a roll owed only for a turn keeps the memory, and the turn**

Find:

```ts
  /** Gives the owed roll up: nothing fires at this phrase end. */
  function giveUpTurnaroundRoll(): void {
    radioTurnaroundRollRef.current = null
    radioTurnaroundRollPendingRef.current = false
    radioTurnaroundMemoryRef.current = null
  }
```

Replace with:

```ts
  /** Gives the owed roll up: nothing fires at this phrase end. A turn waiting stays waiting:
   * radioTurnTick rolls it, clamped to what is left of the lap. */
  function giveUpTurnaroundRoll(): void {
    if (radioTurnaroundRollRef.current?.phraseEnd !== false) {
      radioTurnaroundMemoryRef.current = null
    }
    radioTurnaroundRollRef.current = null
    radioTurnaroundRollPendingRef.current = false
  }
```

- [ ] **Step 6: `rollRadioTurnaround` takes a turn in the phrase end's place; the turn's functions**

Find the whole of `rollRadioTurnaround`, keeping its doc comment above it. It is this block:

```ts
  function rollRadioTurnaround(owed: TurnaroundRollOwed): void {
    const leadArmed = radioGestureRef.current.some(
      (g) => g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
    )
    if (leadArmed) {
      radioTurnaroundMemoryRef.current = null
      return
    }
    // The landings at this wrap have run: a joining row is in the previewing mix
    // (joinPreviewingMix), and an arrival gesture landing with its row is on radioGestureRef --
    // a filter in there is `inFilterIn`, so the planner never aims a lift or a dip at a row the
    // lane builder would then skip.
    const previewing = previewingSlotIdsRef.current
    const { lengths, loopBars } = turnaroundRollLengths(owed)
    // The row a thinning arc is taking out (stepArcExit) is left out of the turnaround, as if
    // unheard, but only when its exit fades in this lap: an 8-beat drop-out (ARC_EXIT_BEATS, at
    // most half the loop) that goes silent before the wrap and removes the row in the silence,
    // so a move ending on the wrap -- a wash above all -- would land on a row already gone. An
    // exit held back (arcExitHeldBack: a stage out, a drop-out or lead-in armed) is not leaving
    // at this wrap: the row plays on, so it stays in, and a stop or low drop silences it as any
    // other. No `leavingRowId` either way: the planner's wash takes the non-drums bed. (The web
    // radio's leaving row goes silent before the wrap too -- the same 8-beat exit hole -- and its
    // roll leaves it out the same way.)
    const exit = arcExitRef.current
    const exiting =
      exit !== null &&
      ((exit.phase === 'fading' && exit.lap === arcLapRef.current) ||
        (exit.phase === 'waiting' && !arcExitHeldBack()))
        ? exit.slotId
        : null
    const plan = rollTurnaround({
      rate: radioSettings.turnarounds,
      random: Math.random,
      loopBars,
      lastPhrase: radioTurnaroundMemoryRef.current,
      rows: slotsRef.current.map((s) => ({
        id: s.id,
        kinds: s.kinds,
        hooked: radioSlotFlagsRef.current[s.id] === 'hook',
        audible: previewing.has(s.id) && lengths.has(s.id) && s.id !== exiting,
        inFilterIn: radioGestureRef.current.some(
          (g) => g.slotId === s.id && g.kind === 'filter in'
        ),
        barLength: lengths.get(s.id) ?? loopBars
      })),
      arc:
        radioDensityOf(radioSettings) === 'arc'
          ? turnaroundArc(densityLegRef.current, slotsRef.current.length)
          : 'steady',
      leavingRowId: null,
      moves: radioSettings.turnaroundMoves,
      depth: radioSettings.turnaroundDepth
    })
    radioTurnaroundMemoryRef.current = rememberTurnaround(plan)
    radioTurnaroundRef.current = plan === null ? null : { plan, armId: newArmId() }
  }
```

Replace it with:

```ts
  function rollRadioTurnaround(owed: TurnaroundRollOwed): void {
    const leadArmed = radioGestureRef.current.some(
      (g) => g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
    )
    if (leadArmed) {
      // a turn waiting keeps waiting: the lead-in has this top, the turn takes the next
      if (owed.phraseEnd) radioTurnaroundMemoryRef.current = null
      return
    }
    const { lengths, loopBars } = turnaroundRollLengths(owed)
    const input = turnaroundInputNow(lengths, loopBars)
    const turn = radioTurnPendingRef.current
    if (turn !== null) {
      // A TURN takes this top: the phrase end's own roll stands down and remembers nothing, so a
      // turn never starts or extends a diminution.
      if (owed.phraseEnd) radioTurnaroundMemoryRef.current = null
      armRadioTurn(
        rollTurnaround({
          ...input,
          rate: radioSettings.turnarounds,
          random: Math.random,
          lastPhrase: null,
          force: turn.move === undefined ? {} : { move: turn.move }
        }),
        turn.undoSeq
      )
      return
    }
    // A roll owed only for a turn that was withdrawn since (undo): nothing to roll.
    if (!owed.phraseEnd) return
    const plan = rollTurnaround({
      ...input,
      rate: radioSettings.turnarounds,
      random: Math.random,
      lastPhrase: radioTurnaroundMemoryRef.current
    })
    radioTurnaroundMemoryRef.current = rememberTurnaround(plan)
    radioTurnaroundRef.current = plan === null ? null : { plan, armId: newArmId(), turn: null }
  }
  /** What a roll reads now, but the rate, the randomness and the memory: the rows at `lengths`
   * (a landing's known length over the old one), on `loopBars`.
   *
   * The landings at this wrap have run: a joining row is in the previewing mix
   * (joinPreviewingMix), and an arrival gesture landing with its row is on radioGestureRef -- a
   * filter in there is `inFilterIn`, so the planner never aims a lift or a dip at a row the lane
   * builder would then skip.
   *
   * The row a thinning arc is taking out (stepArcExit) is left out of the turnaround, as if
   * unheard, but only when its exit fades in this lap: an 8-beat drop-out (ARC_EXIT_BEATS, at
   * most half the loop) that goes silent before the wrap and removes the row in the silence, so a
   * move ending on the wrap -- a wash above all -- would land on a row already gone. An exit held
   * back (arcExitHeldBack: a stage out, a drop-out or lead-in armed) is not leaving at this wrap:
   * the row plays on, so it stays in, and a stop or low drop silences it as any other. No
   * `leavingRowId` either way: the planner's wash takes the non-drums bed. (The web radio's
   * leaving row goes silent before the wrap too -- the same 8-beat exit hole -- and its roll
   * leaves it out the same way.) */
  function turnaroundInputNow(
    lengths: ReadonlyMap<string, number>,
    loopBars: number
  ): Omit<TurnaroundInput, 'rate' | 'random' | 'lastPhrase'> {
    const exit = arcExitRef.current
    const exiting =
      exit !== null &&
      ((exit.phase === 'fading' && exit.lap === arcLapRef.current) ||
        (exit.phase === 'waiting' && !arcExitHeldBack()))
        ? exit.slotId
        : null
    return {
      loopBars,
      rows: discoverTurnaroundRows(slotsRef.current, {
        previewing: previewingSlotIdsRef.current,
        lengths,
        loopBars,
        flags: radioSlotFlagsRef.current,
        exiting,
        filteringIn: (slotId) =>
          radioGestureRef.current.some((g) => g.slotId === slotId && g.kind === 'filter in')
      }),
      arc:
        radioDensityOf(radioSettings) === 'arc'
          ? turnaroundArc(densityLegRef.current, slotsRef.current.length)
          : 'steady',
      leavingRowId: null,
      moves: radioSettings.turnaroundMoves,
      depth: radioSettings.turnaroundDepth
    }
  }
  /** The loop as it plays now: every resolved row's length, and the longest. */
  function turnaroundLoopNow(): { lengths: Map<string, number>; loopBars: number } {
    const lengths = new Map(resolvedBarLengthsRef.current)
    return { lengths, loopBars: lengths.size > 0 ? Math.max(...lengths.values()) : 0 }
  }
  /** A turn's roll, armed: it has the lap, as a phrase end's does (radioTurnaroundGate, the
   * throws). Null is nothing to turn: the button says so. No push here -- the caller's. */
  function armRadioTurn(plan: TurnaroundPlan | null, undoSeq: number): void {
    radioTurnPendingRef.current = null
    if (plan === null) {
      setRadioTurnShown(null)
      flashRadioTurn('nothing to turn')
      return
    }
    radioTurnaroundRef.current = { plan, armId: newArmId(), turn: { undoSeq } }
    setRadioTurnShown({ move: plan.move })
  }
  /** The turn button's flash, for two seconds. */
  function flashRadioTurn(text: string): void {
    setRadioTurnFlash(text)
    window.setTimeout(() => setRadioTurnFlash((f) => (f === text ? null : f)), 2000)
  }
  /** Every tick but a wrap: a turn waiting rolls as soon as the coming top can take it, its move
   * clamped to the time left (turnaroundTurnBeats, less TURN_LEAD_BEATS). It waits -- for a later
   * tick, or the next wrap's roll (radioTurnaroundAtWrap) -- while:
   * - the wrap's own roll is still owed (radioTurnaroundRollRef): that roll takes the turn;
   * - a change's lead-in (a hole, a riser) has this top: it keeps it;
   * - a move already armed into this top has started, or starts within the lead: it is not cut;
   * - under 1 beat plus the lead is left;
   * - a stage is out that cannot be re-staged in time (a mid-lap cut at a bar, or under
   *   MANUAL_RESTAGE_MIN_BARS to the wrap). Otherwise the stage is withdrawn and re-staged on a
   *   later tick, after the push carrying the turn (an ordinary push withdraws a stage anyway).
   * A turnaround armed for this lap -- a phrase end's, or an earlier turn's -- is replaced: the
   * latest decision wins. Replacing a phrase end's means nothing fired there, so the memory goes.
   * No pushUndoSnapshot: a turn is performance, not an edit (withdrawRadioTurn). */
  function radioTurnTick(pos: number, loopBars: number): void {
    const turn = radioTurnPendingRef.current
    if (turn === null || radioTurnaroundRollRef.current !== null || !(loopBars > 0)) return
    if (
      radioGestureRef.current.some((g) => g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind))
    ) {
      return
    }
    const toTopBeats = (loopBars - pos) * 4
    const armed = radioTurnaroundRef.current
    if (armed !== null && toTopBeats - armed.plan.beats < TURN_LEAD_BEATS) return
    const maxBeats = turnaroundTurnBeats(toTopBeats, TURN_LEAD_BEATS)
    if (maxBeats === null) return
    if (radioStageRef.current !== null) {
      if (
        radioLedChangeRef.current?.atBars !== undefined ||
        loopBars - pos < MANUAL_RESTAGE_MIN_BARS
      ) {
        return
      }
      cancelStagedSwap('turn')
    }
    const { lengths } = turnaroundLoopNow()
    const plan = rollTurnaround({
      ...turnaroundInputNow(lengths, loopBars),
      rate: radioSettings.turnarounds,
      random: Math.random,
      lastPhrase: null,
      force: turn.move === undefined ? { maxBeats } : { move: turn.move, maxBeats }
    })
    if (plan !== null && armed !== null && armed.turn === null) {
      radioTurnaroundMemoryRef.current = null
    }
    armRadioTurn(plan, turn.undoSeq)
    if (plan !== null) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** Which turns could sound now (radioTurnCan), from the clock effect: kept when unchanged, so
   * a tick re-renders nothing. */
  function refreshRadioTurnCan(): void {
    const { lengths, loopBars } = turnaroundLoopNow()
    const input = turnaroundInputNow(lengths, loopBars)
    const next = {
      canTurn: turnaroundDraw(input).length > 0,
      moves: TURNAROUND_MOVES.filter((m) => turnaroundMoveCanSound(input, m))
    }
    setRadioTurnCan((prev) =>
      prev !== null && prev.canTurn === next.canTurn && prev.moves.join() === next.moves.join()
        ? prev
        : next
    )
  }
  /** A TURN pressed: the desktop's `turn` and chips, `t`, and the phone (remoteCommandRef). A
   * press that cannot sound now -- the chip's guards, or nothing the planner could draw -- says
   * `nothing to turn` and waits for nothing. Otherwise it waits for the top (radioTurnTick, or
   * the next wrap's roll); a later press replaces it. Turnarounds `off` stops only the phrase
   * ends: a turn still works. */
  function turnRadio(move?: TurnaroundMove): void {
    if (!radioOnRef.current) return
    const { lengths, loopBars } = turnaroundLoopNow()
    const input = turnaroundInputNow(lengths, loopBars)
    const can =
      move !== undefined ? turnaroundMoveCanSound(input, move) : turnaroundDraw(input).length > 0
    if (!can) {
      flashRadioTurn('nothing to turn')
      return
    }
    const undoSeq = undoSequence.latest()
    radioTurnPendingRef.current = move === undefined ? { undoSeq } : { move, undoSeq }
    setRadioTurnShown({ move: move ?? null })
  }
  /** Undo's first stop: a turn pressed after the latest undo point is taken back on its own, as
   * the newest thing done (a turn pushes no snapshot -- it is not slot state). A turn waiting is
   * dropped; one armed is taken off only while its move has not begun, by TURN_LEAD_BEATS. True
   * when it took one back. A turn pressed BEFORE the latest undo point waits: that snapshot's
   * edit is undone first, then the turn on the next undo. */
  function withdrawRadioTurn(): boolean {
    const pending = radioTurnPendingRef.current
    const armed = radioTurnaroundRef.current?.turn != null ? radioTurnaroundRef.current : null
    const undoSeq = pending?.undoSeq ?? armed?.turn?.undoSeq
    if (undoSeq === undefined) return false
    const top = undoStack[undoStack.length - 1]
    const topSeq = top === undefined ? undefined : undoSequence.seqOf(top)
    if (topSeq !== undefined && undoSeq < topSeq) return false
    if (pending !== null) {
      radioTurnPendingRef.current = null
      setRadioTurnShown(armed === null ? null : { move: armed.plan.move })
      return true
    }
    if (armed === null) return false
    const { loopBars } = turnaroundLoopNow()
    const at = radioClockRef.current?.lastPos ?? 0
    if ((loopBars - at) * 4 - armed.plan.beats < TURN_LEAD_BEATS) return false
    radioTurnaroundRef.current = null
    setRadioTurnShown(null)
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
    return true
  }
```

- [ ] **Step 7: Radio off and a course change clear the turn; so does the panel closing**

Find:

```ts
  function clearRadioTurnaround(): void {
    radioTurnaroundMemoryRef.current = null
    radioTurnaroundRollPendingRef.current = false
    radioTurnaroundRollRef.current = null
```

Replace with:

```ts
  function clearRadioTurnaround(): void {
    radioTurnaroundMemoryRef.current = null
    radioTurnaroundRollPendingRef.current = false
    radioTurnaroundRollRef.current = null
    // a turn waiting goes too (radio off, a course change)
    radioTurnPendingRef.current = null
    setRadioTurnShown(null)
    if (!radioOnRef.current) setRadioTurnCan(null)
```

(`stopRadio` sets `radioOnRef.current = false` before it calls `clearRadioTurnaround()`, so radio off also clears the dimming. A course change keeps it.)

Find (in the unmount cleanup):

```ts
      radioTurnaroundRef.current = null
      radioTurnaroundMemoryRef.current = null
      radioTurnaroundRollPendingRef.current = false
      radioTurnaroundRollRef.current = null
      radioThrowRef.current = initialDiscoverThrowState()
```

Replace with:

```ts
      radioTurnaroundRef.current = null
      radioTurnaroundMemoryRef.current = null
      radioTurnaroundRollPendingRef.current = false
      radioTurnaroundRollRef.current = null
      radioTurnPendingRef.current = null
      radioThrowRef.current = initialDiscoverThrowState()
```

- [ ] **Step 8: The clock effect ticks the turn and refreshes the dimming**

Find:

```ts
    if (step.wrapped) radioTurnaroundAtWrap(step.turnaroundLapStarts, loopBars)
    else radioTurnaroundOverdue()
```

Replace with:

```ts
    if (step.wrapped) radioTurnaroundAtWrap(step.turnaroundLapStarts, loopBars)
    else {
      radioTurnaroundOverdue()
      // A turn waiting rolls as soon as this lap's top can take it (radioTurnTick).
      radioTurnTick(pos, loopBars)
    }
    // What the turn button and its chips can do now.
    refreshRadioTurnCan()
```

- [ ] **Step 9: Undo withdraws a turn first; the button is live while one shows**

Find:

```ts
  function undoDiscoverAction(): void {
    if (undoStack.length === 0) return
```

Replace with:

```ts
  function undoDiscoverAction(): void {
    // A turn waiting for the loop top, pressed since the latest undo point, is the newest thing
    // done: it alone is taken back (withdrawRadioTurn).
    if (withdrawRadioTurn()) return
    if (undoStack.length === 0) return
```

Find:

```tsx
          onClick={undoDiscoverAction}
          disabled={undoStack.length === 0}
          data-tooltip="undo"
          aria-label="undo"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: undoStack.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: undoStack.length === 0 ? 'default' : 'pointer'
          }}
```

Replace with:

```tsx
          onClick={undoDiscoverAction}
          disabled={undoStack.length === 0 && radioTurnShown === null}
          data-tooltip="undo"
          aria-label="undo"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color:
              undoStack.length === 0 && radioTurnShown === null
                ? 'var(--ra-text-4)'
                : 'var(--ra-text-2)',
            cursor: undoStack.length === 0 && radioTurnShown === null ? 'default' : 'pointer'
          }}
```

- [ ] **Step 10: The button and the chips, after the radio settings chevron**

Find (the end of the chevron button, and the menu after it):

```tsx
            v
          </button>
        )}
        {radioMenu && (
```

Replace with:

```tsx
            v
          </button>
        )}
        {/* Radio's turn (docs/superpowers/specs/2026-10-02-radio-turn-button-design.md): a
            turnaround at the next loop top. `turn` lets the planner choose; a chip plays its
            move, whatever the menu's moves say. While one waits the button reads `turning` and
            its move's chip is held; a chip that cannot sound now is dimmed. Monochrome: chrome. */}
        {radioOn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              onClick={() => turnRadio()}
              data-tooltip="turn at the top"
              aria-label="turn at the top"
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '3px 10px',
                background: radioTurnShown !== null ? 'var(--ra-text)' : 'transparent',
                border: '1px solid var(--ra-border-strong)',
                color: radioTurnShown !== null ? 'var(--ra-bg-page)' : 'var(--ra-text)',
                cursor: 'pointer'
              }}
            >
              {radioTurnFlash ?? (radioTurnShown !== null ? 'turning' : 'turn')}
            </button>
            <div style={{ display: 'flex', gap: 2 }}>
              {TURNAROUND_MOVES.map((move) => {
                const held = radioTurnShown !== null && radioTurnShown.move === move
                const notNow = radioTurnCan !== null && !radioTurnCan.moves.includes(move)
                return (
                  <button
                    key={move}
                    onClick={() => turnRadio(move)}
                    data-tooltip={notNow ? 'not now' : `turn: ${TURNAROUND_MOVE_LABEL[move]}`}
                    aria-label={`turn: ${TURNAROUND_MOVE_LABEL[move]}`}
                    aria-pressed={held}
                    style={{
                      fontFamily: 'inherit',
                      fontSize: 8,
                      padding: '1px 4px',
                      background: held ? 'var(--ra-text)' : 'transparent',
                      border: '1px solid var(--ra-border)',
                      color: held
                        ? 'var(--ra-bg-page)'
                        : notNow
                          ? 'var(--ra-text-4)'
                          : 'var(--ra-text-3)',
                      cursor: 'pointer'
                    }}
                  >
                    {TURNAROUND_MOVE_LABEL[move]}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {radioMenu && (
```

Lit is inverted: `--ra-text` behind `--ra-bg-page` ink, both real tokens in `src/renderer/src/styles/tokens.css`. That is the same inversion the phone uses for a held chip. Colour stays on audio information only.

- [ ] **Step 11: `t` turns, while radio runs**

Find:

```ts
  const hasPendingAdd = pendingAddKinds.length > 0
```

Replace with:

```ts
  const hasPendingAdd = pendingAddKinds.length > 0

  // `t` turns (the turn button), while radio runs. Nothing else claims a plain `t`: App's
  // shortcuts are Delete/Backspace, Escape, Space, Tab, Cmd/Ctrl-Z, Ctrl-Y, Cmd-0, Cmd-S, `\`
  // and `/`; no component binds a letter. Not in a text field, not with a modifier (Cmd-T and
  // friends belong to the system), and not a held key's repeats. In a ref, refreshed every
  // render (turnRadioRef), for the reason remoteCommandRef is.
  useEffect(() => {
    turnRadioRef.current = turnRadio
  })
  useEffect(() => {
    if (!radioOn) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 't' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      turnRadioRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [radioOn])
```

- [ ] **Step 12: Confirm `t` is still free**

Run: `cd /Users/nickel/Claudecode/sssketch && grep -rn "key === 't'\|key !== 't'\|'KeyT'\|accelerator.*T\b" src | grep -v DiscoverPanel.tsx`
Expected: no output. If anything matches, stop and report it to Elling before going on.

- [ ] **Step 13: Verify**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck`
Expected: clean.

Run: `npx eslint src/renderer/src/components/DiscoverPanel.tsx`
Expected: no output: no errors and no warnings. A `react-hooks/immutability` error means a listener calls `turnRadio` directly. It must go through `turnRadioRef` (spec point 13).

Run: `npm run lint`
Expected: exactly the 4 pre-existing prettier warnings, 0 errors.

Run: `npm test`
Expected: green. Nothing tested changed. This proves Task 1's shared tests and the rest still pass.

- [ ] **Step 14: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "radio turn: discover's turn button, move chips and t -- the next loop top, last tap wins, undo takes a waiting one back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 6: The phone's turn in the shared remote state (sssketch)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/remoteState.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/shared/remoteState.test.ts`, find:

```ts
  parseRemoteSlotKinds,
  remoteStateFromSlots,
```

Replace with:

```ts
  parseRemoteSlotKinds,
  parseRemoteTurnMove,
  remoteStateFromSlots,
  remoteTurnAnswer,
  type RemoteTurnView,
```

Find (in `'passes the counters and the open/playing flags straight through'`):

```ts
      lastKeptName: 'misty kestrel',
      loopBars: 8,
      radio: null,
      slots: []
    })
```

Replace with:

```ts
      lastKeptName: 'misty kestrel',
      loopBars: 8,
      radio: null,
      turn: null,
      slots: []
    })
```

Append to the end of the file:

```ts

describe('remoteStateFromSlots and the turn', () => {
  const meta = {
    discoverOpen: true,
    playing: true,
    kept: 0,
    rolled: 0,
    lastKeptName: null,
    loopBars: 8
  }
  const turn: RemoteTurnView = {
    waiting: true,
    move: 'wash',
    canTurn: true,
    moves: ['riser', 'wash', 'drum drop']
  }

  it('says nothing about the turn while radio is off', () => {
    expect(remoteStateFromSlots([slot()], meta).turn).toBeNull()
    expect(remoteStateFromSlots([slot()], { ...meta, turn: null }).turn).toBeNull()
  })

  it("carries the turn, its moves in the planner's order", () => {
    expect(remoteStateFromSlots([slot()], { ...meta, turn }).turn).toEqual({
      waiting: true,
      move: 'wash',
      canTurn: true,
      moves: ['drum drop', 'wash', 'riser']
    })
  })

  it('lets only real move names out', () => {
    const odd = {
      ...turn,
      move: '/Users/nickel/x' as unknown as RemoteTurnView['move'],
      moves: ['wash', '../etc' as unknown as RemoteTurnView['moves'][number], 'wash']
    }
    expect(remoteStateFromSlots([slot()], { ...meta, turn: odd }).turn).toEqual({
      waiting: true,
      move: null,
      canTurn: true,
      moves: ['wash']
    })
  })
})

describe('parseRemoteTurnMove', () => {
  it("reads no move as the planner's choice, and a real move as itself", () => {
    expect(parseRemoteTurnMove(undefined)).toEqual({ move: null })
    expect(parseRemoteTurnMove(null)).toEqual({ move: null })
    expect(parseRemoteTurnMove('low drop')).toEqual({ move: 'low drop' })
  })

  it('refuses anything else outright', () => {
    for (const bad of ['drop', 'WASH', '../x', 7, ['wash'], {}]) {
      expect(parseRemoteTurnMove(bad)).toBeNull()
    }
  })
})

describe('remoteTurnAnswer', () => {
  const turn: RemoteTurnView = { waiting: false, move: null, canTurn: true, moves: ['wash'] }

  it('is radio off with no turn in the state', () => {
    expect(remoteTurnAnswer(null, null)).toBe('radio off')
    expect(remoteTurnAnswer(undefined, 'wash')).toBe('radio off')
  })

  it('is turning when the chip, or the planner, can sound now', () => {
    expect(remoteTurnAnswer(turn, 'wash')).toBe('turning')
    expect(remoteTurnAnswer(turn, null)).toBe('turning')
  })

  it('is nothing to turn otherwise', () => {
    expect(remoteTurnAnswer(turn, 'stop')).toBe('nothing to turn')
    expect(remoteTurnAnswer({ ...turn, canTurn: false }, null)).toBe('nothing to turn')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL: `parseRemoteTurnMove is not a function`, `remoteTurnAnswer is not a function`, and the `turn` field missing from `remoteStateFromSlots`'s output.

- [ ] **Step 3: The view, the state field, normalising, the command, the parser and the answer**

In `src/shared/remoteState.ts`, find:

```ts
import { quantiseRemotePeaks } from './remotePeaks'
```

Replace with:

```ts
import { quantiseRemotePeaks } from './remotePeaks'
import { TURNAROUND_MOVES, type TurnaroundMove } from './radioTurnaround'
```

Find:

```ts
export interface RemoteState {
  /** False when Discover is not open on the Mac
```

Replace with:

```ts
/** Radio's turn, as the phone needs it (docs/superpowers/specs/2026-10-02-radio-turn-button-
 * design.md): the `turn` button and its chips. Move names are the planner's own
 * (@shared/radioTurnaround TurnaroundMove) -- no slot, no stem, nothing about the library. */
export interface RemoteTurnView {
  /** A turn is waiting for the loop top (pressed, or rolled and playing into it). */
  waiting: boolean
  /** The chip it holds: a chip's move, or the move rolled for the planner's choice; null before
   * that. */
  move: TurnaroundMove | null
  /** The planner has a move it could turn with now: the `turn` button's answer. */
  canTurn: boolean
  /** The chips that can sound now; the others are dimmed. */
  moves: TurnaroundMove[]
}

export interface RemoteState {
  /** False when Discover is not open on the Mac
```

Find:

```ts
  radio: RemoteRadioView | null
  slots: RemoteSlotView[]
}

/** One row as GET /api/state actually answers it
```

Replace with:

```ts
  radio: RemoteRadioView | null
  /** Radio's turn; null or absent while radio is off (an older Mac never sends it). It is what
   * POST /api/turn answers from (remoteTurnAnswer). */
  turn?: RemoteTurnView | null
  slots: RemoteSlotView[]
}

/** One row as GET /api/state actually answers it
```

Find:

```ts
  radio?: RemoteRadioView | null
}

/** The whole privacy boundary of Part 2
```

Replace with:

```ts
  radio?: RemoteRadioView | null
  /** Radio's turn while radio runs; absent or null while it is off. */
  turn?: RemoteTurnView | null
}

/** The whole privacy boundary of Part 2
```

Find:

```ts
    radio: normalizeRemoteRadio(meta.radio ?? null, slots),
    slots: slots.map
```

Replace with:

```ts
    radio: normalizeRemoteRadio(meta.radio ?? null, slots),
    turn: normalizeRemoteTurn(meta.turn ?? null),
    slots: slots.map
```

Find:

```ts
function normalizeRemoteRadio(
```

Replace with:

```ts
/** Only real move names leave, in the planner's order, once each; anything else is dropped. */
function normalizeRemoteTurn(turn: RemoteTurnView | null): RemoteTurnView | null {
  if (turn === null) return null
  const known = (m: unknown): m is TurnaroundMove => TURNAROUND_MOVES.includes(m as TurnaroundMove)
  return {
    waiting: turn.waiting === true,
    move: known(turn.move) ? turn.move : null,
    canTurn: turn.canTurn === true,
    moves: TURNAROUND_MOVES.filter((m) => turn.moves.includes(m))
  }
}

function normalizeRemoteRadio(
```

Find:

```ts
/** Everything the phone can ask the Mac to do. SIX verbs, and nothing else:
```

Replace with:

```ts
/** Everything the phone can ask the Mac to do. SEVEN verbs, and nothing else:
```

Find:

```ts
  | { kind: 'slot-action'; slotId: string; action: RemoteSlotAction }
```

Replace with:

```ts
  | { kind: 'slot-action'; slotId: string; action: RemoteSlotAction }
  /** Radio's turn at the next loop top: a chip's `move`, absent for the planner's choice
   * (2026-10-02). Forwarded only when remoteTurnAnswer says `turning`. */
  | { kind: 'turn'; move?: TurnaroundMove }
```

Find:

```ts
/** The whole trust boundary for the action sheet, in one pure function --
```

Replace with:

```ts
/** What POST /api/turn's body asked for: `{ move }` with a real move name, or the planner's
 * choice (`move` null) for a body with no move at all. Null for anything else -- an unknown
 * string fails the whole request, as an unknown kind does on /api/add-slot. */
export function parseRemoteTurnMove(value: unknown): { move: TurnaroundMove | null } | null {
  if (value === undefined || value === null) return { move: null }
  const move = TURNAROUND_MOVES.find((m) => m === value)
  return move === undefined ? null : { move }
}

/** The phone's flash for a turn press, and the route's answer: `radio off` with no turn in the
 * state, `nothing to turn` when the chip (or, for the planner's choice, every move) cannot sound
 * now, `turning` otherwise. Answered from the last state the Mac pushed, so it can be a push
 * behind; the Mac rolls the turn itself at the top. */
export type RemoteTurnAnswer = 'turning' | 'nothing to turn' | 'radio off'

export function remoteTurnAnswer(
  turn: RemoteTurnView | null | undefined,
  move: TurnaroundMove | null
): RemoteTurnAnswer {
  if (turn === null || turn === undefined) return 'radio off'
  const can = move === null ? turn.canTurn : turn.moves.includes(move)
  return can ? 'turning' : 'nothing to turn'
}

/** The whole trust boundary for the action sheet, in one pure function --
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd /Users/nickel/Claudecode/sssketch && npx prettier --write src/shared/remoteState.ts src/shared/remoteState.test.ts && npx vitest run src/shared/remoteState.test.ts`
Expected: PASS.

Run: `npm run typecheck && npx eslint src/shared/remoteState.ts src/shared/remoteState.test.ts && npx vitest run src/main/remoteServer.test.ts src/main/remotePage.test.ts`
Expected: clean and green. `turn` is optional, so the server's and main's `RemoteState` literals still typecheck.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "radio turn: the phone's turn state, the turn command, and its answer -- turning, nothing to turn, radio off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 7: `POST /api/turn` (sssketch)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/main/remoteServer.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/main/remoteServer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/main/remoteServer.test.ts`. The file already has `start`, `send`, `commands`, `RawResponse` and `RemoteServerOptions`.

```ts

describe('the turn route', () => {
  async function pairedToken(port: number, pairingCode: string): Promise<string> {
    const res = await send(
      port,
      '/api/pair',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ code: pairingCode })
    )
    return JSON.parse(res.body).token as string
  }
  async function turn(port: number, token: string, body: unknown): Promise<RawResponse> {
    return send(
      port,
      '/api/turn',
      {
        host: `192.168.1.40:${port}`,
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      'POST',
      JSON.stringify(body)
    )
  }
  const radioOn = (): RemoteServerOptions['getState'] => () => ({
    discoverOpen: true,
    playing: true,
    kept: 0,
    rolled: 0,
    lastKeptName: null,
    loopBars: 8,
    radio: null,
    turn: { waiting: false, move: null, canTurn: true, moves: ['wash', 'riser'] },
    slots: [],
    loopId: null
  })

  it('answers turning and forwards a chip, or the planner with no move', async () => {
    const { port, pairingCode } = await start({ getState: radioOn() })
    const token = await pairedToken(port, pairingCode)
    const chip = await turn(port, token, { move: 'wash' })
    expect(chip.status).toBe(200)
    expect(JSON.parse(chip.body)).toEqual({ answer: 'turning' })
    expect((await turn(port, token, {})).status).toBe(200)
    expect(commands).toEqual([{ kind: 'turn', move: 'wash' }, { kind: 'turn' }])
  })

  it('answers nothing to turn for a chip that cannot sound, and forwards nothing', async () => {
    const { port, pairingCode } = await start({ getState: radioOn() })
    const res = await turn(port, await pairedToken(port, pairingCode), { move: 'stop' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ answer: 'nothing to turn' })
    expect(commands).toEqual([])
  })

  it('answers 409 radio off with radio off, and forwards nothing', async () => {
    const { port, pairingCode } = await start()
    const res = await turn(port, await pairedToken(port, pairingCode), { move: 'wash' })
    expect(res.status).toBe(409)
    expect(JSON.parse(res.body)).toEqual({ answer: 'radio off' })
    expect(commands).toEqual([])
  })

  it('refuses a move that is not a move, and forwards nothing', async () => {
    const { port, pairingCode } = await start({ getState: radioOn() })
    const token = await pairedToken(port, pairingCode)
    for (const move of ['drop', '../x', 7]) {
      expect((await turn(port, token, { move })).status).toBe(400)
    }
    expect(commands).toEqual([])
  })

  it('tells an unpaired caller nothing about the route existing', async () => {
    const { port } = await start({ getState: radioOn() })
    const res = await send(
      port,
      '/api/turn',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      '{}'
    )
    expect(res.status).toBe(401)
    expect(commands).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/main/remoteServer.test.ts`
Expected: FAIL in `the turn route`. Every authorised request answers 401 (the unknown-route refusal), and the unpaired test passes.

- [ ] **Step 3: The route**

In `src/main/remoteServer.ts`, find:

```ts
  parseRemoteSlotKinds,
  type RemoteCommand,
```

Replace with:

```ts
  parseRemoteSlotKinds,
  parseRemoteTurnMove,
  remoteTurnAnswer,
  type RemoteCommand,
```

Find:

```ts
 * Nine api routes, plus GET / itself, and no route takes or returns a
 * filesystem path or reads the library. (The count in this comment was
 * already one behind before /api/stem: a596b39's /api/slot-action made
 * seven into eight, and /api/stem makes it nine.)
```

Replace with:

```ts
 * Ten api routes, plus GET / itself, and no route takes or returns a
 * filesystem path or reads the library. (The count in this comment was
 * already one behind before /api/stem: a596b39's /api/slot-action made
 * seven into eight, /api/stem makes it nine, and /api/turn ten.)
```

Find:

```ts
      // The phone's kind picker. Kinds arrive
```

Replace with:

```ts
      // Radio's turn (2026-10-02): `{ move }` for a chip, `{}` for the planner's choice. The
      // answer is the phone's flash, worked out from the last state the Mac pushed
      // (remoteTurnAnswer): 409 `radio off` with radio off, `nothing to turn` when nothing can
      // sound -- neither forwards anything -- and `turning`, forwarded. A move that is not a
      // move is a 400, as an unknown kind is on /api/add-slot.
      if (req.method === 'POST' && url === '/api/turn') {
        const parsed = parseRemoteTurnMove((await readJsonBody(req)).move)
        if (parsed === null) return respond(res, 400)
        const answer = remoteTurnAnswer(options.getState().turn, parsed.move)
        if (answer === 'turning') {
          options.onCommand(
            parsed.move === null ? { kind: 'turn' } : { kind: 'turn', move: parsed.move }
          )
        }
        return respond(res, answer === 'radio off' ? 409 : 200, { answer })
      }

      // The phone's kind picker. Kinds arrive
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd /Users/nickel/Claudecode/sssketch && npx prettier --write src/main/remoteServer.ts src/main/remoteServer.test.ts && npx vitest run src/main/remoteServer.test.ts`
Expected: PASS.

Run: `npm run typecheck && npx eslint src/main/remoteServer.ts src/main/remoteServer.test.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/main/remoteServer.ts src/main/remoteServer.test.ts
git commit -m "radio turn: POST /api/turn -- answered from the last pushed state, forwarded only when turning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 8: The phone's `turn` and chips, and the panel's half of it (sssketch)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/main/remotePage.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/main/remotePage.test.ts`
- Modify: `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Write the failing page tests**

In `src/main/remotePage.test.ts`, find:

```ts
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
```

Replace with:

```ts
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES } from '@shared/radioTurnaround'
```

Find (the end of the runtime label list in `'keeps every button to two words, as asked on 2026-09-26'`):

```ts
      '4 bars',
      '2 bars'
    ]
```

Replace with:

```ts
      '4 bars',
      '2 bars',
      'turn',
      'turning',
      ...TURNAROUND_MOVES.map((m) => TURNAROUND_MOVE_LABEL[m])
    ]
```

Find (in the swap grid's `'keeps the setting on the phone, with no route and no mac involved'`):

```ts
      "api('/api/slot-action'",
      "api('/api/slot-action'"
    ])
```

Replace with:

```ts
      "api('/api/slot-action'",
      "api('/api/slot-action'",
      "api('/api/turn'"
    ])
```

Append to the end of the file:

```ts

describe('remotePage turn', () => {
  it('offers turn and every move as a chip, labelled as the desktop labels them', () => {
    expect(REMOTE_PAGE_HTML).toContain('<button class="big" id="turn">turn</button>')
    for (const move of TURNAROUND_MOVES) {
      expect(REMOTE_PAGE_HTML).toContain(
        JSON.stringify({ m: move, l: TURNAROUND_MOVE_LABEL[move] })
      )
    }
  })

  it('posts to the turn route, with a move only for a chip', () => {
    expect(REMOTE_PAGE_HTML).toContain("api('/api/turn', move === null ? {} : { move: move })")
  })

  it("flashes the mac's own answer", () => {
    expect(REMOTE_PAGE_HTML).toContain('flash(body && body.answer ? body.answer : ')
  })

  it('shows the turn only while radio runs on the mac, and says when one waits', () => {
    expect(REMOTE_PAGE_HTML).toContain('<div class="swapgrid" id="turn-box" hidden>')
    expect(REMOTE_PAGE_HTML).toContain('turnBoxEl.hidden = !turn')
    expect(REMOTE_PAGE_HTML).toContain("turn.waiting ? 'turning' : 'turn'")
    expect(REMOTE_PAGE_HTML).toContain('paintTurn(state.turn)')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/main/remotePage.test.ts`
Expected: FAIL in `remotePage turn`, and in the swap grid's api-call list (no `/api/turn` call yet).

- [ ] **Step 3: The page**

In `src/main/remotePage.ts`, find:

```ts
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
```

Replace with:

```ts
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES } from '@shared/radioTurnaround'
```

Find:

```ts
/** The whole phone remote, as one string.
```

Replace with:

```ts
/** Radio's turn chips (2026-10-02): `m` is the wire value (the planner's TurnaroundMove, which
 * POST /api/turn checks), `l` the chip's label -- the desktop's, from the same table. */
const TURN_CHIPS = TURNAROUND_MOVES.map((move) => ({ m: move, l: TURNAROUND_MOVE_LABEL[move] }))

/** The whole phone remote, as one string.
```

Find (in the page's CSS):

```css
button.chip.on { background: #ededed; border-color: #ededed; color: #050505; }
```

Replace with:

```css
button.chip.on { background: #ededed; border-color: #ededed; color: #050505; }
/* A turn chip that cannot sound right now: still a target, quieter. */
button.chip.dim { border-color: #161616; color: #3a3a3a; }
```

Find (in `#loop`):

```html
      <div class="swapgrid">
        <div class="eyebrow">swap every</div>
```

Replace with:

```html
      <!-- Radio's turn (2026-10-02): a turnaround at the next loop top. Shown
           only while radio runs on the mac (state.turn). The big button lets
           the mac choose; a chip plays its move. -->
      <div class="swapgrid" id="turn-box" hidden>
        <div class="actions">
          <button class="big" id="turn">turn</button>
        </div>
        <div class="chips grid" id="chips-turn"></div>
      </div>
      <div class="swapgrid">
        <div class="eyebrow">swap every</div>
```

Find (in `render`):

```js
    renderRows()
    // A mute or a solo made on the MAC lands on the phone here
```

Replace with:

```js
    renderRows()
    paintTurn(state.turn)
    // A mute or a solo made on the MAC lands on the phone here
```

Find:

```js
  function poll() {
    if (!token) return
```

Replace with:

```js
  // --- radio's turn ------------------------------------------------------
  // One tap, answered in the response: the mac says turning, nothing to
  // turn or radio off, and that is the flash. The button reads turning
  // and the chip of the move it plays is lit while the turn waits for the
  // top -- the state poll says so. A dimmed chip still answers a tap: the
  // mac's own answer says why nothing happened.
  var TURN_CHIPS = ${JSON.stringify(TURN_CHIPS)}
  var turnBoxEl = document.getElementById('turn-box')
  var turnEl = document.getElementById('turn')
  var turnChipsEl = document.getElementById('chips-turn')
  var turnChipEls = []
  function sendTurn(move) {
    buzz()
    api('/api/turn', move === null ? {} : { move: move })
      .then(function (r) { return r.json() })
      .then(function (body) { flash(body && body.answer ? body.answer : 'not turned') })
      .catch(function () { flash('not turned') })
  }
  turnEl.addEventListener('click', function () { sendTurn(null) })
  TURN_CHIPS.forEach(function (option) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = option.l
    chip.addEventListener('click', function () { sendTurn(option.m) })
    turnChipEls.push(chip)
    turnChipsEl.appendChild(chip)
  })
  function paintTurn(turn) {
    turnBoxEl.hidden = !turn
    if (!turn) return
    turnEl.textContent = turn.waiting ? 'turning' : 'turn'
    var can = turn.moves || []
    for (var i = 0; i < TURN_CHIPS.length; i++) {
      var m = TURN_CHIPS[i].m
      turnChipEls[i].className =
        turn.waiting && turn.move === m ? 'chip on' : can.indexOf(m) === -1 ? 'chip dim' : 'chip'
    }
  }

  function poll() {
    if (!token) return
```

(This is inside the `REMOTE_PAGE_HTML` template literal. `${JSON.stringify(TURN_CHIPS)}` is interpolated there, as `KINDS` and `ACTS` already are.)

- [ ] **Step 4: Run the page tests to make sure they pass**

Run: `cd /Users/nickel/Claudecode/sssketch && npx prettier --write src/main/remotePage.ts src/main/remotePage.test.ts && npx vitest run src/main/remotePage.test.ts`
Expected: PASS: every test, the label-length and lowercase checks included.

- [ ] **Step 5: The panel pushes the turn and takes the phone's command**

In `src/renderer/src/components/DiscoverPanel.tsx` (hand-formatted, as in Task 5), find:

```ts
  type RemoteRadioView,
  type RemoteSlotAction
} from '@shared/remoteState'
```

Replace with:

```ts
  type RemoteRadioView,
  type RemoteSlotAction,
  type RemoteTurnView
} from '@shared/remoteState'
```

Find:

```ts
    return { armedSlotId: radioArmedSlotId, heldSlotIds }
  }, [radioArmedSlotId, radioHeldSlotId, manualWaitingKey])
```

Replace with:

```ts
    return { armedSlotId: radioArmedSlotId, heldSlotIds }
  }, [radioArmedSlotId, radioHeldSlotId, manualWaitingKey])
  // Radio's turn as the phone sees it (@shared/remoteState RemoteTurnView): what the desktop's
  // turn button and chips show, and what POST /api/turn answers from. Null with radio off.
  const radioTurnRemote = useMemo<RemoteTurnView | null>(
    () =>
      radioOn
        ? {
            waiting: radioTurnShown !== null,
            move: radioTurnShown?.move ?? null,
            canTurn: radioTurnCan?.canTurn ?? false,
            moves: radioTurnCan?.moves ?? []
          }
        : null,
    [radioOn, radioTurnShown, radioTurnCan]
  )
```

Find:

```ts
          loopBars,
          radio: radioRemote
        },
        peaksBySlotId
      )
    )
  }, [
    buildSlotSnapshots,
    playing,
    keptCount,
    rolledCount,
    lastKeptName,
    remotePeaksTick,
    radioRemote
  ])
```

Replace with:

```ts
          loopBars,
          radio: radioRemote,
          turn: radioTurnRemote
        },
        peaksBySlotId
      )
    )
  }, [
    buildSlotSnapshots,
    playing,
    keptCount,
    rolledCount,
    lastKeptName,
    remotePeaksTick,
    radioRemote,
    radioTurnRemote
  ])
```

Find:

```ts
      else if (command.kind === 'slot-action') runSlotAction(command.slotId, command.action)
    }
```

Replace with:

```ts
      else if (command.kind === 'slot-action') runSlotAction(command.slotId, command.action)
      // The desktop's own turn (turnRadio): the server forwards only a turn it answered
      // `turning` to.
      else if (command.kind === 'turn') turnRadioRef.current(command.move)
    }
```

(`turnRadioRef`, not `turnRadio`. See spec point 13.)

- [ ] **Step 6: Verify**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx src/main/remotePage.ts src/main/remotePage.test.ts`
Expected: clean, with no output from eslint.

Run: `npm run lint`
Expected: exactly the 4 pre-existing prettier warnings, 0 errors.

Run: `npm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/main/remotePage.ts src/main/remotePage.test.ts src/renderer/src/components/DiscoverPanel.tsx
git commit -m "radio turn: the phone's turn and move chips, and discover pushes the turn and takes the phone's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

## Task 9: Full verification, and Elling's walkthrough

**Files:** none (no commit).

- [ ] **Step 1: sssketch, all of it**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npm run lint && npm test`
Expected:
- typecheck is clean;
- lint shows exactly 4 prettier warnings and 0 errors;
- every test passes.

If `remoteLoopRenderer.test.ts` or `remoteStemRenderer.test.ts` fail, check that `native-engine/build` holds a built engine. They spawn it. If `engineProcess` tests time out, read the `coreaudiod thread leak` memory before blaming this change.

- [ ] **Step 2: ell.ing/radio, all of it**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test && npm run build`
Expected: clean, green, built.

- [ ] **Step 3: `git log` in both repos**

Run: `git -C /Users/nickel/Claudecode/sssketch log --oneline -6 && git -C /Users/nickel/Claudecode/ell.ing/radio log --oneline -4`
Expected:
- sssketch: Tasks 1, 5, 6, 7 and 8, in that order, among any other session's commits;
- radio: Tasks 2, 3 and 4.

Every message ends with the two attribution lines.

- [ ] **Step 4: Report, and hand Elling the walkthrough**

Tell Elling plainly: no agent can hear either radio, see the UI, press `t` or hold the phone. What was verified is typecheck, lint, unit tests and the radio's build. Then give him this walkthrough. It is the spec's list, made concrete.

For sssketch, rebuild nothing native. This is renderer and main only, so `npm run dev` is enough. A running app needs a full quit (Cmd+Q) for main's route.

1. **`turn` lands on the next top.**
   - Start radio.
   - Press `turn` mid-lap. It reads `turning` and lights.
   - A move plays into the next loop top and ends exactly on the one.
   - The button goes back to `turn` at that top.
2. **Each chip plays its move, and the dimmed ones make sense.**
   - Press each of `drop`, `low drop`, `stop`, `wash`, `lift`, `dip` and `riser` in turn. Each plays that move, whatever the menu's `moves` say.
   - Mute rows until only drums and bass are left. `stop` dims (no melodic row to keep), and its tooltip reads `not now`. Pressed anyway, the button flashes `nothing to turn`.
   - With turnarounds `off` in the menu, turns still work.
3. **A late press.**
   - Press a chip about a beat and a half before the top. The move is short (about 1 beat) and still ends on the one.
   - Press in the last beat. It lands on the top after, at full length.
4. **Undo withdraws a waiting turn.**
   - Press a chip early in a lap, then Discover's undo button. The button goes back to `turn`, nothing plays at the top, and the slots did not change.
   - Press undo again. That is the ordinary slot undo.
5. **The phone's `turn` works.**
   - On the phone remote, with radio on, the `turn` button and chips show above `swap every`. With radio off they are gone.
   - A tap flashes `turning`, and the Mac plays it at the top.
   - A dimmed chip flashes `nothing to turn`.
6. **`t` works.**
   - With radio on, `t` turns.
   - It does nothing while typing in a text field.
   - Cmd-T is untouched.
7. **ell.ing/radio full mode** (`npm run dev` in the radio repo):
   - `turn` and the chips sit after the turnaround toggles;
   - they behave as 1–3 above;
   - `hold` takes back a waiting turn;
   - simple mode shows nothing new.
8. **With phrase ends.** With turnarounds `often`, press a chip in a phrase's last lap. That top plays the chip's move, not a phrase-end draw, and the next phrase end behaves normally.

Note for him: the dimming (sssketch) updates on the position tick, so it is fresh while playing and holds the last answer while paused.
