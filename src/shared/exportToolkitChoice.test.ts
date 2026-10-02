import { describe, expect, it } from 'vitest'
import { exportToolkitChoice } from './exportToolkitChoice'
import { initialState, type AppState } from '../renderer/src/state/store'
import { normalizeSoundSettings, type SoundSettings } from './radioSound'
import { createRiser } from './riser'
import type { Rifff } from './types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'r',
  bpm: 120,
  barLength: 1,
  folderPath: '/x',
  startBar: 0,
  stems: [
    {
      slot: 1,
      author: 'e',
      name: 'k',
      type: 'drums',
      path: '/k.wav',
      durationSec: 2,
      barLength: 1
    },
    { slot: 2, author: 'e', name: 'n', type: 'notes', path: '/n.wav', durationSec: 2, barLength: 1 }
  ]
}
const panning = (on: boolean): SoundSettings => {
  const s = normalizeSoundSettings(undefined)
  s.panning.on = on
  return s
}
const state = (overrides: Partial<AppState>): AppState => ({
  ...initialState,
  rifffs: { r1: rifff },
  ...overrides
})

describe('exportToolkitChoice', () => {
  it('nothing per-stem: no choice, bake (today)', () => {
    expect(exportToolkitChoice(state({ sound: panning(false) }))).toEqual({
      offer: false,
      defaultMode: 'bake'
    })
  })

  it('pan the only per-stem stage: offered, starting on automation', () => {
    expect(exportToolkitChoice(state({ sound: panning(true) }))).toEqual({
      offer: true,
      defaultMode: 'automation'
    })
  })

  it('a risers-only project with pans still starts on automation (risers are audio either way)', () => {
    const risers = { a: createRiser({ id: 'a', channelId: 'r1', startBar: 0 }) }
    expect(exportToolkitChoice(state({ sound: panning(true), risers }))).toEqual({
      offer: true,
      defaultMode: 'automation'
    })
  })

  it('any clip toolkit keeps the bake default', () => {
    expect(
      exportToolkitChoice(state({ sound: panning(true), stemSends: { 'r1:2': 0.5 } }))
    ).toEqual({ offer: true, defaultMode: 'bake' })
    expect(
      exportToolkitChoice(state({ sound: panning(false), stemSends: { 'r1:2': 0.5 } }))
    ).toEqual({ offer: true, defaultMode: 'bake' })
  })

  it("the timeline's throws (Task 12) offer the choice, and do not move the default", () => {
    const throwing = (pan: boolean, throws: boolean): AppState => {
      const sound = panning(pan)
      sound.throws.on = throws
      // 64 bars: room for a throw (one comes round every 16-32 bars)
      return state({ sound, playedBars: { r1: 64 }, projectSeed: 'choice' })
    }
    expect(exportToolkitChoice(throwing(false, true))).toEqual({ offer: true, defaultMode: 'bake' })
    expect(exportToolkitChoice(throwing(true, true))).toEqual({
      offer: true,
      defaultMode: 'automation'
    })
    expect(exportToolkitChoice(throwing(false, false))).toEqual({
      offer: false,
      defaultMode: 'bake'
    })
  })
})
