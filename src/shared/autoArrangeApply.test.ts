import { describe, expect, it } from 'vitest'
import {
  ARRANGE_FILL_BARS,
  ARRANGE_STEP_BARS,
  activeRangesForStem,
  groupIdFromStemKey,
  type ArrangeMoveRecord
} from './autoArrangeApply'

// buildArrangeActions (the old SET_PLAYED_BARS/ADD_MUTE_REGION-based apply
// path) and its own test suite were removed when auto-arrange's apply step
// switched to buildArrangeReplaceActions (state/selectors.ts), which builds
// independent PASTE_RIFFF clip copies per active window instead of muting
// the gaps inside one long clip -- see that function's own doc comment and
// selectors.test.ts for its coverage. activeRangesForStem is the one piece
// of pure logic from the old path that's still directly relied on (by
// buildArrangeReplaceActions), so its own behavior keeps direct coverage
// here rather than only being exercised indirectly the way it used to be
// (through buildArrangeActions's ADD_MUTE_REGION assertions).

describe('groupIdFromStemKey', () => {
  it('recovers the groupId by splitting on the last colon', () => {
    expect(groupIdFromStemKey('g1:0')).toBe('g1')
  })

  it('handles a uuid-shaped groupId (no colons of its own)', () => {
    expect(groupIdFromStemKey('550e8400-e29b-41d4-a716-446655440000:2')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    )
  })
})

describe('activeRangesForStem', () => {
  it('a stem with no moves at all has no active ranges', () => {
    expect(activeRangesForStem([], 2 * ARRANGE_STEP_BARS)).toEqual([])
  })

  it('a stem that only ever exits (never enters) has no active ranges', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'exit' }]
    expect(activeRangesForStem(moves, 2 * ARRANGE_STEP_BARS)).toEqual([])
  })

  it('a stem entering at step 1 is active from that step onward to the arrangement end', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' }]
    expect(activeRangesForStem(moves, 3 * ARRANGE_STEP_BARS)).toEqual([
      { startBar: 1 * ARRANGE_STEP_BARS, endBar: 3 * ARRANGE_STEP_BARS }
    ])
  })

  it('a stem entering then exiting produces exactly the one active window in between', () => {
    const moves: ArrangeMoveRecord[] = [
      { stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' },
      { stepIndex: 2, stemKey: 'g1:0', moveType: 'exit' }
    ]
    expect(activeRangesForStem(moves, 4 * ARRANGE_STEP_BARS)).toEqual([
      { startBar: 1 * ARRANGE_STEP_BARS, endBar: 2 * ARRANGE_STEP_BARS }
    ])
  })

  it('a fill at step 0 is active only for the last ARRANGE_FILL_BARS bars of that step', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'fill' }]
    const fillActiveStart = ARRANGE_STEP_BARS - ARRANGE_FILL_BARS
    expect(activeRangesForStem(moves, 2 * ARRANGE_STEP_BARS)).toEqual([
      { startBar: fillActiveStart, endBar: ARRANGE_STEP_BARS }
    ])
  })

  it('sorts out-of-order moves by stepIndex before walking them', () => {
    const moves: ArrangeMoveRecord[] = [
      { stepIndex: 2, stemKey: 'g1:0', moveType: 'exit' },
      { stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' }
    ]
    expect(activeRangesForStem(moves, 4 * ARRANGE_STEP_BARS)).toEqual([
      { startBar: 1 * ARRANGE_STEP_BARS, endBar: 2 * ARRANGE_STEP_BARS }
    ])
  })

  it('merges a fill that falls inside an already-active enter/exit window into one range', () => {
    const moves: ArrangeMoveRecord[] = [
      { stepIndex: 0, stemKey: 'g1:0', moveType: 'enter' },
      { stepIndex: 1, stemKey: 'g1:0', moveType: 'fill' },
      { stepIndex: 2, stemKey: 'g1:0', moveType: 'exit' }
    ]
    // The fill's own window (inside step 1) is already covered by the
    // enter(step0)/exit(step2) span, so mergeOverlapping collapses both
    // pushed ranges down to the one active window rather than leaving a
    // redundant overlapping second range.
    expect(activeRangesForStem(moves, 3 * ARRANGE_STEP_BARS)).toEqual([
      { startBar: 0, endBar: 2 * ARRANGE_STEP_BARS }
    ])
  })

  it('multiple enter/exit windows produce multiple separate active ranges', () => {
    const moves: ArrangeMoveRecord[] = [
      { stepIndex: 0, stemKey: 'g1:0', moveType: 'enter' },
      { stepIndex: 1, stemKey: 'g1:0', moveType: 'exit' },
      { stepIndex: 3, stemKey: 'g1:0', moveType: 'enter' },
      { stepIndex: 4, stemKey: 'g1:0', moveType: 'exit' }
    ]
    expect(activeRangesForStem(moves, 5 * ARRANGE_STEP_BARS)).toEqual([
      { startBar: 0, endBar: 1 * ARRANGE_STEP_BARS },
      { startBar: 3 * ARRANGE_STEP_BARS, endBar: 4 * ARRANGE_STEP_BARS }
    ])
  })
})
