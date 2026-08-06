import { describe, expect, it } from 'vitest'
import { snapToWholeBarIfNearlyExact, BAR_LENGTH_SNAP_EPSILON } from './barLengthSnap'

describe('snapToWholeBarIfNearlyExact', () => {
  it('snaps sample-quantization noise to the exact whole number (real confirmed example)', () => {
    expect(snapToWholeBarIfNearlyExact(16.000003184020517)).toBe(16)
  })

  it('snaps noise just under a whole number too', () => {
    expect(snapToWholeBarIfNearlyExact(7.999998)).toBe(8)
  })

  it('leaves an already-exact whole number untouched', () => {
    expect(snapToWholeBarIfNearlyExact(16)).toBe(16)
  })

  it('leaves a genuinely fractional, deliberately tempo-compensated barLength untouched', () => {
    expect(snapToWholeBarIfNearlyExact(7.75)).toBe(7.75)
  })

  it('does not snap a value just outside the epsilon boundary', () => {
    const justOutside = 16 + BAR_LENGTH_SNAP_EPSILON * 2
    expect(snapToWholeBarIfNearlyExact(justOutside)).toBe(justOutside)
  })
})
