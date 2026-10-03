# Radio Turnaround Combos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phrase turnaround is usually two or three moves layered, and a riser usually stops short of the one, leaving a gap the room rings through, in sssketch's Discover radio and in ell.ing/radio.

**Spec:** `docs/superpowers/specs/2026-10-03-radio-turnaround-combos-design.md`. Read it first. Its affinity table (§1), the gap rules (§3), the randomness rules (§7) and the timing risks (§9) are the review checklist.

**Architecture:**
- **Shared planner.** `rollTurnaround` gains `combine`. With it on:
  - the lead is drawn exactly as today;
  - one more draw seeds a private stream, which layers compatible moves (`TURNAROUND_AFFINITY`, `TURNAROUND_LAYER_ODDS`) and decides the riser's gap and keeper;
  - the parts merge into one curve set per row.
- **Off** is today, draw for draw.
- **The runtimes** pass `combine: true`, end the riser `gapBeats` early, and name the combination on the ruler and in the flashes.
- **The web** also de-clicks the return on the one.
- **No engine change.**

**Tech Stack:** TypeScript and vitest. sssketch is React and Electron; ell.ing/radio is plain DOM with Web Audio.

**Repos:**
- **sssketch** (`/Users/nickel/Claudecode/sssketch`): Tasks 1, 2, 5 and 6.
- **ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`): Tasks 3 and 4.
- **The diffs** were made against sssketch `7015ae3` and ell.ing/radio `f34961c`, the pace slider's phase 1 plus its review fixes.
  - Both repos have moved on since: the pace slider's Tasks 5-9 are being built now.
  - If a hunk does not apply, make the same edit by hand, anchored on the quoted context, never on line numbers.
- **How the two connect.** The web imports sssketch's `src/shared` through `@shared`, from sssketch's **working tree**. A web task needs its shared tasks present there first.

**Branches:** work on `radio-turnaround-combos` in each repo (`git switch -c radio-turnaround-combos`), branched from wherever the pace slider work has landed. Or work on the same branch as the pace slider if the controller prefers one line of history. Either way, commit only this task's files (`git add <paths>`), never `git add -A`: other agents share the trees.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

**Before you start, in both repos:**
- Run `git status --short`. Expect only your own and the pace slider's in-flight work; touch nothing that isn't in your task.
- **sssketch:** `npx vitest run src/shared` should be green.
- **ell.ing/radio:** `npx vitest run src` and `npm run typecheck` should be green.

---

## How this plan's code was checked

Every diff below was applied, in task order, to fresh copies of both repos in the planning scratchpad (`.../scratchpad/turnaround-combos/verify`). Each step was then checked:

- **After Task 1 alone:**
  - sssketch `npx vitest run src/shared` gave 2496 passed, and `npm run typecheck` gave 0 errors;
  - ell.ing/radio `npm run typecheck` gave 0 errors and `npx vitest run src` gave 686 passed, unchanged. With `combine` absent the runtimes are untouched.
- **After Task 2:** 2499 passed, typecheck 0.
- **After Task 3:** web 687 passed, typecheck 0.
- **After Task 4:** web 688 passed, typecheck 0 (`noUnusedLocals` included).
- **After Task 5:**
  - sssketch `npm run typecheck` gave 0 errors;
  - `npx eslint` on every touched sssketch file gave 0 errors and 0 warnings (after `--fix`). The 4 known prettier warnings are elsewhere.
- **Not run in the copy:**
  - the full sssketch `npm test`: the copy has no native engine;
  - the web's `src/fluoddity.test.ts` and `scripts/`, which need neighbouring trees. Both were linked and green in the planning run.
- **Red before green:** Tasks 1 and 2's new test files fail to compile against the base, because their exports are missing. Task 3's two changed tests fail against the base turnaround.ts (a step on the one, the riser ending on the wrap).
- **Statistics** quoted in the spec (§2) came from a throwaway sim over the Task 1 planner: 20,000 rolls per arc and depth, mulberry32 seed 3.

## Decisions made in planning (the spec's flags are the ones for Elling)

1. **`combine` is an input, absent meaning today.** This keeps:
   - every existing shared test, which scripts exact draws with a throwing `seq`;
   - auto-arrange's future contract (turnarounds §7).

   Both radios pass `combine: true`; there is no setting (spec flag 4).
2. **One extra draw seeds a private stream** (`turnaroundLayerRandom`), so the caller's stream moves by exactly one number per fired fresh roll or turn, whatever the combination. A diminution, or a roll that doesn't fire, draws nothing more.
3. **Plans stay one entry per row.** `materialize` merges the parts:
   - a row's volume is its longest drop, since drops all share one shape;
   - filter and send can't collide, by the affinity 0s.

   So neither runtime needs a curve combiner of its own.
4. **New fields are optional and set only with `combine`:** `parts`, `gapBeats`, `keeperId`, and `TurnaroundMemory.parts`. So `toEqual`s on plans in existing tests still hold. A single move's diminution in combine mode is today's plan, with no `parts`; consumers read `turnaroundPlanMoves(plan)`, never `plan.parts` directly.
5. **The readout's new input fields are optional** (`armedTurnaround.parts`, `.gap`). Its new tests are a **new file** (`radioReadoutTurnaround.test.ts`), not `radioReadout.test.ts`, which the pace slider's Task 7 edits.
6. **The web's de-clicked return applies to every turnaround drop**, old ones included: one rule, the swap's own `ANTI_CLICK_SEC`. The desktop needs nothing; the engine's smoother already de-clicks (spec §5).

## File map

**sssketch**
- Modify `src/shared/radioTurnaround.ts` and `src/shared/radioTransition.ts`; create `src/shared/radioTurnaroundCombos.test.ts` (Task 1).
- Modify `src/shared/radioReadout.ts`; create `src/shared/radioReadoutTurnaround.test.ts` (Task 2).
- Modify `src/renderer/src/components/DiscoverPanel.tsx` (Task 5).

**ell.ing/radio**
- Modify `src/audio/turnaround.ts` and `src/audio/turnaround.test.ts` (Task 3).
- Modify `src/radio/step.ts`, `src/radio/controller.ts` and `src/radio/step.test.ts` (Task 4).

## Task graph, and the pace slider

```
T1 shared planner (sssketch) ─┬─> T2 shared readout (sssketch) ─┬─> T4 web reducer + controller ──┐
                              ├─> T3 web audio (radio) ─────────┘                                 ├─> T6 verify + handoff
                              └──────────────────────────────────> T5 desktop panel (needs T2) ───┘
