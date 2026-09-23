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

function draft(overrides: Partial<CoachSectionDraft> = {}): CoachSectionDraft {
  return { type: 'intro', name: 'intro', bars: 16, droppedPaths: [], ...overrides }
}

function apply(state: AppState, actions: ReturnType<typeof buildCoachSectionActions>): AppState {
  return actions.actions.reduce((next, action) => reducer(next, action), state)
}

describe('buildCoachSectionActions', () => {
  it('places one clip per kept stem, at bar 0 on an empty project', () => {
    const built = buildCoachSectionActions(initialState, climax, draft(), [])
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

  it('stretches each clip to the section length', () => {
    const built = buildCoachSectionActions(initialState, climax, draft({ bars: 16 }), [])
    const resizes = built.actions.filter((a) => a.type === 'SET_PLAYED_BARS')
    expect(resizes).toHaveLength(3)
    for (const resize of resizes) {
      if (resize.type !== 'SET_PLAYED_BARS') throw new Error('unreachable')
      expect(resize.bars).toBe(16)
    }
  })

  it('leaves a subtracted stem off the timeline entirely', () => {
    const built = buildCoachSectionActions(
      initialState,
      climax,
      draft({ droppedPaths: ['/hook.wav'] }),
      []
    )
    expect(Object.keys(built.placedGroupIds)).toEqual(['/kick.wav', '/bass.wav'])
    const state = apply(initialState, built)
    const names = Object.values(state.rifffs).map((r) => r.stems[0].path)
    expect(names).toEqual(['/kick.wav', '/bass.wav'])
  })

  it('places nothing at all for a section with every stem switched off', () => {
    const built = buildCoachSectionActions(
      initialState,
      climax,
      draft({ droppedPaths: ['/kick.wav', '/bass.wav', '/hook.wav'] }),
      []
    )
    expect(built.actions).toEqual([])
    expect(built.placedGroupIds).toEqual({})
    expect(built.startBar).toBe(0)
  })

  it('starts after the previous section and reuses its channel rows', () => {
    const first = buildCoachSectionActions(initialState, climax, draft(), [])
    const afterFirst = apply(initialState, first)
    const sections: CoachSection[] = [
      {
        type: 'intro',
        name: 'intro',
        bars: 16,
        droppedPaths: [],
        startBar: 0,
        placedGroupIds: first.placedGroupIds
      }
    ]

    const second = buildCoachSectionActions(
      afterFirst,
      climax,
      draft({ type: 'drop', name: 'drop', bars: 8 }),
      sections
    )
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
    const first = buildCoachSectionActions(
      initialState,
      climax,
      draft({ droppedPaths: ['/hook.wav'] }),
      []
    )
    const afterFirst = apply(initialState, first)
    const sections: CoachSection[] = [
      {
        type: 'intro',
        name: 'intro',
        bars: 16,
        droppedPaths: ['/hook.wav'],
        startBar: 0,
        placedGroupIds: first.placedGroupIds
      }
    ]
    const second = buildCoachSectionActions(afterFirst, climax, draft({ type: 'drop' }), sections)
    const moves = second.actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')
    // The hook was not in the intro, so it has no lane to rejoin.
    expect(moves).toHaveLength(2)
    const afterSecond = apply(afterFirst, second)
    const hookGroup = second.placedGroupIds['/hook.wav']
    expect(afterSecond.channelOf[hookGroup]).toBe(hookGroup)
  })

  it('starts the first section after material already on the timeline', () => {
    const existing = buildCoachSectionActions(initialState, climax, draft({ bars: 8 }), [])
    const state = apply(initialState, existing)
    // No sections recorded, but the timeline is not empty -- e.g. a Discover
    // loop the user plunked down during phase one.
    const built = buildCoachSectionActions(state, climax, draft(), [])
    expect(built.startBar).toBe(8)
  })
})
