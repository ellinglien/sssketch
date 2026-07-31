import { describe, expect, it } from 'vitest'
import { applyFade } from './fadeGain'

interface Call {
  method: 'setValueAtTime' | 'linearRampToValueAtTime'
  value: number
  time: number
}

function fakeParam(): { calls: Call[]; param: Parameters<typeof applyFade>[0] } {
  const calls: Call[] = []
  return {
    calls,
    param: {
      setValueAtTime: (value: number, time: number) => {
        calls.push({ method: 'setValueAtTime', value, time })
      },
      linearRampToValueAtTime: (value: number, time: number) => {
        calls.push({ method: 'linearRampToValueAtTime', value, time })
      }
    }
  }
}

const config = { fadeInBars: 1, fadeOutBars: 1, secPerBar: 2 } // 2 sec/bar -> 2 sec fades

describe('applyFade', () => {
  it('schedules a fade-in ramp at a fresh first segment', () => {
    const { calls, param } = fakeParam()
    applyFade(param, 10, 8, true, false, true, config)
    expect(calls).toEqual([
      { method: 'setValueAtTime', value: 0, time: 10 },
      { method: 'linearRampToValueAtTime', value: 1, time: 12 } // 10 + 2s fade
    ])
  })

  it('schedules a fade-out ramp at the last segment', () => {
    const { calls, param } = fakeParam()
    applyFade(param, 10, 8, false, true, true, config)
    expect(calls).toEqual([
      { method: 'setValueAtTime', value: 1, time: 16 }, // endTime(18) - 2s
      { method: 'linearRampToValueAtTime', value: 0, time: 18 }
    ])
  })

  it('schedules both when a single segment is both first and last', () => {
    const { calls, param } = fakeParam()
    applyFade(param, 0, 8, true, true, true, config)
    expect(calls).toHaveLength(4)
  })

  it('does nothing for a middle segment (neither first nor last)', () => {
    const { calls, param } = fakeParam()
    applyFade(param, 10, 8, false, false, true, config)
    expect(calls).toHaveLength(0)
  })

  it('skips fade-in when resuming mid-segment, but still applies fade-out', () => {
    const { calls, param } = fakeParam()
    applyFade(param, 10, 8, true, true, false, config)
    expect(calls).toEqual([
      { method: 'setValueAtTime', value: 1, time: 16 },
      { method: 'linearRampToValueAtTime', value: 0, time: 18 }
    ])
  })

  it('clamps an oversized fade to half the segment duration, never overlapping', () => {
    const { calls, param } = fakeParam()
    // fadeInBars/fadeOutBars imply 2s each, but duration is only 2s total -> each
    // fade clamps to 1s (half), landing back-to-back with no overlap.
    applyFade(param, 0, 2, true, true, true, config)
    expect(calls).toEqual([
      { method: 'setValueAtTime', value: 0, time: 0 },
      { method: 'linearRampToValueAtTime', value: 1, time: 1 },
      { method: 'setValueAtTime', value: 1, time: 1 },
      { method: 'linearRampToValueAtTime', value: 0, time: 2 }
    ])
  })

  it('still applies a tiny (3ms) anti-click floor even when fade bars are zero', () => {
    const { calls, param } = fakeParam()
    applyFade(param, 0, 8, true, true, true, { fadeInBars: 0, fadeOutBars: 0, secPerBar: 2 })
    expect(calls).toEqual([
      { method: 'setValueAtTime', value: 0, time: 0 },
      { method: 'linearRampToValueAtTime', value: 1, time: 0.003 },
      { method: 'setValueAtTime', value: 1, time: 7.997 },
      { method: 'linearRampToValueAtTime', value: 0, time: 8 }
    ])
  })

  it("the anti-click floor never shortens a user's own larger configured fade", () => {
    const { calls, param } = fakeParam()
    applyFade(param, 0, 8, true, true, true, config)
    expect(calls).toHaveLength(4)
    expect(calls[1].time).toBe(2) // still the full 2s fade-in, not clamped down to 3ms
    expect(calls[2].time).toBe(6)
  })
})
