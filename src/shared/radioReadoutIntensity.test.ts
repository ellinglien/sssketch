// The intensity arc's words (spec 2026-10-05-radio-intensity-arc-design section 9):
// radioReadout.ts, radioIntensityArc.ts's words, the renamed chips.
import { describe, expect, it } from 'vitest'
import {
  radioReadout,
  radioReadoutIntensityArc,
  type RadioReadoutInput,
  type RadioReadoutRowInput
} from './radioReadout'
import {
  RADIO_ARC_REST_SHORT,
  RADIO_ARC_REST_WORD,
  RADIO_BREAKDOWN_WORD,
  RADIO_BUILDING_WORD,
  RADIO_BUILD_WORD,
  RADIO_DROPPING_WORD,
  RADIO_DROP_WORD
} from './radioIntensityArc'
import { RADIO_ROLE_WORDS_MAX } from './radioHooks'
import { TURNAROUND_LABEL_MAX, TURNAROUND_MOVE_LABEL, turnaroundLabel } from './radioTurnaround'

const row = (rowId: string, o: Partial<RadioReadoutRowInput> = {}): RadioReadoutRowInput => ({
  rowId,
  kinds: ['drums'],
  laps: 3,
  ...o
})
const input = (over: Partial<RadioReadoutInput> = {}): RadioReadoutInput => ({
  bars: { intoPhrase: 5.5, phraseBars: 16, loopBars: 4 },
  nextChange: null,
  armedTurnaround: null,
  arc: { state: 'off', count: 3, target: 3 },
  rows: [row('a'), row('b', { kinds: ['bass'] }), row('c', { kinds: ['lead'] })],
  ...over
})
const line = (o: Partial<RadioReadoutInput>): string => radioReadout(input(o)).statusLine

describe('the status line under intensity', () => {
  it('says the phase: building, a bigger peak, the breakdown with its drop, the drop', () => {
    expect(line({ arc: { state: 'growing', count: 3, target: 5 } })).toBe('building ↑ 3 → 5')
    expect(line({ arc: { state: 'growing', count: 3, target: 5, big: true } })).toBe(
      'building ↑↑ 3 → 5'
    )
    expect(line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: 11.5 } })).toBe(
      'breakdown · drop in 12 bars'
    )
    expect(line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: 1 } })).toBe(
      'breakdown · drop in 1 bar'
    )
    expect(
      line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: 12 }, narrow: true })
    ).toBe('breakdown · 12')
    expect(line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: null } })).toBe(
      'breakdown'
    )
    expect(line({ arc: { state: 'drop', count: 5, target: 5 } })).toBe('drop · 5 rows')
    expect(line({ arc: { state: 'drop', count: 5, target: 5 }, held: true })).toBe('held · 5 rows')
  })

  it('reads the machine: growing to its peak, then steady; before it begins, steady', () => {
    const m = { begun: true, phase: 'build' as const, peakRows: 5, big: false }
    expect(radioReadoutIntensityArc(m, 3, null)).toEqual({ state: 'growing', count: 3, target: 5 })
    expect(radioReadoutIntensityArc({ ...m, big: true }, 3, null)).toMatchObject({ big: true })
    expect(radioReadoutIntensityArc(m, 5, null).state).toBe('steady')
    expect(radioReadoutIntensityArc({ ...m, phase: 'breakdown' }, 4, 8)).toEqual({
      state: 'breakdown',
      count: 4,
      target: 4,
      dropInBars: 8
    })
    expect(radioReadoutIntensityArc({ ...m, phase: 'drop' }, 4, null).state).toBe('drop')
    expect(radioReadoutIntensityArc({ ...m, begun: false }, 2, null).state).toBe('steady')
  })

  it('next: the drop, and the rows the breakdown rests', () => {
    expect(
      line({
        arc: { state: 'breakdown', count: 3, target: 3, dropInBars: 4 },
        nextChange: { rowId: 'a', kind: null, barsAway: 4, drop: true }
      })
    ).toBe('breakdown · drop in 4 bars · next: drop · 4 bars')
    const r = radioReadout(
      input({
        arc: { state: 'growing', count: 3, target: 3 },
        nextChange: { rowId: 'b', kind: null, barsAway: 2, rests: true }
      })
    )
    expect(r.statusLine).toBe('building ↑ 3 → 3 · next: row 2 rests · 2 bars')
    expect(r.rows[1].nextLabel).toBe('next · rests')
  })
})

describe('words', () => {
  it('are lowercase, and the row words fit the row', () => {
    for (const w of [
      RADIO_BUILD_WORD,
      RADIO_BUILDING_WORD,
      RADIO_DROP_WORD,
      RADIO_DROPPING_WORD,
      RADIO_BREAKDOWN_WORD,
      RADIO_ARC_REST_WORD,
      RADIO_ARC_REST_SHORT
    ]) {
      expect(w).toBe(w.toLowerCase())
      expect(w.length).toBeLessThanOrEqual(RADIO_ROLE_WORDS_MAX)
    }
    expect(RADIO_ARC_REST_WORD).toBe('rests till the drop')
  })

  it('the drop-out chips no longer say drop; a turn with a long lead keeps its gap', () => {
    expect(TURNAROUND_MOVE_LABEL['drum drop']).toBe('drums out')
    expect(TURNAROUND_MOVE_LABEL['low drop']).toBe('low out')
    expect(turnaroundLabel(['drum drop', 'lift', 'riser'], true)).toBe('drums out +2 → gap')
    expect(turnaroundLabel(['drum drop', 'lift', 'riser'], true, TURNAROUND_LABEL_MAX - 6)).toBe(
      'drums out → gap'
    )
    expect(
      radioReadout(
        input({
          armedTurnaround: {
            move: 'drum drop',
            isTurn: true,
            parts: ['drum drop', 'lift', 'riser'],
            gap: true
          }
        })
      ).ruler.end
    ).toBe('turn: drums out → gap')
  })
})
