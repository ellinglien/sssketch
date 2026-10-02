import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_TURNAROUNDS,
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_CHANCE,
  normalizeRadioTurnarounds,
  turnaroundCapBeats,
  turnaroundPhraseLaps
} from './radioTurnaround'

describe('the turnarounds setting', () => {
  it('offers off, rare and often, and defaults to rare', () => {
    expect(RADIO_TURNAROUNDS_OPTIONS).toEqual(['off', 'rare', 'often'])
    expect(DEFAULT_RADIO_TURNAROUNDS).toBe('rare')
  })

  it('reads an old drop-outs value only when turnarounds is missing or unreadable', () => {
    expect(normalizeRadioTurnarounds(undefined, 'often')).toBe('often')
    expect(normalizeRadioTurnarounds(undefined, 'off')).toBe('off')
    expect(normalizeRadioTurnarounds('always', 'off')).toBe('off')
    expect(normalizeRadioTurnarounds('rare', 'often')).toBe('rare')
  })

  it('falls back to rare for anything else', () => {
    expect(normalizeRadioTurnarounds(undefined)).toBe('rare')
    expect(normalizeRadioTurnarounds(3, 'loud')).toBe('rare')
  })

  it('fires one phrase end in three at rare, two in three at often, none when off', () => {
    expect(TURNAROUND_CHANCE).toEqual({ off: 0, rare: 1 / 3, often: 2 / 3 })
  })
})

describe('turnaroundPhraseLaps', () => {
  it('is the phrase in whole laps', () => {
    expect(turnaroundPhraseLaps(16, 4)).toBe(4)
    expect(turnaroundPhraseLaps(16, 8)).toBe(2)
    expect(turnaroundPhraseLaps(32, 8)).toBe(4)
    expect(turnaroundPhraseLaps(16, 0.5)).toBe(32)
  })

  it('rounds UP, so a phrase is never shorter than its bar count', () => {
    expect(turnaroundPhraseLaps(16, 3)).toBe(6) // 18 bars
    expect(turnaroundPhraseLaps(16, 2.5)).toBe(7) // 17.5 bars
    expect(turnaroundPhraseLaps(16, 16 / 3)).toBe(3) // float slack: exactly three laps
  })

  it('makes every wrap a phrase end on a loop of 16 bars or more', () => {
    expect(turnaroundPhraseLaps(16, 16)).toBe(1)
    expect(turnaroundPhraseLaps(16, 24)).toBe(1)
    expect(turnaroundPhraseLaps(16, 32)).toBe(1)
    // a 32-bar loop is one 32-bar phrase, not two 16-bar halves
    expect(turnaroundPhraseLaps(32, 32)).toBe(1)
  })

  it('counts a 16-bar phrase when there is no phrase grid (phraseBars 0)', () => {
    expect(turnaroundPhraseLaps(0, 4)).toBe(4)
    expect(turnaroundPhraseLaps(0, 16)).toBe(1)
  })

  it('is 0 for a loop it cannot count', () => {
    expect(turnaroundPhraseLaps(16, 0)).toBe(0)
    expect(turnaroundPhraseLaps(16, Number.NaN)).toBe(0)
    expect(turnaroundPhraseLaps(16, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('turnaroundCapBeats', () => {
  it('is min(half the loop, 4 bars), in beats', () => {
    expect(turnaroundCapBeats(32)).toBe(16)
    expect(turnaroundCapBeats(8)).toBe(16)
    expect(turnaroundCapBeats(4)).toBe(8)
    expect(turnaroundCapBeats(2)).toBe(4)
    expect(turnaroundCapBeats(1)).toBe(2)
    expect(turnaroundCapBeats(0)).toBe(0)
    expect(turnaroundCapBeats(Number.NaN)).toBe(0)
  })
})
