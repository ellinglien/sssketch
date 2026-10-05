// The loudness measurement (spec 2026-10-05-radio-intensity-arc-design section 7): stemLevel.ts.
import { describe, expect, it } from 'vitest'
import { kWeightingHighPass, kWeightingShelf, stemLevelFeatures, type Biquad } from './stemLevel'

/** A sine of `seconds` at `hz`, peak `dbfs`, at `fs`. */
function sine(hz: number, dbfs: number, seconds: number, fs: number): Float32Array {
  const a = Math.pow(10, dbfs / 20)
  const out = new Float32Array(Math.round(seconds * fs))
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / fs)
  return out
}

const close = (b: Biquad, want: number[]): void => {
  const got = [b.b0, b.b1, b.b2, b.a1, b.a2]
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 8))
}

describe('K-weighting', () => {
  it("matches BS.1770's 48 kHz table", () => {
    close(
      kWeightingShelf(48000),
      [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]
    )
    close(kWeightingHighPass(48000), [1, -2, 1, -1.99004745483398, 0.99007225036621])
  })
})

describe('stemLevelFeatures', () => {
  it('a 997 Hz sine at -20 dBFS: mono -23.0 LUFS, identical stereo -20.0', () => {
    const s = sine(997, -20, 10, 48000)
    expect(stemLevelFeatures([s], 48000).loudnessLufs).toBeCloseTo(-23.0, 1)
    expect(stemLevelFeatures([s, s.slice()], 48000).loudnessLufs).toBeCloseTo(-20.0, 1)
  })

  it('EBU Tech 3341 cases 1 and 2 (stereo 1 kHz at -23 and -33 dBFS)', () => {
    for (const db of [-23, -33]) {
      const s = sine(1000, db, 20, 48000)
      const l = stemLevelFeatures([s, s.slice()], 48000).loudnessLufs!
      expect(Math.abs(l - db)).toBeLessThanOrEqual(0.1)
    }
  })

  it('reads the same at 44.1 and 48 kHz', () => {
    for (const hz of [60, 997, 6000]) {
      const a = stemLevelFeatures([sine(hz, -18, 8, 44100)], 44100).loudnessLufs!
      const b = stemLevelFeatures([sine(hz, -18, 8, 48000)], 48000).loudnessLufs!
      expect(Math.abs(a - b), `${hz} Hz`).toBeLessThanOrEqual(0.1)
    }
  })

  it('gates silence: half the stem silent keeps the loudness, and about half is active', () => {
    const fs = 48000
    const tone = sine(997, -20, 10, fs)
    const half = new Float32Array(tone.length * 2)
    half.set(tone, 0)
    const full = stemLevelFeatures([tone], fs)
    const halved = stemLevelFeatures([half], fs)
    expect(Math.abs(halved.loudnessLufs! - full.loudnessLufs!)).toBeLessThanOrEqual(0.1)
    expect(full.activeFraction).toBe(1)
    expect(halved.activeFraction).toBeGreaterThan(0.45)
    expect(halved.activeFraction).toBeLessThan(0.55)
  })

  it('lowLevelDb: a 50 Hz sine sits 30 dB or more above a 5 kHz one at the same level', () => {
    const lo = stemLevelFeatures([sine(50, -12, 6, 48000)], 48000).lowLevelDb!
    const hi = stemLevelFeatures([sine(5000, -12, 6, 48000)], 48000).lowLevelDb!
    expect(lo - hi).toBeGreaterThanOrEqual(30)
    // a full-scale-ish 50 Hz sine at -12 dBFS peak: mean square a^2/2 -> -15.0 dBFS
    expect(lo).toBeCloseTo(-15.0, 0)
  })

  it('lowLevelDb is a level, not a balance: a sparse kick reads under a rolling one', () => {
    const fs = 48000
    const rolling = sine(55, -12, 4, fs)
    const sparse = new Float32Array(rolling.length)
    for (let i = 0; i < sparse.length; i++) if (i % fs < fs / 8) sparse[i] = rolling[i]
    const a = stemLevelFeatures([rolling], fs).lowLevelDb!
    const b = stemLevelFeatures([sparse], fs).lowLevelDb!
    expect(a - b).toBeGreaterThan(6)
  })

  it('silence, and nothing at all, give nulls', () => {
    const quiet = stemLevelFeatures([new Float32Array(48000 * 4)], 48000)
    expect(quiet).toEqual({ loudnessLufs: null, lowLevelDb: null, activeFraction: 0 })
    expect(stemLevelFeatures([], 48000)).toEqual({
      loudnessLufs: null,
      lowLevelDb: null,
      activeFraction: 0
    })
  })

  it('a stem shorter than a block still reads', () => {
    const r = stemLevelFeatures([sine(997, -20, 0.25, 48000)], 48000)
    expect(r.loudnessLufs).toBeCloseTo(-23.0, 0)
    expect(r.activeFraction).toBe(1)
  })
})
