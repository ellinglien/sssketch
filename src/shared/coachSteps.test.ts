import { describe, expect, it } from 'vitest'
import {
  COACH_PHASES,
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachStepById,
  coachStepOrder,
  coachStepPrimaryMove,
  coachStepsInPhase,
  isCoachStepId
} from './coachSteps'

describe('the step table after phase one', () => {
  it('has exactly the six surviving rows, in order', () => {
    expect(COACH_STEPS.map((step) => step.id)).toEqual([
      'p2-first',
      'p2-section',
      'p2-next',
      'p3-tension',
      'p3-balance',
      'p3-export'
    ])
  })

  it('starts on the first arrangement step', () => {
    expect(FIRST_COACH_STEP_ID).toBe('p2-first')
  })

  it('has no phase-one ids left', () => {
    expect(isCoachStepId('p1-flavour')).toBe(false)
    expect(isCoachStepId('p1-lock')).toBe(false)
  })

  it('has only two phases -- the loop phase went with phase one', () => {
    expect(COACH_PHASES.map((phase) => phase.id)).toEqual(['arrangement', 'polish'])
  })

  it('walks one flat order with no answer to reorder it', () => {
    expect(coachStepOrder()).toEqual(COACH_STEPS.map((step) => step.id))
  })

  it('offers no step an answer of its own any more', () => {
    for (const step of COACH_STEPS) expect('offers' in step).toBe(false)
  })

  it('never proposes adding a discover slot', () => {
    for (const step of COACH_STEPS) {
      for (const move of step.moves) expect(move.action.kind).not.toBe('add-slot')
    }
  })

  it('leaves the two question steps with no moves, so nothing decides for the user', () => {
    expect(coachStepById('p2-first')!.moves).toEqual([])
    expect(coachStepById('p2-next')!.moves).toEqual([])
    expect(coachStepPrimaryMove(coachStepById('p2-first')!)).toBeNull()
  })

  it('puts every arrangement step in the arrangement phase', () => {
    expect(coachStepsInPhase('arrangement').map((s) => s.id)).toEqual([
      'p2-first',
      'p2-section',
      'p2-next'
    ])
  })
})
