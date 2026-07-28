import { describe, expect, it } from 'vitest'
import { sqrtGain } from './mixGain'

describe('sqrtGain', () => {
  it('leaves a single source at unity gain', () => {
    expect(sqrtGain(1)).toBe(1)
    expect(sqrtGain(0)).toBe(1)
  })

  it('attenuates by 1/sqrt(N) for multiple sources', () => {
    expect(sqrtGain(4)).toBeCloseTo(0.5, 10)
    expect(sqrtGain(9)).toBeCloseTo(1 / 3, 10)
  })
})
