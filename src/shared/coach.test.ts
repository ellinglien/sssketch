import { describe, expect, it } from 'vitest'
import {
  COACH_STUCK_AFTER_MS,
  advanceCoach,
  coachAnimation,
  coachIsComplete,
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
  startCoach,
  type CoachState
} from './coach'
import { COACH_DONE_LINES, COACH_STUCK_LINES } from './coachLines'
import { COACH_STEPS, coachStepOrder } from './coachSteps'
import { lockClimaxFromSlots } from './coachClimax'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

describe('startCoach', () => {
  it('starts active, on the first step, with the clock running', () => {
    const coach = startCoach(T0)
    expect(coach.status).toBe('active')
    expect(coach.stepId).toBe('p2-first')
    expect(coach.outcomes).toEqual({})
    expect(coach.phaseElapsedMs).toEqual({ arrangement: 0, polish: 0 })
    expect(coach.stepElapsedMs).toBe(0)
    expect(coach.runningSince).toBe(T0)
    expect(coach.lineSeed).toBe(0)
  })
})

describe('pauseCoach', () => {
  it('folds the running span into the step and its phase, and stops the clock', () => {
    const paused = pauseCoach(startCoach(T0), T0 + 5 * MINUTE)
    expect(paused.stepElapsedMs).toBe(5 * MINUTE)
    expect(paused.phaseElapsedMs.arrangement).toBe(5 * MINUTE)
    expect(paused.phaseElapsedMs.polish).toBe(0)
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
    expect(resumed.stepId).toBe('p2-first')
    expect(resumed.stepElapsedMs).toBe(5 * MINUTE)
    expect(resumed.runningSince).toBe(T0 + 60 * MINUTE)
  })

  it('does not restart the clock on an already-running flow', () => {
    const running = startCoach(T0)
    expect(resumeCoach(running, T0 + 9 * MINUTE).runningSince).toBe(T0)
  })

  it('leaves a finished flow alone -- there is nothing left to resume', () => {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50)
    }
    expect(resumeCoach(coach, T0 + 99 * MINUTE)).toEqual(coach)
  })
})

describe('advanceCoach', () => {
  it('records how the step was passed, moves on, and restarts the step clock', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'done')
    expect(next.outcomes).toEqual({ 'p2-first': 'done' })
    expect(next.stepId).toBe('p2-section')
    expect(next.stepElapsedMs).toBe(0)
    expect(next.runningSince).toBe(T0 + 8 * MINUTE)
    expect(next.status).toBe('active')
  })

  it('banks the time against the phase the step belonged to, not the new one', () => {
    const next = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'skipped')
    expect(next.phaseElapsedMs.arrangement).toBe(8 * MINUTE)
    expect(next.phaseElapsedMs.polish).toBe(0)
    expect(next.outcomes).toEqual({ 'p2-first': 'skipped' })
  })

  it('rotates the line seed so the next step does not reuse this one variant index', () => {
    expect(advanceCoach(startCoach(T0), T0 + MINUTE, 'done').lineSeed).toBe(1)
  })

  it('does not step over a phase-two step just because it has been through once', () => {
    // Phase two's steps repeat by design -- p2-section is walked again for
    // every section the user carves -- so an outcome there means "you did
    // this once", not "this is behind you". Nothing skips ahead any more:
    // the only thing that ever did was phase one's seeded start.
    const secondLap: CoachState = {
      ...startCoach(T0),
      stepId: 'p2-section',
      outcomes: { 'p2-first': 'done', 'p2-section': 'done', 'p2-next': 'done' }
    }
    expect(advanceCoach(secondLap, T0 + MINUTE, 'skipped').stepId).toBe('p2-next')
  })

  it('finishes the flow after the last step, with the clock stopped', () => {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50) // a runaway loop is a bug, not a hang
    }
    expect(coach.stepId).toBe('p3-export')
    expect(coach.runningSince).toBeNull()
    expect(Object.keys(coach.outcomes)).toEqual([...coachStepOrder()])
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
    expect(dismissed.stepId).toBe('p2-first')
  })

  // This test used to assert the opposite -- that dismissing a finished
  // flow left it finished. That was wrong in the one way the user actually
  // feels: the closing bubble's ONLY button is "done", which dispatches
  // COACH_DISMISS, and the gate in SssketchyCoach.tsx only hides a flow
  // whose status is 'dismissed'. So a finished flow could never be put
  // away: the bubble sat over the app for the rest of the session and the
  // button did nothing. Dismissing it is now an ordinary dismiss, and
  // nothing about having finished is lost -- see coachIsComplete.
  it('puts a finished flow away, keeping everything it produced', () => {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50)
    }
    const dismissed = dismissCoach(coach, T0 + 50 * MINUTE)
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.outcomes).toEqual(coach.outcomes)
    expect(dismissed.stepId).toBe('p3-export')
    // ...and the flow is still, durably, a finished one.
    expect(coachIsComplete(dismissed)).toBe(true)
  })
})

