// src/shared/radioSound.ts -- the radio sound's settings and shared numbers (native radio sound
// plan, docs/superpowers/plans/2026-10-01-native-radio-sound.md, Task 0).
//
// THE SETTINGS. One SoundSettings object says which of the radio's stages are on and how much:
// stored per project, a new project starting from the app-wide defaults (all on, Elling,
// 2026-10-01), and a legacy project without one opening with those defaults too. Discover, the
// timeline, live playback and every bounce read it. The engine never sees the amounts: callers
// resolve them through the maps below (glueThresholdDb, saturationDrive, throwEveryBars) and put
// parameters on the wire.
//
// THE NUMBERS. The web radio's (ell.ing/radio, docs/specs/2026-09-30-radio-a-design.md section
// 3) constants, moved here so the web and the app share one copy: the cavernous room, the
// mastering chain, the Faust stages' defaults and the dub echo. Each has a C++ twin pinned by a
// native test (later tasks).
//
// SATURATION (Elling, 2026-10-01, listening: "a little too strong" at the old drive 1.8). It is
// an amount 0..1, drive = amount x 1.8, as the web's listener control (Engine.setSaturation): 1
// is the drive it was built at (1.8% THD on a -14 dBFS sine), the default 0.5 half of it (drive
// 0.9, 0.83% THD, a dense mix's peaks rounded by about 2 dB). The makeup follows the drive
// squared (+0.5 dB at 1.8), and a drive of 0 is an exact pass-through (faust/saturate.dsp).

import { ROW_PAN } from './radioPan'
import { THROW_EVERY_BARS } from './radioThrows'

// ---------------------------------------------------------------------------------------------
// the shared numbers

/** The room the default reverb plays: a cavernous space, smooth and dark (Elling, 2026-10-01:
 * "more cavernous"). White noise whose every frequency decays at its own rate -- the highs die
 * first, so the tail darkens as it goes, as a big room's air and walls do -- after 30 ms of
 * silence. The web's noise.ts reverbImpulse builds it; natively, CavernReverb. */
export interface ReverbIr {
  preDelaySec: number
  /** The T60 curve: [Hz, seconds] points, rising in Hz; log-frequency interpolation between,
   * held flat beyond the ends. */
  t60: readonly (readonly [number, number])[]
}

export const REVERB_IR: ReverbIr = {
  preDelaySec: 0.03,
  t60: [
    [125, 5.0],
    [250, 5.0],
    [500, 4.8],
    [1000, 4.5],
    [2000, 3.8],
    [4000, 3.0],
    [8000, 2.2],
    [16000, 1.5]
  ]
}

/** The convolver's return trim, dB: the ConvolverNode normalises an impulse's total power, but a
 * longer, darker room still sums louder on a steady signal; measured (the radio's
 * spike/engine-check reverbRooms), this keeps the send at the same wet level as the 2.5 s room
 * before it. */
export const REVERB_RETURN_DB = -3.4

/** The light mastering chain (the web's masterChain.ts MASTERING, the same shape). */
export const MASTERING = {
  /** Before the bypass split, so bypass A/Bs the chain at the same level: stems at unity are
   * loud (four measured at -8.9 dB RMS, +3.7 dBFS peaks), and this brings a dense mix toward
   * the spec's ~-14 LUFS with only light compression doing the rest. */
  headroomDb: -4,
  /** Gentle tape-style saturation before the glue (faust/saturate.dsp): drive = amount x
   * maxDrive (saturationDrive): 1 is the drive it was built at (1.8, "a little too strong"), the
   * default 0.5 half of it. */
  saturation: { maxDrive: 1.8, bias: 0.1 },
  highpassHz: 25,
  /** The web's DynamicsCompressorNode FALLBACK glue only: the Faust glue (FAUST_DEFAULTS.glue)
   * is what plays, and what the native port runs. A starting point, to tune by ear. Measured
   * (headless render, the radio's spike/engine-check): four real stems (drums, bass, lead at 110
   * bpm, a backing pad), after the headroom trim, get 1.5-2.9 dB of reduction (median 2.0) at
   * -11 and come out at -13.8 dB RMS; -18 gave 4.4-5.9 dB, and without the trim 6-8 dB. */
  glue: {
    thresholdDb: -11,
    kneeDb: 0,
    ratio: 2,
    attackSec: 0.03,
    releaseSec: 0.25
  },
  /** Light stereo width (Elling, 2026-09-30: "a light thing that expands the audio slightly"):
   * mid/side, the side through a high shelf so it gains ~2 dB above ~250 Hz and bass stays
   * centred; the mid is untouched, so the mono sum (L+R = 2 * mid) is exactly unchanged. No Haas
   * delay, no decorrelation: it only scales what is already different between L and R. */
  width: { sideShelfHz: 250, sideGainDb: 2 },
  lowShelf: { hz: 100, gainDb: 1 },
  highShelf: { hz: 10000, gainDb: 1 },
  /** The web's DynamicsCompressorNode FALLBACK limiter only (FAUST_DEFAULTS.truepeak plays). */
  limiter: { thresholdDb: -1.5, kneeDb: 0, ratio: 20, attackSec: 0.001, releaseSec: 0.1 },
  /** The ceiling, dBTP; the fallback limiter's threshold is lifted to it ("makeup to about -1
   * dBFS"). */
  ceilingDb: -1,
  /** The web's bypass crossfade time constant (setTargetAtTime): ~99% across in 5 tau = 50 ms.
   * Wet and dry fade with the same exponential, so their gains always sum to 1. */
  bypassFadeTau: 0.01
} as const

