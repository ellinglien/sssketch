import { describe, expect, it } from 'vitest'
import {
  COACH_DONE_LINES,
  COACH_NO_MOVES_LINES,
  COACH_SEEDED_LINE_TEMPLATES,
  COACH_STEP_SATISFIED_LINES,
  COACH_STUCK_LINES,
  pickLineVariant
} from './coachLines'

describe('pickLineVariant', () => {
  const variants = ['one', 'two', 'three']

  it('picks by seed, not at random -- the same seed always gives the same line', () => {
    expect(pickLineVariant(variants, 0)).toBe('one')
    expect(pickLineVariant(variants, 0)).toBe('one')
    expect(pickLineVariant(variants, 1)).toBe('two')
    expect(pickLineVariant(variants, 2)).toBe('three')
  })

  it('wraps around the table', () => {
    expect(pickLineVariant(variants, 3)).toBe('one')
    expect(pickLineVariant(variants, 7)).toBe('two')
  })

  it('survives a negative seed rather than returning undefined', () => {
    expect(pickLineVariant(variants, -1)).toBe('three')
  })

  it('returns an empty string for an empty table rather than throwing', () => {
    expect(pickLineVariant([], 3)).toBe('')
  })
})

describe('the shared line tables', () => {
  const tables = [
    COACH_STUCK_LINES,
    COACH_NO_MOVES_LINES,
    COACH_DONE_LINES,
    COACH_STEP_SATISFIED_LINES,
    COACH_SEEDED_LINE_TEMPLATES
  ]

  it('each give at least three variants', () => {
    for (const table of tables) expect(table.length).toBeGreaterThanOrEqual(3)
  })

  it('obey the copy rules: lowercase start, no emoji, no exclamation marks', () => {
    for (const table of tables) {
      for (const line of table) {
        expect(line).not.toMatch(/!/)
        expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(line[0]).toBe(line[0].toLowerCase())
      }
    }
  })

  it('never claims to have an opinion about the music', () => {
    for (const table of tables) {
      for (const line of table) {
        expect(line).not.toMatch(/it looks like/i)
        expect(line).not.toMatch(/your track needs/i)
      }
    }
  })
})

describe('the seeded-start templates', () => {
  it('each name both the roles already covered and the step that follows', () => {
    for (const template of COACH_SEEDED_LINE_TEMPLATES) {
      expect(template).toContain('{covered}')
      expect(template).toContain('{next}')
    }
  })
})