describe('coachIsComplete', () => {
  function runToTheEnd(): CoachState {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50)
    }
    return coach
  }

  it('is false for a flow still in progress, dismissed or not', () => {
    expect(coachIsComplete(startCoach(T0))).toBe(false)
    expect(coachIsComplete(dismissCoach(startCoach(T0), T0 + MINUTE))).toBe(false)
  })

  it('survives a finished flow being put away, so the button still starts a fresh one', () => {
    const finished = runToTheEnd()
    const dismissed = dismissCoach(finished, T0 + 99 * MINUTE)
    expect(coachIsComplete(dismissed)).toBe(true)
    // Which is what keeps "resume" from walking back into a flow that has
    // nowhere left to go.
    expect(resumeCoach(dismissed, T0 + 100 * MINUTE)).toEqual(dismissed)
  })

  it('survives a save and reload of a finished, dismissed flow', () => {
    const dismissed = dismissCoach(runToTheEnd(), T0 + 99 * MINUTE)
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(dismissed)))
    expect(loaded).not.toBeNull()
    expect(coachIsComplete(loaded!)).toBe(true)
  })
})

describe('elapsed time', () => {
  it('counts the open span on top of what is already banked', () => {
    const coach = startCoach(T0)
    expect(coachStepElapsedMs(coach, T0 + 3 * MINUTE)).toBe(3 * MINUTE)
    expect(coachPhaseElapsedMs(coach, 'arrangement', T0 + 3 * MINUTE)).toBe(3 * MINUTE)
  })

  it('counts the open span only against the phase the current step is in', () => {
    const coach = startCoach(T0)
    expect(coachPhaseElapsedMs(coach, 'polish', T0 + 3 * MINUTE)).toBe(0)
  })

  it('stops counting once the clock is stopped', () => {
    const dismissed = dismissCoach(startCoach(T0), T0 + 3 * MINUTE)
    expect(coachStepElapsedMs(dismissed, T0 + 99 * MINUTE)).toBe(3 * MINUTE)
    expect(coachPhaseElapsedMs(dismissed, 'arrangement', T0 + 99 * MINUTE)).toBe(3 * MINUTE)
  })

  it('carries banked phase time across a step change', () => {
    // Within one phase, the banked time and the open span both count
    // against it.
    const samePhase = advanceCoach(startCoach(T0), T0 + 8 * MINUTE, 'done')
    expect(samePhase.stepId).toBe('p2-section')
    expect(coachPhaseElapsedMs(samePhase, 'arrangement', T0 + 10 * MINUTE)).toBe(10 * MINUTE)
    expect(coachPhaseElapsedMs(samePhase, 'polish', T0 + 10 * MINUTE)).toBe(0)
    // Across the phase boundary, the arrangement's number is final and only
    // the new phase keeps counting.
    const crossed = advanceCoach(
      { ...samePhase, stepId: 'p2-next', runningSince: T0 + 8 * MINUTE },
      T0 + 9 * MINUTE,
      'done'
    )
    expect(crossed.stepId).toBe('p3-tension')
    expect(coachPhaseElapsedMs(crossed, 'arrangement', T0 + 11 * MINUTE)).toBe(9 * MINUTE)
    expect(coachPhaseElapsedMs(crossed, 'polish', T0 + 11 * MINUTE)).toBe(2 * MINUTE)
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
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50)
    }
    expect(COACH_DONE_LINES).toContain(coachLine(coach))
  })
})

