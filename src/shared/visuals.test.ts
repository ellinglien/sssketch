import { describe, expect, it } from 'vitest'
import {
  dbLabel,
  offsetLabels,
  positionLabel,
  elapsedLabel,
  linearWave,
  polarGlyph,
  downsample,
  peaksFromChannel
} from './visuals'

describe('downsample', () => {
  it('averages a bucket of identical values down to the same value', () => {
    expect(downsample([1, 1, 1, 1, 1, 1], 3)).toEqual([1, 1, 1])
  })

  it('upsamples by repeating averaged values when n exceeds the input length', () => {
    // widen-guard path: Math.max(b, a + 1) keeps every output bucket non-empty
    // even when the input is shorter than the requested output length.
    expect(downsample([2, 4], 4)).toEqual([2, 2, 4, 4])
  })
})

describe('peaksFromChannel', () => {
  it('takes the max-abs sample at the start of each bucket for small buckets', () => {
    // Buckets narrower than the stride (7) only ever sample their first index,
    // since j += 7 immediately exceeds the bucket's own end (b). This is an
    // intentional characteristic of the ported algorithm, not a bug.
    const samples = new Float32Array([0.1, 0.9, 0.2, 0.3, -0.9, 0.05, 0.4, 0.6])
    const peaks = peaksFromChannel(samples, 2)
    expect(peaks[0]).toBeCloseTo(0.1, 5)
    expect(peaks[1]).toBeCloseTo(0.9, 5)
  })

  it('scans multiple strided indices within a single wide bucket', () => {
    const samples = new Float32Array(15).fill(0.1)
    samples[0] = 0.05
    samples[7] = 0.99 // reachable via the j += 7 stride
    samples[14] = 0.2
    const peaks = peaksFromChannel(samples, 1)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]).toBeCloseTo(0.99, 5)
  })
})

describe('dbLabel', () => {
  it('reads unity gain as 0.0', () => {
    expect(dbLabel(1)).toBe('0.0')
  })
  it('reads silence as -inf', () => {
    expect(dbLabel(0)).toBe('−inf')
  })
  it('reads half gain as roughly -6dB', () => {
    expect(dbLabel(0.5)).toBe('−6.0')
  })
})

describe('offsetLabels', () => {
  it('reports dead on for zero offset', () => {
    const l = offsetLabels(0, 16, 80)
    expect(l.grid).toBe('0')
    expect(l.ms).toBe('dead on')
    expect(l.msPerStep).toBe('187.5 ms/step')
  })
  it('reports positive offset in grid steps and ms', () => {
    const l = offsetLabels(2, 16, 80)
    expect(l.grid).toBe('+2/16')
    expect(l.ms).toBe('+375 ms')
  })
  it('reports negative offset', () => {
    const l = offsetLabels(-1, 16, 80)
    expect(l.grid).toBe('−1/16')
    expect(l.ms).toBe('−188 ms')
  })
})

describe('elapsedLabel', () => {
  it('reads bar 1 as 0:00.0', () => {
    expect(elapsedLabel(0, 80)).toBe('0:00.0')
  })
  it('formats seconds under a minute, zero-padded', () => {
    // secPerBar at 80bpm = (60/80)*4 = 3s; 2 bars in = 6.0s
    expect(elapsedLabel(2, 80)).toBe('0:06.0')
  })
  it('rolls over into minutes', () => {
    // 32 bars at 80bpm = 32*3 = 96s = 1:36.0
    expect(elapsedLabel(32, 80)).toBe('1:36.0')
  })
})

describe('positionLabel', () => {
  it('formats bar 1 beat 1 sixteenth 1 as 001.1.1', () => {
    expect(positionLabel(0)).toBe('001.1.1')
  })
  it('formats bar 9 as zero-padded', () => {
    expect(positionLabel(8)).toBe('009.1.1')
  })
  it('advances beat and sixteenth within a bar', () => {
    // 1.5 bars = bar 2 (0-indexed 1), beat 3 (0.5 bar = 2 beats in), sixteenth 1
    expect(positionLabel(1.5)).toBe('002.3.1')
  })
})

describe('linearWave', () => {
  it('produces a closed SVG path starting and ending appropriately', () => {
    const path = linearWave([0.5, 1, 0.5, 0.2])
    expect(path.startsWith('M0.0,')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })
})

describe('polarGlyph', () => {
  it('produces a closed SVG path', () => {
    const path = polarGlyph([0.2, 0.8, 0.4, 0.6], 17, 20, 8)
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })
})
