import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { CoachSection } from './coachSections'
import {
  coachSetupLine,
  coachWalkLine,
  endCoachWalk,
  sanitiseCoachWalkIndex,
  startCoachWalk,
  walkCoachTo
} from './coachWalk'

const T0 = 1_000

function section(id: string, type: CoachSection['type'], name: string): CoachSection {
  return { id, type, name, passes: 2, cells: {}, startBar: 0, placedGroupIds: {} }
}

function flowWith(sections: CoachSection[]): CoachState {
  return { ...startCoach(T0), sections }
}

const THREE = [
  section('a', 'intro', 'intro'),
  section('b', 'verse', 'verse'),
  section('c', 'drop', 'drop')
]

describe('starting the walk', () => {
  it('stands him on the first section', () => {
    expect(startCoachWalk(flowWith(THREE), T0).walkIndex).toBe(0)
  })

  it('refuses to start on a map that does not exist yet', () => {
    expect(startCoachWalk(flowWith([]), T0).walkIndex).toBeNull()
  })

  it('puts him on the arrangement step, wherever he was', () => {
    const state = { ...flowWith(THREE), stepId: 'p3-balance' as const }
    expect(startCoachWalk(state, T0).stepId).toBe('p2-section')
  })
})

describe('walking', () => {
  it('moves to the section asked for and rotates the line', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    const next = walkCoachTo(walking, T0 + 10, 1)
    expect(next.walkIndex).toBe(1)
    expect(next.lineSeed).toBe(walking.lineSeed + 1)
  })

  it('ends the walk when asked to step past the last section', () => {
    const walking = walkCoachTo(startCoachWalk(flowWith(THREE), T0), T0, 2)
    const past = walkCoachTo(walking, T0 + 10, 3)
    expect(past.walkIndex).toBeNull()
  })

  it('refuses to step before the first section rather than wrapping', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(walkCoachTo(walking, T0 + 10, -1).walkIndex).toBe(0)
  })

  it('does not move the clock backwards when nothing changed', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(walkCoachTo(walking, T0 + 10, 0)).toBe(walking)
  })
})

describe('leaving the walk', () => {
  it('KEEPS THE MAP -- sections are untouched', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    const left = endCoachWalk(walking, T0 + 10)
    expect(left.walkIndex).toBeNull()
    expect(left.sections).toEqual(THREE)
  })

  it('leaves a flow that was not walking exactly as it was', () => {
    const state = flowWith(THREE)
    expect(endCoachWalk(state, T0)).toBe(state)
  })
})

describe('coachWalkLine', () => {
  it('says what the section he is standing on is FOR', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(coachWalkLine(walking)).not.toBeNull()
  })

  it('says something different about a verse than about a drop', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(coachWalkLine(walkCoachTo(walking, T0, 1))).not.toBe(
      coachWalkLine(walkCoachTo(walking, T0, 2))
    )
  })

  it('is deterministic on the seed, never random', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(coachWalkLine(walking)).toBe(coachWalkLine(walking))
  })

  it('varies two sections of the SAME type, so a walk does not repeat itself', () => {
    const twoVerses = flowWith([section('a', 'verse', 'verse'), section('b', 'verse', 'verse 2')])
    const walking = startCoachWalk(twoVerses, T0)
    expect(coachWalkLine(walking)).not.toBe(coachWalkLine(walkCoachTo(walking, T0, 1)))
  })

  it('says NOTHING when he is not walking', () => {
    expect(coachWalkLine(flowWith(THREE))).toBeNull()
  })
})

describe('coachSetupLine', () => {
  it('asks what the loop is until that is answered', () => {
    const line = coachSetupLine(startCoach(T0))
    expect(line).not.toBeNull()
    expect(line).toContain('loop')
  })

  it('asks about length once the loop is answered', () => {
    const answered = { ...startCoach(T0), loopIs: 'drop' as const }
    expect(coachSetupLine(answered)).not.toBe(coachSetupLine(startCoach(T0)))
  })

  it('says NOTHING once both are answered -- the phrase report speaks for itself', () => {
    const both = { ...startCoach(T0), loopIs: 'drop' as const, shape: 'standard' as const }
    expect(coachSetupLine(both)).toBeNull()
  })

  it('says NOTHING once a map exists', () => {
    const built = { ...flowWith(THREE), loopIs: 'drop' as const }
    expect(coachSetupLine(built)).toBeNull()
  })
})

describe('the load repair', () => {
  it('drops an index that names no section', () => {
    expect(sanitiseCoachWalkIndex(7, 3)).toBeNull()
    expect(sanitiseCoachWalkIndex(-1, 3)).toBeNull()
    expect(sanitiseCoachWalkIndex('two', 3)).toBeNull()
    expect(sanitiseCoachWalkIndex(1, 3)).toBe(1)
  })
})
