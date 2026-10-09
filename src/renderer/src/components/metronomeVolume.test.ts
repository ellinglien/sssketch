import { describe, expect, it } from 'vitest'
import {
  DEFAULT_METRONOME_VOLUME,
  MAX_METRONOME_VOLUME,
  metronomeVolumeFromDrag
} from './metronomeVolume'

describe('metronomeVolumeFromDrag', () => {
  it('gets louder upward and quieter downward', () => {
    expect(metronomeVolumeFromDrag(DEFAULT_METRONOME_VOLUME, -40)).toBe(2)
    expect(metronomeVolumeFromDrag(DEFAULT_METRONOME_VOLUME, 40)).toBe(1)
  })

  it('clamps the gesture to silence and the safe maximum', () => {
    expect(metronomeVolumeFromDrag(1, 999)).toBe(0)
    expect(metronomeVolumeFromDrag(1, -999)).toBe(MAX_METRONOME_VOLUME)
  })
})
