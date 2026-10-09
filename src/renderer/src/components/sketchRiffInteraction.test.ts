import { describe, expect, it } from 'vitest'
import { sketchRiffClickAction, toggleSketchBatchSelection } from './sketchRiffInteraction'

describe('sketchRiffClickAction', () => {
  it('selects and starts an idle riff', () => {
    expect(sketchRiffClickAction(false, false, false)).toBe('select-and-play')
  })

  it('stops the playing riff without turning the click into a deselect', () => {
    expect(sketchRiffClickAction(true, true, false)).toBe('select-and-stop')
  })

  it('selects another riff and switches playback to it', () => {
    expect(sketchRiffClickAction(true, false, false)).toBe('select-and-switch')
  })

  it('ignores the click path while a native riff drag is ending', () => {
    expect(sketchRiffClickAction(true, true, true)).toBe('ignore-drag')
    expect(sketchRiffClickAction(false, false, true)).toBe('ignore-drag')
  })
})

describe('toggleSketchBatchSelection', () => {
  it('seeds the first plain-click anchor before adding the second riff', () => {
    expect([...toggleSketchBatchSelection(new Set(), 'a', 'b')]).toEqual(['a', 'b'])
  })

  it('toggles within an existing multi-selection', () => {
    expect([...toggleSketchBatchSelection(new Set(['a', 'b']), 'a', 'b')]).toEqual(['a'])
  })
})
