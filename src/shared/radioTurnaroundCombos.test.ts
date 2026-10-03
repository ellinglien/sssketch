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
