import { describe, expect, it } from 'vitest'
import { advanceCoach, startCoach, type CoachState } from './coach'
import type { CoachSlotSnapshot } from './coachClimax'
import {
  answerCoachFlavour,
  coachLineFor,
  coachSeededLine,
  coachStepSatisfied,
  lockCoachClimax,
  seededCoveredStepIds,
  slotCoversKindSet
} from './coachPhase1'
import { COACH_STEP_SATISFIED_LINES } from './coachLines'
import { coachStepById, resolveCoachStep } from './coachSteps'
import type { DiscoverSlotKind } from './discoverSlotKind'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

function slot(kinds: DiscoverSlotKind[], id = `slot-${kinds.join('-')}`): CoachSlotSnapshot {
  return {
    id,
    kinds,
    stem: {
      path: `/stems/${id}.wav`,
      name: id,
      author: 'someone',
      type: 'notes',
      durationSec: 8,
      barLength: 4
    },
    gain: 1,
    audible: true,
    rolling: false
  }
}

function unresolved(kinds: DiscoverSlotKind[]): CoachSlotSnapshot {
  return { ...slot(kinds), stem: null }
}

describe('slotCoversKindSet', () => {
  it('matches when the slot kinds are a superset of the wanted set', () => {
    expect(slotCoversKindSet(slot(['lead', 'bright']), ['lead'])).toBe(true)
    expect(slotCoversKindSet(slot(['lead', 'bright']), ['lead', 'bright'])).toBe(true)
    expect(slotCoversKindSet(slot(['lead']), ['lead', 'bright'])).toBe(false)
  })

  it('never matches a slot with nothing resolved behind it', () => {
    expect(slotCoversKindSet(unresolved(['lead']), ['lead'])).toBe(false)
  })
})

describe('coachStepSatisfied', () => {
  it('is false on the question until it is answered', () => {
    const coach = startCoach(T0)
    expect(coachStepSatisfied(coach, [])).toBe(false)
    expect(coachStepSatisfied({ ...coach, flavour: 'groove' }, [])).toBe(true)
  })

  it('completes a step when a slot with its kinds resolves', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-low-end' }
    expect(coachStepSatisfied(coach, [unresolved(['bass'])])).toBe(false)
    expect(coachStepSatisfied(coach, [slot(['bass'])])).toBe(true)
    // Groove's low end takes either half of it.
    expect(coachStepSatisfied(coach, [slot(['drums'])])).toBe(true)
  })

  it('does not let the harmony slot complete the hook step', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-hook' }
    expect(coachStepSatisfied(coach, [slot(['lead', 'warm'])])).toBe(false)
    expect(coachStepSatisfied(coach, [slot(['lead', 'bright'])])).toBe(true)
  })

  it('never completes the balance pass on its own', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-balance' }
    expect(coachStepSatisfied(coach, [slot(['bass']), slot(['drums'])])).toBe(false)
  })

  it('completes the lock-in step once there is a locked climax', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-lock' }
    expect(coachStepSatisfied(coach, [slot(['bass'])])).toBe(false)
    const locked = lockCoachClimax(coach, T0 + MINUTE, [slot(['bass'])], 120)
    expect(coachStepSatisfied(locked, [slot(['bass'])])).toBe(true)
  })
})

describe('seededCoveredStepIds', () => {
  it('marks the roles a seeded riff already covers, and nothing else', () => {
    const slots = [slot(['drums']), slot(['bass']), slot(['lead'])]
    expect(seededCoveredStepIds('groove', slots)).toEqual(['p1-low-end', 'p1-harmony'])
  })

  it('does not mark a step whose combination the seed does not cover', () => {
    // A seeded drums slot is ['drums'] -- not a superset of the groove
    // drums step's own {drummy, rhythmic}.
    expect(seededCoveredStepIds('groove', [slot(['drums'])])).toEqual(['p1-low-end'])
  })

  it('is empty for an empty Discover', () => {
    expect(seededCoveredStepIds('melodic', [])).toEqual([])
  })
})

