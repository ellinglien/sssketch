import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  TURNAROUND_MOVES,
  TURNAROUND_WEIGHTS,
  rememberTurnaround,
  rollTurnaround,
  turnaroundArc,
  turnaroundCapBeats,
  turnaroundDipCurve,
  turnaroundDraw,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundStopKeeper,
  type TurnaroundInput,
  type TurnaroundMove,
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

function draw(over: Partial<TurnaroundInput> = {}): TurnaroundMove[] {
  return turnaroundDraw(input(over))
}

function ids(over: Partial<TurnaroundInput>): string[] {
  const plan = rollTurnaround(input(over))
  if (plan === null) throw new Error('expected a turnaround')
  return plan.rows.map((r) => r.rowId)
}

function sorted(set: Set<number> | undefined): number[] {
  return [...(set ?? [])].sort((a, b) => a - b)
}

describe('the rate', () => {
  it('never fires when off, and spends no draw', () => {
    expect(rollTurnaround(input({ rate: 'off' }))).toBeNull()
  })

  it('fires below the rate only', () => {
    expect(rollTurnaround(input({ rate: 'rare', random: seq([0.34]) }))).toBeNull()
    expect(rollTurnaround(input({ rate: 'rare', random: seq([0.33, 0.95, 0]) }))?.move).toBe(
      'riser'
    )
    expect(rollTurnaround(input({ rate: 'often', random: seq([0.67]) }))).toBeNull()
    expect(rollTurnaround(input({ rate: 'often', random: seq([0.66, 0.95, 0]) }))?.move).toBe(
      'riser'
    )
  })

  it('fires about one in three at rare and two in three at often', () => {
    for (const [rate, want] of [
      ['rare', 1 / 3],
      ['often', 2 / 3]
    ] as const) {
      const random = mulberry32(7)
      let fired = 0
      for (let i = 0; i < 6000; i++) if (rollTurnaround(input({ rate, random })) !== null) fired++
      expect(fired / 6000).toBeGreaterThan(want - 0.03)
      expect(fired / 6000).toBeLessThan(want + 0.03)
    }
  })

  it('is the same plan for the same seed', () => {
    const run = (seed: number): unknown[] => {
      const random = mulberry32(seed)
      return Array.from({ length: 50 }, () => rollTurnaround(input({ random })))
    }
    expect(run(3)).toEqual(run(3))
  })

  it('spends no draw when nothing can sound', () => {
    const silent = BED.map((r) => ({ ...r, audible: false }))
    expect(rollTurnaround(input({ rows: silent }))).toBeNull()
  })
})

describe('never at two phrase ends in a row, except diminution', () => {
  it('skips the phrase end after a turnaround that cannot diminish, without a draw', () => {
    for (const move of ['stop', 'wash', 'dip', 'riser'] as const) {
      expect(rollTurnaround(input({ lastPhrase: { move, beats: 4, halvings: 0 } }))).toBeNull()
    }
  })

  it('repeats a drum drop, a low drop or a lift at half its length, at the same rate', () => {
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'low drop', beats: 8, halvings: 0 }, random: seq([0]) })
      )
    ).toMatchObject({ move: 'low drop', beats: 4, halvings: 1 })
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'lift', beats: 8, halvings: 1 }, random: seq([0]) })
      )
    ).toMatchObject({ move: 'lift', beats: 4, halvings: 2 })
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'drum drop', beats: 4, halvings: 0 }, random: seq([0, 0]) })
      )
    ).toMatchObject({ move: 'drum drop', beats: 2, halvings: 1 })
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'low drop', beats: 8, halvings: 0 }, random: seq([0.67]) })
      )
    ).toBeNull()
  })

  it('halves twice at most, and never below one beat', () => {
    expect(
      rollTurnaround(input({ lastPhrase: { move: 'low drop', beats: 2, halvings: 2 } }))
    ).toBeNull()
    expect(
      rollTurnaround(input({ lastPhrase: { move: 'drum drop', beats: 1, halvings: 0 } }))
    ).toBeNull()
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'drum drop', beats: 2, halvings: 1 }, random: seq([0, 0]) })
      )
    ).toMatchObject({ beats: 1, halvings: 2 })
  })

  it('does not repeat a drop while the arc thins, nor a move that can no longer sound', () => {
    expect(
      rollTurnaround(
        input({ arc: 'thinning', lastPhrase: { move: 'low drop', beats: 8, halvings: 0 } })
      )
    ).toBeNull()
    expect(
      rollTurnaround(
        input({
          rows: BED.filter((r) => r.id !== 'd'),
          lastPhrase: { move: 'drum drop', beats: 4, halvings: 0 }
        })
      )
    ).toBeNull()
  })

  it('rememberTurnaround keeps the move, its length and its halvings; null for none', () => {
    const plan = rollTurnaround(input({ random: seq([0, 0.25, 0.5]) }))
    expect(rememberTurnaround(plan)).toEqual({ move: 'low drop', beats: 4, halvings: 0 })
    expect(rememberTurnaround(null)).toBeNull()
  })
})

