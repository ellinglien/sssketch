// Fold mode follows the pace slider, phase 2: a change on a folded row carries its fold, or
// releases it (radioFold.ts, radioFoldLanes.ts).
import { describe, expect, it } from 'vitest'
import {
  createRadioFold,
  radioFoldBarCompanions,
  radioFoldCanCarry,
  radioFoldCarry,
  radioFoldChangeCarries,
  radioFoldLand,
  radioFoldRelease,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldRowState,
  type RadioFoldStep
} from './radioFold'
import { radioFoldCycleRows } from './radioFoldLanes'
import { radioLandsMidLoop } from './radioSchedule'

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

/** `step` with its state's row `id` patched (and its cycle's length, if `cycleBeats` is). */
function withRow(step: RadioFoldStep, id: string, o: Partial<RadioFoldRowState>): RadioFoldStep {
  return {
    ...step,
    state: {
      ...step.state,
      rows: step.state.rows.map((r) => (r.rowId === id ? { ...r, ...o } : r))
    },
    cycles: step.cycles.map((c) =>
      c.rowId === id && o.cycleBeats !== undefined ? { ...c, cycleBeats: o.cycleBeats } : c
    )
  }
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

describe('radioFoldCanCarry, the edges', () => {
  it('a row walking back is never carried, by its mode alone or by its ask alone', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const anchor = step.anchorId
    const inc = R(id, { stemId: 'new' })
    expect(radioFoldCanCarry(withRow(step, id, { mode: 'unfolding' }).state, id, inc, anchor)).toBe(
      false
    )
    expect(
      radioFoldCanCarry(withRow(step, id, { unfoldSince: step.lap }).state, id, inc, anchor)
    ).toBe(false)
  })

  it('a straight stretch never carries: it has asked every fold to leave', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const straight = {
      ...step.state,
      stretch: 'straight' as const,
      rows: step.state.rows.map((r) => ({ ...r, unfoldSince: step.lap }))
    }
    expect(radioFoldCanCarry(straight, id, R(id, { stemId: 'new' }), step.anchorId)).toBe(false)
  })

  it('a refolding row carries', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const refolding = withRow(step, id, { mode: 'refolding' }).state
    expect(radioFoldCanCarry(refolding, id, R(id, { stemId: 'new' }), step.anchorId)).toBe(true)
  })

  it('a fractional length: an equal 1.5-bar stem carries, a shorter one does not', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const state = withRow(step, id, { fullBeats: 6, targetBeats: 5, cycleBeats: 5, path: [] }).state
    const anchor = step.anchorId
    expect(radioFoldCanCarry(state, id, R(id, { stemId: 'new', barLength: 1.5 }), anchor)).toBe(
      true
    )
    expect(radioFoldCanCarry(state, id, R(id, { stemId: 'new', barLength: 1.25 }), anchor)).toBe(
      false
    )
  })

  it('never onto the anchor, never for a row the machine does not hold, never across rows', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new' }), id)).toBe(false)
    const free = ['p', 'q'].find((x) => !step.state.rows.some((r) => r.rowId === x))!
    expect(radioFoldCanCarry(step.state, free, R(free, { stemId: 'new' }), step.anchorId)).toBe(
      false
    )
    expect(radioFoldCanCarry(step.state, id, R('other', { stemId: 'new' }), step.anchorId)).toBe(
      false
    )
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
    expect(row.targetBeats).toBe(32)
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

describe('radioFoldCarry guards its own invariant', () => {
  it('a take-back too short for what the fold has become releases it, never an overlong cycle', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    // an 8-bar stem carries the 4-bar row's fold, which then re-folds to 26 beats (longer than the
    // 4-bar stem); a take-back re-carrying the 4-bar stem must release the fold
    const longer = radioFoldCarry(step, id, `${id}-long`, 8)
    const refolded = withRow(longer, id, { cycleBeats: 26, targetBeats: 26, path: [] })
    const back = radioFoldCarry(refolded, id, `${id}-1`, 4)
    expect(back).toEqual(radioFoldRelease(refolded, id))
    expect(back.state.rows.some((r) => r.rowId === id)).toBe(false)
    expect(back.cycles.some((c) => c.rowId === id)).toBe(false)
    // still on its way to 26: the path alone is enough
    const onTheWay = withRow(longer, id, { mode: 'refolding', targetBeats: 26, path: [26] })
    expect(radioFoldCarry(onTheWay, id, `${id}-1`, 4).state.rows.some((r) => r.rowId === id)).toBe(
      false
    )
  })

  it('a walk back longer than the new stem is trimmed, so the unfold never passes its length', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const walked = withRow(step, id, { cycleBeats: 7, targetBeats: 7, path: [], walk: [13, 10, 7] })
    const carried = radioFoldCarry(walked, id, `${id}-short`, 2)
    expect(carried.state.rows.find((r) => r.rowId === id)?.walk).toEqual([7])
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

  it('clears a rotation the released row is part of, either end, and keeps any other', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const rotating = (rotate: { from: string; to: string }): RadioFoldStep => ({
      ...step,
      state: { ...step.state, rotate }
    })
    expect(radioFoldRelease(rotating({ from: id, to: 'x' }), id).state.rotate).toBeNull()
    expect(radioFoldRelease(rotating({ from: 'x', to: id }), id).state.rotate).toBeNull()
    expect(radioFoldRelease(rotating({ from: 'x', to: 'y' }), id).state.rotate).toEqual({
      from: 'x',
      to: 'y'
    })
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

describe("radioFoldChangeCarries (the runtimes' carry decision)", () => {
  it('in the band, on a held row, when radioFoldCanCarry says so against the latest state', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const incoming = R(id, { stemId: 'new' })
    expect(radioFoldChangeCarries(step.state, null, step, incoming, true)).toBe(true)
    // the row held only in the lap playing still counts as held
    expect(radioFoldChangeCarries(step.state, step, null, incoming, true)).toBe(true)
    // outside fold's bar band nothing carries
    expect(radioFoldChangeCarries(step.state, null, step, incoming, false)).toBe(false)
    // a row the machine does not hold, a stem too short, no machine
    expect(radioFoldChangeCarries(step.state, null, step, R('zz', { stemId: 'new' }), true)).toBe(
      false
    )
    expect(
      radioFoldChangeCarries(step.state, null, step, R(id, { stemId: 'new', barLength: 2 }), true)
    ).toBe(false)
    expect(radioFoldChangeCarries(null, null, null, incoming, true)).toBe(false)
    // never onto the anchor of the latest step
    const anchored = { ...step, anchorId: id }
    expect(radioFoldChangeCarries(step.state, null, anchored, incoming, true)).toBe(false)
  })
})

describe('radioFoldBarCompanions with a carry test (phase 2)', () => {
  it('a companion on a held row rides a bar line only when it carries', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const ks = [{ slotId: 'x' }, { slotId: id }]
    expect(radioFoldBarCompanions(ks, step, step, true, () => true)).toBe(ks)
    expect(radioFoldBarCompanions(ks, step, step, true, () => false)).toEqual([{ slotId: 'x' }])
    expect(radioFoldBarCompanions(ks, step, step, true, (s) => s !== id)).toEqual([{ slotId: 'x' }])
    // not active: the same array, whatever the test
    expect(radioFoldBarCompanions(ks, step, step, false, () => false)).toBe(ks)
  })
})

describe('radioFoldLand (a change landed on a row: carry, release or leave)', () => {
  it('carries the state and both steps together; nothing drawn', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const m = { state: step.state, now: step, next: step }
    const out = radioFoldLand(m, id, { stemId: 'new', barLength: 4, carry: true, release: true })
    expect(out.state?.rows.find((r) => r.rowId === id)?.stemId).toBe('new')
    expect(out.next?.cycles.find((c) => c.rowId === id)?.stemId).toBe('new')
    expect(out.now?.cycles.find((c) => c.rowId === id)?.stemId).toBe('new')
    expect(out.next?.cycles.find((c) => c.rowId === id)?.cycleId).toBe(
      step.cycles.find((c) => c.rowId === id)?.cycleId
    )
    expect(out.state?.draws).toBe(step.state.draws)
  })

  it('a straight landing on a held row releases it everywhere, when asked to', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const m = { state: step.state, now: step, next: step }
    const out = radioFoldLand(m, id, { stemId: 'new', barLength: 2, carry: false, release: true })
    expect(out.state?.rows.some((r) => r.rowId === id)).toBe(false)
    expect(out.now?.cycles.some((c) => c.rowId === id)).toBe(false)
    expect(out.next?.cycles.some((c) => c.rowId === id)).toBe(false)
    // not asked to release (a top below the band: the wrap's own step lets it go): unchanged
    expect(
      radioFoldLand(m, id, { stemId: 'new', barLength: 2, carry: false, release: false })
    ).toBe(m)
  })

  it('a carry the fold has outgrown since the decision releases it everywhere, never half', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    // the lap playing still at the old cycle, the next lap re-folded past a 1-bar stem
    const next = withRow(step, id, { cycleBeats: 7, targetBeats: 7, path: [] })
    const m = { state: next.state, now: step, next }
    const out = radioFoldLand(m, id, { stemId: 'new', barLength: 1, carry: true, release: false })
    expect(out.state?.rows.some((r) => r.rowId === id)).toBe(false)
    expect(out.now?.cycles.some((c) => c.rowId === id)).toBe(false)
    expect(out.next?.cycles.some((c) => c.rowId === id)).toBe(false)
  })

  it('a row the machine does not hold, or no machine at all: the same object', () => {
    const { step } = foldedStep()
    const m = { state: step.state, now: step, next: step }
    expect(
      radioFoldLand(m, 'nobody', { stemId: 'x', barLength: 4, carry: true, release: true })
    ).toBe(m)
    const none = { state: null, now: null, next: null }
    expect(
      radioFoldLand(none, 'p', { stemId: 'x', barLength: 4, carry: true, release: true })
    ).toBe(none)
  })

  it('a row held only in the state (no step names it yet) is carried there too', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const m = { state: step.state, now: null, next: null }
    const out = radioFoldLand(m, id, { stemId: 'new', barLength: 4, carry: true, release: true })
    expect(out.state?.rows.find((r) => r.rowId === id)?.stemId).toBe('new')
  })
})

describe('radioLandsMidLoop (which landing the readout shows companions for)', () => {
  it('a landing off every loop top is mid-loop; a top, none, or no loop is not', () => {
    expect(radioLandsMidLoop(1.5, 0.5, 4)).toBe(true)
    expect(radioLandsMidLoop(1.5, 2.5, 4)).toBe(false)
    expect(radioLandsMidLoop(3, 5, 4)).toBe(false)
    expect(radioLandsMidLoop(3, 6, 4)).toBe(true)
    expect(radioLandsMidLoop(1, null, 4)).toBe(false)
    expect(radioLandsMidLoop(1, 1, 0)).toBe(false)
  })
})
