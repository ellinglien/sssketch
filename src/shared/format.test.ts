import { describe, expect, it } from 'vitest'
import { formatBpm } from './format'

describe('formatBpm', () => {
  it('strips floating-point noise beyond 2 decimals', () => {
    expect(formatBpm(89.9000015258789)).toBe('89.9')
  })

  it('leaves a whole number without a trailing decimal point', () => {
    expect(formatBpm(150)).toBe('150')
  })

  it('keeps a genuine 2-decimal value intact', () => {
    expect(formatBpm(120.55)).toBe('120.55')
  })

  it('rounds a 3rd-decimal value to 2 places', () => {
    expect(formatBpm(116.994)).toBe('116.99')
  })
})
