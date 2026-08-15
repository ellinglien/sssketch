import { describe, expect, it } from 'vitest'
import { linearToMeterFraction, nextMeterValue } from './meterBallistics'

describe('linearToMeterFraction', () => {
  it('maps 0 (silence) to 0', () => {
    expect(linearToMeterFraction(0)).toBe(0)
  })

  it('maps 1 (0dBFS, full scale) to 1', () => {
    expect(linearToMeterFraction(1)).toBeCloseTo(1, 5)
  })

  it('maps a value at the -60dB floor to 0', () => {
    const atFloor = Math.pow(10, -60 / 20)
    expect(linearToMeterFraction(atFloor)).toBeCloseTo(0, 3)
  })

  it('maps -20dB (a normal, non-silent level) to roughly 2/3 up the scale, not near-empty', () => {
    const minus20dB = Math.pow(10, -20 / 20)
    const fraction = linearToMeterFraction(minus20dB)
    // -20dB is 40dB above the -60dB floor, out of a 60dB range -- 40/60 = ~0.667.
    // The point of this test: a LINEAR mapping would put this at 0.1 (near-empty),
    // which is exactly the "meter looks dead during normal use" problem the log
    // scale exists to avoid.
    expect(fraction).toBeGreaterThan(0.6)
    expect(fraction).toBeLessThan(0.7)
  })

  it('never returns a negative value for a peak quieter than the floor', () => {
    expect(linearToMeterFraction(0.00001)).toBeGreaterThanOrEqual(0)
  })

  it('never returns more than 1 for a peak louder than 0dBFS (clipping input)', () => {
    expect(linearToMeterFraction(1.5)).toBeLessThanOrEqual(1)
  })
})

describe('nextMeterValue', () => {
  it('jumps up instantly to a louder reading', () => {
    const next = nextMeterValue(0.1, 0.8, 16)
    expect(next).toBe(0.8)
  })

  it('holds steady when the new reading equals the current value', () => {
    const next = nextMeterValue(0.5, 0.5, 16)
    expect(next).toBe(0.5)
  })

  it('eases down toward a quieter reading rather than snapping to it instantly', () => {
    const next = nextMeterValue(0.8, 0.1, 16)
    expect(next).toBeLessThan(0.8)
    expect(next).toBeGreaterThan(0.1)
  })

  it('reaches (or gets very close to) the quieter target after enough elapsed time', () => {
    // Decay window is ~300-500ms -- 1000ms of elapsed time should fully settle.
    const next = nextMeterValue(0.8, 0.1, 1000)
    expect(next).toBeCloseTo(0.1, 2)
  })

  it('decaying toward 0 (silence) eventually reaches exactly 0, not an asymptote that never lands', () => {
    let value = 1.0
    for (let i = 0; i < 50; i++) {
      value = nextMeterValue(value, 0, 100)
    }
    expect(value).toBe(0)
  })
})
