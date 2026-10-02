import { describe, expect, it } from 'vitest'
import {
  loopTempoLabel,
  loopBarsLabel,
  nextLoopSelection,
  EMPTY_LOOP_SELECTION,
  type LoopSelection
} from './loopFolderView'

describe('loopTempoLabel', () => {
  it('shows a certain tempo plainly', () => {
    expect(loopTempoLabel({ bpm: 160, source: 'filename' })).toEqual({
      text: '160',
      guessed: false
    })
    expect(loopTempoLabel({ bpm: 87.5, source: 'user' })).toEqual({ text: '87.5', guessed: false })
  })

  it('marks a guess with ~ and rounds it', () => {
    expect(loopTempoLabel({ bpm: 164.83, source: 'siblings' })).toEqual({
      text: '~165',
      guessed: true
    })
    expect(loopTempoLabel({ bpm: 170, source: 'folder' })).toEqual({ text: '~170', guessed: true })
    expect(loopTempoLabel({ bpm: 106.667, source: 'length' })).toEqual({
      text: '~107',
      guessed: true
    })
  })

  it('shows ? when there is no tempo yet', () => {
    expect(loopTempoLabel({ bpm: null, source: null })).toEqual({ text: '?', guessed: true })
  })
})

describe('loopBarsLabel', () => {
  it('names the bar count', () => {
    expect(loopBarsLabel({ bars: 1 })).toBe('1 bar')
    expect(loopBarsLabel({ bars: 4 })).toBe('4 bars')
    expect(loopBarsLabel({ bars: null })).toBe('? bars')
  })
})

describe('nextLoopSelection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const plain = { shift: false, toggle: false }
  const shift = { shift: true, toggle: false }
  const toggle = { shift: false, toggle: true }
  const ids = (s: LoopSelection): string[] => [...s.selected].sort()

  it('a plain click selects just that loop and makes it the anchor', () => {
    const s = nextLoopSelection(EMPTY_LOOP_SELECTION, 'c', order, plain)
    expect(s.anchor).toBe('c')
    expect(ids(s)).toEqual(['c'])
  })

  it('shift-click selects the range from the anchor, in either direction, and keeps the anchor', () => {
    const anchored = nextLoopSelection(EMPTY_LOOP_SELECTION, 'b', order, plain)
    const forward = nextLoopSelection(anchored, 'd', order, shift)
    expect(forward.anchor).toBe('b')
    expect(ids(forward)).toEqual(['b', 'c', 'd'])
    const back = nextLoopSelection(forward, 'a', order, shift)
    expect(back.anchor).toBe('b')
    expect(ids(back)).toEqual(['a', 'b'])
  })

  it('shift-click with no anchor, or an anchor no longer on screen, acts as a plain click', () => {
    expect(ids(nextLoopSelection(EMPTY_LOOP_SELECTION, 'c', order, shift))).toEqual(['c'])
    const hidden: LoopSelection = { anchor: 'z', selected: new Set(['z']) }
    const s = nextLoopSelection(hidden, 'c', order, shift)
    expect(s.anchor).toBe('c')
    expect(ids(s)).toEqual(['c'])
  })

  it('cmd-click toggles one loop and moves the anchor to it', () => {
    const one = nextLoopSelection(EMPTY_LOOP_SELECTION, 'a', order, plain)
    const two = nextLoopSelection(one, 'd', order, toggle)
    expect(two.anchor).toBe('d')
    expect(ids(two)).toEqual(['a', 'd'])
    const back = nextLoopSelection(two, 'a', order, toggle)
    expect(back.anchor).toBe('a')
    expect(ids(back)).toEqual(['d'])
  })

  it('never mutates what it is given', () => {
    const one = nextLoopSelection(EMPTY_LOOP_SELECTION, 'a', order, plain)
    nextLoopSelection(one, 'd', order, toggle)
    expect(ids(one)).toEqual(['a'])
    expect(EMPTY_LOOP_SELECTION.selected.size).toBe(0)
  })
})
