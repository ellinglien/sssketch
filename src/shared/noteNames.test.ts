import { describe, expect, it } from 'vitest'
import { noteNameForFrequency, octaveGridlines } from './noteNames'

describe('noteNameForFrequency', () => {
  it('identifies A4 (440Hz) and middle C (~261.63Hz)', () => {
    expect(noteNameForFrequency(440)).toBe('A4')
    expect(noteNameForFrequency(261.63)).toBe('C4')
  })

  it('identifies a low and a high octave correctly', () => {
    expect(noteNameForFrequency(65.41)).toBe('C2')
    expect(noteNameForFrequency(4186.01)).toBe('C8')
  })
})

describe('octaveGridlines', () => {
  it('returns only C-note landmarks within range, ascending', () => {
    const lines = octaveGridlines(40, 8000)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((l) => l.label.startsWith('C'))).toBe(true)
    expect(lines.every((l) => l.freqHz >= 40 && l.freqHz <= 8000)).toBe(true)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].freqHz).toBeGreaterThan(lines[i - 1].freqHz)
    }
    expect(lines.map((l) => l.label)).toContain('C4')
  })

  it('returns nothing for a range with no octave-C inside it', () => {
    // Between C4 (~261.6Hz) and C5 (~523.3Hz), comfortably clear of both.
    expect(octaveGridlines(300, 400)).toEqual([])
  })
})
