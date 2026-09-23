import { describe, expect, it } from 'vitest'
import {
  COACH_DONE_LINES,
  COACH_NEXT_SECTION_LINE_TEMPLATES,
  COACH_NO_MOVES_LINES,
  COACH_PHRASE_LINE_TEMPLATES,
  COACH_PREFILLED_LINE_TEMPLATES,
  COACH_SECTION_LINE_TEMPLATES,
  COACH_STEP_SATISFIED_LINES,
  COACH_STUCK_LINES,
  COACH_TENSION_LINE_TEMPLATES,
  COACH_TENSION_NONE_LINES,
  COACH_V1_EXPORTED_LINES,
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
    COACH_PHRASE_LINE_TEMPLATES,
    COACH_PREFILLED_LINE_TEMPLATES,
    COACH_SECTION_LINE_TEMPLATES,
    COACH_NEXT_SECTION_LINE_TEMPLATES,
    COACH_TENSION_LINE_TEMPLATES,
    COACH_TENSION_NONE_LINES,
    COACH_V1_EXPORTED_LINES
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

describe('the section templates', () => {
  it('each name the section they are about', () => {
    for (const template of [
      ...COACH_SECTION_LINE_TEMPLATES,
      ...COACH_NEXT_SECTION_LINE_TEMPLATES
    ]) {
      expect(template).toContain('{section}')
    }
  })

  it('never pre-announce a change the user has not made', () => {
    // The everything-on rule, in the copy: nothing here may say a stem has
    // been removed, because nothing has been.
    for (const template of COACH_SECTION_LINE_TEMPLATES) {
      expect(template).not.toMatch(/i (removed|took out|dropped)/i)
    }
  })
})

describe('the arrangement-map tables', () => {
  it('give the phrase report both numbers to fill in', () => {
    for (const template of COACH_PHRASE_LINE_TEMPLATES) {
      expect(template).toContain('{nominal}')
      expect(template).toContain('{phrase}')
    }
  })

  it('never tell the user what to do about the phrase -- it is a fact, not an instruction', () => {
    for (const template of COACH_PHRASE_LINE_TEMPLATES) {
      expect(template).not.toMatch(/you should|you need to|you must/i)
    }
  })

  it('make every pre-fill line state who made the call AND the way out', () => {
    // Elling's condition for the pre-fill being allowed at all (spec).
    for (const line of COACH_PREFILLED_LINE_TEMPLATES) {
      expect(line).toMatch(/cmd\+z|undo/i)
    }
  })
})

describe('the phase-three tables', () => {
  it('give the tension line a {joins} slot to fill', () => {
    for (const line of COACH_TENSION_LINE_TEMPLATES) expect(line).toContain('{joins}')
  })

  it('never claim the track is finished, only that a file came out', () => {
    for (const line of COACH_V1_EXPORTED_LINES) {
      expect(line).not.toMatch(/\bgood\b|\bgreat\b|\bnice\b|\bsounds\b/)
    }
  })
})
