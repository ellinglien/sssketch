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
  it('names every move in lowercase, at most two words; the drop-outs say what goes out', () => {
    for (const move of TURNAROUND_MOVES) {
      const label = TURNAROUND_MOVE_LABEL[move]
      expect(label).toBe(label.toLowerCase())
      expect(label.split(' ').length).toBeLessThanOrEqual(2)
    }
    // Elling, 2026-10-05: `drop` is the intensity arc's drop (the low end back), never a chip
    expect(TURNAROUND_MOVE_LABEL['drum drop']).toBe('drums out')
    expect(TURNAROUND_MOVE_LABEL['low drop']).toBe('low out')
    expect(Object.values(TURNAROUND_MOVE_LABEL)).not.toContain('drop')
  })
})
