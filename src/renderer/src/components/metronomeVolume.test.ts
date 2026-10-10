import { describe, expect, it } from 'vitest'
import {
  DEFAULT_METRONOME_VOLUME,
  MAX_METRONOME_VOLUME,
  METRONOME_VOLUME_BAR_MAX_PX,
  metronomeButtonTitle,
  metronomeVolumeBarPx,
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

describe('metronomeButtonTitle', () => {
  it('says on or off, the volume as a percentage, and how to change it', () => {
    expect(metronomeButtonTitle(true, 1.5)).toBe('metronome: on · 150% · drag up/down for volume')
    expect(metronomeButtonTitle(false, 0.333)).toBe(
      'metronome: off · 33% · drag up/down for volume'
    )
  })
})

describe('metronomeVolumeBarPx', () => {
  it('is full height at the maximum, empty at silence, and in between proportionally', () => {
    expect(metronomeVolumeBarPx(MAX_METRONOME_VOLUME)).toBe(METRONOME_VOLUME_BAR_MAX_PX)
    expect(metronomeVolumeBarPx(0)).toBe(0)
    expect(metronomeVolumeBarPx(1)).toBe(11)
  })

  it('never draws past the button', () => {
    expect(metronomeVolumeBarPx(9)).toBe(METRONOME_VOLUME_BAR_MAX_PX)
  })
})
