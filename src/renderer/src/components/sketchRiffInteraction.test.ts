import { describe, expect, it } from 'vitest'
import {
  sketchRiffClickAction,
  sketchRiffPlaybackHit,
  toggleRiffBatchSelection
} from './sketchRiffInteraction'

describe('sketchRiffPlaybackHit', () => {
  it('treats the circular glyph as the playback hit area', () => {
    expect(sketchRiffPlaybackHit(32, 32, 64, 64)).toBe(true)
    expect(sketchRiffPlaybackHit(32, 0, 64, 64)).toBe(true)
  })

  it('leaves the exposed square corners as selection-only areas', () => {
    expect(sketchRiffPlaybackHit(0, 0, 64, 64)).toBe(false)
    expect(sketchRiffPlaybackHit(63, 63, 64, 64)).toBe(false)
  })
})

describe('sketchRiffClickAction', () => {
  it('selects and starts an idle riff', () => {
    expect(sketchRiffClickAction(false, false, false, true)).toBe('select-and-play')
  })

  it('stops the playing riff without turning the click into a deselect', () => {
    expect(sketchRiffClickAction(true, true, false, true)).toBe('select-and-stop')
  })

  it('selects another riff and switches playback to it', () => {
    expect(sketchRiffClickAction(true, false, false, true)).toBe('select-and-switch')
  })

  it('only selects when the square outside the circular glyph is clicked', () => {
    expect(sketchRiffClickAction(false, false, false, false)).toBe('select-only')
    expect(sketchRiffClickAction(true, true, false, false)).toBe('select-only')
    expect(sketchRiffClickAction(true, false, false, false)).toBe('select-only')
  })

  it('ignores the click path while a native riff drag is ending', () => {
    expect(sketchRiffClickAction(true, true, true, true)).toBe('ignore-drag')
    expect(sketchRiffClickAction(false, false, true, false)).toBe('ignore-drag')
  })
})

describe('toggleRiffBatchSelection', () => {
  it('seeds the first plain-click anchor before adding the second riff', () => {
    expect([...toggleRiffBatchSelection(new Set(), 'a', 'b')]).toEqual(['a', 'b'])
  })

  it('toggles within an existing multi-selection', () => {
    expect([...toggleRiffBatchSelection(new Set(['a', 'b']), 'a', 'b')]).toEqual(['a'])
  })
})
