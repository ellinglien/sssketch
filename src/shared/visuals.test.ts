import { describe, expect, it } from 'vitest'
import { dbLabel, offsetLabels, positionLabel, linearWave, polarGlyph } from './visuals'

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