/** The Faust stages at their .dsp defaults: what the web runs (its loadFaust sets none of these
 * but the saturation drive and the pump depth, from the listener's amounts). */
export const FAUST_DEFAULTS = {
  glue: { thresholdDb: -14, ratio: 2, kneeDb: 6 },
  truepeak: { ceilingDb: -1, releaseSec: 0.1, lookaheadSamples: 64, latencySamples: 75 },
  pump: { depthDb: 4, attackSec: 0.003, releaseSec: 0.2, keyLowpassHz: 150 },
  saturate: { drive: 0.9, bias: 0.1 }
} as const

/** The dub echo (the web's dubDelay.ts): a stereo ping-pong whose loop runs through a highpass
 * and a lowpass, so each repeat is darker; a little of it feeds the reverb. */
export const DUB_HIGHPASS_HZ = 200
export const DUB_LOWPASS_HZ = 3500
/** How much of the echo also feeds the reverb. */
export const DUB_TO_REVERB = 0.15
/** The delay line's length, s. */
export const DUB_MAX_DELAY_SEC = 2
/** Feedback is clamped to this: never a runaway loop. */
export const DUB_MAX_FEEDBACK = 0.95

// ---------------------------------------------------------------------------------------------
// the settings

export type ReverbRoom = 'cavern' | 'zita'
export type ThrowRate = 'rare' | 'normal' | 'often'

export const REVERB_ROOMS: readonly ReverbRoom[] = ['cavern', 'zita']
export const THROW_RATES: readonly ThrowRate[] = ['rare', 'normal', 'often']

export interface SoundSettings {
  /** The headroom trim and the -1 dBTP limiter; glue, tone and saturation need it on. */
  mastering: { on: boolean }
  /** amount 0..1 -> threshold -8..-20 dB (glueThresholdDb); 0.5 is -14, glue.dsp's default. */
  glue: { on: boolean; amount: number }
  /** HP 25 Hz, width, and +1 dB shelves at 100 Hz and 10 kHz. */
  tone: { on: boolean }
  /** amount 0..1 -> drive 0..1.8 (saturationDrive); 0.5 is 0.9, the web's default. */
  saturation: { on: boolean; amount: number }
  /** zita keeps its own roomSize/damping/preDelayMs (the project's `reverb`). */
  reverb: { room: ReverbRoom }
  /** The pan for rows that are not drums or bass, 0..0.5; ROW_PAN (0.25) is the web's. */
  panning: { on: boolean; width: number }
  /** The pump's depth, dB, 0..8; 4 is the web's. */
  pump: { on: boolean; depthDb: number }
  /** rare 32-64, normal 16-32 (the web's), often 8-16 bars between throws (throwEveryBars). */
  throws: { on: boolean; rate: ThrowRate }
  /** Radio's transition risers draw a character; hand-drawn risers keep theirs. */
  riserVariety: { on: boolean }
}

/** Each amount's range; normalizeSoundSettings clamps to these. */
export const SOUND_LIMITS = {
  glueAmount: [0, 1],
  saturationAmount: [0, 1],
  panWidth: [0, 0.5],
  pumpDepthDb: [0, 8]
} as const

function deepFreeze<T extends object>(o: T): Readonly<T> {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v)
  return Object.freeze(o)
}