describe('the guards (turnaroundDraw)', () => {
  it('puts every move in the draw for a full bed on a long loop, while steady', () => {
    expect(draw()).toEqual(['drum drop', 'low drop', 'stop', 'wash', 'lift', 'dip', 'riser'])
  })

  it('a drum drop needs a drums row; a low drop a drums or a bass row', () => {
    const melodic = [row('l', ['lead']), row('w', ['warm'])]
    // the stop is still in: it drops the warm row and keeps the lead
    expect(draw({ rows: melodic })).toEqual(['stop', 'wash', 'lift', 'dip', 'riser'])
    const bassAndLead = [row('b', ['bass']), row('l', ['lead'])]
    expect(draw({ rows: bassAndLead })).toEqual([
      'low drop',
      'stop',
      'wash',
      'lift',
      'dip',
      'riser'
    ])
  })

  it('drops and the stop need two audible rows; a row not heard does not count', () => {
    const lonely = [row('d', ['drums']), row('l', ['lead'], { audible: false })]
    expect(draw({ rows: lonely })).toEqual(['riser'])
  })

  it('never silences every row: no low drop over only drums and bass, no stop without a melodic row', () => {
    const low = [row('d', ['drums']), row('b', ['bass'])]
    expect(draw({ rows: low })).toEqual(['drum drop', 'wash', 'lift', 'dip', 'riser'])
  })

  it('the wash and the filters need a row that is not drums; the filters one not mid filter-in', () => {
    const drumsOnly = [row('d', ['drums']), row('d2', ['drums', 'rhythmic'])]
    expect(draw({ rows: drumsOnly })).toEqual(['drum drop', 'riser'])
    const sweeping = BED.map((r) => (r.id === 'd' ? r : { ...r, inFilterIn: true }))
    expect(draw({ rows: sweeping })).toEqual(['drum drop', 'low drop', 'stop', 'wash', 'riser'])
  })

  it('leaves out a move whose shortest length does not fit min(half the loop, 4 bars)', () => {
    expect(draw({ loopBars: 1 })).toEqual(['drum drop', 'low drop', 'stop']) // cap 2 beats
    expect(draw({ loopBars: 0.5 })).toEqual(['drum drop', 'stop']) // cap 1 beat
    expect(draw({ loopBars: 0 })).toEqual([])
  })

  it('follows the arc: thinning draws only the wash and the dip', () => {
    expect(draw({ arc: 'thinning' })).toEqual(['wash', 'dip'])
    expect(draw({ arc: 'growing' })).toEqual(['drum drop', 'low drop', 'stop', 'lift', 'riser'])
  })
})