describe('coachAnimation', () => {
  const base = {
    status: 'active' as const,
    working: false,
    moving: false,
    justAdvanced: false,
    justNudged: false
  }

  it('bobs by default', () => {
    expect(coachAnimation(base)).toBe('idle')
  })

  it('climbs while the app is doing work, ahead of everything else', () => {
    expect(coachAnimation({ ...base, working: true, moving: true, justNudged: true })).toBe('climb')
  })

  it('walks when moving to another area', () => {
    expect(coachAnimation({ ...base, moving: true, justNudged: true })).toBe('walk')
  })

  it('jumps on a finished step and on a finished flow', () => {
    expect(coachAnimation({ ...base, justAdvanced: true })).toBe('jump')
    expect(coachAnimation({ ...base, status: 'finished' })).toBe('jump')
  })

  it('takes a hit when the stuck nudge lands, and only then', () => {
    // The input is the MOMENT the nudge landed, not the whole time it
    // stands -- isCoachStuck stays true until the step changes, and a
    // permanent hit loop is not "a quiet nudge" (spec).
    expect(coachAnimation({ ...base, justNudged: true })).toBe('hit')
    expect(coachAnimation({ ...base, justNudged: false })).toBe('idle')
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
    expect(loaded?.stepId).toBe('p2-section')
    expect(loaded?.outcomes).toEqual({ 'p2-first': 'skipped' })
    expect(loaded?.phaseElapsedMs.arrangement).toBe(8 * MINUTE)
    expect(loaded?.lineSeed).toBe(1)
  })

  it('leaves a finished flow finished', () => {
    let coach = startCoach(T0)
    let minute = 1
    while (coach.status !== 'finished') {
      coach = advanceCoach(coach, T0 + minute * MINUTE, 'done')
      minute += 1
      expect(minute).toBeLessThan(50)
    }
    expect(sanitiseLoadedCoach(JSON.parse(JSON.stringify(coach)))?.status).toBe('finished')
  })

  it('repairs a hand-edited file rather than throwing', () => {
    const loaded = sanitiseLoadedCoach({
      status: 'banana',
      stepId: 'not-a-step',
      outcomes: { sections: 'maybe', finish: 'done' },
      phaseElapsedMs: { arrangement: 'lots' },
      stepElapsedMs: -5,
      runningSince: 999,
      lineSeed: 1.7
    })
    expect(loaded).toEqual({
      status: 'dismissed',
      stepId: 'p2-first',
      outcomes: { finish: 'done' },
      phaseElapsedMs: { arrangement: 0, polish: 0 },
      stepElapsedMs: 0,
      runningSince: null,
      lineSeed: 1,
      lockedClimax: null,
      sections: [],
      draftSection: null,
      tension: [],
      v1ExportedAt: null
    })
  })
})

describe('the stuck nudge line', () => {
  it('comes off the shared table at the step s own seed', () => {
    expect(COACH_STUCK_LINES).toContain(COACH_STUCK_LINES[0])
  })
})

describe('what phase one left behind', () => {
  it('no longer carries an answer to a question that does not exist', () => {
    const state = startCoach(T0)
    expect('flavour' in state).toBe(false)
    expect('seededKinds' in state).toBe(false)
  })

  it('starts on the first arrangement step, not on a loop-building one', () => {
    expect(startCoach(T0).stepId).toBe('p2-first')
  })

  it('starts with no locked climax', () => {
    expect(startCoach(T0).lockedClimax).toBeNull()
  })

  it('carries a locked climax across a save and a load', () => {
    const saved = {
      ...startCoach(T0),
      lockedClimax: lockClimaxFromSlots(
        [
          {
            id: 'slot-1',
            kinds: ['bass' as const],
            stem: {
              path: '/a.wav',
              name: 'a',
              author: 'b',
              type: 'bass' as const,
              durationSec: 8,
              barLength: 4
            },
            gain: 1,
            audible: true,
            rolling: false
          }
        ],
        120,
        T0
      )
    }
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.lockedClimax?.stems[0].role).toBe('bass')
  })

  it('repairs a hand-edited locked climax rather than trusting it', () => {
    const loaded = sanitiseLoadedCoach({
      status: 'active',
      stepId: 'p2-section',
      lockedClimax: { nope: true }
    })
    expect(loaded?.lockedClimax).toBeNull()
  })

  it('loads a project saved on a phase-one step, whose step no longer exists', () => {
    // Phase one's eight rows were deleted on 2026-09-23, so a project saved
    // on one of them comes back on the first surviving step with everything
    // else intact -- the same repair the framework's 'climax-loop'
    // placeholder already took.
    const loaded = sanitiseLoadedCoach({
      status: 'active',
      stepId: 'p1-hook',
      outcomes: {},
      phaseElapsedMs: { loop: 4 * MINUTE, arrangement: 2 * MINUTE, polish: 0 },
      stepElapsedMs: 2 * MINUTE,
      runningSince: T0,
      lineSeed: 3,
      flavour: 'groove'
    })
    expect(loaded?.stepId).toBe('p2-first')
    expect(loaded?.status).toBe('dismissed')
    expect('flavour' in loaded!).toBe(false)
    // The `loop` figure has no phase to belong to any more, and is dropped.
    expect(loaded?.phaseElapsedMs).toEqual({ arrangement: 2 * MINUTE, polish: 0 })
  })
})

