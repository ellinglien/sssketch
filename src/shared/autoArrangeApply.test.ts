import { describe, expect, it } from 'vitest'
import {
  ARRANGE_FILL_BARS,
  ARRANGE_STEP_BARS,
  buildArrangeActions,
  type ArrangeMoveRecord
} from './autoArrangeApply'

describe('buildArrangeActions', () => {
  it('places the rifff at the current playhead when not already placed', () => {
    const actions = buildArrangeActions('g1', [], 1, false, 10)
    expect(actions).toContainEqual({ type: 'PLACE_ON_TIMELINE', groupId: 'g1', startBar: 10 })
  })

  it('does not place the rifff when already placed', () => {
    const actions = buildArrangeActions('g1', [], 1, true, 10)
    expect(actions.find((a) => a.type === 'PLACE_ON_TIMELINE')).toBeUndefined()
  })

  it('sets playedBars to totalSteps * ARRANGE_STEP_BARS for every stem with at least one move', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'enter' }]
    const actions = buildArrangeActions('g1', moves, 3, true, 0)
    expect(actions).toContainEqual({
      type: 'SET_PLAYED_BARS',
      key: 'g1:0',
      bars: 3 * ARRANGE_STEP_BARS
    })
  })

  it('a stem that only ever exits (never enters) is muted for the whole arrangement', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'exit' }]
    const actions = buildArrangeActions('g1', moves, 2, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: 2 * ARRANGE_STEP_BARS
    })
  })

  it('a stem entering at step 1 is muted before that and active after', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' }]
    const actions = buildArrangeActions('g1', moves, 3, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: 1 * ARRANGE_STEP_BARS
    })
    // no mute region should cover any part of bars [8, 24) since it's active there
    expect(
      muteRegions.some(
        (r) =>
          r.type === 'ADD_MUTE_REGION' &&
          r.startBar < 3 * ARRANGE_STEP_BARS &&
          r.endBar > 1 * ARRANGE_STEP_BARS
      )
    ).toBe(false)
  })

  it('a stem entering then exiting produces two mute regions around the active window', () => {
    const moves: ArrangeMoveRecord[] = [
      { stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' },
      { stepIndex: 2, stemKey: 'g1:0', moveType: 'exit' }
    ]
    const actions = buildArrangeActions('g1', moves, 4, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: 1 * ARRANGE_STEP_BARS
    })
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 2 * ARRANGE_STEP_BARS,
      endBar: 4 * ARRANGE_STEP_BARS
    })
  })

  it('a fill at step 0 is active only for the last ARRANGE_FILL_BARS bars of that step', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'fill' }]
    const actions = buildArrangeActions('g1', moves, 2, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    const fillActiveStart = ARRANGE_STEP_BARS - ARRANGE_FILL_BARS
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: fillActiveStart
    })
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: ARRANGE_STEP_BARS,
      endBar: 2 * ARRANGE_STEP_BARS
    })
  })

  it('a stem with no moves at all is left alone entirely (no playedBars/mute actions for it)', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'enter' }]
    const actions = buildArrangeActions('g1', moves, 2, true, 0)
    expect(actions.some((a) => a.type === 'SET_PLAYED_BARS' && a.key === 'g1:1')).toBe(false)
    expect(actions.some((a) => a.type === 'ADD_MUTE_REGION' && a.stemKeys.includes('g1:1'))).toBe(
      false
    )
  })
})