describe('answerCoachFlavour', () => {
  it('records the answer and moves to the first step of that order', () => {
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'melodic', [])
    expect(answered.flavour).toBe('melodic')
    expect(answered.stepId).toBe('p1-harmony')
    expect(answered.outcomes).toEqual({ 'p1-flavour': 'done' })
    expect(answered.stepElapsedMs).toBe(0)
    expect(answered.runningSince).toBe(T0 + MINUTE)
    expect(answered.phaseElapsedMs.loop).toBe(MINUTE)
  })

  it('skips past the roles a seeded start already covers', () => {
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', [
      slot(['drums']),
      slot(['bass'])
    ])
    expect(answered.outcomes).toEqual({ 'p1-flavour': 'done', 'p1-low-end': 'done' })
    expect(answered.stepId).toBe('p1-harmony')
    expect(answered.seededKinds).toEqual(['drums', 'bass'])
  })

  it('keeps stepping over covered roles, not just the ones before the first open one', () => {
    // A seed that covers the low end and the drums but not the harmony
    // lands the user on the harmony -- and advancing off it must carry on
    // past the drums step it already marked done. Both halves of that are
    // one transition (advanceCoach), which is why answering is written as
    // one.
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', [
      slot(['bass']),
      slot(['drums', 'rhythmic'])
    ])
    expect(answered.stepId).toBe('p1-harmony')
    expect(answered.outcomes['p1-drums']).toBe('done')
    const next = advanceCoach(answered, T0 + 2 * MINUTE, 'done')
    // p1-drums and p1-supporting are both covered by the seeded
    // drummy-rhythmic slot, so the hook is the next thing genuinely open.
    expect(next.stepId).toBe('p1-hook')
  })

  it('has nothing to say about a seed when there is no seed', () => {
    expect(answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', []).seededKinds).toEqual([])
  })

  it('is asked once -- a second answer leaves the flow where it is', () => {
    const answered = answerCoachFlavour(startCoach(T0), T0 + MINUTE, 'groove', [])
    expect(answerCoachFlavour(answered, T0 + 2 * MINUTE, 'melodic', [])).toBe(answered)
  })
})

describe('lockCoachClimax', () => {
  it('freezes the loop onto the flow', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-lock' }
    const locked = lockCoachClimax(coach, T0 + MINUTE, [slot(['bass']), slot(['drums'])], 96)
    expect(locked.lockedClimax?.bpm).toBe(96)
    expect(locked.lockedClimax?.stems.map((s) => s.role)).toEqual(['bass', 'drums'])
    // Locking does not advance -- next/skip stay the user's.
    expect(locked.stepId).toBe('p1-lock')
  })

  it('leaves the flow alone when there is nothing resolved to lock', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-lock' }
    expect(lockCoachClimax(coach, T0 + MINUTE, [unresolved(['bass'])], 96)).toBe(coach)
  })
})

describe('the lines phase one adds', () => {
  it('swaps the step line for the satisfied line once the step is covered', () => {
    const coach: CoachState = { ...startCoach(T0), flavour: 'groove', stepId: 'p1-low-end' }
    expect(coachLineFor(coach, [])).toBe(
      resolveCoachStep(coachStepById('p1-low-end')!, 'groove').lines[0]
    )
    expect(coachLineFor(coach, [slot(['bass'])])).toBe(COACH_STEP_SATISFIED_LINES[0])
  })

  it('names the covered roles and the step that follows', () => {
    expect(coachSeededLine(['drums', 'bass'], 'harmony', 0)).toBe(
      'you already have drummy and bassish. next: harmony.'
    )
    expect(coachSeededLine(['drums'], 'harmony', 0)).toBe('you already have drummy. next: harmony.')
  })

  it('has nothing to say when nothing was seeded', () => {
    expect(coachSeededLine([], 'harmony', 0)).toBeNull()
  })
})

describe('coachStepSatisfied on the export step', () => {
  it('is answered by the flow itself, not by discover"s slots', () => {
    const base = { ...startCoach(1000), stepId: 'p3-export' as const }
    expect(coachStepSatisfied(base, [])).toBe(false)
    expect(coachStepSatisfied({ ...base, v1ExportedAt: 7000 }, [])).toBe(true)
  })
})
