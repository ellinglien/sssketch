import { describe, expect, it } from 'vitest'
import { createRiser } from '@shared/riser'
import { initialState } from './store'
import { stateWithMixerMute } from './mixerMute'

describe('stateWithMixerMute', () => {
  it('combines durable disable and temporary mixer mute without mutating either layer', () => {
    const state = {
      ...initialState,
      mute: { 'r1:1': true },
      mixerMute: { 'r1:1': false, 'r2:1': true }
    }

    const effective = stateWithMixerMute(state)

    expect(effective.mute).toEqual({ 'r1:1': true, 'r2:1': true })
    expect(state.mute).toEqual({ 'r1:1': true })
    expect(state.mixerMute).toEqual({ 'r1:1': false, 'r2:1': true })
  })

  it('applies temporary mixer mute to risers without changing their durable state', () => {
    const riser = createRiser({ id: 'rise', channelId: 'ch', startBar: 0 })
    const state = {
      ...initialState,
      risers: { rise: riser },
      mixerMute: { rise: true }
    }

    const effective = stateWithMixerMute(state)

    expect(effective.risers.rise.muted).toBe(true)
    expect(state.risers.rise.muted).toBe(false)
  })

  it('lets Solo temporarily override Mute while durable Disable still wins', () => {
    const state = {
      ...initialState,
      rifffs: {
        one: {
          groupId: 'one',
          name: 'one',
          bpm: 120,
          barLength: 4,
          folderPath: '/one',
          startBar: 0,
          stems: [
            {
              slot: 1,
              author: 'a',
              name: 'one',
              type: 'fx' as const,
              path: '/one.wav',
              durationSec: 8,
              barLength: 4
            }
          ]
        },
        two: {
          groupId: 'two',
          name: 'two',
          bpm: 120,
          barLength: 4,
          folderPath: '/two',
          startBar: 0,
          stems: [
            {
              slot: 1,
              author: 'a',
              name: 'two',
              type: 'fx' as const,
              path: '/two.wav',
              durationSec: 8,
              barLength: 4
            }
          ]
        }
      },
      mute: { 'one:1': true },
      mixerMute: { 'one:1': true },
      mixerSolo: ['one:1']
    }

    const effective = stateWithMixerMute(state)

    expect(effective.mute['one:1']).toBe(true)
    expect(effective.mute['two:1']).toBe(true)
    expect(state.mixerMute['one:1']).toBe(true)
    expect(state.mixerSolo).toEqual(['one:1'])
  })

  it('reveals the original temporary Mute after Solo clears', () => {
    const soloed = {
      ...initialState,
      mixerMute: { 'one:1': true },
      mixerSolo: ['one:1']
    }
    expect(stateWithMixerMute(soloed).mute['one:1']).toBeUndefined()
    expect(stateWithMixerMute({ ...soloed, mixerSolo: null }).mute['one:1']).toBe(true)
  })
})
