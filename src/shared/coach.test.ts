import { describe, expect, it } from 'vitest'
import {
  advanceCoach,
  dismissCoach,
  minimiseCoach,
  pauseCoach,
  restoreCoach,
  resumeCoach,
  startCoach
} from './coach'

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
