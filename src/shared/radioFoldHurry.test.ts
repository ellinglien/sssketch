// Fold mode follows the pace slider: the machine's side (radioFold.ts) -- the realignment
// preference as an argument, the hurry, and the rows it holds.
import { describe, expect, it } from 'vitest'
import {
  FOLD_PREFER_WAIT_LAPS,
  createRadioFold,
  radioFoldHoldsRow,
  radioFoldIntervalBars,
  radioFoldPickableIds,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldStep
} from './radioFold'
import { hashText, seededRandom } from './seededRandom'

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

/** A settled fold on a 4-bar loop, bend 40: a drums anchor and two 4-bar rhythmic rows. */
function foldedStep(): RadioFoldStep {
  const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q')]
  let s = createRadioFold('autech')
  for (let k = 0; k < 300; k++) {
    const st = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 40 })
    s = st.state
    if (st.cycles.length > 0 && st.state.rows.some((r) => r.mode === 'settled')) return st
  }
  throw new Error('no fold settled')
}

describe('radioFoldIntervalBars preferWaitLaps', () => {
  it('0 is the draw itself; the default is FOLD_PREFER_WAIT_LAPS', () => {
    const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p')]
    let s = createRadioFold('autech')
    let snapped = false
    for (let k = 0; k < 200 && !snapped; k++) {
      s = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 40 }).state
      snapped = radioFoldIntervalBars(s, 4, 4) !== 4
    }
    expect(snapped).toBe(true)
    expect(radioFoldIntervalBars(s, 4, 4, 0, false, 0)).toBe(4)
    expect(radioFoldIntervalBars(s, 4, 4)).toBe(
      radioFoldIntervalBars(s, 4, 4, 0, false, FOLD_PREFER_WAIT_LAPS)
    )
  })
})

describe('stepRadioFold hurry', () => {
  // the trace's hash, recorded from radioFold.ts BEFORE the hurry was added (sssketch 8c07793)
  const BEFORE_HURRY = '0540eeea'
  function trace(hurry?: number): string {
    const row = (id: string, o: Partial<RadioFoldRow> = {}): RadioFoldRow =>
      R(id, { stemId: `${id}-a`, barLength: 2, ...o })
    const band = [
      row('drums', { kinds: ['drums'], barLength: 4 }),
      row('hats', { kinds: ['drums'], barLength: 1 }),
      row('perc'),
      row('clap', { barLength: 4 }),
      row('shaker', { barLength: 4 }),
      row('lead', { kinds: ['lead'], barLength: 4 })
    ]
    const out: string[] = []
    for (const seed of ['autech', 'k3x9pq', 'elling'])
      for (const bend of [0, 40, 55, 80, 100])
        for (const loopBars of [4, 8]) {
          let s = createRadioFold(seed)
          const churn = seededRandom(`churn-${seed}-${bend}-${loopBars}`)
          const rows = band.map((r) => ({ ...r }))
          for (let k = 0; k < 200; k++) {
            if (churn() < 0.15) {
              const i = Math.floor(churn() * rows.length)
              rows[i] = { ...rows[i], stemId: `${rows[i].id}-${k}` }
            }
            const st = stepRadioFold(s, {
              rows,
              loopBars,
              bpm: 120,
              fold: bend,
              ...(hurry !== undefined && { hurry })
            })
            s = st.state
            out.push(JSON.stringify([st.lap, st.marked, st.stretch, st.cycles, st.drift]))
          }
        }
    return out.join('\n')
  }

  it('no hurry, or a hurry of 0, draws and decides exactly what it did; a hurry does not', () => {
    expect(hashText(trace())).toBe(BEFORE_HURRY)
    expect(hashText(trace(0))).toBe(BEFORE_HURRY)
    expect(hashText(trace(1))).not.toBe(BEFORE_HURRY)
  })

  it('folds move more at full hurry than at none, from the same seed, and still fold', () => {
    const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q'), R('r')]
    const count = (hurry: number): { changes: number; folded: number } => {
      let s = createRadioFold('autech')
      let last = ''
      let changes = 0
      let folded = 0
      for (let k = 0; k < 400; k++) {
        const st = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 60, hurry })
        s = st.state
        const key = JSON.stringify(st.cycles.map((c) => [c.rowId, c.cycleId]))
        if (key !== last) changes++
        if (st.cycles.length > 0) folded++
        last = key
      }
      return { changes, folded }
    }
    const calm = count(0)
    const hurried = count(1)
    expect(hurried.changes).toBeGreaterThan(calm.changes * 1.5)
    expect(hurried.folded).toBeGreaterThan(0)
  })
})

describe('the rows the machine holds', () => {
  it('radioFoldHoldsRow reads both steps', () => {
    const step = foldedStep()
    const id = step.cycles[0].rowId
    expect(radioFoldHoldsRow(null, step, id)).toBe(true)
    expect(radioFoldHoldsRow(step, null, id)).toBe(true)
    expect(radioFoldHoldsRow(null, null, id)).toBe(false)
    expect(radioFoldHoldsRow(step, step, 'nobody')).toBe(false)
  })

  it('radioFoldPickableIds drops held rows when active, falls back to all, is the same array when not', () => {
    const step = foldedStep()
    const id = step.cycles[0].rowId
    const ids = ['d', 'p', 'q']
    expect(radioFoldPickableIds(ids, null, step, false)).toBe(ids)
    expect(radioFoldPickableIds(ids, null, step, true)).not.toContain(id)
    expect(radioFoldPickableIds([id], null, step, true)).toEqual([id])
  })
})
