import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { cellIsOn } from './coachCells'
import {
  coachSectionLine,
  nudgeCoachSectionPasses,
  placeCoachSection,
  setCoachSectionName,
  startCoachSection,
  toggleCoachSectionCell,
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

/** A flow with the loop locked and the two answers already given, at a
 * 4-bar phrase -- which is what every section-editing test below needs. */
function locked(): CoachState {
  return {
    ...startCoach(T0),
    stepId: 'p2-first',
    lockedClimax: climax,
    phrase: { bars: 4, source: 'nominal' },
    loopIs: 'drop'
  }
}

describe('startCoachSection', () => {
  it('opens a draft that overrides NOTHING -- the template fills it in', () => {
    const state = startCoachSection(locked(), T0 + MINUTE, 'intro')
    expect(state.stepId).toBe('p2-section')
    expect(state.draftSection).toEqual({
      type: 'intro',
      name: 'intro',
      // The 8-bar intro target, at the 4-bar phrase the user answered.
      passes: 2,
      cells: {}
    })
  })

  it('sizes the draft from the PHRASE, not from a hardcoded bar count', () => {
    const atEight = { ...locked(), phrase: { bars: 8, source: 'nominal' as const } }
    // The same 8-bar target is one pass of an 8-bar loop and two of a 4-bar.
    expect(startCoachSection(atEight, T0, 'intro').draftSection?.passes).toBe(1)
    expect(startCoachSection(locked(), T0, 'intro').draftSection?.passes).toBe(2)
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

  it('nudges the length by one and two PASSES, clamped', () => {
    const opened = open.draftSection!.passes
    expect(nudgeCoachSectionPasses(open, 2).draftSection?.passes).toBe(opened + 2)
    const tiny = nudgeCoachSectionPasses(nudgeCoachSectionPasses(open, -2), -2)
    expect(tiny.draftSection?.passes).toBe(1)
    expect(nudgeCoachSectionPasses(tiny, -2)).toBe(tiny)
  })

  it('toggles one stem off and back on, across every pass', () => {
    const passes = open.draftSection!.passes
    // The kick plays in a build (the table only drops the hook there), so
    // the first toggle writes an explicit OFF.
    const off = toggleCoachSectionStem(open, '/kick.wav')
    for (let pass = 0; pass < passes; pass += 1) {
      expect(cellIsOn(off.draftSection!.cells, pass, '/kick.wav', true)).toBe(false)
    }
    const backOn = toggleCoachSectionStem(off, '/kick.wav')
    for (let pass = 0; pass < passes; pass += 1) {
      expect(cellIsOn(backOn.draftSection!.cells, pass, '/kick.wav', false)).toBe(true)
    }
  })

  it('reads the TEMPLATE for a stem the user has not touched', () => {
    // A build drops the hook, so the template already says off -- the first
    // toggle therefore turns it ON rather than off again.
    const on = toggleCoachSectionStem(open, '/hook.wav')
    expect(cellIsOn(on.draftSection!.cells, 0, '/hook.wav', false)).toBe(true)
  })

  it('toggles ONE cell without touching its neighbours', () => {
    const one = toggleCoachSectionCell(open, 1, '/kick.wav')
    expect(Object.keys(one.draftSection!.cells)).toEqual(['1|/kick.wav'])
    expect(one.draftSection!.cells['1|/kick.wav']).toBe(false)
  })

  it('ignores a path that is not in the locked climax', () => {
    expect(toggleCoachSectionStem(open, '/not-here.wav')).toBe(open)
    expect(toggleCoachSectionCell(open, 0, '/not-here.wav')).toBe(open)
  })

  it('leaves everything alone when no draft is open', () => {
    const closed = locked()
    expect(setCoachSectionName(closed, 'x')).toBe(closed)
    expect(nudgeCoachSectionPasses(closed, 1)).toBe(closed)
    expect(toggleCoachSectionStem(closed, '/hook.wav')).toBe(closed)
    expect(toggleCoachSectionCell(closed, 0, '/hook.wav')).toBe(closed)
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
        id: 'section-0',
        type: 'intro',
        name: 'intro',
        passes: 2,
        cells: {},
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
