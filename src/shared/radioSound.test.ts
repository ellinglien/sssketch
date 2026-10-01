import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOUND_SETTINGS,
  DUB_HIGHPASS_HZ,
  DUB_LOWPASS_HZ,
  DUB_MAX_DELAY_SEC,
  DUB_MAX_FEEDBACK,
  DUB_TO_REVERB,
  FAUST_DEFAULTS,
  MASTERING,
  REVERB_IR,
  REVERB_RETURN_DB,
  SOUND_LIMITS,
  glueThresholdDb,
  normalizeSoundSettings,
  saturationDrive,
  saturationMakeupDb,
  throwEveryBars,
  type SoundSettings
} from './radioSound'
import { ROW_PAN } from './radioPan'
import { THROW_EVERY_BARS } from './radioThrows'

describe('the shared numbers, as the web spec and the radio code state them', () => {
  it('the cavernous room: 30 ms pre-delay, 5 s lows, 4.5 s at 1 kHz, 2.2 s at 8 kHz, 1.5 s at 16 kHz', () => {
    expect(REVERB_IR.preDelaySec).toBe(0.03)
    expect(REVERB_IR.t60).toEqual([
      [125, 5.0],
      [250, 5.0],
      [500, 4.8],
      [1000, 4.5],
      [2000, 3.8],
      [4000, 3.0],
      [8000, 2.2],
      [16000, 1.5]
    ])
    expect(REVERB_RETURN_DB).toBe(-3.4)
  })

  it('mastering: -4 dB headroom, HP 25 Hz, +2 dB side shelf at 250 Hz, +1 dB shelves, -1 ceiling', () => {
    expect(MASTERING.headroomDb).toBe(-4)
    expect(MASTERING.highpassHz).toBe(25)
    expect(MASTERING.width).toEqual({ sideShelfHz: 250, sideGainDb: 2 })
    expect(MASTERING.lowShelf).toEqual({ hz: 100, gainDb: 1 })
    expect(MASTERING.highShelf).toEqual({ hz: 10000, gainDb: 1 })
    expect(MASTERING.ceilingDb).toBe(-1)
    expect(MASTERING.saturation).toEqual({ maxDrive: 2.4, bias: 0.1 })
    // the web's DynamicsCompressorNode fallback only (the native port runs the Faust path)
    expect(MASTERING.glue).toEqual({
      thresholdDb: -11,
      kneeDb: 0,
      ratio: 2,
      attackSec: 0.03,
      releaseSec: 0.25
    })
    expect(MASTERING.limiter).toEqual({
      thresholdDb: -1.5,
      kneeDb: 0,
      ratio: 20,
      attackSec: 0.001,
      releaseSec: 0.1
    })
  })

  it('the Faust stages at their .dsp defaults (what the web runs)', () => {
    expect(FAUST_DEFAULTS.glue).toEqual({ thresholdDb: -14, ratio: 2, kneeDb: 6 })
    expect(FAUST_DEFAULTS.truepeak).toEqual({
      ceilingDb: -1,
      releaseSec: 0.1,
      lookaheadSamples: 64,
      latencySamples: 75
    })
    expect(FAUST_DEFAULTS.pump).toEqual({
      depthDb: 4,
      attackSec: 0.003,
      releaseSec: 0.2,
      keyLowpassHz: 150
    })
    expect(FAUST_DEFAULTS.saturate).toEqual({ drive: 1.2, bias: 0.1 })
  })

  it('the dub echo: HP 200, LP 3500 in the loop, 0.15 to the reverb, 2 s line, feedback <= 0.95', () => {
    expect([DUB_HIGHPASS_HZ, DUB_LOWPASS_HZ, DUB_TO_REVERB]).toEqual([200, 3500, 0.15])
    expect(DUB_MAX_DELAY_SEC).toBe(2)
    expect(DUB_MAX_FEEDBACK).toBe(0.95)
  })
})

describe('the amount maps', () => {
  it('glue: 0.5 is -14 dB (glue.dsp default); more amount, lower threshold, -8..-20', () => {
    expect(glueThresholdDb(0.5)).toBe(-14)
    expect(glueThresholdDb(0)).toBe(-8)
    expect(glueThresholdDb(1)).toBe(-20)
    expect(glueThresholdDb(5)).toBe(-20)
    expect(glueThresholdDb(-1)).toBe(-8)
    expect(glueThresholdDb(Number.NaN)).toBe(-14)
  })

  it('saturation: amount 0..1 is drive 0..2.4, clamped; the default 0.5 is 1.2, the web default', () => {
    expect(saturationDrive(0.5)).toBeCloseTo(1.2, 12)
    expect(saturationDrive(DEFAULT_SOUND_SETTINGS.saturation.amount)).toBeCloseTo(
      FAUST_DEFAULTS.saturate.drive,
      12
    )
    expect(saturationDrive(0)).toBe(0)
    expect(saturationDrive(2)).toBe(2.4)
    expect(saturationDrive(-1)).toBe(0)
  })

  it('saturation makeup: +0.5 dB at a drive of 1.8, in proportion to the drive squared', () => {
    expect(saturationMakeupDb(1.8)).toBeCloseTo(0.5, 12)
    expect(saturationMakeupDb(0.9)).toBeCloseTo(0.125, 12)
    expect(saturationMakeupDb(0)).toBe(0)
  })

  it('throws: rare 32-64, normal 16-32 (the web), often 8-16 bars', () => {
    expect(throwEveryBars('normal')).toEqual([16, 32])
    expect(throwEveryBars('normal')).toEqual(THROW_EVERY_BARS)
    expect(throwEveryBars('rare')).toEqual([32, 64])
    expect(throwEveryBars('often')).toEqual([8, 16])
  })
})

