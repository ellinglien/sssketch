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
  FOLD_UNFOLD_MAX_WAIT_LAPS,
  type RadioFoldRow,
  type RadioFoldState,
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

/** A drums anchor and one 4-bar row settled at 5.5 beats on a 4-bar loop since lap 0: it realigns
 * only every 11 laps (32 half-beats a lap against 11), so nothing but the wait ends it early. */
function settledAt(stretch: 'straight' | 'folded', stretchEndsLap: number): RadioFoldState {
  return {
    ...createRadioFold('autech'),
    lap: 0,
    loopBeats: 16,
    bpm: 120,
    stretch,
    stretchEndsLap,
    rows: [
      {
        rowId: 'p',
        stemId: 'p-1',
        fullBeats: 16,
        targetBeats: 5.5,
        cycleBeats: 5.5,
        phaseBeats: 0,
        originLap: 0,
        path: [],
        mode: 'settled',
        unfoldSince: stretch === 'straight' ? 0 : null,
        serial: 1
      }
    ],
    serial: 1
  }
}
const SETTLED_ROWS = [R('d', { kinds: ['drums'], percussive: true }), R('p')]

describe('the unfold wait', () => {
  it('unhurried, a fold asked to leave waits exactly FOLD_UNFOLD_MAX_WAIT_LAPS laps, no more', () => {
    let s = settledAt('straight', 1000)
    const modes: string[] = []
    for (let k = 0; k < FOLD_UNFOLD_MAX_WAIT_LAPS + 1; k++) {
      s = stepRadioFold(s, { rows: SETTLED_ROWS, loopBars: 4, bpm: 120, fold: 40, hurry: 0 }).state
      modes.push(`${s.lap}:${s.rows.find((r) => r.rowId === 'p')?.mode ?? 'gone'}`)
    }
    const at = (lap: number): string | undefined => modes.find((m) => m.startsWith(`${lap}:`))
    expect(at(FOLD_UNFOLD_MAX_WAIT_LAPS - 1)).toBe(`${FOLD_UNFOLD_MAX_WAIT_LAPS - 1}:settled`)
    expect(at(FOLD_UNFOLD_MAX_WAIT_LAPS)).toBe(`${FOLD_UNFOLD_MAX_WAIT_LAPS}:unfolding`)
  })

  it('at full hurry, an unfold starts in the very step it is asked for', () => {
    const input = { rows: SETTLED_ROWS, loopBars: 4, bpm: 120, fold: 40 }
    // the folded stretch ends on lap 1: that step asks the fold to leave
    const calm = stepRadioFold(settledAt('folded', 1), { ...input, hurry: 0 }).state
    expect(calm.rows[0]).toMatchObject({ unfoldSince: 1, mode: 'settled' })
    const hurried = stepRadioFold(settledAt('folded', 1), { ...input, hurry: 1 }).state
    expect(hurried.rows[0]).toMatchObject({ unfoldSince: 1, mode: 'unfolding' })
  })
})

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

  it('marked is the true realignment: the same with or without a hurry, from the same state', () => {
    const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q'), R('r')]
    let s = createRadioFold('autech')
    let marks = 0
    for (let k = 0; k < 400; k++) {
      const input = { rows, loopBars: 4, bpm: 120, fold: 60 }
      const calm = stepRadioFold(s, { ...input, hurry: 0 })
      const hurried = stepRadioFold(s, { ...input, hurry: 1 })
      expect(hurried.marked).toBe(calm.marked)
      expect(hurried.state.marked).toBe(calm.state.marked)
      if (calm.marked) marks++
      s = (k % 2 === 0 ? hurried : calm).state
    }
    expect(marks).toBeGreaterThan(0)
  })

  it('the machine decides more, never less, as the hurry rises', () => {
    // Its decisions -- a fold entering, a new target or phase, an unfold starting -- not every
    // cycle change: the hurry also cuts the steps a fold walks through, which alone would count
    // fewer changes in the middle of the range.
    const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q'), R('r')]
    const decisions = (hurry: number): number => {
      let n = 0
      for (const seed of ['autech', 'k3x9pq', 'elling', 'nickel'])
        for (const fold of [40, 60, 80]) {
          let s = createRadioFold(seed)
          let last = ''
          for (let k = 0; k < 400; k++) {
            s = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold, hurry }).state
            const key = JSON.stringify(
              s.rows.map((r) => [r.rowId, r.targetBeats, r.phaseBeats, r.mode === 'unfolding'])
            )
            if (key !== last) n++
            last = key
          }
        }
      return n
    }
    const counts = [0, 0.25, 0.5, 0.75, 1].map(decisions)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1])
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
