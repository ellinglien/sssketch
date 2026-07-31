import { describe, expect, it } from 'vitest'
import {
  adaptiveLoopSewingWindowSamples,
  applyLoopMicroFade,
  applyLoopMicroFadeToChannel
} from './microFade'

function ramp(length: number): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = i
  return data
}

function sineWave(length: number, freqHz: number, sampleRate: number): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
  return data
}

describe('applyLoopMicroFadeToChannel', () => {
  it('blends the sample right at loopEnd exactly onto the start value (zero discontinuity at the seam)', () => {
    const data = ramp(20)
    applyLoopMicroFadeToChannel(data, 20, 4)
    expect(data[19]).toBeCloseTo(data[0], 5) // data[0] is untouched (0), so this lands on 0
  })

  it('leaves samples outside the window untouched', () => {
    const data = ramp(20)
    applyLoopMicroFadeToChannel(data, 20, 4)
    // Window covers the last 4 samples (16..19) — 15 is just outside it.
    expect(data[15]).toBeCloseTo(15, 5)
    expect(data[0]).toBeCloseTo(0, 5) // the start value itself is never touched
  })

  it('tapers smoothly from the original tail toward the start value across the window', () => {
    const data = new Float32Array(20).fill(100)
    data[0] = 0 // start value distinctly different from the rest
    applyLoopMicroFadeToChannel(data, 20, 4)
    expect(data[19]).toBeCloseTo(0, 4) // right at the seam: fully blended to the start value
    expect(data[15]).toBeCloseTo(100, 4) // just outside the window: untouched
    expect(data[17]).toBeGreaterThan(1) // partially blended, not equal to either extreme
    expect(data[17]).toBeLessThan(99)
  })

  it('blends relative to loopEndSample, not the buffer end, when the loop is shorter than the buffer', () => {
    const data = ramp(20)
    applyLoopMicroFadeToChannel(data, 10, 4)
    // The seam is at index 9 (loopEndSample - 1), so it blends fully to data[0].
    expect(data[9]).toBeCloseTo(data[0], 5)
    // Samples past loopEndSample are untouched by this call (they're beyond
    // where the loop wraps, e.g. tail padding) — a real bug this guards
    // against: writing past clampedLoopEnd instead of stopping there.
    expect(data[10]).toBeCloseTo(10, 5)
    expect(data[15]).toBeCloseTo(15, 5)
  })

  it('clamps the window to half the loop length for a very short loop, avoiding overlap with itself', () => {
    const data = new Float32Array(6).fill(100)
    data[0] = 0
    applyLoopMicroFadeToChannel(data, 6, 100) // requested window is way bigger than the loop
    // half of 6 = 3 -> window covers indices [3,6), meeting exactly in the middle.
    expect(data[2]).toBeCloseTo(100, 4) // untouched, outside the clamped window
    expect(data[5]).toBeCloseTo(0, 4) // seam: fully blended to start
  })

  it('does nothing for a zero-length window', () => {
    const data = new Float32Array(10).fill(1)
    applyLoopMicroFadeToChannel(data, 10, 0)
    expect(Array.from(data)).toEqual(new Array(10).fill(1))
  })
})

