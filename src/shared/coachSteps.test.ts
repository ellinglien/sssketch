import { describe, expect, it } from 'vitest'
import {
  COACH_FLAVOURS,
  COACH_PHASES,
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachPhaseDef,
  coachStepArmKinds,
  coachStepById,
  coachStepPrimaryMove,
  coachStepsInPhase,
  isCoachFlavour,
  isCoachStepId,
  nextCoachStepId,
  resolveCoachStep,
  type CoachStepDef
} from './coachSteps'

describe('coach phases', () => {
  it('carries the spec timekeeping targets for all three phases', () => {
    expect(COACH_PHASES.map((phase) => phase.id)).toEqual(['loop', 'arrangement', 'polish'])
    expect(coachPhaseDef('loop').targetMinMinutes).toBe(60)
    expect(coachPhaseDef('loop').targetMaxMinutes).toBe(90)
    expect(coachPhaseDef('arrangement').targetMinMinutes).toBe(120)
    expect(coachPhaseDef('arrangement').targetMaxMinutes).toBe(180)
    expect(coachPhaseDef('polish').targetMinMinutes).toBe(45)
    expect(coachPhaseDef('polish').targetMaxMinutes).toBe(60)
  })
})

describe('coach steps', () => {
  it('starts at the first row of the table', () => {
    expect(FIRST_COACH_STEP_ID).toBe(COACH_STEPS[0].id)
  })

  it('looks a step up by id, and returns undefined for an unknown one', () => {
    expect(coachStepById('climax-loop')?.phase).toBe('loop')
    expect(coachStepById('not-a-step')).toBeUndefined()
  })

  it('walks the table in order and ends at null', () => {
    const visited: string[] = [FIRST_COACH_STEP_ID]
    let id = nextCoachStepId(FIRST_COACH_STEP_ID)
    while (id !== null) {
      visited.push(id)
      id = nextCoachStepId(id)
    }
    expect(visited).toEqual(COACH_STEPS.map((step) => step.id))
  })

  it('groups steps by phase without losing any', () => {
    const grouped = COACH_PHASES.flatMap((phase) => coachStepsInPhase(phase.id))
    expect(grouped.map((step) => step.id).sort()).toEqual(COACH_STEPS.map((step) => step.id).sort())
  })

  it('narrows a persisted string to a known step id', () => {
    expect(isCoachStepId('sections')).toBe(true)
    expect(isCoachStepId('sectionz')).toBe(false)
    expect(isCoachStepId(42)).toBe(false)
  })

  it('gives every step at least three hand-written line variants', () => {
    for (const step of COACH_STEPS) {
      expect(step.lines.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every line inside the app copy rules: lowercase start, no emoji, no exclamation', () => {
    for (const step of COACH_STEPS) {
      for (const line of step.lines) {
        expect(line).not.toMatch(/!/)
        expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(line[0]).toBe(line[0].toLowerCase())
      }
    }
  })
})

describe('flavours', () => {
  it('has exactly the two the spec names, groove first', () => {
    expect(COACH_FLAVOURS).toEqual(['groove', 'melodic'])
  })

  it('narrows a persisted string to a known flavour', () => {
    expect(isCoachFlavour('groove')).toBe(true)
    expect(isCoachFlavour('melodic')).toBe(true)
    expect(isCoachFlavour('grove')).toBe(false)
    expect(isCoachFlavour(null)).toBe(false)
  })
})

describe('resolveCoachStep', () => {
  const step: CoachStepDef = {
    id: 'sections',
    phase: 'arrangement',
    label: 'neutral label',
    lines: ['neutral line one.', 'neutral line two.', 'neutral line three.'],
    moves: [{ id: 'neutral-move', label: 'do the neutral thing', action: { kind: 'lock-climax' } }],
    primaryMoveId: 'neutral-move',
    byFlavour: {
      groove: {
        label: 'groove label',
        moves: [
          {
            id: 'groove-move',
            label: 'add a bassish one',
            action: { kind: 'add-slot', kinds: ['bass'] }
          }
        ],
        primaryMoveId: 'groove-move'
      }
    }
  }

  it('returns the row untouched when there is no override for this flavour', () => {
    expect(resolveCoachStep(step, 'melodic').label).toBe('neutral label')
    expect(resolveCoachStep(step, null).label).toBe('neutral label')
  })

  it('applies the override for the flavour that has one', () => {
    const resolved = resolveCoachStep(step, 'groove')
    expect(resolved.label).toBe('groove label')
    expect(resolved.moves.map((move) => move.id)).toEqual(['groove-move'])
    // Fields the override does not mention come through from the base row.
    expect(resolved.lines).toEqual(step.lines)
  })

  it('is idempotent -- a resolved step carries no override to apply twice', () => {
    const once = resolveCoachStep(step, 'groove')
    expect(resolveCoachStep(once, 'melodic')).toEqual(once)
  })

  it('finds the primary move and the kinds it arms, per flavour', () => {
    expect(coachStepPrimaryMove(step, 'groove')?.id).toBe('groove-move')
    expect(coachStepArmKinds(step, 'groove')).toEqual(['bass'])
    // A primary move that is not an add-slot arms nothing.
    expect(coachStepArmKinds(step, 'melodic')).toBeNull()
  })

  it('arms nothing at all for a step with no primary move', () => {
    const noPrimary: CoachStepDef = { ...step, primaryMoveId: undefined, byFlavour: undefined }
    expect(coachStepPrimaryMove(noPrimary, null)).toBeNull()
    expect(coachStepArmKinds(noPrimary, null)).toBeNull()
  })
})