/** The app-wide defaults: everything on, at the web's values. Frozen; normalizeSoundSettings
 * hands out fresh copies. */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = deepFreeze({
  mastering: { on: true },
  glue: { on: true, amount: 0.5 },
  tone: { on: true },
  saturation: { on: true, amount: 0.5 },
  reverb: { room: 'cavern' },
  panning: { on: true, width: ROW_PAN },
  pump: { on: true, depthDb: FAUST_DEFAULTS.pump.depthDb },
  throws: { on: true, rate: 'normal' },
  riserVariety: { on: true }
})

const clampTo = (v: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, v))
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Anything (a saved project's `sound`, the app-wide JSON) to a whole SoundSettings: a missing or
 * junk stage or field falls back to `defaults`'s; the amounts are clamped to SOUND_LIMITS. Always
 * a fresh object. */
export function normalizeSoundSettings(
  value: unknown,
  defaults: SoundSettings = DEFAULT_SOUND_SETTINGS
): SoundSettings {
  const v = isRecord(value) ? value : {}
  const stage = (key: keyof SoundSettings): Record<string, unknown> => {
    const s = v[key]
    return isRecord(s) ? s : {}
  }
  const on = (key: keyof SoundSettings, fallback: boolean): boolean => {
    const x = stage(key).on
    return typeof x === 'boolean' ? x : fallback
  }
  const num = (
    key: keyof SoundSettings,
    field: string,
    fallback: number,
    range: readonly [number, number]
  ): number => {
    const x = stage(key)[field]
    return typeof x === 'number' && Number.isFinite(x) ? clampTo(x, range) : fallback
  }
  const pick = <T extends string>(
    key: keyof SoundSettings,
    field: string,
    options: readonly T[],
    fallback: T
  ): T => {
    const x = stage(key)[field]
    return options.includes(x as T) ? (x as T) : fallback
  }
  const d = defaults
  return {
    mastering: { on: on('mastering', d.mastering.on) },
    glue: {
      on: on('glue', d.glue.on),
      amount: num('glue', 'amount', d.glue.amount, SOUND_LIMITS.glueAmount)
    },
    tone: { on: on('tone', d.tone.on) },
    saturation: {
      on: on('saturation', d.saturation.on),
      amount: num('saturation', 'amount', d.saturation.amount, SOUND_LIMITS.saturationAmount)
    },
    reverb: { room: pick('reverb', 'room', REVERB_ROOMS, d.reverb.room) },
    panning: {
      on: on('panning', d.panning.on),
      width: num('panning', 'width', d.panning.width, SOUND_LIMITS.panWidth)
    },
    pump: {
      on: on('pump', d.pump.on),
      depthDb: num('pump', 'depthDb', d.pump.depthDb, SOUND_LIMITS.pumpDepthDb)
    },
    throws: {
      on: on('throws', d.throws.on),
      rate: pick('throws', 'rate', THROW_RATES, d.throws.rate)
    },
    riserVariety: { on: on('riserVariety', d.riserVariety.on) }
  }
}

// ---------------------------------------------------------------------------------------------
// the amount maps (the wire carries what these return, never the amounts)

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback)

/** The glue's threshold for an amount: more glue, a lower threshold. 0 -> -8 dB, 0.5 -> -14
 * (glue.dsp's default, what the web runs), 1 -> -20; a non-number is the default's. */
export function glueThresholdDb(amount: number): number {
  return -8 - 12 * clampTo(finiteOr(amount, 0.5), SOUND_LIMITS.glueAmount)
}

/** The saturation's drive for an amount: 0..1 -> 0..1.8 (the web's masterChain.ts
 * saturationDrive); a non-number is 0, no saturation. */
export function saturationDrive(amount: number): number {
  return clampTo(finiteOr(amount, 0), SOUND_LIMITS.saturationAmount) * MASTERING.saturation.maxDrive
}

/** The saturation's makeup at a drive, dB: +0.5 at 1.8 (where it level-matched a dense mix), in
 * proportion to the drive squared (faust/saturate.dsp has the same). */
export function saturationMakeupDb(drive: number): number {
  return 0.5 * (drive / 1.8) ** 2
}

/** Bars between throws for a rate, drawn uniformly per throw (stepThrows' everyBars). */
export function throwEveryBars(rate: ThrowRate): readonly [number, number] {
  if (rate === 'rare') return [32, 64]
  if (rate === 'often') return [8, 16]
  return THROW_EVERY_BARS
}
