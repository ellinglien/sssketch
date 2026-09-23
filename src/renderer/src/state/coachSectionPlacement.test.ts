import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
import { buildCoachSectionActions } from './coachSectionPlacement'
import type { LockedClimax, LockedClimaxStem } from '@shared/coachClimax'
import type { CoachSection, CoachSectionDraft } from '@shared/coachSections'
import { stemKey } from '@shared/types'

function stem(path: string): LockedClimaxStem {
  return {
    path,
    name: path.replace('/', '').replace('.wav', ''),
    author: 'e',
    type: 'drums',
    durationSec: 4,
    barLength: 4,
    kinds: ['drums'],
    role: 'drums',
    gain: 0.5
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: 0,
  stems: [stem('/kick.wav'), stem('/bass.wav'), stem('/hook.wav')]
}

/** Four bars a pass, which is this climax's own loop length -- so a pass
 * index reads straight off as bars * 4. */
const PHRASE = 4

/** A drop, because the fixture's answer to "what is this loop?" is 'drop':
 * the HOME section keeps every stem in every pass (coachMapTemplate.ts), so
 * a test that says nothing about cells is testing the write path rather than
 * the template. The staggered cases below ask for a different type on
 * purpose. */
function draft(overrides: Partial<CoachSectionDraft> = {}): CoachSectionDraft {
  return { type: 'drop', name: 'drop', passes: 4, cells: {}, ...overrides }
}

function build(
  state: AppState,
  overrides: Partial<CoachSectionDraft> = {},
  sections: readonly CoachSection[] = []
): ReturnType<typeof buildCoachSectionActions> {
  return buildCoachSectionActions(state, climax, draft(overrides), sections, 'drop', PHRASE)
}

function apply(state: AppState, actions: ReturnType<typeof buildCoachSectionActions>): AppState {
  return actions.actions.reduce((next, action) => reducer(next, action), state)
}

function placements(
  built: ReturnType<typeof buildCoachSectionActions>
): { startBar: number; count: number }[] {
  return built.actions
    .filter((action) => action.type === 'PLACE_LOOP_ON_TIMELINE')
    .map((action) => {
      if (action.type !== 'PLACE_LOOP_ON_TIMELINE') throw new Error('unreachable')
      return { startBar: action.startBar, count: action.stems.length }
    })
}

function resizeBars(built: ReturnType<typeof buildCoachSectionActions>): number[] {
  return built.actions
    .filter((action) => action.type === 'SET_PLAYED_BARS')
    .map((action) => {
      if (action.type !== 'SET_PLAYED_BARS') throw new Error('unreachable')
      return action.bars
    })
}

describe('buildCoachSectionActions', () => {
  it('places one clip per kept stem, at bar 0 on an empty project', () => {
    const built = build(initialState)
    expect(built.startBar).toBe(0)
    const place = built.actions[0]
    expect(place.type).toBe('PLACE_LOOP_ON_TIMELINE')
    if (place.type !== 'PLACE_LOOP_ON_TIMELINE') throw new Error('unreachable')
    expect(place.stems).toHaveLength(3)
    expect(place.startBar).toBe(0)
    // One stem per rifff, slot 1 -- the shape this action documents.
    for (const rifff of place.stems) expect(rifff.stems.map((s) => s.slot)).toEqual([1])
    // The locked gain rides along in the vol map, keyed by stemKey.
    for (const rifff of place.stems) {
      expect(place.vol?.[stemKey(rifff.groupId, 1)]).toBe(0.5)
    }
  })

  it('stretches each clip to the length of its own run, not the section', () => {
    // Nothing overridden in a home section, so every stem is one run of the
    // whole four passes -- sixteen bars at a four-bar phrase.
    expect(resizeBars(build(initialState))).toEqual([16, 16, 16])
  })

  it('places one clip per contiguous run, not one per section', () => {
    // The kick sits out pass 1, so it is two clips: pass 0, then passes 2-3.
    const built = build(initialState, { cells: { '1|/kick.wav': false } })
    expect(built.actions.filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')).toHaveLength(2)
    // kick: 4 bars then 8; bass and hook: 16 each.
    expect(resizeBars(built).sort((a, b) => a - b)).toEqual([4, 8, 16, 16])
  })

  it('places each run at its own bar, in ascending order, opening at the section start', () => {
    const built = build(initialState, { cells: { '1|/kick.wav': false } })
    const bars = placements(built).map((placement) => placement.startBar)
    expect(bars).toEqual([...bars].sort((a, b) => a - b))
    expect(bars).toEqual([0, 8])
  })

  it('carries every run that starts on the same bar in ONE placement', () => {
    // bass and hook run the whole section, the kick's first run starts with
    // them -- three clips at bar 0, one at bar 8.
    const built = build(initialState, { cells: { '1|/kick.wav': false } })
    expect(placements(built)).toEqual([
      { startBar: 0, count: 3 },
      { startBar: 8, count: 1 }
    ])
  })

  it('puts every run of one stem on that stem own row', () => {
    const built = build(initialState, { cells: { '1|/kick.wav': false } })
    const lane = built.placedGroupIds['/kick.wav']
    expect(lane).toBeDefined()
    const moves = built.actions.filter(
      (action) => action.type === 'MOVE_TO_CHANNEL' && action.channelId === lane
    )
    // The first run OWNS the lane and needs no move; the second is moved
    // onto it, so the stem keeps one row rather than opening a staircase.
    expect(moves).toHaveLength(1)
    const placed = apply(initialState, built)
    const secondRun = moves[0]
    if (secondRun.type !== 'MOVE_TO_CHANNEL') throw new Error('unreachable')
    expect(placed.channelOf[secondRun.groupId]).toBe(lane)
    expect(placed.rifffs[secondRun.groupId].startBar).toBe(8)
    expect(placed.playedBars[secondRun.groupId]).toBe(8)
  })

  it('follows the template across the passes when the user has overridden nothing', () => {
    // An intro against a drop-shaped loop staggers its arrivals
    // (coachMapTemplate.ts): the three stems come in on passes 0, 1 and 2.
    const built = buildCoachSectionActions(
      initialState,
      climax,
      { type: 'intro', name: 'intro', passes: 3, cells: {} },
      [],
      'drop',
      PHRASE
    )
    expect(placements(built)).toEqual([
      { startBar: 0, count: 1 },
      { startBar: 4, count: 1 },
      { startBar: 8, count: 1 }
    ])
    expect(resizeBars(built)).toEqual([12, 8, 4])
  })

  it('leaves a subtracted stem off the timeline entirely', () => {
    const cells = { '0|/hook.wav': false, '1|/hook.wav': false }
    const built = build(initialState, {
      passes: 2,
      cells
    })
    expect(Object.keys(built.placedGroupIds)).toEqual(['/kick.wav', '/bass.wav'])
    const state = apply(initialState, built)
    const names = Object.values(state.rifffs).map((r) => r.stems[0].path)
    expect(names).toEqual(['/kick.wav', '/bass.wav'])
  })

  it('places nothing at all for a section where nothing plays', () => {
    const cells = Object.fromEntries(
      climax.stems.flatMap((s) => [
        [`0|${s.path}`, false],
        [`1|${s.path}`, false]
      ])
    )
    const built = build(initialState, { passes: 2, cells })
    expect(built.actions).toEqual([])
    expect(built.placedGroupIds).toEqual({})
    expect(built.startBar).toBe(0)
  })

  it('starts after the previous section and reuses its channel rows', () => {
    const first = build(initialState)
    const afterFirst = apply(initialState, first)
    const sections: CoachSection[] = [
      {
        id: 'section-0',
        type: 'drop',
        name: 'drop',
        passes: 4,
        cells: {},
        startBar: 0,
        placedGroupIds: first.placedGroupIds
      }
    ]

    const second = build(afterFirst, { passes: 2 }, sections)
    expect(second.startBar).toBe(16)

    const moves = second.actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')
    expect(moves).toHaveLength(3)

    const afterSecond = apply(afterFirst, second)
    // One channel per STEM, not one per section: the second section's clip
    // for /kick.wav sits on the row the first section's clip created.
    for (const path of ['/kick.wav', '/bass.wav', '/hook.wav']) {
      expect(afterSecond.channelOf[second.placedGroupIds[path]]).toBe(first.placedGroupIds[path])
    }
    // And the clips really are where the sections say they are.
    expect(afterSecond.rifffs[second.placedGroupIds['/kick.wav']].startBar).toBe(16)
    expect(afterSecond.playedBars[second.placedGroupIds['/kick.wav']]).toBe(8)
  })

  it('gives a stem its own new lane the first time it appears', () => {
    const first = build(initialState, {
      passes: 2,
      cells: { '0|/hook.wav': false, '1|/hook.wav': false }
    })
    const afterFirst = apply(initialState, first)
    const sections: CoachSection[] = [
      {
        id: 'section-0',
        type: 'drop',
        name: 'drop',
        passes: 2,
        cells: { '0|/hook.wav': false, '1|/hook.wav': false },
        startBar: 0,
        placedGroupIds: first.placedGroupIds
      }
    ]
    const second = build(afterFirst, { passes: 2 }, sections)
    const moves = second.actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')
    // The hook was not in the first section, so it has no lane to rejoin.
    expect(moves).toHaveLength(2)
    const afterSecond = apply(afterFirst, second)
    const hookGroup = second.placedGroupIds['/hook.wav']
    expect(afterSecond.channelOf[hookGroup]).toBe(hookGroup)
  })

  it('records the FIRST run of each stem as the lane later sections rejoin', () => {
    const built = build(initialState, { cells: { '1|/kick.wav': false } })
    const first = built.actions.find((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')
    if (first?.type !== 'PLACE_LOOP_ON_TIMELINE') throw new Error('unreachable')
    const kickRunOne = first.stems.find((rifff) => rifff.stems[0].path === '/kick.wav')
    expect(built.placedGroupIds['/kick.wav']).toBe(kickRunOne?.groupId)
  })

  it('starts the first section after material already on the timeline', () => {
    const existing = build(initialState, { passes: 2 })
    const state = apply(initialState, existing)
    // No sections recorded, but the timeline is not empty -- e.g. a loop the
    // user plunked down from Discover before the map was built.
    expect(build(state).startBar).toBe(8)
  })
})
