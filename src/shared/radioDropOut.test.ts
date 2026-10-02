import { describe, expect, it } from 'vitest'
import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'

/** A deterministic generator that walks a fixed list and then repeats it. */
function seeded(values: number[]): () => number {
  let i = 0
  return (): number => values[i++ % values.length]
}

describe('how long a drop-out is', () => {
  it('is two beats most of the time, one or four sometimes', () => {
    // weights 0.2 / 0.5 / 0.3 over [1, 2, 4]
    expect(pickDropOutBeats(seeded([0.1]))).toBe(1)
    expect(pickDropOutBeats(seeded([0.5]))).toBe(2)
    expect(pickDropOutBeats(seeded([0.8]))).toBe(4)
    expect(pickDropOutBeats(seeded([0.9999]))).toBe(4)
  })
})

describe('the drop-out curve', () => {
  it('returns to full gain at bar 0 -- the top of the loop IS the anchor', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[0]).toEqual({ bar: 0, value: 1 })
  })

  it('leaves two beats before the wrap on an 8-bar loop', () => {
    // 2 beats of a 4/4 bar = 0.5 bars, so full gain holds to bar 7.5.
    const curve = buildDropOutCurve(8, 2)
    expect(curve[1]).toEqual({ bar: 7.5, value: 1 })
  })

  it('ramps down rather than stepping -- a hard gain step on a sounding source pops', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[2].bar).toBeGreaterThan(7.5)
    expect(curve[2].bar).toBeLessThan(7.55)
    expect(curve[2].value).toBe(0)
  })

  it('holds silence right through to the wrap', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[curve.length - 1]).toEqual({ bar: 8, value: 0 })
  })

  it('measures a one-beat and a four-beat drop backwards from the same wrap', () => {
    expect(buildDropOutCurve(8, 1)[1].bar).toBe(7.75)
    expect(buildDropOutCurve(8, 4)[1].bar).toBe(7)
  })

  it('works on a short loop', () => {
    const curve = buildDropOutCurve(2, 2)
    expect(curve[0]).toEqual({ bar: 0, value: 1 })
    expect(curve[1]).toEqual({ bar: 1.5, value: 1 })
    expect(curve[curve.length - 1]).toEqual({ bar: 2, value: 0 })
  })

  it('refuses to drop more than half the loop', () => {
    // A 4-beat drop on a 1-bar loop would silence the whole lap. Clamped
    // to half, the same rule FadeGain.cpp:33-51 already applies to fades.
    const curve = buildDropOutCurve(1, 4)
    expect(curve[1].bar).toBe(0.5)
  })

  it('returns an empty curve for a loop it cannot place a gesture in', () => {
    expect(buildDropOutCurve(0, 2)).toEqual([])
    expect(buildDropOutCurve(8, 0)).toEqual([])
  })

  it('is ascending in bar, which is what normaliseAutomationCurve expects', () => {
    const curve = buildDropOutCurve(8, 2)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].bar).toBeGreaterThan(curve[i - 1].bar)
    }
  })
})
