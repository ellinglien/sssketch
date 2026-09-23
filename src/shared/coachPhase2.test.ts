import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { suggestedDropPaths } from './coachSections'
import {
  coachSectionLine,
  dropSuggestedCoachSectionStems,
  nudgeCoachSectionBars,
  placeCoachSection,
  setCoachSectionName,
  startCoachSection,
  toggleCoachSectionStem
} from './coachPhase2'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

function stem(path: string, kinds: LockedClimaxStem['kinds']): LockedClimaxStem {
  return {
    path,
    name: path,
    author: 'e',
    type: 'fx',
    durationSec: 4,
    barLength: 4,
    kinds,
    role: 'aux',
    gain: 1
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: T0,
  stems: [
    stem('/kick.wav', ['drums']),
    stem('/bass.wav', ['bass']),
    stem('/harmony.wav', ['lead', 'warm']),
    stem('/hook.wav', ['lead', 'bright'])
  ]
}

function locked(): CoachState {
  return { ...startCoach(T0), stepId: 'p2-first', lockedClimax: climax }
}

describe('startCoachSection', () => {
  it('opens a draft with EVERY stem on', () => {
    const state = startCoachSection(locked(), T0 + MINUTE, 'intro')
    expect(state.stepId).toBe('p2-section')
    expect(state.draftSection).toEqual({
      type: 'intro',
      name: 'intro',
      bars: 8,
      droppedPaths: []
    })
  })

  it('does nothing at all without a locked climax', () => {
    const unlocked = startCoach(T0)
    expect(startCoachSection(unlocked, T0 + MINUTE, 'intro')).toBe(unlocked)
  })

  it('banks the time spent on the question and marks it done', () => {
    const state = startCoachSection(locked(), T0 + 3 * MINUTE, 'build')
    expect(state.outcomes['p2-first']).toBe('done')
    expect(state.phaseElapsedMs.arrangement).toBe(3 * MINUTE)
    expect(state.stepElapsedMs).toBe(0)
    expect(state.runningSince).toBe(T0 + 3 * MINUTE)
  })

  it('rotates the line on every new section', () => {
    const first = startCoachSection(locked(), T0, 'intro')
    const second = startCoachSection(first, T0, 'build')
    expect(second.lineSeed).toBe(first.lineSeed + 1)
  })
})

describe('editing the draft', () => {
  const open = startCoachSection(locked(), T0, 'build')

  it('renames', () => {
    expect(setCoachSectionName(open, 'the long build').draftSection?.name).toBe('the long build')
  })

  it('nudges the length by four and eight, clamped', () => {
    expect(nudgeCoachSectionBars(open, 8).draftSection?.bars).toBe(24)
    expect(nudgeCoachSectionBars(open, -4).draftSection?.bars).toBe(12)
    const tiny = nudgeCoachSectionBars(nudgeCoachSectionBars(open, -8), -8)
    expect(tiny.draftSection?.bars).toBe(4)
    expect(nudgeCoachSectionBars(tiny, -8).draftSection?.bars).toBe(4)
  })

  it('toggles one stem off and back on', () => {
    const off = toggleCoachSectionStem(open, '/hook.wav')
    expect(off.draftSection?.droppedPaths).toEqual(['/hook.wav'])
    expect(toggleCoachSectionStem(off, '/hook.wav').draftSection?.droppedPaths).toEqual([])
  })

  it('ignores a path that is not in the locked climax', () => {
    expect(toggleCoachSectionStem(open, '/not-here.wav')).toBe(open)
  })

  it('leaves everything alone when no draft is open', () => {
    const closed = locked()
    expect(setCoachSectionName(closed, 'x')).toBe(closed)
    expect(nudgeCoachSectionBars(closed, 4)).toBe(closed)
    expect(toggleCoachSectionStem(closed, '/hook.wav')).toBe(closed)
    expect(dropSuggestedCoachSectionStems(closed)).toBe(closed)
  })
})

describe('dropSuggestedCoachSectionStems', () => {
  it('applies every flag at once, and ONLY when called', () => {
    const open = startCoachSection(locked(), T0, 'intro')
    // The draft was untouched until this call. That is the whole rule.
    expect(open.draftSection?.droppedPaths).toEqual([])
    const dropped = dropSuggestedCoachSectionStems(open)
    expect(dropped.draftSection?.droppedPaths).toEqual(suggestedDropPaths('intro', climax))
    expect(dropped.draftSection?.droppedPaths).toEqual(['/harmony.wav', '/hook.wav'])
  })

  it('merges with what the user already switched off, without duplicating', () => {
    const open = toggleCoachSectionStem(startCoachSection(locked(), T0, 'intro'), '/harmony.wav')
    const dropped = dropSuggestedCoachSectionStems(open)
    expect(dropped.draftSection?.droppedPaths).toEqual(['/harmony.wav', '/hook.wav'])
  })

  it('is a no-op on a drop, which suggests nothing', () => {
    const open = startCoachSection(locked(), T0, 'drop')
    expect(dropSuggestedCoachSectionStems(open)).toBe(open)
  })
})

describe('placeCoachSection', () => {
  const open = startCoachSection(locked(), T0, 'intro')

  it('records the section and asks what comes next', () => {
    const placed = placeCoachSection(open, T0 + MINUTE, 0, { '/kick.wav': 'g1' })
    expect(placed.stepId).toBe('p2-next')
    expect(placed.draftSection).toBeNull()
    expect(placed.sections).toEqual([
      {
        type: 'intro',
        name: 'intro',
        bars: 8,
        droppedPaths: [],
        startBar: 0,
        placedGroupIds: { '/kick.wav': 'g1' }
      }
    ])
    expect(placed.outcomes['p2-section']).toBe('done')
  })

  it('ends phase two when the section was an outro', () => {
    const outro = startCoachSection(locked(), T0, 'outro')
    const placed = placeCoachSection(outro, T0 + MINUTE, 40, {})
    expect(placed.stepId).toBe('p3-tension')
    expect(placed.outcomes['p2-next']).toBe('done')
  })

  it('keeps sections in the order they were placed', () => {
    const first = placeCoachSection(open, T0, 0, {})
    const second = placeCoachSection(startCoachSection(first, T0, 'build'), T0, 8, {})
    expect(second.sections.map((s) => s.type)).toEqual(['intro', 'build'])
  })

  it('does nothing without a draft', () => {
    const closed = locked()
    expect(placeCoachSection(closed, T0, 0, {})).toBe(closed)
  })
})

describe('coachSectionLine', () => {
  it('names the section being carved', () => {
    const open = startCoachSection(locked(), T0, 'drop')
    expect(coachSectionLine(open)).toContain('drop')
    expect(coachSectionLine(open)).not.toContain('{section}')
  })

  it('names the section just placed while asking what comes next', () => {
    const placed = placeCoachSection(startCoachSection(locked(), T0, 'intro'), T0, 0, {})
    expect(coachSectionLine(placed)).toContain('intro')
  })

  it('is null on every step that is not phase two', () => {
    expect(coachSectionLine(startCoach(T0))).toBeNull()
    expect(coachSectionLine(locked())).toBeNull()
  })

  it('is stable for one thought and rotates with the seed', () => {
    const open = startCoachSection(locked(), T0, 'drop')
    expect(coachSectionLine(open)).toBe(coachSectionLine(open))
    expect(coachSectionLine({ ...open, lineSeed: open.lineSeed + 1 })).not.toBe(
      coachSectionLine(open)
    )
  })
})
