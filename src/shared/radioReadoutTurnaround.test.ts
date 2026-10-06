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
    expect(end({ move: 'drum drop', isTurn: false })).toBe('drums out')
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

  it('every combination fits a phone: at most 20 characters, a turn too', () => {
    for (const parts of combinations()) {
      for (const gap of parts.includes('riser') ? [false, true] : [false]) {
        const phrase = end({ move: parts[0], isTurn: false, parts, gap })!
        const turn = end({ move: parts[0], isTurn: true, parts, gap })!
        expect(phrase.length).toBeLessThanOrEqual(TURNAROUND_LABEL_MAX)
        expect(turn.length, turn).toBeLessThanOrEqual(TURNAROUND_LABEL_MAX)
        expect(turn.startsWith('turn: ')).toBe(true)
      }
    }
  })
})
