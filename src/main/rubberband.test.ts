import { describe, expect, it } from 'vitest'
import { cacheKey } from './rubberband'

describe('cacheKey', () => {
  it('is deterministic for the same path and ratio', () => {
    expect(cacheKey('/x/a.wav', 0.6667)).toBe(cacheKey('/x/a.wav', 0.6667))
  })

  it('differs when the ratio differs', () => {
    expect(cacheKey('/x/a.wav', 0.6667)).not.toBe(cacheKey('/x/a.wav', 0.75))
  })

  it('differs when the path differs', () => {
    expect(cacheKey('/x/a.wav', 0.6667)).not.toBe(cacheKey('/x/b.wav', 0.6667))
  })

  it('quantizes ratio to 4 decimal places, so finer differences collide', () => {
    expect(cacheKey('/x/a.wav', 0.666666)).toBe(cacheKey('/x/a.wav', 0.666674))
  })

  it('always produces a .wav filename', () => {
    expect(cacheKey('/x/a.wav', 1.5)).toMatch(/^[0-9a-f]{40}\.wav$/)
  })
})
