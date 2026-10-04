import { describe, expect, it } from 'vitest'
import { segmentBarFills, segmentBarKey, segmentBarValueAt } from './radioSegmentBar'

describe('segmentBarFills', () => {
  it('is all dark at 0 and all lit at 100', () => {
    expect(segmentBarFills(0, 10)).toEqual(Array(10).fill(0))
    expect(segmentBarFills(100, 10)).toEqual(Array(10).fill(1))
  })
  it('fills the last lit cell partly', () => {
    expect(segmentBarFills(35, 10)).toEqual([1, 1, 1, 0.5, 0, 0, 0, 0, 0, 0])
  })
  it('clamps values outside the range and reads NaN as min', () => {
    expect(segmentBarFills(-20, 10)).toEqual(Array(10).fill(0))
    expect(segmentBarFills(250, 10)).toEqual(Array(10).fill(1))
    expect(segmentBarFills(NaN, 10)).toEqual(Array(10).fill(0))
  })
  it('honours a custom range', () => {
    expect(segmentBarFills(5, 2, 0, 10)).toEqual([1, 0])
    expect(segmentBarFills(-1, 2, -2, 2)).toEqual([0.5, 0])
  })
})

describe('segmentBarValueAt', () => {
  it('maps the ends and the middle', () => {
    expect(segmentBarValueAt(0, 200)).toBe(0)
    expect(segmentBarValueAt(200, 200)).toBe(100)
    expect(segmentBarValueAt(99, 200)).toBe(50)
  })
  it('clamps x outside the bar', () => {
    expect(segmentBarValueAt(-30, 200)).toBe(0)
    expect(segmentBarValueAt(500, 200)).toBe(100)
  })
  it('gives min for a zero width', () => {
    expect(segmentBarValueAt(10, 0)).toBe(0)
    expect(segmentBarValueAt(10, 0, { min: 5 })).toBe(5)
  })
  it('rounds to the step', () => {
    expect(segmentBarValueAt(47, 200, { step: 10 })).toBe(20)
    expect(segmentBarValueAt(60, 200, { step: 10 })).toBe(30)
  })
})

describe('segmentBarKey', () => {
  it('moves by 1, or 10 with Shift', () => {
    expect(segmentBarKey(50, 'ArrowRight', false)).toBe(51)
    expect(segmentBarKey(50, 'ArrowUp', false)).toBe(51)
    expect(segmentBarKey(50, 'ArrowLeft', false)).toBe(49)
    expect(segmentBarKey(50, 'ArrowDown', false)).toBe(49)
    expect(segmentBarKey(50, 'ArrowRight', true)).toBe(60)
    expect(segmentBarKey(50, 'ArrowDown', true)).toBe(40)
  })
  it('moves by 10 on PageUp/PageDown', () => {
    expect(segmentBarKey(50, 'PageUp', false)).toBe(60)
    expect(segmentBarKey(50, 'PageDown', false)).toBe(40)
  })
  it('goes to the ends on Home/End', () => {
    expect(segmentBarKey(50, 'Home', false)).toBe(0)
    expect(segmentBarKey(50, 'End', false)).toBe(100)
  })
  it('clamps, and is null when nothing would change', () => {
    expect(segmentBarKey(95, 'PageUp', false)).toBe(100)
    expect(segmentBarKey(100, 'ArrowRight', false)).toBeNull()
    expect(segmentBarKey(0, 'Home', false)).toBeNull()
    expect(segmentBarKey(5, 'ArrowLeft', true, { min: 0, max: 100 })).toBe(0)
  })
  it('ignores other keys', () => {
    expect(segmentBarKey(50, 'Tab', false)).toBeNull()
    expect(segmentBarKey(50, 'a', false)).toBeNull()
  })
})
