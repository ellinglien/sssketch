// Fold mode follows the pace slider, phase 2: a change on a folded row carries its fold, or
// releases it (radioFold.ts, radioFoldLanes.ts).
import { describe, expect, it } from 'vitest'
import {
  createRadioFold,
  radioFoldCanCarry,
  radioFoldCarry,
  radioFoldRelease,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldStep
} from './radioFold'
import { radioFoldCycleRows } from './radioFoldLanes'

const R = (id: string, o: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-1`,
  kinds: ['rhythmic'],
  barLength: 4,
  hooked: false,
  audible: true,
  percussive: false,
  ...o
})

function foldedStep(): { step: RadioFoldStep; rows: RadioFoldRow[] } {
  const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q')]
  let s = createRadioFold('autech')
  for (let k = 0; k < 300; k++) {
    const st = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 40 })
    s = st.state
    if (st.cycles.length > 0 && st.state.rows.some((r) => r.mode === 'settled'))
      return { step: st, rows }
  }
  throw new Error('no fold settled')
}

describe('radioFoldCanCarry', () => {
  it("only a foldable stem at least as long as the fold's own carries it", () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const anchor = step.anchorId
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new' }), anchor)).toBe(true)
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new', barLength: 2 }), anchor)).toBe(
      false
    )
    expect(
      radioFoldCanCarry(step.state, id, R(id, { stemId: 'new', kinds: ['lead'] }), anchor)
    ).toBe(false)
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new', hooked: true }), anchor)).toBe(
      false
    )
    expect(radioFoldCanCarry(null, id, R(id, { stemId: 'new' }), anchor)).toBe(false)
    const leaving = {
      ...step.state,
      rows: step.state.rows.map((r) => (r.rowId === id ? { ...r, unfoldSince: step.lap } : r))
    }
    expect(radioFoldCanCarry(leaving, id, R(id, { stemId: 'new' }), anchor)).toBe(false)
  })
})

describe('radioFoldCarry', () => {
  it('keeps the cycle id and runs on with the new stem; nothing is drawn', () => {
    const { step, rows } = foldedStep()
    const id = step.cycles[0].rowId
    const carried = radioFoldCarry(step, id, `${id}-2`, 4)
    expect(carried.cycles.find((c) => c.rowId === id)).toEqual({
      ...step.cycles.find((c) => c.rowId === id),
      stemId: `${id}-2`
    })
    expect(carried.state.draws).toBe(step.state.draws)
    // the next step keeps the fold for the new stem; an uncarried change would leave it
    const nextRows = rows.map((r) => (r.id === id ? { ...r, stemId: `${id}-2` } : r))
    const kept = stepRadioFold(carried.state, { rows: nextRows, loopBars: 4, bpm: 120, fold: 40 })
    expect(kept.state.rows.some((r) => r.rowId === id && r.stemId === `${id}-2`)).toBe(true)
    const dropped = stepRadioFold(step.state, { rows: nextRows, loopBars: 4, bpm: 120, fold: 40 })
    expect(dropped.state.rows.some((r) => r.rowId === id)).toBe(false)
    expect(radioFoldCarry(step, 'nobody', 'x', 4)).toBe(step)
  })

  it('a carry after the row started unfolding walks back to the new full length', () => {
    const { step, rows } = foldedStep()
    const id = step.cycles[0].rowId
    const unfolding: RadioFoldStep = {
      ...step,
      state: {
        ...step.state,
        rows: step.state.rows.map((r) =>
          r.rowId === id ? { ...r, mode: 'unfolding', unfoldSince: step.lap, path: [12, 16] } : r
        )
      }
    }
    const carried = radioFoldCarry(unfolding, id, `${id}-2`, 8)
    const row = carried.state.rows.find((r) => r.rowId === id)!
    expect(row.path).toEqual([12, 32])
    expect(row.fullBeats).toBe(32)
    // the machine runs on cleanly: the row walks out to full length and leaves, never stuck
    const nextRows = rows.map((r) => (r.id === id ? { ...r, stemId: `${id}-2`, barLength: 8 } : r))
    let s = carried.state
    for (let k = 0; k < 4; k++) {
      s = stepRadioFold(s, { rows: nextRows, loopBars: 4, bpm: 120, fold: 40 }).state
      const r = s.rows.find((x) => x.rowId === id)
      if (r === undefined) break
      expect(r.cycleBeats).toBeLessThan(r.fullBeats)
      expect(r.stemId).toBe(`${id}-2`)
    }
  })
})

describe('radioFoldRelease', () => {
  it('the row leaves the state and the cycles, marked is recomputed, nothing drawn', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const out = radioFoldRelease(step, id)
    expect(out.cycles.some((c) => c.rowId === id)).toBe(false)
    expect(out.state.rows.some((r) => r.rowId === id)).toBe(false)
    expect(out.marked).toBe(false)
    expect(out.state.draws).toBe(step.state.draws)
    expect(radioFoldRelease(step, 'nobody')).toBe(step)
  })
})

describe('radioFoldCycleRows carried', () => {
  it('names a carried row for its incoming stem; a changing row not carried stays unnamed', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const members = [{ id, stemId: 'incoming' }]
    expect(radioFoldCycleRows([step], members, new Set([id])).has(id)).toBe(false)
    expect(radioFoldCycleRows([step], members, new Set([id]), new Set([id])).has(id)).toBe(true)
    expect(radioFoldCycleRows([step], [{ id, stemId: step.cycles[0].stemId }]).has(id)).toBe(true)
  })
})
