import { describe, expect, it } from 'vitest'
import {
  dbLabel,
  offsetLabels,
  positionLabel,
  elapsedLabel,
  linearWave,
  linearWaveBars,
  polarGlyph,
  polarPitchLine,
  linearPitchLine,
  zcrFromChannel,
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

describe('linearWaveBars', () => {
  it('returns one bar per peak, spanning the full 128-wide box', () => {
    const bars = linearWaveBars([0.5, 1, 0.25])
    expect(bars).toHaveLength(3)
    expect(bars[0].x).toBeCloseTo(0, 5)
    expect(bars[2].x + bars[2].width).toBeCloseTo(128, 5)
  })

  it('scales each bar height relative to the peak array’s own max', () => {
    const bars = linearWaveBars([0.5, 1])
    // The loudest bucket (1) should be exactly twice the quieter one's height.
    expect(bars[1].height).toBeCloseTo(bars[0].height * 2, 5)
  })

  it('centers every bar vertically around y=50', () => {
    const bars = linearWaveBars([0.4, 0.8])
    for (const bar of bars) {
      expect(bar.y + bar.height / 2).toBeCloseTo(50, 5)
    }
  })

  it('returns an empty array for empty input', () => {
    expect(linearWaveBars([])).toEqual([])
  })
})

describe('zcrFromChannel', () => {
  it('reports near-zero crossings for a constant (DC) signal', () => {
    const samples = new Float32Array(256).fill(0.5)
    const zcr = zcrFromChannel(samples, 4)
    for (const v of zcr) expect(v).toBeCloseTo(0, 5)
  })

  it('reports a high crossing rate for a signal alternating every sample', () => {
    const samples = new Float32Array(256)
    for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 1 : -1
    const zcr = zcrFromChannel(samples, 4)
    for (const v of zcr) expect(v).toBeGreaterThan(0.9)
  })

  it('reports a higher crossing rate for a high-frequency bucket than a low one', () => {
    const sampleRate = 44100
    const samples = new Float32Array(sampleRate)
    // First half: a low tone. Second half: a much higher tone.
    for (let i = 0; i < samples.length / 2; i++) {
      samples[i] = Math.sin((2 * Math.PI * 80 * i) / sampleRate)
    }
    for (let i = samples.length / 2; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 6000 * i) / sampleRate)
    }
    const zcr = zcrFromChannel(samples, 2)
    expect(zcr[1]).toBeGreaterThan(zcr[0])
  })

  it('returns `buckets` entries, each within [0, 1]', () => {
    const samples = new Float32Array(1000).map((_, i) => Math.sin(i))
    const zcr = zcrFromChannel(samples, 16)
    expect(zcr).toHaveLength(16)
    for (const v of zcr) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('polarPitchLine', () => {
  it('returns an empty string for an all-unpitched contour', () => {
    expect(polarPitchLine([0, 0, 0], 17, 20, 60, 2000)).toBe('')
  })

  it('starts a new subpath (M) after a gap, instead of drawing across it', () => {
    const path = polarPitchLine([220, 0, 440], 17, 20, 60, 2000)
    const moveCount = (path.match(/M/g) || []).length
    expect(moveCount).toBe(2) // one M before the gap, one after
  })

  it('places a higher frequency at a larger radius than a lower one', () => {
    // Two single-note contours, otherwise identical geometry.
    const low = polarPitchLine([110], 17, 20, 60, 2000)
    const high = polarPitchLine([1000], 17, 20, 60, 2000)
    const radiusOf = (d: string): number => {
      const [x, y] = d.slice(1).split(',').map(Number)
      return Math.hypot(x - 50, y - 50)
    }
    expect(radiusOf(high)).toBeGreaterThan(radiusOf(low))
  })
})

describe('linearPitchLine', () => {
  it('returns an empty string for an all-unpitched contour', () => {
    expect(linearPitchLine([0, 0, 0], 60, 2000)).toBe('')
  })

  it('starts a new subpath (M) after a gap, instead of drawing across it', () => {
    const path = linearPitchLine([220, 0, 440], 60, 2000)
    const moveCount = (path.match(/M/g) || []).length
    expect(moveCount).toBe(2)
  })

  it('places a higher frequency nearer the top (smaller y) than a lower one', () => {
    const low = linearPitchLine([110], 60, 2000)
    const high = linearPitchLine([1000], 60, 2000)
    const yOf = (d: string): number => Number(d.slice(1).split(',')[1])
    expect(yOf(high)).toBeLessThan(yOf(low))
  })
})