describe('which rows', () => {
  it('a drum drop takes one drums row, drawn', () => {
    const rows = [...BED, row('d2', ['drums'])]
    const plan = rollTurnaround(input({ rows, random: seq([0, 0.05, 0.5, 0.9]) }))
    expect(plan?.move).toBe('drum drop')
    expect(plan?.beats).toBe(2)
    expect(plan?.rows.map((r) => r.rowId)).toEqual(['d2'])
    expect(plan?.rows[0].volume?.at(-1)).toEqual({ beats: 0, value: 1 })
  })

  it('a low drop takes every drums and every bass row together', () => {
    const rows = [...BED, row('db', ['drums', 'bass']), row('b2', ['bass'])]
    const plan = rollTurnaround(input({ rows, random: seq([0, 0.25, 0]) }))
    expect(plan?.move).toBe('low drop')
    expect(plan?.beats).toBe(2)
    expect(plan?.rows.map((r) => r.rowId)).toEqual(['d', 'b', 'db', 'b2'])
    for (const r of plan?.rows ?? []) expect(r.volume).toEqual(turnaroundDropCurve(8, 2))
  })

  it('the stop keeps one melodic row: the hook first, then a lead, then any', () => {
    expect(
      turnaroundStopKeeper([
        row('d', ['drums'], { hooked: true }),
        row('w', ['warm']),
        row('l', ['lead'])
      ])?.id
    ).toBe('l')
    expect(
      turnaroundStopKeeper([row('l', ['lead']), row('w', ['warm'], { hooked: true })])?.id
    ).toBe('w')
    expect(turnaroundStopKeeper([row('b', ['bass']), row('w', ['warm'])])?.id).toBe('w')
    expect(turnaroundStopKeeper([row('d', ['drums']), row('b', ['bass', 'warm'])])).toBeNull()
    expect(ids({ random: seq([0, 0.45, 0.5]) })).toEqual(['d', 'b', 'w']) // everything but the lead
  })

  it("the stop is never longer than the kept row's own loop", () => {
    const rows = [row('d', ['drums']), row('l', ['lead'], { barLength: 0.25 })]
    const plan = rollTurnaround(input({ rows, random: seq([0, 0.45, 0.9]) }))
    expect(plan?.move).toBe('stop')
    expect(plan?.beats).toBe(1)
  })

  it('the wash takes the row the arc removes at this wrap, else every row but drums', () => {
    expect(ids({ leavingRowId: 'd', random: seq([0, 0.55]) })).toEqual(['d'])
    expect(ids({ random: seq([0, 0.55]) })).toEqual(['b', 'l', 'w'])
    // a leaving row that is not heard is not the target
    const rows = BED.map((r) => (r.id === 'w' ? { ...r, audible: false } : r))
    expect(ids({ rows, leavingRowId: 'w', random: seq([0, 0.55]) })).toEqual(['b', 'l'])
  })

  it('the lift and the dip take every row but drums, and skip a row mid filter-in', () => {
    const rows = BED.map((r) => (r.id === 'l' ? { ...r, inFilterIn: true } : r))
    const lift = rollTurnaround(input({ rows, random: seq([0, 0.65, 0]) }))
    expect(lift?.move).toBe('lift')
    expect(lift?.beats).toBe(4)
    expect(lift?.rows.map((r) => r.rowId)).toEqual(['b', 'w'])
    expect(lift?.rows[0].filter).toEqual(turnaroundLiftCurve(4))
    const dip = rollTurnaround(input({ rows, random: seq([0, 0.85]) }))
    expect(dip?.move).toBe('dip')
    expect(dip?.rows[0].filter).toEqual(turnaroundDipCurve(4))
  })

  it('the riser has no rows, only its length in bars', () => {
    expect(rollTurnaround(input({ random: seq([0, 0.95, 0.5]) }))).toEqual({
      move: 'riser',
      beats: 8,
      halvings: 0,
      rows: [],
      riserBars: 2
    })
  })

  it('a thinning arc never drops a row', () => {
    const random = mulberry32(11)
    for (let i = 0; i < 2000; i++) {
      const plan = rollTurnaround(input({ arc: 'thinning', random }))
      if (plan === null) continue
      expect(['wash', 'dip']).toContain(plan.move)
      for (const r of plan.rows) expect(r.volume).toBeUndefined()
    }
  })
})

describe('the weights', () => {
  it('are the spec table', () => {
    expect(TURNAROUND_WEIGHTS).toEqual({
      growing: { 'drum drop': 2, 'low drop': 3, stop: 1, wash: 0, lift: 3, dip: 0, riser: 3 },
      thinning: { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 3, lift: 0, dip: 3, riser: 0 },
      steady: { 'drum drop': 2, 'low drop': 2, stop: 1, wash: 1, lift: 2, dip: 1, riser: 1 }
    })
  })

  it('make the stop the rarest move drawn, everywhere', () => {
    for (const arc of ['growing', 'thinning', 'steady'] as const) {
      const w = TURNAROUND_WEIGHTS[arc]
      if (w.stop === 0) continue
      for (const m of TURNAROUND_MOVES.filter((x) => w[x] > 0))
        expect(w.stop).toBeLessThanOrEqual(w[m])
    }
  })

  it('draw moves in proportion', () => {
    const random = mulberry32(5)
    const counts: Partial<Record<TurnaroundMove, number>> = {}
    let n = 0
    for (let i = 0; i < 20000; i++) {
      const plan = rollTurnaround(input({ arc: 'growing', random }))
      if (plan === null) continue
      n++
      counts[plan.move] = (counts[plan.move] ?? 0) + 1
    }
    // growing: drum drop 2, low drop 3, stop 1, lift 3, riser 3 -- of 12
    expect((counts['low drop'] ?? 0) / n).toBeCloseTo(3 / 12, 1)
    expect((counts.stop ?? 0) / n).toBeCloseTo(1 / 12, 1)
    expect(counts.wash).toBeUndefined()
    expect(counts.dip).toBeUndefined()
  })
})

