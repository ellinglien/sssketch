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

describe('stemLevelFeatures: edges (Task 12 review follow-ups)', () => {
  const finiteOrNull = (v: number | null): boolean => v === null || Number.isFinite(v)

  it('a stem under one 100 ms hop is one short block: it still has a loudness', () => {
    const r = stemLevelFeatures([sine(997, -20, 0.05, 48000)], 48000)
    expect(r.loudnessLufs).not.toBeNull()
    expect(r.loudnessLufs!).toBeCloseTo(-23.0, 0)
    expect(r.activeFraction).toBe(1)
    // a 99 ms stem, just under the hop, reads within a dB of a 250 ms one
    const short = stemLevelFeatures([sine(997, -20, 0.099, 48000)], 48000).loudnessLufs!
    const block = stemLevelFeatures([sine(997, -20, 0.25, 48000)], 48000).loudnessLufs!
    expect(Math.abs(short - block)).toBeLessThan(1)
  })

  it('a single sample neither throws nor gives NaN', () => {
    const r = stemLevelFeatures([new Float32Array([0.5])], 44100)
    expect(finiteOrNull(r.loudnessLufs)).toBe(true)
    expect(finiteOrNull(r.lowLevelDb)).toBe(true)
    expect(Number.isFinite(r.activeFraction)).toBe(true)
  })

  it('NaN and infinite samples read as silence: nothing non-finite comes out', () => {
    const fs = 48000
    const clean = sine(997, -20, 4, fs)
    const dirty = clean.slice()
    dirty[1000] = NaN
    dirty[90000] = Infinity
    dirty[150000] = -Infinity
    const zeroed = clean.slice()
    zeroed[1000] = 0
    zeroed[90000] = 0
    zeroed[150000] = 0
    const got = stemLevelFeatures([dirty], fs)
    expect(Number.isFinite(got.loudnessLufs)).toBe(true)
    expect(Number.isFinite(got.lowLevelDb)).toBe(true)
    expect(Number.isFinite(got.activeFraction)).toBe(true)
    expect(got).toEqual(stemLevelFeatures([zeroed], fs))
    const allNaN = stemLevelFeatures([new Float32Array(fs).fill(NaN)], fs)
    expect(allNaN).toEqual({ loudnessLufs: null, lowLevelDb: null, activeFraction: 0 })
  })

  it('unequal stereo channels: the shorter one is silent past its end', () => {
    const fs = 48000
    const left = sine(997, -20, 4, fs)
    const right = sine(220, -26, 2, fs)
    const padded = new Float32Array(left.length)
    padded.set(right)
    const a = stemLevelFeatures([left, right], fs)
    const b = stemLevelFeatures([left, padded], fs)
    expect(a.loudnessLufs!).toBeCloseTo(b.loudnessLufs!, 1)
    expect(a.lowLevelDb!).toBeCloseTo(b.lowLevelDb!, 1)
    expect(a.activeFraction).toBe(b.activeFraction)
    // and the order of the channels does not matter
    expect(stemLevelFeatures([right, left], fs)).toEqual(a)
  })

  it('the relative gate leaves out a section 35 dB down (it would pull the loudness ~3 LU)', () => {
    const fs = 48000
    const loud = sine(997, -20, 5, fs)
    const quiet = sine(997, -55, 5, fs)
    const both = new Float32Array(loud.length + quiet.length)
    both.set(loud, 0)
    both.set(quiet, loud.length)
    const r = stemLevelFeatures([both], fs)
    const alone = stemLevelFeatures([loud], fs).loudnessLufs!
    // the quiet half passes the absolute gate (-58 LUFS > -70), so only the relative gate keeps it
    // out: averaged in, the two halves would read about 3 LU under the loud one
    expect(Math.abs(r.loudnessLufs! - alone)).toBeLessThanOrEqual(0.2)
    expect(r.activeFraction).toBeGreaterThan(0.45)
    expect(r.activeFraction).toBeLessThan(0.55)
  })

  it('lowLevelDb reads the same at 44.1 and 48 kHz, through the corner', () => {
    for (const hz of [40, 100, 150, 300]) {
      const a = stemLevelFeatures([sine(hz, -12, 6, 44100)], 44100).lowLevelDb!
      const b = stemLevelFeatures([sine(hz, -12, 6, 48000)], 48000).lowLevelDb!
      expect(Math.abs(a - b), `${hz} Hz`).toBeLessThanOrEqual(0.1)
    }
  })
})
