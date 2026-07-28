import { describe, expect, it } from 'vitest'
import { loopLengthBarsFor } from './nativeExport'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from '../shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    {
      slot: 1,
      author: 'e',
      name: 'a',
      type: 'fx',
      path: '/a.wav',
      durationSec: 12.8,
      barLength: 8
    },
    { slot: 2, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 12.8, barLength: 8 }
  ]
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, rifffs: { r1: rifff }, ...overrides }
}

describe('loopLengthBarsFor', () => {
  it('falls back to the default when nothing is placed', () => {
    expect(loopLengthBarsFor(stateWith({ rifffs: {} }))).toBe(32)
  })

  it('uses the rifff-level end (startBar + barLength) when linked', () => {
    // startBar 4 + barLength 8 = 12
    expect(loopLengthBarsFor(stateWith({}))).toBe(12)
  })

  it('accounts for an unlinked stem dragged out past its group span', () => {
    // Group's own span would end at 4 + 8 = 12, but slot 2 has been dragged out
    // to stemStart 20, so its own end is 20 + 8 = 28 — that must win.
    const state = stateWith({
      unlinked: { r1: true },
      stemStart: { 'r1:2': 20 }
    })
    expect(loopLengthBarsFor(state)).toBe(28)
  })

  it('still uses the group startBar fallback for unlinked stems that were never dragged', () => {
    // Unlinked but no stemStart override recorded for either slot -> both fall
    // back to rifff.startBar (4), so the end is still 4 + 8 = 12.
    const state = stateWith({ unlinked: { r1: true } })
    expect(loopLengthBarsFor(state)).toBe(12)
  })
})