describe('every plan', () => {
  it('ends every curve on the one at rest, and is at most min(half the loop, 4 bars)', () => {
    const random = mulberry32(9)
    for (const loopBars of [1, 2, 4, 8, 16, 32]) {
      for (const arc of ['growing', 'thinning', 'steady'] as const) {
        for (let i = 0; i < 200; i++) {
          const plan = rollTurnaround(input({ loopBars, arc, random }))
          if (plan === null) continue
          expect(plan.beats).toBeGreaterThanOrEqual(1)
          expect(plan.beats).toBeLessThanOrEqual(turnaroundCapBeats(loopBars))
          if (plan.riserBars !== undefined) expect(plan.riserBars * 4).toBe(plan.beats)
          for (const r of plan.rows) {
            if (r.volume) {
              expect(r.volume.at(-1)).toEqual({ beats: 0, value: 1 })
              expect(r.volume[0].beats).toBeCloseTo(plan.beats, 9)
            }
            if (r.filter) {
              const rest = r.filter.mode === 'highpass' ? 0 : 1
              expect(r.filter.cutoff.at(-1)).toEqual({ beats: 0, value: rest })
              expect(r.filter.cutoff[0].beats).toBe(plan.beats)
            }
            if (r.reverbSend) {
              expect(r.reverbSend.points.at(-1)).toEqual({ beats: 0, value: 0 })
              expect(r.reverbSend.points[0].beats).toBe(plan.beats)
            }
          }
        }
      }
    }
  })

  it('draws each length from its own menu', () => {
    const seen: Partial<Record<TurnaroundMove, Set<number>>> = {}
    const random = mulberry32(13)
    for (let i = 0; i < 6000; i++) {
      const plan = rollTurnaround(input({ loopBars: 32, random }))
      if (plan === null) continue
      const set = seen[plan.move] ?? new Set<number>()
      set.add(plan.beats)
      seen[plan.move] = set
    }
    expect(sorted(seen['drum drop'])).toEqual([1, 2, 4])
    expect(sorted(seen['low drop'])).toEqual([2, 4, 8])
    expect(sorted(seen.stop)).toEqual([1, 2, 4])
    expect(sorted(seen.wash)).toEqual([4])
    expect(sorted(seen.lift)).toEqual([4, 8])
    expect(sorted(seen.dip)).toEqual([4])
    expect(sorted(seen.riser)).toEqual([4, 8, 16])
  })

  it('clamps a drawn length to the loop', () => {
    // a 2-bar loop caps every move at 1 bar: an 8-beat low drop plays 4
    expect(rollTurnaround(input({ loopBars: 2, random: seq([0, 0.25, 0.9]) }))).toMatchObject({
      move: 'low drop',
      beats: 4
    })
  })
})

describe('turnaroundArc', () => {
  it("is steady with no leg or at the leg's target; else the leg's direction", () => {
    expect(turnaroundArc(null, 3)).toBe('steady')
    expect(turnaroundArc({ phase: 'growing', target: 5 }, 3)).toBe('growing')
    expect(turnaroundArc({ phase: 'growing', target: 5 }, 5)).toBe('steady')
    expect(turnaroundArc({ phase: 'thinning', target: 2 }, 4)).toBe('thinning')
    expect(turnaroundArc({ phase: 'thinning', target: 2 }, 2)).toBe('steady')
    // rows on the far side of the target: the leg is about to turn round
    expect(turnaroundArc({ phase: 'growing', target: 4 }, 5)).toBe('steady')
  })
})
