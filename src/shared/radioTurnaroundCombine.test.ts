import { describe, expect, it } from 'vitest'
import { buildDropOutCurve } from './radioDropOut'
import { buildBloomCurve, buildDuckCurve, buildFilterInCurve } from './radioTransition'
import {
  combineRadioCurves,
  radioTransitionUnderTurnaround,
  radioTurnaroundGate,
  turnaroundLiftCurve,
  turnaroundToLoopBars,
  turnaroundWashCurve,
  turnaroundWashSend
} from './radioTurnaround'
import type { AutomationPoint } from './toolkit'

function close(actual: AutomationPoint[], expected: AutomationPoint[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p.bar).toBeCloseTo(expected[i].bar, 9)
    expect(p.value).toBeCloseTo(expected[i].value, 9)
  })
}

describe('combineRadioCurves', () => {
  const drop = buildDropOutCurve(8, 4) // [{0,1},{7,1},{7.02,0},{8,0}]
  const duck = buildDuckCurve(8, 1) // [{0,0.45},{1,1}]

  it('multiplies volume, so a turnaround never cancels a duck, a hole or an arc exit', () => {
    close(combineRadioCurves(drop, duck, 'volume'), [
      { bar: 0, value: 0.45 },
      { bar: 1, value: 1 },
      { bar: 7, value: 1 },
      { bar: 7.02, value: 0 },
      { bar: 8, value: 0 }
    ])
  })

  it('keeps a step where either curve steps', () => {
    const stepping = [
      { bar: 0, value: 1 },
      { bar: 2, value: 1 },
      { bar: 2, value: 0 },
      { bar: 4, value: 0 }
    ]
    const half = [
      { bar: 0, value: 0.5 },
      { bar: 4, value: 0.5 }
    ]
    expect(combineRadioCurves(stepping, half, 'volume')).toEqual([
      { bar: 0, value: 0.5 },
      { bar: 2, value: 0.5 },
      { bar: 2, value: 0 },
      { bar: 4, value: 0 }
    ])
  })

  it('takes the larger send at each point', () => {
    const bloom = buildBloomCurve(8, 1) // [{0,0.7},{1,0}]
    const wash = turnaroundToLoopBars(turnaroundWashSend(turnaroundWashCurve(4), 0.2), 8)
    close(combineRadioCurves(bloom, wash, 'reverbSend'), [
      { bar: 0, value: 0.7 },
      { bar: 1, value: 0.2 },
      { bar: 7, value: 0.2 },
      { bar: 8, value: 0.85 }
    ])
  })

  it('keeps the filter curve already there: a row in a filter in is skipped by filter moves', () => {
    const sweep = buildFilterInCurve(8, 1)
    const lift = turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 8)
    expect(combineRadioCurves(sweep, lift, 'filterCutoff')).toEqual(sweep)
    expect(combineRadioCurves([], lift, 'filterCutoff')).toEqual(lift)
  })

  it('an empty side is no curve', () => {
    expect(combineRadioCurves([], duck, 'volume')).toEqual(duck)
    expect(combineRadioCurves(duck, [], 'reverbSend')).toEqual(duck)
    expect(combineRadioCurves([], [], 'volume')).toEqual([])
  })

  it('leaves its inputs alone', () => {
    const a = buildDropOutCurve(8, 4)
    const b = buildDuckCurve(8, 1)
    combineRadioCurves(a, b, 'volume')
    expect(a).toEqual(buildDropOutCurve(8, 4))
    expect(b).toEqual(buildDuckCurve(8, 1))
  })
})

describe('radioTransitionUnderTurnaround', () => {
  it("turns a change's lead-in into a cut: the turnaround is its lead-in", () => {
    expect(radioTransitionUnderTurnaround('hole')).toBe('cut')
    expect(radioTransitionUnderTurnaround('riser')).toBe('cut')
  })

  it('keeps an arrival', () => {
    for (const kind of ['cut', 'filter in', 'bloom', 'duck'] as const) {
      expect(radioTransitionUnderTurnaround(kind)).toBe(kind)
    }
  })
})

describe('radioTurnaroundGate', () => {
  it('waits while the roll at the wrap that starts a phrase is still to come', () => {
    // A lead-in drawn on that tick would arm first, and the roll keeps an armed lead-in -- the
    // turnaround would never play on the wrap it collides with most.
    expect(radioTurnaroundGate(true, false)).toBe('wait')
    expect(radioTurnaroundGate(true, true)).toBe('wait')
  })

  it('keeps only an arrival under an armed turnaround', () => {
    expect(radioTurnaroundGate(false, true)).toBe('arrival')
  })

  it('leaves the draw alone with no turnaround', () => {
    expect(radioTurnaroundGate(false, false)).toBe('any')
  })
})
