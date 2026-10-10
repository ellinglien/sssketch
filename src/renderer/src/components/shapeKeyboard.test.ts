import { describe, expect, it } from 'vitest'
import {
  adjustShapeSnapIndex,
  shapeClipDragDestination,
  shapeClipResizeDestination,
  shapeGridSizePct,
  shapeOwnsKey,
  shapePlaybackStartBar,
  selectionForLaneMonitor
} from './shapeKeyboard'

describe('Shape keyboard ownership', () => {
  it.each([
    ['Delete', 'Delete', false],
    ['Backspace', 'Backspace', false],
    ['0', 'Digit0', false],
    [' ', 'Space', false],
    ['Escape', 'Escape', false],
    ['c', 'KeyC', true],
    ['e', 'KeyE', true],
    ['d', 'KeyD', true],
    ['v', 'KeyV', true],
    ['s', 'KeyS', true],
    ['1', 'Digit1', true],
    ['2', 'Digit2', true]
  ])('reserves %s even when an edit will be a no-op', (key, code, command) => {
    expect(shapeOwnsKey(key, code, command)).toBe(true)
  })

  it('does not capture ordinary typing', () => {
    expect(shapeOwnsKey('a', 'KeyA', false)).toBe(false)
  })

  it("leaves Cmd+Z to the app's undo routing, which EEEDIT claims", () => {
    expect(shapeOwnsKey('z', 'KeyZ', true)).toBe(false)
  })

  it('takes nothing while a dialog or menu is open, so its own keys (Escape) work', () => {
    for (const [key, code, command] of [
      ['Escape', 'Escape', false],
      [' ', 'Space', false],
      ['Delete', 'Delete', false],
      ['s', 'KeyS', true]
    ] as const)
      expect(shapeOwnsKey(key, code, command, true)).toBe(false)
  })

  it('mirrors Ableton grid narrowing and widening without entering the off option', () => {
    expect(adjustShapeSnapIndex(1, 4, 'narrower')).toBe(2)
    expect(adjustShapeSnapIndex(4, 4, 'narrower')).toBe(4)
    expect(adjustShapeSnapIndex(2, 4, 'wider')).toBe(1)
    expect(adjustShapeSnapIndex(0, 4, 'wider')).toBe(0)
    expect(adjustShapeSnapIndex(5, 4, 'wider')).toBe(3)
  })

  it('starts at the selected clip, riff start, or stopped position like Ableton', () => {
    expect(shapePlaybackStartBar([6, 2], 3.5, false)).toBe(2)
    expect(shapePlaybackStartBar([], 3.5, false)).toBe(0)
    expect(shapePlaybackStartBar([2], 3.5, true)).toBe(3.5)
  })

  it('turns the active snap interval into the visible lane-grid spacing', () => {
    expect(shapeGridSizePct(8, 1)).toBe(12.5)
    expect(shapeGridSizePct(8, 0.25)).toBe(3.125)
    expect(shapeGridSizePct(8, 0.125)).toBe(1.5625)
    expect(shapeGridSizePct(8, 0)).toBeNull()
  })

  it('steps clip drags on the visible grid and keeps the whole clip in the riff', () => {
    expect(shapeClipDragDestination(2.13, 2, 0.25, 8)).toBe(2.25)
    expect(shapeClipDragDestination(-0.2, 2, 0.25, 8)).toBe(0)
    expect(shapeClipDragDestination(7.8, 2, 0.25, 8)).toBe(6)
    expect(shapeClipDragDestination(2.13, 2, 0, 8)).toBe(2.13)
  })

  it('snaps clip edges while respecting available source material', () => {
    expect(
      shapeClipResizeDestination({
        rawBar: 2.13,
        edge: 'left',
        clipStart: 2,
        clipEnd: 6,
        sourceStart: 2,
        sourceEnd: 6,
        reversed: false,
        snapBars: 0.25,
        loopBars: 8
      })
    ).toBe(2.25)
    expect(
      shapeClipResizeDestination({
        rawBar: -3,
        edge: 'left',
        clipStart: 2,
        clipEnd: 6,
        sourceStart: 1,
        sourceEnd: 5,
        reversed: false,
        snapBars: 0.25,
        loopBars: 8
      })
    ).toBe(1)
    expect(
      shapeClipResizeDestination({
        rawBar: 9,
        edge: 'right',
        clipStart: 2,
        clipEnd: 6,
        sourceStart: 3,
        sourceEnd: 7,
        reversed: false,
        snapBars: 0.25,
        loopBars: 8
      })
    ).toBe(7)
  })

  it('uses the opposite source boundaries for reversed clip edges', () => {
    expect(
      shapeClipResizeDestination({
        rawBar: 0,
        edge: 'left',
        clipStart: 2,
        clipEnd: 6,
        sourceStart: 3,
        sourceEnd: 7,
        reversed: true,
        snapBars: 0,
        loopBars: 8
      })
    ).toBe(1)
    expect(
      shapeClipResizeDestination({
        rawBar: 8,
        edge: 'right',
        clipStart: 2,
        clipEnd: 6,
        sourceStart: 1,
        sourceEnd: 5,
        reversed: true,
        snapBars: 0,
        loopBars: 8
      })
    ).toBe(7)
  })

  it('converts available source material into destination time at the clip rate', () => {
    expect(
      shapeClipResizeDestination({
        rawBar: 8,
        edge: 'right',
        clipStart: 2,
        clipEnd: 4,
        sourceStart: 2,
        sourceEnd: 6,
        rate: 2,
        reversed: false,
        snapBars: 0,
        loopBars: 8
      })
    ).toBe(5)
  })
})

describe('selectionForLaneMonitor (m or s also selects its lane)', () => {
  const lane = ['b1', 'b2']
  it('selects the whole lane when the selection is elsewhere or empty', () => {
    expect([...selectionForLaneMonitor(new Set(['a1']), lane)]).toEqual(['b1', 'b2'])
    expect([...selectionForLaneMonitor(new Set(), lane)]).toEqual(['b1', 'b2'])
    expect([...selectionForLaneMonitor(new Set(['a1', 'b1']), lane)]).toEqual(['b1', 'b2'])
  })

  it('keeps a selection already inside that lane (the same set, so nothing re-renders)', () => {
    const current = new Set(['b2'])
    expect(selectionForLaneMonitor(current, lane)).toBe(current)
  })

  it('an empty lane selects nothing', () => {
    expect([...selectionForLaneMonitor(new Set(['a1']), [])]).toEqual([])
  })
})
