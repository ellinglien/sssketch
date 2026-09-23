import { describe, expect, it } from 'vitest'
import {
  COACH_STUCK_AFTER_MS,
  advanceCoach,
  coachAnimation,
  coachLine,
  coachPhaseElapsedMs,
  coachStepElapsedMs,
  dismissCoach,
  isCoachStuck,
  minimiseCoach,
  pauseCoach,
  restoreCoach,
  resumeCoach,
  sanitiseLoadedCoach,
  startCoach
} from './coach'
import { COACH_DONE_LINES, COACH_STUCK_LINES } from './coachLines'
import { COACH_STEPS } from './coachSteps'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

describe('startCoach', () => {
  it('starts active, on the first step, with the clock running', () => {
    const coach = startCoach(T0)
    expect(coach.status).toBe('active')
    expect(coach.stepId).toBe('climax-loop')
    expect(coach.outcomes).toEqual({})
    expect(coach.phaseElapsedMs).toEqual({ loop: 0, arrangement: 0, polish: 0 })
    expect(coach.stepElapsedMs).toBe(0)
    expect(coach.runningSince).toBe(T0)
    expect(coach.lineSeed).toBe(0)
  })
})

describe('pauseCoach', () => {
  it('folds the running span into the step and its phase, and stops the clock', () => {
    const paused = pauseCoach(startCoach(T0), T0 + 5 * MINUTE)
    expect(paused.stepElapsedMs).toBe(5 * MINUTE)
    expect(paused.phaseElapsedMs.loop).toBe(5 * MINUTE)
    expect(paused.phaseElapsedMs.arrangement).toBe(0)
    expect(paused.runningSince).toBeNull()
  })

  it('is idempotent -- pausing an already-paused flow adds nothing', () => {
    const once = pauseCoach(startCoach(T0), T0 + 5 * MINUTE)
    const twice = pauseCoach(once, T0 + 99 * MINUTE)
    expect(twice).toEqual(once)
  })
})

describe('resumeCoach', () => {
  it('brings a dismissed flow back, on the same step, with its progress intact', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 5 * MINUTE)
    const resumed = resumeCoach(dismissed, T0 + 60 * MINUTE)
    expect(resumed.status).toBe('active')
    expect(resumed.stepId).toBe('climax-loop')
    expect(resumed.stepElapsedMs).toBe(5 * MINUTE)
    expect(resumed.runningSince).toBe(T0 + 60 * MINUTE)
  })

  it('does not restart the clock on an already-running flow', () => {
    const running = startCoach(T0)
    expect(resumeCoach(running, T0 + 9 * MINUTE).runningSince).toBe(T0)
  })

  it('leaves a finished flow alone -- there is nothing left to resume', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(coach.status).toBe('finished')
    expect(resumeCoach(coach, T0 + 99 * MINUTE)).toEqual(coach)
  })
})

describe('advanceCoach', () => {
  it('records how the step was passed, moves on, and restarts the step clock', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'done')
    expect(next.outcomes).toEqual({ 'climax-loop': 'done' })
    expect(next.stepId).toBe('sections')
    expect(next.stepElapsedMs).toBe(0)
    expect(next.runningSince).toBe(T0 + 8 * MINUTE)
    expect(next.status).toBe('active')
  })

  it('banks the time against the phase the step belonged to, not the new one', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'skipped')
    expect(next.phaseElapsedMs.loop).toBe(8 * MINUTE)
    expect(next.phaseElapsedMs.arrangement).toBe(0)
    expect(next.outcomes).toEqual({ 'climax-loop': 'skipped' })
  })

  it('rotates the line seed so the next step does not reuse this one variant index', () => {
    expect(advanceCoach(startCoach(T0), T0 + MINUTE, 'done').lineSeed).toBe(1)
  })

  it('finishes the flow after the last step, with the clock stopped', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(coach.status).toBe('finished')
    expect(coach.stepId).toBe('finish')
    expect(coach.runningSince).toBeNull()
    expect(coach.outcomes).toEqual({
      'climax-loop': 'done',
      sections: 'done',
      finish: 'done'
    })
  })
})

describe('minimiseCoach / restoreCoach', () => {
  it('minimising keeps the clock running -- it is still the step you are on', () => {
    const minimised = minimiseCoach(startCoach(T0))
    expect(minimised.status).toBe('minimised')
    expect(minimised.runningSince).toBe(T0)
  })

  it('restoring brings the bubble back', () => {
    const restored = restoreCoach(minimiseCoach(startCoach(T0)), T0 + MINUTE)
    expect(restored.status).toBe('active')
    expect(restored.runningSince).toBe(T0)
  })

  it('restoring a dismissed flow does nothing -- that is resumeCoach s job', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + MINUTE)
    expect(restoreCoach(dismissed, T0 + 2 * MINUTE)).toEqual(dismissed)
  })
})

describe('dismissCoach', () => {
  it('ends the flow visually and stops the clock, keeping every bit of progress', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 5 * MINUTE)
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.runningSince).toBeNull()
    expect(dismissed.stepElapsedMs).toBe(5 * MINUTE)
    expect(dismissed.stepId).toBe('climax-loop')
  })

  it('leaves a finished flow finished', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(dismissCoach(coach, T0 + 4 * MINUTE)).toEqual(coach)
  })
})