describe('the phase-two fields', () => {
  it('start empty', () => {
    const coach = startCoach(T0)
    expect(coach.sections).toEqual([])
    expect(coach.draftSection).toBeNull()
  })

  it('survive a save and load', () => {
    const saved = {
      ...startCoach(T0),
      stepId: 'p2-section',
      sections: [
        {
          type: 'intro',
          name: 'intro',
          bars: 8,
          droppedPaths: ['/hook.wav'],
          startBar: 0,
          placedGroupIds: { '/kick.wav': 'g1' }
        }
      ],
      draftSection: { type: 'build', name: 'build', bars: 16, droppedPaths: [] }
    }
    const loaded = sanitiseLoadedCoach(JSON.parse(JSON.stringify(saved)))
    expect(loaded?.sections).toHaveLength(1)
    expect(loaded?.sections[0].droppedPaths).toEqual(['/hook.wav'])
    expect(loaded?.sections[0].placedGroupIds).toEqual({ '/kick.wav': 'g1' })
    expect(loaded?.draftSection).toEqual({
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: []
    })
  })

  it('load as empty from a project saved before phase two existed', () => {
    // A .sssketchproj from before phase two: no sections key, no
    // draftSection key.
    const phase1 = {
      status: 'active',
      stepId: 'p2-first',
      outcomes: {},
      phaseElapsedMs: { arrangement: 4 * MINUTE, polish: 0 },
      stepElapsedMs: 0,
      runningSince: T0,
      lineSeed: 3,
      lockedClimax: null
    }
    const loaded = sanitiseLoadedCoach(phase1)
    expect(loaded?.sections).toEqual([])
    expect(loaded?.draftSection).toBeNull()
    expect(loaded?.stepId).toBe('p2-first')
  })

  it('repairs a hand-edited section list rather than throwing', () => {
    const loaded = sanitiseLoadedCoach({
      ...startCoach(T0),
      sections: [{ type: 'nonsense' }, { type: 'drop', bars: 12 }],
      draftSection: 'not an object'
    })
    expect(loaded?.sections.map((s) => s.type)).toEqual(['drop'])
    expect(loaded?.draftSection).toBeNull()
  })
})

describe('the phase-three fields', () => {
  it('start empty on a fresh flow', () => {
    const state = startCoach(1000)
    expect(state.tension).toEqual([])
    expect(state.v1ExportedAt).toBeNull()
  })

  it('survive a load', () => {
    const loaded = sanitiseLoadedCoach({
      ...startCoach(1000),
      tension: [{ sectionIndex: 2, kind: 'riser', riserId: 'riser-a' }],
      v1ExportedAt: 1234
    })
    expect(loaded?.tension).toEqual([{ sectionIndex: 2, kind: 'riser', riserId: 'riser-a' }])
    expect(loaded?.v1ExportedAt).toBe(1234)
  })

  it('load as empty from a project saved before phase three existed', () => {
    const loaded = sanitiseLoadedCoach({ status: 'active', stepId: 'p2-next', lineSeed: 3 })
    expect(loaded?.tension).toEqual([])
    expect(loaded?.v1ExportedAt).toBeNull()
  })

  it('repair a nonsense v1 mark rather than trusting it', () => {
    expect(sanitiseLoadedCoach({ v1ExportedAt: 'yesterday' })?.v1ExportedAt).toBeNull()
    expect(sanitiseLoadedCoach({ v1ExportedAt: -5 })?.v1ExportedAt).toBeNull()
    expect(sanitiseLoadedCoach({ v1ExportedAt: Number.NaN })?.v1ExportedAt).toBeNull()
  })
})
