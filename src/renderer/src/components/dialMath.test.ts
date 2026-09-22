import { describe, expect, it } from 'vitest'
import { dialValueAfterDrag, dialValueAfterWheel, dialAngleDeg, dialArcPath } from './dialMath'

describe('dialValueAfterDrag', () => {
  it('dragging up increases, dragging down decreases', () => {
    expect(dialValueAfterDrag(50, -30)).toBeGreaterThan(50)
    expect(dialValueAfterDrag(50, 30)).toBeLessThan(50)
  })

  it('a full 150px drag sweeps the whole 0-100 range', () => {
    expect(dialValueAfterDrag(0, -150)).toBe(100)
  })

  it('clamps and rounds to whole numbers', () => {
    expect(dialValueAfterDrag(90, -500)).toBe(100)
    expect(dialValueAfterDrag(10, 500)).toBe(0)
    expect(Number.isInteger(dialValueAfterDrag(40, -7))).toBe(true)
  })
})

describe('dialValueAfterWheel', () => {
  it('scrolling up (negative deltaY) increases by one step, clamped', () => {
    expect(dialValueAfterWheel(50, -12)).toBe(52)
    expect(dialValueAfterWheel(50, 12)).toBe(48)
    expect(dialValueAfterWheel(99, -12)).toBe(100)
    expect(dialValueAfterWheel(1, 12)).toBe(0)
  })
})

describe('dialAngleDeg', () => {
  it('sweeps 270 degrees, from -135 (min) through 0 (middle) to 135 (max)', () => {
    expect(dialAngleDeg(0)).toBe(-135)
    expect(dialAngleDeg(50)).toBe(0)
    expect(dialAngleDeg(100)).toBe(135)
  })
})

describe('dialArcPath', () => {
  it('is empty at 0 (nothing to fill) and a valid SVG arc otherwise', () => {
    expect(dialArcPath(0, 10)).toBe('')
    expect(dialArcPath(50, 10)).toMatch(/^M [\d.-]+ [\d.-]+ A 10 10 0 [01] 1 [\d.-]+ [\d.-]+$/)
  })

  it('uses the large-arc flag only past 180 degrees of sweep', () => {
    expect(dialArcPath(60, 10)).toMatch(/A 10 10 0 0 1/)
    expect(dialArcPath(90, 10)).toMatch(/A 10 10 0 1 1/)
  })
})