```

- **Strictly in order:** T1 before everything; T2 before T4 and T5; T3 before T4 (T4's tests read gapped plans that T3 plays).
- **In parallel:** T2 and T3 (different repos), then T4 and T5.

**Overlap with the pace slider** (`docs/superpowers/plans/2026-10-03-radio-pace-slider.md`, Tasks 5-9, being built now):

| this plan | files | pace slider tasks on the same files | sequencing |
|---|---|---|---|
| T1 | `radioTurnaround.ts`, `radioTransition.ts`, new test | none | can run now, alongside any pace task |
| T2 | `radioReadout.ts` (`rulerEnd`, `armedTurnaround`'s type), new test | Task 7 (`radioReadout.ts`: `nextChange.with`; and `radioReadout.test.ts`) | after pace Task 7 is committed, or strictly before it; never at the same time |
| T3 | web `src/audio/turnaround.ts`, `turnaround.test.ts` | none | can run now (after T1) |
| T4 | web `step.ts` (`turnaroundInputOf`, `readoutView`), `controller.ts` (the turnaround flash), `step.test.ts` | Tasks 5 and 8 (`step.ts`, `controller.ts`, `step.test.ts`; Task 8 also edits `readoutView`) | after pace Task 8 is committed |
| T5 | `DiscoverPanel.tsx` (four small hunks) | Tasks 6 and 9 (`DiscoverPanel.tsx`) | after pace Task 9 is committed |

**Recommended:**
- Run T1 and T3 now.
- Run T2 once pace Task 7 lands.
- Run T4 and T5 after pace Tasks 8 and 9 respectively.

**Why T4 after pace Task 8:**
- T4 turns `combine` on in the web reducer.
- That adds one draw to the seeded test stream after every fired turnaround (spec §7), so a seeded test pace Task 8 adds could change outcome.
- Run the whole `step.test.ts` after T4. Fix any such test by its intent, never by hunting a seed that happens to pass, and say so in the commit.

**Ship point:** after T4 and T5. Elling listens, and deploys only with his go-ahead. T1-T3 alone change nothing audible except the web's 3 ms return (T3).

---

### Task 1: The shared planner: layered moves, the gap, labels and flashes (`radioTurnaround.ts`)

**Files (sssketch):**
- Create: `src/shared/radioTurnaroundCombos.test.ts`
- Modify: `src/shared/radioTurnaround.ts`
- Modify: `src/shared/radioTransition.ts` (`buildTransitionRiser`'s `endBeforeBars`)

**Depends on:** nothing. **Overlap with the pace slider:** none, so it can run now.

**Timing risk:** none at runtime. `combine` is absent everywhere until Tasks 4 and 5, and every existing test must pass untouched, which proves "off is today, draw for draw". The one ordering rule: the private stream's seed draw comes **after** every draw of today's roll (spec §7), and the first test pins it.

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioTurnaroundCombos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  TURNAROUND_AFFINITY,
  TURNAROUND_MOVES,
  TURNAROUND_WEIGHTS,
  rememberTurnaround,
  rollTurnaround,
  turnaroundFitsLoop,
  turnaroundFlashes,
  turnaroundGapBeats,
  turnaroundLabel,
  turnaroundPlanMoves,
  type TurnaroundInput,
  type TurnaroundPlan,
  type TurnaroundPoint,
  type TurnaroundRow
} from './radioTurnaround'
import { buildTransitionRiser } from './radioTransition'

/** mulberry32 -- the same long run every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random that counts its draws. */
function counted(random: () => number): { random: () => number; n: () => number } {
  let n = 0
  return {
    random: () => {
      n++
      return random()
    },
    n: () => n
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
    random: mulberry32(1),
    loopBars: 8,
    lastPhrase: null,
    rows: BED,
    arc: 'steady',
    leavingRowId: null,
    combine: true,
    ...over
  }
}

/** Many combined plans from one long seeded run. */
function many(over: Partial<TurnaroundInput> = {}, n = 3000, seed = 11): TurnaroundPlan[] {
  const random = mulberry32(seed)
  const out: TurnaroundPlan[] = []
  for (let i = 0; i < n; i++) {
    const plan = rollTurnaround(input({ random, ...over }))
    if (plan !== null) out.push(plan)
  }
  return out
}

const valueAt = (points: readonly TurnaroundPoint[], beats: number): number => {
  // points are in time order: beats before the wrap DEcreasing; linear between, the later value
  // at a step
  let v = points[0].value
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.beats > beats) {
      v = p.value
      continue
    }
    const a = points[i - 1]
    if (a === undefined || p.beats === beats) return p.value
    return a.value + (p.value - a.value) * ((a.beats - beats) / (a.beats - p.beats))
  }
  return v
}

describe('combine off is today, draw for draw; on costs one draw per fired roll', () => {
  it('the lead is the same move, length and row as the single-move roll, and one more draw', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const off = counted(mulberry32(seed))
      const on = counted(mulberry32(seed))
      const single = rollTurnaround(input({ random: off.random, combine: undefined }))
      const combined = rollTurnaround(input({ random: on.random }))
      if (single === null) {
        expect(combined).toBeNull()
        expect(on.n()).toBe(off.n())
        continue
      }
      expect(combined?.move).toBe(single.move)
      expect(combined?.parts?.[0]).toEqual({
        move: single.move,
        beats: combined!.parts![0].beats,
        rowIds: single.rows.map((r) => r.rowId)
      })
      expect(on.n()).toBe(off.n() + 1)
    }
  })

  it('a single-move plan with combine off has no parts, gap or keeper', () => {
    for (const plan of many({ combine: undefined }, 300)) {
      expect(plan.parts).toBeUndefined()
      expect(plan.gapBeats).toBeUndefined()
      expect(plan.keeperId).toBeUndefined()
    }
  })

  it('is the same plan for the same seed', () => {
    expect(many({}, 200, 5)).toEqual(many({}, 200, 5))
  })
})

describe('what may layer', () => {
  it('never two moves that fight over a parameter or contain one another; at most three', () => {
    for (const arc of ['growing', 'thinning', 'steady'] as const) {
      for (const plan of many({ arc })) {
        const moves = turnaroundPlanMoves(plan)
        expect(moves.length).toBeLessThanOrEqual(3)
        expect(new Set(moves).size).toBe(moves.length)
        for (const a of moves)
          for (const b of moves) if (a !== b) expect(TURNAROUND_AFFINITY[a][b]).toBeGreaterThan(0)
        // and so no row is filtered twice, and only one wash
        expect(moves.filter((m) => m === 'lift' || m === 'dip').length).toBeLessThanOrEqual(1)
        // every move is one the arc weights
        for (const m of moves) expect(TURNAROUND_WEIGHTS[arc][m]).toBeGreaterThan(0)
      }
    }
  })

  it('the affinity table is symmetric and never pairs a move with itself', () => {
    for (const a of TURNAROUND_MOVES) {
      expect(TURNAROUND_AFFINITY[a][a]).toBe(0)
      for (const b of TURNAROUND_MOVES)
        expect(TURNAROUND_AFFINITY[a][b]).toBe(TURNAROUND_AFFINITY[b][a])
    }
  })

  it('a thinning arc layers only wash and dip', () => {
    for (const plan of many({ arc: 'thinning' })) {
      for (const m of turnaroundPlanMoves(plan)) expect(['wash', 'dip']).toContain(m)
    }
  })

  it('subtle is mostly one move and never three; bold mostly two or three', () => {
    const counts = (depth: 'subtle' | 'bold'): number[] => {
      const c = [0, 0, 0, 0]
      for (const plan of many({ depth, arc: 'growing' })) c[turnaroundPlanMoves(plan).length]++
      return c
    }
    const subtle = counts('subtle')
    const bold = counts('bold')
    const total = (c: number[]): number => c[1] + c[2] + c[3]
    expect(subtle[3]).toBe(0)
    expect(subtle[1] / total(subtle)).toBeGreaterThan(0.6)
    expect((bold[2] + bold[3]) / total(bold)).toBeGreaterThan(0.6)
    expect(bold[3]).toBeGreaterThan(0)
  })

  it('an added move keeps to the families switched on; a chip lead ignores them', () => {
    for (const plan of many({ moves: ['filters', 'riser'] })) {
      for (const m of turnaroundPlanMoves(plan)) expect(['lift', 'dip', 'riser']).toContain(m)
    }
    for (const plan of many({ moves: ['filters'], force: { move: 'wash' } }, 300)) {
      expect(plan.move).toBe('wash')
      for (const m of turnaroundPlanMoves(plan).slice(1)) expect(['lift', 'dip']).toContain(m)
    }
  })

  it("a turn's late clamp holds every part", () => {
    for (const plan of many({ force: { maxBeats: 3 } }, 500)) {
      for (const p of plan.parts!) expect(p.beats).toBeLessThanOrEqual(3)
      expect(plan.gapBeats).toBe(0) // a riser under a bar never leaves a gap
    }
  })
})

describe('the gap after a riser', () => {
  const risers = (over: Partial<TurnaroundInput> = {}): TurnaroundPlan[] =>
    many({ force: { move: 'riser' }, ...over }, 2000)

  it('about three risers in four leave one', () => {
    const plans = risers()
    const gapped = plans.filter((p) => (p.gapBeats ?? 0) > 0).length
    expect(gapped / plans.length).toBeGreaterThan(0.68)
    expect(gapped / plans.length).toBeLessThan(0.8)
  })

  it('is a beat at subtle and under a 2-bar riser, half a bar at bold from 2 bars', () => {
    expect(turnaroundGapBeats(3, 'bold')).toBe(0)
    expect(turnaroundGapBeats(4, 'bold')).toBe(1)
    expect(turnaroundGapBeats(8, 'bold')).toBe(2)
    expect(turnaroundGapBeats(16, 'bold')).toBe(2)
    expect(turnaroundGapBeats(4, 'subtle')).toBe(1)
    expect(turnaroundGapBeats(8, 'subtle')).toBe(1)
    for (const plan of risers({ depth: 'subtle' })) expect([0, 1]).toContain(plan.gapBeats)
  })

  it('the riser stops where the gap starts; its span is the plan', () => {
    for (const plan of risers()) {
      const riser = plan.parts!.find((p) => p.move === 'riser')!
      expect(plan.riserBars).toBe((riser.beats - plan.gapBeats!) / 4)
    }
  })

  it('every audible row but the keeper is silent through the gap and back in full on the one', () => {
    let kept = 0
    for (const plan of risers()) {
      const gap = plan.gapBeats!
      if (gap === 0) continue
      const silent = new Set(plan.rows.filter((r) => r.volume).map((r) => r.rowId))
      for (const r of BED) expect(silent.has(r.id)).toBe(r.id !== plan.keeperId)
      for (const r of plan.rows) {
        if (!r.volume) continue
        // the drop's 0.02-bar ramp (0.08 beats) starts where the gap starts
        const dropped = plan.parts!.some(
          (p) => p.move !== 'riser' && p.rowIds.includes(r.rowId) && p.beats > gap
        )
        if (!dropped) expect(valueAt(r.volume, gap + 0.001)).toBe(1)
        expect(valueAt(r.volume, gap - 0.08)).toBe(0)
        expect(r.volume[r.volume.length - 1]).toEqual({ beats: 0, value: 1 })
      }
      if (plan.keeperId !== undefined) {
        kept++
        expect(['l', 'w']).toContain(plan.keeperId)
      }
    }
    expect(kept).toBeGreaterThan(0)
  })

  it('a drop layered with a gapped riser is heard before the gap', () => {
    let seen = 0
    for (const plan of many({ arc: 'growing' })) {
      const gap = plan.gapBeats ?? 0
      if (gap === 0) continue
      for (const p of plan.parts!) {
        if (p.move === 'drum drop' || p.move === 'low drop') {
          seen++
          expect(p.beats).toBeGreaterThan(gap)
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('a lift, dip or wash peaks where the gap starts and holds through it', () => {
    let seen = 0
    for (const plan of many({ arc: 'steady', force: { move: 'riser' } })) {
      const gap = plan.gapBeats ?? 0
      if (gap === 0) continue
      for (const r of plan.rows) {
        const pts = r.filter?.cutoff ?? r.reverbSend?.points
        if (!pts) continue
        seen++
        const peak = pts[pts.length - 2].value
        expect(pts.find((p) => p.beats === gap)?.value).toBe(peak)
        expect(pts[pts.length - 1].beats).toBe(0)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('needs two audible rows: one row alone keeps the riser to the one', () => {
    for (const plan of many({ rows: [row('l', ['lead'])], force: { move: 'riser' } }, 300)) {
      expect(plan.gapBeats).toBe(0)
    }
  })
})

describe('every combined plan', () => {
  it('fits its loop, ends every curve on the one at rest, and is as long as its longest part', () => {
    for (const loopBars of [2, 4, 8, 16]) {
      for (const depth of ['subtle', 'bold'] as const) {
        for (const plan of many({ loopBars, depth }, 800)) {
          expect(turnaroundFitsLoop(plan, loopBars)).toBe(true)
          expect(plan.beats).toBe(Math.max(...plan.parts!.map((p) => p.beats)))
          for (const r of plan.rows) {
            const lasts = [r.volume, r.filter?.cutoff, r.reverbSend?.points]
              .filter((x): x is TurnaroundPoint[] => x !== undefined)
              .map((x) => x[x.length - 1])
            for (const last of lasts) expect(last.beats).toBe(0)
            if (r.volume) expect(r.volume[r.volume.length - 1].value).toBe(1)
          }
          // one entry per row
          expect(new Set(plan.rows.map((r) => r.rowId)).size).toBe(plan.rows.length)
        }
      }
    }
  })
})

describe('diminution of a combined phrase end', () => {
  it('repeats the parts that can diminish, together, at half their lengths', () => {
    const plan = rollTurnaround(
      input({
        arc: 'growing',
        lastPhrase: {
          move: 'riser',
          beats: 8,
          halvings: 0,
          parts: [
            { move: 'riser', beats: 8 },
            { move: 'lift', beats: 8 },
            { move: 'low drop', beats: 4 }
          ]
        }
      })
    )
    expect(plan).toMatchObject({ move: 'lift', beats: 4, halvings: 1, gapBeats: 0 })
    expect(plan?.parts?.map((p) => [p.move, p.beats])).toEqual([
      ['lift', 4],
      ['low drop', 2]
    ])
  })

  it('a combined phrase end with nothing to diminish skips the next, spending no draw', () => {
    const plan = rollTurnaround(
      input({
        random: () => {
          throw new Error('drew')
        },
        lastPhrase: {
          move: 'wash',
          beats: 4,
          halvings: 0,
          parts: [
            { move: 'wash', beats: 4 },
            { move: 'dip', beats: 4 }
          ]
        }
      })
    )
    expect(plan).toBeNull()
  })

  it('remembers the parts of a combined plan, and not of a single one', () => {
    const plans = many({ arc: 'growing' }, 400)
    const combined = plans.find((p) => p.parts!.length > 1)!
    expect(rememberTurnaround(combined)?.parts?.map((p) => p.move)).toEqual(
      combined.parts!.map((p) => p.move)
    )
    const single = plans.find((p) => p.parts!.length === 1)!
    expect(rememberTurnaround(single)).toEqual({
      move: single.move,
      beats: single.beats,
      halvings: 0
    })
  })
})

describe('saying it', () => {
  it('names the moves, the lead first, and the gap', () => {
    expect(turnaroundLabel(['riser', 'lift'], true)).toBe('riser + lift → gap')
    expect(turnaroundLabel(['wash', 'dip'], false)).toBe('wash + dip')
    expect(turnaroundLabel(['drum drop'], false)).toBe('drop')
    expect(turnaroundLabel(['riser'], true)).toBe('riser → gap')
    expect(turnaroundLabel(['riser', 'low drop', 'lift'], true)).toBe('riser +2 → gap')
  })

  it('flashes each row its moves from where each starts, and gap on the rows that drop out', () => {
    const plan: TurnaroundPlan = {
      move: 'riser',
      beats: 8,
      halvings: 0,
      rows: [
        { rowId: 'd', volume: [] },
        { rowId: 'b', volume: [] },
        { rowId: 'l', filter: { mode: 'highpass', cutoff: [] } },
        { rowId: 'w', volume: [], filter: { mode: 'highpass', cutoff: [] } }
      ],
      riserBars: 1.5,
      parts: [
        { move: 'riser', beats: 8, rowIds: [] },
        { move: 'lift', beats: 4, rowIds: ['l', 'w'] }
      ],
      gapBeats: 2,
      keeperId: 'l'
    }
    expect(turnaroundFlashes(plan)).toEqual([
      { rowId: 'l', word: 'lift', beats: 4 },
      { rowId: 'w', word: 'lift', beats: 4 },
      { rowId: 'd', word: 'gap', beats: 2 },
      { rowId: 'b', word: 'gap', beats: 2 },
      { rowId: 'w', word: 'gap', beats: 2 }
    ])
  })

  it('a plan with no parts flashes as before', () => {
    expect(
      turnaroundFlashes({
        move: 'low drop',
        beats: 4,
        halvings: 0,
        rows: [{ rowId: 'd' }, { rowId: 'b' }]
      })
    ).toEqual([
      { rowId: 'd', word: 'low drop', beats: 4 },
      { rowId: 'b', word: 'low drop', beats: 4 }
    ])
  })
})

describe('buildTransitionRiser: a riser ending before the top', () => {
  it('ends endBeforeBars before the top, the whole within half the loop; 0 is today', () => {
    expect(buildTransitionRiser('c', 8, 2, { endBeforeBars: 0.5 })).toMatchObject({
      startBar: 5.5,
      lengthBars: 2
    })
    // riser and gap clamped together to half the loop
    expect(buildTransitionRiser('c', 4, 2, { endBeforeBars: 0.5 })).toMatchObject({
      startBar: 2,
      lengthBars: 1.5
    })
    expect(buildTransitionRiser('c', 8, 2, { endBeforeBars: 0 })).toEqual(
      buildTransitionRiser('c', 8, 2)
    )
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/shared/radioTurnaroundCombos.test.ts`
Expected: FAIL. The imports `TURNAROUND_AFFINITY`, `turnaroundFlashes`, `turnaroundGapBeats`, `turnaroundLabel` and `turnaroundPlanMoves` don't exist, and `combine` and `endBeforeBars` are unknown options.

