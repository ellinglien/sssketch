import { describe, expect, it } from 'vitest'
import {
  COACH_SECTION_MAX_PASSES,
  COACH_SECTION_MIN_PASSES,
  COACH_SECTION_PASS_NUDGES,
  nudgeSectionPasses,
  passesForTargetBars,
  sectionBars
} from './coachPasses'

describe('the pass nudges', () => {
  it('are plus and minus one and two passes, in panel order', () => {
    expect([...COACH_SECTION_PASS_NUDGES]).toEqual([-2, -1, 1, 2])
  })

  it('clamps rather than running away', () => {
    expect(nudgeSectionPasses(COACH_SECTION_MIN_PASSES, -2)).toBe(COACH_SECTION_MIN_PASSES)
    expect(nudgeSectionPasses(COACH_SECTION_MAX_PASSES, 2)).toBe(COACH_SECTION_MAX_PASSES)
    expect(nudgeSectionPasses(4, 2)).toBe(6)
  })

  it('never goes below one pass -- a section of no passes is not a section', () => {
    expect(COACH_SECTION_MIN_PASSES).toBe(1)
  })
})

describe('passesForTargetBars', () => {
  it('rounds a target to the nearest whole number of passes', () => {
    expect(passesForTargetBars(16, 4)).toBe(4)
    expect(passesForTargetBars(16, 8)).toBe(2)
    expect(passesForTargetBars(16, 6)).toBe(3) // 2.67 -> 3
    expect(passesForTargetBars(8, 6)).toBe(1) // 1.33 -> 1
  })

  it('gives at least one pass even for a loop longer than the target', () => {
    expect(passesForTargetBars(8, 32)).toBe(1)
  })

  it('refuses to divide by a nonsense phrase length', () => {
    expect(passesForTargetBars(16, 0)).toBe(COACH_SECTION_MIN_PASSES)
  })
})

describe('sectionBars', () => {
  it('is simply the passes times the phrase', () => {
    expect(sectionBars(4, 4)).toBe(16)
    expect(sectionBars(3, 6)).toBe(18)
  })

  it('never returns zero, so nothing downstream divides by it', () => {
    expect(sectionBars(0, 0)).toBe(1)
  })
})
