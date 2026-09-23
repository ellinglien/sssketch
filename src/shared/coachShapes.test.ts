import { describe, expect, it } from 'vitest'
import {
  COACH_LOOP_ANSWERS,
  COACH_LOOP_HOME_TYPE,
  COACH_SHAPES,
  coachShapeDef,
  isCoachLoopAnswer,
  isCoachShapeId,
  shapeSectionTypes,
  targetBarsFor
} from './coachShapes'

describe('the three shapes', () => {
  it('are exactly the spec table, in its own letters', () => {
    expect(COACH_SHAPES.map((shape) => [shape.id, shape.letters.join(' ')])).toEqual([
      ['short', 'A B D A'],
      ['standard', 'A B C D B C D A'],
      ['long', 'A B C D E C D A']
    ])
  })

  it('carry the rough durations the spec quotes', () => {
    expect(COACH_SHAPES.map((shape) => shape.approxMinutes)).toEqual([2, 4, 6])
  })

  it('turn the last A into an outro and the first into an intro', () => {
    expect(shapeSectionTypes('short')).toEqual(['intro', 'verse', 'drop', 'outro'])
    expect(shapeSectionTypes('standard')).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'verse',
      'build',
      'drop',
      'outro'
    ])
    expect(shapeSectionTypes('long')).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'breakdown',
      'build',
      'drop',
      'outro'
    ])
  })

  it('refuses a shape id it does not know', () => {
    expect(isCoachShapeId('standard')).toBe(true)
    expect(isCoachShapeId('epic')).toBe(false)
    expect(coachShapeDef('long').letters).toHaveLength(8)
  })
})

describe('the target bar counts', () => {
  it('follow the article: verse 16 then longer, build 8, drop 16', () => {
    expect(targetBarsFor('verse', 0)).toBe(16)
    expect(targetBarsFor('verse', 1)).toBe(24)
    expect(targetBarsFor('build', 0)).toBe(8)
    expect(targetBarsFor('build', 1)).toBe(8)
    expect(targetBarsFor('drop', 0)).toBe(16)
    expect(targetBarsFor('intro', 0)).toBe(8)
    expect(targetBarsFor('outro', 0)).toBe(8)
  })

  it('holds the last figure for a section beyond the table', () => {
    expect(targetBarsFor('verse', 9)).toBe(24)
  })
})

describe('what is this loop', () => {
  it('offers four answers, unsure included', () => {
    expect([...COACH_LOOP_ANSWERS]).toEqual(['drop', 'verse', 'intro', 'unsure'])
    expect(isCoachLoopAnswer('unsure')).toBe(true)
    expect(isCoachLoopAnswer('chorus')).toBe(false)
  })

  it('lands unsure on the drop, which is where the method puts the material', () => {
    expect(COACH_LOOP_HOME_TYPE.unsure).toBe('drop')
    expect(COACH_LOOP_HOME_TYPE.verse).toBe('verse')
  })
})
