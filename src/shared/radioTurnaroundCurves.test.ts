import { describe, expect, it } from 'vitest'
import { buildDropOutCurve } from './radioDropOut'
import {
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  TURNAROUND_WASH_PEAK,
  turnaroundDipCurve,
  turnaroundDropCurve,
  turnaroundFitsLoop,
  turnaroundLiftCurve,
  turnaroundToLoopBars,
  turnaroundWashCurve,
  turnaroundWashSend,
  type TurnaroundPlan,
  type TurnaroundPoint
} from './radioTurnaround'

function close(actual: TurnaroundPoint[], expected: TurnaroundPoint[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p.beats).toBeCloseTo(expected[i].beats, 9)
    expect(p.value).toBeCloseTo(expected[i].value, 9)
  })
}

describe('the spec numbers', () => {
  it('lifts to 0.6, dips to 0.35, washes to 0.85', () => {
    expect([TURNAROUND_LIFT_TOP, TURNAROUND_DIP_FLOOR, TURNAROUND_WASH_PEAK]).toEqual([
      0.6, 0.35, 0.85
    ])
  })
})

describe('turnaroundDropCurve', () => {
  it('is buildDropOutCurve counted back from the wrap, silent into it and full on the one', () => {
    // leaves 2 beats out, silent 0.02 bars (0.08 beats) later, back to 1 exactly on the one
    close(turnaroundDropCurve(8, 2), [
      { beats: 2, value: 1 },
      { beats: 1.92, value: 0 },
      { beats: 0, value: 0 },
      { beats: 0, value: 1 }
    ])
  })

  it('is empty when buildDropOutCurve cannot place it', () => {
    expect(turnaroundDropCurve(0, 2)).toEqual([])
    expect(turnaroundDropCurve(8, 0)).toEqual([])
  })
})

describe('the filter and wash curves', () => {
  it('a lift is a high-pass from open to the top, open again on the one', () => {
    expect(turnaroundLiftCurve(8)).toEqual({
      mode: 'highpass',
      cutoff: [
        { beats: 8, value: 0 },
        { beats: 0, value: 0.6 },
        { beats: 0, value: 0 }
      ]
    })
  })

  it('a dip is a low-pass from open down to the floor, open again on the one', () => {
    expect(turnaroundDipCurve(4)).toEqual({
      mode: 'lowpass',
      cutoff: [
        { beats: 4, value: 1 },
        { beats: 0, value: 0.35 },
        { beats: 0, value: 1 }
      ]
    })
  })

  it("a wash is relative: a mix from the row's own send (0) to the peak (1), and back", () => {
    expect(turnaroundWashCurve(4)).toEqual({
      peak: 0.85,
      points: [
        { beats: 4, value: 0 },
        { beats: 0, value: 1 },
        { beats: 0, value: 0 }
      ]
    })
  })

  it('takes other numbers where the depth asks for them', () => {
    expect(turnaroundLiftCurve(4, 0.35).cutoff[1].value).toBe(0.35)
    expect(turnaroundDipCurve(4, 0.6).cutoff[1].value).toBe(0.6)
    expect(turnaroundWashCurve(4, 0.6).peak).toBe(0.6)
  })
})

describe('turnaroundWashSend', () => {
  it("rises from the row's own send to the peak, and back to its own on the one", () => {
    close(turnaroundWashSend(turnaroundWashCurve(4), 0.25), [
      { beats: 4, value: 0.25 },
      { beats: 0, value: 0.85 },
      { beats: 0, value: 0.25 }
    ])
  })

  it('never dips a send already above the peak', () => {
    close(turnaroundWashSend(turnaroundWashCurve(4), 0.9), [
      { beats: 4, value: 0.9 },
      { beats: 0, value: 0.9 },
      { beats: 0, value: 0.9 }
    ])
  })

  it('treats an unreadable send as 0', () => {
    close(turnaroundWashSend(turnaroundWashCurve(4), Number.NaN), [
      { beats: 4, value: 0 },
      { beats: 0, value: 0.85 },
      { beats: 0, value: 0 }
    ])
  })
})

describe('turnaroundToLoopBars', () => {
  it('gives back buildDropOutCurve exactly, in clip-relative bars of the lap', () => {
    const back = turnaroundToLoopBars(turnaroundDropCurve(8, 2), 8)
    const want = buildDropOutCurve(8, 2)
    expect(back).toHaveLength(want.length)
    back.forEach((p, i) => {
      expect(p.bar).toBeCloseTo(want[i].bar, 9)
      expect(p.value).toBe(want[i].value)
    })
  })

  it('rests at bar 0, and puts the move into the wrap; the step on the one is the lap wrapping', () => {
    expect(turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 8)).toEqual([
      { bar: 0, value: 0 },
      { bar: 7, value: 0 },
      { bar: 8, value: 0.6 }
    ])
    expect(turnaroundToLoopBars(turnaroundDipCurve(4).cutoff, 8)).toEqual([
      { bar: 0, value: 1 },
      { bar: 7, value: 1 },
      { bar: 8, value: 0.35 }
    ])
  })

  it('is empty for no points or no loop', () => {
    expect(turnaroundToLoopBars([], 8)).toEqual([])
    expect(turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 0)).toEqual([])
  })

  // A plan capped against one loop, put on a lane of another (a landing at the wrap that starts
  // a phrase's last lap shortened the loop): never a move past half the loop, never a bar < 0.
  it('is empty for a curve longer than the cap of the loop it is put on', () => {
    // 4 beats fits an 8-bar loop's cap (16) and a 2-bar loop's (4), not a 1-bar loop's (2)
    expect(turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 2)).toHaveLength(3)
    expect(turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 1)).toEqual([])
    // 16 beats (4 bars, capped against a 16-bar loop) on a 3-bar loop: past half of it
    expect(turnaroundToLoopBars(turnaroundDropCurve(16, 16), 3)).toEqual([])
    // longer than the whole loop: would have been negative bars, a drop silent all lap
    expect(turnaroundToLoopBars(turnaroundDropCurve(16, 8), 1)).toEqual([])
  })

  it('never emits a negative bar', () => {
    for (const loopBars of [0.5, 1, 2, 3, 4, 5, 8, 16]) {
      for (const beats of [1, 2, 4, 8, 16]) {
        for (const p of turnaroundToLoopBars(turnaroundDropCurve(16, beats), loopBars)) {
          expect(p.bar).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('turnaroundFitsLoop', () => {
  const plan = (beats: number): TurnaroundPlan => ({ move: 'lift', beats, halvings: 0, rows: [] })
  it('is whether the move fits min(half the loop, 4 bars) of the loop it plays in', () => {
    expect(turnaroundFitsLoop(plan(16), 8)).toBe(true)
    expect(turnaroundFitsLoop(plan(16), 16)).toBe(true)
    expect(turnaroundFitsLoop(plan(8), 4)).toBe(true)
    expect(turnaroundFitsLoop(plan(8), 3)).toBe(false)
    expect(turnaroundFitsLoop(plan(4), 1)).toBe(false)
    expect(turnaroundFitsLoop(plan(2), 1)).toBe(true)
    expect(turnaroundFitsLoop(plan(1), 0)).toBe(false)
  })
})