describe('adaptiveLoopSewingWindowSamples', () => {
  const sampleRate = 44100

  it('picks the max window for a bassy (low-frequency) tail', () => {
    const data = sineWave(8192, 50, sampleRate)
    expect(adaptiveLoopSewingWindowSamples(data, data.length, sampleRate)).toBe(4096)
  })

  it('picks the min window for a bright (high-frequency) tail', () => {
    const data = sineWave(8192, 5000, sampleRate)
    expect(adaptiveLoopSewingWindowSamples(data, data.length, sampleRate)).toBe(512)
  })

  it('picks something strictly between the two extremes for a mid-range tail', () => {
    const data = sineWave(8192, 400, sampleRate)
    const window = adaptiveLoopSewingWindowSamples(data, data.length, sampleRate)
    expect(window).toBeGreaterThan(512)
    expect(window).toBeLessThan(4096)
  })

  it('falls back to the min window for an invalid sample rate', () => {
    const data = sineWave(8192, 50, sampleRate)
    expect(adaptiveLoopSewingWindowSamples(data, data.length, 0)).toBe(512)
    expect(adaptiveLoopSewingWindowSamples(data, data.length, -sampleRate)).toBe(512)
  })

  it('falls back to the min window for a loop too short to analyze', () => {
    const data = new Float32Array([0.5])
    expect(adaptiveLoopSewingWindowSamples(data, 1, sampleRate)).toBe(512)
  })

  it('falls back to the min window for a near-silent tail, even though it has almost no zero crossings', () => {
    // Same low frequency as the "bassy" test above, but at 0.001 amplitude
    // -- a naive zero-crossing-only heuristic would misread this as bassy
    // too, and forcibly ramp near-silence up into whatever the head sounds
    // like (e.g. a downbeat's own onset for a re-one'd loop).
    const data = sineWave(8192, 50, sampleRate).map((v) => v * 0.001)
    expect(adaptiveLoopSewingWindowSamples(data, data.length, sampleRate)).toBe(512)
  })
})

describe('applyLoopMicroFade', () => {
  function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
    return {
      numberOfChannels: channels.length,
      length: channels[0].length,
      sampleRate,
      getChannelData: (ch: number) => channels[ch]
    } as unknown as AudioBuffer
  }

  function fakeContext(): AudioContext {
    return {
      createBuffer: (numChannels: number, length: number, sampleRate: number) => {
        const channels = Array.from({ length: numChannels }, () => new Float32Array(length))
        return {
          numberOfChannels: numChannels,
          length,
          sampleRate,
          getChannelData: (ch: number) => channels[ch]
        } as unknown as AudioBuffer
      }
    } as unknown as AudioContext
  }

  it('uses an adaptive window (not a fixed size) when windowSec is omitted', () => {
    const sampleRate = 44100
    const data = sineWave(8192, 50, sampleRate) // bassy -> should pick the 2048-sample max window
    const buf = fakeBuffer([data], sampleRate)
    const ctx = fakeContext()

    const result = applyLoopMicroFade(ctx, buf, data.length / sampleRate)

    // 1000 samples before the end is inside the adaptive (2048) window but
    // would be untouched by the old fixed 512-sample default -- confirms
    // the wider, bass-aware window actually took effect.
    const untouchedUnderOldDefault = data[data.length - 1000]
    expect(result.getChannelData(0)[data.length - 1000]).not.toBeCloseTo(
      untouchedUnderOldDefault,
      3
    )
  })

  it('returns a copy, leaving the original buffer untouched', () => {
    const original = ramp(100)
    const originalSnapshot = Float32Array.from(original)
    const buf = fakeBuffer([original], 1000) // 1000Hz -> 1ms/sample, easy math
    const ctx = fakeContext()

    const result = applyLoopMicroFade(ctx, buf, 0.1, 0.004) // loopEnd 100 samples, window 4 samples

    expect(result).not.toBe(buf)
    expect(Array.from(original)).toEqual(Array.from(originalSnapshot)) // untouched
    expect(result.getChannelData(0)[99]).toBeCloseTo(result.getChannelData(0)[0], 4) // the copy IS blended
  })

  it('applies the blend identically to every channel', () => {
    const chL = ramp(100)
    const chR = ramp(100).map((v) => v * 2)
    const buf = fakeBuffer([chL, chR], 1000)
    const ctx = fakeContext()

    const result = applyLoopMicroFade(ctx, buf, 0.1, 0.004)

    expect(result.getChannelData(0)[99]).toBeCloseTo(result.getChannelData(0)[0], 4)
    expect(result.getChannelData(1)[99]).toBeCloseTo(result.getChannelData(1)[0], 4)
    // Untouched, well outside the 4-sample window.
    expect(result.getChannelData(0)[50]).toBeCloseTo(50, 4)
    expect(result.getChannelData(1)[50]).toBeCloseTo(100, 4)
  })
})