- [ ] **Step 3: `buildTransitionRiser` can end before the top.** Apply to `src/shared/radioTransition.ts`:

```diff
diff --git a/src/shared/radioTransition.ts b/src/shared/radioTransition.ts
index 09956a0..35f377b 100644
--- a/src/shared/radioTransition.ts
+++ b/src/shared/radioTransition.ts
@@ -319,10 +319,20 @@ export function buildTransitionRiser(
      * each arming draws afresh. Without one (or with variety off) the id is today's,
      * `radio-riser-${channelId}`, so variety off stays wire-identical to before. */
     armId?: string
+    /** Bars before the loop top the riser ENDS (a turnaround's gap, spec
+     * 2026-10-03-radio-turnaround-combos-design): it sounds over the `bars` before that, and the
+     * whole of it -- riser and gap -- stays within the half loop. 0 or absent: it ends on the
+     * top, today's riser exactly. */
+    endBeforeBars?: number
   } = {}
 ): RiserClip | null {
   if (!(loopBars > 0) || !(bars > 0)) return null
-  const lengthBars = clampToHalfLoop(loopBars, bars)
+  const endBefore =
+    options.endBeforeBars !== undefined && options.endBeforeBars > 0
+      ? Math.min(options.endBeforeBars, loopBars / 2)
+      : 0
+  const lengthBars = clampToHalfLoop(loopBars, bars + endBefore) - endBefore
+  if (!(lengthBars > 0)) return null
   const variety = options.variety === true
   const armed = variety && typeof options.armId === 'string' && options.armId !== ''
   if (variety && !armed && !warnedUnarmedRiser) {
@@ -338,7 +348,7 @@ export function buildTransitionRiser(
   const riser: RiserClip = {
     id: armed ? `radio-riser-${options.armId}` : `radio-riser-${channelId}`,
     channelId,
-    startBar: loopBars - lengthBars,
+    startBar: loopBars - endBefore - lengthBars,
     lengthBars,
     startCutoffValue: 0.2,
     endCutoffValue: 0.95,
```

- [ ] **Step 4: The planner.** Apply to `src/shared/radioTurnaround.ts`. The import, the types, the two lead hand-offs in `rollTurnaround` and `rollForced`, `rememberTurnaround`, and a new section at the end of the file:

