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
})
