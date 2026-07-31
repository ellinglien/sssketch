import { describe, expect, it } from 'vitest'
import { applyLoopMicroFade, applyLoopMicroFadeToChannel } from './microFade'

describe('applyLoopMicroFadeToChannel', () => {
  it('ramps the first fadeSamples up from 0 and the last fadeSamples (before loopEnd) down to 0', () => {
    const data = new Float32Array(20).fill(1)
    applyLoopMicroFadeToChannel(data, 20, 4)
    expect(data[0]).toBeCloseTo(0, 5)
    expect(data[1]).toBeCloseTo(0.25, 5)
    expect(data[2]).toBeCloseTo(0.5, 5)
    expect(data[3]).toBeCloseTo(0.75, 5)
    expect(data[4]).toBeCloseTo(1, 5) // past the fade-in window, untouched
    expect(data[16]).toBeCloseTo(1, 5) // 20 - 4 = 16, start of fade-out window
    expect(data[17]).toBeCloseTo(0.75, 5)
    expect(data[18]).toBeCloseTo(0.5, 5)
    expect(data[19]).toBeCloseTo(0.25, 5)
  })

  it('fades out relative to loopEndSample, not the buffer end, when the loop is shorter than the buffer', () => {
    const data = new Float32Array(20).fill(1)
    applyLoopMicroFadeToChannel(data, 10, 4)
    expect(data[6]).toBeCloseTo(1, 5) // 10 - 4 = 6, start of fade-out window
    expect(data[9]).toBeCloseTo(0.25, 5) // just before the loop point
    // Samples past loopEndSample are untouched by this call (they're beyond
    // where the loop wraps, e.g. tail padding) — a real bug this guards
    // against: writing past clampedLoopEnd instead of stopping there.
    expect(data[10]).toBeCloseTo(1, 5)
    expect(data[15]).toBeCloseTo(1, 5)
  })

  it('clamps the fade to half the loop length for a very short loop, avoiding overlap', () => {
    const data = new Float32Array(6).fill(1)
    applyLoopMicroFadeToChannel(data, 6, 100) // requested fade is way bigger than the loop
    // half of 6 = 3 -> fade-in [0,3), fade-out [3,6), meeting exactly in the middle.
    expect(data[0]).toBeCloseTo(0, 5)
    expect(data[2]).toBeCloseTo(2 / 3, 5)
    expect(data[3]).toBeCloseTo(1, 5)
    expect(data[5]).toBeCloseTo(1 / 3, 5)
  })

  it('does nothing for a zero-length fade', () => {
    const data = new Float32Array(10).fill(1)
    applyLoopMicroFadeToChannel(data, 10, 0)
    expect(Array.from(data)).toEqual(new Array(10).fill(1))
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

  it('returns a copy, leaving the original buffer untouched', () => {
    const original = new Float32Array(100).fill(1)
    const buf = fakeBuffer([original], 1000) // 1000Hz -> 1ms/sample, easy math
    const ctx = fakeContext()

    const result = applyLoopMicroFade(ctx, buf, 0.1, 0.003) // loopEnd 100 samples, fade 3 samples

    expect(result).not.toBe(buf)
    expect(original.every((v) => v === 1)).toBe(true) // untouched
    expect(result.getChannelData(0)[0]).toBeCloseTo(0, 5) // the copy IS faded
  })

  it('applies the fade identically to every channel', () => {
    const chL = new Float32Array(100).fill(0.5)
    const chR = new Float32Array(100).fill(0.8)
    const buf = fakeBuffer([chL, chR], 1000)
    const ctx = fakeContext()

    const result = applyLoopMicroFade(ctx, buf, 0.1, 0.003)

    expect(result.getChannelData(0)[0]).toBeCloseTo(0, 5)
    expect(result.getChannelData(1)[0]).toBeCloseTo(0, 5)
    expect(result.getChannelData(0)[50]).toBeCloseTo(0.5, 5)
    expect(result.getChannelData(1)[50]).toBeCloseTo(0.8, 5)
  })
})
