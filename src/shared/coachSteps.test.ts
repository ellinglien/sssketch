import { describe, expect, it } from 'vitest'
import {
  COACH_FLAVOURS,
  COACH_PHASES,
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachPhaseDef,
  coachStepArmKinds,
  coachStepById,
  coachStepOrder,
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
  it('starts on the melodic-or-groove question', () => {
    expect(FIRST_COACH_STEP_ID).toBe('p1-flavour')
    expect(COACH_STEPS[0].id).toBe('p1-flavour')
  })

  it('looks a step up by id, and returns undefined for an unknown one', () => {
    expect(coachStepById('p1-hook')?.phase).toBe('loop')
    expect(coachStepById('not-a-step')).toBeUndefined()
  })

  it('orders phase one by the answer -- only the low end and harmony swap', () => {
    expect(coachStepOrder('groove')).toEqual([
      'p1-flavour',
      'p1-low-end',
      'p1-harmony',
      'p1-drums',
      'p1-supporting',
      'p1-hook',
      'p1-balance',
      'p1-lock',
      'p2-first',
      'p2-section',
      'p2-next',
      'finish'
    ])
    expect(coachStepOrder('melodic')).toEqual([
      'p1-flavour',
      'p1-harmony',
      'p1-low-end',
      'p1-drums',
      'p1-supporting',
      'p1-hook',
      'p1-balance',
      'p1-lock',
      'p2-first',
      'p2-section',
      'p2-next',
      'finish'
    ])
  })

  it('walks the order for the flavour it is given and ends at null', () => {
    const visited: string[] = [FIRST_COACH_STEP_ID]
    let id = nextCoachStepId(FIRST_COACH_STEP_ID, 'melodic')
    while (id !== null) {
      visited.push(id)
      id = nextCoachStepId(id, 'melodic')
    }
    expect(visited).toEqual(coachStepOrder('melodic'))
  })

  it('walks the groove order when no answer has been given yet', () => {
    expect(nextCoachStepId('p1-flavour', null)).toBe('p1-low-end')
  })

  it('groups steps by phase, in the order for that flavour, without losing any', () => {
    const grouped = COACH_PHASES.flatMap((phase) => coachStepsInPhase(phase.id, 'melodic'))
    expect(grouped.map((step) => step.id)).toEqual(coachStepOrder('melodic'))
  })

  it('narrows a persisted string to a known step id', () => {
    expect(isCoachStepId('p2-section')).toBe(true)
    expect(isCoachStepId('sections')).toBe(false)
    expect(isCoachStepId('climax-loop')).toBe(false)
    expect(isCoachStepId(42)).toBe(false)
  })

  it('arms the kinds each phase-one step is about, per flavour', () => {
    const lowEnd = coachStepById('p1-low-end')!
    expect(coachStepArmKinds(lowEnd, 'groove')).toEqual(['bass'])
    expect(coachStepArmKinds(lowEnd, 'melodic')).toEqual(['bass'])
    // Groove gets the kick as a second, non-primary move; melodic does not.
    expect(resolveCoachStep(lowEnd, 'groove').moves.map((m) => m.id)).toEqual([
      'low-end-bass',
      'low-end-drums'
    ])
    expect(resolveCoachStep(lowEnd, 'melodic').moves.map((m) => m.id)).toEqual(['low-end-bass'])

    expect(coachStepArmKinds(coachStepById('p1-harmony')!, 'groove')).toEqual(['lead', 'warm'])
    expect(coachStepArmKinds(coachStepById('p1-drums')!, 'groove')).toEqual(['drums', 'rhythmic'])
    expect(coachStepArmKinds(coachStepById('p1-drums')!, 'melodic')).toEqual(['drums'])
    expect(coachStepArmKinds(coachStepById('p1-supporting')!, null)).toEqual(['bassHeavy'])
    expect(coachStepArmKinds(coachStepById('p1-hook')!, null)).toEqual(['lead', 'bright'])
  })

  it('arms nothing on the question, the balance pass or the lock-in', () => {
    expect(coachStepArmKinds(coachStepById('p1-flavour')!, null)).toBeNull()
    expect(coachStepArmKinds(coachStepById('p1-balance')!, null)).toBeNull()
    expect(coachStepArmKinds(coachStepById('p1-lock')!, null)).toBeNull()
  })

  it('offers both answers and the seeded start on the question step', () => {
    const offers = coachStepById('p1-flavour')!.offers ?? []
    expect(offers.map((offer) => offer.action)).toEqual([
      { kind: 'set-flavour', flavour: 'groove' },
      { kind: 'set-flavour', flavour: 'melodic' },
      { kind: 'open-riff-browser' }
    ])
  })

  it('asks with exactly the flavours that exist -- the buttons are mapped, not listed', () => {
    // The question's buttons come from COACH_FLAVOURS, so a flavour cannot
    // be added to the union while quietly missing from the one step that
    // asks for it.
    const offers = coachStepById('p1-flavour')!.offers ?? []
    const asked = offers.flatMap((offer) =>
      offer.action.kind === 'set-flavour' ? [offer.action.flavour] : []
    )
    expect(asked).toEqual([...COACH_FLAVOURS])
    expect(offers.map((offer) => offer.label)).toEqual([
      ...COACH_FLAVOURS,
      'start from a riff you love'
    ])
  })

  it('never lets the harmony step and the hook step satisfy each other', () => {
    // bright and warm are opposite ends of one field, so normalizeSlotKinds
    // keeps at most one of them in a set -- a harmony slot can never be a
    // superset of the hook's own set, or the other way round.
    const harmony = coachStepById('p1-harmony')!.satisfiedBy ?? []
    const hook = coachStepById('p1-hook')!.satisfiedBy ?? []
    expect(harmony).toEqual([['lead']])
    expect(hook).toEqual([['lead', 'bright']])
  })

  it('puts all three section steps in the arrangement phase', () => {
    expect(coachStepById('p2-first')?.phase).toBe('arrangement')
    expect(coachStepById('p2-section')?.phase).toBe('arrangement')
    expect(coachStepById('p2-next')?.phase).toBe('arrangement')
    expect(coachStepById('finish')?.phase).toBe('polish')
  })

  it('offers no moves on either question step -- those are the user\u2019s call', () => {
    // Same reasoning as the melodic-or-groove question: picking which
    // section comes next would be the app deciding something about the
    // track, which is the one thing this feature does not do.
    expect(coachStepById('p2-first')?.moves).toEqual([])
    expect(coachStepById('p2-next')?.moves).toEqual([])
    expect(coachStepById('p2-first')?.primaryMoveId).toBeUndefined()
    expect(coachStepById('p2-next')?.primaryMoveId).toBeUndefined()
  })

  it('gives the section step its three panel moves', () => {
    const step = coachStepById('p2-section')
    expect(step?.moves.map((move) => move.action)).toEqual([
      { kind: 'section-op', op: 'drop-suggested' },
      { kind: 'section-op', op: 'preview' },
      { kind: 'section-op', op: 'place' }
    ])
    expect(step?.primaryMoveId).toBe('section-drop-suggested')
    // Nothing in phase two arms a Discover slot.
    expect(coachStepArmKinds(step!, null)).toBeNull()
  })

  it('gives every step at least three hand-written line variants', () => {
    for (const step of COACH_STEPS) {
      expect(step.lines.length).toBeGreaterThanOrEqual(3)
      for (const flavour of COACH_FLAVOURS) {
        expect(resolveCoachStep(step, flavour).lines.length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps every line inside the app copy rules: lowercase start, no emoji, no exclamation', () => {
    for (const step of COACH_STEPS) {
      for (const flavour of [null, ...COACH_FLAVOURS]) {
        const resolved = resolveCoachStep(step, flavour)
        for (const line of resolved.lines) {
          expect(line).not.toMatch(/!/)
          expect(line).not.toMatch(/\p{Extended_Pictographic}/u)
          expect(line[0]).toBe(line[0].toLowerCase())
        }
        for (const label of [resolved.label, ...resolved.moves.map((m) => m.label)]) {
          expect(label).toBe(label.toLowerCase())
        }
      }
    }
  })

  it('never says anything that could be wrong about a particular track', () => {
    // The spec's rule, as a test: he describes the STEP, never the music.
    for (const step of COACH_STEPS) {
      for (const flavour of [null, ...COACH_FLAVOURS]) {
        for (const line of resolveCoachStep(step, flavour).lines) {
          expect(line).not.toMatch(/it looks like/i)
          expect(line).not.toMatch(/your (track|song|mix) (needs|sounds|is)/i)
          expect(line).not.toMatch(/\b(better|worse|too (much|many|thin|loud))\b/i)
        }
      }
    }
  })

  it('never asserts what is already in the project -- every route through the flow skips', () => {
    // The same rule as the test above, in the form it actually got broken.
    // A line that SOUNDS neutral ("the kick is already down", "under the
    // harmony you just picked") is still a claim about the user's project,
    // and every one of them is reachably false: next/skip are always
    // available, so no step can assume the step before it produced
    // anything. Two were shipped wrong and true on neither default path --
    // groove's low end is satisfied by bass OR drums, so its drums step was
    // reachable with no kick, and the harmony step is skippable like any
    // other.
    //
    // A keyword guard cannot catch every phrasing of this, but it catches
    // the shapes English keeps reaching for, which is what a regression
    // would be written in.
    const assertsPriorState: readonly [RegExp, string][] = [
      [/\balready\b/i, 'claims something is already in the project'],
      [/\byou just\b/i, 'claims the user just did something'],
      [/\bwhat is (already )?there\b/i, 'claims there is something there'],
      [/\bon top of\b/i, 'claims there is something underneath'],
      [/\bunder the (harmony|bass|drums|kick|loop)\b/i, 'claims what it is going under'],
      [/\b(is|are) down\b/i, 'claims a part is already placed'],
      [/\b(second|another|more) [\w· ]*(layer|drums|stem)\b/i, 'claims there is a first one'],
      [/\bis playing\b/i, 'claims the transport is running'],
      [/\bthat section\b/i, 'claims a section exists']
    ]
    for (const step of COACH_STEPS) {
      for (const flavour of [null, ...COACH_FLAVOURS]) {
        for (const line of resolveCoachStep(step, flavour).lines) {
          for (const [pattern, why] of assertsPriorState) {
            // Context goes in the assertion MESSAGE, never into the
            // matched string -- a message mentioning "already" would
            // otherwise match the guard it is explaining.
            expect(line, `${step.id} (${flavour}) ${why}`).not.toMatch(pattern)
          }
        }
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
    id: 'p2-section',
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
