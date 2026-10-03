import { describe, expect, it } from 'vitest'
import { createRadioFold, stepRadioFold, type RadioFoldStep } from './radioFold'
import {
  radioFoldCycleRows,
  radioFoldDriftCurves,
  radioFoldEngineRows,
  radioFoldSound
} from './radioFoldLanes'
import { normalizeSoundSettings } from './radioSound'

const step = (cycles: RadioFoldStep['cycles']): RadioFoldStep => ({
  ...stepRadioFold(createRadioFold('k3x9pq'), { rows: [], loopBars: 4, bpm: 120, fold: 0 }),
  cycles
})
const perc = { rowId: 'perc', stemId: 'p1', cycleId: 'perc~3', cycleBeats: 7, phaseBeats: 0.25 }

describe('radioFoldEngineRows', () => {
  it('turns beats into bars, row and cycle ids kept', () => {
    expect(radioFoldEngineRows(step([perc]))).toEqual([
      { row: 'perc', id: 'perc~3', bars: 1.75, phaseBars: 0.0625 }
    ])
    expect(radioFoldEngineRows(null)).toEqual([])
  })
})

describe('radioFoldCycleRows', () => {
  it('names a row only while it plays the stem its fold was decided for', () => {
    const members = [
      { id: 'perc', stemId: 'p1' },
      { id: 'hats', stemId: 'h1' }
    ]
    expect([...radioFoldCycleRows([step([perc])], members)]).toEqual(['perc'])
    expect([...radioFoldCycleRows([step([perc])], [{ id: 'perc', stemId: 'p2' }])]).toEqual([])
    expect([...radioFoldCycleRows([null, step([perc])], members)]).toEqual(['perc'])
  })

  it('never names a row whose stem a staged swap is replacing', () => {
    expect([
      ...radioFoldCycleRows([step([perc])], [{ id: 'perc', stemId: 'p1' }], new Set(['perc']))
    ]).toEqual([])
  })
})

describe('radioFoldDriftCurves', () => {
  it("holds each parameter flat at the lap's own value; the send sits on the row's own, never past 1", () => {
    const c = radioFoldDriftCurves({ cutoff: [1, 0.9], send: [0.1, 0], dub: [0.05, 0.1] }, 4, 0.95)
    expect(c.cutoff).toEqual([
      { bar: 0, value: 1 },
      { bar: 4, value: 1 }
    ])
    expect(c.send).toEqual([
      { bar: 0, value: 1 },
      { bar: 4, value: 1 }
    ])
    expect(c.dub).toEqual([
      { bar: 0, value: 0.05 },
      { bar: 4, value: 0.05 }
    ])
  })

  it('a push landing late on a top leaves one step, the size of one lap of drift', () => {
    // the engine replays lap n's lanes from bar 0 until lap n+1's land: flat lanes mean the
    // value heard at the top is lap n's, then lap n+1's -- one step, never back and forth
    const lapN = radioFoldDriftCurves({ cutoff: [0.9, 0.88], send: [0, 0], dub: [0, 0] }, 16, 0)
    const lapN1 = radioFoldDriftCurves({ cutoff: [0.88, 0.86], send: [0, 0], dub: [0, 0] }, 16, 0)
    const heard = [lapN.cutoff[1].value, lapN.cutoff[0].value, lapN1.cutoff[0].value]
    expect(heard[1]).toBe(heard[0])
    expect(Math.abs(heard[2] - heard[1])).toBeCloseTo(0.02, 12)
  })
})

describe('radioFoldSound', () => {
  it('leans glue and saturation in above clash 50, mode on only', () => {
    const s = normalizeSoundSettings(undefined)
    expect(radioFoldSound(s, true, 40)).toBe(s)
    expect(radioFoldSound(s, false, 100)).toBe(s)
    const leaned = radioFoldSound(s, true, 100)
    expect(leaned.glue.amount).toBeCloseTo(s.glue.amount + 0.15)
    expect(leaned.saturation.amount).toBeCloseTo(s.saturation.amount + 0.15)
    expect(leaned.glue.on).toBe(s.glue.on)
  })
})
