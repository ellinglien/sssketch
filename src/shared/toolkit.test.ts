import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_PARAM_LABEL,
  AUTOMATION_PARAMS,
  averageAutomationValue,
  DEFAULT_REVERB,
  defaultFilterSettings,
  evaluateAutomation,
  isStemToolkitNeutral,
  neutralCutoff,
  normaliseAutomationCurve,
  type StemFilterSettings
} from './toolkit'

describe('neutral defaults', () => {
  it('parks each mode at the end of the range where it does nothing', () => {
    expect(neutralCutoff('lowpass')).toBe(1)
    expect(neutralCutoff('highpass')).toBe(0)
    expect(defaultFilterSettings()).toEqual({ mode: 'lowpass', cutoff: 1, resonance: 0 })
    expect(defaultFilterSettings('highpass')).toEqual({ mode: 'highpass', cutoff: 0, resonance: 0 })
  })

  it('exposes exactly the three DRAWABLE parameters the design limits us to', () => {
    expect([...AUTOMATION_PARAMS]).toEqual(['filterCutoff', 'reverbSend', 'volume'])
  })

  it('does not offer resonance as something to draw -- it is a per-clip dial', () => {
    // The whole point of the rescope: a resonance curve is inaudible unless
    // a cutoff curve is moving, so there is ONE filter lane with a
    // resonance knob in its corner rather than two lanes.
    expect([...AUTOMATION_PARAMS]).not.toContain('filterResonance')
    expect(AUTOMATION_PARAM_LABEL.filterCutoff).toBe('filter')
  })

  it('labels every automatable parameter, in this app lowercase UI copy', () => {
    for (const param of AUTOMATION_PARAMS) {
      const label = AUTOMATION_PARAM_LABEL[param]
      expect(label).toBeTruthy()
      expect(label).toBe(label.toLowerCase())
    }
  })

  it('has reverb defaults matching the engine-side ReverbSettings defaults', () => {
    // Hand-synced pair: native-engine/Source/ReverbBus.h.
    expect(DEFAULT_REVERB).toEqual({ roomSize: 0.5, damping: 0.5, preDelayMs: 20 })
  })
})

describe('isStemToolkitNeutral', () => {
  it('treats a channel with nothing set at all as neutral', () => {
    expect(isStemToolkitNeutral(undefined, undefined, undefined)).toBe(true)
    expect(isStemToolkitNeutral(defaultFilterSettings(), 0, {})).toBe(true)
  })

  it('treats an empty curve as not-automated rather than as automation', () => {
    expect(isStemToolkitNeutral(defaultFilterSettings(), 0, { volume: [] })).toBe(true)
  })

  it('is not neutral once the filter is moved off its own mode neutral end', () => {
    expect(isStemToolkitNeutral({ mode: 'lowpass', cutoff: 0.5, resonance: 0 }, 0, {})).toBe(false)
    expect(isStemToolkitNeutral({ mode: 'highpass', cutoff: 0.5, resonance: 0 }, 0, {})).toBe(false)
    // The OTHER mode's neutral end is not this one's.
    expect(isStemToolkitNeutral({ mode: 'highpass', cutoff: 1, resonance: 0 }, 0, {})).toBe(false)
  })

  it('tolerates a slider parked a hair off its end stop', () => {
    const nearlyOpen: StemFilterSettings = { mode: 'lowpass', cutoff: 1 - 1e-9, resonance: 0 }
    expect(isStemToolkitNeutral(nearlyOpen, 0, {})).toBe(true)
  })

  it('is not neutral with a send, or with any curve at all', () => {
    expect(isStemToolkitNeutral(defaultFilterSettings(), 0.2, {})).toBe(false)
    for (const param of AUTOMATION_PARAMS) {
      expect(
        isStemToolkitNeutral(defaultFilterSettings(), 0, {
          [param]: [{ bar: 0, value: 0.5 }]
        })
      ).toBe(false)
    }
  })

  it('stays neutral for a clip whose only setting is a raised resonance dial', () => {
    // Not an oversight: resonance is a peak AT the cutoff corner, so with
    // the cutoff parked wide open there is no corner in the audible range
    // for it to sharpen and the clip sounds exactly as it would untouched.
    // The value is still stored and saved -- it starts mattering the moment
    // a cutoff curve exists.
    expect(isStemToolkitNeutral({ mode: 'lowpass', cutoff: 1, resonance: 0.8 }, 0, {})).toBe(true)
    expect(
      isStemToolkitNeutral({ mode: 'lowpass', cutoff: 1, resonance: 0.8 }, 0, {
        filterCutoff: [{ bar: 0, value: 0.2 }]
      })
    ).toBe(false)
  })

  it('never calls a non-finite cutoff neutral', () => {
    expect(isStemToolkitNeutral({ mode: 'lowpass', cutoff: NaN, resonance: 0 }, 0, {})).toBe(false)
  })
})