```diff
diff --git a/src/shared/radioTurnaround.ts b/src/shared/radioTurnaround.ts
index a8d038d..ec02fcd 100644
--- a/src/shared/radioTurnaround.ts
+++ b/src/shared/radioTurnaround.ts
@@ -18,6 +18,7 @@
 import type { DiscoverSlotKind } from './discoverSlotKind'
 import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'
 import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'
+import { seededRandom } from './seededRandom'
 import {
   evaluateAutomation,
   type AutomationParam,
@@ -261,15 +262,32 @@ export interface TurnaroundRowCurves {
   reverbSend?: TurnaroundWash
 }
 
+/** One move of a combined turnaround (spec 2026-10-03-radio-turnaround-combos-design): its
+ * length in beats before the wrap and the rows it acts on ([] for the riser, its own voice). */
+export interface TurnaroundPart {
+  move: TurnaroundMove
+  beats: number
+  rowIds: string[]
+}
+
 export interface TurnaroundPlan {
+  /** The LEAD move: the one drawn first (a phrase end's draw, or a turn's chip). */
   move: TurnaroundMove
-  /** The move's length in beats, ending on the wrap. */
+  /** The whole turnaround's length in beats, ending on the wrap: its longest part. */
   beats: number
   /** 0 for a fresh move; 1 or 2 for a diminution (the same move at half the length). */
   halvings: number
+  /** Every row's curves, merged across the parts and the gap: one entry per row. */
   rows: TurnaroundRowCurves[]
-  /** The riser's length in bars (its own voice; `rows` is empty). */
+  /** The riser's SOUNDING length in bars (its own voice). With a gap it ends `gapBeats` before
+   * the wrap. */
   riserBars?: number
+  /** Combined plans only (TurnaroundInput.combine): every move, the lead first. */
+  parts?: TurnaroundPart[]
+  /** Combined plans only: the silence before the one after a riser, in beats (0 for none). */
+  gapBeats?: number
+  /** The melodic row that keeps playing through the gap, when one does. */
+  keeperId?: string
 }
 
 /** What a phrase end fired, kept for the next one: never twice in a row, except diminution. */
@@ -277,6 +295,9 @@ export interface TurnaroundMemory {
   move: TurnaroundMove
   beats: number
   halvings: number
+  /** A combined turnaround's moves (two or more), the lead first: diminution repeats the ones
+   * that can diminish, together. Absent for a single move. */
+  parts?: { move: TurnaroundMove; beats: number }[]
 }
 
 export interface TurnaroundInput {
@@ -297,6 +318,11 @@ export interface TurnaroundInput {
   depth?: TurnaroundDepth
   /** A TURN, not a phrase end (TurnaroundForce): it always fires when a move can sound. */
   force?: TurnaroundForce
+  /** Layer compatible moves onto the lead and put a gap after a riser (spec
+   * 2026-10-03-radio-turnaround-combos-design). Absent: one move, exactly as before, draw for
+   * draw. On, a fired fresh roll draws ONE more number after all of today's, which seeds every
+   * layering choice (turnaroundLayerRandom); a roll that does not fire draws nothing more. */
+  combine?: boolean
 }
 
 /** A turn: a turnaround on demand, at the next loop top
@@ -590,6 +616,9 @@ export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
   if (!(chance > 0) || !(capBeats > 0) || moves.length === 0) return null
   const bed = bedOf(input.rows, input.leavingRowId)
   if (lastPhrase !== null) {
+    if (lastPhrase.parts !== undefined && lastPhrase.parts.length > 1) {
+      return diminishParts(input, lastPhrase, bed, capBeats, chance, looks)
+    }
     const { move } = lastPhrase
     if (!DIMINISHING.includes(move) || lastPhrase.halvings >= TURNAROUND_MAX_HALVINGS) return null
     if (!moves.includes(TURNAROUND_FAMILY_OF[move])) return null
@@ -604,7 +633,10 @@ export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
     drawn.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
     random
   )
-  return build(move, drawBeats(move, bed, capBeats, random), 0, bed, loopBars, random, looks)
+  const lead = build(move, drawBeats(move, bed, capBeats, random), 0, bed, loopBars, random, looks)
+  return lead !== null && input.combine === true
+    ? layerTurnaround(lead, input, bed, capBeats, capBeats, looks)
+    : lead
 }
 
 /** A turn's roll: no rate, no memory (a fresh move, `halvings` 0), the guards and the cap as
@@ -634,12 +666,20 @@ function rollForced(input: TurnaroundInput, force: TurnaroundForce): TurnaroundP
       ? Math.max(1, force.maxBeats)
       : capBeats
   const beats = Math.min(drawBeats(move, bed, capBeats, random), most)
-  return build(move, beats, 0, bed, loopBars, random, looks)
+  const lead = build(move, beats, 0, bed, loopBars, random, looks)
+  return lead !== null && input.combine === true
+    ? layerTurnaround(lead, input, bed, capBeats, most, looks)
+    : lead
 }
 
 /** What to remember of a phrase end for the next one. */
 export function rememberTurnaround(plan: TurnaroundPlan | null): TurnaroundMemory | null {
-  return plan === null ? null : { move: plan.move, beats: plan.beats, halvings: plan.halvings }
+  if (plan === null) return null
+  const memory: TurnaroundMemory = { move: plan.move, beats: plan.beats, halvings: plan.halvings }
+  if (plan.parts !== undefined && plan.parts.length > 1) {
+    memory.parts = plan.parts.map((p) => ({ move: p.move, beats: p.beats }))
+  }
+  return memory
 }
 
 /** The arc's direction from a density leg (radioDensity's DensityLeg, or the web radio's
@@ -789,3 +829,309 @@ export const TURNAROUND_DEPTH: Readonly<Record<TurnaroundDepth, TurnaroundDepthV
   },
   subtle: { liftTop: 0.35, dipFloor: 0.6, washPeak: 0.6, maxBeats: BEATS_PER_BAR }
 }
+
+// ---- combined turnarounds and the gap (spec 2026-10-03-radio-turnaround-combos-design) ----
+//
+// A real turnaround is usually two or three moves at once -- a riser over a high-pass lift with
+// the kick and bass pulled, a wash on a dipping mix -- and a riser usually stops short of the
+// one: the bed drops out for a beat or two while the riser's tail and the room ring, and
+// everything comes back on the one. With `combine` on, the lead is drawn exactly as before, then
+// compatible moves are layered on and a riser may leave a gap. Every part still ends on the one.
+
+/** How well two moves sit together, symmetric: 0 never (they fight over one parameter, or one
+ * contains the other), 1 works, 2 a classic pairing (spec section 1). */
+export const TURNAROUND_AFFINITY: Readonly<
+  Record<TurnaroundMove, Readonly<Record<TurnaroundMove, number>>>
+> = {
+  'drum drop': { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 1, lift: 1, dip: 1, riser: 1 },
+  'low drop': { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 1, lift: 2, dip: 1, riser: 2 },
+  stop: { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 2, lift: 1, dip: 1, riser: 0 },
+  wash: { 'drum drop': 1, 'low drop': 1, stop: 2, wash: 0, lift: 2, dip: 2, riser: 2 },
+  lift: { 'drum drop': 1, 'low drop': 2, stop: 1, wash: 2, lift: 0, dip: 0, riser: 2 },
+  dip: { 'drum drop': 1, 'low drop': 1, stop: 1, wash: 2, lift: 0, dip: 0, riser: 1 },
+  riser: { 'drum drop': 1, 'low drop': 2, stop: 0, wash: 2, lift: 2, dip: 1, riser: 0 }
+}
+
+/** How many moves a combined turnaround wants (1, 2, 3), by depth: subtle is mostly one, bold
+ * mostly two. The realised count is lower when nothing compatible can sound. */
+export const TURNAROUND_LAYER_ODDS: Readonly<Record<TurnaroundDepth, readonly number[]>> = {
+  subtle: [0.75, 0.25, 0],
+  bold: [0.3, 0.5, 0.2]
+}
+
+/** Chance a riser stops short of the one, leaving a gap (Elling: "usually there is a drop out
+ * after a riser... sometimes the riser works without it"). */
+export const TURNAROUND_GAP_CHANCE = 0.75
+
+/** Chance one melodic row keeps playing through the gap (the stop's rest measure), when one can. */
+export const TURNAROUND_GAP_KEEP_CHANCE = 1 / 3
+
+export const TURNAROUND_GAP_WORD = 'gap'
+
+/** The gap after a riser spanning `riserBeats` (its sounding length plus the gap): one beat at
+ * subtle and under a 2-bar riser, half a bar (2 beats) at bold from a 2-bar riser up; 0 when the
+ * riser spans under a bar (too short to stop early). */
+export function turnaroundGapBeats(riserBeats: number, depth: TurnaroundDepth): number {
+  if (!(riserBeats >= BEATS_PER_BAR)) return 0
+  return depth === 'bold' && riserBeats >= 2 * BEATS_PER_BAR ? 2 : 1
+}
+
+/** The layering's own random, seeded from ONE draw of the caller's: every layering choice comes
+ * from it, so the caller's stream moves on by exactly one number per combined roll. */
+export function turnaroundLayerRandom(draw: number): () => number {
+  return seededRandom(`turnaround-layers:${Math.floor(draw * 4294967296)}`)
+}
+
+/** Each drop's lengths (beats), for lengthening one past a gap: it must be heard before it. */
+const DROP_MENU: Partial<Record<TurnaroundMove, readonly number[]>> = {
+  'drum drop': [1, 2, 4],
+  'low drop': LOW_DROP_BEATS
+}
+
+/** A filter or wash curve whose peak lands where the gap starts and holds through it. */
+function holdThroughGap(points: TurnaroundPoint[], gap: number): TurnaroundPoint[] {
+  if (!(gap > 0) || points.length < 3) return points
+  const peak = points[points.length - 2]
+  return [...points.slice(0, -2), { beats: gap, value: peak.value }, ...points.slice(-2)]
+}
+
+/** The rows' curves for a set of parts and a gap: one entry per row, in the order rows are
+ * first touched. Every drop a row gets is the same shape, so its volume is the longest one. */
+function materialize(
+  parts: readonly TurnaroundPart[],
+  gap: number,
+  gapRows: readonly string[],
+  loopBars: number,
+  looks: TurnaroundLooks
+): TurnaroundRowCurves[] | null {
+  const drops = new Map<string, number>()
+  const out = new Map<string, TurnaroundRowCurves>()
+  const at = (id: string): TurnaroundRowCurves => {
+    let r = out.get(id)
+    if (r === undefined) out.set(id, (r = { rowId: id }))
+    return r
+  }
+  const drop = (id: string, beats: number): void => {
+    at(id)
+    drops.set(id, Math.max(drops.get(id) ?? 0, beats))
+  }
+  for (const p of parts) {
+    for (const id of p.rowIds) {
+      switch (p.move) {
+        case 'drum drop':
+        case 'low drop':
+        case 'stop':
+          drop(id, p.beats)
+          break
+        case 'lift': {
+          const f = turnaroundLiftCurve(p.beats, looks.liftTop)
+          at(id).filter = { ...f, cutoff: holdThroughGap(f.cutoff, gap) }
+          break
+        }
+        case 'dip': {
+          const f = turnaroundDipCurve(p.beats, looks.dipFloor)
+          at(id).filter = { ...f, cutoff: holdThroughGap(f.cutoff, gap) }
+          break
+        }
+        case 'wash': {
+          const w = turnaroundWashCurve(p.beats, looks.washPeak)
+          at(id).reverbSend = { ...w, points: holdThroughGap(w.points, gap) }
+          break
+        }
+        case 'riser':
+          break
+      }
+    }
+  }
+  if (gap > 0) for (const id of gapRows) drop(id, gap)
+  for (const [id, beats] of drops) {
+    const volume = turnaroundDropCurve(loopBars, beats)
+    if (volume.length === 0) return null
+    at(id).volume = volume
+  }
+  return [...out.values()]
+}
+
+/** The lead, layered (spec section 1-2): one draw from the caller, then from the layering's own
+ * random: how many moves; each added move by the arc's weight times its affinity with every
+ * move already in, among those that can sound, fit and whose family is on; its length (never
+ * past `most`) and rows; then, with a riser in, whether it leaves a gap and whether a melodic row
+ * keeps playing through it. Drops are lengthened past the gap (or the gap is dropped). */
+function layerTurnaround(
+  lead: TurnaroundPlan,
+  input: TurnaroundInput,
+  bed: Bed,
+  capBeats: number,
+  most: number,
+  looks: TurnaroundLooks
+): TurnaroundPlan | null {
+  const sub = turnaroundLayerRandom(input.random())
+  const depth = input.depth ?? DEFAULT_TURNAROUND_DEPTH
+  const families = input.moves ?? TURNAROUND_FAMILIES
+  const weights = TURNAROUND_WEIGHTS[input.arc]
+  const odds = TURNAROUND_LAYER_ODDS[depth]
+  const count = pickWeighted(
+    odds.map((weight, i) => ({ item: i + 1, weight })),
+    sub
+  )
+  const parts: TurnaroundPart[] = [
+    { move: lead.move, beats: lead.beats, rowIds: lead.rows.map((r) => r.rowId) }
+  ]
+  while (parts.length < count) {
+    const options = TURNAROUND_MOVES.filter(
+      (m) =>
+        !parts.some((p) => p.move === m) &&
+        families.includes(TURNAROUND_FAMILY_OF[m]) &&
+        fits(m, bed, capBeats)
+    )
+      .map((m) => ({
+        item: m,
+        weight: parts.reduce((w, p) => w * TURNAROUND_AFFINITY[p.move][m], weights[m])
+      }))
+      .filter((o) => o.weight > 0)
+    if (options.length === 0) break
+    const move = pickWeighted(options, sub)
+    const beats = Math.min(drawBeats(move, bed, capBeats, sub), most)
+    const one = build(move, beats, 0, bed, input.loopBars, sub, looks)
+    if (one === null) break
+    parts.push({ move, beats, rowIds: one.rows.map((r) => r.rowId) })
+  }
+  // the gap: a riser spanning a bar or more, with a bed of two or more to drop out
+  let gap = 0
+  let keeper: TurnaroundRow | null = null
+  const riser = parts.find((p) => p.move === 'riser')
+  if (riser !== undefined && riser.beats >= BEATS_PER_BAR && bed.audible.length >= 2) {
+    if (sub() < TURNAROUND_GAP_CHANCE) {
+      gap = turnaroundGapBeats(riser.beats, depth)
+      // a drop no longer than the gap would be swallowed by it: the next length past it, or no gap
+      const longer = parts.map((p) => {
+        const menu = DROP_MENU[p.move]
+        if (menu === undefined || p.beats > gap) return p.beats
+        return menu.find((b) => b > gap && b <= Math.min(capBeats, most)) ?? null
+      })
+      if (longer.some((b) => b === null)) gap = 0
+      else parts.forEach((p, i) => (p.beats = longer[i] as number))
+    }
+    const kept = bed.keeper
+    if (gap > 0 && kept !== null && kept.barLength * BEATS_PER_BAR >= gap) {
+      if (sub() < TURNAROUND_GAP_KEEP_CHANCE) keeper = kept
+    }
+  }
+  const gapRows = bed.audible.filter((r) => r !== keeper).map((r) => r.id)
+  const rows = materialize(parts, gap, gapRows, input.loopBars, looks)
+  if (rows === null) return lead
+  const plan: TurnaroundPlan = {
+    move: lead.move,
+    beats: Math.max(...parts.map((p) => p.beats)),
+    halvings: 0,
+    rows,
+    parts,
+    gapBeats: gap
+  }
+  if (riser !== undefined) plan.riserBars = (riser.beats - gap) / BEATS_PER_BAR
+  if (keeper !== null) plan.keeperId = keeper.id
+  return plan
+}
+
+/** A diminution of a combined phrase end: the moves in it that can diminish (drum drop, low drop,
+ * lift), together, each at half its length -- while the families, the arc and the guards still
+ * let it, never under a beat -- at the same rate, with no layering and no gap. The rate is today's
+ * one draw; then each part's rows (a drum drop's row), in order. */
+function diminishParts(
+  input: TurnaroundInput,
+  last: TurnaroundMemory,
+  bed: Bed,
+  capBeats: number,
+  chance: number,
+  looks: TurnaroundLooks
+): TurnaroundPlan | null {
+  if (last.halvings >= TURNAROUND_MAX_HALVINGS) return null
+  const families = input.moves ?? TURNAROUND_FAMILIES
+  const keep = (last.parts ?? [])
+    .filter(
+      (p) =>
+        DIMINISHING.includes(p.move) &&
+        families.includes(TURNAROUND_FAMILY_OF[p.move]) &&
+        TURNAROUND_WEIGHTS[input.arc][p.move] > 0 &&
+        canSound(p.move, bed)
+    )
+    .map((p) => ({ move: p.move, beats: Math.min(p.beats / 2, capBeats) }))
+    .filter((p) => p.beats >= 1)
+  if (keep.length === 0) return null
+  if (!(input.random() < chance)) return null
+  const parts: TurnaroundPart[] = []
+  for (const p of keep) {
+    const one = build(p.move, p.beats, 0, bed, input.loopBars, input.random, looks)
+    if (one === null) return null
+    parts.push({ move: p.move, beats: p.beats, rowIds: one.rows.map((r) => r.rowId) })
+  }
+  const rows = materialize(parts, 0, [], input.loopBars, looks)
+  if (rows === null) return null
+  return {
+    move: parts[0].move,
+    beats: Math.max(...parts.map((p) => p.beats)),
+    halvings: last.halvings + 1,
+    rows,
+    parts,
+    gapBeats: 0
+  }
+}
+
+// ---- saying it (the ruler, the flashes) ----
+
+/** The longest a turnaround's label may be before it is shortened to its lead and a count. */
+export const TURNAROUND_LABEL_MAX = 20
+
+/** A turnaround in words, the lead first: `riser + lift → gap`, `wash + dip`, `drop`. Longer than
+ * `max`: the lead and how many more, `riser +2 → gap`. */
+export function turnaroundLabel(
+  moves: readonly TurnaroundMove[],
+  gap: boolean,
+  max: number = TURNAROUND_LABEL_MAX
+): string {
+  if (moves.length === 0) return ''
+  const tail = gap ? ` → ${TURNAROUND_GAP_WORD}` : ''
+  const full = moves.map((m) => TURNAROUND_MOVE_LABEL[m]).join(' + ') + tail
+  if (full.length <= max || moves.length === 1) return full
+  return `${TURNAROUND_MOVE_LABEL[moves[0]]} +${moves.length - 1}${tail}`
+}
+
+/** A plan's moves, the lead first (a single move's plan is just its move). */
+export function turnaroundPlanMoves(
+  plan: Pick<TurnaroundPlan, 'move' | 'parts'>
+): TurnaroundMove[] {
+  return plan.parts !== undefined && plan.parts.length > 0
+    ? plan.parts.map((p) => p.move)
+    : [plan.move]
+}
+
+/** A word on a row, from `beats` before the wrap (when the move hitting it starts). */
+export interface TurnaroundFlash {
+  rowId: string
+  word: string
+  beats: number
+}
+
+/** Every word a plan flashes: each row its moves' words from where each starts, and `gap` on the
+ * rows that drop out, from where the gap starts. A plan with no parts (one move, `combine` off):
+ * every row its move's word from the plan's start, as before. The riser is its own voice: no row. */
+export function turnaroundFlashes(plan: TurnaroundPlan): TurnaroundFlash[] {
+  if (plan.parts === undefined) {
+    const word = TURNAROUND_MOVE_LABEL[plan.move]
+    return plan.rows.map((r) => ({ rowId: r.rowId, word, beats: plan.beats }))
+  }
+  const out: TurnaroundFlash[] = []
+  for (const p of plan.parts) {
+    for (const rowId of p.rowIds)
+      out.push({ rowId, word: TURNAROUND_MOVE_LABEL[p.move], beats: p.beats })
+  }
+  const gap = plan.gapBeats ?? 0
+  if (gap > 0) {
+    for (const r of plan.rows) {
+      if (r.rowId !== plan.keeperId && r.volume !== undefined) {
+        out.push({ rowId: r.rowId, word: TURNAROUND_GAP_WORD, beats: gap })
+      }
+    }
+  }
+  return out
+}
```