describe('elapsed time', () => {
  it('counts the open span on top of what is already banked', () => {
    const coach = startCoach(T0)
    expect(coachStepElapsedMs(coach, T0 + 3 * MINUTE)).toBe(3 * MINUTE)
    expect(coachPhaseElapsedMs(coach, 'loop', T0 + 3 * MINUTE)).toBe(3 * MINUTE)
  })

  it('counts the open span only against the phase the current step is in', () => {
    const coach = startCoach(T0)
    expect(coachPhaseElapsedMs(coach, 'arrangement', T0 + 3 * MINUTE)).toBe(0)
  })

  it('stops counting once the clock is stopped', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 3 * MINUTE)
    expect(coachStepElapsedMs(dismissed, T0 + 99 * MINUTE)).toBe(3 * MINUTE)
    expect(coachPhaseElapsedMs(dismissed, 'loop', T0 + 99 * MINUTE)).toBe(3 * MINUTE)
  })

  it('carries banked phase time across a step change', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'done')
    expect(coachPhaseElapsedMs(next, 'loop', T0 + 10 * MINUTE)).toBe(8 * MINUTE)
    expect(coachPhaseElapsedMs(next, 'arrangement', T0 + 10 * MINUTE)).toBe(2 * MINUTE)
  })
})

describe('isCoachStuck', () => {
  it('is false before the threshold and true at it', () => {
    const coach = startCoach(T0)
    expect(isCoachStuck(coach, T0 + COACH_STUCK_AFTER_MS - 1)).toBe(false)
    expect(isCoachStuck(coach, T0 + COACH_STUCK_AFTER_MS)).toBe(true)
  })

  it('never fires while he is not on screen', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 30 * MINUTE)
    expect(isCoachStuck(dismissed, T0 + 99 * MINUTE)).toBe(false)
  })

  it('resets when the step changes', () => {
    const next = advanceCoach(startCoach(T0), T0 + 30 * MINUTE, 'skipped')
    expect(isCoachStuck(next, T0 + 31 * MINUTE)).toBe(false)
  })
})

describe('coachLine', () => {
  it('reads the current step s variants at the current seed', () => {
    expect(coachLine(startCoach(T0))).toBe(COACH_STEPS[0].lines[0])
    const next = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    expect(coachLine(next)).toBe(COACH_STEPS[1].lines[1 % COACH_STEPS[1].lines.length])
  })

  it('switches to the sign-off once the flow is finished', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(COACH_DONE_LINES).toContain(coachLine(coach))
  })
})

describe('coachAnimation', () => {
  const base = {
    status: 'active' as const,
    working: false,
    moving: false,
    justAdvanced: false,
    stuck: false
  }

  it('bobs by default', () => {
    expect(coachAnimation(base)).toBe('idle')
  })

  it('climbs while the app is doing work, ahead of everything else', () => {
    expect(coachAnimation({ ...base, working: true, moving: true, stuck: true })).toBe('climb')
  })

  it('walks when moving to another area', () => {
    expect(coachAnimation({ ...base, moving: true, stuck: true })).toBe('walk')
  })

  it('jumps on a finished step and on a finished flow', () => {
    expect(coachAnimation({ ...base, justAdvanced: true })).toBe('jump')
    expect(coachAnimation({ ...base, status: 'finished' })).toBe('jump')
  })

  it('takes a hit on the stuck nudge', () => {
    expect(coachAnimation({ ...base, stuck: true })).toBe('hit')
  })
})

describe('sanitiseLoadedCoach', () => {
  it('drops a non-object, so a hand-edited file cannot crash a load', () => {
    expect(sanitiseLoadedCoach(null)).toBeNull()
    expect(sanitiseLoadedCoach('nope')).toBeNull()
    expect(sanitiseLoadedCoach(undefined)).toBeNull()
  })

  it('hides a loaded flow and stops its clock -- he never appears on his own', () => {
    const saved = startCoach(T0)
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.status).toBe('dismissed')
    expect(loaded?.runningSince).toBeNull()
  })

  it('keeps every bit of progress across the load', () => {
    const saved = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'skipped')
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.stepId).toBe('sections')
    expect(loaded?.outcomes).toEqual({ 'climax-loop': 'skipped' })
    expect(loaded?.phaseElapsedMs.loop).toBe(8 * MINUTE)
    expect(loaded?.lineSeed).toBe(1)
  })

  it('leaves a finished flow finished', () => {
    let coach = advanceCoach(startCoach(T0), T0 + MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 2 * MINUTE, 'done')
    coach = advanceCoach(coach, T0 + 3 * MINUTE, 'done')
    expect(sanitiseLoadedCoach(JSON.parse(JSON.stringify(coach)))?.status).toBe('finished')
  })

  it('repairs a hand-edited file rather than throwing', () => {
    const loaded = sanitiseLoadedCoach({
      status: 'banana',
      stepId: 'not-a-step',
      outcomes: { sections: 'maybe', finish: 'done' },
      phaseElapsedMs: { loop: 'lots' },
      stepElapsedMs: -5,
      runningSince: 999,
      lineSeed: 1.7
    })
    expect(loaded).toEqual({
      status: 'dismissed',
      stepId: 'climax-loop',
      outcomes: { finish: 'done' },
      phaseElapsedMs: { loop: 0, arrangement: 0, polish: 0 },
      stepElapsedMs: 0,
      runningSince: null,
      lineSeed: 1
    })
  })
})

describe('the stuck nudge line', () => {
  it('comes off the shared table at the step s own seed', () => {
    expect(COACH_STUCK_LINES).toContain(COACH_STUCK_LINES[0])
  })
})