describe('normaliseAutomationCurve', () => {
  it('sorts by bar, clamps values and drops non-finite points', () => {
    expect(
      normaliseAutomationCurve([
        { bar: 8, value: 3 },
        { bar: 2, value: -1 },
        { bar: 4, value: 0.5 },
        { bar: NaN, value: 0.5 },
        { bar: 6, value: Infinity }
      ])
    ).toEqual([
      { bar: 2, value: 0 },
      { bar: 4, value: 0.5 },
      { bar: 8, value: 1 }
    ])
  })

  it('keeps two points on the same bar in the order they were drawn', () => {
    // That order is what makes a vertical step read as "jump to the later
    // value" -- see evaluateAutomation below.
    expect(
      normaliseAutomationCurve([
        { bar: 4, value: 0 },
        { bar: 4, value: 1 }
      ])
    ).toEqual([
      { bar: 4, value: 0 },
      { bar: 4, value: 1 }
    ])
  })

  it('leaves an already-clean curve alone', () => {
    const clean = [
      { bar: 0, value: 0 },
      { bar: 4, value: 1 }
    ]
    expect(normaliseAutomationCurve(clean)).toEqual(clean)
  })
})

describe('evaluateAutomation', () => {
  // Deliberately the same cases as AutomationCurveTests.cpp -- these two
  // implementations must agree or the drawn line disagrees with what is
  // heard.
  it('falls back for an empty curve', () => {
    expect(evaluateAutomation([], 4, 0.25)).toBe(0.25)
  })

  it('interpolates linearly between breakpoints', () => {
    const points = [
      { bar: 0, value: 0 },
      { bar: 8, value: 1 }
    ]
    expect(evaluateAutomation(points, 0, -1)).toBe(0)
    expect(evaluateAutomation(points, 4, -1)).toBe(0.5)
    expect(evaluateAutomation(points, 6, -1)).toBe(0.75)
    expect(evaluateAutomation(points, 8, -1)).toBe(1)
  })

  it('holds flat before the first point and after the last', () => {
    const points = [
      { bar: 4, value: 0.2 },
      { bar: 8, value: 0.8 }
    ]
    expect(evaluateAutomation(points, 0, -1)).toBe(0.2)
    expect(evaluateAutomation(points, 1000, -1)).toBe(0.8)
  })

  it('steps to the later value where two points share a bar', () => {
    const points = [
      { bar: 0, value: 0 },
      { bar: 4, value: 0 },
      { bar: 4, value: 1 },
      { bar: 8, value: 1 }
    ]
    expect(evaluateAutomation(points, 2, -1)).toBe(0)
    expect(evaluateAutomation(points, 4, -1)).toBe(1)
  })

  it('lands on an exact breakpoint value rather than interpolating past it', () => {
    const points = [
      { bar: 0, value: 0 },
      { bar: 4, value: 1 },
      { bar: 8, value: 0.5 }
    ]
    expect(evaluateAutomation(points, 4, -1)).toBe(1)
  })

  it('falls back for a non-finite position instead of silently reading the last point', () => {
    const points = [
      { bar: 0, value: 0 },
      { bar: 8, value: 1 }
    ]
    expect(evaluateAutomation(points, NaN, 0.42)).toBe(0.42)
  })

  it('treats a single point as a constant', () => {
    expect(evaluateAutomation([{ bar: 4, value: 0.3 }], 0, -1)).toBe(0.3)
    expect(evaluateAutomation([{ bar: 4, value: 0.3 }], 99, -1)).toBe(0.3)
  })
})

describe('averageAutomationValue', () => {
  it('returns the fallback for an empty curve', () => {
    expect(averageAutomationValue([])).toBe(0)
    expect(averageAutomationValue([], 0.4)).toBe(0.4)
  })

  it('weights by BARS, not by how many points a stroke happened to leave', () => {
    // 0.9 for one bar, then 0.1 held for nine -- crowded points at the
    // start must not outvote the long plateau. A plain mean of the four
    // values would say 0.4; the honest answer is much nearer 0.1.
    const value = averageAutomationValue([
      { bar: 0, value: 0.9 },
      { bar: 0.5, value: 0.9 },
      { bar: 1, value: 0.1 },
      { bar: 10, value: 0.1 }
    ])
    // 0.9 held for half a bar, the ramp down over the next half, then the
    // 0.1 plateau for nine -- trapezoids, over the curve's own 10-bar span.
    expect(value).toBeCloseTo((0.45 + 0.25 + 0.9) / 10, 10)
    expect(value).toBeLessThan(0.25)
  })

  it('averages a straight ramp to its midpoint', () => {
    expect(
      averageAutomationValue([
        { bar: 0, value: 0 },
        { bar: 8, value: 1 }
      ])
    ).toBeCloseTo(0.5, 10)
  })

  it('falls back to a plain mean when the curve has no span to weight by', () => {
    expect(averageAutomationValue([{ bar: 3, value: 0.7 }])).toBeCloseTo(0.7, 10)
    expect(
      averageAutomationValue([
        { bar: 3, value: 0.2 },
        { bar: 3, value: 0.8 }
      ])
    ).toBeCloseTo(0.5, 10)
  })

  it('survives the kind of curve only a hand-edited project file has', () => {
    expect(
      averageAutomationValue([
        { bar: NaN, value: 0.5 },
        { bar: 4, value: 5 },
        { bar: 0, value: -3 }
      ])
    ).toBeCloseTo(0.5, 10)
  })
})