Read these against the spec while you apply them:
- **`layerTurnaround` is the only new consumer of `input.random()`,** called once, and only after the lead was built. `rollForced` passes `most` (the turn's clamp); a phrase end passes the cap.
- **The drop lengthening** (`DROP_MENU`) checks every drop part before it changes any. If one can't clear the gap, the gap goes and no length changes.
- **`materialize` returning null** (a drop curve that can't be placed) falls back to the lead alone, never to nothing: the lead was already a valid plan.
- **`diminishParts`** runs only for a memory with two or more parts. Its rate draw is today's single draw, and then each part's build draws (a drum drop's row) from the main random, as today's diminution does.

- [ ] **Step 5: Run the shared suite.**

Run: `npx vitest run src/shared`
Expected: PASS, every existing turnaround test unchanged (they run with `combine` absent) plus the 24 new ones. Planning run: 2496 passed.

- [ ] **Step 6: Typecheck both repos and lint.**

Run (sssketch): `npm run typecheck`. Expected: 0 errors.
Run (ell.ing/radio): `npm run typecheck && npx vitest run src`. Expected: 0 errors and green. Nothing there passes `combine` yet.
Run (sssketch): `npx eslint --fix src/shared/radioTurnaround.ts src/shared/radioTransition.ts src/shared/radioTurnaroundCombos.test.ts`. Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Commit (sssketch).**

```bash
git add src/shared/radioTurnaround.ts src/shared/radioTransition.ts src/shared/radioTurnaroundCombos.test.ts
git commit -m "radio turnarounds: combined moves and the riser's gap in the shared planner -- with combine on, the lead drawn as before, then one draw seeds the layering: 1-3 moves by depth, each by the arc's weight times its affinity (lift/dip, nested drops and stop/riser never meet), every part ending on the one; a riser stops short 3 in 4 (1 beat at subtle, half a bar at bold from a 2-bar riser), the bed dropping out for the gap, a melodic row kept 1 in 3, drops lengthened past it; a combination diminishes as its drops and lift; labels (riser + lift → gap) and per-part flashes; buildTransitionRiser's endBeforeBars. combine absent is today, draw for draw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 2: The ruler names the combination (`radioReadout.ts`)

**Files (sssketch):**
- Create: `src/shared/radioReadoutTurnaround.test.ts`
- Modify: `src/shared/radioReadout.ts`

**Depends on:** Task 1.

**Overlap with the pace slider:** its **Task 7** edits `radioReadout.ts` (`nextChange.with`, the status line) and `radioReadout.test.ts`.
- Run this task after pace Task 7 is committed, or entirely before it starts; never concurrently.
- The two touch different functions (`rulerEnd` and `armedTurnaround`'s type here, `nextPart` and `nextChange`'s type there), so a rebase is mechanical.
- This task's tests live in their own file so they can't conflict.

**Timing risk:** none (pure). With `parts` and `gap` absent, the ruler reads exactly as before. The first test pins it.

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioReadoutTurnaround.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { radioReadout } from './radioReadout'
import {
  TURNAROUND_AFFINITY,
  TURNAROUND_LABEL_MAX,
  TURNAROUND_MOVES,
  type TurnaroundMove
} from './radioTurnaround'

/** The ruler's end label for an armed turnaround. */
function end(armed: {
  move: TurnaroundMove | null
  isTurn: boolean
  parts?: readonly TurnaroundMove[]
  gap?: boolean
}): string | null {
  return radioReadout({
    bars: { intoPhrase: 0, phraseBars: 16, loopBars: 8 },
    nextChange: null,
    armedTurnaround: armed,
    arc: { state: 'off', count: 4, target: 4 },
    rows: []
  }).ruler.end
}

/** Every combination the planner can make: one to three moves, pairwise compatible, any lead. */
function combinations(): TurnaroundMove[][] {
  const out: TurnaroundMove[][] = []
  const ok = (ms: TurnaroundMove[]): boolean =>
    ms.every((a, i) => ms.every((b, j) => i === j || TURNAROUND_AFFINITY[a][b] > 0))
  for (const a of TURNAROUND_MOVES) {
    out.push([a])
    for (const b of TURNAROUND_MOVES) {
      if (b !== a && ok([a, b])) out.push([a, b])
      for (const c of TURNAROUND_MOVES)
        if (new Set([a, b, c]).size === 3 && ok([a, b, c])) out.push([a, b, c])
    }
  }
  return out
}

describe('the ruler names a combined turnaround (combos spec section 6)', () => {
  it('reads a single move exactly as before', () => {
    expect(end({ move: 'drum drop', isTurn: false })).toBe('drop')
    expect(end({ move: 'wash', isTurn: true })).toBe('turn: wash')
    expect(end({ move: null, isTurn: true })).toBe('turn')
    expect(end({ move: null, isTurn: false })).toBeNull()
  })

  it('names the moves, the lead first, and the gap', () => {
    expect(end({ move: 'riser', isTurn: false, parts: ['riser', 'lift'], gap: true })).toBe(
      'riser + lift → gap'
    )
    expect(end({ move: 'wash', isTurn: false, parts: ['wash', 'dip'] })).toBe('wash + dip')
    expect(end({ move: 'riser', isTurn: true, parts: ['riser', 'lift'], gap: true })).toBe(
      'turn: riser +1 → gap'
    )
  })

  it('every combination fits a phone: at most 20 characters, a turn at most 23', () => {
    for (const parts of combinations()) {
      for (const gap of parts.includes('riser') ? [false, true] : [false]) {
        const phrase = end({ move: parts[0], isTurn: false, parts, gap })!
        const turn = end({ move: parts[0], isTurn: true, parts, gap })!
        expect(phrase.length).toBeLessThanOrEqual(TURNAROUND_LABEL_MAX)
        expect(turn.length).toBeLessThanOrEqual(TURNAROUND_LABEL_MAX + 3)
        expect(turn.startsWith('turn: ')).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/shared/radioReadoutTurnaround.test.ts`
Expected: FAIL. The combinations read as their lead alone, and `parts` and `gap` are not known to the type.

- [ ] **Step 3: Implement.** Apply to `src/shared/radioReadout.ts`:

```diff
diff --git a/src/shared/radioReadout.ts b/src/shared/radioReadout.ts
index ee1d47a..4665288 100644
--- a/src/shared/radioReadout.ts
+++ b/src/shared/radioReadout.ts
@@ -17,8 +17,9 @@ import {
 } from './discoverSlotKind'
 import type { RadioTransitionKind } from './radioTransition'
 import {
-  TURNAROUND_MOVE_LABEL,
+  TURNAROUND_LABEL_MAX,
   turnaroundArc,
+  turnaroundLabel,
   turnaroundPhraseLaps,
   type TurnaroundMove
 } from './radioTurnaround'
@@ -75,8 +76,14 @@ export interface RadioReadoutInput {
     course?: readonly string[]
   } | null
   /** The turnaround armed for the phrase's end, or a turn waiting; `move` null while a turn
-   * waits for its roll. */
-  armedTurnaround: { move: TurnaroundMove | null; isTurn: boolean } | null
+   * waits for its roll. A combined one also gives `parts` (its moves, the lead first:
+   * turnaroundPlanMoves) and `gap` (it leaves a gap before the one). */
+  armedTurnaround: {
+    move: TurnaroundMove | null
+    isTurn: boolean
+    parts?: readonly TurnaroundMove[]
+    gap?: boolean
+  } | null
   arc: { state: RadioReadoutArcState; count: number; target: number }
   /** Radio is held: the arc part reads `held` (it goes nowhere while held). The runtime passes as
    * `nextChange` only what still lands while held (an arc step already on the timeline), or null. */
@@ -227,10 +234,16 @@ function nextPart(input: RadioReadoutInput): string | null {
   return `next: ${who}${how} · ${plural(bars, 'bar')}`
 }
 
+/** What a turn's ruler label starts with. */
+const TURN_PREFIX = 'turn: '
+
 function rulerEnd(t: RadioReadoutInput['armedTurnaround']): string | null {
   if (t === null) return null
-  if (t.isTurn) return t.move === null ? 'turn' : `turn: ${TURNAROUND_MOVE_LABEL[t.move]}`
-  return t.move === null ? null : TURNAROUND_MOVE_LABEL[t.move]
+  if (t.move === null) return t.isTurn ? 'turn' : null
+  const moves = t.parts !== undefined && t.parts.length > 0 ? t.parts : [t.move]
+  const gap = t.gap === true
+  if (!t.isTurn) return turnaroundLabel(moves, gap)
+  return TURN_PREFIX + turnaroundLabel(moves, gap, TURNAROUND_LABEL_MAX - TURN_PREFIX.length)
 }
 
 export function radioReadout(input: RadioReadoutInput): RadioReadout {
```

- [ ] **Step 4: Run the shared suite, typecheck both repos, lint.**

Run: `npx vitest run src/shared && npm run typecheck` (sssketch). Expected: PASS, 0 errors. Planning run: 2499 passed.
Run (ell.ing/radio): `npm run typecheck && npx vitest run src`. Expected: green. The web passes `armedTurnaround` without the new fields until Task 4.
Run: `npx eslint --fix src/shared/radioReadout.ts src/shared/radioReadoutTurnaround.test.ts`. Expected: clean.

- [ ] **Step 5: Commit (sssketch).**

```bash
git add src/shared/radioReadout.ts src/shared/radioReadoutTurnaround.test.ts
git commit -m "radio readout: the ruler names a combined turnaround -- its moves, the lead first, and → gap (riser + lift → gap); longer than 20 characters it reads as the lead and a count (riser +2 → gap), a turn at most 23; a single move reads as before

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 3: Web audio: the riser ends at the gap; the return on the one without a click (`src/audio/turnaround.ts`)

**Files (ell.ing/radio):**
- Modify: `src/audio/turnaround.ts`
- Modify: `src/audio/turnaround.test.ts`

**Depends on:** Task 1 (`gapBeats` and `parts` on `TurnaroundPlan`) in sssketch's working tree. **Overlap with the pace slider:** none (it never touches `src/audio/turnaround.ts`), so it can run now.

**Timing risks (spec §9.1, 9.2):**
- **The return.** Today the last two gain points are both at the wrap, a step from 0 to 1. The step becomes a linear ramp ending `ANTI_CLICK_SEC` (3 ms) after the wrap. It starts at the wrap's AudioContext time, the same instant a swapped stem starts its own 3 ms fade-in (`schedule.ts`), so a row swapping at that wrap and its turnaround gain rise together.
  - `applyTimedPoints` ramps linearly between points whose times differ, and steps where they are equal. So this needs no change in `gestures.ts`.
  - `cancelTurnaround` ignores a turnaround whose wrap has passed, so the 3 ms tail is never cut.
- **The riser.** `planRiser` counts back from the end it is given, so passing `wrap − gap` moves the riser's start, its end and its tail together. The plan's `start` (the engine's `MIN_LEAD_SEC` check) still reads the riser's start, which is now earlier than it would be for a riser to the one. That is correct: the gap is inside the plan's span.

- [ ] **Step 1: Change the tests first.** Apply to `src/audio/turnaround.test.ts`:

```diff
diff --git a/src/audio/turnaround.test.ts b/src/audio/turnaround.test.ts
index 745c357..e3eefa6 100644
--- a/src/audio/turnaround.test.ts
+++ b/src/audio/turnaround.test.ts
@@ -38,14 +38,15 @@ describe('turnaroundPointTimes', () => {
 })
 
 describe('planTurnaroundTimes', () => {
-  it("a drop: the row's turnaround gain leaves a bar before the wrap, silent into it, full on it", () => {
+  it("a drop: the row's turnaround gain leaves a bar before the wrap, silent into it, full on it (a 3 ms fade-in)", () => {
     const t = planTurnaroundTimes(plan({ rows: [{ rowId: 'd', volume: turnaroundDropCurve(4, 4) }] }), W, clock, 0.5, SR)
     expect(t.at).toBe(W)
     expect(r6(t.rows[0].gain)).toEqual([
       { time: 98, value: 1 },
       { time: 98.04, value: 0 },
       { time: 100, value: 0 },
-      { time: 100, value: 1 }
+      // back on the one with the swap's own anti-click fade-in, not a step (combos spec section 5)
+      { time: 100.003, value: 1 }
     ])
     expect(t.start).toBeCloseTo(98, 9)
   })
@@ -88,6 +89,33 @@ describe('planTurnaroundTimes', () => {
     expect(t.start).toBe(W - 4)
   })
 
+  it('a riser with a gap ends where the gap starts; the bed drops out for the gap and is back on the one', () => {
+    // a 2-bar span, half a bar of it the gap (120 bpm: 0.5 s a beat)
+    const t = planTurnaroundTimes(
+      plan({
+        move: 'riser',
+        beats: 8,
+        riserBars: 1.5,
+        gapBeats: 2,
+        parts: [{ move: 'riser', beats: 8, rowIds: [] }],
+        rows: [{ rowId: 'd', volume: turnaroundDropCurve(4, 2) }]
+      }),
+      W,
+      clock,
+      0.5,
+      SR,
+      () => 0.5
+    )
+    expect(t.riser?.start).toBeCloseTo(W - 4, 9)
+    expect(t.riser?.end).toBeCloseTo(W - 1, 9)
+    expect(t.riser!.tailEnd).toBeLessThan(W)
+    expect(t.start).toBeCloseTo(W - 4, 9)
+    const gain = r6(t.rows[0].gain)
+    expect(gain[0]).toEqual({ time: 99, value: 1 })
+    expect(gain[gain.length - 2]).toEqual({ time: 100, value: 0 })
+    expect(gain[gain.length - 1]).toEqual({ time: 100.003, value: 1 })
+  })
+
   it('measures beats on the clock in force before the wrap', () => {
     const slow = { ...clock, bpm: 60 } // a second a beat
     const t = planTurnaroundTimes(plan({ rows: [{ rowId: 'd', volume: turnaroundDropCurve(4, 4) }] }), W, slow, 0.5, SR)
```

- [ ] **Step 2: Run and watch them fail.**

Run: `npx vitest run src/audio/turnaround.test.ts`
Expected: FAIL. The drop still ends on a step at 100, and the gapped riser still ends at `W`.

- [ ] **Step 3: Implement.** Apply to `src/audio/turnaround.ts`:

```diff
diff --git a/src/audio/turnaround.ts b/src/audio/turnaround.ts
index 03deece..acdfec0 100644
--- a/src/audio/turnaround.ts
+++ b/src/audio/turnaround.ts
@@ -12,6 +12,7 @@
 import { turnaroundWashSend, type TurnaroundPlan, type TurnaroundPoint } from '@shared/radioTurnaround'
 import type { FilterMode } from '@shared/toolkit'
 import { cutoffHz, type TimedPoint } from './automation'
+import { ANTI_CLICK_SEC } from './schedule'
 import { secPerBar, type LoopClockState } from './loopClock'
 import { filterFrequency } from './masterChain'
 import { drawRiserCharacter } from './riserCharacter'
@@ -36,6 +37,14 @@ export interface TurnaroundTimes {
   riser?: RiserPlan
 }
 
+/** A volume curve's step back to full on the one, as the swap's own anti-click fade-in instead
+ * (ANTI_CLICK_SEC from the wrap): a step from silence to a sustained bass or pad clicks. */
+function returnWithoutClick(points: TimedPoint[]): TimedPoint[] {
+  const n = points.length
+  if (n < 2 || points[n - 1].time !== points[n - 2].time) return points
+  return [...points.slice(0, -1), { time: points[n - 1].time + ANTI_CLICK_SEC, value: points[n - 1].value }]
+}
+
 /** Beats before the wrap as AudioContext seconds. */
 export function turnaroundPointTimes(points: readonly TurnaroundPoint[], wrapTime: number, secPerBeat: number): TimedPoint[] {
   return points.map((p) => ({ time: wrapTime - p.beats * secPerBeat, value: p.value }))
@@ -64,14 +73,16 @@ export function planTurnaroundTimes(
   const spBeat = secPerBar(before.bpm) / 4
   const rows = plan.rows.map((r) => {
     const out: TurnaroundRowTimes = { rowId: r.rowId }
-    if (r.volume) out.gain = turnaroundPointTimes(r.volume, wrapTime, spBeat)
+    if (r.volume) out.gain = returnWithoutClick(turnaroundPointTimes(r.volume, wrapTime, spBeat))
     if (r.filter?.mode === 'highpass') out.highpassHz = cutoffTimes(r.filter.cutoff, 'highpass', wrapTime, spBeat, sampleRate)
     else if (r.filter) out.lowpassHz = cutoffTimes(r.filter.cutoff, 'lowpass', wrapTime, spBeat, sampleRate)
     if (r.reverbSend) out.send = turnaroundPointTimes(turnaroundWashSend(r.reverbSend, masterSend), wrapTime, spBeat)
     return out
   })
+  // a riser with a gap ends where the gap starts; its tail and its send ring on into it
+  const riserEnd = wrapTime - (plan.gapBeats ?? 0) * spBeat
   const riser =
-    plan.riserBars !== undefined ? planRiser('turnaround', wrapTime, before, plan.riserBars, () => drawRiserCharacter(random)) : null
+    plan.riserBars !== undefined ? planRiser('turnaround', riserEnd, before, plan.riserBars, () => drawRiserCharacter(random)) : null
   const firsts = [
     ...rows.flatMap((r) => [r.gain, r.highpassHz, r.lowpassHz, r.send].map((pts) => pts?.[0]?.time)),
     riser?.start
```

- [ ] **Step 4: Run the suite and typecheck.**

Run: `npx vitest run src && npm run typecheck`
Expected: green (planning run: 687 passed) and 0 errors. `gestures.test.ts` needs no change. Check that it still passes, since it drives `applyTurnaround` with `planTurnaroundTimes` output.

- [ ] **Step 5: Commit (ell.ing/radio).**

```bash
git add src/audio/turnaround.ts src/audio/turnaround.test.ts
git commit -m "turnarounds: a riser with a gap ends where the gap starts (its tail and send ring into it), and every turnaround drop comes back on the one with the swap's 3 ms anti-click fade-in instead of a hard step -- a whole bed returning from silence would click

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 4: Web radio: combine on, the readout and the flashes (`step.ts`, `controller.ts`)

**Files (ell.ing/radio):**
- Modify: `src/radio/step.ts` (`turnaroundInputOf`, `readoutView`, one import)
- Modify: `src/radio/controller.ts` (the `turnaround` action's flashes, one import)
- Modify: `src/radio/step.test.ts`

**Depends on:** Tasks 1, 2 and 3.

**Overlap with the pace slider:** its **Tasks 5 and 8** edit all three files, and Task 8 edits `readoutView`. Run this after pace Task 8 is committed. Then re-run the **whole** `step.test.ts`. Turning `combine` on adds one draw to the seeded stream after every fired phrase end and turn (spec §7), so any seeded test can shift.
- **The planning run** (on `f34961c`) found exactly three, rewritten here by intent:
  - the drop's 3 ms return, which was Task 3's;
  - diminution, generalised;
  - the turn ruler, which may now carry companions.
- **A pace test that breaks the same way** gets the same treatment: assert what the spec promises, never chase a seed. Name each one in the commit message.

**Timing risk:**
- `combine: true` goes into `turnaroundInputOf`, which feeds:
  - the phrase-end roll (`rollTurnaroundAt`);
  - the turn (`turnAt`);
  - the chips' dimming (`turnaroundMoveCanSound` / `turnaroundDraw`, which ignore `combine`).
- No new event, state or tick ordering. The plan still goes out as one `turnaround` action at the start of the last lap, and is taken back by `cancelTurnaround` on hold, as today.
- The flash times come from `turnaroundFlashes`, in beats before `a.time`, at the bpm the controller already used. The `gap` words are keyed with the plan, so a refused or replaced turnaround drops them with the rest (`dropRadioFlashes(key)`).

- [ ] **Step 1: Change the tests first.** Apply to `src/radio/step.test.ts`:

```diff
diff --git a/src/radio/step.test.ts b/src/radio/step.test.ts
index 496c612..2468a45 100644
--- a/src/radio/step.test.ts
+++ b/src/radio/step.test.ts
@@ -788,6 +788,24 @@ describe('turnarounds', () => {
     expect(seen).toBeGreaterThan(20)
   })
 
+  it('combines: phrase ends layer moves and risers leave gaps, every plan fitting its lap', () => {
+    let layered = 0
+    let gapped = 0
+    for (let seed = 1; seed <= 10; seed++) {
+      const sim = new Sim({ turnarounds: 'often', turnaroundDepth: 'bold' }, seeded(seed))
+      sim.send({ type: 'play' })
+      sim.run(0, 80 * LAP)
+      for (const a of sim.of('turnaround')) {
+        // a single move's diminution has no parts; a fresh roll always does
+        if ((a.plan.parts?.length ?? 1) > 1) layered++
+        if ((a.plan.gapBeats ?? 0) > 0) gapped++
+        expect(a.plan.beats).toBeLessThanOrEqual(8) // half the 4-bar loop
+      }
+    }
+    expect(layered).toBeGreaterThan(5)
+    expect(gapped).toBeGreaterThan(0)
+  })
+
   it('never a drop-out, and nothing at all when off', () => {
     const sim = new Sim({ turnarounds: 'off' }, seeded(1))
     sim.send({ type: 'play' })
@@ -798,12 +816,19 @@ describe('turnarounds', () => {
 
   it('often fires far more than rare; a phrase end right after one only repeats it, shorter', () => {
     const all = (turnarounds: 'rare' | 'often') => {
-      const runs: { at: number; move: string; beats: number }[][] = []
+      const runs: { at: number; move: string; beats: number; parts: string[] }[][] = []
       for (let seed = 1; seed <= 10; seed++) {
         const sim = new Sim({ turnarounds }, seeded(seed))
         sim.send({ type: 'play' })
         sim.run(0, 80 * LAP)
-        runs.push(sim.of('turnaround').map((a) => ({ at: a.time, move: a.plan.move, beats: a.plan.beats })))
+        runs.push(
+          sim.of('turnaround').map((a) => ({
+            at: a.time,
+            move: a.plan.move,
+            beats: a.plan.beats,
+            parts: (a.plan.parts ?? [{ move: a.plan.move, beats: a.plan.beats }]).map((p) => `${p.move}:${p.beats}`)
+          }))
+        )
       }
       return runs
     }
@@ -816,10 +841,14 @@ describe('turnarounds', () => {
     for (const run of [...often, ...rare]) {
       for (let i = 1; i < run.length; i++) {
         if (run[i].at - run[i - 1].at !== 4 * LAP) continue
-        // back to back: a diminution -- the same move, half as long
-        expect(['drum drop', 'low drop', 'lift']).toContain(run[i - 1].move)
-        expect(run[i].move).toBe(run[i - 1].move)
-        expect(run[i].beats).toBe(run[i - 1].beats / 2)
+        // back to back: a diminution -- the moves of the last that can diminish (drum drop, low
+        // drop, lift), each half as long, and nothing new (combos spec section 3)
+        const halved = run[i - 1].parts
+          .map((p) => p.split(':'))
+          .filter(([m]) => ['drum drop', 'low drop', 'lift'].includes(m))
+          .map(([m, b]) => `${m}:${Number(b) / 2}`)
+        expect(halved.length).toBeGreaterThan(0)
+        for (const p of run[i].parts) expect(halved).toContain(p)
       }
     }
   })
@@ -1621,7 +1650,8 @@ describe('the readout (sssketch spec 2026-10-03-radio-readout-design)', () => {
     sim.send({ type: 'turn', move: 'wash' })
     expect(view(sim.s).readout!.ruler.end).toBe('turn: wash')
     sim.run(1 + 1 / 30, 2)
-    expect(view(sim.s).readout!.ruler.end).toBe('turn: wash')
+    // the chip's move leads; the planner may layer more on (combos spec section 4)
+    expect(view(sim.s).readout!.ruler.end).toMatch(/^turn: wash( \+|$)/)
     sim.run(2, LAP + 0.1)
     expect(view(sim.s).readout!.ruler.end).toBeNull()
   })
```

- [ ] **Step 2: Run and watch them fail.**

Run: `npx vitest run src/radio/step.test.ts -t "turnarounds"`
Expected: FAIL on `combines: phrase ends layer moves...`. No plan has parts or a gap yet.

- [ ] **Step 3: Implement.** Apply:

```diff
diff --git a/src/radio/controller.ts b/src/radio/controller.ts
index d6b8cd6..37c88f3 100644
--- a/src/radio/controller.ts
+++ b/src/radio/controller.ts
@@ -13,7 +13,7 @@ import type { FoldDriftLap } from '@shared/radioFold'
 import type { RankClash } from '@shared/radioClash'
 import type { FoldCycle } from '../audio/timeline'
 import { radioGestureLeadsChange, type RadioTransitionKind } from '@shared/radioTransition'
-import { TURNAROUND_MOVE_LABEL, type TurnaroundDepth, type TurnaroundFamily, type TurnaroundMove, type TurnaroundPlan } from '@shared/radioTurnaround'
+import { turnaroundFlashes, type TurnaroundDepth, type TurnaroundFamily, type TurnaroundMove, type TurnaroundPlan } from '@shared/radioTurnaround'
 import { RADIO_THROW_WORD, dropRadioFlashes, pruneRadioFlashes, radioGestureFlashWord, type RadioFlash } from '@shared/radioReadout'
 import { NO_FAVE_FITS, normalizeFaves } from '@shared/discoverFaves'
 import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
@@ -404,8 +404,8 @@ export class RadioController {
         try {
           e.applyTurnaround(a.plan, a.time)
           // each row the move plays on, from its first beat (a riser is its own voice: no row)
-          const start = a.time - a.plan.beats * (60 / this.s.bpm)
-          for (const r of a.plan.rows) this.flash(r.rowId, TURNAROUND_MOVE_LABEL[a.plan.move], start, key)
+          const secPerBeat = 60 / this.s.bpm
+          for (const f of turnaroundFlashes(a.plan)) this.flash(f.rowId, f.word, a.time - f.beats * secPerBeat, key)
         } catch (err) {
           this.log(`radio: turnaround into ${a.time.toFixed(3)} refused (${a.plan.move})`, err)
           this.events.push({ type: 'turnaroundFailed', at: a.time })
diff --git a/src/radio/step.ts b/src/radio/step.ts
index 5ab950c..f4b25ed 100644
--- a/src/radio/step.ts
+++ b/src/radio/step.ts
@@ -60,6 +60,7 @@ import {
   turnaroundArc,
   turnaroundDraw,
   turnaroundMoveCanSound,
+  turnaroundPlanMoves,
   turnaroundTurnBeats,
   type TurnaroundDepth,
   type TurnaroundFamily,
@@ -1018,7 +1019,9 @@ function turnaroundInputOf(
     arc: s.settings.densityArc?.on ? turnaroundArc(s.density, s.rows.length) : 'steady',
     leavingRowId: null,
     moves: s.settings.turnaroundMoves,
-    depth: s.settings.turnaroundDepth
+    depth: s.settings.turnaroundDepth,
+    // layered moves and the riser's gap (sssketch spec 2026-10-03-radio-turnaround-combos-design)
+    combine: true
   }
 }
 
@@ -2383,7 +2386,12 @@ function readoutView(s: RadioState, next: Coming | null, flashes: readonly Radio
     armedTurnaround: s.turnRequest
       ? { move: s.turnRequest.move, isTurn: true }
       : s.turnaround
-        ? { move: s.turnaround.plan.move, isTurn: !!s.turnaround.turn }
+        ? {
+            move: s.turnaround.plan.move,
+            isTurn: !!s.turnaround.turn,
+            parts: turnaroundPlanMoves(s.turnaround.plan),
+            gap: (s.turnaround.plan.gapBeats ?? 0) > 0
+          }
         : null,
     arc: radioReadoutArc(s.density, s.rows.length, s.density !== null),
     held: s.held,
```

- [ ] **Step 4: Run the whole suite and typecheck.**

Run: `npx vitest run src && npm run typecheck`
Expected: green (planning run: 688 passed) and 0 errors. Rewrite any pace-slider test the extra draw moved, by intent, as described above.

- [ ] **Step 5: A seeded sim, for the report.** It is not committed. Drive `Sim` (as `step.test.ts` does) for 10 seeds × 80 laps at `turnarounds: 'often'`, `turnaroundDepth: 'bold'`, a 4-bar loop, and print:
  - the share of phrase ends with 1, 2 and 3 parts;
  - the share of riser-bearing plans with a gap;
  - every distinct ruler label.

  Every label must be at most 20 characters. Put the numbers in the task report.

- [ ] **Step 6: Commit (ell.ing/radio).**

```bash
git add src/radio/step.ts src/radio/controller.ts src/radio/step.test.ts
git commit -m "radio: turnarounds combine -- phrase ends and turns pass combine to @shared rollTurnaround (2-3 moves at bold, a riser usually leaving a gap before the one); the ruler names the combination (riser + lift → gap) and each row flashes its moves from where each starts, and gap; a phrase end after a combination diminishes as its drops and lift

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 5: Desktop: combine on, the riser's gap, the readout and the flashes (`DiscoverPanel.tsx`)

**Files (sssketch):** `src/renderer/src/components/DiscoverPanel.tsx`

**Depends on:** Tasks 1 and 2.

**Overlap with the pace slider:** its **Tasks 6 and 9** edit this file. Run this after pace Task 9 is committed. There are four small hunks, each anchored on turnaround code the pace slider does not touch:
- `turnaroundInputNow`;
- the turnaround block in `syncPreviewToEngine`'s lane builder;
- the flash log;
- the readout's `armedTurnaround`.

**Timing risk (spec §9.1-9.5):**
- **The gap's lanes** go through the existing path: `turnaroundToLoopBars`, `combineRadioCurves` multiply, and `turnaroundFitsLoop` drops a plan that no longer fits the loop. There is no new arming path. The arm-at-last-lap, clear-at-wrap pattern, and the owed roll waiting on a landed stem's length (`radioTurnaroundAtWrap`), are unchanged. The planner's cap is unchanged, so `TURNAROUND_ROLL_LATE_BARS` still holds.
- **The riser** is built with `endBeforeBars: gapBeats / 4`. It ends inside the lap, its engine tail (an eighth of a bar) inside the gap. Gaps are at least a beat, a quarter of a bar.
- **The return on the one** is the engine smoother's (τ 15 ms, the block split at the wrap). Nothing to do; spec flag 6.
- **The memory rule** "a lift or dip that filtered nothing is forgotten" now needs the plan to be that move alone. A combined plan has other audible parts, so the phrase end did sound and its memory stands.

- [ ] **Step 1: Implement.** Apply:

```diff
diff --git a/src/renderer/src/components/DiscoverPanel.tsx b/src/renderer/src/components/DiscoverPanel.tsx
index 7880063..b4d9130 100644
--- a/src/renderer/src/components/DiscoverPanel.tsx
+++ b/src/renderer/src/components/DiscoverPanel.tsx
@@ -114,7 +114,9 @@ import {
   turnaroundArc,
   turnaroundDraw,
   turnaroundFitsLoop,
+  turnaroundFlashes,
   turnaroundMoveCanSound,
+  turnaroundPlanMoves,
   turnaroundToLoopBars,
   turnaroundTurnBeats,
   turnaroundWashSend,
@@ -2120,6 +2122,7 @@ export function DiscoverPanel({
       if (
         turnaround.turn === null &&
         (turnaround.plan.move === 'lift' || turnaround.plan.move === 'dip') &&
+        turnaroundPlanMoves(turnaround.plan).length === 1 &&
         filtered === 0
       ) {
         radioTurnaroundMemoryRef.current = null
@@ -2127,7 +2130,9 @@ export function DiscoverPanel({
       if (turnaround.plan.riserBars !== undefined) {
         const riser = buildTransitionRiser(rifff.groupId, maxBarLength, turnaround.plan.riserBars, {
           variety: normalizeSoundSettings(sound ?? appSoundDefaultsNow()).riserVariety.on,
-          armId: turnaround.armId
+          armId: turnaround.armId,
+          // a riser with a gap ends where the gap starts; its tail and send ring on into it
+          endBeforeBars: (turnaround.plan.gapBeats ?? 0) / 4
         })
         if (riser) risers[riser.id] = riser
       }
@@ -3474,7 +3479,9 @@ export function DiscoverPanel({
           : 'steady',
       leavingRowId: null,
       moves: radioSettings.turnaroundMoves,
-      depth: radioSettings.turnaroundDepth
+      depth: radioSettings.turnaroundDepth,
+      // layered moves and the riser's gap (spec 2026-10-03-radio-turnaround-combos-design)
+      combine: true
     }
   }
   /** The loop as it plays now: every resolved row's length, and the longest. */
@@ -3968,9 +3975,15 @@ export function DiscoverPanel({
     if (ta !== null) {
       live.add(ta.armId)
       if (!seen.has(ta.armId)) {
-        const at = lapStart + loopBars - ta.plan.beats / 4
-        const word = TURNAROUND_MOVE_LABEL[ta.plan.move]
-        for (const r of ta.plan.rows) log.push({ rowId: r.rowId, word, at, key: ta.armId })
+        // each row its moves' words from where each starts, and `gap` where the gap starts
+        for (const f of turnaroundFlashes(ta.plan)) {
+          log.push({
+            rowId: f.rowId,
+            word: f.word,
+            at: lapStart + loopBars - f.beats / 4,
+            key: ta.armId
+          })
+        }
       }
     }
     const throws = radioThrowRef.current
@@ -4059,7 +4072,12 @@ export function DiscoverPanel({
         turnWaiting !== null
           ? { move: turnWaiting.move ?? null, isTurn: true }
           : armed !== null
-            ? { move: armed.plan.move, isTurn: armed.turn !== null }
+            ? {
+                move: armed.plan.move,
+                isTurn: armed.turn !== null,
+                parts: turnaroundPlanMoves(armed.plan),
+                gap: (armed.plan.gapBeats ?? 0) > 0
+              }
             : null,
       arc: radioReadoutArc(
         densityLegRef.current,
```

`TURNAROUND_MOVE_LABEL` stays imported; the chips still use it.

- [ ] **Step 2: Typecheck, lint and the shared tests.**

Run: `npm run typecheck && npx eslint --fix src/renderer/src/components/DiscoverPanel.tsx && npx vitest run src/shared`
Expected: 0 errors, a clean lint, shared green. The panel has no component tests, by convention.

- [ ] **Step 3: A desktop trace check (no audio).** In `npm run dev` with radio on, `turnarounds often`, depth `bold`: confirm in the `[radio]` dev log that a gapped turnaround's pushed project carries a riser clip whose `startBar + lengthBars` is `loopBars − gapBeats / 4`, and stem `volume` lanes ending silent into the wrap. Use the existing riser/automation logging, or a temporary `console.log` removed before commit. **No agent can hear it.** Say in the report that only the trace was checked.

- [ ] **Step 4: Commit (sssketch).**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover radio: turnarounds combine -- phrase ends and turns pass combine to rollTurnaround; a riser with a gap ends where the gap starts (buildTransitionRiser endBeforeBars), the bed's lanes silent through it; the ruler names the combination and each row flashes its moves and gap; a lift or dip that filtered nothing forgets the phrase end only when it was the whole plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 6: Cross-repo verification, review, and handoff

**Depends on:** all.

- [ ] **Step 1: Full suites in the real repos.**
  - **sssketch:** `npm run typecheck && npm run lint && npm test`. Expect the 4 known prettier warnings and the machine-dependent engine-spawn tests (memory: coreaudiod), nothing else.
  - **ell.ing/radio:** `npm run typecheck && npx vitest run`.

- [ ] **Step 2: Phone width.** Render the web full mode at 320 and 390 px wide in headless Chrome, as the faves task did (`spike/engine-check` style, or `dev-radio.html`). Arm the longest labels by hand:
  - `low drop + lift + wash` → `low drop +2`;
  - `turn: riser +2 → gap`;
  - `riser + low drop → gap`.

  The ruler's ticks must stay visible, and nothing may overflow the strip. Attach the screenshots to the report.

- [ ] **Step 3: Final review.** An independent reviewer checks, against the spec:
  - **§7, determinism:**
    - `combine` absent gives a byte-identical plan for the same draws (the existing shared tests are that proof);
    - on, one extra draw per fired fresh roll or turn, none otherwise.
  - **§9, timing:** each item against the code.
    - The web's return ramp starts at the wrap, not before.
    - The riser end is `wrap − gapBeats × secPerBeat` on the clock before the wrap.
    - The desktop riser clip ends gap-early, its tail inside the lap.
  - **§1:** no plan ever carries an affinity-0 pair (fuzz `rollTurnaround` with `combine` across arcs, depths, families, loops and `force`).
  - **The pace slider:**
    - turnarounds still end on lap 0 of the 16-bar turnaround phrase at every level (pace `step.test.ts` "turnarounds keep 16 bars whatever the level");
    - a mid-loop cut landing inside a gap is silent until the one on both radios.

- [ ] **Step 4: Memory and handoff** (sssketch auto-memory, `~/.claude/projects/-Users-nickel-Claudecode-sssketch/memory/`).
  - Add `radio_turnaround_combos_shipped.md`, covering:
    - what shipped, on which branches;
    - unpushed, or deployed (deploy the web only on Elling's go-ahead);
    - the walkthrough below;
    - the spec's flags.
  - Add a line to `MEMORY.md`.
  - Add a line to `ell.ing/radio/CLAUDE.md`'s radio-settings decisions: turnarounds combine (bold: mostly two moves), and a riser usually leaves a gap.

- [ ] **Step 5: Elling's walkthrough.** No agent can hear or see this; say so in the report.
  1. **Web, full mode, bold:**
     - Most phrase ends are two moves.
     - A riser usually stops a beat or half a bar short, the room ringing, everything back on the one.
     - Sometimes a lead line carries through the gap.
  2. **The one:** no click on the web; not soft on the desktop.
  3. **The ruler names the combination.** Check it on the phone.
  4. **Subtle:** mostly single moves, 1-beat gaps.
  5. **A thinning arc:** wash, dip, or both, nothing dropped.
  6. **Chips:** `riser` usually gaps and often gains a lift or low drop.

     Does a chip that layers feel right, or should chips stay exact (spec flag 1)?
  7. **Diminution after a combination:** the drops and lift repeat shorter.

