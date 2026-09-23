import { describe, expect, it } from 'vitest'
import { createRiser } from '@shared/riser'
import { stemKey, type Rifff } from '@shared/types'
import type { CoachSection } from '@shared/coachSections'
import type { CoachTensionApplied } from '@shared/coachTension'
import {
  buildCoachTensionActions,
  buildCoachTensionRemovalActions,
  coachRiserChannelId
} from './coachTensionApply'
import { initialState, reducer, type AppState } from './store'

function rifff(groupId: string, startBar: number): Rifff {
  return {
    groupId,
    name: groupId,
    bpm: 120,
    barLength: 4,
    folderPath: '/tmp',
    startBar,
    stems: [
      {
        slot: 1,
        author: 'a',
        name: `${groupId} stem`,
        type: 'drums',
        path: `/tmp/${groupId}.wav`,
        durationSec: 8,
        barLength: 4
      }
    ]
  }
}

const section: CoachSection = {
  type: 'build',
  name: 'build',
  bars: 16,
  droppedPaths: [],
  startBar: 8,
  placedGroupIds: { '/tmp/a.wav': 'a', '/tmp/b.wav': 'b' }
}

function placed(): AppState {
  return {
    ...initialState,
    bpm: 120,
    rifffs: { a: rifff('a', 8), b: rifff('b', 8) },
    playedBars: { a: 16, b: 16 },
    stretch: { a: true, b: true },
    channelOf: { a: 'a', b: 'b' },
    channelOrder: ['a', 'b']
  }
}

const ids = { riserId: 'riser-1', channelId: 'channel-new' }

describe('buildCoachTensionActions -- the curve moves', () => {
  it('writes one group automation per clip in the section', () => {
    const { actions, riserId } = buildCoachTensionActions(placed(), section, 'swell', ids)
    expect(riserId).toBeNull()
    expect(actions).toEqual([
      {
        type: 'SET_GROUP_AUTOMATION',
        groupId: 'a',
        param: 'volume',
        points: [
          { bar: 0, value: 0 },
          { bar: 16, value: 1 }
        ]
      },
      {
        type: 'SET_GROUP_AUTOMATION',
        groupId: 'b',
        param: 'volume',
        points: [
          { bar: 0, value: 0 },
          { bar: 16, value: 1 }
        ]
      }
    ])
  })

  it('writes the sweep onto the filter lane, not the volume lane', () => {
    const { actions } = buildCoachTensionActions(placed(), section, 'filter-sweep', ids)
    expect(
      actions.every((a) => a.type === 'SET_GROUP_AUTOMATION' && a.param === 'filterCutoff')
    ).toBe(true)
  })

  it('really lands on the clips when the reducer runs it', () => {
    const state = placed()
    const { actions } = buildCoachTensionActions(state, section, 'fade', ids)
    const after = actions.reduce(reducer, state)
    expect(after.stemAutomation[stemKey('a', 1)]?.volume).toEqual([
      { bar: 0, value: 1 },
      { bar: 16, value: 0 }
    ])
  })

  it('measures the clip"s REAL length, not the section"s, so a resize is respected', () => {
    const state = { ...placed(), playedBars: { a: 8, b: 16 } }
    const { actions } = buildCoachTensionActions(state, section, 'fade', ids)
    const first = actions[0]
    expect(first.type).toBe('SET_GROUP_AUTOMATION')
    if (first.type === 'SET_GROUP_AUTOMATION') {
      expect(first.points[first.points.length - 1].bar).toBe(8)
    }
  })

  it('skips a clip the user has since deleted rather than throwing', () => {
    const state = { ...placed(), rifffs: { a: rifff('a', 8) } }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    expect(actions).toHaveLength(1)
  })
})

describe('buildCoachTensionActions -- the riser', () => {
  it('drops one riser ending on the join, as long as the bars leading in', () => {
    const { actions, riserId } = buildCoachTensionActions(placed(), section, 'riser', ids)
    expect(riserId).toBe('riser-1')
    expect(actions).toHaveLength(1)
    const [action] = actions
    expect(action.type).toBe('ADD_RISER')
    if (action.type === 'ADD_RISER') {
      expect(action.riser.startBar).toBe(8)
      expect(action.riser.lengthBars).toBe(16)
      expect(action.riser.channelId).toBe('channel-new')
      // An ORDINARY riser: the same defaults createRiser gives the
      // right-click menu's own "add riser here".
      const byHand = createRiser({ id: 'x', channelId: 'y', startBar: 8, lengthBars: 16 })
      expect(action.riser.startCutoffValue).toBe(byHand.startCutoffValue)
      expect(action.riser.endCutoffValue).toBe(byHand.endCutoffValue)
      expect(action.riser.level).toBe(byHand.level)
      expect(action.riser.curve).toEqual(byHand.curve)
    }
  })

  it('really lands on the timeline when the reducer runs it', () => {
    const state = placed()
    const { actions } = buildCoachTensionActions(state, section, 'riser', ids)
    const after = actions.reduce(reducer, state)
    expect(after.risers['riser-1']?.channelId).toBe('channel-new')
    expect(after.channelOrder).toContain('channel-new')
  })
})

describe('coachRiserChannelId', () => {
  it('reuses the row the last flow-placed riser is on', () => {
    const state = placed()
    const withRiser = reducer(state, {
      type: 'ADD_RISER',
      riser: createRiser({ id: 'riser-a', channelId: 'risers', startBar: 0 })
    })
    const applied: CoachTensionApplied[] = [{ sectionIndex: 0, kind: 'riser', riserId: 'riser-a' }]
    expect(coachRiserChannelId(withRiser, applied)).toBe('risers')
  })

  it('is null when the flow has placed none, or its riser has been deleted', () => {
    expect(coachRiserChannelId(placed(), [])).toBeNull()
    expect(
      coachRiserChannelId(placed(), [{ sectionIndex: 0, kind: 'riser', riserId: 'gone' }])
    ).toBeNull()
  })
})

describe('buildCoachTensionRemovalActions', () => {
  it('clears the parameter on every clip -- the same thing right-clicking a lane does', () => {
    const actions = buildCoachTensionRemovalActions(placed(), section, 'swell', null)
    expect(actions).toEqual([
      { type: 'SET_GROUP_AUTOMATION', groupId: 'a', param: 'volume', points: [] },
      { type: 'SET_GROUP_AUTOMATION', groupId: 'b', param: 'volume', points: [] }
    ])
  })

  it('removes exactly the riser the flow placed', () => {
    expect(buildCoachTensionRemovalActions(placed(), section, 'riser', 'riser-1')).toEqual([
      { type: 'REMOVE_RISER', id: 'riser-1' }
    ])
  })

  it('removes nothing when there is no riser id on record', () => {
    expect(buildCoachTensionRemovalActions(placed(), section, 'riser', null)).toEqual([])
  })
})
