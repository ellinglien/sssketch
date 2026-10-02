import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  DEFAULT_TURNAROUND_DEPTH,
  TURNAROUND_DEPTH,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  TURNAROUND_FAMILY_OF,
  TURNAROUND_MOVES,
  normalizeTurnaroundDepth,
  normalizeTurnaroundMoves,
  rollTurnaround,
  toggleTurnaroundFamily,
  turnaroundDipCurve,
  turnaroundDraw,
  turnaroundLiftCurve,
  turnaroundWashCurve,
  type TurnaroundInput,
  type TurnaroundRow
} from './radioTurnaround'

function seq(values: number[]): () => number {
  let i = 0
  return (): number => {
    if (i >= values.length) throw new Error(`drew ${i + 1} times, only ${values.length} scripted`)
    return values[i++]
  }
}

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

function row(id: string, kinds: DiscoverSlotKind[]): TurnaroundRow {
  return { id, kinds, hooked: false, audible: true, inFilterIn: false, barLength: 4 }
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

describe('the move families', () => {
  it('are drops, wash, filters and riser, and every move belongs to one', () => {
    expect(TURNAROUND_FAMILIES).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(TURNAROUND_MOVES.map((m) => TURNAROUND_FAMILY_OF[m])).toEqual([
      'drops',
      'drops',
      'drops',
      'wash',
      'filters',
      'filters',
      'riser'
    ])
  })

  it('normalise: unknown entries dropped, canonical order, a non-array is all of them, empty stays empty', () => {
    expect(normalizeTurnaroundMoves(['riser', 'junk', 'wash'])).toEqual(['wash', 'riser'])
    expect(normalizeTurnaroundMoves(undefined)).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(normalizeTurnaroundMoves('drops')).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(normalizeTurnaroundMoves([])).toEqual([])
  })

  it('toggle one family, keeping the order', () => {
    expect(toggleTurnaroundFamily(TURNAROUND_FAMILIES, 'wash')).toEqual([
      'drops',
      'filters',
      'riser'
    ])
    expect(toggleTurnaroundFamily(['riser'], 'drops')).toEqual(['drops', 'riser'])
    expect(toggleTurnaroundFamily(['riser'], 'riser')).toEqual([])
  })

  it('the draw skips a family that is off', () => {
    const base = { rows: BED, leavingRowId: null, loopBars: 8, arc: 'steady' as const }
    expect(turnaroundDraw({ ...base, moves: ['filters'] })).toEqual(['lift', 'dip'])
    expect(turnaroundDraw({ ...base, moves: ['drops', 'riser'] })).toEqual([
      'drum drop',
      'low drop',
      'stop',
      'riser'
    ])
    expect(turnaroundDraw(base)).toHaveLength(7)
  })

  it('none enabled behaves as off, and spends no draw', () => {
    expect(rollTurnaround(input({ moves: [] }))).toBeNull()
  })

  it('a family switched off is not repeated by a diminution', () => {
    expect(
      rollTurnaround(
        input({ moves: ['wash'], lastPhrase: { move: 'low drop', beats: 8, halvings: 0 } })
      )
    ).toBeNull()
  })

  it('only the families on are ever drawn', () => {
    const random = mulberry32(17)
    let seen = 0
    for (let i = 0; i < 2000; i++) {
      const plan = rollTurnaround(input({ moves: ['wash', 'riser'], random }))
      if (plan === null) continue
      seen++
      expect(['wash', 'riser']).toContain(plan.move)
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('the depth', () => {
  it('is bold by default, subtle or bold, and normalises junk to bold', () => {
    expect(DEFAULT_TURNAROUND_DEPTH).toBe('bold')
    expect(TURNAROUND_DEPTH_OPTIONS).toEqual(['subtle', 'bold'])
    expect(normalizeTurnaroundDepth('subtle')).toBe('subtle')
    expect(normalizeTurnaroundDepth('deep')).toBe('bold')
  })

  it("bold is the spec's numbers; subtle is shallower and at most a bar", () => {
    expect(TURNAROUND_DEPTH).toEqual({
      bold: { liftTop: 0.6, dipFloor: 0.35, washPeak: 0.85, maxBeats: 16 },
      subtle: { liftTop: 0.35, dipFloor: 0.6, washPeak: 0.6, maxBeats: 4 }
    })
  })

  it('subtle lifts to 0.35, dips to 0.6, washes to 0.6', () => {
    const lift = rollTurnaround(input({ depth: 'subtle', random: seq([0, 0.65, 0]) }))
    expect(lift?.rows[0].filter).toEqual(turnaroundLiftCurve(4, 0.35))
    const dip = rollTurnaround(input({ depth: 'subtle', random: seq([0, 0.85]) }))
    expect(dip?.rows[0].filter).toEqual(turnaroundDipCurve(4, 0.6))
    const wash = rollTurnaround(input({ depth: 'subtle', random: seq([0, 0.55]) }))
    expect(wash?.rows[0].reverbSend).toEqual(turnaroundWashCurve(4, 0.6))
  })

  it('subtle caps every move at a bar, however long the loop', () => {
    const random = mulberry32(19)
    for (let i = 0; i < 3000; i++) {
      const plan = rollTurnaround(input({ depth: 'subtle', loopBars: 32, random }))
      if (plan === null) continue
      expect(plan.beats).toBeLessThanOrEqual(4)
      if (plan.riserBars !== undefined) expect(plan.riserBars).toBe(1)
    }
  })

  it('an input without a depth is bold', () => {
    const plain = rollTurnaround(input({ random: seq([0, 0.65, 0]) }))
    expect(plain?.rows[0].filter).toEqual(turnaroundLiftCurve(4))
  })
})
