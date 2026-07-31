import { describe, expect, it } from 'vitest'
import { buildMetronomeBuffer, metronomeSampleAt } from './metronome'

describe('metronomeSampleAt', () => {
  const secPerBeat = 0.5 // 120bpm

  it('is silent well after a beat, before the next one arrives', () => {
    expect(metronomeSampleAt(0.2, secPerBeat)).toBe(0)
  })

  it('is nonzero just after a beat starts', () => {
    expect(Math.abs(metronomeSampleAt(0.001, secPerBeat))).toBeGreaterThan(0)
    expect(Math.abs(metronomeSampleAt(secPerBeat + 0.001, secPerBeat))).toBeGreaterThan(0)
  })

  it('is silent once the click window has fully elapsed', () => {
    expect(metronomeSampleAt(0.04, secPerBeat)).toBe(0) // click window is 30ms
  })

  it('decays in amplitude across the click window', () => {
    const early = Math.abs(metronomeSampleAt(0.001, secPerBeat))
    const late = Math.abs(metronomeSampleAt(0.02, secPerBeat))
    expect(late).toBeLessThan(early)
  })

  it('sounds a higher pitch on the downbeat than on other beats', () => {
    // Same tiny offset into the click window, different beats — count zero
    // crossings over a short fixed window as a cheap proxy for frequency
    // without needing an FFT: a higher-frequency tone crosses zero more often.
    function zeroCrossings(beatIndex: number): number {
      const beatStart = beatIndex * secPerBeat
      let prev = metronomeSampleAt(beatStart, secPerBeat)
      let crossings = 0
      for (let i = 1; i < 200; i++) {
        const t = beatStart + (i / 200) * 0.02
        const sample = metronomeSampleAt(t, secPerBeat)
        if (Math.sign(sample) !== Math.sign(prev) && sample !== 0) crossings++
        prev = sample
      }
      return crossings
    }
    expect(zeroCrossings(0)).toBeGreaterThan(zeroCrossings(1))
  })

  it('returns 0 for an invalid (zero or negative) tempo', () => {
    expect(metronomeSampleAt(0.001, 0)).toBe(0)
    expect(metronomeSampleAt(0.001, -1)).toBe(0)
  })

  it('returns 0 for negative time', () => {
    expect(metronomeSampleAt(-0.001, secPerBeat)).toBe(0)
  })

  it('stays phase-locked far into a long session', () => {
    const farBeatIndex = 100_000
    const t = farBeatIndex * secPerBeat + 0.001
    expect(Math.abs(metronomeSampleAt(t, secPerBeat))).toBeGreaterThan(0)
  })

  it('treats every beatsPerBar-th beat as the downbeat, not just beat 0', () => {
    // beat 4 is a downbeat under the default 4-beats-per-bar grouping — same
    // pitch character as beat 0 (same value at the same offset into the
    // click), distinct from beats 1-3.
    const beat0Sample = metronomeSampleAt(0 * secPerBeat + 0.0015, secPerBeat)
    const beat4Sample = metronomeSampleAt(4 * secPerBeat + 0.0015, secPerBeat)
    const beat1Sample = metronomeSampleAt(1 * secPerBeat + 0.0015, secPerBeat)
    expect(beat4Sample).toBeCloseTo(beat0Sample, 5)
    expect(beat4Sample).not.toBeCloseTo(beat1Sample, 5)
  })
})

describe('buildMetronomeBuffer', () => {
  function fakeContext(sampleRate: number): AudioContext {
    return {
      sampleRate,
      createBuffer: (numChannels: number, length: number, rate: number) => {
        const channels = Array.from({ length: numChannels }, () => new Float32Array(length))
        return {
          numberOfChannels: numChannels,
          length,
          sampleRate: rate,
          getChannelData: (ch: number) => channels[ch]
        } as unknown as AudioBuffer
      }
    } as unknown as AudioContext
  }

  it('builds a buffer of the requested duration at the context sample rate', () => {
    const ctx = fakeContext(1000) // 1000Hz -> easy math
    const buf = buildMetronomeBuffer(ctx, 2, 0.5)
    expect(buf.length).toBe(2000)
    expect(buf.sampleRate).toBe(1000)
  })

  it('starts on a downbeat click at sample 0', () => {
    const ctx = fakeContext(1000)
    const buf = buildMetronomeBuffer(ctx, 1, 0.5)
    const data = buf.getChannelData(0)
    // Sample 0 is exactly t=0, where sin(0)=0 — check just after instead.
    expect(Math.abs(data[1])).toBeGreaterThan(0)
  })
})