describe('DEFAULT_SOUND_SETTINGS', () => {
  it('is all on, at the web values (saturation at half its range, lower than the old 1.8)', () => {
    const d = DEFAULT_SOUND_SETTINGS
    expect(d).toEqual({
      mastering: { on: true },
      glue: { on: true, amount: 0.5 },
      tone: { on: true },
      saturation: { on: true, amount: 0.5 },
      reverb: { room: 'cavern' },
      panning: { on: true, width: ROW_PAN },
      pump: { on: true, depthDb: 4 },
      throws: { on: true, rate: 'normal' },
      riserVariety: { on: true }
    } satisfies SoundSettings)
  })

  it('is frozen, so no caller can change the defaults under everyone else', () => {
    expect(Object.isFrozen(DEFAULT_SOUND_SETTINGS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SOUND_SETTINGS.glue)).toBe(true)
  })
})

describe('normalizeSoundSettings', () => {
  it('junk of any kind gives the defaults', () => {
    for (const junk of [undefined, null, 0, 'loud', [], true]) {
      expect(normalizeSoundSettings(junk)).toEqual(DEFAULT_SOUND_SETTINGS)
    }
  })

  it('fills a missing stage, or a missing or junk field, from the defaults given', () => {
    const off: SoundSettings = {
      mastering: { on: false },
      glue: { on: false, amount: 0.2 },
      tone: { on: false },
      saturation: { on: false, amount: 0.1 },
      reverb: { room: 'zita' },
      panning: { on: false, width: 0.1 },
      pump: { on: false, depthDb: 1 },
      throws: { on: false, rate: 'rare' },
      riserVariety: { on: false }
    }
    expect(normalizeSoundSettings({}, off)).toEqual(off)
    const got = normalizeSoundSettings(
      {
        glue: { on: 'yes', amount: 'lots' },
        reverb: { room: 'hall' },
        throws: { rate: 'always' },
        pump: 7
      },
      off
    )
    expect(got).toEqual(off)
  })

  it('keeps what is valid', () => {
    const got = normalizeSoundSettings({
      mastering: { on: false },
      saturation: { amount: 0.25 },
      reverb: { room: 'zita' },
      throws: { on: true, rate: 'often' }
    })
    expect(got.mastering.on).toBe(false)
    expect(got.saturation).toEqual({ on: true, amount: 0.25 })
    expect(got.reverb.room).toBe('zita')
    expect(got.throws).toEqual({ on: true, rate: 'often' })
    expect(got.glue).toEqual(DEFAULT_SOUND_SETTINGS.glue)
  })

  it('clamps the amounts to their ranges', () => {
    const got = normalizeSoundSettings({
      glue: { amount: 3 },
      saturation: { amount: -2 },
      panning: { width: 0.9 },
      pump: { depthDb: 40 }
    })
    expect(got.glue.amount).toBe(SOUND_LIMITS.glueAmount[1])
    expect(got.saturation.amount).toBe(SOUND_LIMITS.saturationAmount[0])
    expect(got.panning.width).toBe(SOUND_LIMITS.panWidth[1])
    expect(got.pump.depthDb).toBe(SOUND_LIMITS.pumpDepthDb[1])
    expect(SOUND_LIMITS).toEqual({
      glueAmount: [0, 1],
      saturationAmount: [0, 1],
      panWidth: [0, 0.5],
      pumpDepthDb: [0, 8]
    })
  })

  it('treats non-finite numbers as junk', () => {
    const got = normalizeSoundSettings({
      pump: { depthDb: Number.NaN },
      panning: { width: Infinity }
    })
    expect(got.pump.depthDb).toBe(4)
    expect(got.panning.width).toBe(ROW_PAN)
  })

  it('returns a fresh object, never the defaults themselves', () => {
    const got = normalizeSoundSettings(undefined)
    expect(got).not.toBe(DEFAULT_SOUND_SETTINGS)
    expect(got.glue).not.toBe(DEFAULT_SOUND_SETTINGS.glue)
    expect(Object.isFrozen(got)).toBe(false)
  })

  it('round-trips through JSON', () => {
    const s = normalizeSoundSettings({ reverb: { room: 'zita' }, pump: { depthDb: 6 } })
    expect(normalizeSoundSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
})
