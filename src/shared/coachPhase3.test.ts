import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { CoachSection } from './coachSections'
import {
  applyCoachTension,
  clearCoachTension,
  coachBoundaries,
  coachPhase3Line,
  markCoachV1Exported
} from './coachPhase3'

function sections(): CoachSection[] {
  return [
    {
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: [],
      startBar: 0,
      placedGroupIds: {}
    },
    {
      type: 'drop',
      name: 'drop',
      bars: 16,
      droppedPaths: [],
      startBar: 16,
      placedGroupIds: {}
    }
  ]
}

function flow(over: Partial<CoachState> = {}): CoachState {
  return { ...startCoach(1000), stepId: 'p3-tension', sections: sections(), ...over }
}

describe('applyCoachTension', () => {
  it('records the move without touching the clock or the line', () => {
    const before = flow()
    const after = applyCoachTension(before, 0, 'filter-sweep', null)
    expect(after.tension).toEqual([{ sectionIndex: 0, kind: 'filter-sweep', riserId: null }])
    expect(after.stepElapsedMs).toBe(before.stepElapsedMs)
    expect(after.runningSince).toBe(before.runningSince)
    expect(after.lineSeed).toBe(before.lineSeed)
    expect(after.stepId).toBe(before.stepId)
  })

  it('keeps the riser id, so taking it off removes exactly that riser', () => {
    const after = applyCoachTension(flow(), 0, 'riser', 'riser-a')
    expect(after.tension).toEqual([{ sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }])
  })

  it('is idempotent -- a second apply of the same move changes nothing', () => {
    const once = applyCoachTension(flow(), 0, 'swell', null)
    expect(applyCoachTension(once, 0, 'swell', null)).toBe(once)
  })

  it('ignores a boundary that is not there rather than storing a dangling one', () => {
    const before = flow()
    expect(applyCoachTension(before, 9, 'swell', null)).toBe(before)
  })
})

describe('clearCoachTension', () => {
  it('takes exactly one move off, leaving the others', () => {
    let state = applyCoachTension(flow(), 0, 'swell', null)
    state = applyCoachTension(state, 0, 'riser', 'riser-a')
    const after = clearCoachTension(state, 0, 'swell')
    expect(after.tension).toEqual([{ sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }])
  })

  it('returns the state untouched when that move was never on', () => {
    const before = flow()
    expect(clearCoachTension(before, 0, 'fade')).toBe(before)
  })
})

describe('markCoachV1Exported', () => {
  it('marks the project the first time a file really comes out', () => {
    expect(markCoachV1Exported(flow(), 5000).v1ExportedAt).toBe(5000)
  })

  it('never rewrites the mark -- the first file out is the v1', () => {
    const once = markCoachV1Exported(flow(), 5000)
    expect(markCoachV1Exported(once, 9000)).toBe(once)
  })

  it('does not advance the step -- next and skip stay the user"s', () => {
    const after = markCoachV1Exported(flow({ stepId: 'p3-export' }), 5000)
    expect(after.stepId).toBe('p3-export')
  })
})

describe('coachBoundaries', () => {
  it('reads the joins off the flow"s own placed sections', () => {
    expect(coachBoundaries(flow()).map((boundary) => boundary.index)).toEqual([0])
  })
})

describe('coachPhase3Line', () => {
  it('names how many joins there are, in words', () => {
    expect(coachPhase3Line(flow({ lineSeed: 0 }))).toContain('one join')
  })

  it('pluralises', () => {
    const many = flow()
    many.sections = [
      ...sections(),
      {
        type: 'breakdown',
        name: 'breakdown',
        bars: 8,
        droppedPaths: [],
        startBar: 32,
        placedGroupIds: {}
      }
    ]
    expect(coachPhase3Line({ ...many, lineSeed: 0 })).toContain('two joins')
  })

  it('says so plainly when the names ask for nothing', () => {
    const quiet = flow()
    quiet.sections = [
      { type: 'intro', name: 'intro', bars: 8, droppedPaths: [], startBar: 0, placedGroupIds: {} },
      { type: 'outro', name: 'outro', bars: 8, droppedPaths: [], startBar: 8, placedGroupIds: {} }
    ]
    expect(coachPhase3Line({ ...quiet, lineSeed: 0 })).toMatch(/nothing|no drops|not ask/)
  })

  it('says a v1 is out once the project is marked', () => {
    const exported = flow({ stepId: 'p3-export', v1ExportedAt: 5000, lineSeed: 0 })
    expect(coachPhase3Line(exported)).toContain('v1')
  })

  it('leaves every other step to the other line functions', () => {
    expect(coachPhase3Line(flow({ stepId: 'p2-next' }))).toBeNull()
    expect(coachPhase3Line(flow({ stepId: 'p3-balance' }))).toBeNull()
    expect(coachPhase3Line(flow({ stepId: 'p3-export' }))).toBeNull()
    expect(coachPhase3Line(flow({ status: 'finished' }))).toBeNull()
  })
})
