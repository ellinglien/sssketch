import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_PARAMS,
  DEFAULT_REVERB,
  defaultFilterSettings,
  evaluateAutomation,
  isChannelToolkitNeutral,
  neutralCutoff,
  normaliseAutomationCurve,
  type ChannelFilterSettings
} from './toolkit'

describe('neutral defaults', () => {
  it('parks each mode at the end of the range where it does nothing', () => {
    expect(neutralCutoff('lowpass')).toBe(1)
    expect(neutralCutoff('highpass')).toBe(0)
    expect(defaultFilterSettings()).toEqual({ mode: 'lowpass', cutoff: 1, resonance: 0 })
    expect(defaultFilterSettings('highpass')).toEqual({ mode: 'highpass', cutoff: 0, resonance: 0 })
  })

  it('exposes exactly the four automatable parameters the design limits us to', () => {
    expect([...AUTOMATION_PARAMS]).toEqual([
      'filterCutoff',
      'filterResonance',
      'reverbSend',
      'volume'
    ])
  })

  it('has reverb defaults matching the engine-side ReverbSettings defaults', () => {
    // Hand-synced pair: native-engine/Source/ReverbBus.h.
    expect(DEFAULT_REVERB).toEqual({ roomSize: 0.5, damping: 0.5, preDelayMs: 20 })
  })
})

describe('isChannelToolkitNeutral', () => {
  it('treats a channel with nothing set at all as neutral', () => {
    expect(isChannelToolkitNeutral(undefined, undefined, undefined)).toBe(true)
    expect(isChannelToolkitNeutral(defaultFilterSettings(), 0, {})).toBe(true)
  })

  it('treats an empty curve as not-automated rather than as automation', () => {
    expect(isChannelToolkitNeutral(defaultFilterSettings(), 0, { volume: [] })).toBe(true)
  })

  it('is not neutral once the filter is moved off its own mode neutral end', () => {
    expect(isChannelToolkitNeutral({ mode: 'lowpass', cutoff: 0.5, resonance: 0 }, 0, {})).toBe(
      false
    )
    expect(isChannelToolkitNeutral({ mode: 'highpass', cutoff: 0.5, resonance: 0 }, 0, {})).toBe(
      false
    )
    // The OTHER mode's neutral end is not this one's.
    expect(isChannelToolkitNeutral({ mode: 'highpass', cutoff: 1, resonance: 0 }, 0, {})).toBe(
      false
    )
  })

  it('tolerates a slider parked a hair off its end stop', () => {
    const nearlyOpen: ChannelFilterSettings = { mode: 'lowpass', cutoff: 1 - 1e-9, resonance: 0 }
    expect(isChannelToolkitNeutral(nearlyOpen, 0, {})).toBe(true)
  })

  it('is not neutral with a send, or with any curve at all', () => {
    expect(isChannelToolkitNeutral(defaultFilterSettings(), 0.2, {})).toBe(false)
    for (const param of AUTOMATION_PARAMS) {
      expect(
        isChannelToolkitNeutral(defaultFilterSettings(), 0, {
          [param]: [{ bar: 0, value: 0.5 }]
        })
      ).toBe(false)
    }
  })

  it('never calls a non-finite cutoff neutral', () => {
    expect(isChannelToolkitNeutral({ mode: 'lowpass', cutoff: NaN, resonance: 0 }, 0, {})).toBe(
      false
    )
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
